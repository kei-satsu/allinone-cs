import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  type PrintBridgeConnection,
  type PrintBridgePrinter,
  validatePrintBridgeConnection,
} from '@/shared/windows-print-bridge';
import type { VoucherOutputDocument } from '@/lib/voucher-template';
import { buildVoucherHtml } from '@/lib/voucher-template';

const STORAGE_KEY = 'aio-cs/windows-print-bridge/v1';

export type PrintBridgeSettings = {
  connection: PrintBridgeConnection;
  printerId: string | null;
};

function endpoint(connection: PrintBridgeConnection, path: string): string {
  return `${connection.address}${path}`;
}

async function bridgeFetch<T>(
  connection: PrintBridgeConnection,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const valid = validatePrintBridgeConnection(connection);
  const response = await fetch(endpoint(valid, path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-aio-print-token': valid.token,
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Computer Print Bridge ကိုဆက်သွယ်မရပါ။';
    throw new Error(message);
  }
  if (payload === null) throw new Error('Print Bridge မှ JSON response မရရှိပါ။');
  return payload as T;
}

export async function loadPrintBridgeSettings(): Promise<PrintBridgeSettings | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PrintBridgeSettings>;
    if (!value.connection) throw new Error('Saved bridge connection is missing.');
    return {
      connection: validatePrintBridgeConnection(value.connection),
      printerId: typeof value.printerId === 'string' ? value.printerId : null,
    };
  } catch (error) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function savePrintBridgeSettings(
  settings: PrintBridgeSettings,
): Promise<PrintBridgeSettings> {
  const valid = {
    connection: validatePrintBridgeConnection(settings.connection),
    printerId: settings.printerId?.trim() || null,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
  return valid;
}

export async function clearPrintBridgeSettings(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function pairPrintBridge(
  connection: PrintBridgeConnection,
): Promise<{ connection: PrintBridgeConnection; printers: PrintBridgePrinter[] }> {
  const valid = validatePrintBridgeConnection(connection);
  const payload = await bridgeFetch<{ deviceName?: string; printers?: PrintBridgePrinter[] }>(
    valid,
    '/pair',
    { method: 'POST', body: '{}' },
  );
  return {
    connection: { ...valid, deviceName: payload.deviceName || valid.deviceName },
    printers: Array.isArray(payload.printers) ? payload.printers : [],
  };
}

export async function listPrintBridgePrinters(
  connection: PrintBridgeConnection,
): Promise<PrintBridgePrinter[]> {
  const payload = await bridgeFetch<{ printers?: PrintBridgePrinter[] }>(connection, '/printers');
  return Array.isArray(payload.printers) ? payload.printers : [];
}

export async function sendBridgeVoucher(
  connection: PrintBridgeConnection,
  document: VoucherOutputDocument,
  printerId: string,
  paper: PrintBridgePrinter['papers'][number],
): Promise<{ jobId: string; status: string }> {
  return bridgeFetch(connection, '/print', {
    method: 'POST',
    body: JSON.stringify({
      id: document.id,
      html: await buildVoucherHtml(document),
      printerId,
      paper,
    }),
  });
}
