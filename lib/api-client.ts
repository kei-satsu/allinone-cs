import { fetch as expoFetch } from 'expo/fetch';

export type ApiResult<T> = {
  data?: T;
  error?: string;
  total?: number;
};

function apiBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!value) throw new Error('EXPO_PUBLIC_API_BASE_URL ကို သတ်မှတ်ပေးပါ။');
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('EXPO_PUBLIC_API_BASE_URL သည် HTTP(S) URL ဖြစ်ရပါမည်။');
  }
  return value;
}

export async function requestJson<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await expoFetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Server request failed (${response.status})`;
    throw new Error(message);
  }
  if (payload === null) throw new Error('Server မှ JSON response မရရှိပါ။');
  return payload as T;
}
