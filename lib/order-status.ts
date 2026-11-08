import { requestJson } from '@/lib/api-client';

export const STATUS_UPDATE_TARGETS = [
  'At Office',
  'Arrived',
  'Handover',
  'On Hold',
  'In-Transit',
  'Returned',
] as const;

export type StatusUpdateTarget = (typeof STATUS_UPDATE_TARGETS)[number];

export const TRANSIT_CITIES = [
  { id: 'YGN', name: 'ရန်ကုန်' },
  { id: 'MDY', name: 'မန္တလေး' },
  { id: 'NPT', name: 'နေပြည်တော်' },
  { id: 'TGI', name: 'တောင်ကြီး' },
  { id: 'POL1', name: 'ပြင်ဦးလွင် SPY' },
  { id: 'POL2', name: 'ပြင်ဦးလွင် စိုပြေ' },
  { id: 'MGY', name: 'မကွေး' },
  { id: 'MYW', name: 'မုံရွာ' },
  { id: 'TDU', name: 'တံတားဦး' },
  { id: 'KYS', name: 'ကျောက်ဆည်' },
  { id: 'PTN', name: 'ပုသိမ်' },
  { id: 'SGG', name: 'စစ်ကိုင်း' },
  { id: 'SBO', name: 'ရွှေဘို' },
] as const;

export type TransitLeg = {
  transit_from?: string;
  transit_to?: string;
  transit_date?: string;
};

export type StatusOrder = {
  id: string;
  item_id?: string | null;
  barcode?: string | null;
  image_url?: string | null;
  status?: string | null;
  branch?: string | null;
  receiver_loc?: string | null;
  transit?: TransitLeg[] | null;
  history?: unknown[] | null;
  deliver_rider_id?: string | null;
  deliver_date?: string | null;
  received_date?: string | null;
  arrival_date?: string | null;
  sender_name?: string | null;
  sender_phone?: string | null;
  sender_loc?: string | null;
  receiver_name?: string | null;
  receiver_phone?: string | null;
  receiver_address?: string | null;
  cod_amount?: number | string | null;
  deli_fee?: number | string | null;
  total_amount?: number | string | null;
  fee_type?: string | null;
  remark?: string | null;
  uploader_note?: string | null;
  created_at?: string | null;
  deliver_rider?: { name?: string | null } | null;
};

export type StatusRider = {
  id: string;
  name: string;
  branch: string;
};

type JsonResult<T> = {
  data?: T;
  error?: string;
};

const ACTIVE_STATUSES = [
  'At Office',
  'Arrived',
  'Pending',
  'In-Transit',
  'Via-Agent',
  'On Way',
  'On Hold',
  'Delivered',
  'Returned',
];

const STATUS_ORDER_PAGE_SIZE = 10;

function orderAccessibleToBranch(order: StatusOrder, branch: string): boolean {
  return order.branch === branch ||
    Boolean(order.transit?.some((leg) => leg.transit_to === branch));
}

export async function listStatusOrders(
  accessToken: string,
  branch: string,
  search = '',
  incomingOnly = false,
  transitOutOnly = false,
): Promise<StatusOrder[]> {
  const params = new URLSearchParams({
    limit: String(STATUS_ORDER_PAGE_SIZE),
    sortBy: 'created_at',
    order: 'desc',
    is_deleted: 'false',
  });
  if (!transitOutOnly) {
    params.set('status', incomingOnly ? 'In-Transit,Via-Agent' : ACTIVE_STATUSES.join(','));
  }
  if (!incomingOnly) params.set('branch', branch);
  if (search.trim()) params.set('search', search.trim());

  const response = await requestJson<JsonResult<StatusOrder[]>>(
    `/api/orders?${params.toString()}`,
    accessToken,
  );
  if (incomingOnly) {
    return (response.data ?? []).filter((order) =>
        orderAccessibleToBranch(order, branch) &&
        ['In-Transit', 'Via-Agent'].includes(order.status ?? '') &&
        order.transit?.some((leg) => leg.transit_to === branch),
      )
  }

  const transitParams = new URLSearchParams({
    limit: String(STATUS_ORDER_PAGE_SIZE),
    sortBy: 'created_at',
    order: 'desc',
    is_deleted: 'false',
  });
  if (!transitOutOnly) transitParams.set('status', 'In-Transit,Via-Agent');
  if (search.trim()) transitParams.set('search', search.trim());
  const transitResponse = await requestJson<JsonResult<StatusOrder[]>>(
    `/api/orders?${transitParams.toString()}`,
    accessToken,
  );
  const visibleOrders = [
    ...(response.data ?? []),
    ...(transitResponse.data ?? []).filter((order) =>
      order.receiver_loc === branch ||
      order.transit?.some((leg) => leg.transit_to === branch),
    ),
  ];
  return [...new Map(visibleOrders.map((order) => [order.id, order])).values()]
    .sort((left, right) => (right.created_at ?? '').localeCompare(left.created_at ?? ''))
    .slice(0, STATUS_ORDER_PAGE_SIZE);
}

