-- Accounts + key history: mission name, key usage counters, and user-scoped read RPCs.

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS name text;
UPDATE public.missions SET name = COALESCE(NULLIF(name, ''), left(goal, 48)) WHERE name IS NULL OR name = '';

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS request_count int NOT NULL DEFAULT 0;

-- Bump usage counters whenever a key authenticates a /v1/* call.
CREATE OR REPLACE FUNCTION public.anchor_touch_key(p_hash text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.api_keys SET last_used_at = now(), request_count = request_count + 1 WHERE key_hash = p_hash;
$$;
GRANT EXECUTE ON FUNCTION public.anchor_touch_key(text) TO PUBLIC;

-- All of a user's missions with rollups (Dashboard / Missions list).
CREATE OR REPLACE FUNCTION public.anchor_user_missions(p_user_id uuid)
RETURNS TABLE (
  id uuid, name text, goal text, status text, created_at timestamptz, updated_at timestamptz,
  tokens_in bigint, tokens_out bigint, cost_usd numeric, loops bigint, drifts bigint, interventions bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.id, m.name, m.goal, m.status, m.created_at, m.updated_at,
    COALESCE(s.tokens_in, 0), COALESCE(s.tokens_out, 0), COALESCE(s.cost_usd, 0),
    COALESCE(s.loops, 0), COALESCE(s.drifts, 0), COALESCE(s.interventions, 0)
  FROM public.missions m
  LEFT JOIN LATERAL (
    SELECT sum(tokens_in) tokens_in, sum(tokens_out) tokens_out, sum(cost_usd) cost_usd,
      count(*) FILTER (WHERE loop_flag) loops, count(*) FILTER (WHERE drift_flag) drifts,
      count(*) FILTER (WHERE intervened) interventions
    FROM public.steps WHERE steps.mission_id = m.id
  ) s ON true
  WHERE m.user_id = p_user_id
  ORDER BY m.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.anchor_user_missions(uuid) TO PUBLIC;

-- All of a user's keys joined with mission context + usage (Keys history page).
CREATE OR REPLACE FUNCTION public.anchor_user_keys(p_user_id uuid)
RETURNS TABLE (
  id uuid, key_prefix text, label text, revoked boolean, created_at timestamptz,
  last_used_at timestamptz, request_count int, mission_id uuid, mission_name text, mission_goal text,
  tokens bigint, cost numeric, loops bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT k.id, k.key_prefix, k.label, k.revoked, k.created_at, k.last_used_at, k.request_count,
    m.id, m.name, m.goal,
    COALESCE(s.tokens, 0), COALESCE(s.cost, 0), COALESCE(s.loops, 0)
  FROM public.api_keys k
  JOIN public.missions m ON m.id = k.mission_id
  LEFT JOIN LATERAL (
    SELECT sum(tokens_in + tokens_out) tokens, sum(cost_usd) cost, count(*) FILTER (WHERE loop_flag) loops
    FROM public.steps WHERE steps.mission_id = m.id
  ) s ON true
  WHERE m.user_id = p_user_id
  ORDER BY k.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.anchor_user_keys(uuid) TO PUBLIC;
