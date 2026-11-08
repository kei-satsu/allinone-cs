import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as SQLite from 'expo-sqlite';

export type IntakeImage = {
  id: string;
  uri: string;
  width: number;
  height: number;
  barcode: string | null;
  quality: 'SD' | 'HD';
};

export type IntakeQueueItem = {
  id: string;
  imageUri: string;
  barcode: string | null;
  branch: string;
  received_date: string;
  uploader_note: string | null;
  transit: {
    transit_to: 'YGN';
    transit_date: string;
    transit_from: string;
  }[] | null;
  width: number;
  height: number;
  quality: 'SD' | 'HD';
};

type QueueRow = {
  id: string;
  payload: string;
};

type Order = {
  id: string;
  barcode: string | null;
  image_url: string | null;
};

export type IntakeQueueStatus = 'idle' | 'uploading' | 'failed' | 'completed';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;
let intakeQueueStatus: IntakeQueueStatus = 'idle';
let intakeQueueStatusTimer: ReturnType<typeof setTimeout> | undefined;
const intakeQueueListeners = new Set<() => void>();

function notifyIntakeQueueListeners(): void {
  intakeQueueListeners.forEach((listener) => listener());
}

export function getIntakeQueueStatus(): IntakeQueueStatus {
  return intakeQueueStatus;
}

export function setIntakeQueueStatus(status: IntakeQueueStatus): void {
  if (intakeQueueStatusTimer) {
    clearTimeout(intakeQueueStatusTimer);
    intakeQueueStatusTimer = undefined;
  }
  intakeQueueStatus = status;
  notifyIntakeQueueListeners();

  if (status === 'completed') {
    intakeQueueStatusTimer = setTimeout(() => {
      intakeQueueStatusTimer = undefined;
      intakeQueueStatus = 'idle';
      notifyIntakeQueueListeners();
    }, 5000);
  }
}

export function subscribeToIntakeQueue(listener: () => void): () => void {
  intakeQueueListeners.add(listener);
  return () => intakeQueueListeners.delete(listener);
}

function queueDirectory(): Directory {
  return new Directory(Paths.document, 'parcel-intake');
}

function apiBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL ကို သတ်မှတ်ပေးပါ။');
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('must use HTTP or HTTPS');
    }
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL သည် မှန်ကန်သော HTTP(S) URL ဖြစ်ရပါမည်။');
  }

  return value;
}

async function openQueueDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync('parcel-intake.db').then(async (database) => {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS pending_intake (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    return database;
  }).catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

export async function getIntakeQueue(): Promise<IntakeQueueItem[]> {
  const database = await openQueueDatabase();
  const rows = await database.getAllAsync<QueueRow>(
    'SELECT id, payload FROM pending_intake ORDER BY created_at ASC',
  );
  return rows.map(({ payload }) => JSON.parse(payload) as IntakeQueueItem);
}

export async function enqueueIntake(item: IntakeQueueItem): Promise<void> {
  const directory = queueDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const source = new File(item.imageUri);
  if (!source.exists) {
    throw new Error('တင်ရန်ရွေးထားသော ပုံကို ဖုန်းထဲတွင် ရှာမတွေ့ပါ။');
  }

  const destination = new File(directory, `${item.id}.jpg`);
  await source.copy(destination);
  const savedItem = { ...item, imageUri: destination.uri };

  try {
    const database = await openQueueDatabase();
    await database.runAsync(
      'INSERT INTO pending_intake (id, payload, created_at) VALUES (?, ?, ?)',
      savedItem.id,
      JSON.stringify(savedItem),
      new Date().toISOString(),
    );
    notifyIntakeQueueListeners();
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function deleteIntakeQueueItem(id: string): Promise<void> {
  const database = await openQueueDatabase();
  await database.runAsync('DELETE FROM pending_intake WHERE id = ?', id);
  notifyIntakeQueueListeners();

  const file = new File(queueDirectory(), `${id}.jpg`);
  if (file.exists) file.delete();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await expoFetch(`${apiBaseUrl()}${path}`, init);
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof result === 'object' && result !== null && 'error' in result &&
      typeof result.error === 'string'
        ? result.error
        : `Server request failed (${response.status})`;
    throw new Error(message);
  }
  if (result === null) {
    throw new Error('Server မှ JSON response မရရှိပါ။');
  }
  return result as T;
}

export async function findOrderByBarcode(barcode: string): Promise<Order | null> {
  const result = await requestJson<{ data?: Order[] }>(
    `/api/orders?search=${encodeURIComponent(barcode)}&limit=50`,
  );
  return result.data?.find((order) => order.barcode === barcode) ?? null;
}

async function sendToTelegram(item: IntakeQueueItem, imageUrl: string): Promise<void> {
  const result = await requestJson<{ ok?: boolean; error?: string }>('/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl,
      note: item.uploader_note ?? '',
      barcode: item.barcode ?? '',
      branch: item.branch,
    }),
  });
  if (!result.ok) {
    throw new Error(result.error || 'Telegram သို့ ပို့ဆောင်ခြင်း မအောင်မြင်ပါ။');
  }
}

