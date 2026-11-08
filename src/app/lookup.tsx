import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Print from 'expo-print';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { SymbolView } from '@/components/AppSymbol';
import type { SFSymbol } from 'expo-symbols';
import { useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ComputerPrintPanel } from '@/components/ComputerPrintPanel';
import { useAuth } from '@/lib/auth-context';
import { requestJson } from '@/lib/api-client';
import {
  calculateManualVoucherTotal,
  createManualVoucherReference,
  toManualVoucherFields,
  type ManualVoucherDraft,
} from '@/lib/manual-voucher';
import type { StatusOrder } from '@/lib/order-status';
import { supabase } from '@/lib/supabase';
import { lookupVoucherOrder, searchVoucherOrders } from '@/lib/voucher-lookup';
import {
  buildVoucherHtml,
  normalizeVoucherFields,
  voucherPaymentDisplay,
  voucherQrDataUrl,
  type VoucherFields,
  type VoucherOutputDocument,
} from '@/lib/voucher-template';
import { captureRef } from 'react-native-view-shot';

type Page = 'search' | 'detail' | 'voucher' | 'manual' | 'manualVoucher';
type ManualVoucherMode = 'manual' | 'kota';

type ParsedKotaVoucher = {
  received_date: string;
  sender_loc: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  cod_amount: string;
  note: string;
};

const today = () => new Date().toISOString().slice(0, 10);

function newManualDraft(): ManualVoucherDraft {
  return {
    receiveDate: today(),
    senderName: '',
    senderPhone: '',
    senderAddress: '',
    receiverName: '',
    receiverPhone: '',
    receiverAddress: '',
    codAmount: '',
    deliFee: '',
    payType: 'COLLECT',
    remark: '',
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day;
}

function amount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? `${number.toLocaleString('en-US')} Ks` : '-';
}

function ResultCard({ order, onPress }: { order: StatusOrder; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.resultCard, pressed && styles.pressed]}>
      <View style={styles.resultIcon}>
        <SymbolView name="shippingbox.fill" tintColor={colors.orange} size={21} />
      </View>
      <View style={styles.resultCopy}>
        <View style={styles.resultLine}>
          <Text style={styles.resultCode} numberOfLines={1}>{order.item_id || order.barcode || 'Parcel'}</Text>
          <Text style={styles.resultStatus}>{order.status || 'Pending'}</Text>
        </View>
        <Text style={styles.resultName} numberOfLines={1}>{order.receiver_name || 'အမည်မရှိပါ'}</Text>
        <Text style={styles.resultMeta} numberOfLines={1}>{order.receiver_phone || 'ဖုန်းမရှိ'} · {order.barcode || 'Barcode မရှိ'}</Text>
      </View>
      <SymbolView name="chevron.right" tintColor={colors.muted} size={17} />
    </Pressable>
  );
}

function DetailField({ label, value, emphasis = false }: { label: string; value?: string | number | null; emphasis?: boolean }) {
  return (
    <View style={styles.detailField}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, emphasis && styles.emphasis]}>{value === null || value === undefined || value === '' ? '-' : String(value)}</Text>
    </View>
  );
}

function ManualInput({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'phone-pad';
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholder={label}
        placeholderTextColor={colors.muted}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

function MoreAction({
  icon,
  title,
  onPress,
  loading = false,
  disabled = false,
}: {
  icon: SFSymbol;
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.moreAction, (pressed || disabled) && styles.pressed]}
    >
      <View style={styles.moreActionIcon}>
        {loading
          ? <ActivityIndicator color={colors.orange} />
          : <SymbolView name={icon} tintColor={colors.orange} size={19} fallback={<Text style={styles.moreFallback}>•</Text>} />}
      </View>
      <Text style={styles.moreActionTitle}>{title}</Text>
      <SymbolView name="chevron.right" tintColor={colors.muted} size={16} />
    </Pressable>
  );
}

