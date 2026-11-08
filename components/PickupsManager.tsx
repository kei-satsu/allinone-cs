import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { supabase, supabaseConfigError } from '@/lib/supabase';

type PickupStatus = 'Pending' | 'Assigned' | 'Picked Up' | 'Completed';
type Branch = 'MDY' | 'YGN';
type StatusFilter = PickupStatus | 'All';
type ModalMode = 'add' | 'edit' | 'assign' | 'complete' | 'delete' | 'note' | null;
type PickerMode = 'sender' | 'rider' | 'status' | null;

type Sender = {
  id: number;
  name: string;
  Address?: string | null;
  address?: string | null;
  phone?: string | null;
};

type Rider = {
  id: string | number;
  name: string;
};

type ManualSender = {
  isManual: true;
  name: string;
  phone: string;
  address: string;
  note: string;
};

type Pickup = {
  id: number;
  branch: Branch | null;
  sender_id: number;
  rider_id: string | number | null;
  status: PickupStatus;
  quantity: number;
  note: string | null;
  created_at: string;
  sender: Sender;
  rider: Rider | null;
  manualSender: ManualSender | null;
};

type PickupSection = {
  title: string;
  data: Pickup[];
};

type PickupForm = {
  senderId: string;
  manualName: string;
  manualPhone: string;
  manualAddress: string;
  riderId: string;
  quantity: string;
  note: string;
  status: PickupStatus;
};

const statuses: PickupStatus[] = ['Pending', 'Assigned', 'Picked Up', 'Completed'];
const filters: StatusFilter[] = ['All', ...statuses];
const manualTag = '[MANUAL_SENDER]';
const emptyForm: PickupForm = {
  senderId: '',
  manualName: '',
  manualPhone: '',
  manualAddress: '',
  riderId: '',
  quantity: '1',
  note: '',
  status: 'Pending',
};

