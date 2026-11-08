ALTER TABLE public.pickups
  ADD COLUMN IF NOT EXISTS branch text;

UPDATE public.pickups AS pickups
SET branch = riders.branch
FROM public.riders AS riders
WHERE pickups.branch IS NULL
  AND pickups.rider_id::text = riders.id::text
  AND riders.branch IN ('MDY', 'YGN');
