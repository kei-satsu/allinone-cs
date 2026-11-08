export type PrintBridgeConnection = {
  address: string;
  token: string;
  deviceName: string;
};

export type PrintBridgePaper = {
  id: string;
  name: string;
  widthMicrons: number;
  heightMicrons: number;
};

export type PrintBridgePrinter = {
  id: string;
  name: string;
  isDefault: boolean;
  status: number;
  papers: PrintBridgePaper[];
};

function normalizeAddress(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Computer Print Bridge address is required.');
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(candidate);
  const octets = url.hostname.split('.');
  const parsedOctets = octets.map(Number);
  const validIpv4 = octets.length === 4 &&
    octets.every((part, index) => /^\d{1,3}$/.test(part) && parsedOctets[index] <= 255);
  const first = parsedOctets[0] ?? -1;
  const second = parsedOctets[1] ?? -1;
  const privateAddress =
    validIpv4 &&
    (first === 10 ||
      (first === 192 && second === 168) ||
      (first === 172 && second >= 16 && second <= 31));
  if (
    url.protocol !== 'http:' ||
    !privateAddress ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Print Bridge သည် trusted local Wi-Fi ရှိ private IPv4 address ဖြစ်ရပါမည်။');
  }
  return `${url.protocol}//${url.hostname}:${url.port || '4318'}`;
}

export function parsePrintBridgeQr(value: string): PrintBridgeConnection {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error('ဤQR code သည် AIO Print Bridge အတွက်မဟုတ်ပါ။');
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('AIO Print Bridge QR code မမှန်ပါ။');
  }
  const candidate = payload as {
    type?: unknown;
    version?: unknown;
    address?: unknown;
    token?: unknown;
    deviceName?: unknown;
  };
  if (
    candidate.type !== 'aio-print-bridge' ||
    candidate.version !== 1 ||
    typeof candidate.token !== 'string' ||
    candidate.token.length < 20
  ) {
    throw new Error('AIO Print Bridge QR code မမှန်ပါ။');
  }
  return {
    address: normalizeAddress(candidate.address),
    token: candidate.token,
    deviceName: String(candidate.deviceName || 'Windows Print Bridge'),
  };
}

export function validatePrintBridgeConnection(
  input: PrintBridgeConnection,
): PrintBridgeConnection {
  if (typeof input.token !== 'string' || input.token.length < 20) {
    throw new Error('Print Bridge pairing token မမှန်ပါ။');
  }
  return {
    address: normalizeAddress(input.address),
    token: input.token,
    deviceName: String(input.deviceName || 'Windows Print Bridge'),
  };
}
