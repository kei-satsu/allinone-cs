import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? 'Login အသုံးပြုရန် .env.local ထဲရှိ EXPO_PUBLIC_SUPABASE_URL နှင့် EXPO_PUBLIC_SUPABASE_ANON_KEY ကို ဖြည့်ပါ။'
    : null;

const webStorage = {
  getItem: async (key: string) =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

const authRequestTimeoutMs = 20_000;

const fetchWithAuthTimeout: typeof fetch = async (input, init) => {
  const requestUrl =
    typeof input === 'string' ? input : 'url' in input ? input.url : input.toString();
  if (!requestUrl.includes('/auth/v1/token')) return fetch(input, init);

  const requestSignal =
    init?.signal ?? (typeof input !== 'string' && 'signal' in input ? input.signal : undefined);
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort();
  if (requestSignal?.aborted) {
    controller.abort();
  } else {
    requestSignal?.addEventListener('abort', abortFromRequest, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), authRequestTimeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !requestSignal?.aborted) {
      throw new Error('Login request timed out. Check your internet connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener('abort', abortFromRequest);
  }
};

export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl!, supabaseAnonKey!, {
      global: { fetch: fetchWithAuthTimeout },
      auth: {
        storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