export async function lookupStatusOrder(
  accessToken: string,
  branch: string,
  code: string,
  allowReceiverBranch = false,
): Promise<StatusOrder | null> {
  const params = new URLSearchParams({ search: code.trim(), limit: '50', is_deleted: 'false' });
  const result = await requestJson<JsonResult<StatusOrder[]>>(
    `/api/orders?${params.toString()}`,
    accessToken,
  );
  return (result.data ?? []).find((order) =>
    (orderAccessibleToBranch(order, branch) || (allowReceiverBranch && order.receiver_loc === branch)) &&
    (order.barcode === code || order.item_id === code),
  ) ?? null;
}

export async function listStatusRiders(
  accessToken: string,
  branch: string,
): Promise<StatusRider[]> {
  const params = new URLSearchParams({ branch, limit: '1000', select: 'id,name,branch' });
  const result = await requestJson<JsonResult<StatusRider[]>>(
    `/api/riders?${params.toString()}`,
    accessToken,
  );
  return result.data ?? [];
}

function mergeTransitLeg(
  transit: TransitLeg[] | null | undefined,
  branch: string,
  destination: string,
  effectiveDate: string,
): TransitLeg[] {
  const legs = Array.isArray(transit) ? [...transit] : [];
  const index = legs.findIndex((leg) => leg.transit_from === branch);
  const nextLeg = {
    ...(index >= 0 ? legs[index] : {}),
    transit_from: branch,
    transit_to: destination,
    transit_date: effectiveDate,
  };
  if (index >= 0) legs[index] = nextLeg;
  else legs.push(nextLeg);
  return legs;
}

function statusHistoryEntry(input: {
  order: StatusOrder;
  branch: string;
  userId: string;
  username: string;
  targetStatus: string;
  effectiveDate: string;
  commandId: string;
  riderId?: string;
  riderName?: string;
  transitTo?: string;
}): Record<string, unknown> {
  const previousStatus = input.order.status?.trim() || 'Pending';
  const actionLabels: Record<string, string> = {
    'In-Transit': 'Sent to Transit',
    'Via-Agent': 'Sent via Agent',
    Arrived: 'Transit Arrival Confirmed',
    'At Office': 'Received at Office',
    Handover: 'Parcel Handover Completed',
    'On Hold': 'Parcel Put On Hold',
    Returned: 'Returned to Origin Station',
  };
  const noteLines = [`Status: ${previousStatus} → ${input.targetStatus}`];
  if (input.targetStatus === 'In-Transit' || input.targetStatus === 'Via-Agent') {
    noteLines.push(`Transit To: ${input.transitTo || '-'}`);
  } else if (input.targetStatus === 'Arrived') {
    noteLines.push(`Arrival Branch: ${input.transitTo || '-'}`);
  } else if (input.riderName) {
    noteLines.push(`Rider: ${input.riderName}`);
  }
  noteLines.push(`Date: ${input.effectiveDate}`);

  return {
    command_id: input.commandId,
    timestamp: new Date().toISOString(),
    action: actionLabels[input.targetStatus] ?? input.targetStatus,
    operator: input.username,
    previous_status: previousStatus,
    status: input.targetStatus,
    operator_branch: input.branch,
    operator_user_id: input.userId,
    rider_id: input.riderId ?? null,
    transit_to: input.transitTo ?? null,
    effective_date: input.effectiveDate,
    note: noteLines.join('\n'),
    source: 'android',
  };
}

