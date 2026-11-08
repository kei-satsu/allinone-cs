CREATE OR REPLACE FUNCTION public.get_to_transit_order_list(
  p_branch text,
  p_receiver_loc text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id text,
  item_id text,
  barcode text,
  receiver_name text,
  receiver_phone text,
  status text,
  branch text,
  created_at text
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

  IF p_receiver_loc IS NULL OR btrim(p_receiver_loc) = '' THEN
    RAISE EXCEPTION 'A receiver location is required.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH eligible_orders AS (
    SELECT orders.*
    FROM public.orders AS orders
    WHERE orders.is_deleted = false
      AND orders.branch = p_branch
      AND orders.status = 'At Office'
      AND orders.receiver_loc = p_receiver_loc
      AND orders.receiver_loc <> p_branch

    UNION ALL

    SELECT orders.*
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
      AND orders.receiver_loc = p_receiver_loc
      AND orders.receiver_loc <> p_branch
      AND latest_transit.transit_to = p_branch
  )
  SELECT
    eligible_orders.id::text,
    eligible_orders.item_id::text,
    eligible_orders.barcode::text,
    eligible_orders.receiver_name::text,
    eligible_orders.receiver_phone::text,
    eligible_orders.status::text,
    eligible_orders.branch::text,
    eligible_orders.created_at::text
  FROM eligible_orders
  ORDER BY eligible_orders.created_at DESC NULLS LAST, eligible_orders.id::text
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_to_transit_order_list(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_to_transit_order_list(text, text, integer, integer) TO authenticated;