function VoucherPreview({
  fields,
  qrEnabled,
  voucherRef,
}: {
  fields: VoucherFields;
  qrEnabled: boolean;
  voucherRef: RefObject<ComponentRef<typeof View> | null>;
}) {
  const payment = voucherPaymentDisplay(fields);
  const remarkStyle = fields.remark.length > 50
    ? styles.remarkSmall
    : fields.remark.length > 25
      ? styles.remarkMedium
      : styles.remarkLarge;

  return (
    <ScrollView contentContainerStyle={styles.previewScroll} keyboardShouldPersistTaps="handled">
      <View ref={voucherRef} collapsable={false} style={styles.paper}>
        <View style={styles.paperHeader}>
          <Image source={require('../../assets/images/voclogo.png')} style={styles.paperLogo} resizeMode="contain" />
          <Text style={styles.paperBrand}>ALL IN ONE EXPRESS</Text>
        </View>
        <View style={styles.paperDate}>
          <Text><Text style={styles.bold}>Date:</Text> {fields.receiveDate}</Text>
          {qrEnabled ? <Text style={styles.paperItem}>{fields.itemId}</Text> : null}
        </View>
        <View style={[styles.officeRow, !qrEnabled && styles.officeRowNoQr]}>
          <View style={styles.officeNames}>
            <Text>MDY Office:</Text>
            <Text>YGN Office:</Text>
          </View>
          <View style={styles.officeRule} />
          <View style={styles.officeCopy}>
            <Text style={styles.officeCopyText}>No.Nga-6/93, 62A, between 109 &amp; 109B, Mandalay.09-889988856</Text>
            <Text style={styles.officeCopyText}>No.280, Corner of Du Yar St. &amp; Ba La Min Htin St., 50 ward, North Dagon, Yangon.</Text>
          </View>
          {qrEnabled ? (
            <Image
              source={{ uri: voucherQrDataUrl(fields.itemId) }}
              style={styles.paperQr}
              resizeMode="contain"
            />
          ) : null}
        </View>
        <Text style={styles.paperSection}>FROM</Text>
        <View style={styles.paperFields}>
          <PaperField label="Name:" value={fields.senderName} />
          <PaperField label="Phone:" value={fields.senderPhone} />
          <PaperField label="Address:" value={fields.senderAddress} />
        </View>
        <Text style={[styles.paperSection, styles.toSection]}>TO</Text>
        <View style={styles.paperFields}>
          <PaperField label="Name:" value={fields.receiverName} strong spacingAfter />
          <PaperField label="Phone:" value={fields.receiverPhone} strong />
          <PaperField label="Address:" value={fields.receiverAddress} strong address />
        </View>
        <View style={styles.moneyBox}>
          <MoneyRow label="COD:" value={`${payment.codAmount} Ks`} />
          <View style={styles.dashed} />
          <MoneyRow
            label="Deli Fee:"
            value={`${fields.deliFee} Ks ${payment.deliStatus ? `(${payment.deliStatus})` : ''}`}
            right={payment.payTypeDisplay}
          />
          <MoneyRow label="Total:" value={`${fields.totalAmount} Ks`} total />
        </View>
        <View style={styles.moneyBottom} />
        <View style={styles.remark}>
          <Text style={styles.remarkTitle}>မှတ်ချက်</Text>
          <View style={styles.dotted} />
          <View style={styles.remarkValue}>
            <Text style={remarkStyle}>{fields.remark || '---'}</Text>
          </View>
          <View style={styles.remarkBottom} />
        </View>
      </View>
      <Text style={styles.previewHint}>
        {qrEnabled ? 'QR/reference ပါသောvoucher preview' : 'QR/reference မပါသောvoucher preview'}
      </Text>
    </ScrollView>
  );
}

function PaperField({
  label,
  value,
  strong = false,
  spacingAfter = false,
  address = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  spacingAfter?: boolean;
  address?: boolean;
}) {
  return (
    <View style={[styles.paperField, spacingAfter && styles.paperFieldSpaced, address && styles.paperAddress]}>
      <Text style={styles.paperFieldLabel}>{label}</Text>
      <Text style={[styles.paperFieldValue, strong && styles.paperFieldStrong]}>{value}</Text>
    </View>
  );
}

function MoneyRow({
  label,
  value,
  right,
  total = false,
}: {
  label: string;
  value: string;
  right?: string;
  total?: boolean;
}) {
  return (
    <View style={[styles.moneyRow, total && styles.totalRow]}>
      <Text style={[styles.moneyLabel, total && styles.totalText]}>{label}</Text>
      <View style={styles.moneyRule} />
      <View style={styles.moneyContent}>
        <Text style={[styles.moneyValue, total && styles.totalText]}>{value}</Text>
        {right ? <Text style={styles.moneyRight}>{right}</Text> : null}
      </View>
    </View>
  );
}

