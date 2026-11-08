import { SymbolView } from '@/components/AppSymbol';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import {
  listStatusOrders,
  listStatusRiders,
  lookupStatusOrder,
  STATUS_UPDATE_TARGETS,
  TRANSIT_CITIES,
  sendHandoverTelegramAlbum,
  updateStatusOrders,
  type StatusOrder,
  type StatusRider,
  type StatusUpdateTarget,
  type TransitLeg,
} from '@/lib/order-status';
import { supabase } from '@/lib/supabase';

const palette = {
  background: '#09090b',
  surface: '#151515',
  elevated: '#1c1a18',
  border: '#302820',
  text: '#fafafa',
  muted: '#a1a1aa',
  orange: '#f97316',
  orangeLight: '#ffad70',
  red: '#f87171',
};

const MAX_SELECTED_ORDERS = 40;

const statusColors: Record<string, { background: string; text: string }> = {
  'At Office': { background: '#293241', text: '#e2e8f0' },
  Pending: { background: '#5b4119', text: '#fde68a' },
  'On Way': { background: '#1d4d71', text: '#bae6fd' },
  Delivered: { background: '#1e553f', text: '#bbf7d0' },
  'In-Transit': { background: '#433270', text: '#ddd6fe' },
  Arrived: { background: '#0f5c51', text: '#99f6e4' },
  'Via-Agent': { background: '#5e4a16', text: '#fef3c7' },
  Returned: { background: '#6a372a', text: '#fecaca' },
  'On Hold': { background: '#5c2f19', text: '#fed7aa' },
  Handover: { background: '#34304f', text: '#ddd6fe' },
};

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
    ? date
    : null;
}

function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDateKey(value: string): string {
  const date = parseDateKey(value);
  return date ? date.toLocaleDateString('en-GB') : value;
}

function amount(value: number | string | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? `${parsed.toLocaleString('en-US')} Ks` : '-';
}

