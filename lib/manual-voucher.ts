import AsyncStorage from '@react-native-async-storage/async-storage';

import type { VoucherFields } from '@/lib/voucher-template';

export type ManualVoucherDraft = {
  receiveDate: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  codAmount: string;
  deliFee: string;
  payType: string;
  remark: string;
};

const REFERENCE_SERIAL_KEY = 'aio-cs/manual-voucher/reference-serial/v1';
const REFERENCE_EPOCH_MS = Date.UTC(2025, 0, 1);
const MAX_REFERENCE_SERIAL = 99_999_999_999;
let generationQueue: Promise<unknown> = Promise.resolve();

function amount(value: string): number {
  const numeric = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function money(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function calculateManualVoucherTotal(codAmount: string, deliFee: string): number {
  return amount(codAmount) + amount(deliFee);
}

export function buildManualVoucherReference(serial: number): string {
  if (!Number.isInteger(serial) || serial < 0 || serial > MAX_REFERENCE_SERIAL) {
    throw new Error('Manual voucher reference serial is outside the supported range.');
  }
  return `99${String(serial).padStart(11, '0')}`;
}

export async function createManualVoucherReference(): Promise<string> {
  const task = generationQueue.then(async () => {
    const lastSerial = Number(await AsyncStorage.getItem(REFERENCE_SERIAL_KEY));
    const timeSerial = Math.max(
      0,
      Math.floor((Date.now() - REFERENCE_EPOCH_MS) / 1000) * 100,
    );
    const nextSerial = Math.max(
      Number.isSafeInteger(lastSerial) && lastSerial >= 0 ? lastSerial + 1 : 0,
      timeSerial,
    );
    const reference = buildManualVoucherReference(nextSerial);
    await AsyncStorage.setItem(REFERENCE_SERIAL_KEY, String(nextSerial));
    return reference;
  });
  generationQueue = task.then(() => undefined, () => undefined);
  return task;
}

export function toManualVoucherFields(
  draft: ManualVoucherDraft,
  referenceCode: string | null,
): VoucherFields {
  const cod = amount(draft.codAmount);
  const fee = amount(draft.deliFee);
  return {
    receiveDate: draft.receiveDate.trim() || new Date().toISOString().slice(0, 10),
    itemId: referenceCode ?? '',
    senderName: draft.senderName.trim() || '---',
    senderPhone: draft.senderPhone.trim() || '---',
    senderAddress: draft.senderAddress.trim() || '---',
    receiverName: draft.receiverName.trim() || '---',
    receiverPhone: draft.receiverPhone.trim() || '---',
    receiverAddress: draft.receiverAddress.trim() || '---',
    codAmount: money(cod),
    deliFee: money(fee),
    totalAmount: money(cod + fee),
    payType: draft.payType.trim() || 'COLLECT',
    paymentLabel: draft.payType.trim() || 'COLLECT',
    remark: draft.remark.trim() || '---',
  };
}
