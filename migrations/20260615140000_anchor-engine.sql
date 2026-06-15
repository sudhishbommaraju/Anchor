-- Phase 1 engine: attempt clusters, detection state, plan-step embeddings, dead-end-aware detection.

ALTER TABLE public.steps ADD COLUMN IF NOT EXISTS detection_state text NOT NULL DEFAULT 'none';
ALTER TABLE public.memory_items ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'observed';
ALTER TABLE public.plan_steps ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Approach clusters: groups of semantically-similar failed/looped attempts.
CREATE TABLE IF NOT EXISTS public.attempt_clusters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  centroid      vector(1536),
  label         text,
  attempt_count int NOT NULL DEFAULT 1,
  last_seen_seq int,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempt_clusters_mission_idx ON public.attempt_clusters (mission_id);
CREATE INDEX IF NOT EXISTS attempt_clusters_centroid_hnsw ON public.attempt_clusters USING hnsw (centroid vector_cosine_ops);
ALTER TABLE public.attempt_clusters ENABLE ROW LEVEL SECURITY;

-- Combined detection: goal sim, active-plan-step sim, progress count, recent N agent steps, nearest cluster.
CREATE OR REPLACE FUNCTION public.anchor_detect2(p_mission_id uuid, p_query vector(1536), p_window int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_goal double precision; v_plan double precision; v_recent jsonb; v_cluster jsonb; v_progress int; v_total int;
BEGIN
  SELECT CASE WHEN goal_embedding IS NULL THEN NULL ELSE 1 - (goal_embedding <=> p_query) END INTO v_goal
    FROM public.missions WHERE id = p_mission_id;
  SELECT 1 - (ps.embedding <=> p_query) INTO v_plan
    FROM public.plan_steps ps WHERE ps.mission_id = p_mission_id AND ps.status = 'active' AND ps.embedding IS NOT NULL
    ORDER BY ps.ord LIMIT 1;
  SELECT count(*) INTO v_progress FROM public.memory_items WHERE mission_id = p_mission_id AND type = 'progress' AND active;
  SELECT count(*) INTO v_total FROM public.steps WHERE mission_id = p_mission_id AND role = 'agent_request';
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.seq DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT s.seq, left(s.content, 240) AS content,
           1 - (s.embedding <=> p_query) AS similarity,
           s.loop_similarity, s.loop_flag, s.drift_flag, s.detection_state
    FROM public.steps s
    WHERE s.mission_id = p_mission_id AND s.role = 'agent_request' AND s.embedding IS NOT NULL
    ORDER BY s.seq DESC LIMIT GREATEST(p_window, 1)
  ) t;
  SELECT to_jsonb(c) INTO v_cluster FROM (
    SELECT ac.id, ac.label, ac.attempt_count, 1 - (ac.centroid <=> p_query) AS similarity
    FROM public.attempt_clusters ac WHERE ac.mission_id = p_mission_id AND ac.centroid IS NOT NULL
    ORDER BY ac.centroid <=> p_query LIMIT 1
  ) c;
  RETURN jsonb_build_object(
    'goal_similarity', v_goal, 'plan_similarity', v_plan,
    'progress_count', v_progress, 'total_steps', v_total,
    'recent', v_recent, 'nearest_cluster', v_cluster
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.anchor_detect2(uuid, vector, int) TO PUBLIC;

-- Upsert an attempt into its nearest cluster (cosine >= threshold) or create a new one.
CREATE OR REPLACE FUNCTION public.anchor_upsert_cluster(p_mission_id uuid, p_query vector(1536), p_label text, p_seq int, p_threshold double precision DEFAULT 0.85)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_sim double precision; v_count int; v_label text;
BEGIN
  SELECT ac.id, 1 - (ac.centroid <=> p_query) INTO v_id, v_sim
    FROM public.attempt_clusters ac WHERE ac.mission_id = p_mission_id AND ac.centroid IS NOT NULL
    ORDER BY ac.centroid <=> p_query LIMIT 1;
  IF v_id IS NOT NULL AND v_sim >= p_threshold THEN
    UPDATE public.attempt_clusters SET attempt_count = attempt_count + 1, last_seen_seq = p_seq
      WHERE id = v_id RETURNING attempt_count, label INTO v_count, v_label;
    RETURN jsonb_build_object('id', v_id, 'attempt_count', v_count, 'label', v_label, 'created', false);
  ELSE
    INSERT INTO public.attempt_clusters (mission_id, centroid, label, attempt_count, last_seen_seq)
      VALUES (p_mission_id, p_query, p_label, 1, p_seq)
      RETURNING id, attempt_count, label INTO v_id, v_count, v_label;
    RETURN jsonb_build_object('id', v_id, 'attempt_count', v_count, 'label', v_label, 'created', true);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.anchor_upsert_cluster(uuid, vector, text, int, double precision) TO PUBLIC;