function createCommandId(): string {
  return `status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isTransitOutEligible(order: StatusOrder, branch: string): boolean {
  if (!order.receiver_loc) return false;
  if (order.receiver_loc === branch || order.branch === branch) return true;

  const latestTransit = (order.transit ?? []).reduce<TransitLeg | null>(
    (latest, leg) => {
      if (!latest) return leg;
      return (leg.transit_date ?? '') >= (latest.transit_date ?? '') ? leg : latest;
    },
    null,
  );
  return latestTransit?.transit_to === branch;
}

function StatusChip({ status }: { status?: string | null }) {
  const value = status || 'Pending';
  const tone = statusColors[value] ?? statusColors.Pending;
  return (
    <View style={[styles.statusChip, { backgroundColor: tone.background }]}>
      <Text style={[styles.statusChipText, { color: tone.text }]}>{value}</Text>
    </View>
  );
}

function OrderCard({
  order,
  selected,
  onPress,
  transitOutWarning = false,
}: {
  order: StatusOrder;
  selected: boolean;
  onPress: () => void;
  transitOutWarning?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.orderCard,
        selected && styles.orderCardSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.selectionMark, selected && styles.selectionMarkSelected]}>
        {selected ? <Text style={styles.selectionCheck}>✓</Text> : null}
      </View>
      {order.image_url
        ? <Image source={{ uri: order.image_url }} style={styles.orderImage} />
        : (
          <View style={styles.orderImageFallback}>
            <SymbolView name="shippingbox" tintColor={palette.muted} size={21} />
          </View>
        )}
      <View style={styles.orderDetails}>
        <View style={styles.orderHeading}>
          <Text numberOfLines={1} style={styles.orderCode}>{order.barcode || order.item_id || 'Barcode မရှိ'}</Text>
          <StatusChip status={order.status} />
        </View>
        <Text numberOfLines={1} style={styles.orderMetadata}>ITEM ID · {order.item_id || 'မသတ်မှတ်ရသေး'}</Text>
        <Text numberOfLines={1} style={styles.orderPerson}>ပို့သူ · {order.sender_name || 'မသတ်မှတ်ရသေး'}</Text>
        <Text numberOfLines={1} style={styles.orderPerson}>လက်ခံသူ · {order.receiver_name || 'မသတ်မှတ်ရသေး'}</Text>
        <Text numberOfLines={2} style={styles.orderAddress}>{order.receiver_address || 'လက်ခံသူလိပ်စာ မသတ်မှတ်ရသေးပါ'}</Text>
        {transitOutWarning && (
          <Text style={styles.transitOutWarning}>သတိပြုရန် · လက်ခံမည့် branch သည် လက်ရှိ branch နှင့် တူနေပါသည်။</Text>
        )}
        <Text numberOfLines={1} style={styles.orderMetadata}>
          {order.receiver_phone || 'ဖုန်းမရှိ'}{order.deliver_rider?.name ? ` · Rider: ${order.deliver_rider.name}` : ''}
        </Text>
        <View style={styles.amountRow}>
          <Amount label="COD" value={order.cod_amount} />
          <Amount label="DELI FEE" value={order.deli_fee} />
          <Amount label="TOTAL" value={order.total_amount} />
        </View>
      </View>
    </Pressable>
  );
}

function Amount({ label, value }: { label: string; value: StatusOrder['cod_amount'] }) {
  return (
    <View style={styles.amountCell}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.amountValue}>{amount(value)}</Text>
    </View>
  );
}

export default function StatusScreen() {
  const params = useLocalSearchParams<{ arrival?: string; mode?: string }>();
  const arrivalMode = params.arrival === 'true';
  const transitOutMode = params.mode === 'transit-out';
  const presetStatus: StatusUpdateTarget | null = params.mode === 'handover'
    ? 'Handover'
    : params.mode === 'on-hold'
      ? 'On Hold'
      : params.mode === 'returned'
        ? 'Returned'
        : null;
  const presetStatusMode = presetStatus !== null;
  const pageModeLabel = transitOutMode
    ? 'Transit Out'
    : arrivalMode
      ? 'Transit Arrived'
      : presetStatus ?? 'Parcel Status Updater';
  const { user, branch } = useAuth();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLocked = useRef(false);
  const requestVersion = useRef(0);
  const [orders, setOrders] = useState<StatusOrder[]>([]);
  const [riders, setRiders] = useState<StatusRider[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedById, setSelectedById] = useState<Record<string, StatusOrder>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [pendingScan, setPendingScan] = useState<StatusOrder | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<StatusUpdateTarget>(
    presetStatus ?? (transitOutMode ? 'In-Transit' : 'At Office'),
  );
  const [riderId, setRiderId] = useState('');
  const [transitTo, setTransitTo] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [dateDraft, setDateDraft] = useState(new Date());
  const [updating, setUpdating] = useState(false);

  const selectedOrders = useMemo(() => Object.values(selectedById), [selectedById]);
  const selectedIds = useMemo(() => new Set(selectedOrders.map((order) => order.id)), [selectedOrders]);
  const otherOrders = useMemo(
    () => orders.filter((order) => !selectedIds.has(order.id)),
    [orders, selectedIds],
  );

  const loadWorkspace = useCallback(async (term = search) => {
    if (!user || !branch) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const { data, error: sessionError } = await supabase?.auth.getSession() ?? {
        data: { session: null },
        error: new Error('Supabase is not configured.'),
      };
      if (sessionError) throw sessionError;
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('ဝင်ထားသော session မရှိပါ။ ပြန်ဝင်ပါ။');
      const [nextOrders, nextRiders] = await Promise.all([
        listStatusOrders(accessToken, branch, term, arrivalMode, transitOutMode),
        listStatusRiders(accessToken, branch),
      ]);
      if (version !== requestVersion.current) return;
      const visibleOrders = transitOutMode
        ? nextOrders.filter((order) => isTransitOutEligible(order, branch))
        : nextOrders;
      setOrders(visibleOrders);
      setRiders(nextRiders);
    } catch (loadError) {
      if (version !== requestVersion.current) return;
      setError(loadError instanceof Error ? loadError.message : 'ပါဆယ်စာရင်းကို ရယူမရပါ။');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [arrivalMode, branch, search, transitOutMode, user]);

  useEffect(() => {
    if (!user || !branch) return;
    const timer = setTimeout(() => void loadWorkspace(search), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [branch, loadWorkspace, search, user]);

  const toggleOrder = (order: StatusOrder) => {
    setSelectedById((current) => {
      if (current[order.id]) {
        const { [order.id]: _removed, ...remaining } = current;
        return remaining;
      }
      if (Object.keys(current).length >= MAX_SELECTED_ORDERS) {
        Alert.alert('Parcel အများကြီးရွေးထားပါသည်', `တစ်ကြိမ်လျှင် ${MAX_SELECTED_ORDERS} ထုပ်အထိသာ status ပြောင်းနိုင်ပါသည်။`);
        return current;
      }
      return { ...current, [order.id]: order };
    });
  };

  const openScanner = async () => {
    try {
      if (!cameraPermission?.granted) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          Alert.alert('Camera permission လိုအပ်ပါသည်', 'Barcode ဖတ်ရန် Camera permission ကို Allow ပေးပါ။');
          return;
        }
      }
      scanLocked.current = false;
      setPendingScan(null);
      setScannerOpen(true);
    } catch (permissionError) {
      Alert.alert('Camera ဖွင့်မရပါ', permissionError instanceof Error ? permissionError.message : 'Camera permission ကို စစ်ဆေးပါ။');
    }
  };

  const handleScan = async ({ data }: { data: string }) => {
    const code = data.trim();
    if (!code || scanLocked.current || !user || !branch) return;
    scanLocked.current = true;
    setScanLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase?.auth.getSession() ?? {
        data: { session: null },
        error: new Error('Supabase is not configured.'),
      };
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('ဝင်ထားသော session မရှိပါ။ ပြန်ဝင်ပါ။');
      const found = await lookupStatusOrder(accessToken, branch, code, transitOutMode);
      if (!found) {
        scanLocked.current = false;
        Alert.alert('ပါဆယ်ရှာမတွေ့ပါ', `Barcode ${code} သည် ဤ branch ၏ parcel စာရင်းတွင်မရှိပါ။`);
      } else if (transitOutMode) {
        if (!isTransitOutEligible(found, branch)) {
          scanLocked.current = false;
          Alert.alert(
            'Transit Out လုပ်မရပါ',
            'လက်ရှိ branch မှာ လက်ခံထားသော သို့မဟုတ် နောက်ဆုံး transit မှတ်တမ်း၏ Transit To က လက်ရှိ branch ဖြစ်သော parcel ကိုသာ Transit Out လုပ်နိုင်ပါသည်။',
          );
        } else {
          setPendingScan(found);
          if (found.receiver_loc === branch) {
            Alert.alert(
              'သတိပြုရန်',
              'လက်ခံမည့် branch သည် လက်ရှိ branch နှင့် တူနေပါသည်။ Transit Out မလုပ်မီ ပို့မည့်မြို့ကို မှန်ကန်စွာစစ်ဆေးပါ။',
            );
          }
        }
      } else if (
        arrivalMode &&
        (!['In-Transit', 'Via-Agent'].includes(found.status ?? '') ||
          !found.transit?.some((leg) => leg.transit_to === branch))
      ) {
        scanLocked.current = false;
        Alert.alert('Transit-in parcel မဟုတ်ပါ', 'Arrived လုပ်ရန် In-Transit သို့မဟုတ် Via-Agent parcel ကိုသာဖတ်ပေးပါ။');
      } else {
        setPendingScan(found);
      }
    } catch (lookupError) {
      scanLocked.current = false;
      Alert.alert('Barcode စစ်ဆေးမရပါ', lookupError instanceof Error ? lookupError.message : 'Network ကိုစစ်ပြီး ပြန်ဖတ်ပေးပါ။');
    } finally {
      setScanLoading(false);
    }
  };

  const addScannedOrder = () => {
    if (!pendingScan) return;
    if (!selectedById[pendingScan.id] && selectedOrders.length >= MAX_SELECTED_ORDERS) {
      Alert.alert('Parcel အများကြီးရွေးထားပါသည်', `တစ်ကြိမ်လျှင် ${MAX_SELECTED_ORDERS} ထုပ်အထိသာ status ပြောင်းနိုင်ပါသည်။`);
      return;
    }
    setOrders((current) => current.some((item) => item.id === pendingScan.id)
      ? current
      : [pendingScan, ...current]);
    setSelectedById((current) => ({ ...current, [pendingScan.id]: pendingScan }));
    setPendingScan(null);
    scanLocked.current = false;
  };

  const showActionSheet = () => {
    if (!selectedOrders.length) return;
    setTargetStatus(presetStatus ?? (transitOutMode ? 'In-Transit' : arrivalMode ? 'Arrived' : STATUS_UPDATE_TARGETS[0]));
    setRiderId('');
    setTransitTo('');
    setEffectiveDate(today());
    setDatePickerVisible(false);
    setActionOpen(true);
  };

  const openEffectiveDatePicker = () => {
    const value = parseDateKey(effectiveDate) ?? new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        display: 'calendar',
        onValueChange: (_event, selectedDate) => {
          if (selectedDate) setEffectiveDate(toDateKey(selectedDate));
        },
      });
      return;
    }

    setDateDraft(value);
    setDatePickerVisible(true);
  };

  const validateDate = (value: string) => {
    return parseDateKey(value) !== null;
  };

  const applyEffectiveDate = () => {
    setEffectiveDate(toDateKey(dateDraft));
    setDatePickerVisible(false);
  };

  const submitUpdate = async () => {
    if (!user || !branch || !selectedOrders.length) return;
    if (['Handover', 'On Hold', 'Returned'].includes(targetStatus) && !riderId) {
      Alert.alert('Rider ရွေးပေးပါ', 'ရွေးထားသော status အတွက် rider တစ်ဦးရွေးပေးပါ။');
      return;
    }
    if (targetStatus === 'In-Transit' && !transitTo) {
      Alert.alert('မြို့ရွေးပေးပါ', 'In-Transit ပြောင်းရန် transit city ရွေးပေးပါ။');
      return;
    }
    if (!validateDate(effectiveDate)) {
      Alert.alert('ရက်စွဲမှားနေပါသည်', 'ရက်စွဲကို YYYY-MM-DD ပုံစံဖြည့်ပါ။');
      return;
    }
    setUpdating(true);
    try {
      const { data, error: sessionError } = await supabase?.auth.getSession() ?? {
        data: { session: null },
        error: new Error('Supabase is not configured.'),
      };
      if (sessionError) throw sessionError;
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('ဝင်ထားသော session မရှိပါ။ ပြန်ဝင်ပါ။');
      const outcome = await updateStatusOrders({
        accessToken,
        userId: user.id,
        username: user.email?.split('@')[0] || user.id,
        branch,
        orderIds: selectedOrders.map((order) => order.id),
        targetStatus,
        riderId: riderId || undefined,
        transitTo: transitTo || undefined,
        effectiveDate,
        commandId: createCommandId(),
      });
      const failed = outcome.results.filter((result) => !result.ok);
      const updated = new Set(outcome.results.filter((result) => result.ok).map((result) => result.orderId));
      let handoverTelegramMessage = '';
      if (targetStatus === 'Handover' && updated.size > 0) {
        const handoverOrders = selectedOrders.filter((order) => updated.has(order.id));
        const imageUrls = handoverOrders
          .map((order) => order.image_url?.trim())
          .filter((url): url is string => Boolean(url));
        if (!imageUrls.length) {
          handoverTelegramMessage = 'ပုံ URL မရှိသောကြောင့် Telegram သို့ မပို့ခဲ့ပါ။';
        } else {
          try {
            await sendHandoverTelegramAlbum({
              accessToken,
              branch,
              riderName: riders.find((rider) => rider.id === riderId)?.name ?? '',
              wayCount: handoverOrders.length,
              imageUrls,
            });
            handoverTelegramMessage = `Telegram channel သို့ ${imageUrls.length} ပုံ ပို့ပြီးပါပြီ။`;
          } catch (telegramError) {
            handoverTelegramMessage = telegramError instanceof Error
              ? `Status ပြောင်းပြီးပါပြီ၊ Telegram ပို့မရပါ: ${telegramError.message}`
              : 'Status ပြောင်းပြီးပါပြီ၊ Telegram ပို့မရပါ။';
          }
        }
      }
      setSelectedById((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => !updated.has(id)),
      ));
      setActionOpen(false);
      await loadWorkspace(search);
      if (failed.length) {
        Alert.alert(
          'အချို့ parcel များ update မဖြစ်ပါ',
          `${outcome.updatedCount} ခု အောင်မြင်ပြီး ${failed.length} ခု မအောင်မြင်ပါ။\n${failed[0].message ?? ''}${handoverTelegramMessage ? `\n${handoverTelegramMessage}` : ''}`,
          [
            { text: 'နောက်မှလုပ်မည်', style: 'cancel' },
            { text: 'ပြန်ကြိုးစားမည်', onPress: () => void submitUpdate() },
          ],
        );
      } else {
        Alert.alert(
          'အောင်မြင်ပါသည်',
          `${outcome.updatedCount} ထုပ်၏ status ကို ပြောင်းပြီးပါပြီ.${handoverTelegramMessage ? `\n${handoverTelegramMessage}` : ''}`,
        );
      }
    } catch (updateError) {
      Alert.alert('Status update မအောင်မြင်ပါ', updateError instanceof Error ? updateError.message : 'Network ကိုစစ်ပြီး ထပ်ကြိုးစားပါ။');
    } finally {
      setUpdating(false);
    }
  };

  const riderRequired = ['Handover', 'On Hold', 'Returned'].includes(targetStatus);
  const selectedRider = riders.find((rider) => rider.id === riderId);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.headerButton}
        >
          <SymbolView name="chevron.left" tintColor={palette.text} size={17} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>
            {transitOutMode
              ? 'TRANSIT OUT DESK'
              : arrivalMode
                ? 'TRANSIT RECEIVING DESK'
                : presetStatusMode
                  ? `${presetStatus?.toUpperCase()} MODE`
                  : 'BRANCH STATUS DESK'}
          </Text>
          <Text style={styles.heading}>
            {pageModeLabel}
          </Text>
        </View>
        <View style={styles.branchBadge}><Text style={styles.branchBadgeText}>{branch}</Text></View>
      </View>

      <View style={styles.searchSection}>
        <View style={styles.searchField}>
          <SymbolView name="magnifyingglass" tintColor={palette.muted} size={17} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Barcode, Item ID, ဖုန်း သို့အမည်ရှာရန်"
            placeholderTextColor="#77716b"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable accessibilityLabel="Clear search" onPress={() => setSearch('')}>
              <SymbolView name="xmark.circle.fill" tintColor={palette.muted} size={18} />
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void openScanner()}
          style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
        >
          <SymbolView name="barcode.viewfinder" tintColor="#17100a" size={19} />
          <Text style={styles.scanButtonText}>Scan</Text>
        </Pressable>
      </View>

      <View style={styles.listCaption}>
        <Text style={styles.listCaptionTitle}>
          {loading
            ? 'စာရင်းရယူနေပါသည်…'
              : `${pageModeLabel} parcels · ${orders.length}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadWorkspace(search)}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          <SymbolView name="arrow.clockwise" tintColor={palette.orangeLight} size={15} />
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <SymbolView name="wifi.slash" tintColor="#fcd34d" size={17} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadWorkspace(search)}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={palette.orange} />
            <Text style={styles.emptyText}>ပါဆယ်စာရင်းကို ရယူနေပါသည်…</Text>
          </View>
        ) : orders.length ? (
          <>
            {selectedOrders.length > 0 && (
              <View style={styles.selectedGroup}>
                <View style={styles.sectionHeading}>
                  <View>
                    <Text style={styles.selectedTitle}>ရွေးထားသော Parcel များ</Text>
                    <Text style={styles.sectionSubtitle}>Status ပြောင်းရန် အသင့် · {selectedOrders.length} ထုပ်</Text>
                  </View>
                  <SymbolView name="checkmark.circle.fill" tintColor={palette.orange} size={21} />
                </View>
                {selectedOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    selected
                    transitOutWarning={transitOutMode && order.receiver_loc === branch}
                    onPress={() => toggleOrder(order)}
                  />
                ))}
              </View>
            )}
            {otherOrders.length > 0 && (
              <View style={styles.otherGroup}>
                <Text style={styles.groupTitle}>{selectedOrders.length ? 'အခြား Active Parcels' : 'Active Parcels'}</Text>
                {otherOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    selected={false}
                    transitOutWarning={transitOutMode && order.receiver_loc === branch}
                    onPress={() => toggleOrder(order)}
                  />
                ))}
              </View>
            )}
          </>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <SymbolView name="shippingbox" tintColor={palette.muted} size={24} />
            </View>
            <Text style={styles.emptyTitle}>
              {transitOutMode ? 'Transit Out လုပ်နိုင်သော parcel မတွေ့ပါ' : 'Active parcel မတွေ့ပါ'}
            </Text>
            <Text style={styles.emptyText}>
              {transitOutMode
                ? 'Barcode scan လုပ်ပါ သို့မဟုတ် search box မှရှာပါ။'
                : 'အခြား parcel များကို Barcode scan လုပ်ပါ သို့မဟုတ် search box မှရှာပါ။'}
            </Text>
          </View>
        )}
      </ScrollView>

      {selectedOrders.length > 0 && (
        <View style={styles.selectionBar}>
          <View style={styles.selectionCopy}>
            <Text style={styles.selectionCount}>{selectedOrders.length} ထုပ် ရွေးထားပါသည်</Text>
            <Text numberOfLines={1} style={styles.selectionSubtext}>
              {selectedOrders.map((order) => order.barcode || order.item_id || '-').join(' · ')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={showActionSheet}
            style={({ pressed }) => [styles.updateButton, pressed && styles.pressed]}
          >
            <Text style={styles.updateButtonText}>
              {transitOutMode ? 'Transit Out လုပ်မည်' : arrivalMode ? 'Arrived လုပ်မည်' : 'Status ပြင်မည်'}
            </Text>
            <SymbolView name="arrow.right" tintColor="#17100a" size={15} />
          </Pressable>
        </View>
      )}

      <Modal
        transparent
        visible={scannerOpen}
        animationType="fade"
        onRequestClose={() => {
          scanLocked.current = false;
          setScannerOpen(false);
          setPendingScan(null);
        }}
      >
        <View style={styles.scannerModal}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>{arrivalMode ? 'Transit-in barcode ဖတ်ရန်' : 'Parcel barcode ဖတ်ရန်'}</Text>
            <Pressable
              accessibilityLabel="Close scanner"
              onPress={() => {
                scanLocked.current = false;
                setScannerOpen(false);
                setPendingScan(null);
              }}
              style={styles.headerButton}
            >
              <SymbolView name="xmark" tintColor={palette.text} size={17} />
            </Pressable>
          </View>
          <View style={styles.scannerViewport}>
            {cameraPermission?.granted && !scanLoading && !pendingScan
              ? (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'pdf417'],
                  }}
                  onBarcodeScanned={pendingScan || scanLoading ? undefined : handleScan}
                />
              )
              : !cameraPermission?.granted
                ? <View style={styles.cameraPermission}><Text style={styles.emptyText}>Camera permission လိုအပ်ပါသည်။</Text></View>
                : <View style={styles.cameraPermission}><ActivityIndicator color={palette.orange} /></View>}
            <View pointerEvents="none" style={styles.scanReticle}>
              <View style={[styles.scanCorner, styles.topLeft]} />
              <View style={[styles.scanCorner, styles.topRight]} />
              <View style={[styles.scanCorner, styles.bottomLeft]} />
              <View style={[styles.scanCorner, styles.bottomRight]} />
            </View>
          </View>
          <Text style={styles.scannerHint}>
            {pendingScan
              ? 'Parcel အချက်အလက်ကို အတည်ပြုပါ။'
              : scanLoading
                ? 'Barcode စစ်ဆေးနေပါသည်…'
                : transitOutMode
                  ? 'Transit Out လုပ်မည့် ပါဆယ် barcode ကို ဖတ်ပါ။'
                  : 'ပါဆယ်ပေါ်ရှိ barcode ကို ဘောင်အတွင်းချိန်ပါ။'}
          </Text>
          <Text style={styles.scannerSelectionCount}>
            ရွေးထားသော ပါဆယ် · {selectedOrders.length} ထုပ်
          </Text>
          {pendingScan && (
            <View style={styles.scanConfirmOverlay}>
              <View style={styles.scanConfirmCard}>
                <View style={styles.scanConfirmRow}>
                  {pendingScan.image_url
                    ? <Image source={{ uri: pendingScan.image_url }} style={styles.scanConfirmImage} />
                    : <View style={[styles.scanConfirmImage, styles.orderImageFallback]}><SymbolView name="shippingbox" tintColor={palette.muted} size={22} /></View>}
                  <View style={styles.scanConfirmCopy}>
                    <Text style={styles.scanConfirmCode}>{pendingScan.barcode || pendingScan.item_id || 'Barcode မရှိ'}</Text>
                    <Text style={styles.orderPerson}>{pendingScan.receiver_name || 'လက်ခံသူအမည်မရှိ'}</Text>
                    <Text style={styles.orderMetadata}>{pendingScan.receiver_phone || 'ဖုန်းမရှိ'}</Text>
                    <StatusChip status={pendingScan.status} />
                  </View>
                </View>
                <View style={styles.scanConfirmActions}>
                  <Pressable
                    onPress={() => {
                      setPendingScan(null);
                      scanLocked.current = false;
                    }}
                    style={styles.cancelButton}
                  >
                    <Text style={styles.cancelButtonText}>ပြန်ဖတ်မည်</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add parcel to list and scan another"
                    onPress={addScannedOrder}
                    style={styles.confirmButton}
                  >
                    <Text style={styles.confirmButtonText}>
                      {arrivalMode
                        ? 'Arrived အဖြစ်ရွေးပြီး ဆက်ဖတ်မည်'
                        : transitOutMode
                          ? 'Transit Out အဖြစ်ရွေးပြီး ဆက်ဖတ်မည်'
                          : 'စာရင်းထည့်ပြီး ဆက်ဖတ်မည်'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <Modal
        transparent
        visible={actionOpen}
        animationType="slide"
        onRequestClose={() => {
          if (!updating) setActionOpen(false);
        }}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !updating && setActionOpen(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.sheetAvoider}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.eyebrow}>                  {transitOutMode ? 'TRANSIT OUT' : presetStatusMode ? `${presetStatus?.toUpperCase()} MODE` : 'BULK STATUS UPDATE'}</Text>
                  <Text style={styles.sheetTitle}>{selectedOrders.length} ထုပ်ကိုပြင်မည်</Text>
                </View>
                <Pressable disabled={updating} onPress={() => setActionOpen(false)} style={styles.sheetClose}>
                  <SymbolView name="xmark" tintColor={palette.text} size={16} />
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.sheetContent}
                showsVerticalScrollIndicator={false}
              >
                {transitOutMode ? (
                  <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>Transit Out · In-Transit</Text>
                    <Text style={styles.noticeText}>မြို့ရွေးပြီး ရက်စွဲသတ်မှတ်ကာ ရွေးထားသော parcel များကို ပို့ဆောင်ရန် မှတ်တမ်းတင်ပါမည်။</Text>
                  </View>
                ) : presetStatusMode ? (
                  <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>{presetStatus} Mode</Text>
                    <Text style={styles.noticeText}>ရွေးထားသော parcel များ၏ status ကို {presetStatus} အဖြစ် သတ်မှတ်ပါမည်။</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>1. Update status</Text>
                    <View style={styles.statusGrid}>
                      {(arrivalMode ? ['Arrived'] as StatusUpdateTarget[] : STATUS_UPDATE_TARGETS.filter((status) => status !== 'Arrived')).map((status) => (
                        <Pressable
                          key={status}
                          accessibilityRole="button"
                          accessibilityState={{ selected: targetStatus === status }}
                          onPress={() => setTargetStatus(status)}
                          style={[styles.statusOption, targetStatus === status && styles.statusOptionSelected]}
                        >
                          <Text style={[styles.statusOptionText, targetStatus === status && styles.statusOptionTextSelected]}>{status}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
                {targetStatus === 'At Office' && (
                  <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>Rider ပြန်ယူလာသော parcel</Text>
                    <Text style={styles.noticeText}>Rider assignment ကိုဖယ်ရှားပြီး At Office အဖြစ် history ထဲတွင် မှတ်တမ်းတင်ပါမည်။</Text>
                  </View>
                )}
                {targetStatus === 'Arrived' && (
                  <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>Transit-in parcel လက်ခံခြင်း</Text>
                    <Text style={styles.noticeText}>ဤ branch သို့ လွှဲပေးလာသော parcel ကို Arrived နှင့် arrival date ဖြင့် မှတ်တမ်းတင်ပါမည်။</Text>
                  </View>
                )}
                {riderRequired && (
                  <>
                    <Text style={styles.fieldLabel}>{targetStatus === 'Returned' ? '2. OS return rider' : '2. Deliver rider'}</Text>
                    {riders.length ? riders.map((rider) => (
                      <Pressable
                        key={rider.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: rider.id === riderId }}
                        onPress={() => setRiderId(rider.id)}
                        style={[styles.riderOption, rider.id === riderId && styles.riderOptionSelected]}
                      >
                        <View style={[styles.radio, rider.id === riderId && styles.radioSelected]} />
                        <Text style={styles.riderName}>{rider.name}</Text>
                      </Pressable>
                    )) : <Text style={styles.helperText}>ဤ branch အတွက် rider မတွေ့ပါ။</Text>}
                  </>
                )}
                {targetStatus === 'In-Transit' && (
                  <>
                    <Text style={styles.fieldLabel}>{transitOutMode ? '1. ပို့မည့် မြို့နယ်' : '2. Transit city'}</Text>
                    <View style={styles.cityGrid}>
                      {TRANSIT_CITIES.map((city) => (
                        <Pressable
                          key={city.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: city.id === transitTo }}
                          onPress={() => setTransitTo(city.id)}
                          style={[styles.cityOption, city.id === transitTo && styles.cityOptionSelected]}
                        >
                          <Text style={[styles.cityText, city.id === transitTo && styles.cityTextSelected]}>{city.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {transitTo && !['YGN', 'MDY'].includes(transitTo) && (
                      <Text style={styles.helperText}>ဤမြို့သို့ Via-Agent အဖြစ် မှတ်တမ်းတင်ပါမည်။</Text>
                    )}
                  </>
                )}
                {targetStatus === 'Returned' && (
                  <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>OS သို့ပြန်ပို့မည်</Text>
                    <Text style={styles.noticeText}>{selectedRider?.name || 'ရွေးထားသော rider'} ကို history နှင့် deliver_rider_id ထဲမှတ်တမ်းတင်ပါမည်။</Text>
                  </View>
                )}
                <Text style={styles.fieldLabel}>
                  {transitOutMode ? '2' : riderRequired || targetStatus === 'In-Transit' ? '3' : '2'}. Effective date
                </Text>
                {Platform.OS === 'web' ? (
                  <TextInput
                    accessibilityLabel="Effective date"
                    value={effectiveDate}
                    onChangeText={setEffectiveDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#77716b"
                    keyboardType="numbers-and-punctuation"
                    style={styles.dateInput}
                  />
                ) : (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Effective date ${formatDateKey(effectiveDate)}`}
                      accessibilityHint="Open date picker"
                      onPress={openEffectiveDatePicker}
                      style={({ pressed }) => [styles.dateInputButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.dateInputText}>{formatDateKey(effectiveDate)}</Text>
                      <SymbolView name="calendar" tintColor={palette.orangeLight} size={15} />
                    </Pressable>
                    {Platform.OS === 'ios' && datePickerVisible && (
                      <View style={styles.datePickerPanel}>
                        <DateTimePicker
                          value={dateDraft}
                          mode="date"
                          display="spinner"
                          themeVariant="dark"
                          onValueChange={(_event, selectedDate) => setDateDraft(selectedDate)}
                          style={styles.iosDatePicker}
                        />
                        <View style={styles.datePickerActions}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setDatePickerVisible(false)}
                            style={styles.datePickerCancel}
                          >
                            <Text style={styles.datePickerCancelText}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={applyEffectiveDate}
                            style={styles.datePickerApply}
                          >
                            <Text style={styles.datePickerApplyText}>Set date</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </>
                )}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                disabled={updating}
                onPress={() => void submitUpdate()}
                style={[styles.submitButton, updating && styles.disabled]}
              >
                {updating
                  ? <ActivityIndicator color="#17100a" />
                  : <Text style={styles.submitButtonText}>
                    {transitOutMode
                      ? 'Transit Out အတည်ပြုမည်'
                      : targetStatus === 'Arrived'
                        ? 'Arrived အဖြစ်လက်ခံမှတ်တမ်းတင်မည်'
                        : targetStatus === 'At Office'
                          ? 'At Office အဖြစ်မှတ်တမ်းတင်မည်'
                          : presetStatusMode
                            ? `${presetStatus} အဖြစ် အတည်ပြုမည်`
                            : 'Status Update အတည်ပြုမည်'}
                    </Text>}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: '#24211f' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  headerCopy: { flex: 1 },
  eyebrow: { color: palette.orangeLight, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  heading: { color: palette.text, fontSize: 16, fontWeight: '800', marginTop: 3 },
  branchBadge: { minWidth: 44, height: 29, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, borderRadius: 15, backgroundColor: '#2b1b10', borderWidth: 1, borderColor: '#49301f' },
  branchBadgeText: { color: palette.orangeLight, fontSize: 10, fontWeight: '900' },
  searchSection: { flexDirection: 'row', gap: 9, paddingHorizontal: 15, paddingVertical: 12 },
  searchField: { height: 44, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  searchInput: { flex: 1, minWidth: 0, color: palette.text, fontSize: 12, paddingVertical: 0 },
  scanButton: { minWidth: 72, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, borderRadius: 15, backgroundColor: palette.orange },
  scanButtonText: { color: '#17100a', fontSize: 11, fontWeight: '900' },
  listCaption: { minHeight: 33, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 17 },
  listCaptionTitle: { color: '#c4bdb6', fontSize: 10, fontWeight: '700' },
  refreshButton: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 6 },
  refreshText: { color: palette.orangeLight, fontSize: 10, fontWeight: '800' },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 15, marginBottom: 8, padding: 11, borderRadius: 14, backgroundColor: '#241c0d', borderWidth: 1, borderColor: '#4a3515' },
  errorText: { flex: 1, color: '#fcd34d', fontSize: 10, lineHeight: 15 },
  retryText: { color: palette.orangeLight, fontSize: 10, fontWeight: '900' },
  listContent: { flexGrow: 1, gap: 13, paddingHorizontal: 14, paddingTop: 5, paddingBottom: 28 },
  selectedGroup: { gap: 8 },
  otherGroup: { gap: 8 },
  sectionHeading: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3 },
  selectedTitle: { color: palette.orangeLight, fontSize: 12, fontWeight: '900' },
  sectionSubtitle: { color: palette.muted, fontSize: 9, marginTop: 3 },
  groupTitle: { color: palette.muted, fontSize: 10, fontWeight: '800', marginHorizontal: 3, marginTop: 4 },
  orderCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 9, borderRadius: 20, backgroundColor: palette.surface, borderWidth: 1, borderColor: '#292522' },
  orderCardSelected: { backgroundColor: '#20170f', borderColor: '#754319' },
  selectionMark: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center', marginTop: 3, borderRadius: 11, borderWidth: 1.5, borderColor: '#77716b' },
  selectionMarkSelected: { backgroundColor: palette.orange, borderColor: palette.orange },
  selectionCheck: { color: '#17100a', fontSize: 13, lineHeight: 16, fontWeight: '900' },
  orderImage: { width: 53, height: 70, borderRadius: 12, backgroundColor: '#222' },
  orderImageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#222' },
  orderDetails: { flex: 1, minWidth: 0, gap: 4 },
  orderHeading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  orderCode: { flex: 1, color: palette.text, fontSize: 11, fontWeight: '900' },
  statusChip: { maxWidth: 92, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 9 },
  statusChipText: { fontSize: 7, fontWeight: '900' },
  orderMetadata: { color: '#b89d7e', fontSize: 8, fontWeight: '700' },
  orderPerson: { color: '#d7d1ca', fontSize: 9, fontWeight: '700' },
  orderAddress: { color: palette.muted, fontSize: 8, lineHeight: 12 },
  transitOutWarning: { color: '#fbbf24', fontSize: 8, fontWeight: '800' },
  amountRow: { flexDirection: 'row', gap: 5, marginTop: 2 },
  amountCell: { minWidth: 0, flex: 1, paddingHorizontal: 6, paddingVertical: 5, borderRadius: 9, backgroundColor: '#0d0d0d' },
  amountLabel: { color: '#8e8984', fontSize: 6, fontWeight: '900', letterSpacing: 0.4 },
  amountValue: { color: palette.orangeLight, fontSize: 8, fontWeight: '800', marginTop: 2 },
  emptyState: { flex: 1, minHeight: 250, alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 28 },
  emptyIcon: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: '#1d1a17' },
  emptyTitle: { color: palette.text, fontSize: 14, fontWeight: '900' },
  emptyText: { color: palette.muted, fontSize: 10, textAlign: 'center', lineHeight: 15 },
  selectionBar: { position: 'absolute', right: 12, bottom: 12, left: 12, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 17, backgroundColor: '#21180f', borderWidth: 1, borderColor: '#62401e', elevation: 8 },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionCount: { color: '#ffd08a', fontSize: 10, fontWeight: '900' },
  selectionSubtext: { color: '#b7aa9c', fontSize: 8, marginTop: 3 },
  updateButton: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: palette.orange },
  updateButtonText: { color: '#17100a', fontSize: 10, fontWeight: '900' },
  scannerModal: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: '#050505' },
  scannerHeader: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  scannerTitle: { color: palette.text, fontSize: 14, fontWeight: '900' },
  scannerViewport: { height: '52%', overflow: 'hidden', borderRadius: 21, backgroundColor: '#141414' },
  cameraPermission: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanReticle: { position: 'absolute', top: '24%', right: '12%', bottom: '24%', left: '12%' },
  scanCorner: { position: 'absolute', width: 30, height: 30, borderColor: palette.orangeLight },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  bottomRight: { right: 0, bottom: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  scannerHint: { color: '#d6d3d1', fontSize: 10, textAlign: 'center', lineHeight: 16, paddingHorizontal: 16, paddingVertical: 13 },
  scannerSelectionCount: { color: palette.orangeLight, fontSize: 12, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  scanConfirmOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1, justifyContent: 'center', paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.72)' },
  scanConfirmCard: { gap: 12, padding: 13, borderRadius: 18, backgroundColor: palette.elevated, borderWidth: 1, borderColor: '#62401e' },
  scanConfirmRow: { flexDirection: 'row', gap: 11 },
  scanConfirmImage: { width: 70, height: 88, borderRadius: 12 },
  scanConfirmCopy: { flex: 1, gap: 6 },
  scanConfirmCode: { color: palette.text, fontSize: 12, fontWeight: '900' },
  scanConfirmActions: { flexDirection: 'row', gap: 9 },
  cancelButton: { minHeight: 42, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: '#151515' },
  cancelButtonText: { color: palette.text, fontSize: 10, fontWeight: '800' },
  confirmButton: { minHeight: 42, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.orange },
  confirmButtonText: { color: '#17100a', fontSize: 10, fontWeight: '900' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)' },
  sheetAvoider: { maxHeight: '92%' },
  sheet: { maxHeight: '92%', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#141210', borderWidth: 1, borderColor: palette.border },
  sheetHandle: { width: 38, height: 4, alignSelf: 'center', marginBottom: 12, borderRadius: 2, backgroundColor: '#55504b' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { color: palette.text, fontSize: 15, fontWeight: '900', marginTop: 3 },
  sheetClose: { width: 33, height: 33, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#252321' },
  sheetContent: { gap: 7, paddingBottom: 10 },
  fieldLabel: { color: '#d1c9c0', fontSize: 10, fontWeight: '900', marginTop: 9, marginBottom: 2 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  statusOption: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, borderRadius: 12, backgroundColor: '#090909', borderWidth: 1, borderColor: '#302e2b' },
  statusOptionSelected: { backgroundColor: '#34200f', borderColor: palette.orange },
  statusOptionText: { color: '#c1b8af', fontSize: 9, fontWeight: '800' },
  statusOptionTextSelected: { color: palette.orangeLight },
  notice: { padding: 10, borderRadius: 13, backgroundColor: '#211a10', borderWidth: 1, borderColor: '#45331d' },
  noticeTitle: { color: '#f5cd82', fontSize: 10, fontWeight: '900' },
  noticeText: { color: '#c2b7a9', fontSize: 9, lineHeight: 14, marginTop: 4 },
  riderOption: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, borderRadius: 11, backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#292522' },
  riderOptionSelected: { borderColor: palette.orange, backgroundColor: '#21170f' },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: '#8c8278' },
  radioSelected: { borderWidth: 5, borderColor: palette.orangeLight },
  riderName: { color: palette.text, fontSize: 10, fontWeight: '700' },
  helperText: { color: palette.muted, fontSize: 9, lineHeight: 14 },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cityOption: { minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, borderRadius: 10, backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#302e2b' },
  cityOptionSelected: { backgroundColor: '#34200f', borderColor: palette.orange },
  cityText: { color: '#c1b8af', fontSize: 9, fontWeight: '700' },
  cityTextSelected: { color: palette.orangeLight },
  dateInput: { minHeight: 40, paddingHorizontal: 11, borderRadius: 12, color: palette.text, backgroundColor: '#090909', borderWidth: 1, borderColor: '#302e2b', fontSize: 11 },
  dateInputButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 11, borderRadius: 12, backgroundColor: '#090909', borderWidth: 1, borderColor: '#302e2b' },
  dateInputText: { color: palette.text, fontSize: 11 },
  datePickerPanel: { padding: 8, borderRadius: 12, backgroundColor: '#090909', borderWidth: 1, borderColor: '#302e2b' },
  iosDatePicker: { alignSelf: 'center', width: '100%', height: 170 },
  datePickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  datePickerCancel: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12 },
  datePickerCancelText: { color: palette.muted, fontSize: 10, fontWeight: '800' },
  datePickerApply: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: palette.orange },
  datePickerApplyText: { color: '#17100a', fontSize: 10, fontWeight: '900' },
  submitButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: palette.orange },
  submitButtonText: { color: '#17100a', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
