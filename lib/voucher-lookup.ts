import { requestJson, type ApiResult } from '@/lib/api-client';
import type { StatusOrder } from '@/lib/order-status';

async function searchOrders(
  accessToken: string,
  search: string,
): Promise<StatusOrder[]> {
  const params = new URLSearchParams({
    search,
    limit: '1000',
    is_deleted: 'false',
    sortBy: 'created_at',
    order: 'desc',
  });
  const result = await requestJson<ApiResult<StatusOrder[]>>(
    `/api/orders?${params}`,
    accessToken,
  );
  return result.data ?? [];
}

export async function searchVoucherOrders(
  accessToken: string,
  search: string,
): Promise<StatusOrder[]> {
  const term = search.trim();
  if (!term) return [];
  return searchOrders(accessToken, term);
}

export async function lookupVoucherOrder(
  accessToken: string,
  code: string,
): Promise<StatusOrder | null> {
  const term = code.trim();
  if (!term) return null;
  const orders = await searchOrders(accessToken, term);
  return orders.find((order) =>
    (order.item_id?.trim() === term || order.barcode?.trim() === term),
  ) ?? null;
}
