import { SymbolView } from '@/components/AppSymbol';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    createQueueItem,
    deleteIntakeQueueItem,
    enqueueIntake,
    findOrderByBarcode,
    getIntakeQueue,
    processIntakeItem,
    setIntakeQueueStatus,
    type IntakeImage,
    type IntakeQueueItem,
} from '@/lib/intake';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

type IntakeMode = 'without-barcode' | 'with-barcode';
type Screen = 'choose' | 'camera' | 'review' | 'queue';

const colors = {
  background: '#09090b',
  card: '#18181b',
  border: '#27272a',
  text: '#fafafa',
  muted: '#a1a1aa',
  orange: '#f97316',
  orangeLight: '#ffad70',
  amber: '#fbbf24',
  red: '#f87171',
  green: '#34d399',
};

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
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

function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDateKey(value: string): string {
  const date = parseDateKey(value);
  return date ? date.toLocaleDateString('en-GB') : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function createImage(uri: string, width: number, height: number, barcode: string | null): IntakeImage {
  return {
    id: `image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    uri,
    width,
    height,
    barcode,
    quality: 'HD',
  };
}

function largestPictureSize(sizes: string[]): string | undefined {
  return sizes.reduce<{ size: string; pixels: number } | undefined>((largest, size) => {
    const dimensions = /^(\d+)\s*x\s*(\d+)$/i.exec(size);
    if (!dimensions) return largest;

    const pixels = Number(dimensions[1]) * Number(dimensions[2]);
    return !largest || pixels > largest.pixels ? { size, pixels } : largest;
  }, undefined)?.size;
}

export default function IntakeScreen() {
  const { screen: requestedScreen } = useLocalSearchParams<{ screen?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const barcodeBeepPlayer = useAudioPlayer(require('../../assets/audio/barcode-beep.wav'));
  const cameraRef = useRef<CameraView>(null);
  const barcodeCheckInProgress = useRef(false);
  const queueRunInProgress = useRef(false);
  const cameraSizeRequestId = useRef(0);
  const queueItemErrorsRef = useRef<Record<string, string>>({});
  const notificationPermissionAsked = useRef(false);

  const [screen, setScreen] = useState<Screen>('choose');
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('without-barcode');
  const [barcodeStep, setBarcodeStep] = useState<'scanning' | 'capturing'>('scanning');
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [cameraPictureSize, setCameraPictureSize] = useState<string>();
  const [cameraSizeError, setCameraSizeError] = useState('');
  const [capturedDockMinimized, setCapturedDockMinimized] = useState(false);
  const [images, setImages] = useState<IntakeImage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { branch } = useAuth();
  const [receivedDate, setReceivedDate] = useState(today);
  const [receivedDatePickerVisible, setReceivedDatePickerVisible] = useState(false);
  const [receivedDateDraft, setReceivedDateDraft] = useState(new Date());
  const [note, setNote] = useState('');
  const [transitToYgn, setTransitToYgn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [queue, setQueue] = useState<IntakeQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueItemErrors, setQueueItemErrors] = useState<Record<string, string>>({});
  const [queueStatus, setQueueStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [queueError, setQueueError] = useState('');

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch((error: unknown) => {
      console.error('Unable to configure barcode scan sound:', error);
    });
  }, []);

  const activeScreen: Screen = requestedScreen === 'queue' ? 'queue' : screen;
  const selectedImage = images[selectedIndex];

  const configureLargestPictureSize = async () => {
    const requestId = ++cameraSizeRequestId.current;
    setCameraReady(false);
    setCameraSizeError('');
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      if (requestId !== cameraSizeRequestId.current) return;
      const size = sizes?.length ? largestPictureSize(sizes) : undefined;
      if (size) setCameraPictureSize(size);
      setCameraReady(true);
    } catch (error) {
      if (requestId !== cameraSizeRequestId.current) return;
      console.error('Unable to select the largest camera picture size:', error);
      setCameraSizeError('အကြီးဆုံး camera size ကို ရွေးမရပါ။ Default size ဖြင့် ရိုက်နေပါတယ်။');
      setCameraReady(true);
    }
  };

  const refreshQueue = useCallback(async () => {
    const items = await getIntakeQueue();
    setQueue(items);
    return items;
  }, []);

  const runQueue = useCallback(async (
    itemId?: string,
    askForNotificationPermission = true,
  ) => {
    if (queueRunInProgress.current) return;
    queueRunInProgress.current = true;
    setQueueLoading(true);
    setQueueStatus('uploading');
    setIntakeQueueStatus('uploading');
    setQueueError('');

    let canNotify = false;
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('intake-uploads', {
          name: 'Parcel uploads',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const existingPermission = await Notifications.getPermissionsAsync();
        let notificationPermission = existingPermission;
        if (
          !notificationPermission.granted &&
          askForNotificationPermission &&
          !notificationPermissionAsked.current &&
          notificationPermission.canAskAgain
        ) {
          notificationPermissionAsked.current = true;
          notificationPermission = await Notifications.requestPermissionsAsync();
        }
        canNotify = notificationPermission.granted;
      }
    } catch (error) {
      console.error('Unable to check notification permission:', error);
    }

    try {
      const items = await getIntakeQueue();
      const itemsToProcess = itemId ? items.filter((item) => item.id === itemId) : items;
      let uploadedCount = 0;

      for (const item of itemsToProcess) {
        setQueueItemErrors((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        delete queueItemErrorsRef.current[item.id];
        try {
          await processIntakeItem(item);
          await deleteIntakeQueueItem(item.id);
          uploadedCount += 1;
          setQueue((current) => current.filter((entry) => entry.id !== item.id));
        } catch (error) {
          const message = errorMessage(error);
          console.error(`Unable to upload intake image ${item.id}:`, error);
          queueItemErrorsRef.current = { ...queueItemErrorsRef.current, [item.id]: message };
          setQueueItemErrors((current) => ({ ...current, [item.id]: message }));
        }
      }

      const remainingItems = await getIntakeQueue();
      setQueue(remainingItems);
      const remainingFailedCount = remainingItems.filter(
        (item) => Boolean(queueItemErrorsRef.current[item.id]),
      ).length;
      if (remainingFailedCount > 0) {
        setQueueError(`${remainingFailedCount} ပုံ တင်မအောင်မြင်ပါ။ အဲဒီပုံများကို တစ်ပုံချင်း ပြန်တင်နိုင်ပါတယ်။`);
        setQueueStatus('error');
        setIntakeQueueStatus('failed');
      } else if (remainingItems.length === 0) {
        setQueueError('');
        setQueueStatus('success');
        setIntakeQueueStatus(uploadedCount > 0 ? 'completed' : 'idle');
      } else {
        setQueueError('');
        setQueueStatus('idle');
        setIntakeQueueStatus('idle');
      }

      if (itemsToProcess.length > 0) {
        const title = remainingFailedCount > 0 ? 'Parcel upload incomplete' : 'Parcel upload complete';
        const body = remainingFailedCount > 0
          ? `${uploadedCount} uploaded · ${remainingFailedCount} failed. Retry failed photos from the queue.`
          : `${uploadedCount} parcel photo${uploadedCount === 1 ? '' : 's'} uploaded successfully.`;
        if (canNotify) {
          try {
            await Notifications.scheduleNotificationAsync({
              content: { title, body, data: { screen: 'queue' } },
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                seconds: 1,
                channelId: 'intake-uploads',
              },
            });
          } catch (error) {
            console.error('Unable to show parcel upload notification:', error);
            Alert.alert(title, body);
          }
        } else {
          Alert.alert(title, body);
        }
      }
    } catch (error) {
      setQueueError(errorMessage(error));
      setQueueStatus('error');
      setIntakeQueueStatus('failed');
      setQueue(await getIntakeQueue());
    } finally {
      setQueueLoading(false);
      queueRunInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    getIntakeQueue()
      .then((items) => {
        if (!isMounted) return;
        setQueue(items);
        if (items.length > 0) void runQueue(undefined, false);
      })
      .catch((error: unknown) => {
        if (isMounted) setQueueError(errorMessage(error));
      });
    return () => {
      isMounted = false;
    };
  }, [runQueue]);

  useEffect(() => {
    if (requestedScreen !== 'queue') return;

    let isMounted = true;
    void getIntakeQueue()
      .then((items) => {
        if (isMounted) setQueue(items);
      })
      .catch((error: unknown) => {
        if (isMounted) setQueueError(errorMessage(error));
      });
    return () => {
      isMounted = false;
    };
  }, [requestedScreen]);

  const startIntake = (mode: IntakeMode) => {
    setIntakeMode(mode);
    setBarcodeStep(mode === 'with-barcode' ? 'scanning' : 'capturing');
    setScannedBarcode('');
    setCapturedDockMinimized(false);
    setCameraReady(false);
    setScreen('camera');
  };

  const handleBarcodeScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    if (!data || barcodeCheckInProgress.current || barcodeStep !== 'scanning') return;
    barcodeCheckInProgress.current = true;
    try {
      const existing = await findOrderByBarcode(data);
      void barcodeBeepPlayer.seekTo(0)
        .then(() => barcodeBeepPlayer.play())
        .catch((error: unknown) => {
          console.error('Unable to play barcode scan sound:', error);
        });
      if (existing) {
          Alert.alert('Barcode already recorded', `[${data}] is already in the system. Scan a different barcode.`);
        return;
      }
      setScannedBarcode(data);
      setBarcodeStep('capturing');
    } catch (error) {
      Alert.alert('Unable to verify barcode', errorMessage(error));
    } finally {
      barcodeCheckInProgress.current = false;
    }
  }, [barcodeBeepPlayer, barcodeStep]);

  const rescanBarcode = () => {
    setScannedBarcode('');
    setBarcodeStep('scanning');
  };

  const addImage = (uri: string, width: number, height: number, barcode = '') => {
    setImages((current) => {
      const next = [...current, createImage(uri, width, height, barcode || null)];
      setSelectedIndex(next.length - 1);
      return next;
    });
    if (intakeMode === 'with-barcode') {
      setBarcodeStep('scanning');
      setScannedBarcode('');
    }
  };

  const capturePhoto = async () => {
    if (!cameraReady || !cameraRef.current || saving) return;
    setSaving(true);
    try {
      if (Platform.OS !== 'web') {
        const grantedPermission = await requestPermissionsAsync(true, ['photo']);
        if (!grantedPermission.granted) {
          Alert.alert(
            'Photo library permission required',
            grantedPermission.canAskAgain
              ? 'ဖုန်းထဲ Gallery/Photos တွင် ဓာတ်ပုံသိမ်းရန် ခွင့်ပြုချက်ပေးပါ။'
              : 'ဖုန်း Settings ထဲရှိ All-in-One CS ၏ Photos permission ကို ဖွင့်ပေးပါ။',
          );
          return;
        }
      }

      const picture = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!picture) throw new Error('The camera did not return a photo.');
      addImage(
        picture.uri,
        picture.width,
        picture.height,
        intakeMode === 'with-barcode' ? scannedBarcode : '',
      );
      if (Platform.OS !== 'web') {
        try {
          await Asset.create(picture.uri);
        } catch (error) {
          console.error('Unable to save captured parcel photo to the photo library:', error);
          Alert.alert(
            'Photo captured, but not saved to Gallery',
            `${errorMessage(error)}\n\nပုံကို intake ထဲတွင် ဆက်လက်ထားပြီး Save to Queue လုပ်နိုင်ပါတယ်။`,
          );
        }
      }
    } catch (error) {
      Alert.alert('Unable to capture photo', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const pickImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 1,
      });
      if (result.canceled) return;
      const selected = result.assets.map((asset) =>
        createImage(
          asset.uri,
          asset.width,
          asset.height,
          intakeMode === 'with-barcode' ? scannedBarcode : '',
        ),
      );
      setImages((current) => {
        const next = [...current, ...selected];
        setSelectedIndex(next.length - 1);
        return next;
      });
      setScreen('review');
      if (intakeMode === 'with-barcode') {
        setBarcodeStep('scanning');
        setScannedBarcode('');
      }
    } catch (error) {
      Alert.alert('Unable to open gallery', errorMessage(error));
    }
  };

  const removeSelectedImage = () => {
    if (!selectedImage) return;
    setImages((current) => {
      const next = current.filter((image) => image.id !== selectedImage.id);
      if (next.length === 0) {
        setSelectedIndex(0);
        setScreen('camera');
        return next;
      }
      setSelectedIndex(Math.min(selectedIndex, next.length - 1));
      return next;
    });
  };

  const openReceivedDatePicker = () => {
    const value = parseDateKey(receivedDate) ?? new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        display: 'calendar',
        onValueChange: (_event, selectedDate) => {
          if (selectedDate) setReceivedDate(toDateKey(selectedDate));
        },
      });
      return;
    }

    setReceivedDateDraft(value);
    setReceivedDatePickerVisible(true);
  };

  const applyReceivedDate = () => {
    setReceivedDate(toDateKey(receivedDateDraft));
    setReceivedDatePickerVisible(false);
  };

  const submitIntake = () => {
    if (images.length === 0) {
      Alert.alert('Photos required', 'Capture or select at least one parcel photo.');
      return;
    }
    if (!parseDateKey(receivedDate)) {
      Alert.alert('Invalid date', 'Enter the received date in YYYY-MM-DD format.');
      return;
    }

    Alert.alert(
      'Save parcel records?',
      `${images.length} photo${images.length === 1 ? '' : 's'} will be saved to the upload queue.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: () => {
            void saveIntake();
          },
        },
      ],
    );
  };

  const saveIntake = async () => {
    if (saving) return;
    setSaving(true);
    try {
      for (const image of images) {
        const item = createQueueItem(image, {
          branch,
          receivedDate,
          note,
          transitToYgn: branch === 'MDY' && transitToYgn,
        });
        await enqueueIntake(item);
      }
      setImages([]);
      setSelectedIndex(0);
      setNote('');
      setTransitToYgn(false);
      setReceivedDate(today());
      setScreen('queue');
      void refreshQueue().then((items) => {
        if (items.length > 0) void runQueue();
      }).catch((error: unknown) => {
        setQueueError(errorMessage(error));
        setQueueStatus('error');
      });
    } catch (error) {
      Alert.alert('Unable to save records', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const discardDraft = () => {
    Alert.alert('Discard this intake?', 'All captured photos will be removed.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setImages([]);
          setSelectedIndex(0);
          setScannedBarcode('');
          setBarcodeStep(intakeMode === 'with-barcode' ? 'scanning' : 'capturing');
          setCameraReady(false);
          setScreen('choose');
        },
      },
    ]);
  };

  const removeQueueItem = (item: IntakeQueueItem) => {
    Alert.alert('Delete this upload?', 'This photo will be permanently removed from the queue.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteIntakeQueueItem(item.id)
            .then(() => {
              delete queueItemErrorsRef.current[item.id];
              setQueueItemErrors((current) => {
                const next = { ...current };
                delete next[item.id];
                return next;
              });
              return refreshQueue();
            })
            .catch((error: unknown) => setQueueError(errorMessage(error)));
        },
      },
    ]);
  };

  const backToPrevious = () => {
    if (activeScreen === 'queue') {
      setScreen('choose');
      if (requestedScreen === 'queue') router.setParams({ screen: undefined });
    } else if (activeScreen === 'review') {
      setScreen('camera');
    } else if (activeScreen === 'camera') {
      discardDraft();
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {activeScreen === 'choose' && (
        <View style={styles.chooseScreen}>
          <View style={styles.chooseTopBar}>
            <Pressable accessibilityRole="button" onPress={backToPrevious} style={styles.headerButton}>
              <SymbolView
                name="chevron.left"
                tintColor={colors.text}
                size={17}
                fallback={<Text style={styles.headerButtonText}>‹</Text>}
              />
            </Pressable>
            <Pressable
              accessibilityLabel="Open offline queue"
              accessibilityRole="button"
              onPress={() => {
                void refreshQueue()
                  .then(() => setScreen('queue'))
                  .catch((error: unknown) => setQueueError(errorMessage(error)));
              }}
              style={styles.queueButton}
            >
              <SymbolView
                name="tray.full"
                tintColor={colors.orangeLight}
                size={18}
                fallback={<Text style={styles.queueButtonIconFallback}>▤</Text>}
              />
              {queue.length > 0 && (
                <View style={styles.queueButtonBadge}>
                  <Text style={styles.queueButtonBadgeText}>{queue.length}</Text>
                </View>
              )}
            </Pressable>
          </View>
          <ScrollView
            style={styles.chooseScroll}
            contentContainerStyle={styles.chooseContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.intakeHeading}>
              <View style={styles.intakeHeadingTop}>
                <View style={styles.intakeHeadingIcon}>
                  <SymbolView
                    name="shippingbox.fill"
                    tintColor={colors.orangeLight}
                    size={19}
                    fallback={<Text style={styles.intakeHeadingIconFallback}>▣</Text>}
                  />
                </View>
                <Text style={styles.intakeEyebrow}>PARCEL INTAKE · {branch}</Text>
              </View>
              <Text style={styles.intakeTitle}>ပါဆယ် အဝင်သွင်းရန်</Text>
              <Text style={styles.intakeDescription}>
                ပစ္စည်းကို မှတ်တမ်းတင်ရန် အောက်ပါနည်းလမ်းတစ်ခုကို ရွေးပါ
              </Text>
            </View>
           
            <Pressable
              accessibilityRole="button"
              onPress={() => startIntake('without-barcode')}
              style={({ pressed }) => [styles.methodCard, pressed && styles.pressed]}
            >
              <View style={styles.methodIcon}>
                <SymbolView
                  name="camera.fill"
                  tintColor={colors.orangeLight}
                  size={21}
                  fallback={<Text style={styles.methodIconText}>◉</Text>}
                />
              </View>
              <View style={styles.methodCopy}>
                <Text style={styles.methodTitle}>Capture without barcode</Text>
                <Text style={styles.methodDescription}>Take parcel photos and add details</Text>
              </View>
              <SymbolView name="arrow.right" tintColor="#89827c" size={15} fallback={<Text style={styles.chevron}>›</Text>} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => startIntake('with-barcode')}
              style={({ pressed }) => [styles.methodCard, styles.methodCardPrimary, pressed && styles.pressed]}
            >
              <View style={[styles.methodIcon, styles.methodIconPrimary]}>
                <SymbolView
                  name="barcode.viewfinder"
                  tintColor={colors.orangeLight}
                  size={22}
                  fallback={<Text style={styles.methodIconText}>⌗</Text>}
                />
              </View>
              <View style={styles.methodCopy}>
                <View style={styles.methodTitleRow}>
                  <Text style={styles.methodTitle}>Capture with barcode</Text>
                  <View style={styles.recommendedBadge}>
                    <Text style={styles.recommendedText}>Recommended</Text>
                  </View>
                </View>
                <Text style={styles.methodDescription}>
                  Verify each barcode and attach parcel photos
                </Text>
              </View>
              <SymbolView name="arrow.right" tintColor={colors.orangeLight} size={15} fallback={<Text style={styles.chevron}>›</Text>} />
            </Pressable>
            <Pressable style={styles.reviewQueueLink} onPress={() => setScreen('queue')}>
              <View style={styles.queueLinkIcon}>
                <SymbolView
                  name="tray.full.fill"
                  tintColor={colors.orange}
                  size={17}
                  fallback={<Text style={styles.queueLinkIconFallback}>▤</Text>}
                />
              </View>
              <View style={styles.queueLinkCopy}>
                <Text style={styles.reviewQueueText}>UPLOAD QUEUE</Text>
                <Text style={styles.queueLinkHint}>
                  {queue.length ? `${queue.length} uploads waiting to sync` : 'All records are up to date'}
                </Text>
              </View>
              <Text style={styles.queueLinkCount}>{queue.length}</Text>
              <SymbolView name="chevron.right" tintColor="#77716b" size={13} fallback={<Text style={styles.queueLinkArrow}>›</Text>} />
            </Pressable>
          </ScrollView>
        </View>
      )}

      {activeScreen === 'camera' && (
        <View style={styles.cameraScreen}>
          <View style={styles.cameraTopBar}>
            <Pressable
              accessibilityLabel="Back to intake options"
              accessibilityRole="button"
              onPress={backToPrevious}
              style={styles.headerButton}
            >
              <SymbolView
                name="chevron.left"
                tintColor={colors.text}
                size={17}
                fallback={<Text style={styles.headerButtonText}>‹</Text>}
              />
            </Pressable>
            <View>
              <View style={styles.cameraModePill}>
                <View style={styles.liveDot} />
                <Text style={styles.cameraMode}>
                  {intakeMode === 'with-barcode'
                    ? barcodeStep === 'scanning' ? 'SCAN BARCODE' : 'TAKE PARCEL PHOTO'
                    : 'CAPTURE PARCEL'}
                </Text>
              </View>
              <Text style={[styles.cameraSubheading, cameraSizeError && styles.cameraSizeError]}>
                {cameraSizeError ||
                  (barcodeStep === 'scanning' && intakeMode === 'with-barcode'
                    ? 'Align the barcode inside the frame'
                    : 'Keep the parcel centered in the viewfinder')}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Switch camera"
              accessibilityRole="button"
              onPress={() => {
                cameraSizeRequestId.current += 1;
                setCameraReady(false);
                setCameraPictureSize(undefined);
                setCameraSizeError('');
                setCameraFacing((current) => current === 'back' ? 'front' : 'back');
              }}
              style={styles.flipButton}
            >
              <SymbolView
                name="camera.rotate"
                tintColor={colors.text}
                size={18}
                fallback={<Text style={styles.flipButtonText}>⇄</Text>}
              />
            </Pressable>
          </View>

          <View style={styles.cameraFrame}>
            {!permission?.granted ? (
              <View style={styles.permissionPanel}>
                <Text style={styles.permissionTitle}>Camera access required</Text>
                <Text style={styles.permissionDescription}>
                  Allow camera access to scan barcodes and capture parcel photos.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void requestPermission()}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>ENABLE CAMERA</Text>
                </Pressable>
              </View>
            ) : (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={cameraFacing}
                onCameraReady={() => void configureLargestPictureSize()}
                pictureSize={cameraPictureSize}
                mode="picture"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'pdf417'],
                }}
                onBarcodeScanned={
                  intakeMode === 'with-barcode' && barcodeStep === 'scanning'
                    ? handleBarcodeScanned
                    : undefined
                }
              />
            )}
            {intakeMode === 'with-barcode' && barcodeStep === 'scanning' && permission?.granted && (
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={styles.scanPrompt}>
                  <View style={styles.liveDot} />
                  <Text style={styles.scanPromptText}>Place barcode in the frame</Text>
                </View>
                <View style={styles.scanCorners}>
                  <View style={[styles.scanCorner, styles.scanCornerTopLeft]} />
                  <View style={[styles.scanCorner, styles.scanCornerTopRight]} />
                  <View style={[styles.scanCorner, styles.scanCornerBottomLeft]} />
                  <View style={[styles.scanCorner, styles.scanCornerBottomRight]} />
                </View>
              </View>
            )}
            {scannedBarcode !== '' && barcodeStep === 'capturing' && (
              <View style={styles.scannedBadge}>
                <View style={styles.scannedBadgeIcon}>
                  <SymbolView name="barcode.viewfinder" tintColor={colors.orangeLight} size={16} fallback={<Text style={styles.scannedBadgeIconFallback}>⌗</Text>} />
                </View>
                <View style={styles.scannedBadgeCopy}>
                  <Text style={styles.scannedBadgeLabel}>SCANNED BARCODE</Text>
                  <Text numberOfLines={1} style={styles.scannedBadgeText}>{scannedBarcode}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove barcode and scan again"
                  onPress={rescanBarcode}
                  style={({ pressed }) => [styles.rescanButton, pressed && styles.pressed]}
                >
                  <SymbolView name="arrow.clockwise" tintColor={colors.text} size={16} fallback={<Text style={styles.rescanButtonText}>↻</Text>} />
                </Pressable>
              </View>
            )}
            {images.length > 0 && (
              <View style={[
                styles.cameraThumbnailDock,
                capturedDockMinimized && styles.cameraThumbnailDockMinimized,
              ]}>
                <View style={[
                  styles.cameraThumbnailHeader,
                  capturedDockMinimized && styles.cameraThumbnailHeaderMinimized,
                ]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={capturedDockMinimized ? 'Expand captured photos' : 'Minimize captured photos'}
                    accessibilityState={{ expanded: !capturedDockMinimized }}
                    onPress={() => setCapturedDockMinimized((minimized) => !minimized)}
                    style={styles.cameraThumbnailToggle}
                  >
                    <Text style={styles.cameraThumbnailTitle}>CAPTURED</Text>
                    <SymbolView
                      name={capturedDockMinimized ? 'chevron.up' : 'chevron.down'}
                      tintColor={colors.muted}
                      size={12}
                      fallback={<Text style={styles.cameraThumbnailToggleFallback}>{capturedDockMinimized ? '+' : '−'}</Text>}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedIndex(images.length - 1);
                      setScreen('review');
                    }}
                    style={styles.cameraThumbnailCount}
                  >
                    <Text style={styles.cameraThumbnailCountText}>{images.length} PHOTOS</Text>
                    <SymbolView name="arrow.up.right" tintColor={colors.orangeLight} size={11} fallback={<Text style={styles.queueLinkArrow}>↗</Text>} />
                  </Pressable>
                </View>
                {!capturedDockMinimized && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cameraThumbnailList}>
                    {images.map((image, index) => (
                      <Pressable
                        key={image.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Review photo ${index + 1}`}
                        onPress={() => {
                          setSelectedIndex(index);
                          setScreen('review');
                        }}
                        style={styles.cameraThumbnail}
                      >
                        <Image source={{ uri: image.uri }} style={styles.cameraThumbnailImage} />
                        {image.barcode ? (
                          <View style={styles.cameraThumbnailBarcode}>
                            <Text numberOfLines={1} style={styles.cameraThumbnailBarcodeText}>{image.barcode}</Text>
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
          </View>

          <View style={styles.cameraControls}>
            {intakeMode !== 'with-barcode' || barcodeStep === 'capturing' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void pickImages()}
                style={styles.galleryButton}
              >
                <SymbolView name="photo.on.rectangle.angled" tintColor={colors.text} size={19} fallback={<Text style={styles.secondaryButtonText}>▧</Text>} />
                <Text style={styles.cameraControlLabel}>GALLERY</Text>
              </Pressable>
            ) : (
              <View style={styles.cameraControlSpacer} />
            )}
            {intakeMode === 'with-barcode' && barcodeStep === 'scanning' ? (
              <View style={styles.scanButton}>
                <SymbolView name="barcode.viewfinder" tintColor={colors.background} size={27} fallback={<Text style={styles.scanButtonText}>⌗</Text>} />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => void capturePhoto()}
                disabled={!cameraReady || saving}
                style={({ pressed }) => [
                  styles.shutterOuter,
                  pressed && styles.pressed,
                  (!cameraReady || saving) && styles.disabled,
                ]}
              >
                {saving ? <ActivityIndicator color={colors.background} /> : <View style={styles.shutterInner} />}
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Review ${images.length} photos`}
              onPress={() => setScreen('review')}
              disabled={images.length === 0}
              style={[styles.photoCountButton, images.length === 0 && styles.disabled]}
            >
              <View style={styles.photoCountIcon}>
                <SymbolView name="square.grid.2x2" tintColor={colors.orangeLight} size={18} fallback={<Text style={styles.queueLinkArrow}>▦</Text>} />
                {images.length > 0 && <View style={styles.photoCountBadge}><Text style={styles.photoCountBadgeText}>{images.length}</Text></View>}
              </View>
              <Text style={styles.cameraControlLabel}>REVIEW</Text>
            </Pressable>
          </View>
          <Text style={styles.cameraFooter}>
            {intakeMode === 'with-barcode'
              ? barcodeStep === 'scanning'
                ? images.length
                  ? `${images.length} photo${images.length === 1 ? '' : 's'} captured · Ready for next barcode`
                  : 'Scan a barcode to begin a parcel record'
                : 'Capture the parcel, then continue with the next barcode'
              : images.length
                ? `${images.length} photo${images.length === 1 ? '' : 's'} captured · Continue or review`
                : 'Capture multiple parcels, then review before upload'}
          </Text>
        </View>
      )}

      {activeScreen === 'review' && selectedImage && (
        <KeyboardAvoidingView
          style={styles.reviewKeyboardContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.reviewScroll}
            contentContainerStyle={styles.reviewContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.previewToolbar}>
            <Pressable
              accessibilityLabel="Back to camera"
              accessibilityRole="button"
              onPress={() => setScreen('camera')}
              style={styles.headerButton}
            >
              <SymbolView
                name="chevron.left"
                tintColor={colors.text}
                size={17}
                fallback={<Text style={styles.headerButtonText}>‹</Text>}
              />
            </Pressable>
            <View style={styles.reviewHeadingCopy}>
              <Text style={styles.reviewEyebrow}>INTAKE · PHOTO REVIEW</Text>
              <Text style={styles.sectionTitle}>Review photos</Text>
            </View>
            <View style={styles.counterPill}>
              <Text style={styles.counter}>{String(selectedIndex + 1).padStart(2, '0')}</Text>
              <Text style={styles.counterDivider}>/</Text>
              <Text style={styles.counterTotal}>{String(images.length).padStart(2, '0')}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={removeSelectedImage} style={styles.deleteButton}>
              <SymbolView
                name="trash"
                tintColor={colors.red}
                size={15}
                fallback={<Text style={styles.deleteButtonText}>×</Text>}
              />
            </Pressable>
          </View>
          <View style={styles.previewFrame}>
            <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} resizeMode="contain" />
            {selectedImage.barcode && (
              <View style={styles.previewBarcode}>
                <Text style={styles.previewBarcodeText}>{selectedImage.barcode}</Text>
              </View>
            )}
            {images.length > 1 && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous photo"
                  onPress={() => setSelectedIndex((index) => (index - 1 + images.length) % images.length)}
                  style={[styles.previewNavigationButton, styles.previewNavigationPrevious]}
                >
                  <SymbolView name="chevron.left" tintColor={colors.text} size={17} fallback={<Text style={styles.previewNavigationFallback}>‹</Text>} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next photo"
                  onPress={() => setSelectedIndex((index) => (index + 1) % images.length)}
                  style={[styles.previewNavigationButton, styles.previewNavigationNext]}
                >
                  <SymbolView name="chevron.right" tintColor={colors.text} size={17} fallback={<Text style={styles.previewNavigationFallback}>›</Text>} />
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.formCard}>
            <View style={styles.formHeader}>
              <View>
                <Text style={styles.formEyebrow}>RECORD DETAILS</Text>
                <Text style={styles.formTitle}>Parcel information</Text>
              </View>
              <View style={styles.qualityControl}>
                {(['SD', 'HD'] as const).map((quality) => (
                  <Pressable
                    key={quality}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedImage.quality === quality }}
                    onPress={() => setImages((current) => current.map((image, index) =>
                      index === selectedIndex ? { ...image, quality } : image))}
                    style={[styles.qualityOption, selectedImage.quality === quality && styles.qualityOptionSelected]}
                  >
                    <Text style={[styles.qualityText, selectedImage.quality === quality && styles.qualityTextSelected]}>
                      {quality}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.detailsGrid}>
              <View style={styles.detailsColumn}>
                <Text style={styles.compactFieldLabel}>RECEIVED DATE</Text>
                {Platform.OS === 'web' ? (
                  <TextInput
                    accessibilityLabel="Received date"
                    value={receivedDate}
                    onChangeText={setReceivedDate}
                    placeholder="2026-01-31"
                    placeholderTextColor="#71717a"
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                    style={[styles.textInput, styles.compactTextInput]}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Received date ${formatDateKey(receivedDate)}`}
                    accessibilityHint="Open date picker"
                    onPress={openReceivedDatePicker}
                    style={({ pressed }) => [
                      styles.textInput,
                      styles.compactTextInput,
                      styles.receivedDateButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.receivedDateText}>{formatDateKey(receivedDate)}</Text>
                    <SymbolView
                      name="calendar"
                      tintColor={colors.orangeLight}
                      size={15}
                      fallback={<Text style={styles.receivedDateIconFallback}>▦</Text>}
                    />
                  </Pressable>
                )}
              </View>
              {branch === 'MDY' && (
                <View style={styles.detailsColumn}>
                  <Text style={styles.compactFieldLabel}>TRANSIT</Text>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: transitToYgn }}
                    onPress={() => setTransitToYgn((current) => !current)}
                    style={styles.compactTransitToggle}
                  >
                    <View style={[styles.checkbox, transitToYgn && styles.checkboxSelected]}>
                      {transitToYgn && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.transitText}>To Yangon (YGN)</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Text style={styles.compactFieldLabel}>CAPTION / NOTE</Text>
            <TextInput
              accessibilityLabel="Parcel caption or note"
              value={note}
              onChangeText={setNote}
              placeholder="Add a caption..."
              placeholderTextColor="#71717a"
              returnKeyType="done"
              style={[styles.textInput, styles.compactTextInput]}
            />

            <Pressable
              accessibilityRole="button"
              onPress={submitIntake}
              disabled={saving}
              style={[styles.primaryButton, styles.compactSubmitButton, saving && styles.disabled]}
            >
              {saving ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <View style={styles.submitButtonContent}>
                  <Text style={styles.primaryButtonText}>SAVE TO QUEUE · {images.length} PHOTO{images.length === 1 ? '' : 'S'}</Text>
                  <SymbolView name="arrow.up.right" tintColor={colors.background} size={15} fallback={<Text style={styles.submitArrow}>↗</Text>} />
                </View>
              )}
            </Pressable>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {activeScreen === 'queue' && (
        <ScrollView contentContainerStyle={styles.queueContent}>
          <View style={styles.queueTopBar}>
            <Pressable
              accessibilityLabel="Back to previous screen"
              accessibilityRole="button"
              onPress={backToPrevious}
              style={styles.headerButton}
            >
              <SymbolView
                name="chevron.left"
                tintColor={colors.text}
                size={17}
                fallback={<Text style={styles.headerButtonText}>‹</Text>}
              />
            </Pressable>
            <Text style={styles.queueTopBarTitle}>UPLOAD QUEUE</Text>
            <View style={styles.headerButtonPlaceholder} />
          </View>
          <View style={styles.queueSummary}>
            <View style={[
              styles.statusDot,
              queueStatus === 'uploading' && styles.statusDotUploading,
              queueStatus === 'success' && styles.statusDotSuccess,
              queueStatus === 'error' && styles.statusDotError,
            ]} />
            <View style={styles.queueSummaryCopy}>
              <Text style={styles.sectionTitle}>
                {queueStatus === 'uploading'
                  ? 'Uploading records'
                  : queueStatus === 'error'
                    ? 'Upload interrupted'
                    : queueStatus === 'success'
                      ? 'Sync complete'
                      : 'Offline queue'}
              </Text>
              <Text style={styles.queueSummaryDescription}>
                {queue.length ? `${queue.length} photo${queue.length === 1 ? '' : 's'} waiting to upload` : 'No pending uploads'}
              </Text>
            </View>
            {queueLoading && <ActivityIndicator color={colors.amber} />}
          </View>

          {queueError !== '' && <Text style={styles.errorText}>{queueError}</Text>}
          {queue.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void runQueue()}
              disabled={queueLoading}
              style={[styles.primaryButton, queueLoading && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>RETRY ALL UPLOADS</Text>
            </Pressable>
          )}
          {queue.length === 0 && queueStatus !== 'uploading' && (
            <View style={styles.emptyQueue}>
              <View style={styles.emptyQueueIcon}>
                <SymbolView name="checkmark" tintColor={colors.green} size={22} fallback={<Text style={styles.emptyQueueCheck}>✓</Text>} />
              </View>
              <Text style={styles.emptyQueueTitle}>You’re all caught up</Text>
              <Text style={styles.emptyQueueDescription}>All saved parcel records have been uploaded.</Text>
            </View>
          )}
          {queue.map((item) => (
            <View key={item.id} style={styles.queueCard}>
              <Image source={{ uri: item.imageUri }} style={styles.queueImage} />
              <View style={styles.queueItemCopy}>
                <Text style={styles.queueItemTitle}>{item.barcode || 'No barcode'}</Text>
                <Text style={styles.queueItemMeta}>{item.branch} · {item.received_date} · {item.quality}</Text>
                {item.uploader_note && <Text numberOfLines={2} style={styles.queueItemNote}>{item.uploader_note}</Text>}
                {queueItemErrors[item.id] && (
                  <Text style={styles.queueItemError}>{queueItemErrors[item.id]}</Text>
                )}
              </View>
              <View style={styles.queueItemActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Retry upload for ${item.barcode || 'parcel photo'}`}
                  disabled={queueLoading}
                  onPress={() => void runQueue(item.id)}
                  style={[styles.retryQueueButton, queueLoading && styles.disabled]}
                >
                  <Text style={styles.retryQueueText}>RETRY</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => removeQueueItem(item)} style={styles.removeQueueButton}>
                  <SymbolView name="trash" tintColor={colors.red} size={15} fallback={<Text style={styles.removeQueueText}>×</Text>} />
                </Pressable>
              </View>
            </View>
          ))}
          <Link href="/" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>BACK TO HOME</Text>
            </Pressable>
          </Link>
        </ScrollView>
      )}
      {Platform.OS === 'ios' && receivedDatePickerVisible ? (
        <Modal
          transparent
          animationType="slide"
          onRequestClose={() => setReceivedDatePickerVisible(false)}
        >
          <View style={styles.dateModalBackdrop}>
            <View style={styles.dateModalPanel}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>လက်ခံရက် ရွေးချယ်ပါ</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReceivedDatePickerVisible(false)}
                >
                  <Text style={styles.dateCancelText}>မလုပ်တော့ပါ</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={receivedDateDraft}
                mode="date"
                display="spinner"
                themeVariant="dark"
                onValueChange={(_event, selectedDate) => setReceivedDateDraft(selectedDate)}
                style={styles.iosDatePicker}
              />
              <Pressable
                accessibilityRole="button"
                onPress={applyReceivedDate}
                style={({ pressed }) => [styles.dateApplyButton, pressed && styles.pressed]}
              >
                <Text style={styles.dateApplyText}>ရက်စွဲ သတ်မှတ်မည်</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  chooseScreen: { flex: 1 },
  chooseScroll: { flex: 1 },
  chooseTopBar: {
    minHeight: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queueTopBar: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  queueTopBarTitle: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  headerButtonPlaceholder: { width: 40, height: 40 },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#292929',
  },
  headerButtonText: { color: colors.text, fontSize: 28, lineHeight: 31, marginTop: -3 },
  queueButton: {
    position: 'relative',
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#342619',
    borderRadius: 15,
    backgroundColor: '#17120e',
  },
  queueButtonIconFallback: { color: colors.orangeLight, fontSize: 16 },
  queueButtonBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: colors.orange,
    borderWidth: 1,
    borderColor: colors.background,
  },
  queueButtonBadgeText: { color: '#17100a', fontSize: 9, fontWeight: '900' },
  chooseContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 28,
  },
  intakeHeading: { marginBottom: 27 },
  intakeHeadingTop: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 13 },
  intakeHeadingIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#49301f',
    backgroundColor: '#21170f',
  },
  intakeHeadingIconFallback: { color: colors.orangeLight, fontSize: 19 },
  intakeEyebrow: { color: colors.orangeLight, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  intakeTitle: { color: colors.text, fontSize: 25, lineHeight: 50, fontWeight: '900' },
  intakeDescription: { color: colors.muted, fontSize: 12, lineHeight: 30, marginTop: 5 },
  chooseSectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
    paddingHorizontal: 2,
  },
  chooseSectionTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  chooseSectionHint: { color: colors.orangeLight, fontSize: 9, fontWeight: '800' },
  methodCard: {
    minHeight: 82,
    borderRadius: 17,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#302a25',
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  methodCardPrimary: {
    backgroundColor: '#19130e',
    borderColor: '#59371f',
  },
  methodIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#21170f',
    borderWidth: 1,
    borderColor: '#49301f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodIconPrimary: { backgroundColor: '#2b1b10', borderColor: '#5b3b24' },
  methodIconText: { fontSize: 22 },
  methodCopy: { flex: 1, minWidth: 0, marginLeft: 11, marginRight: 5 },
  methodTitle: { color: colors.text, fontSize: 12, lineHeight: 18, fontWeight: '800' },
  methodTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recommendedBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, backgroundColor: '#302014' },
  recommendedText: { color: colors.orangeLight, fontSize: 8, fontWeight: '800' },
  methodDescription: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3, flexShrink: 1 },
  chevron: { color: colors.orangeLight, fontSize: 24, marginLeft: 4 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  reviewQueueLink: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 16,
    marginTop: 11,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#302a25',
  },
  queueLinkIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: '#21170f', borderWidth: 1, borderColor: '#49301f', alignItems: 'center', justifyContent: 'center' },
  queueLinkIconFallback: { color: colors.orange, fontSize: 20 },
  queueLinkCopy: { flex: 1, marginLeft: 10 },
  reviewQueueText: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  queueLinkHint: { color: '#817a74', fontSize: 10, marginTop: 4 },
  queueLinkCount: { minWidth: 25, textAlign: 'center', color: colors.orangeLight, fontSize: 12, fontWeight: '900' },
  queueLinkArrow: { color: '#77716b', fontSize: 22, marginLeft: 7 },
  cameraScreen: { flex: 1, paddingHorizontal: 15, paddingBottom: 10, paddingTop: 7 },
  cameraTopBar: { minHeight: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3, paddingBottom: 8 },
  cameraModePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#38271a', backgroundColor: '#17120e' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.orangeLight },
  cameraMode: { color: colors.orangeLight, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  cameraSubheading: { color: '#908a84', fontSize: 10, marginTop: 6, marginLeft: 2 },
  cameraSizeError: { color: colors.red },
  flipButton: { width: 43, height: 43, borderRadius: 16, backgroundColor: '#191919', borderWidth: 1, borderColor: '#302d2a', alignItems: 'center', justifyContent: 'center' },
  flipButtonText: { color: colors.text, fontSize: 21, fontWeight: '700' },
  cameraFrame: {
    flex: 1,
    minHeight: 230,
    borderRadius: 29,
    backgroundColor: '#000000',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#302820',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 7,
  },
  permissionPanel: { flex: 1, padding: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101010' },
  permissionTitle: { color: colors.text, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  permissionDescription: { color: colors.muted, textAlign: 'center', lineHeight: 21, marginTop: 10, marginBottom: 20, fontSize: 12 },
  scanOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  scanPrompt: {
    position: 'absolute',
    top: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  scanPromptText: { color: colors.text, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  scanCorners: {
    width: '82%',
    height: 168,
  },
  scanCorner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: colors.orangeLight,
  },
  scanCornerTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  scanCornerTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  scanCornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  scanCornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
  cameraThumbnailDock: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    left: 12,
    paddingHorizontal: 11,
    paddingTop: 9,
    paddingBottom: 8,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(8,8,8,0.76)',
  },
  cameraThumbnailDockMinimized: { paddingVertical: 9 },
  cameraThumbnailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cameraThumbnailHeaderMinimized: { marginBottom: 0 },
  cameraThumbnailToggle: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 7 },
  cameraThumbnailToggleFallback: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  cameraThumbnailTitle: { color: '#9b948d', fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  cameraThumbnailCount: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cameraThumbnailCountText: { color: colors.orangeLight, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  cameraThumbnailList: { gap: 8 },
  cameraThumbnail: { width: 52, height: 52, borderRadius: 13, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: '#151515' },
  cameraThumbnailImage: { width: '100%', height: '100%' },
  cameraThumbnailBarcode: { position: 'absolute', right: 0, bottom: 0, left: 0, paddingHorizontal: 3, paddingVertical: 2, backgroundColor: 'rgba(249,115,22,0.92)' },
  cameraThumbnailBarcodeText: { color: '#111111', fontSize: 7, textAlign: 'center', fontWeight: '900' },
  scannedBadge: {
    position: 'absolute',
    top: 15,
    right: 14,
    left: 14,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 18,
    backgroundColor: 'rgba(8,8,8,0.78)',
  },
  scannedBadgeIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2b1b10' },
  scannedBadgeIconFallback: { color: colors.orangeLight, fontSize: 18 },
  scannedBadgeCopy: { flex: 1, minWidth: 0 },
  scannedBadgeLabel: { color: '#9b948d', fontSize: 7, fontWeight: '900', letterSpacing: 1.2, marginBottom: 3 },
  scannedBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700', fontFamily: 'SpaceMono' },
  rescanButton: { width: 37, height: 37, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)' },
  rescanButtonText: { color: colors.text, fontSize: 19, fontWeight: '700' },
  cameraControls: { height: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  cameraControlSpacer: { width: 58, height: 58 },
  galleryButton: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 20, backgroundColor: '#171717', borderWidth: 1, borderColor: '#302d2a' },
  cameraControlLabel: { color: '#9a938c', fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  secondaryButton: {
    minWidth: 95,
    minHeight: 43,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#302a25',
    backgroundColor: '#161514',
  },
  secondaryButtonText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  scanButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center', shadowColor: colors.orange, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 5 },
  scanButtonText: { color: colors.background, fontSize: 28, fontWeight: '900' },
  shutterOuter: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: '#f4eee7', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.orange },
  photoCountButton: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', gap: 3 },
  photoCountIcon: { position: 'relative', width: 35, height: 35, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#21180f', borderWidth: 1, borderColor: '#342619' },
  photoCountBadge: { position: 'absolute', top: -5, right: -7, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, backgroundColor: colors.orange },
  photoCountBadgeText: { color: '#17100a', fontSize: 8, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  cameraFooter: { minHeight: 23, textAlign: 'center', color: '#77716b', fontSize: 9, paddingHorizontal: 8, letterSpacing: 0.1 },
  reviewKeyboardContainer: { flex: 1 },
  reviewScroll: { flex: 1 },
  reviewContent: { flexGrow: 1, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, gap: 8 },
  previewToolbar: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewHeadingCopy: { flex: 1 },
  reviewEyebrow: { color: colors.orange, fontSize: 7, fontWeight: '900', letterSpacing: 1.2, marginBottom: 2 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  counterPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20, backgroundColor: '#171411', borderWidth: 1, borderColor: '#30271f' },
  counter: { color: colors.orangeLight, fontSize: 10, fontWeight: '900' },
  counterDivider: { color: '#645b53', fontSize: 10 },
  counterTotal: { color: '#b0a69e', fontSize: 10, fontWeight: '800' },
  deleteButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#251515', borderWidth: 1, borderColor: '#452020' },
  deleteButtonText: { color: colors.red, fontSize: 18, fontWeight: '700' },
  previewFrame: { flex: 1, minHeight: 100, position: 'relative', borderRadius: 21, backgroundColor: '#050505', overflow: 'hidden', borderWidth: 1, borderColor: '#302820' },
  previewImage: { width: '100%', height: '100%' },
  previewBarcode: { position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(12,12,12,0.88)', borderWidth: 1, borderColor: '#49301f', borderRadius: 11, paddingHorizontal: 10, paddingVertical: 6 },
  previewBarcodeText: { color: colors.orangeLight, fontSize: 10, fontWeight: '800' },
  previewNavigationButton: { position: 'absolute', top: '50%', width: 36, height: 42, alignItems: 'center', justifyContent: 'center', marginTop: -21, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(0,0,0,0.6)' },
  previewNavigationPrevious: { left: 10 },
  previewNavigationNext: { right: 10 },
  previewNavigationFallback: { color: colors.text, fontSize: 25, lineHeight: 28 },
  formCard: { padding: 10, borderRadius: 20, backgroundColor: '#121212', borderWidth: 1, borderColor: '#292622' },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  formEyebrow: { color: colors.orange, fontSize: 7, fontWeight: '900', letterSpacing: 1.2, marginBottom: 2 },
  formTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  qualityControl: { flexDirection: 'row', padding: 3, borderRadius: 16, backgroundColor: '#090909', borderWidth: 1, borderColor: '#302e2b' },
  qualityOption: { minWidth: 35, alignItems: 'center', justifyContent: 'center', paddingVertical: 5, paddingHorizontal: 7, borderRadius: 12 },
  qualityOptionSelected: { backgroundColor: colors.orange },
  qualityText: { color: '#9a938c', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  qualityTextSelected: { color: '#17100a' },
  detailsGrid: { flexDirection: 'row', gap: 9 },
  detailsColumn: { flex: 1, minWidth: 0 },
  compactFieldLabel: { color: '#a29a92', fontSize: 7, fontWeight: '900', letterSpacing: 0.8, marginTop: 4, marginBottom: 3 },
  compactTextInput: { minHeight: 37, paddingHorizontal: 9, borderRadius: 11, fontSize: 11 },
  receivedDateButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receivedDateText: { color: colors.text, fontSize: 11 },
  receivedDateIconFallback: { color: colors.orangeLight, fontSize: 14 },
  dateModalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  dateModalPanel: {
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#171411',
  },
  dateModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateModalTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  dateCancelText: { color: colors.orangeLight, fontSize: 11, fontWeight: '700' },
  iosDatePicker: { alignSelf: 'center', width: '100%', height: 180 },
  dateApplyButton: {
    minHeight: 43,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: colors.orange,
  },
  dateApplyText: { color: '#17100a', fontSize: 11, fontWeight: '800' },
  textInput: { minHeight: 47, borderRadius: 15, paddingHorizontal: 13, color: colors.text, backgroundColor: '#090909', borderWidth: 1, borderColor: '#302e2b', fontSize: 13 },
  compactTransitToggle: { minHeight: 28, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 3, gap: 7 },
  checkbox: { width: 17, height: 17, borderWidth: 1, borderColor: '#514941', borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { borderColor: colors.orange, backgroundColor: colors.orange },
  checkmark: { color: '#111111', fontWeight: '900', fontSize: 13 },
  transitText: { color: colors.orangeLight, fontSize: 10, fontWeight: '700' },
  compactSubmitButton: { minHeight: 42, marginTop: 8, borderRadius: 14 },
  primaryButton: { minHeight: 52, marginTop: 19, borderRadius: 18, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, shadowColor: colors.orange, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 5 },
  primaryButtonText: { color: '#17100a', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  submitButtonContent: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  submitArrow: { color: '#17100a', fontSize: 15, fontWeight: '900' },
  queueContent: { flexGrow: 1, paddingHorizontal: 17, paddingTop: 19, paddingBottom: 30, gap: 12 },
  queueSummary: { minHeight: 88, flexDirection: 'row', alignItems: 'center', padding: 15, borderWidth: 1, borderColor: '#302820', borderRadius: 22, backgroundColor: '#141210' },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#71717a', marginRight: 12 },
  statusDotUploading: { backgroundColor: colors.amber },
  statusDotSuccess: { backgroundColor: colors.green },
  statusDotError: { backgroundColor: colors.red },
  queueSummaryCopy: { flex: 1 },
  queueSummaryDescription: { color: colors.muted, fontSize: 10, marginTop: 5 },
  errorText: { color: colors.red, lineHeight: 20, fontSize: 11, padding: 12, borderWidth: 1, borderColor: '#5a2820', borderRadius: 14, backgroundColor: '#211311' },
  emptyQueue: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', padding: 24, borderRadius: 25, backgroundColor: '#101010', borderWidth: 1, borderColor: '#242424' },
  emptyQueueIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.18)' },
  emptyQueueCheck: { color: colors.green, fontSize: 22, fontWeight: '900' },
  emptyQueueTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 15 },
  emptyQueueDescription: { color: colors.muted, textAlign: 'center', fontSize: 11, lineHeight: 18, marginTop: 7 },
  queueCard: { minHeight: 100, flexDirection: 'row', alignItems: 'center', padding: 11, gap: 11, borderRadius: 21, borderWidth: 1, borderColor: '#2b2824', backgroundColor: '#141414' },
  queueImage: { width: 74, height: 74, borderRadius: 16, backgroundColor: '#000000' },
  queueItemCopy: { flex: 1, minWidth: 0 },
  queueItemTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  queueItemMeta: { color: colors.orangeLight, fontSize: 9, marginTop: 5, fontWeight: '700' },
  queueItemNote: { color: '#bdb6b0', fontSize: 10, marginTop: 5 },
  queueItemError: { color: colors.red, fontSize: 9, lineHeight: 14, marginTop: 5 },
  queueItemActions: { alignItems: 'center', gap: 7 },
  retryQueueButton: { minWidth: 52, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: 11, backgroundColor: 'rgba(249,115,22,0.18)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.42)' },
  retryQueueText: { color: colors.orangeLight, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  removeQueueButton: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: 'rgba(248,113,113,0.16)', backgroundColor: '#251515' },
  removeQueueText: { color: colors.red, fontSize: 18, fontWeight: '800' },
});
