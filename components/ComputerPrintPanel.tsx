import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { SymbolView } from '@/components/AppSymbol';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  clearPrintBridgeSettings,
  listPrintBridgePrinters,
  loadPrintBridgeSettings,
  pairPrintBridge,
  savePrintBridgeSettings,
  sendBridgeVoucher,
  type PrintBridgeSettings,
} from '@/lib/windows-print-bridge';
import type { VoucherOutputDocument } from '@/lib/voucher-template';
import {
  parsePrintBridgeQr,
  type PrintBridgeConnection,
  type PrintBridgePaper,
  type PrintBridgePrinter,
} from '@/shared/windows-print-bridge';

type PanelMode = 'setup' | 'print';

function resolvePrinter(
  printers: PrintBridgePrinter[],
  printerId: string | null,
): PrintBridgePrinter | null {
  return printers.find((printer) => printer.id === printerId) ??
    printers.find((printer) => printer.isDefault) ??
    printers[0] ??
    null;
}

export function ComputerPrintPanel({
  mode,
  document,
  compact = false,
  onOpen,
  buttonStyle,
}: {
  mode: PanelMode;
  document?: VoucherOutputDocument;
  compact?: boolean;
  onOpen?: () => void;
  buttonStyle?: StyleProp<ViewStyle>;
}) {
  const [visible, setVisible] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [settings, setSettings] = useState<PrintBridgeSettings | null>(null);
  const [printers, setPrinters] = useState<PrintBridgePrinter[]>([]);
  const [paper, setPaper] = useState<PrintBridgePaper | null>(null);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'pair' | 'refresh' | 'print' | null>(null);
  const [error, setError] = useState('');
  const scannerLocked = useRef(false);

  const selectedPrinter = useMemo(
    () => resolvePrinter(printers, settings?.printerId ?? null),
    [printers, settings?.printerId],
  );
  const setupMode = mode === 'setup';

  const refreshPrinters = async (
    connection: PrintBridgeConnection,
    savedPrinterId: string | null,
  ) => {
    setBusy('refresh');
    setError('');
    try {
      const nextPrinters = await listPrintBridgePrinters(connection);
      const printer = resolvePrinter(nextPrinters, savedPrinterId);
      const nextSettings = await savePrintBridgeSettings({
        connection,
        printerId: printer?.id ?? null,
      });
      setSettings(nextSettings);
      setPrinters(nextPrinters);
      if (printer) {
        setPaper(
          printer.papers.find((item) => item.id === '4x6') ??
            printer.papers[0] ??
            null,
        );
      } else {
        setPaper(null);
      }
      return printer;
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let active = true;
    loadPrintBridgeSettings()
      .then((saved) => {
        if (!active || !saved) return;
        setSettings(saved);
        setBusy('refresh');
        return listPrintBridgePrinters(saved.connection)
          .then((nextPrinters) => {
            if (!active) return;
            setPrinters(nextPrinters);
            const printer = resolvePrinter(nextPrinters, saved.printerId);
            setPaper(
              printer?.papers.find((item) => item.id === '4x6') ??
                printer?.papers[0] ??
                null,
            );
          })
          .catch((loadError: unknown) => {
            if (active) {
              setError(loadError instanceof Error ? loadError.message : 'Printer မရရှိပါ။');
            }
          })
          .finally(() => {
            if (active) setBusy(null);
          });
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Printer setting ကိုဖတ်မရပါ။');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!visible || mode !== 'print') return;
    let active = true;
    const loadCurrentPrinter = async () => {
      setBusy('refresh');
      setError('');
      try {
        const currentSettings = await loadPrintBridgeSettings();
        if (!active) return;
        setSettings(currentSettings);
        if (!currentSettings) {
          setPrinters([]);
          setPaper(null);
          return;
        }
        const nextPrinters = await listPrintBridgePrinters(currentSettings.connection);
        if (!active) return;
        setPrinters(nextPrinters);
        const printer = resolvePrinter(nextPrinters, currentSettings.printerId);
        setPaper(
          printer?.papers.find((item) => item.id === '4x6') ??
            printer?.papers[0] ??
            null,
        );
      } catch (refreshError) {
        if (active) setError(refreshError instanceof Error ? refreshError.message : 'Printer စာရင်းကို ဖတ်မရပါ။');
      } finally {
        if (active) setBusy(null);
      }
    };
    void loadCurrentPrinter();
    return () => {
      active = false;
    };
  }, [mode, visible]);

  const openScanner = async () => {
    try {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          Alert.alert('Camera permission လိုအပ်ပါသည်', 'Print Bridge QR ကိုဖတ်ရန် Camera permission ပေးပါ။');
          return;
        }
      }
      scannerLocked.current = false;
      setScanLocked(false);
      setScannerOpen(true);
    } catch (permissionError) {
      Alert.alert('Camera ဖွင့်မရပါ', permissionError instanceof Error ? permissionError.message : 'Camera permission ကို စစ်ဆေးပါ။');
    }
  };

  const connect = async (connection: PrintBridgeConnection) => {
    setBusy('pair');
    setError('');
    try {
      const paired = await pairPrintBridge(connection);
      const printer = resolvePrinter(paired.printers, null);
      const nextSettings = await savePrintBridgeSettings({
        connection: paired.connection,
        printerId: printer?.id ?? null,
      });
      setSettings(nextSettings);
      setPrinters(paired.printers);
      setPaper(
        printer?.papers.find((item) => item.id === '4x6') ??
          printer?.papers[0] ??
          null,
      );
      setScannerOpen(false);
      setAddress('');
      setToken('');
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Windows Print Bridge ကို စစ်ဆေးပါ။');
    } finally {
      setBusy(null);
      scannerLocked.current = false;
      setScanLocked(false);
    }
  };

  const handlePairQr = ({ data }: BarcodeScanningResult) => {
    if (scannerLocked.current) return;
    scannerLocked.current = true;
    setScanLocked(true);
    try {
      void connect(parsePrintBridgeQr(data));
    } catch (parseError) {
      scannerLocked.current = false;
      setScanLocked(false);
      Alert.alert('QR code မမှန်ပါ', parseError instanceof Error ? parseError.message : 'Bridge QR ကို ပြန်ဖတ်ပါ။');
    }
  };

  const choosePrinter = async (printer: PrintBridgePrinter) => {
    if (!settings) return;
    try {
      const next = await savePrintBridgeSettings({
        connection: settings.connection,
        printerId: printer.id,
      });
      setSettings(next);
      setPaper(
        printer.papers.find((item) => item.id === '4x6') ??
          printer.papers[0] ??
          null,
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Printer setting ကို သိမ်းမရပါ။');
    }
  };

  const print = async () => {
    if (!settings || !selectedPrinter || !paper || !document) return;
    setBusy('print');
    setError('');
    try {
      const result = await sendBridgeVoucher(
        settings.connection,
        document,
        selectedPrinter.id,
        paper,
      );
      Alert.alert(
        'Print job ပို့ပြီးပါပြီ',
        `${result.jobId} ကို ${selectedPrinter.name} သို့ ပို့ထားပါသည်။`,
      );
      setVisible(false);
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : 'Printer ကိုစစ်ပြီး ပြန်ကြိုးစားပါ။');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    try {
      await clearPrintBridgeSettings();
      setSettings(null);
      setPrinters([]);
      setPaper(null);
      setError('');
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Printer connection ကိုဖယ်မရပါ။');
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={setupMode
          ? settings ? 'Printer ချိတ်ထားသည်။ Printer setting ဖွင့်ရန်။' : 'Printer ချိတ်မည်။ Printer setting ဖွင့်ရန်။'
          : 'Local Printer ဖြင့် ထုတ်မည်'}
        onPress={() => {
          onOpen?.();
          setVisible(true);
        }}
        style={({ pressed }) => [
          styles.openButton,
          setupMode && styles.setupButton,
          setupMode && compact && styles.compactSetupButton,
          buttonStyle,
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={setupMode ? 'desktopcomputer' : 'printer.fill'}
          tintColor={setupMode ? settings ? colors.green : colors.orange : '#17100a'}
          size={19}
          fallback={<Text style={styles.fallback}>▣</Text>}
        />
        {setupMode && compact ? (
          <View style={[styles.connectionDot, settings ? styles.connectedDot : styles.disconnectedDot]} />
        ) : (
          <Text style={[styles.openLabel, setupMode && styles.setupLabel]}>
            {setupMode
              ? settings ? 'Printer ချိတ်ထားသည်' : 'Printer ချိတ်မည်'
              : 'Local Printer ဖြင့် ထုတ်မည်'}
          </Text>
        )}
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.flex}>
                <Text style={styles.kicker}>LOCAL NETWORK PRINT</Text>
                <Text style={styles.title}>
                  {setupMode ? 'Computer Printer ချိတ်ရန်' : 'Local Printer ဖြင့် ထုတ်ရန်'}
                </Text>
              </View>
              <Pressable accessibilityLabel="ပိတ်ရန်" onPress={() => setVisible(false)} style={styles.closeButton}>
                <SymbolView name="xmark" tintColor={colors.muted} size={18} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              {settings ? (
                <>
                  <View style={styles.connection}>
                    <SymbolView name="laptopcomputer" tintColor={colors.green} size={20} />
                    <View style={styles.flex}>
                      <Text style={styles.connectionName}>{settings.connection.deviceName}</Text>
                      <Text style={styles.connectionAddress}>{settings.connection.address}</Text>
                    </View>
                    {setupMode ? (
                      <Pressable onPress={() => void disconnect()}>
                        <Text style={styles.disconnect}>ပြောင်းမည်</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {setupMode ? (
                    <>
                      <Text style={styles.hint}>ဖုန်းနဲ့ Windows computer ကို Wi-Fi တစ်ခုတည်း ချိတ်ပါ။ Computer ပေါ်က AIO Print Bridge QR ကို scan လုပ်ပါ။</Text>
                      <Pressable
                        onPress={() => {
                          void refreshPrinters(settings.connection, settings.printerId)
                            .catch((refreshError: unknown) => {
                              setError(refreshError instanceof Error ? refreshError.message : 'Printer စာရင်းကို ဖတ်မရပါ။');
                            });
                        }}
                        style={styles.secondary}
                      >
                        {busy === 'refresh' ? <ActivityIndicator color={colors.orange} /> : <Text style={styles.secondaryText}>Printer စာရင်း ပြန်စစ်ရန်</Text>}
                      </Pressable>
                      <Text style={styles.sectionLabel}>PRINTER · ပုံမှန်သုံးမည့် printer</Text>
                      {printers.map((printer) => (
                        <Pressable
                          key={printer.id}
                          onPress={() => void choosePrinter(printer)}
                          style={[styles.printerRow, selectedPrinter?.id === printer.id && styles.printerSelected]}
                        >
                          <View style={styles.flex}>
                            <Text style={styles.printerName}>{printer.name}</Text>
                            <Text style={styles.printerMeta}>{printer.isDefault ? 'Windows default' : 'Windows printer'}</Text>
                          </View>
                          {selectedPrinter?.id === printer.id ? (
                            <SymbolView name="checkmark.circle.fill" tintColor={colors.orange} size={20} />
                          ) : null}
                        </Pressable>
                      ))}
                    </>
                  ) : (
                    <>
                      <View style={styles.connection}>
                        <SymbolView name="printer.fill" tintColor={colors.green} size={18} />
                        <View style={styles.flex}>
                          <Text style={styles.connectionName}>{selectedPrinter?.name ?? 'Printer မရွေးရသေးပါ'}</Text>
                          <Text style={styles.connectionAddress}>{settings.connection.deviceName}</Text>
                        </View>
                      </View>
                      <Text style={styles.sectionLabel}>PAPER SIZE</Text>
                      <View style={styles.paperRow}>
                        {selectedPrinter?.papers.map((item) => (
                          <Pressable
                            key={`${item.id}-${item.widthMicrons}`}
                            onPress={() => setPaper(item)}
                            style={[styles.paperChip, paper?.id === item.id && styles.paperSelected]}
                          >
                            <Text style={[styles.paperText, paper?.id === item.id && styles.paperTextSelected]}>{item.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable
                        disabled={busy === 'print' || !selectedPrinter || !paper}
                        onPress={() => void print()}
                        style={[styles.primary, (!selectedPrinter || !paper) && styles.disabled]}
                      >
                        {busy === 'print' ? <ActivityIndicator color="#17100a" /> : (
                          <>
                            <SymbolView name="printer.fill" tintColor="#17100a" size={19} />
                            <Text style={styles.primaryText}>Voucher ကို printer သို့ပို့မည်</Text>
                          </>
                        )}
                      </Pressable>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.hint}>Windows computer တွင် Print Bridge ကိုဖွင့်ပြီး phone နှင့် တူညီသော Wi-Fi network ပေါ်ရှိစေပါ။</Text>
                  <Pressable disabled={busy === 'pair'} onPress={() => void openScanner()} style={styles.primary}>
                    {busy === 'pair' ? <ActivityIndicator color="#17100a" /> : (
                      <>
                        <SymbolView name="qrcode.viewfinder" tintColor="#17100a" size={20} />
                        <Text style={styles.primaryText}>Computer QR ကို scan လုပ်မည်</Text>
                      </>
                    )}
                  </Pressable>
                  <Text style={styles.or}>ЭСВЭЛ · MANUAL CONNECT</Text>
                  <TextInput
                    value={address}
                    onChangeText={setAddress}
                    placeholder="192.168.1.10:4318"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
                    style={styles.input}
                  />
                  <TextInput
                    value={token}
                    onChangeText={setToken}
                    placeholder="Computer QR ထဲက pairing token"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <Pressable
                    disabled={busy === 'pair' || !address.trim() || !token.trim()}
                    onPress={() => void connect({ address, token, deviceName: 'Windows Print Bridge' })}
                    style={[styles.secondary, (busy === 'pair' || !address.trim() || !token.trim()) && styles.disabled]}
                  >
                    <Text style={styles.secondaryText}>{busy === 'pair' ? 'ချိတ်ဆက်နေသည်…' : 'Computer ကိုချိတ်မည်'}</Text>
                  </Pressable>
                </>
              )}
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              {setupMode && settings && printers.length === 0 && !busy ? (
                <Text style={styles.hint}>Windows computer တွင် printer တပ်ဆင်ထားခြင်းနှင့် Print Bridge ဖွင့်ထားခြင်းကို စစ်ပါ။</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={scannerOpen}
        animationType="slide"
        onRequestClose={() => {
          scannerLocked.current = false;
          setScanLocked(false);
          setScannerOpen(false);
        }}
      >
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanLocked ? undefined : handlePairQr}
          />
          <Pressable
            accessibilityLabel="Scanner ပိတ်ရန်"
            onPress={() => {
              scannerLocked.current = false;
              setScanLocked(false);
              setScannerOpen(false);
            }}
            style={styles.scannerClose}
          >
            <SymbolView name="xmark" tintColor="#ffffff" size={20} />
          </Pressable>
          <View style={styles.scanFrame} />
          <View style={styles.scanCopy}>
            <Text style={styles.scanTitle}>Print Bridge QR ကို scan လုပ်ပါ</Text>
            <Text style={styles.scanSub}>Windows computer ပေါ်က QR ကို ဘောင်အတွင်းထားပါ။</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const colors = {
  background: '#090909',
  surface: '#171411',
  border: '#3a281b',
  orange: '#ff9b47',
  muted: '#aaa39c',
  white: '#f7f4f1',
  green: '#54d49a',
  red: '#ff8273',
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  openButton: {
    minHeight: 50,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 15,
    backgroundColor: '#f97316',
  },
  compactSetupButton: { width: 38, minHeight: 38, height: 38, paddingHorizontal: 0, borderRadius: 13 },
  connectionDot: { position: 'absolute', right: 6, top: 6, width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: colors.background },
  connectedDot: { backgroundColor: colors.green },
  disconnectedDot: { backgroundColor: colors.orange },
  setupButton: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fallback: { color: colors.orange, fontSize: 20 },
  openLabel: { color: '#17100a', fontSize: 14, fontWeight: '800' },
  setupLabel: { color: colors.orange, fontSize: 12 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000aa' },
  sheet: {
    maxHeight: '88%',
    paddingTop: 19,
    paddingHorizontal: 18,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: colors.background,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  kicker: { color: colors.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: colors.white, fontSize: 18, fontWeight: '800', marginTop: 4 },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.surface },
  content: { gap: 12, paddingBottom: 28 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 4 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  connectionName: { color: colors.white, fontSize: 14, fontWeight: '800' },
  connectionAddress: { color: colors.muted, fontSize: 11, marginTop: 4 },
  disconnect: { color: colors.orange, fontSize: 12, fontWeight: '700' },
  sectionLabel: { color: colors.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginTop: 9 },
  printerRow: { minHeight: 58, padding: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  printerSelected: { borderColor: colors.orange },
  printerName: { color: colors.white, fontSize: 13, fontWeight: '700' },
  printerMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  paperRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paperChip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  paperSelected: { backgroundColor: '#352114', borderColor: colors.orange },
  paperText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  paperTextSelected: { color: colors.orange },
  primary: { minHeight: 50, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 15, backgroundColor: '#f97316' },
  primaryText: { color: '#17100a', fontSize: 13, fontWeight: '900' },
  secondary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  secondaryText: { color: colors.orange, fontSize: 13, fontWeight: '800' },
  or: { color: colors.muted, textAlign: 'center', fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginVertical: 2 },
  input: { minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 13, color: colors.white, backgroundColor: colors.surface, fontSize: 13 },
  error: { color: colors.red, fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76 },
  scanner: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000' },
  scannerClose: { position: 'absolute', top: 54, right: 18, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#00000080' },
  scanFrame: { width: 260, height: 260, alignSelf: 'center', marginBottom: 38, borderWidth: 2, borderColor: colors.orange, borderRadius: 24 },
  scanCopy: { paddingHorizontal: 24, paddingBottom: 60, alignItems: 'center' },
  scanTitle: { color: colors.white, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  scanSub: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
});
