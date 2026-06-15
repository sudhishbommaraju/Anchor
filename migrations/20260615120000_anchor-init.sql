-- Anchor: schema for the mission-anchoring proxy.
-- Tables: missions, api_keys, steps, memory_items, plan_steps.
-- pgvector (1536-dim, openai/text-embedding-3-small) for loop/drift detection + memory dedupe.
-- All app DB access goes through the edge function using the service-role admin key,
-- so RLS is enabled with default-deny (no anon/authenticated policies); the admin key bypasses RLS.

CREATE EXTENSION IF NOT EXISTS vector;

-- ───────────────────────────── missions ─────────────────────────────
CREATE TABLE public.missions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  goal            text NOT NULL,
  constraints     text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','completed','failed')),
  memory_summary  text NOT NULL DEFAULT '',
  goal_embedding  vector(1536),
  options         jsonb NOT NULL DEFAULT '{}'::jsonb,
  seq_counter     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX missions_user_id_idx ON public.missions (user_id);

-- ───────────────────────────── api_keys ─────────────────────────────
-- Never store the raw key. key_hash = sha-256 hex of the full secret. key_prefix shown in UI.
CREATE TABLE public.api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  key_prefix  text NOT NULL,
  key_hash    text NOT NULL UNIQUE,
  label       text,
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_mission_id_idx ON public.api_keys (mission_id);
CREATE INDEX api_keys_key_hash_idx   ON public.api_keys (key_hash);

-- ───────────────────────────── steps ────────────────────────────────
-- One row per forwarded turn side. role = agent_request | model_response.
CREATE TABLE public.steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id       uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  seq              int NOT NULL,
  role             text NOT NULL CHECK (role IN ('agent_request','model_response')),
  content          text NOT NULL DEFAULT '',
  embedding        vector(1536),
  model            text,
  tokens_in        int NOT NULL DEFAULT 0,
  tokens_out       int NOT NULL DEFAULT 0,
  cost_usd         numeric NOT NULL DEFAULT 0,
  loop_flag        boolean NOT NULL DEFAULT false,
  loop_similarity  numeric,
  drift_flag       boolean NOT NULL DEFAULT false,
  drift_similarity numeric,
  intervened       boolean NOT NULL DEFAULT false,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX steps_mission_seq_idx     ON public.steps (mission_id, seq);
CREATE INDEX steps_mission_created_idx ON public.steps (mission_id, created_at);
CREATE INDEX steps_embedding_hnsw_idx  ON public.steps USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────── memory_items ───────────────────────────
CREATE TABLE public.memory_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  type           text NOT NULL DEFAULT 'fact'
                   CHECK (type IN ('decision','fact','constraint','progress','todo','dead_end')),
  content        text NOT NULL,
  embedding      vector(1536),
  active         boolean NOT NULL DEFAULT true,
  source_step_id uuid REFERENCES public.steps(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_mission_active_idx ON public.memory_items (mission_id, active);
CREATE INDEX memory_embedding_hnsw_idx ON public.memory_items USING hnsw (embedding vector_cosine_ops);

-- ──────────────────────────── plan_steps ────────────────────────────
CREATE TABLE public.plan_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  ord         int NOT NULL,
  instruction text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','done')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_mission_ord_idx ON public.plan_steps (mission_id, ord);

-- ─────────────────────────────── RLS ────────────────────────────────
-- Default-deny for anon/authenticated. The edge function uses the admin key (service role),
-- which bypasses RLS. No app client touches these tables directly.
ALTER TABLE public.missions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.steps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_steps   ENABLE ROW LEVEL SECURITY;

-- Owners may read their own missions (handy for a future dashboard via user JWT).
CREATE POLICY missions_owner_select ON public.missions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ─────────────────────────────── RPCs ───────────────────────────────

-- Cosine similarity of a query embedding vs the most-recent N steps of a mission.
-- Used for loop detection (compare incoming agent action to recent agent actions).
CREATE OR REPLACE FUNCTION public.anchor_match_recent_steps(
  p_mission_id uuid,
  p_query_embedding vector(1536),
  p_window int DEFAULT 8,
  p_role text DEFAULT NULL
)
RETURNS TABLE (id uuid, seq int, role text, content text, similarity double precision, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT s.id, s.seq, s.role, s.content, s.embedding, s.created_at
    FROM public.steps s
    WHERE s.mission_id = p_mission_id
      AND s.embedding IS NOT NULL
      AND (p_role IS NULL OR s.role = p_role)
    ORDER BY s.seq DESC
    LIMIT GREATEST(p_window, 1)
  )
  SELECT r.id, r.seq, r.role, r.content,
         1 - (r.embedding <=> p_query_embedding) AS similarity,
         r.created_at
  FROM recent r
  ORDER BY similarity DESC;
$$;

-- Cosine similarity of a query embedding vs a mission's ACTIVE memory items.
-- Used for memory dedupe (max similarity >= 0.95 => skip) and relevance retrieval.
CREATE OR REPLACE FUNCTION public.anchor_match_memory(
  p_mission_id uuid,
  p_query_embedding vector(1536),
  p_limit int DEFAULT 20,
  p_threshold double precision DEFAULT 0.0
)
RETURNS TABLE (id uuid, type text, content text, similarity double precision, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.type, m.content,
         1 - (m.embedding <=> p_query_embedding) AS similarity,
         m.created_at
  FROM public.memory_items m
  WHERE m.mission_id = p_mission_id
    AND m.active = true
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> p_query_embedding) >= p_threshold
  ORDER BY similarity DESC
  LIMIT GREATEST(p_limit, 1);
$$;

-- Aggregate spend / event stats for the live window.
CREATE OR REPLACE FUNCTION public.anchor_mission_stats(p_mission_id uuid)
RETURNS TABLE (
  total_steps bigint,
  total_requests bigint,
  total_responses bigint,
  tokens_in bigint,
  tokens_out bigint,
  cost_usd numeric,
  loops bigint,
  drifts bigint,
  interventions bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE role = 'agent_request'),
    count(*) FILTER (WHERE role = 'model_response'),
    COALESCE(sum(tokens_in), 0),
    COALESCE(sum(tokens_out), 0),
    COALESCE(sum(cost_usd), 0),
    count(*) FILTER (WHERE loop_flag),
    count(*) FILTER (WHERE drift_flag),
    count(*) FILTER (WHERE intervened)
  FROM public.steps
  WHERE mission_id = p_mission_id;
$$;

-- Atomically reserve N sequence numbers for a mission; returns the new high-water seq.
CREATE OR REPLACE FUNCTION public.anchor_next_seq(p_mission_id uuid, p_n int DEFAULT 1)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seq int;
BEGIN
  UPDATE public.missions
    SET seq_counter = seq_counter + GREATEST(p_n, 1), updated_at = now()
    WHERE id = p_mission_id
    RETURNING seq_counter INTO v_seq;
  RETURN v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.anchor_match_recent_steps(uuid, vector, int, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.anchor_match_memory(uuid, vector, int, double precision) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.anchor_mission_stats(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.anchor_next_seq(uuid, int) TO PUBLIC;
