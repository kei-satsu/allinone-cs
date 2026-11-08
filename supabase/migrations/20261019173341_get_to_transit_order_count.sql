CREATE INDEX IF NOT EXISTS orders_to_transit_count_idx
  ON public.orders (status, branch, receiver_loc)
  WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION public.get_to_transit_order_count(p_branch text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  local_count bigint;
  incoming_count bigint;
BEGIN
  IF p_branch NOT IN ('MDY', 'YGN') THEN
    RAISE EXCEPTION 'Unsupported branch: %', p_branch
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
  INTO local_count
  FROM public.orders AS orders
  WHERE orders.is_deleted = false
    AND orders.branch = p_branch
    AND orders.status = 'At Office'
    AND orders.receiver_loc <> p_branch;

  SELECT count(*)
  INTO incoming_count
  FROM public.orders AS orders
  CROSS JOIN LATERAL (
    SELECT leg.value ->> 'transit_to' AS transit_to
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(orders.transit) = 'array' THEN orders.transit
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS leg(value, position)
    ORDER BY leg.value ->> 'transit_date' DESC NULLS LAST, leg.position DESC
    LIMIT 1
  ) AS latest_transit
  WHERE orders.is_deleted = false
    AND orders.branch IS DISTINCT FROM p_branch
    AND orders.status IN ('At Office', 'Arrived')
    AND orders.receiver_loc <> p_branch
    AND latest_transit.transit_to = p_branch;

  RETURN local_count + incoming_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_to_transit_order_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_to_transit_order_count(text) TO authenticated;
