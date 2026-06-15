-- Per-key usage attribution.
-- Before: anchor_user_keys summed steps by mission_id, so every key on a mission
-- showed the *mission's* totals (wrong "which key is doing what", esp. after rotation).
-- After: each step records the API key that made it, and usage is aggregated per key.

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS steps_api_key_idx ON public.steps (api_key_id);

-- Backfill historical steps: attribute to the mission's key only when unambiguous
-- (the mission has exactly one key). Multi-key missions stay NULL (can't infer).
UPDATE public.steps s
SET api_key_id = k.id
FROM public.api_keys k
WHERE s.api_key_id IS NULL
  AND k.mission_id = s.mission_id
  AND (SELECT count(*) FROM public.api_keys k2 WHERE k2.mission_id = s.mission_id) = 1;

-- Aggregate usage per KEY (was per mission).
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
    SELECT sum(tokens_in + tokens_out) AS tokens,
           sum(cost_usd)              AS cost,
           count(*) FILTER (WHERE loop_flag) AS loops
    FROM public.steps
    WHERE steps.api_key_id = k.id
  ) s ON true
  WHERE m.user_id = p_user_id
  ORDER BY k.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.anchor_user_keys(uuid) TO PUBLIC;
