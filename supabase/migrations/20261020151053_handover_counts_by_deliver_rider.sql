CREATE INDEX IF NOT EXISTS orders_handover_by_rider_idx
  ON public.orders (branch, deliver_rider_id, created_at DESC)
  WHERE is_deleted = false AND status = 'Handover';

CREATE OR REPLACE FUNCTION public.get_handover_order_counts(p_branch text)
RETURNS TABLE(rider_id text, rider_name text, order_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_branch NOT IN ('MDY', 'YGN') THEN
    RAISE EXCEPTION 'Unsupported branch: %', p_branch
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    riders.id::text,
    riders.name::text,
    count(*) AS order_count
  FROM public.orders AS orders
  JOIN public.riders AS riders
    ON riders.id::text = orders.deliver_rider_id::text
   AND riders.branch = p_branch
  WHERE orders.is_deleted = false
    AND orders.branch = p_branch
    AND orders.status = 'Handover'
    AND orders.deliver_rider_id IS NOT NULL
  GROUP BY riders.id, riders.name
  ORDER BY riders.name, riders.id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.get_handover_order_counts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_handover_order_counts(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_handover_order_list(
  p_branch text,
  p_rider_id text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id text,
  item_id text,
  barcode text,
  sender_name text,
  receiver_name text,
  receiver_phone text,
  image_url text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_branch NOT IN ('MDY', 'YGN') THEN
    RAISE EXCEPTION 'Unsupported branch: %', p_branch
      USING ERRCODE = '22023';
  END IF;

  IF p_rider_id IS NULL OR btrim(p_rider_id) = '' THEN
    RAISE EXCEPTION 'A rider is required.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    orders.id::text,
    orders.item_id::text,
    orders.barcode::text,
    orders.sender_name::text,
    orders.receiver_name::text,
    orders.receiver_phone::text,
    orders.image_url::text,
    orders.status::text
  FROM public.orders AS orders
  JOIN public.riders AS riders
    ON riders.id::text = orders.deliver_rider_id::text
   AND riders.branch = p_branch
  WHERE orders.is_deleted = false
    AND orders.branch = p_branch
    AND orders.status = 'Handover'
    AND orders.deliver_rider_id IS NOT NULL
    AND orders.deliver_rider_id::text = p_rider_id
  ORDER BY orders.created_at DESC NULLS LAST, orders.id::text
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_handover_order_list(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_handover_order_list(text, text, integer, integer) TO authenticated;
