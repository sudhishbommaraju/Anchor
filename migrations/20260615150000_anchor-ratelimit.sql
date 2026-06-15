-- Phase 4.4: per-key + per-IP rate limiting for /v1/* (fixed-window counter).
CREATE TABLE IF NOT EXISTS public.rate_limits (
  subject text NOT NULL,
  bucket  bigint NOT NULL,
  count   int NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, bucket)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Increment the current window for both key and IP; return whether either limit is exceeded.
CREATE OR REPLACE FUNCTION public.anchor_rate_check(p_key text, p_ip text, p_window int, p_key_limit int, p_ip_limit int)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_bucket bigint; v_kc int; v_ic int := 0;
BEGIN
  v_bucket := floor(extract(epoch from now()) / GREATEST(p_window, 1));
  INSERT INTO rate_limits (subject, bucket, count) VALUES ('k:' || p_key, v_bucket, 1)
    ON CONFLICT (subject, bucket) DO UPDATE SET count = rate_limits.count + 1 RETURNING count INTO v_kc;
  IF p_ip IS NOT NULL AND p_ip <> '' THEN
    INSERT INTO rate_limits (subject, bucket, count) VALUES ('i:' || p_ip, v_bucket, 1)
      ON CONFLICT (subject, bucket) DO UPDATE SET count = rate_limits.count + 1 RETURNING count INTO v_ic;
  END IF;
  RETURN jsonb_build_object('allowed', v_kc <= p_key_limit AND v_ic <= p_ip_limit, 'key_count', v_kc, 'ip_count', v_ic);
END;
$$;
GRANT EXECUTE ON FUNCTION public.anchor_rate_check(text, text, int, int, int) TO PUBLIC;
