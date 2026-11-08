import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase, supabaseConfigError } from '@/lib/supabase';

const palette = {
  background: '#090909',
  surface: '#141414',
  elevated: '#1c1a18',
  border: '#302a25',
  orange: '#f97316',
  orangeLight: '#ff9b47',
  green: '#65d995',
  red: '#ff8273',
  white: '#f7f4f1',
  muted: '#aaa39c',
};

const PAGE_SIZE = 500;
const STOCK_STATUSES = ['At Office', 'On Hold', 'Arrived'] as const;
const FILTER_STATUSES = ['All', ...STOCK_STATUSES, 'Checked'] as const;
const COLUMN_FILTERS = [
  { key: 'item_id', label: 'Item ID' },
  { key: 'received_date', label: 'Received Date' },
  { key: 'status', label: 'Status' },
  { key: 'last_check', label: 'Last Check' },
  { key: 'sender_name', label: 'Sender' },
  { key: 'receiver_name', label: 'Receiver' },
  { key: 'receiver_address', label: 'Receiver Address' },
  { key: 'receiver_phone', label: 'Phone' },
  { key: 'receiver_loc', label: 'R. City' },
  { key: 'cod_amount', label: 'COD (Ks)' },
  { key: 'deli_fee', label: 'Deli Fee (Ks)' },
  { key: 'total_amount', label: 'Total (Ks)' },
  { key: 'transit_to', label: 'Last Transit To' },
  { key: 'branch', label: 'Origin' },
] as const;

type StockStatus = (typeof FILTER_STATUSES)[number];
type StockColumnKey = (typeof COLUMN_FILTERS)[number]['key'];

type TransitLeg = {
  transit_from?: string | null;
  transit_to?: string | null;
  transit_date?: string | null;
};

type StockOrder = {
  id: string;
  item_id?: string | null;
  barcode?: string | null;
  branch?: string | null;
  status?: string | null;
  last_check?: string | null;
  transit?: unknown;
  transit_to?: string | null;
  transit_date?: string | null;
  created_at?: string | null;
  received_date?: string | null;
  sender_name?: string | null;
  receiver_name?: string | null;
  receiver_address?: string | null;
  receiver_phone?: string | null;
  receiver_loc?: string | null;
  cod_amount?: number | string | null;
  deli_fee?: number | string | null;
  total_amount?: number | string | null;
  image_url?: string | null;
};

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryFactory = (from: number, to: number) => PromiseLike<QueryResult>;

function isStockOrder(value: unknown): value is StockOrder {
  return typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'string';
}

function isTransitLeg(value: unknown): value is TransitLeg {
  if (typeof value !== 'object' || value === null) return false;
  const leg = value as Record<string, unknown>;
  return ['transit_from', 'transit_to', 'transit_date'].every((key) =>
    leg[key] === undefined || leg[key] === null || typeof leg[key] === 'string',
  );
}

function getTransitLegs(transit: unknown): TransitLeg[] {
  let value = transit;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter(isTransitLeg) : [];
}

function getLastTransitLeg(order: StockOrder): TransitLeg | null {
  const legs = getTransitLegs(order.transit);
  if (legs.length === 0) return null;

  const datedLegs = legs
    .map((leg) => ({ leg, timestamp: Date.parse(leg.transit_date ?? '') }))
    .filter((entry) => Number.isFinite(entry.timestamp));
  if (datedLegs.length === 0) return legs[legs.length - 1];
  return datedLegs.reduce((latest, entry) =>
    entry.timestamp >= latest.timestamp ? entry : latest,
  ).leg;
}

function belongsInStockCheck(order: StockOrder, branch: string): boolean {
  const currentBranch = branch.trim().toUpperCase();
  const origin = (order.branch ?? '').trim().toUpperCase();
  const status = (order.status ?? '').trim();

  if (origin === currentBranch && (status === 'At Office' || status === 'On Hold')) {
    return true;
  }

  const lastDestination = (getLastTransitLeg(order)?.transit_to ?? '').trim().toUpperCase();
  return lastDestination === currentBranch && (status === 'On Hold' || status === 'Arrived');
}

