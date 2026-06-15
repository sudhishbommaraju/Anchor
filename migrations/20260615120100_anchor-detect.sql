-- Combined loop+drift detection in a single round-trip.
-- Returns: { goal_similarity: cosine(incoming, mission.goal), recent: [{id,seq,role,content,similarity}, ...] }
-- where `recent` are the most-recent N agent_request steps with cosine similarity to the incoming embedding.
CREATE OR REPLACE FUNCTION public.anchor_detect(
  p_mission_id uuid,
  p_query_embedding vector(1536),
  p_window int DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal_sim double precision;
  v_recent jsonb;
BEGIN
  SELECT CASE
           WHEN m.goal_embedding IS NULL THEN NULL
           ELSE 1 - (m.goal_embedding <=> p_query_embedding)
         END
    INTO v_goal_sim
  FROM public.missions m
  WHERE m.id = p_mission_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.similarity DESC), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT s.id, s.seq, s.role, s.content,
           1 - (s.embedding <=> p_query_embedding) AS similarity
    FROM public.steps s
    WHERE s.mission_id = p_mission_id
      AND s.embedding IS NOT NULL
      AND s.role = 'agent_request'
    ORDER BY s.seq DESC
    LIMIT GREATEST(p_window, 1)
  ) t;

  RETURN jsonb_build_object('goal_similarity', v_goal_sim, 'recent', v_recent);
END;
$$;

GRANT EXECUTE ON FUNCTION public.anchor_detect(uuid, vector, int) TO PUBLIC;