export async function updateStatusOrders(input: {
  accessToken: string;
  userId: string;
  username: string;
  branch: string;
  orderIds: string[];
  targetStatus: StatusUpdateTarget;
  riderId?: string;
  transitTo?: string;
  effectiveDate: string;
  commandId: string;
}): Promise<{ updatedCount: number; results: { orderId: string; ok: boolean; message?: string }[] }> {
  const requiresRider = ['Handover', 'On Hold', 'Returned'].includes(input.targetStatus);
  const availableRiders = input.riderId && requiresRider
    ? await listStatusRiders(input.accessToken, input.branch)
    : [];
  const rider = availableRiders.find((item) => item.id === input.riderId);
  if (requiresRider && !rider) {
    throw new Error('Selected rider is not available for your branch.');
  }

  const results = await Promise.all(input.orderIds.map(async (orderId) => {
    try {
      const currentResult = await requestJson<JsonResult<StatusOrder[]>>(
        `/api/orders?id=${encodeURIComponent(orderId)}&limit=1`,
        input.accessToken,
      );
      const order = currentResult.data?.[0];
      if (!order) throw new Error('Parcel record was not found.');
      if (!orderAccessibleToBranch(order, input.branch)) {
        throw new Error('This parcel is not accessible from your branch.');
      }

      if (requiresRider && !input.riderId) {
        throw new Error(`A branch rider is required for ${input.targetStatus}.`);
      }

      const incomingLeg = order.transit?.find((leg) => leg.transit_to === input.branch);
      if (input.targetStatus === 'Arrived' &&
          (!incomingLeg || !['In-Transit', 'Via-Agent'].includes(order.status ?? ''))) {
        throw new Error('Only an incoming parcel that is still in transit can be confirmed as Arrived.');
      }
      if (input.targetStatus === 'In-Transit' && !input.transitTo) {
        throw new Error('A transit city is required for In-Transit.');
      }

      const persistedStatus = input.targetStatus === 'In-Transit' &&
        input.transitTo !== 'YGN' && input.transitTo !== 'MDY'
        ? 'Via-Agent'
        : input.targetStatus;
      const event = statusHistoryEntry({
        order,
        branch: input.branch,
        userId: input.userId,
        username: input.username,
        targetStatus: persistedStatus,
        effectiveDate: input.effectiveDate,
        commandId: `${input.commandId}-${order.id}`,
        riderId: input.riderId,
        riderName: rider?.name ?? order.deliver_rider?.name ?? undefined,
        transitTo: input.targetStatus === 'Arrived' ? incomingLeg?.transit_to : input.transitTo,
      });
      const updates: Record<string, unknown> = {
        status: persistedStatus,
        history: [...(Array.isArray(order.history) ? order.history : []), event],
      };

      if (['At Office', 'Arrived', 'In-Transit', 'Handover', 'On Hold', 'Returned'].includes(input.targetStatus)) {
        updates.deliver_rider_id = ['Handover', 'On Hold', 'Returned'].includes(input.targetStatus)
          ? input.riderId
          : null;
        updates.deliver_date = ['Handover', 'On Hold', 'Returned'].includes(input.targetStatus)
          ? input.effectiveDate
          : null;
      }
      if (input.targetStatus === 'Arrived') updates.arrival_date = input.effectiveDate;
      if (input.targetStatus === 'In-Transit') {
        updates.transit = mergeTransitLeg(order.transit, input.branch, input.transitTo!, input.effectiveDate);
      }

      await requestJson('/api/orders', input.accessToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: [order.id], updates }),
      });
      return { orderId: order.id, ok: true };
    } catch (error) {
      return {
        orderId,
        ok: false,
        message: error instanceof Error ? error.message : 'Status update failed.',
      };
    }
  }));
  return {
    updatedCount: results.filter((result) => result.ok).length,
    results,
  };
}

export async function sendHandoverTelegramAlbum(input: {
  accessToken: string;
  branch: string;
  riderName: string;
  wayCount: number;
  imageUrls: string[];
}): Promise<void> {
  const result = await requestJson<{ ok?: boolean; error?: string }>(
    '/api/telegram',
    input.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'handover',
        branch: input.branch,
        riderName: input.riderName,
        wayCount: input.wayCount,
        images: input.imageUrls,
      }),
    },
  );
  if (!result.ok) {
    throw new Error(result.error || 'Telegram သို့ Handover ပုံများ ပို့မရပါ။');
  }
}