async function fetchAllPages(createQuery: QueryFactory): Promise<StockOrder[]> {
  const rows: StockOrder[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await createQuery(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message);

    if (!Array.isArray(result.data) || !result.data.every(isStockOrder)) {
      throw new Error('Stock စာရင်း၏ data ပုံစံ မမှန်ကန်ပါ။');
    }
    const page = result.data;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function getTodayDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function hasBeenCheckedToday(order: StockOrder): boolean {
  return (order.last_check ?? '').slice(0, 10) === getTodayDate();
}

function amount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const parsed = typeof value === 'number' ? value : Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? `${parsed.toLocaleString('en-US')} Ks` : '-';
}

function branchName(branch: string): string {
  if (branch === 'MDY') return 'Mandalay';
  if (branch === 'YGN') return 'Yangon';
  return branch || 'Branch';
}

function displayDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : 'မရှိပါ';
}

export default function StockCheckScreen() {
  const { branch } = useAuth();
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<StockStatus>('All');
  const [search, setSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState<Partial<Record<StockColumnKey, string>>>({});
  const [columnFiltersOpen, setColumnFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [checkingOrderIds, setCheckingOrderIds] = useState<Set<string>>(() => new Set());
  const [scannerOpen, setScannerOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanLocked = useRef(false);
  const requestId = useRef(0);

  const loadOrders = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setErrorMessage('');

    try {
      const client = supabase;
      if (!client) throw new Error(supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။');
      const currentBranch = branch.trim().toUpperCase();

      const localOrders = await fetchAllPages((from, to) => client
        .from('orders')
        .select('*')
        .eq('is_deleted', false)
        .eq('branch', currentBranch)
        .in('status', ['At Office', 'On Hold'])
        .order('created_at', { ascending: false })
        .range(from, to));

      const inboundOrders = await fetchAllPages((from, to) => client
        .from('orders')
        .select('*')
        .eq('is_deleted', false)
        .in('status', ['Arrived', 'On Hold'])
        .filter('transit', 'cs', JSON.stringify([{ transit_to: currentBranch }]))
        .order('created_at', { ascending: false })
        .range(from, to));

      if (currentRequest !== requestId.current) return;
      const uniqueOrders = new Map<string, StockOrder>();
      for (const order of [...localOrders, ...inboundOrders]) uniqueOrders.set(order.id, order);

      const stockOrders = [...uniqueOrders.values()]
        .filter((order) => belongsInStockCheck(order, currentBranch))
        .map((order) => {
          const lastLeg = getLastTransitLeg(order);
          return {
            ...order,
            transit_to: lastLeg?.transit_to || order.transit_to || '',
            transit_date: lastLeg?.transit_date || order.transit_date || '',
          };
        })
        .sort((left, right) =>
          (right.created_at ?? '').localeCompare(left.created_at ?? ''),
        );

      setOrders(stockOrders);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setErrorMessage(error instanceof Error ? error.message : 'Stock စာရင်းကို ရယူ၍မရပါ။');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [branch]);

  useFocusEffect(useCallback(() => {
    void loadOrders();
    return () => {
      requestId.current += 1;
    };
  }, [loadOrders]));

  const counts = useMemo(() => orders.reduce<Record<StockStatus, number>>((result, order) => {
    if (hasBeenCheckedToday(order)) {
      result.Checked += 1;
    } else if (order.status === 'At Office' || order.status === 'On Hold' || order.status === 'Arrived') {
      result[order.status] += 1;
    }
    return result;
  }, { All: orders.length, 'At Office': 0, 'On Hold': 0, Arrived: 0, Checked: 0 }), [orders]);

  const visibleOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return orders.filter((order) => {
      const checkedToday = hasBeenCheckedToday(order);
      const matchesStatus = statusFilter === 'All' ||
        (statusFilter === 'Checked' ? checkedToday : !checkedToday && order.status === statusFilter);
      const searchableValues = [
        order.item_id,
        order.barcode,
        order.sender_name,
        order.receiver_name,
        order.receiver_phone,
      ];
      const matchesSearch = !query || searchableValues.some((value) =>
        String(value ?? '').toLocaleLowerCase().includes(query),
      );
      const matchesColumns = COLUMN_FILTERS.every(({ key }) => {
        const filter = columnFilters[key]?.trim().toLocaleLowerCase();
        return !filter || String(order[key] ?? '').toLocaleLowerCase().includes(filter);
      });
      return matchesStatus && matchesSearch && matchesColumns;
    });
  }, [columnFilters, orders, search, statusFilter]);

  const activeColumnFilterCount = Object.values(columnFilters)
    .filter((value) => Boolean(value?.trim())).length;

  const handleCheckOrder = async (order: StockOrder) => {
    if (checkingOrderIds.has(order.id)) return;
    const client = supabase;
    if (!client) {
      setErrorMessage(supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။');
      return;
    }
    const wasChecked = hasBeenCheckedToday(order);
    const nextLastCheck = wasChecked ? null : getTodayDate();
    setCheckingOrderIds((current) => new Set(current).add(order.id));
    setErrorMessage('');

    try {
      const { error } = await client
        .from('orders')
        .update({ last_check: nextLastCheck })
        .eq('id', order.id);
      if (error) throw error;

      setOrders((current) => current.map((item) =>
        item.id === order.id ? { ...item, last_check: nextLastCheck } : item,
      ));
      setScanMessage(wasChecked
        ? `${order.item_id || 'Order'} ကို Uncheck လုပ်ပြီး Stock list ထဲပြန်ရွှေ့ထားပါတယ်။`
        : `${order.item_id || 'Order'} ကို ဒီနေ့စစ်ပြီးပါပြီ။ Checked ထဲသို့ ရွှေ့ထားပါတယ်။`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'စစ်ဆေးမှုကို သိမ်း၍မရပါ။');
    } finally {
      setCheckingOrderIds((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
    }
  };

  const handleScan = (barcode: string) => {
    const scannedCode = barcode.trim();
    if (!scannedCode) return;
    setScannerOpen(false);
    setStatusFilter('All');
    setSearch(scannedCode);
    const matchingOrder = orders.find((order) =>
      [order.item_id, order.barcode].some((value) =>
        String(value ?? '').toLocaleLowerCase() === scannedCode.toLocaleLowerCase(),
      ),
    );
    setScanMessage(matchingOrder
      ? `${matchingOrder.item_id || scannedCode} ကိုတွေ့ပါတယ်။ စစ်မယ်ဆို Check ကိုနှိပ်ပါ။`
      : `${scannedCode} ကို ဒီ branch ရဲ့ Stock Check စာရင်းမှာ မတွေ့ပါ။`);
  };

  const openScanner = async () => {
    try {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          Alert.alert('Camera permission လိုအပ်ပါသည်', 'Barcode ဖတ်ရန် Camera permission ပေးပါ။');
          return;
        }
      }
      scanLocked.current = false;
      setScannerOpen(true);
    } catch (error) {
      Alert.alert('Camera ကို ဖွင့်၍မရပါ', error instanceof Error ? error.message : 'Camera permission ကို စစ်ဆေးမရပါ။');
    }
  };

  const handleBarcodeScanned = (data: string) => {
    if (scanLocked.current) return;
    scanLocked.current = true;
    handleScan(data);
  };

  const renderOrder = ({ item, index }: { item: StockOrder; index: number }) => {
    const checkedToday = hasBeenCheckedToday(item);
    const checking = checkingOrderIds.has(item.id);

    return (
      <View style={styles.orderCard}>
        <View style={styles.cardHeading}>
          <View style={styles.orderTitleBlock}>
            <Text style={styles.rowNumber}>#{index + 1}</Text>
            <Text numberOfLines={1} style={styles.orderTitle}>
              {item.item_id || item.barcode || 'Item ID မရှိပါ'}
            </Text>
            <View style={[styles.statusBadge, checkedToday && styles.checkedBadge]}>
              <Text style={[styles.statusBadgeText, checkedToday && styles.checkedText]}>
                {checkedToday ? 'Checked' : item.status || 'Unknown'}
              </Text>
            </View>
          </View>
          {item.image_url ? (
            <Pressable
              accessibilityLabel="Parcel ဓာတ်ပုံကြည့်ရန်"
              onPress={() => setPreviewImage(item.image_url ?? null)}
              style={({ pressed }) => [styles.thumbnailButton, pressed && styles.pressed]}
            >
              <Image source={{ uri: item.image_url }} style={styles.thumbnail} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.metadataRow}>
          <Text style={styles.metadataLabel}>လက်ခံရက်</Text>
          <Text style={styles.metadataValue}>{displayDate(item.received_date)}</Text>
          <Text style={styles.metadataLabel}>နောက်ဆုံးစစ်ရက်</Text>
          <Text style={styles.metadataValue}>{displayDate(item.last_check)}</Text>
        </View>
        <View style={styles.divider} />

        <Text style={styles.personLine}>ပို့သူ · {item.sender_name || 'မသတ်မှတ်ရသေး'}      |||||     လက်ခံသူ · {item.receiver_name || 'မသတ်မှတ်ရသေး'}</Text>
    
        {item.receiver_address ? (
          <Text numberOfLines={2} style={styles.addressLine}>{item.receiver_address}</Text>
        ) : null}
        <Text style={styles.contactLine}>
          {item.receiver_phone || 'ဖုန်းမရှိ'}{item.receiver_loc ? ` · ${item.receiver_loc}` : ''}
        </Text>

        <View style={styles.amountRow}>
          <Amount label="COD" value={item.cod_amount} />
          <Amount label="DELI FEE" value={item.deli_fee} />
          <Amount label="TOTAL" value={item.total_amount} />
        </View>
        {item.transit_to ? (
          <Text style={styles.transitLine}>နောက်ဆုံး Transit · {item.transit_to} · {displayDate(item.transit_date)}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: checking }}
          disabled={checking}
          onPress={() => void handleCheckOrder(item)}
          style={({ pressed }) => [
            styles.checkButton,
            checkedToday && styles.uncheckButton,
            pressed && !checking && styles.pressed,
            checking && styles.disabled,
          ]}
        >
          {checking ? <ActivityIndicator color={palette.white} size="small" /> : null}
          <Text style={styles.checkButtonText}>
            {checking ? 'သိမ်းဆည်းနေသည်…' : checkedToday ? 'Uncheck · Stock list သို့ပြန်ရွှေ့ရန်' : '✓ Check လုပ်ပြီးပါပြီ'}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.stickyHeader}>
        <View style={styles.headingRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="နောက်သို့ပြန်ရန်"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/explore');
            }}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>{branchName(branch.toUpperCase())} BRANCH</Text>
            <Text style={styles.title}>Stock Check</Text>
          </View>
        </View>
        
        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="ID, barcode သို့မဟုတ် အမည်ဖြင့် ရှာရန်"
            autoCapitalize="none"
            onChangeText={(value) => {
              setSearch(value);
              setScanMessage('');
            }}
            placeholder="ID, barcode, အမည်၊ ဖုန်း..."
            placeholderTextColor={palette.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={search}
          />
          {search ? (
            <Pressable
              accessibilityLabel="ရှာဖွေမှု ရှင်းရန်"
              onPress={() => {
                setSearch('');
                setScanMessage('');
              }}
              style={styles.clearButton}
            >
              <Text style={styles.clearButtonText}>×</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Barcode scan"
            onPress={() => void openScanner()}
            style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
          >
            <Text style={styles.scanButtonText}>▥ Scan</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stock စာရင်း ပြန်ဖတ်ရန်"
            disabled={loading}
            onPress={() => void loadOrders()}
            style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
          >
            {loading ? <ActivityIndicator color={palette.orangeLight} size="small" /> : <Text style={styles.refreshIcon}>↻</Text>}
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusFilters}
        >
          {FILTER_STATUSES.map((status) => {
            const selected = statusFilter === status;
            return (
              <Pressable
                key={status}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setStatusFilter(status)}
                style={[styles.filterChip, selected && styles.selectedFilterChip]}
              >
                <Text style={[styles.filterLabel, selected && styles.selectedFilterLabel]}>
                  {status}
                </Text>
                <Text style={[styles.filterCount, selected && styles.selectedFilterLabel]}>
                  {counts[status]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        data={visibleOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading && orders.length > 0}
            onRefresh={() => void loadOrders()}
            tintColor={palette.orangeLight}
            colors={[palette.orange]}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.filterControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: columnFiltersOpen }}
                onPress={() => setColumnFiltersOpen((open) => !open)}
                style={styles.filterToggle}
              >
                <Text style={styles.filterToggleText}>
                  {columnFiltersOpen ? '−' : '+'} Filter columns{activeColumnFilterCount ? ` (${activeColumnFilterCount})` : ''}
                </Text>
              </Pressable>
              {activeColumnFilterCount > 0 ? (
                <Pressable onPress={() => setColumnFilters({})} style={styles.clearFiltersButton}>
                  <Text style={styles.clearFiltersText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            {columnFiltersOpen ? (
              <View style={styles.columnFilterGrid}>
                {COLUMN_FILTERS.map(({ key, label }) => (
                  <View key={key} style={styles.columnFilterField}>
                    <Text style={styles.columnFilterLabel}>{label}</Text>
                    <TextInput
                      accessibilityLabel={`${label} filter`}
                      autoCapitalize="none"
                      onChangeText={(value) => setColumnFilters((current) => ({
                        ...current,
                        [key]: value,
                      }))}
                      placeholder={`Filter ${label}`}
                      placeholderTextColor="#766d65"
                      style={styles.columnFilterInput}
                      value={columnFilters[key] ?? ''}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {scanMessage ? (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{scanMessage}</Text>
                <Pressable accessibilityLabel="Scan message ပိတ်ရန်" onPress={() => setScanMessage('')}>
                  <Text style={styles.dismissText}>×</Text>
                </Pressable>
              </View>
            ) : null}
            {errorMessage ? (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <Pressable onPress={() => void loadOrders()} style={styles.retryButton}>
                  <Text style={styles.retryText}>ပြန်စမ်းရန်</Text>
                </Pressable>
              </View>
            ) : null}
            <Text style={styles.resultsCount}>
              {visibleOrders.length} ခု{search.trim() ? ` · "${search.trim()}"` : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <ActivityIndicator color={palette.orangeLight} />
            ) : (
              <>
                <Text style={styles.emptyTitle}>စာရင်းမရှိပါ</Text>
                <Text style={styles.emptyDescription}>
                  {search ? 'ရှာဖွေမှုကို ပြောင်းလဲကြည့်ပါ။' : 'ဤ branch အတွက် Stock စာရင်းမတွေ့ပါ။'}
                </Text>
              </>
            )}
          </View>
        }
      />

      <Modal
        animationType="fade"
        onRequestClose={() => setScannerOpen(false)}
        visible={scannerOpen}
      >
        <SafeAreaView style={styles.scannerSafeArea}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>Barcode Scanner</Text>
              <Text style={styles.scannerSubtitle}>Barcode ကို ဘောင်အတွင်း ချိန်ပါ</Text>
            </View>
            <Pressable accessibilityLabel="Scanner ပိတ်ရန်" onPress={() => setScannerOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          <View style={styles.cameraFrame}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }}
              onBarcodeScanned={(result) => handleBarcodeScanned(result.data)}
            />
            <View pointerEvents="none" style={styles.scanGuide}>
              <View style={styles.scanLine} />
            </View>
          </View>
          <Text style={styles.scannerHelp}>ဖတ်ပြီးသည်နှင့် စာရင်းကို အလိုအလျောက်ရှာပါမည်။</Text>
          <Pressable onPress={() => setScannerOpen(false)} style={styles.cancelScanButton}>
            <Text style={styles.cancelScanText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
        transparent
        visible={previewImage !== null}
      >
        <Pressable style={styles.imageBackdrop} onPress={() => setPreviewImage(null)}>
          <Pressable accessibilityRole="image" onPress={() => {}} style={styles.imageContainer}>
            {previewImage ? (
              <Image source={{ uri: previewImage }} resizeMode="contain" style={styles.previewImage} />
            ) : null}
          </Pressable>
          <Pressable accessibilityLabel="ဓာတ်ပုံပိတ်ရန်" onPress={() => setPreviewImage(null)} style={styles.imageCloseButton}>
            <Text style={styles.imageCloseText}>×</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Amount({ label, value }: { label: string; value: StockOrder['cod_amount'] }) {
  return (
    <View style={styles.amountCell}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.amountValue}>{amount(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  stickyHeader: {
    zIndex: 1,
    paddingHorizontal: 17,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.background,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  backButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  backButtonText: { color: palette.white, fontSize: 33, lineHeight: 36, marginTop: -4 },
  headingCopy: { flex: 1 },
  orderList: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: 17, paddingTop: 10, paddingBottom: 128 },
  eyebrow: { color: palette.orangeLight, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: palette.white, fontSize: 28, lineHeight: 38, fontWeight: '900', marginTop: 4 },
  subtitle: { color: palette.muted, fontSize: 12, lineHeight: 19, marginTop: 3, marginBottom: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchInput: {
    height: 46,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    color: palette.white,
    fontSize: 13,
  },
  clearButton: {
    position: 'absolute',
    right: 105,
    zIndex: 1,
    width: 30,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: { color: palette.muted, fontSize: 25, lineHeight: 28 },
  scanButton: {
    height: 46,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: palette.orange,
  },
  scanButtonText: { color: palette.white, fontSize: 12, fontWeight: '800' },
  refreshButton: {
    width: 44,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  refreshIcon: { color: palette.orangeLight, fontSize: 24, fontWeight: '700' },
  statusFilters: { gap: 7, paddingVertical: 13 },
  filterControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  filterToggle: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: palette.elevated },
  filterToggleText: { color: palette.orangeLight, fontSize: 11, fontWeight: '700' },
  clearFiltersButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 9 },
  clearFiltersText: { color: palette.muted, fontSize: 11, fontWeight: '700' },
  columnFilterGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 9, padding: 10, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  columnFilterField: { width: '48%', minWidth: 0 },
  columnFilterLabel: { color: palette.muted, fontSize: 9, fontWeight: '700', marginBottom: 4 },
  columnFilterInput: { height: 37, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, color: palette.white, fontSize: 10 },
  filterChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  selectedFilterChip: { borderColor: palette.orange, backgroundColor: '#3a2112' },
  filterLabel: { color: palette.muted, fontSize: 11, fontWeight: '700' },
  filterCount: { color: '#746c65', fontSize: 10, fontWeight: '800' },
  selectedFilterLabel: { color: palette.orangeLight },
  messageBox: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#1b1713',
    marginBottom: 9,
  },
  messageText: { flex: 1, color: palette.orangeLight, fontSize: 11, lineHeight: 17 },
  dismissText: { color: palette.muted, fontSize: 22, paddingHorizontal: 3 },
  errorBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#63362f',
    backgroundColor: '#291815',
    marginBottom: 9,
  },
  errorText: { color: palette.red, fontSize: 12, lineHeight: 18 },
  retryButton: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 4 },
  retryText: { color: palette.orangeLight, fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  resultsCount: { color: palette.muted, fontSize: 11, fontWeight: '700', marginBottom: 9 },
  orderCard: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 7,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orderTitleBlock: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowNumber: { color: '#766d65', fontSize: 9, fontWeight: '700' },
  orderTitle: { flex: 1, minWidth: 0, color: palette.white, fontSize: 13, fontWeight: '900' },
  statusBadge: { maxWidth: 82, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: '#34281e' },
  statusBadgeText: { color: '#f6c79e', fontSize: 8, fontWeight: '800' },
  checkedBadge: { backgroundColor: '#173a2a' },
  checkedText: { color: palette.green },
  thumbnailButton: { width: 42, height: 42, overflow: 'hidden', borderRadius: 9, backgroundColor: palette.elevated },
  thumbnail: { width: '100%', height: '100%' },
  metadataRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 5, rowGap: 2, marginTop: 6 },
  metadataLabel: { color: palette.muted, fontSize: 8 },
  metadataValue: { color: palette.white, fontSize: 9, fontWeight: '700', marginRight: 5 },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 6 },
  personLine: { color: '#ddd6d0', fontSize: 10, lineHeight: 20 },
  addressLine: { color: palette.muted, fontSize: 9, lineHeight: 14, marginTop: 1 },
  contactLine: { color: palette.muted, fontSize: 9, lineHeight: 14, marginTop: 1 },
  amountRow: { flexDirection: 'row', gap: 5, marginTop: 7 },
  amountCell: { flex: 1, minWidth: 0, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 8, backgroundColor: palette.elevated },
  amountLabel: { color: palette.muted, fontSize: 7, fontWeight: '800', letterSpacing: 0.5 },
  amountValue: { color: palette.white, fontSize: 9, fontWeight: '800', marginTop: 2 },
  transitLine: { color: palette.muted, fontSize: 8, marginTop: 6 },
  checkButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#a94b12',
  },
  uncheckButton: { borderWidth: 1, borderColor: '#49301f', backgroundColor: '#241a13' },
  checkButtonText: { color: palette.white, fontSize: 11, fontWeight: '800' },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.6 },
  emptyState: { alignItems: 'center', justifyContent: 'center', minHeight: 150, gap: 8 },
  emptyTitle: { color: palette.white, fontSize: 15, fontWeight: '800' },
  emptyDescription: { color: palette.muted, fontSize: 12, textAlign: 'center' },
  scannerSafeArea: { flex: 1, padding: 16, backgroundColor: '#090909' },
  scannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 15 },
  scannerTitle: { color: palette.white, fontSize: 16, fontWeight: '800' },
  scannerSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { color: palette.white, fontSize: 30, lineHeight: 32 },
  cameraFrame: { flex: 1, minHeight: 260, overflow: 'hidden', borderRadius: 18, backgroundColor: '#000' },
  scanGuide: {
    position: 'absolute',
    top: '40%',
    right: '8%',
    left: '8%',
    height: 100,
    justifyContent: 'center',
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#65d995',
  },
  scanLine: { height: 1, backgroundColor: '#a7f3d0' },
  scannerHelp: { color: palette.muted, fontSize: 11, marginVertical: 14 },
  cancelScanButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#24211f' },
  cancelScanText: { color: palette.white, fontSize: 13, fontWeight: '700' },
  imageBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.92)' },
  imageContainer: { width: '100%', height: '78%', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
  imageCloseButton: { position: 'absolute', top: 24, right: 18, width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: '#292929' },
  imageCloseText: { color: palette.white, fontSize: 28, lineHeight: 32 },
});
