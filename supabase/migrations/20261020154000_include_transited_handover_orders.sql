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
  WITH eligible_orders AS (
    SELECT orders.*
    FROM public.orders AS orders
    WHERE orders.is_deleted = false
      AND orders.branch = p_branch
      AND orders.status = 'Handover'
      AND orders.deliver_rider_id IS NOT NULL

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
      AND orders.status = 'Handover'
      AND orders.deliver_rider_id IS NOT NULL
      AND latest_transit.transit_to = p_branch
  )
  SELECT
    riders.id::text,
    riders.name::text,
    count(*) AS order_count
  FROM eligible_orders
  JOIN public.riders AS riders
    ON riders.id::text = eligible_orders.deliver_rider_id::text
   AND riders.branch = p_branch
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
  WITH eligible_orders AS (
    SELECT orders.*
    FROM public.orders AS orders
    WHERE orders.is_deleted = false
      AND orders.branch = p_branch
      AND orders.status = 'Handover'
      AND orders.deliver_rider_id IS NOT NULL

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
      AND orders.status = 'Handover'
      AND orders.deliver_rider_id IS NOT NULL
      AND latest_transit.transit_to = p_branch
  )
  SELECT
    eligible_orders.id::text,
    eligible_orders.item_id::text,
    eligible_orders.barcode::text,
    eligible_orders.sender_name::text,
    eligible_orders.receiver_name::text,
    eligible_orders.receiver_phone::text,
    eligible_orders.image_url::text,
    eligible_orders.status::text
  FROM eligible_orders
  JOIN public.riders AS riders
    ON riders.id::text = eligible_orders.deliver_rider_id::text
   AND riders.branch = p_branch
  WHERE eligible_orders.deliver_rider_id::text = p_rider_id
  ORDER BY eligible_orders.created_at DESC NULLS LAST, eligible_orders.id::text
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_handover_order_list(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_handover_order_list(text, text, integer, integer) TO authenticated;