async function uploadImage(item: IntakeQueueItem): Promise<string> {
  const source = new File(item.imageUri);
  if (!source.exists) {
    throw new Error('Queue ထဲရှိ ပုံဖိုင်ကို ရှာမတွေ့ပါ။');
  }

  const maxDimension = item.quality === 'HD' ? 1920 : 1280;
  const resize = item.width >= item.height
    ? { width: Math.min(item.width, maxDimension) }
    : { height: Math.min(item.height, maxDimension) };
  const rendered = await ImageManipulator.manipulate(source.uri)
    .resize(resize)
    .renderAsync();
  const compressed = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: item.quality === 'HD' ? 0.92 : 0.88,
  });

  const formData = new FormData();
  formData.append('file', new File(compressed.uri));
  const result = await requestJson<{ url?: string }>('/api/upload-r2', {
    method: 'POST',
    body: formData,
  });
  if (!result.url || !/^https?:\/\//i.test(result.url)) {
    throw new Error('ပုံတင်ခြင်းမှ မှန်ကန်သော URL ပြန်မရပါ။');
  }
  return result.url;
}

export async function processIntakeItem(item: IntakeQueueItem): Promise<void> {
  if (item.barcode) {
    const existingOrder = await findOrderByBarcode(item.barcode);
    if (existingOrder) {
      if (existingOrder.image_url) {
        await sendToTelegram(item, existingOrder.image_url);
      }
      return;
    }
  }

  const imageUrl = await uploadImage(item);
  const status = item.transit?.length ? 'In-Transit' : 'At Office';
  const now = new Date().toISOString();
  const initialHistory = [{
    status,
    note: item.transit?.length
      ? `Intake recorded - Initial Status: ${item.transit[0].transit_to}${item.uploader_note ? ` (${item.uploader_note})` : ''}`
      : item.uploader_note || 'Intake recorded',
    branch: item.branch,
    date: item.received_date,
    created_at: now,
  }];

  await requestJson('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orders: [{
        image_url: imageUrl,
        branch: item.branch,
        status,
        received_date: item.received_date,
        uploader_note: item.uploader_note,
        barcode: item.barcode,
        transit: item.transit,
        history: initialHistory,
      }],
    }),
  });
  await sendToTelegram(item, imageUrl);
}

export function createQueueItem(
  image: IntakeImage,
  details: {
    branch: string;
    receivedDate: string;
    note: string;
    transitToYgn: boolean;
  },
): IntakeQueueItem {
  const transit = details.transitToYgn
    ? [{
        transit_to: 'YGN' as const,
        transit_date: details.receivedDate,
        transit_from: details.branch,
      }]
    : null;
  return {
    id: `intake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    imageUri: image.uri,
    barcode: image.barcode,
    branch: details.branch,
    received_date: details.receivedDate,
    uploader_note: details.note.trim() || null,
    transit,
    width: image.width,
    height: image.height,
    quality: image.quality,
  };
}