function getDateKey(createdAt: string) {
  const date = new Date(createdAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

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

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function encodeManualSenderNote(sender: ManualSender) {
  return `${manualTag}${JSON.stringify({
    m: true,
    n: sender.name.trim(),
    p: sender.phone.trim(),
    a: sender.address.trim(),
    rem: sender.note.trim(),
  })}`;
}

function parseManualSender(note: string | null | undefined) {
  if (!note?.includes(manualTag)) return { manual: null, cleanNote: note ?? '' };

  try {
    const parsed: unknown = JSON.parse(note.slice(note.indexOf(manualTag) + manualTag.length).trim());
    if (typeof parsed === 'object' && parsed !== null && 'm' in parsed && parsed.m === true) {
      const value = parsed as { n?: unknown; p?: unknown; a?: unknown; rem?: unknown };
      const manual: ManualSender = {
        isManual: true,
        name: typeof value.n === 'string' ? value.n : 'Manual Sender',
        phone: typeof value.p === 'string' ? value.p : '',
        address: typeof value.a === 'string' ? value.a : '',
        note: typeof value.rem === 'string' ? value.rem : '',
      };
      return { manual, cleanNote: manual.note };
    }
  } catch {
    return { manual: null, cleanNote: note };
  }

  return { manual: null, cleanNote: note };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'တစ်ခုခု မှားယွင်းနေပါသည်။ ထပ်မံကြိုးစားပါ။';
}

function getAddress(sender: Sender) {
  return sender.Address || sender.address || 'လိပ်စာမရှိပါ';
}

function statusColors(status: PickupStatus) {
  switch (status) {
    case 'Pending':
      return { background: '#3a2815', border: '#68451f', text: '#ffc36f' };
    case 'Assigned':
      return { background: '#172b3b', border: '#284968', text: '#8dcaff' };
    case 'Picked Up':
      return { background: '#30243c', border: '#594271', text: '#d0a9ff' };
    case 'Completed':
      return { background: '#183128', border: '#2d5c48', text: '#8fe0b5' };
  }
}

export function PickupsManager() {
  const { branch } = useAuth();
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [senderError, setSenderError] = useState('');
  const [riderError, setRiderError] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('Pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [senderSearchQuery, setSenderSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [dateField, setDateField] = useState<'from' | 'to' | null>(null);
  const [dateDraft, setDateDraft] = useState(new Date());
  const [mode, setMode] = useState<ModalMode>(null);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [senderMode, setSenderMode] = useState<'list' | 'manual'>('list');
  const [selectedPickup, setSelectedPickup] = useState<Pickup | null>(null);
  const [form, setForm] = useState<PickupForm>(emptyForm);
  const [assignRiderId, setAssignRiderId] = useState('');
  const [completeQuantity, setCompleteQuantity] = useState('1');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (!supabase) {
      setLoadError(supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError('');

    try {
      const [pickupResult, senderResult, riderResult] = await Promise.all([
        supabase
          .from('pickups')
          .select('*')
          .or(`branch.eq.${branch},branch.is.null`)
          .order('created_at', { ascending: false }),
        supabase.from('senders').select('*').order('name'),
        supabase.from('riders').select('*').eq('branch', branch).order('name'),
      ]);

      const senderRows = (senderResult.data ?? []) as Sender[];
      const riderRows = (riderResult.data ?? []) as Rider[];
      const senderMap = new Map(senderRows.map((sender) => [sender.id, sender]));
      const riderMap = new Map(riderRows.map((rider) => [String(rider.id), rider]));
      const pickupRows = (pickupResult.data ?? []) as Omit<Pickup, 'sender' | 'rider' | 'manualSender'>[];

      if (senderResult.error) {
        const message = getErrorMessage(senderResult.error);
        setSenderError(message);
        console.error('Unable to load senders:', message);
      } else {
        setSenderError('');
        setSenders(senderRows);
      }

      if (riderResult.error) {
        const message = getErrorMessage(riderResult.error);
        setRiderError(message);
        console.error(`Unable to load ${branch} riders:`, message);
      } else {
        setRiderError('');
        setRiders(riderRows);
      }

      if (pickupResult.error) {
        const message = getErrorMessage(pickupResult.error);
        setLoadError(message);
        console.error('Unable to load pickups:', message);
      } else {
        setLoadError('');
        setPickups(
          pickupRows.map((pickup) => {
            const { manual } = parseManualSender(pickup.note);
            const sender = manual
              ? {
                  id: pickup.sender_id,
                  name: manual.name,
                  phone: manual.phone,
                  Address: manual.address,
                  address: manual.address,
                }
              : senderMap.get(pickup.sender_id) ?? {
                  id: pickup.sender_id,
                  name: 'Unknown Sender',
                  Address: 'လိပ်စာမရှိပါ',
                };

            return {
              ...pickup,
              sender,
              rider: pickup.rider_id === null ? null : riderMap.get(String(pickup.rider_id)) ?? null,
              manualSender: manual,
            };
          }),
        );
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setLoadError(message);
      console.error('Unable to load pickup management data:', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branch]);

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
  }, [loadData]);

  const updateDateFilter = (field: 'from' | 'to', date: Date) => {
    const dateKey = toDateKey(date);
    if (field === 'from') setDateFrom(dateKey);
    else setDateTo(dateKey);
  };

  const openDatePicker = (field: 'from' | 'to') => {
    const currentValue = field === 'from' ? dateFrom : dateTo;
    const value = parseDateKey(currentValue) ?? new Date();
    const minimumDate = field === 'to' ? parseDateKey(dateFrom) ?? undefined : undefined;
    const maximumDate = field === 'from' ? parseDateKey(dateTo) ?? undefined : undefined;

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        display: 'calendar',
        minimumDate,
        maximumDate,
        onValueChange: (_event, selectedDate) => {
          if (selectedDate) updateDateFilter(field, selectedDate);
        },
      });
      return;
    }

    if (Platform.OS === 'ios') {
      setDateDraft(value);
      setDateField(field);
    }
  };

  const applyDateDraft = () => {
    if (dateField) updateDateFilter(dateField, dateDraft);
    setDateField(null);
  };

  const filteredPickups = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return pickups.filter((pickup) => {
      if (activeFilter !== 'All' && pickup.status !== activeFilter) return false;

      const dateKey = getDateKey(pickup.created_at);
      if (dateFrom && dateKey < dateFrom) return false;
      if (dateTo && dateKey > dateTo) return false;
      if (!query) return true;

      const { cleanNote } = parseManualSender(pickup.note);
      return [
        pickup.sender.name,
        getAddress(pickup.sender),
        pickup.sender.phone ?? '',
        pickup.rider?.name ?? '',
        cleanNote,
      ].some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [activeFilter, dateFrom, dateTo, pickups, searchQuery]);

  const sections = useMemo<PickupSection[]>(() => {
    const grouped = new Map<string, Pickup[]>();
    filteredPickups.forEach((pickup) => {
      const date = getDateKey(pickup.created_at);
      const group = grouped.get(date) ?? [];
      group.push(pickup);
      grouped.set(date, group);
    });
    return Array.from(grouped, ([date, data]) => ({ title: date, data }));
  }, [filteredPickups]);

  const openAdd = () => {
    setSelectedPickup(null);
    setSenderMode('list');
    setForm(emptyForm);
    setMode('add');
  };

  const openEdit = (pickup: Pickup) => {
    setSelectedPickup(pickup);
    setSenderMode(pickup.manualSender ? 'manual' : 'list');
    setForm({
      senderId: String(pickup.sender_id),
      manualName: pickup.manualSender?.name ?? '',
      manualPhone: pickup.manualSender?.phone ?? '',
      manualAddress: pickup.manualSender?.address ?? '',
      riderId: pickup.rider_id === null ? '' : String(pickup.rider_id),
      quantity: String(pickup.quantity),
      note: parseManualSender(pickup.note).cleanNote,
      status: pickup.status,
    });
    setMode('edit');
  };

  const getManualSenderId = async () => {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။');

    const { data: existing, error: lookupError } = await supabase
      .from('senders')
      .select('id')
      .eq('name', 'Manual Sender')
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.id) return Number(existing.id);

    const { data: created, error: createError } = await supabase
      .from('senders')
      .insert({ name: 'Manual Sender', LOC: 'SYSTEM', phone: '-', Address: '-' })
      .select('id')
      .single();
    if (createError) throw createError;
    if (!created?.id) throw new Error('Manual Sender ကို ဖန်တီးမရပါ။');
    return Number(created.id);
  };

  const closeModal = () => {
    if (saving) return;
    setMode(null);
    setPicker(null);
    setSelectedPickup(null);
  };

  const submitForm = async () => {
    if (!supabase || saving) return;
    const quantity = mode === 'edit' ? Number(form.quantity) : 1;
    if (mode === 'edit' && (!Number.isInteger(quantity) || quantity < 1)) {
      Alert.alert('အရေအတွက် မမှန်ပါ', 'အရေအတွက်ကို ၁ ခုနှင့်အထက် ထည့်ပါ။');
      return;
    }
    if (senderMode === 'list' && !form.senderId) {
      Alert.alert('Sender ရွေးချယ်ပါ', 'Pickup အတွက် Sender တစ်ဦး ရွေးချယ်ပါ။');
      return;
    }
    if (senderMode === 'manual' && !form.manualName.trim()) {
      Alert.alert('Sender အမည် လိုအပ်ပါသည်', 'Sender အမည်ကို ရိုက်ထည့်ပါ။');
      return;
    }

    setSaving(true);
    try {
      const senderId = senderMode === 'manual' ? await getManualSenderId() : Number(form.senderId);
      const note = senderMode === 'manual'
        ? encodeManualSenderNote({
            isManual: true,
            name: form.manualName,
            phone: form.manualPhone,
            address: form.manualAddress,
            note: form.note,
          })
        : form.note.trim() || null;
      const values = {
        sender_id: senderId,
        rider_id: form.riderId || null,
        quantity,
        status: mode === 'add' && form.riderId ? 'Assigned' : form.status,
        note,
      };

      const result = mode === 'edit' && selectedPickup
        ? await supabase.from('pickups').update(values).eq('id', selectedPickup.id)
        : await supabase.from('pickups').insert({
            ...values,
            branch,
            status: form.riderId ? 'Assigned' : 'Pending',
          });
      if (result.error) throw result.error;

      setMode(null);
      setSelectedPickup(null);
      await loadData(true);
    } catch (error) {
      Alert.alert('သိမ်းဆည်းမရပါ', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const assignRider = async () => {
    if (!supabase || !selectedPickup || !assignRiderId || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('pickups')
        .update({ rider_id: assignRiderId, status: 'Assigned' })
        .eq('id', selectedPickup.id);
      if (error) throw error;
      setMode(null);
      setSelectedPickup(null);
      await loadData(true);
    } catch (error) {
      Alert.alert('Rider သတ်မှတ်မရပါ', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const completePickup = async () => {
    if (!supabase || !selectedPickup || saving) return;
    const quantity = Number(completeQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      Alert.alert('အရေအတွက် မမှန်ပါ', 'သိမ်းယူခဲ့သည့် အရေအတွက်ကို ၁ ခုနှင့်အထက် ထည့်ပါ။');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('pickups')
        .update({ quantity, status: 'Completed' })
        .eq('id', selectedPickup.id);
      if (error) throw error;
      setMode(null);
      setSelectedPickup(null);
      await loadData(true);
    } catch (error) {
      Alert.alert('Pickup အပြီးသတ်မရပါ', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const deletePickup = async () => {
    if (!supabase || !selectedPickup || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('pickups').delete().eq('id', selectedPickup.id);
      if (error) throw error;
      setMode(null);
      setSelectedPickup(null);
      await loadData(true);
    } catch (error) {
      Alert.alert('ဖျက်မရပါ', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveNote = async () => {
    if (!supabase || !selectedPickup || saving) return;
    setSaving(true);
    try {
      const manual = selectedPickup.manualSender;
      const note = manual
        ? encodeManualSenderNote({ ...manual, note: form.note })
        : form.note.trim() || null;
      const { error } = await supabase
        .from('pickups')
        .update({ note })
        .eq('id', selectedPickup.id);
      if (error) throw error;
      setMode(null);
      setSelectedPickup(null);
      await loadData(true);
    } catch (error) {
      Alert.alert('မှတ်ချက် သိမ်းမရပါ', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const choosePickerValue = (value: string) => {
    if (picker === 'sender') setForm((current) => ({ ...current, senderId: value }));
    if (picker === 'rider') setForm((current) => ({ ...current, riderId: value }));
    if (picker === 'status') setForm((current) => ({ ...current, status: value as PickupStatus }));
    if (mode === 'assign' && picker === 'rider') setAssignRiderId(value);
    setPicker(null);
    setSenderSearchQuery('');
  };

  const pickerOptions = picker === 'sender'
    ? senders
        .filter((sender) => sender.name !== 'Manual Sender')
        .filter((sender) => {
          const query = senderSearchQuery.trim().toLocaleLowerCase();
          if (!query) return true;
          return [
            sender.name,
            getAddress(sender),
            sender.phone ?? '',
          ].some((value) => value.toLocaleLowerCase().includes(query));
        })
        .map((sender) => ({
            label: [
              sender.name,
              getAddress(sender) !== 'လိပ်စာမရှိပါ' ? getAddress(sender) : '',
              sender.phone && sender.phone !== '-' ? sender.phone : '',
            ].filter(Boolean).join(' · '),
            value: String(sender.id),
          }))
    : picker === 'rider'
      ? riders.map((rider) => ({ label: rider.name, value: String(rider.id) }))
      : picker === 'status'
        ? statuses.map((status) => ({ label: status, value: status }))
        : [];

  const selectedPickerValue = picker === 'sender'
    ? form.senderId
    : picker === 'rider'
      ? mode === 'assign' ? assignRiderId : form.riderId
      : form.status;
  const hasActiveSearchFilters = Boolean(searchQuery.trim() || dateFrom || dateTo);
  const filterSummary = [
    searchQuery.trim() ? `ရှာရန်: ${searchQuery.trim()}` : '',
    dateFrom || dateTo ? `${dateFrom || 'အစမှ'} – ${dateTo || 'ယနေ့'}` : '',
  ].filter(Boolean).join(' · ') || 'စာသားနှင့် ရက်စွဲဖြင့် စစ်ထုတ်ရန်';

  return (
    <View style={styles.container}>
      <View style={styles.pageHeading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>PICKUP MANAGEMENT</Text>
          <Text style={styles.title}>Pickup စာရင်း</Text>
         
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={openAdd}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <Text style={styles.addButtonText}>＋</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        style={styles.filterScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {filters.map((filter) => {
          const count = filter === 'All'
            ? pickups.length
            : pickups.filter((pickup) => pickup.status === filter).length;
          const active = activeFilter === filter;
          return (
            <Pressable
              key={filter}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setActiveFilter(filter)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{filter}</Text>
              <Text style={[styles.filterCount, active && styles.filterCountActive]}>{count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.filtersSection}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersExpanded }}
          onPress={() => setFiltersExpanded((expanded) => !expanded)}
          style={({ pressed }) => [styles.filtersToggle, pressed && styles.pressed]}
        >
          <View style={styles.filtersToggleIconWrap}>
            <Text style={styles.filtersToggleIcon}>⌕</Text>
          </View>
          <View style={styles.filtersToggleCopy}>
            <Text style={styles.filtersToggleTitle}>ရှာရန် / ရက်စွဲ</Text>
            <Text numberOfLines={1} style={styles.filtersToggleSummary}>{filterSummary}</Text>
          </View>
          {hasActiveSearchFilters ? (
            <View style={styles.activeFilterBadge}>
              <Text style={styles.activeFilterBadgeText}>အသုံးပြုနေ</Text>
            </View>
          ) : null}
          <Text style={styles.filtersToggleChevron}>{filtersExpanded ? '⌃' : '⌄'}</Text>
        </Pressable>

        {filtersExpanded ? (
          <View style={styles.filterPanel}>
          <View style={styles.searchBlock}>
            <View style={styles.searchInputWrap}>
              <Text style={styles.searchInputIcon}>⌕</Text>
              <TextInput
                accessibilityLabel="Sender, Rider သို့မဟုတ် လိပ်စာဖြင့် ရှာရန်"
                placeholder="Sender၊ Rider၊ လိပ်စာ သို့မဟုတ် မှတ်ချက်ရှာရန်"
                placeholderTextColor={palette.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
                returnKeyType="search"
              />
              {searchQuery ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ရှာဖွေမှု ရှင်းရန်"
                  onPress={() => setSearchQuery('')}
                  hitSlop={8}
                >
                  <Text style={styles.searchClear}>×</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.dateRangeLabel}>ရက်စွဲအပိုင်းအခြား</Text>
              <View style={styles.dateRow}>
                {Platform.OS === 'web' ? (
                  <>
                    <TextInput
                      accessibilityLabel="စတင်ရက်စွဲ YYYY-MM-DD"
                      placeholder="စတင်ရက်"
                      placeholderTextColor={palette.muted}
                      value={dateFrom}
                      onChangeText={setDateFrom}
                      style={styles.dateInput}
                      autoCapitalize="none"
                    />
                    <TextInput
                      accessibilityLabel="နောက်ဆုံးရက်စွဲ YYYY-MM-DD"
                      placeholder="နောက်ဆုံးရက်"
                      placeholderTextColor={palette.muted}
                      value={dateTo}
                      onChangeText={setDateTo}
                      style={styles.dateInput}
                      autoCapitalize="none"
                    />
                  </>
                ) : (
                  <>
                    <DateFilterButton
                      label="စတင်ရက်"
                      value={dateFrom}
                      onPress={() => openDatePicker('from')}
                    />
                    <DateFilterButton
                      label="နောက်ဆုံးရက်"
                      value={dateTo}
                      onPress={() => openDatePicker('to')}
                    />
                  </>
                )}
              </View>
            {hasActiveSearchFilters ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDateFrom('');
                  setDateTo('');
                  setSearchQuery('');
                }}
                style={styles.clearFilters}
              >
                <Text style={styles.clearFiltersIcon}>×</Text>
                <Text style={styles.clearFiltersText}>စစ်ထုတ်မှု ရှင်းမည်</Text>
              </Pressable>
            ) : null}
          </View>
          </View>
        ) : null}
      </View>

      <View style={styles.resultsArea}>
        {loading ? (
          <View style={styles.stateView}>
            <ActivityIndicator color={palette.orangeLight} />
            <Text style={styles.stateText}>Pickup စာရင်းကို ဖွင့်နေသည်...</Text>
          </View>
        ) : loadError && pickups.length === 0 ? (
          <View style={styles.stateMessage}>
            <Text style={styles.stateTitle}>စာရင်းဖွင့်မရပါ</Text>
            <Text style={styles.stateText}>{loadError}</Text>
            <ActionButton label="ထပ်မံကြိုးစားရန်" onPress={() => void loadData()} />
          </View>
        ) : sections.length === 0 ? (
          <View style={styles.stateMessage}>
            <Text style={styles.stateTitle}>{loadError ? 'Pickup စာရင်း မရရှိပါ' : 'စာရင်း မရှိသေးပါ'}</Text>
            <Text style={styles.stateText}>
              {loadError ?? 'စစ်ထုတ်မှုကို ပြောင်းလဲကြည့်ပါ၊ သို့မဟုတ် Pickup အသစ်ထည့်ပါ။'}
            </Text>
            {loadError ? <ActionButton label="ထပ်မံကြိုးစားရန်" onPress={() => void loadData()} /> : null}
          </View>
        ) : (
          <SectionList
            style={styles.resultsList}
            sections={sections}
            keyExtractor={(item) => String(item.id)}
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeading}>
                <View style={styles.sectionDot} />
                <Text style={styles.sectionDate}>{formatDate(section.title)}</Text>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <PickupCard
                pickup={item}
                onAssign={() => {
                  setSelectedPickup(item);
                  setAssignRiderId(item.rider_id === null ? '' : String(item.rider_id));
                  setMode('assign');
                }}
                onComplete={() => {
                  setSelectedPickup(item);
                  setCompleteQuantity(String(item.quantity));
                  setMode('complete');
                }}
                onEdit={() => openEdit(item)}
                onDelete={() => {
                  setSelectedPickup(item);
                  setMode('delete');
                }}
                onNote={() => {
                  setSelectedPickup(item);
                  setForm((current) => ({ ...current, note: parseManualSender(item.note).cleanNote }));
                  setMode('note');
                }}
                onReassign={() => {
                  setSelectedPickup(item);
                  setAssignRiderId(item.rider_id === null ? '' : String(item.rider_id));
                  setMode('assign');
                }}
              />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void loadData(true)}
                tintColor={palette.orangeLight}
                colors={[palette.orangeLight]}
              />
            }
            stickySectionHeadersEnabled={false}
            initialNumToRender={8}
            windowSize={7}
          />
        )}
      </View>

      <Modal
        visible={mode !== null}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
          <View style={styles.modalPanel}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeading}>
              <Text style={styles.modalTitle}>
                {picker ? pickerTitle(picker) : modalTitle(mode)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={picker ? () => {
                  setPicker(null);
                  setSenderSearchQuery('');
                } : closeModal}
                hitSlop={10}
              >
                <Text style={styles.closeText}>{picker ? 'နောက်သို့' : 'ပိတ်မည်'}</Text>
              </Pressable>
            </View>
            {loadError && pickups.length > 0 ? (
              <Text style={styles.inlineError}>Pickup စာရင်းကို ပြန်လည်ရယူမရပါ။ {loadError}</Text>
            ) : null}

            {picker ? (
              <View style={styles.pickerContent}>
                {picker === 'sender' && senderError ? (
                  <PickerLoadError message={senderError} onRetry={() => void loadData(true)} />
                ) : picker === 'rider' && riderError ? (
                  <PickerLoadError message={riderError} onRetry={() => void loadData(true)} />
                ) : null}
                {picker === 'sender' ? (
                  <View style={styles.senderSearch}>
                    <Text style={styles.senderSearchIcon}>⌕</Text>
                    <TextInput
                      accessibilityLabel="Sender အမည်၊ ဖုန်း သို့မဟုတ် လိပ်စာဖြင့် ရှာရန်"
                      placeholder="Sender အမည်၊ ဖုန်း၊ လိပ်စာ ရှာရန်"
                      placeholderTextColor={palette.muted}
                      value={senderSearchQuery}
                      onChangeText={setSenderSearchQuery}
                      style={styles.senderSearchInput}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                    {senderSearchQuery ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="ရှာဖွေမှု ရှင်းရန်"
                        onPress={() => setSenderSearchQuery('')}
                        hitSlop={8}
                      >
                        <Text style={styles.senderSearchClear}>×</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                <FlatList
                  data={pickerOptions}
                  style={styles.pickerList}
                  keyExtractor={(item) => item.value}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  ListEmptyComponent={
                    <Text style={styles.emptyPicker}>
                      {picker === 'sender'
                        ? senderSearchQuery.trim() ? 'ကိုက်ညီသော Sender မတွေ့ပါ။' : 'Sender စာရင်း မရှိသေးပါ။'
                        : 'Rider စာရင်း မရှိသေးပါ။'}
                    </Text>
                  }
                  ListHeaderComponent={
                    picker === 'rider' ? (
                      <PickerOption
                        label="မသတ်မှတ်ရသေးပါ"
                        selected={selectedPickerValue === ''}
                        onPress={() => choosePickerValue('')}
                      />
                    ) : undefined
                  }
                  renderItem={({ item }) => (
                    <PickerOption
                      label={item.label}
                      selected={selectedPickerValue === item.value}
                      onPress={() => choosePickerValue(item.value)}
                    />
                  )}
                />
              </View>
            ) : null}

            {!picker && (mode === 'add' || mode === 'edit') ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalContent}
              >
                <View style={styles.modeSwitch}>
                  <ModeButton
                    label="Sender စာရင်း"
                    active={senderMode === 'list'}
                    onPress={() => setSenderMode('list')}
                  />
                  <ModeButton
                    label="လက်ဖြင့်ထည့်ရန်"
                    active={senderMode === 'manual'}
                    onPress={() => setSenderMode('manual')}
                  />
                </View>

                {senderMode === 'list' ? (
                  <FormField label="Sender *">
                    <PickerField
                      label={
                        senders.find((sender) => String(sender.id) === form.senderId)?.name ??
                        'Sender ရွေးချယ်ပါ'
                      }
                      onPress={() => {
                        setSenderSearchQuery('');
                        setPicker('sender');
                      }}
                    />
                  </FormField>
                ) : (
                  <View style={styles.manualFields}>
                    <FormField label="Sender အမည် *">
                      <TextInput
                        value={form.manualName}
                        onChangeText={(value) => setForm((current) => ({ ...current, manualName: value }))}
                        placeholder="Sender အမည်"
                        placeholderTextColor={palette.muted}
                        style={styles.textField}
                      />
                    </FormField>
                    <FormField label="ဖုန်းနံပါတ်">
                      <TextInput
                        value={form.manualPhone}
                        onChangeText={(value) => setForm((current) => ({ ...current, manualPhone: value }))}
                        placeholder="09..."
                        placeholderTextColor={palette.muted}
                        keyboardType="phone-pad"
                        style={styles.textField}
                      />
                    </FormField>
                    <FormField label="ပစ္စည်းသိမ်းမည့် လိပ်စာ">
                      <TextInput
                        value={form.manualAddress}
                        onChangeText={(value) => setForm((current) => ({ ...current, manualAddress: value }))}
                        placeholder="လိပ်စာ"
                        placeholderTextColor={palette.muted}
                        style={styles.textField}
                      />
                    </FormField>
                  </View>
                )}

                <FormField label="Rider (မထည့်လည်းရသည်)">
                  <PickerField
                    label={riders.find((rider) => String(rider.id) === form.riderId)?.name ?? 'မသတ်မှတ်ရသေးပါ'}
                    onPress={() => setPicker('rider')}
                  />
                </FormField>
                {mode === 'edit' ? (
                  <FormField label="Status">
                    <PickerField label={form.status} onPress={() => setPicker('status')} />
                  </FormField>
                ) : null}
                {mode === 'edit' ? (
                  <FormField label="အရေအတွက်">
                    <TextInput
                      value={form.quantity}
                      onChangeText={(value) => setForm((current) => ({ ...current, quantity: value }))}
                      keyboardType="number-pad"
                      style={styles.textField}
                    />
                  </FormField>
                ) : null}
                <FormField label="မှတ်ချက်">
                  <TextInput
                    value={form.note}
                    onChangeText={(value) => setForm((current) => ({ ...current, note: value }))}
                    placeholder="မှတ်ချက်ထည့်ရန်"
                    placeholderTextColor={palette.muted}
                    multiline
                    textAlignVertical="top"
                    style={[styles.textField, styles.noteInput]}
                  />
                </FormField>
                <ActionButton
                  label={saving ? 'သိမ်းဆည်းနေသည်...' : 'သိမ်းဆည်းမည်'}
                  disabled={saving}
                  onPress={() => void submitForm()}
                />
                <SecondaryButton label="မလုပ်တော့ပါ" onPress={closeModal} />
              </ScrollView>
            ) : null}

            {!picker && mode === 'assign' ? (
              <View style={styles.modalContent}>
                <Text style={styles.modalDescription}>
                  {selectedPickup?.sender.name} ထံ သွားရောက်ရန် Rider ရွေးချယ်ပါ။
                </Text>
                <FormField label="Rider">
                  <PickerField
                    label={riders.find((rider) => String(rider.id) === assignRiderId)?.name ?? 'Rider ရွေးချယ်ပါ'}
                    onPress={() => setPicker('rider')}
                  />
                </FormField>
                <ActionButton
                  label={saving ? 'သိမ်းဆည်းနေသည်...' : 'အတည်ပြုမည်'}
                  disabled={saving || !assignRiderId}
                  onPress={() => void assignRider()}
                />
                <SecondaryButton label="မလုပ်တော့ပါ" onPress={closeModal} />
              </View>
            ) : null}

            {!picker && mode === 'complete' ? (
              <View style={styles.modalContent}>
                <Text style={styles.modalDescription}>
                  {selectedPickup?.sender.name} ထံမှ သိမ်းယူခဲ့သည့် အရေအတွက်ကို အတည်ပြုပါ။
                </Text>
                <FormField label="သိမ်းယူခဲ့သည့် အရေအတွက်">
                  <TextInput
                    value={completeQuantity}
                    onChangeText={setCompleteQuantity}
                    keyboardType="number-pad"
                    style={styles.textField}
                  />
                </FormField>
                <ActionButton
                  label={saving ? 'သိမ်းဆည်းနေသည်...' : 'Completed ဟု သတ်မှတ်မည်'}
                  disabled={saving}
                  onPress={() => void completePickup()}
                />
                <SecondaryButton label="မလုပ်တော့ပါ" onPress={closeModal} />
              </View>
            ) : null}

            {!picker && mode === 'delete' ? (
              <View style={styles.modalContent}>
                <Text style={styles.modalDescription}>
                  {selectedPickup?.sender.name} ၏ Pickup ကို အပြီးအပိုင် ဖျက်မည်။ ပြန်လည်ရယူ၍ မရနိုင်ပါ။
                </Text>
                <ActionButton
                  label={saving ? 'ဖျက်နေသည်...' : 'Pickup ဖျက်မည်'}
                  danger
                  disabled={saving}
                  onPress={() => void deletePickup()}
                />
                <SecondaryButton label="မလုပ်တော့ပါ" onPress={closeModal} />
              </View>
            ) : null}

            {!picker && mode === 'note' ? (
              <View style={styles.modalContent}>
                <Text style={styles.modalDescription}>
                  {selectedPickup?.sender.name} · {selectedPickup?.status}
                </Text>
                <FormField label="မှတ်ချက်">
                  <TextInput
                    value={form.note}
                    onChangeText={(value) => setForm((current) => ({ ...current, note: value }))}
                    placeholder="မှတ်ချက်ထည့်ရန်"
                    placeholderTextColor={palette.muted}
                    multiline
                    textAlignVertical="top"
                    style={[styles.textField, styles.noteInput]}
                  />
                </FormField>
                <ActionButton
                  label={saving ? 'သိမ်းဆည်းနေသည်...' : 'မှတ်ချက် သိမ်းမည်'}
                  disabled={saving}
                  onPress={() => void saveNote()}
                />
                <SecondaryButton label="မလုပ်တော့ပါ" onPress={closeModal} />
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {Platform.OS === 'ios' && dateField ? (
        <Modal
          transparent
          animationType="slide"
          onRequestClose={() => setDateField(null)}
        >
          <View style={styles.dateModalBackdrop}>
            <View style={styles.dateModalPanel}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>
                  {dateField === 'from' ? 'စတင်ရက် ရွေးချယ်ပါ' : 'နောက်ဆုံးရက် ရွေးချယ်ပါ'}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => setDateField(null)}>
                  <Text style={styles.dateCancelText}>မလုပ်တော့ပါ</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateDraft}
                mode="date"
                display="spinner"
                minimumDate={dateField === 'to' ? parseDateKey(dateFrom) ?? undefined : undefined}
                maximumDate={dateField === 'from' ? parseDateKey(dateTo) ?? undefined : undefined}
                onValueChange={(_event, selectedDate) => setDateDraft(selectedDate)}
                style={styles.iosDatePicker}
              />
              <ActionButton label="ရက်စွဲ သတ်မှတ်မည်" onPress={applyDateDraft} />
            </View>
          </View>
        </Modal>
      ) : null}

    </View>
  );
}

function PickupCard({
  pickup,
  onAssign,
  onComplete,
  onEdit,
  onDelete,
  onNote,
  onReassign,
}: {
  pickup: Pickup;
  onAssign: () => void;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onNote: () => void;
  onReassign: () => void;
}) {
  const { cleanNote } = parseManualSender(pickup.note);
  const badge = statusColors(pickup.status);

  return (
    <View style={styles.pickupCard}>
      <View style={styles.cardTopRow}>
        <View style={styles.badgeRow}>
          <Text style={[styles.statusBadge, { backgroundColor: badge.background, borderColor: badge.border, color: badge.text }]}>
            {pickup.status}
          </Text>
          {pickup.manualSender ? <Text style={styles.manualBadge}>Manual</Text> : null}
          <Text style={styles.branchBadge}>
            {pickup.branch ?? 'Branch မသတ်မှတ်ရသေး'}
          </Text>
        </View>
        <View style={styles.cardTools}>
          <SmallAction label={cleanNote ? 'မှတ်ချက်' : '+ မှတ်ချက်'} onPress={onNote} />
          <SmallAction label="ပြင်ရန်" onPress={onEdit} />
          <SmallAction label="ဖျက်ရန်" danger onPress={onDelete} />
        </View>
      </View>

      <View style={styles.cardTitleRow}>
        <Text style={styles.senderName} numberOfLines={2}>{pickup.sender.name}</Text>
        <Text style={styles.quantityBadge}>{pickup.quantity} ခု</Text>
      </View>
      {pickup.sender.phone && pickup.sender.phone !== '-' ? (
        <Text style={styles.cardDetail}>ဖုန်း  ·  {pickup.sender.phone}</Text>
      ) : null}
      <Text style={styles.cardDetail} numberOfLines={2}>လိပ်စာ  ·  {getAddress(pickup.sender)}</Text>
      <Text style={styles.cardDetail}>Rider  ·  {pickup.rider?.name ?? 'မသတ်မှတ်ရသေးပါ'}</Text>
      {cleanNote ? (
        <Pressable onPress={onNote} style={styles.notePreview}>
          <Text style={styles.notePreviewText} numberOfLines={2}>မှတ်ချက်  ·  {cleanNote}</Text>
        </Pressable>
      ) : null}

      <View style={styles.cardActions}>
        {pickup.status === 'Pending' ? (
          <ActionButton label="Rider သတ်မှတ်မည်" compact onPress={onAssign} />
        ) : (
          <>
            <ActionButton
              label={pickup.status === 'Completed' ? 'ပြီးစီးပြီး' : 'ပြီးစီးကြောင်း အတည်ပြု'}
              compact
              success
              disabled={pickup.status === 'Completed'}
              onPress={onComplete}
            />
            <SecondaryButton
              label="Rider ပြောင်းမည်"
              compact
              disabled={pickup.status === 'Completed'}
              onPress={onReassign}
            />
          </>
        )}
      </View>
    </View>
  );
}

function modalTitle(mode: ModalMode) {
  switch (mode) {
    case 'add': return 'Pickup အသစ်ထည့်မည်';
    case 'edit': return 'Pickup အချက်အလက် ပြင်မည်';
    case 'assign': return 'Rider တာဝန်ပေးမည် / ပြောင်းမည်';
    case 'complete': return 'Pickup အပြီးသတ်မည်';
    case 'delete': return 'Pickup ဖျက်မည်';
    case 'note': return 'မှတ်ချက်';
    default: return '';
  }
}

function pickerTitle(picker: PickerMode) {
  switch (picker) {
    case 'sender': return 'Sender ရွေးချယ်ပါ';
    case 'rider': return 'Rider ရွေးချယ်ပါ';
    case 'status': return 'Status ရွေးချယ်ပါ';
    default: return '';
  }
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function PickerField({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.pickerField}>
      <Text numberOfLines={2} style={styles.pickerFieldText}>{label}</Text>
      <Text style={styles.pickerArrow}>⌄</Text>
    </Pressable>
  );
}

function DateFilterButton({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const parsedDate = parseDateKey(value);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${parsedDate ? parsedDate.toLocaleDateString('en-GB') : 'ရွေးချယ်ရန်'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.datePickerButton, pressed && styles.pressed]}
    >
      <Text style={styles.datePickerLabel}>{label}</Text>
      <Text style={styles.datePickerValue}>
        {parsedDate ? parsedDate.toLocaleDateString('en-GB') : 'ရက်စွဲရွေးပါ'}
      </Text>
    </Pressable>
  );
}

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.modeButton, active && styles.modeButtonActive]}
    >
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PickerOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pickerOption, selected && styles.pickerOptionSelected]}>
      <Text style={[styles.pickerOptionText, selected && styles.pickerOptionTextSelected]}>{label}</Text>
      {selected ? <Text style={styles.selectedMark}>✓</Text> : null}
    </Pressable>
  );
}

function PickerLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.pickerError}>
      <Text style={styles.pickerErrorText}>စာရင်းကို ရယူမရပါ။ {message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.pickerRetry}>
        <Text style={styles.pickerRetryText}>ပြန်စမ်းမည်</Text>
      </Pressable>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  compact = false,
  success = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
  success?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        success && styles.actionButtonSuccess,
        danger && styles.actionButtonDanger,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.actionButtonText, compact && styles.actionButtonTextCompact]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  compact = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        compact && styles.secondaryButtonCompact,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SmallAction({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={4} style={styles.smallAction}>
      <Text style={[styles.smallActionText, danger && styles.smallActionDanger]}>{label}</Text>
    </Pressable>
  );
}

const palette = {
  background: '#090909',
  surface: '#141414',
  surfaceRaised: '#1a1714',
  border: '#302a25',
  orange: '#f97316',
  orangeLight: '#ff9b47',
  white: '#f7f4f1',
  muted: '#aaa39c',
  red: '#ff8273',
};

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, paddingTop: 12 },
  pageHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 18,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    backgroundColor: palette.surface,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: palette.orangeLight, fontSize: 9, fontWeight: '800', letterSpacing: 1.7 ,paddingTop: 5},
  title: { color: palette.white, fontSize: 23, fontWeight: '800' },
  subtitle: { color: palette.muted, fontSize: 12, marginTop: 3 },
  addButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: palette.orange,
  },
  addButtonText: { color: '#201309', fontSize: 20, fontWeight: '800' },
  filtersSection: { flexShrink: 0 },
  filtersToggle: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 18,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 13,
    backgroundColor: palette.surface,
  },
  filtersToggleIconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#25180f',
  },
  filtersToggleIcon: { color: palette.orangeLight, fontSize: 20, lineHeight: 24 },
  filtersToggleCopy: { flex: 1, minWidth: 0, gap: 1 },
  filtersToggleTitle: { color: palette.white, fontSize: 11, fontWeight: '800' },
  filtersToggleSummary: { color: palette.muted, fontSize: 9 },
  activeFilterBadge: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#25180f',
  },
  activeFilterBadgeText: { color: palette.orangeLight, fontSize: 8, fontWeight: '800' },
  filtersToggleChevron: { color: palette.orangeLight, fontSize: 17, fontWeight: '800', paddingHorizontal: 2 },
  filterPanel: {
    gap: 11,
    marginHorizontal: 18,
    marginTop: 7,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 15,
    backgroundColor: palette.surface,
  },
  filterScroll: { height: 67, flexGrow: 0, flexShrink: 0 },
  filters: {
    height: 67,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
  },
  filterChip: {
    height: 40,
    minWidth: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  filterChipActive: { backgroundColor: '#25180f', borderColor: '#794619' },
  filterText: { color: '#c0b7af', fontSize: 11, lineHeight: 14, fontWeight: '700' },
  filterTextActive: { color: palette.orangeLight },
  filterCount: { color: palette.muted, fontSize: 10, lineHeight: 12, fontWeight: '700' },
  filterCountActive: { color: '#ffd0a5' },
  searchBlock: { gap: 8 },
  searchInputWrap: {
    height: 43,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    backgroundColor: '#1a1a1a',
  },
  searchInputIcon: { color: palette.orangeLight, fontSize: 20, lineHeight: 24 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingVertical: 0,
    color: palette.white,
    fontSize: 11,
  },
  searchClear: { color: palette.muted, fontSize: 20, lineHeight: 24, paddingHorizontal: 2 },
  dateRangeLabel: { color: palette.muted, fontSize: 9, fontWeight: '700', marginTop: 2 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateInput: {
    flex: 1,
    height: 42,
    minWidth: 0,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    backgroundColor: '#1a1a1a',
    color: palette.white,
    fontSize: 11,
  },
  datePickerButton: {
    flex: 1,
    minWidth: 0,
    height: 42,
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    backgroundColor: '#1a1a1a',
  },
  datePickerLabel: { color: palette.muted, fontSize: 9 },
  datePickerValue: { color: palette.white, fontSize: 11, fontWeight: '700' },
  clearFilters: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 1,
  },
  clearFiltersIcon: { color: palette.orangeLight, fontSize: 16, fontWeight: '700' },
  clearFiltersText: { color: palette.orangeLight, fontSize: 10, fontWeight: '700' },
  resultsArea: { marginTop: 8, flex: 1, minHeight: 0 },
  resultsList: { flex: 1, minHeight: 0 },
  stateView: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateMessage: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    marginHorizontal: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    backgroundColor: palette.surface,
  },
  stateTitle: { color: palette.white, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  stateText: { color: palette.muted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  listContent: { gap: 10, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 128 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 9,
  },
  sectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.orangeLight },
  sectionDate: { color: '#e8e0d9', fontSize: 12, fontWeight: '800' },
  sectionCount: {
    color: palette.orangeLight,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#302014',
    overflow: 'hidden',
  },
  pickupCard: {
    gap: 10,
    marginBottom: 2,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 17,
    backgroundColor: palette.surface,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  statusBadge: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 9,
    fontWeight: '800',
  },
  manualBadge: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#49301f',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 3,
    color: palette.orangeLight,
    backgroundColor: '#25180f',
    fontSize: 9,
    fontWeight: '700',
  },
  branchBadge: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 3,
    color: palette.orangeLight,
    backgroundColor: '#25180f',
    fontSize: 9,
    fontWeight: '700',
  },
  cardTools: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  smallAction: { paddingHorizontal: 4, paddingVertical: 5 },
  smallActionText: { color: '#b1a69d', fontSize: 9, fontWeight: '700' },
  smallActionDanger: { color: palette.red },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  senderName: { flex: 1, color: palette.white, fontSize: 16, fontWeight: '800' },
  quantityBadge: {
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    color: palette.orangeLight,
    backgroundColor: '#25180f',
    fontSize: 10,
    fontWeight: '800',
  },
  cardDetail: { color: '#c2b8af', fontSize: 11, lineHeight: 25 },
  notePreview: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#49301f',
    borderRadius: 10,
    backgroundColor: '#21170f',
  },
  notePreviewText: { color: '#f4c977', fontSize: 10, lineHeight: 20 },
  cardActions: { flexDirection: 'row', gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: palette.border },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  modalPanel: {
    maxHeight: '90%',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    marginBottom: 13,
    borderRadius: 2,
    backgroundColor: '#5b554f',
  },
  modalHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  modalTitle: { flex: 1, color: palette.white, fontSize: 16, fontWeight: '800' },
  closeText: { color: palette.orangeLight, fontSize: 11, fontWeight: '700' },
  modalContent: { gap: 13, paddingTop: 15, paddingBottom: 8 },
  modalDescription: { color: '#d2c9c1', fontSize: 12, lineHeight: 19 },
  modeSwitch: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    borderRadius: 13,
    backgroundColor: '#1a1a1a',
  },
  modeButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 38, paddingHorizontal: 5, borderRadius: 10 },
  modeButtonActive: { backgroundColor: '#25180f' },
  modeButtonText: { color: palette.muted, fontSize: 10, fontWeight: '700' },
  modeButtonTextActive: { color: palette.orangeLight },
  manualFields: { gap: 12, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 14, backgroundColor: palette.surface },
  formField: { gap: 6 },
  fieldLabel: { color: '#e0d7cf', fontSize: 11, fontWeight: '700' },
  textField: {
    minHeight: 43,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    backgroundColor: '#1a1a1a',
    color: palette.white,
    fontSize: 12,
  },
  noteInput: { minHeight: 84, paddingTop: 11 },
  pickerField: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    backgroundColor: '#1a1a1a',
  },
  pickerFieldText: { flex: 1, color: palette.white, fontSize: 12 },
  pickerArrow: { color: palette.orangeLight, fontSize: 19, fontWeight: '800' },
  actionButton: {
    minHeight: 45,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: palette.orange,
  },
  actionButtonCompact: { minHeight: 38, flex: 1, paddingHorizontal: 8 },
  actionButtonSuccess: { backgroundColor: '#176344' },
  actionButtonDanger: { backgroundColor: '#a9342c' },
  actionButtonText: { color: '#24160b', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  actionButtonTextCompact: { fontSize: 10 },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
  },
  secondaryButtonCompact: { minHeight: 38, flex: 1, paddingHorizontal: 8 },
  secondaryButtonText: { color: '#ddd4cc', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  disabledButton: { opacity: 0.45 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  pickerContent: { flexShrink: 1, gap: 10, paddingTop: 12 },
  pickerList: { maxHeight: 420, flexShrink: 1 },
  senderSearch: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 13,
    backgroundColor: '#1a1a1a',
  },
  senderSearchIcon: { color: palette.orangeLight, fontSize: 21, lineHeight: 24 },
  senderSearchInput: { flex: 1, minWidth: 0, paddingVertical: 10, color: palette.white, fontSize: 12 },
  senderSearchClear: { color: palette.muted, fontSize: 21, lineHeight: 24, paddingHorizontal: 2 },
  inlineError: {
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    color: '#ffaaa0',
    backgroundColor: '#2a1b18',
    fontSize: 10,
    lineHeight: 15,
  },
  pickerError: {
    gap: 7,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#2a1b18',
  },
  pickerErrorText: { color: '#ffaaa0', fontSize: 10, lineHeight: 15 },
  pickerRetry: { alignSelf: 'flex-start', paddingVertical: 3 },
  pickerRetryText: { color: palette.orangeLight, fontSize: 10, fontWeight: '800' },
  dateModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  dateModalPanel: {
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#171411',
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateModalTitle: { color: palette.white, fontSize: 15, fontWeight: '800' },
  dateCancelText: { color: palette.orangeLight, fontSize: 11, fontWeight: '700' },
  iosDatePicker: { alignSelf: 'center', width: '100%', height: 180 },
  pickerOption: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 11,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  pickerOptionSelected: { backgroundColor: '#25180f' },
  pickerOptionText: { flex: 1, color: '#e5ddd5', fontSize: 11, lineHeight: 16 },
  pickerOptionTextSelected: { color: palette.orangeLight, fontWeight: '800' },
  selectedMark: { color: palette.orangeLight, fontSize: 15, fontWeight: '900' },
  emptyPicker: { paddingVertical: 18, color: palette.muted, fontSize: 12, textAlign: 'center' },
});