export default function ParcelLookupScreen() {
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [page, setPage] = useState<Page>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StatusOrder[]>([]);
  const [selected, setSelected] = useState<StatusOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'print' | 'pdf' | 'image' | null>(null);
  const [message, setMessage] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const scanLockedRef = useRef(false);
  const voucherPreviewRef = useRef<ComponentRef<typeof View>>(null);
  const [manualDraft, setManualDraft] = useState<ManualVoucherDraft>(newManualDraft);
  const [manualMode, setManualMode] = useState<ManualVoucherMode>('manual');
  const [manualSender, setManualSender] = useState<Pick<ManualVoucherDraft, 'senderName' | 'senderPhone' | 'senderAddress'>>({
    senderName: '',
    senderPhone: '',
    senderAddress: '',
  });
  const [pastedMessage, setPastedMessage] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [manualQr, setManualQr] = useState(true);
  const [manualReference, setManualReference] = useState<string | null>(null);
  const [manualExportId, setManualExportId] = useState('');

  const manualFields = useMemo(
    () => toManualVoucherFields(manualDraft, manualQr ? manualReference : null),
    [manualDraft, manualQr, manualReference],
  );
  const document: VoucherOutputDocument | null = page === 'manualVoucher'
    ? { id: manualReference ?? manualExportId, fields: manualFields, qrEnabled: manualQr }
    : selected && page === 'voucher'
      ? { id: selected.id, fields: normalizeVoucherFields(selected), qrEnabled: true }
      : null;
  const title = page === 'detail'
    ? 'Parcel Detail'
    : page === 'voucher'
      ? 'Voucher Preview'
      : page === 'manual'
        ? 'Manual Voucher'
        : page === 'manualVoucher'
          ? 'Manual Voucher Preview'
          : 'Parcel Lookup';

  const search = async (term = query) => {
    const normalized = term.trim();
    if (!normalized) {
      setResults([]);
      setMessage('Item ID, barcode, လက်ခံသူအမည် သို့မဟုတ် ဖုန်းနံပါတ်ကို ရိုက်ထည့်ပါ။');
      return;
    }
    if (!user) {
      setMessage('ဝင်ထားသော session မရှိပါ။ ပြန်ဝင်ပါ။');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const { data, error } = await supabase?.auth.getSession() ?? {
        data: { session: null },
        error: new Error('Supabase is not configured.'),
      };
      if (error) throw error;
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('ဝင်ထားသော session မရှိပါ။ ပြန်ဝင်ပါ။');
      const nextResults = await searchVoucherOrders(accessToken, normalized);
      setResults(nextResults);
      if (!nextResults.length) setMessage('ကိုက်ညီသော parcel မတွေ့ပါ။');
    } catch (searchError) {
      setMessage(searchError instanceof Error ? searchError.message : 'Parcel ကို ရှာမရပါ။');
    } finally {
      setLoading(false);
    }
  };

  const openScanner = async () => {
    try {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          Alert.alert('Camera permission လိုအပ်ပါသည်', 'Parcel barcode ဖတ်ရန် Camera permission ပေးပါ။');
          return;
        }
      }
      scanLockedRef.current = false;
      setScanLocked(false);
      setScannerOpen(true);
    } catch (permissionError) {
      Alert.alert('Camera ဖွင့်မရပါ', permissionError instanceof Error ? permissionError.message : 'Camera permission ကို စစ်ဆေးပါ။');
    }
  };

  const scanNextParcel = async () => {
    setMoreOpen(false);
    setSelected(null);
    setQuery('');
    setResults([]);
    setMessage('');
    setPage('search');
    setTimeout(() => void openScanner(), 300);
  };

  const scanParcel = async ({ data }: BarcodeScanningResult) => {
    const code = data.trim();
    if (!code || scanLockedRef.current) return;
    scanLockedRef.current = true;
    setScanLocked(true);
    try {
      const { data: sessionData, error } = await supabase?.auth.getSession() ?? {
        data: { session: null },
        error: new Error('Supabase is not configured.'),
      };
      if (error) throw error;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('ဝင်ထားသော session မရှိပါ။ ပြန်ဝင်ပါ။');
      const order = await lookupVoucherOrder(accessToken, code);
      if (!order) {
        scanLockedRef.current = false;
        setScanLocked(false);
        Alert.alert('Parcel ရှာမတွေ့ပါ', `Barcode ${code} ဖြင့် အထုတ်အားလုံးထဲတွင် ရှာမတွေ့ပါ။`);
        return;
      }
      setSelected(order);
      setPage('detail');
      setScannerOpen(false);
    } catch (lookupError) {
      scanLockedRef.current = false;
      setScanLocked(false);
      Alert.alert('Barcode စစ်ဆေးမရပါ', lookupError instanceof Error ? lookupError.message : 'Network ကိုစစ်ပြီး ပြန်ဖတ်ပါ။');
    }
  };

  const startManual = () => {
    setSelected(null);
    setManualDraft(newManualDraft());
    setManualMode('manual');
    setManualSender({ senderName: '', senderPhone: '', senderAddress: '' });
    setPastedMessage('');
    setParseError('');
    setManualQr(true);
    setManualReference(null);
    setManualExportId(`manual-${Date.now()}`);
    setPage('manual');
  };

  const changeManualMode = (nextMode: ManualVoucherMode) => {
    if (nextMode === manualMode) return;

    if (nextMode === 'kota') {
      setManualSender({
        senderName: manualDraft.senderName,
        senderPhone: manualDraft.senderPhone,
        senderAddress: manualDraft.senderAddress,
      });
      setManualDraft((current) => ({
        ...current,
        senderName: 'KOTA',
        senderPhone: '09-',
        senderAddress: '',
      }));
    } else {
      setManualDraft((current) => ({ ...current, ...manualSender }));
    }

    setParseError('');
    setManualMode(nextMode);
  };

  const parseKotaMessage = async () => {
    if (!pastedMessage.trim()) {
      setParseError('AI ဖြင့်ဖတ်ရန် စာသားကို အရင်ထည့်ပေးပါ။');
      return;
    }

    setIsParsing(true);
    setParseError('');
    try {
      const { data: sessionData, error } = await supabase?.auth.getSession() ?? {
        data: { session: null },
        error: new Error('Supabase is not configured.'),
      };
      if (error) throw error;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('ဝင်ထားသော session မရှိပါ။ ပြန်ဝင်ပါ။');

      const response = await requestJson<{ data?: ParsedKotaVoucher }>(
        '/api/voc/parse-kota',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ text: pastedMessage, today: manualDraft.receiveDate }),
        },
      );
      if (!response.data) throw new Error('AI က ဖတ်ရှုနိုင်သောအဖြေ မပြန်ပေးပါ။ ထပ်ကြိုးစားပါ။');

      const parsed = response.data;
      setManualDraft((current) => ({
        ...current,
        receiveDate: parsed.received_date || current.receiveDate,
        senderName: 'KOTA',
        senderPhone: '09-',
        senderAddress: parsed.sender_loc || current.senderAddress,
        receiverName: parsed.receiver_name || current.receiverName,
        receiverPhone: parsed.receiver_phone || current.receiverPhone,
        receiverAddress: parsed.receiver_address || current.receiverAddress,
        codAmount: parsed.cod_amount || current.codAmount,
        deliFee: '0',
        payType: 'Deli',
        remark: parsed.note || current.remark,
      }));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'အချက်အလက်ဖတ်ရာတွင် အမှားဖြစ်နေပါသည်။');
    } finally {
      setIsParsing(false);
    }
  };

  const previewManual = async () => {
    if (!validDate(manualDraft.receiveDate)) {
      Alert.alert('ရက်စွဲမမှန်ပါ', 'ရက်စွဲကို YYYY-MM-DD ပုံစံဖြင့် မှန်ကန်စွာ ထည့်ပါ။');
      return;
    }
    if (!manualDraft.receiverName.trim()) {
      Alert.alert('လက်ခံသူအမည် လိုအပ်ပါသည်', 'Voucher အတွက် လက်ခံသူအမည် ထည့်ပေးပါ။');
      return;
    }
    try {
      const reference = manualQr
        ? await createManualVoucherReference()
        : null;
      setManualReference(reference);
      setManualExportId(reference ?? `manual-${Date.now()}`);
      setPage('manualVoucher');
    } catch (referenceError) {
      Alert.alert('Reference ထုတ်မရပါ', referenceError instanceof Error ? referenceError.message : 'ပြန်ကြိုးစားပါ။');
    }
  };

  const updateManual = (key: keyof ManualVoucherDraft, value: string) => {
    setManualDraft((current) => ({ ...current, [key]: value }));
  };

  const printSystem = async () => {
    if (!document) return;
    setBusy('print');
    setMessage('');
    try {
      await Print.printAsync({
        html: await buildVoucherHtml(document),
        width: 288,
        height: 432,
      });
    } catch (printError) {
      setMessage(printError instanceof Error ? printError.message : 'Voucher print မအောင်မြင်ပါ။');
    } finally {
      setBusy(null);
    }
  };

  const sharePdf = async () => {
    if (!document) return;
    setBusy('pdf');
    setMessage('');
    try {
      const { uri } = await Print.printToFileAsync({
        html: await buildVoucherHtml(document),
        width: 288,
        height: 432,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('ဤ device တွင် PDF share ကို အသုံးမပြုနိုင်ပါ။');
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Voucher · ${document.fields.itemId || document.id}`,
      });
    } catch (shareError) {
      setMessage(shareError instanceof Error ? shareError.message : 'PDF ကို မျှဝေမရပါ။');
    } finally {
      setBusy(null);
    }
  };

  const saveAndShareImage = async () => {
    if (!document) return;
    setBusy('image');
    setMessage('');
    try {
      if (Platform.OS === 'web') {
        throw new Error('Voucher image သိမ်းခြင်းကို mobile app မှာသာ အသုံးပြုနိုင်ပါသည်။');
      }
      if (!voucherPreviewRef.current) {
        throw new Error('Voucher preview အဆင်သင့်မဖြစ်သေးပါ။ ခဏစောင့်ပြီး ထပ်လုပ်ပါ။');
      }
      const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!permission.granted) {
        throw new Error('Voucher image သိမ်းရန် Gallery permission ပေးပါ။');
      }
      const scale = Math.max(PixelRatio.get(), 1);
      const imageUri = await captureRef(voucherPreviewRef, {
        result: 'tmpfile',
        format: 'png',
        quality: 1,
        width: 1200 / scale,
        height: 1800 / scale,
      });
      await MediaLibrary.createAssetAsync(imageUri);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(imageUri, {
          mimeType: 'image/png',
          dialogTitle: `Voucher Image · ${document.fields.itemId || document.id}`,
        });
      } else {
        Alert.alert('သိမ်းပြီးပါပြီ', 'Voucher image ကို Gallery ထဲသိမ်းပြီးပါပြီ။');
      }
    } catch (imageError) {
      setMessage(imageError instanceof Error ? imageError.message : 'Voucher image ကိုသိမ်းမရပါ။');
    } finally {
      setBusy(null);
    }
  };

  const goBack = () => {
    if (page === 'voucher') setPage('detail');
    else if (page === 'manualVoucher') setPage('manual');
    else if (page === 'detail') {
      setSelected(null);
      setPage('search');
    } else if (page === 'manual') setPage('search');
    else router.back();
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.mutedText}>ဝင်ရောက်မှုကို စစ်ဆေးနေပါသည်…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="နောက်သို့" onPress={goBack} style={styles.backButton}>
            <SymbolView name="chevron.left" tintColor={colors.orange} size={19} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ALL BRANCHES · PARCEL LOOKUP</Text>
            <Text style={styles.title}>{title}</Text>
          </View>
          {page !== 'voucher' && page !== 'manualVoucher' ? (
            <ComputerPrintPanel mode="setup" compact />
          ) : null}
        </View>

        {page === 'search' ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.description}>Branch မရွေးဘဲ အထုတ်အားလုံးကို Item ID, barcode, လက်ခံသူအမည် သို့မဟုတ် ဖုန်းနံပါတ်ဖြင့် ရှာပါ။</Text>
            <Pressable onPress={startManual} style={styles.manualShortcut}>
              <SymbolView name="square.and.pencil" tintColor={colors.orange} size={22} />
              <View style={styles.flex}>
                <Text style={styles.manualShortcutTitle}>Manual Voucher ထုတ်မည်</Text>
                <Text style={styles.manualShortcutSub}>အချက်အလက်ကို ကိုယ်တိုင်ဖြည့်ပါ</Text>
              </View>
              <SymbolView name="chevron.right" tintColor={colors.muted} size={17} />
            </Pressable>
            <View style={styles.searchRow}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => void search()}
                returnKeyType="search"
                placeholder="Item ID, barcode, ဖုန်း သို့ နာမည်"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
              />
              <Pressable accessibilityLabel="Barcode scan" onPress={() => void openScanner()} style={styles.scanButton}>
                <SymbolView name="qrcode.viewfinder" tintColor="#17100a" size={22} />
              </Pressable>
            </View>
            <Pressable disabled={loading} onPress={() => void search()} style={[styles.primaryButton, loading && styles.disabled]}>
              {loading ? <ActivityIndicator color="#17100a" /> : (
                <>
                  <SymbolView name="magnifyingglass" tintColor="#17100a" size={18} />
                  <Text style={styles.primaryText}>Parcel ရှာမည်</Text>
                </>
              )}
            </Pressable>
            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            {results.length ? (
              <View style={styles.resultList}>
                {results.map((order) => (
                  <ResultCard
                    key={order.id}
                    order={order}
                    onPress={() => {
                      setSelected(order);
                      setMessage('');
                      setPage('detail');
                    }}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        {page === 'detail' && selected ? (
          <>
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.detailCard}>
                <Text style={styles.cardTitle}>ပို့သူ</Text>
                <DetailField label="အမည်" value={selected.sender_name} />
                <DetailField label="ဖုန်း" value={selected.sender_phone} />
                <DetailField label="လိပ်စာ" value={selected.sender_loc} />
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.cardTitle}>လက်ခံသူ</Text>
                <DetailField label="အမည်" value={selected.receiver_name} emphasis />
                <DetailField label="ဖုန်း" value={selected.receiver_phone} emphasis />
                <DetailField label="လိပ်စာ" value={selected.receiver_address} />
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.cardTitle}>ငွေကြေး</Text>
                <DetailField label="COD" value={amount(selected.cod_amount)} />
                <DetailField label="Delivery fee" value={amount(selected.deli_fee)} />
                <DetailField label="စုစုပေါင်း" value={amount(selected.total_amount)} emphasis />
                <DetailField label="Payment" value={selected.fee_type} />
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.cardTitle}>Parcel အချက်အလက်</Text>
                <DetailField label="Item ID" value={selected.item_id} />
                <DetailField label="Barcode" value={selected.barcode} />
                <DetailField label="လက်ခံရက်" value={selected.received_date || selected.created_at?.slice(0, 10)} />
                <DetailField label="Status" value={selected.status} />
                <DetailField label="မှတ်ချက်" value={selected.remark || selected.uploader_note} />
              </View>
            </ScrollView>
            <View style={styles.bottomBar}>
              <Pressable onPress={() => setPage('voucher')} style={styles.primaryButton}>
                <SymbolView name="doc.text" tintColor="#17100a" size={18} />
                <Text style={styles.primaryText}>Voucher Preview</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {(page === 'voucher' || page === 'manualVoucher') && document ? (
          <>
            <VoucherPreview
              fields={document.fields}
              qrEnabled={document.qrEnabled}
              voucherRef={voucherPreviewRef}
            />
            <View style={styles.bottomBar}>
              <View style={styles.previewActions}>
                <ComputerPrintPanel
                  mode="print"
                  document={document}
                  buttonStyle={styles.localPrintButton}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="More voucher actions"
                  onPress={() => setMoreOpen(true)}
                  style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                >
                  <SymbolView name="ellipsis" tintColor={colors.orange} size={21} fallback={<Text style={styles.moreFallback}>•••</Text>} />
                  <Text style={styles.moreButtonText}>More</Text>
                </Pressable>
              </View>
              {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            </View>
            <Modal
              visible={moreOpen}
              transparent
              animationType="slide"
              onRequestClose={() => setMoreOpen(false)}
            >
              <View style={styles.moreBackdrop}>
                <View style={styles.moreSheet}>
                  <View style={styles.moreHeader}>
                    <View style={styles.flex}>
                      <Text style={styles.eyebrow}>VOUCHER OPTIONS</Text>
                      <Text style={styles.moreTitle}>More</Text>
                    </View>
                    <Pressable
                      accessibilityLabel="More menu ပိတ်ရန်"
                      onPress={() => setMoreOpen(false)}
                      style={styles.moreClose}
                    >
                      <SymbolView name="xmark" tintColor={colors.muted} size={18} />
                    </Pressable>
                  </View>
                  <ScrollView contentContainerStyle={styles.moreOptions}>
                    <MoreAction
                      icon="printer"
                      title="Phone မှ Print"
                      loading={busy === 'print'}
                      disabled={busy !== null}
                      onPress={() => {
                        setMoreOpen(false);
                        void printSystem();
                      }}
                    />
                    <MoreAction
                      icon="doc.text"
                      title="PDF Share"
                      loading={busy === 'pdf'}
                      disabled={busy !== null}
                      onPress={() => {
                        setMoreOpen(false);
                        void sharePdf();
                      }}
                    />
                    <MoreAction
                      icon="square.and.arrow.up"
                      title="Image Save & Share"
                      loading={busy === 'image'}
                      disabled={busy !== null}
                      onPress={() => {
                        setMoreOpen(false);
                        void saveAndShareImage();
                      }}
                    />
                    {page === 'manualVoucher' ? (
                      <MoreAction
                        icon="square.and.pencil"
                        title="Form ပြန်ပြင်ရန်"
                        onPress={() => {
                          setMoreOpen(false);
                          setPage('manual');
                        }}
                      />
                    ) : null}
                    {page === 'voucher' ? (
                      <MoreAction
                        icon="qrcode.viewfinder"
                        title="နောက်အထုတ်အတွက် Scan"
                        onPress={() => void scanNextParcel()}
                      />
                    ) : null}
                    <View style={styles.morePrinterSetup}>
                      <View style={styles.flex}>
                        <Text style={styles.moreActionTitle}>Printer ချိတ်ဆက်မှု / ရွေးချယ်မှု</Text>
                        <Text style={styles.moreActionSub}>ပုံမှန်သုံးမည့် local printer ကို သတ်မှတ်ရန်</Text>
                      </View>
                      <ComputerPrintPanel
                        mode="setup"
                        compact
                        onOpen={() => setMoreOpen(false)}
                      />
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </>
        ) : null}

        {page === 'manual' ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.modeControl}>
              {(['manual', 'kota'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: manualMode === mode }}
                  onPress={() => changeManualMode(mode)}
                  style={[styles.modeOption, manualMode === mode && styles.modeOptionActive]}
                >
                  <Text style={[styles.modeOptionText, manualMode === mode && styles.modeOptionTextActive]}>
                    {mode === 'manual' ? 'Manual' : 'Kota + AI'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {manualMode === 'kota' ? (
              <View style={styles.aiPanel}>
                <Text style={styles.cardTitle}>KOTA စာသားကို ကူးထည့်ပါ</Text>
                <TextInput
                  value={pastedMessage}
                  onChangeText={setPastedMessage}
                  multiline
                  maxLength={10_000}
                  placeholder={'Nov 4 pg\nNang Seng Laung\n09895108014\nလိပ်စာ...\nFiber 1 = 45500\nDeli = 4500\nTotal = 50,000 ks\nဖုန်းကြိုဆက်ပီး ပို့ရန်'}
                  placeholderTextColor={colors.muted}
                  textAlignVertical="top"
                  style={styles.aiInput}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={isParsing}
                  onPress={() => void parseKotaMessage()}
                  style={({ pressed }) => [styles.aiButton, (pressed || isParsing) && styles.disabled]}
                >
                  {isParsing ? <ActivityIndicator color="#17100a" /> : null}
                  <Text style={styles.aiButtonText}>{isParsing ? 'AI ဖတ်နေသည်…' : 'AI ဖြင့် အချက်အလက်ထည့်ရန်'}</Text>
                </Pressable>
                {parseError ? <Text accessibilityRole="alert" style={styles.parseError}>{parseError}</Text> : null}
              </View>
            ) : (
              <Text style={styles.description}>Parcel record မရှာဘဲ voucher အချက်အလက်ကို ကိုယ်တိုင်ဖြည့်ပါ။</Text>
            )}
            <View style={styles.detailCard}>
              <Text style={styles.cardTitle}>VOUCHER</Text>
              <ManualInput label="Date (YYYY-MM-DD)" value={manualDraft.receiveDate} onChangeText={(value) => updateManual('receiveDate', value)} />
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.cardTitle}>FROM · ပို့သူ</Text>
              <ManualInput label="ပို့သူအမည်" value={manualDraft.senderName} onChangeText={(value) => updateManual('senderName', value)} />
              <ManualInput label="ပို့သူဖုန်း" value={manualDraft.senderPhone} keyboardType="phone-pad" onChangeText={(value) => updateManual('senderPhone', value)} />
              <ManualInput label={manualMode === 'kota' ? 'ပစ္စည်း / မြို့' : 'ပို့သူလိပ်စာ'} value={manualDraft.senderAddress} multiline onChangeText={(value) => updateManual('senderAddress', value)} />
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.cardTitle}>TO · လက်ခံသူ</Text>
              <ManualInput label="လက်ခံသူအမည်" value={manualDraft.receiverName} onChangeText={(value) => updateManual('receiverName', value)} />
              <ManualInput label="လက်ခံသူဖုန်း" value={manualDraft.receiverPhone} keyboardType="phone-pad" onChangeText={(value) => updateManual('receiverPhone', value)} />
              <ManualInput label="လက်ခံသူလိပ်စာ" value={manualDraft.receiverAddress} multiline onChangeText={(value) => updateManual('receiverAddress', value)} />
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.cardTitle}>PAYMENT</Text>
              <View style={styles.moneyInputs}>
                <View style={styles.moneyInput}>
                  <ManualInput label="COD" value={manualDraft.codAmount} keyboardType="decimal-pad" onChangeText={(value) => updateManual('codAmount', value)} />
                </View>
                <View style={styles.moneyInput}>
                  <ManualInput label="Delivery Fee" value={manualDraft.deliFee} keyboardType="decimal-pad" onChangeText={(value) => updateManual('deliFee', value)} />
                </View>
              </View>
              <ManualInput label="Payment Type" value={manualDraft.payType} onChangeText={(value) => updateManual('payType', value)} />
              <Text style={styles.totalLine}>TOTAL · {calculateManualVoucherTotal(manualDraft.codAmount, manualDraft.deliFee).toLocaleString('en-US')} Ks</Text>
            </View>
            <View style={styles.detailCard}>
              <View style={styles.qrToggle}>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>QR / Unique Reference</Text>
                  <Text style={styles.description}>{manualQr ? '99 ဖြင့်စသော 13 လုံး reference နှင့် QR ထည့်မည်။' : 'Reference နှင့် QR မထည့်ပါ။'}</Text>
                </View>
                <Switch value={manualQr} onValueChange={setManualQr} />
              </View>
              <ManualInput label="မှတ်ချက်" value={manualDraft.remark} multiline onChangeText={(value) => updateManual('remark', value)} />
            </View>
            <Pressable onPress={() => void previewManual()} style={styles.primaryButton}>
              <SymbolView name="eye" tintColor="#17100a" size={18} />
              <Text style={styles.primaryText}>Voucher Preview</Text>
            </Pressable>
          </ScrollView>
        ) : null}

        <Modal
          visible={scannerOpen}
          animationType="slide"
          onRequestClose={() => {
            scanLockedRef.current = false;
            setScanLocked(false);
            setScannerOpen(false);
          }}
        >
          <View style={styles.scanner}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              onBarcodeScanned={scanLocked ? undefined : scanParcel}
            />
            <Pressable
              accessibilityLabel="Scanner ပိတ်ရန်"
              onPress={() => {
                scanLockedRef.current = false;
                setScanLocked(false);
                setScannerOpen(false);
              }}
              style={styles.scannerClose}
            >
              <SymbolView name="xmark" tintColor="#ffffff" size={20} />
            </Pressable>
            <View style={styles.scanFrame} />
            <View style={styles.scanCopy}>
              <Text style={styles.scanTitle}>Parcel barcode scan</Text>
              <Text style={styles.scanSub}>Parcel item ID သို့မဟုတ် barcode ကိုဘောင်ထဲတွင်ချိန်ပါ။</Text>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const colors = {
  background: '#090909',
  surface: '#141414',
  border: '#292929',
  orange: '#ff9b47',
  white: '#f7f4f1',
  muted: '#aaa39c',
  green: '#54d49a',
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  mutedText: { color: colors.muted },
  header: { minHeight: 76, paddingHorizontal: 15, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#21170f' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  title: { color: colors.white, fontSize: 17, fontWeight: '800', marginTop: 4 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 28, gap: 13 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  modeControl: { flexDirection: 'row', gap: 4, padding: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  modeOption: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  modeOptionActive: { backgroundColor: '#f97316' },
  modeOptionText: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  modeOptionTextActive: { color: '#17100a' },
  aiPanel: { padding: 14, gap: 11, borderWidth: 1, borderColor: '#49301f', borderRadius: 16, backgroundColor: '#15110e' },
  aiInput: { minHeight: 150, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.white, backgroundColor: '#0c0c0c', fontSize: 13, lineHeight: 19 },
  aiButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 13, backgroundColor: '#f97316' },
  aiButtonText: { color: '#17100a', fontSize: 13, fontWeight: '900' },
  parseError: { color: '#ff8273', fontSize: 12, lineHeight: 18 },
  manualShortcut: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 17, backgroundColor: colors.surface },
  manualShortcutTitle: { color: colors.white, fontSize: 14, fontWeight: '800' },
  manualShortcutSub: { color: colors.muted, fontSize: 11, marginTop: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 15, color: colors.white, backgroundColor: colors.surface, fontSize: 13 },
  scanButton: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#f97316' },
  primaryButton: { minHeight: 50, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 15, backgroundColor: '#f97316' },
  primaryText: { color: '#17100a', fontSize: 14, fontWeight: '900' },
  secondaryButton: { minHeight: 45, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  secondaryText: { color: colors.orange, fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  message: { color: colors.orange, fontSize: 12, lineHeight: 18 },
  resultList: { gap: 9, marginTop: 5 },
  resultCard: { minHeight: 76, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  resultIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#2a1b11' },
  resultCopy: { flex: 1, gap: 4 },
  resultLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  resultCode: { flex: 1, color: colors.white, fontSize: 12, fontWeight: '800' },
  resultStatus: { color: colors.orange, fontSize: 10, fontWeight: '700' },
  resultName: { color: colors.white, fontSize: 13, fontWeight: '700' },
  resultMeta: { color: colors.muted, fontSize: 10 },
  detailCard: { padding: 14, gap: 8, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardTitle: { color: colors.orange, fontSize: 12, fontWeight: '900', marginBottom: 3 },
  detailField: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  detailLabel: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  detailValue: { color: colors.white, fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 3 },
  emphasis: { color: colors.orange, fontWeight: '800' },
  bottomBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  localPrintButton: { flex: 1, minWidth: 0 },
  moreButton: { minHeight: 50, minWidth: 78, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface },
  moreButtonText: { color: colors.orange, fontSize: 13, fontWeight: '800' },
  moreFallback: { color: colors.orange, fontSize: 19, lineHeight: 20 },
  moreBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000aa' },
  moreSheet: { maxHeight: '78%', paddingTop: 20, paddingHorizontal: 18, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.background },
  moreHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  moreTitle: { color: colors.white, fontSize: 19, fontWeight: '800', marginTop: 4 },
  moreClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.surface },
  moreOptions: { gap: 9, paddingBottom: 30 },
  moreAction: { minHeight: 54, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  moreActionIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#2a1b11' },
  moreActionTitle: { flex: 1, color: colors.white, fontSize: 13, fontWeight: '700' },
  moreActionSub: { color: colors.muted, fontSize: 10, marginTop: 4 },
  morePrinterSetup: { minHeight: 58, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  previewScroll: { padding: 16, paddingTop: 8, paddingBottom: 120 },
  paper: { width: '100%', maxWidth: 420, aspectRatio: 2 / 3, padding: 12, backgroundColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, elevation: 7 },
  paperHeader: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingBottom: 6 },
  paperLogo: { width: 24, height: 24 },
  paperBrand: { color: '#000', fontSize: 15, fontWeight: '800' },
  paperDate: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  bold: { fontWeight: '800' },
  paperItem: { fontFamily: 'monospace', fontSize: 11, fontWeight: '900' },
  officeRow: { marginTop: 8, flexDirection: 'row', gap: 5, minHeight: 54 },
  officeRowNoQr: { paddingRight: 5 },
  officeNames: { width: 65, justifyContent: 'space-between' },
  officeRule: { width: 1, backgroundColor: '#000' },
  officeCopy: { flex: 1, justifyContent: 'space-between' },
  officeCopyText: { color: '#000', fontSize: 7 },
  paperQr: { width: 52, height: 52 },
  paperSection: { marginTop: 9, paddingVertical: 3, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000', color: '#000', fontSize: 10, fontWeight: '800', letterSpacing: 2, textAlign: 'center' },
  toSection: { fontSize: 12 },
  paperFields: { paddingVertical: 5, gap: 3 },
  paperField: { flexDirection: 'row' },
  paperFieldSpaced: { marginBottom: 5 },
  paperFieldLabel: { width: 64, paddingRight: 8, color: '#000', fontSize: 9, fontWeight: '700', textAlign: 'right' },
  paperFieldValue: { flex: 1, color: '#000', fontSize: 9 },
  paperFieldStrong: { fontWeight: '700' },
  paperAddress: { minHeight: 58, paddingTop: 3, paddingBottom: 5 },
  moneyBox: { marginTop: 5, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000' },
  moneyRow: { minHeight: 29, flexDirection: 'row', alignItems: 'center' },
  moneyLabel: { width: 72, paddingRight: 8, color: '#000', fontSize: 10, fontWeight: '700', textAlign: 'right' },
  moneyRule: { width: 1, alignSelf: 'stretch', backgroundColor: '#000' },
  moneyContent: { flex: 1, paddingLeft: 12, paddingRight: 6, flexDirection: 'row', justifyContent: 'space-between' },
  moneyValue: { color: '#000', fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
  moneyRight: { color: '#000', fontSize: 9, fontWeight: '700' },
  dashed: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#000' },
  totalRow: { borderTopWidth: 1, borderColor: '#000' },
  totalText: { fontSize: 13, fontWeight: '900' },
  moneyBottom: { borderTopWidth: 1, borderColor: '#000' },
  remark: { flex: 1, minHeight: 78, paddingTop: 5 },
  remarkTitle: { color: '#000', textAlign: 'center', fontSize: 10, fontWeight: '700' },
  dotted: { marginTop: 3, borderTopWidth: 1, borderStyle: 'dotted', borderColor: '#9CA3AF' },
  remarkValue: { height: 58, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  remarkBottom: { paddingTop: 25, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: '#9CA3AF' },
  remarkLarge: { color: '#000', fontSize: 16, textAlign: 'center' },
  remarkMedium: { color: '#000', fontSize: 11, textAlign: 'center' },
  remarkSmall: { color: '#000', fontSize: 9, textAlign: 'center' },
  previewHint: { marginTop: 14, color: '#B5BBCB', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  linkButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  inputGroup: { gap: 6, marginTop: 7 },
  inputLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  input: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.white, backgroundColor: '#0c0c0c', fontSize: 13 },
  multiline: { minHeight: 74, paddingTop: 10 },
  moneyInputs: { flexDirection: 'row', gap: 9 },
  moneyInput: { flex: 1 },
  totalLine: { color: colors.orange, fontSize: 15, fontWeight: '900', textAlign: 'right', marginTop: 8 },
  qrToggle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pressed: { opacity: 0.78 },
  scanner: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000' },
  scannerClose: { position: 'absolute', top: 54, right: 18, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#00000080' },
  scanFrame: { position: 'absolute', top: '50%', left: '50%', width: 270, height: 200, transform: [{ translateX: -135 }, { translateY: -100 }], borderWidth: 2, borderColor: colors.orange, borderRadius: 22 },
  scanCopy: { paddingHorizontal: 24, paddingBottom: 60, alignItems: 'center' },
  scanTitle: { color: colors.white, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  scanSub: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 },
});
