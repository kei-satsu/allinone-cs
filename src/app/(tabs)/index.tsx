import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from '@/components/AppSymbol';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import {
  getIntakeQueue,
  getIntakeQueueStatus,
  subscribeToIntakeQueue,
  type IntakeQueueStatus,
} from '@/lib/intake';
import { supabase, supabaseConfigError } from '@/lib/supabase';

const palette = {
  background: '#090909',
  surface: '#141414',
  border: '#302a25',
  orange: '#f97316',
  orangeLight: '#ff9b47',
  queueUploading: '#69b9ff',
  queueFailed: '#ff6868',
  queueCompleted: '#65d995',
  holdAccent: '#f4c95d',
  returnedAccent: '#ff8177',
  printAccent: '#83b8ff',
  arrivalAccent: '#67d8b4',
  transitAccent: '#e8b45a',
  handoverAccent: '#c4a1ff',
  white: '#f7f4f1',
  muted: '#aaa39c',
};

type ToTransitCount = {
  receiver_loc: string;
  order_count: number;
};

type HandoverRiderCount = {
  rider_id: string;
  rider_name: string;
  order_count: number;
};

type SelectedOrderGroup =
  | { kind: 'receiver'; receiverLoc: string }
  | { kind: 'rider'; riderId: string };

type ToTransitOrder = {
  id: string;
  item_id: string | null;
  barcode: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  image_url: string | null;
  status: string;
};

function isToTransitOrder(value: unknown): value is ToTransitOrder {
  if (typeof value !== 'object' || value === null) return false;
  const order = value as Record<string, unknown>;
  return typeof order.id === 'string' &&
    (order.item_id === null || typeof order.item_id === 'string') &&
    (order.barcode === null || typeof order.barcode === 'string') &&
    (order.sender_name === null || typeof order.sender_name === 'string') &&
    (order.receiver_name === null || typeof order.receiver_name === 'string') &&
    (order.receiver_phone === null || typeof order.receiver_phone === 'string') &&
    (order.image_url === null || typeof order.image_url === 'string') &&
    typeof order.status === 'string';
}

const TO_TRANSIT_PAGE_SIZE = 50;

export default function HomeScreen() {
  const { branch, canSelectBranch, setBranch } = useAuth();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [branchPickerVisible, setBranchPickerVisible] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [intakeQueueCount, setIntakeQueueCount] = useState<number | null>(null);
  const [intakeQueueError, setIntakeQueueError] = useState('');
  const [intakeQueueStatus, setIntakeQueueStatus] = useState<IntakeQueueStatus>(getIntakeQueueStatus);
  const [refreshing, setRefreshing] = useState(false);
  const [toTransitCounts, setToTransitCounts] = useState<ToTransitCount[] | null>(null);
  const [toTransitError, setToTransitError] = useState('');
  const [handoverRiderCounts, setHandoverRiderCounts] = useState<HandoverRiderCount[] | null>(null);
  const [handoverRiderError, setHandoverRiderError] = useState('');
  const [selectedReceiverLoc, setSelectedReceiverLoc] = useState<string | null>(null);
  const [selectedRider, setSelectedRider] = useState<HandoverRiderCount | null>(null);
  const [selectedOrderGroup, setSelectedOrderGroup] = useState<SelectedOrderGroup | null>(null);
  const [selectedOrderImage, setSelectedOrderImage] = useState<string | null>(null);
  const [selectedImageLoadError, setSelectedImageLoadError] = useState(false);
  const [failedThumbnailIds, setFailedThumbnailIds] = useState<Set<string>>(() => new Set());
  const [toTransitOrders, setToTransitOrders] = useState<ToTransitOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const orderRequestId = useRef(0);
  const loadingMoreOrders = useRef(false);
  const dashboardRequestId = useRef(0);

  const loadSelectedOrders = useCallback(async (
    group: SelectedOrderGroup,
    offset: number,
    requestId: number,
  ) => {
    if (!supabase) {
      const message = supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။';
      setOrdersError(message);
      throw new Error(message);
    }

    const { data, error } = group.kind === 'receiver'
      ? await supabase.rpc('get_to_transit_order_list', {
          p_branch: branch,
          p_receiver_loc: group.receiverLoc,
          p_limit: TO_TRANSIT_PAGE_SIZE,
          p_offset: offset,
        })
      : await supabase.rpc('get_handover_order_list', {
          p_branch: branch,
          p_rider_id: group.riderId,
          p_limit: TO_TRANSIT_PAGE_SIZE,
          p_offset: offset,
        });
    if (error) throw error;
    if (!Array.isArray(data) || !data.every(isToTransitOrder)) {
      throw new Error('Way စာရင်း မရရှိပါ။');
    }
    if (requestId !== orderRequestId.current) return;

    setToTransitOrders((current) => offset === 0 ? data : [...current, ...data]);
    setHasMoreOrders(data.length === TO_TRANSIT_PAGE_SIZE);
    setOrdersError('');
  }, [branch]);

  const openOrderGroup = (group: SelectedOrderGroup, rider: HandoverRiderCount | null = null) => {
    const requestId = ++orderRequestId.current;
    loadingMoreOrders.current = false;
    setSelectedOrderGroup(group);
    setSelectedReceiverLoc(group.kind === 'receiver' ? group.receiverLoc : null);
    setSelectedRider(rider);
    setSelectedOrderImage(null);
    setSelectedImageLoadError(false);
    setToTransitOrders([]);
    setOrdersError('');
    setHasMoreOrders(false);
    setOrdersLoading(true);
    void loadSelectedOrders(group, 0, requestId)
      .catch((error: unknown) => {
        if (requestId !== orderRequestId.current) return;
        const message = error instanceof Error ? error.message : 'Way စာရင်း ဖတ်မရပါ။';
        console.error('Unable to load selected order list:', message);
        setOrdersError(message);
      })
      .finally(() => {
        if (requestId === orderRequestId.current) setOrdersLoading(false);
      });
  };

  const closeToTransitOrders = () => {
    orderRequestId.current += 1;
    loadingMoreOrders.current = false;
    setSelectedReceiverLoc(null);
    setSelectedRider(null);
    setSelectedOrderGroup(null);
    setSelectedOrderImage(null);
    setSelectedImageLoadError(false);
    setOrdersLoading(false);
    setOrdersLoadingMore(false);
  };

  const loadMoreToTransitOrders = () => {
    if (
      !selectedOrderGroup ||
      ordersLoading ||
      ordersLoadingMore ||
      loadingMoreOrders.current ||
      !hasMoreOrders
    ) return;
    const group = selectedOrderGroup;
    const requestId = orderRequestId.current;
    const offset = toTransitOrders.length;
    loadingMoreOrders.current = true;
    setOrdersLoadingMore(true);
    void loadSelectedOrders(group, offset, requestId)
      .catch((error: unknown) => {
        if (requestId !== orderRequestId.current) return;
        const message = error instanceof Error ? error.message : 'နောက်ထပ် Way စာရင်း ဖတ်မရပါ။';
        console.error('Unable to load more selected orders:', message);
        setOrdersError(message);
      })
      .finally(() => {
        if (requestId === orderRequestId.current) {
          loadingMoreOrders.current = false;
          setOrdersLoadingMore(false);
        }
      });
  };

  const retryToTransitOrders = () => {
    if (!selectedOrderGroup) return;
    const group = selectedOrderGroup;
    if (toTransitOrders.length === 0) {
      openOrderGroup(group, selectedRider);
      return;
    }

    const requestId = orderRequestId.current;
    loadingMoreOrders.current = true;
    setOrdersError('');
    setOrdersLoadingMore(true);
    void loadSelectedOrders(group, toTransitOrders.length, requestId)
      .catch((error: unknown) => {
        if (requestId !== orderRequestId.current) return;
        const message = error instanceof Error ? error.message : 'နောက်ထပ် Way စာရင်း ဖတ်မရပါ။';
        console.error('Unable to retry selected order list:', message);
        setOrdersError(message);
      })
      .finally(() => {
        if (requestId === orderRequestId.current) {
          loadingMoreOrders.current = false;
          setOrdersLoadingMore(false);
        }
      });
  };

  const openToTransitOrders = (receiverLoc: string) => {
    openOrderGroup({ kind: 'receiver', receiverLoc });
  };

  const openHandoverOrders = (rider: HandoverRiderCount) => {
    openOrderGroup({ kind: 'rider', riderId: rider.rider_id }, rider);
  };

  const loadDashboard = useCallback(async (isRefresh = false) => {
    const requestId = ++dashboardRequestId.current;
    if (isRefresh) setRefreshing(true);

    try {
      if (!supabase) {
        const message = supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။';
        if (requestId === dashboardRequestId.current) {
          setPendingError(message);
          setToTransitError(message);
          setHandoverRiderError(message);
        }
        return;
      }

      const [pickupResult, transitResult, handoverResult] = await Promise.all([
        supabase
          .from('pickups')
          .select('*', { count: 'exact', head: true })
          .eq('branch', branch)
          .eq('status', 'Pending'),
        supabase.rpc('get_to_transit_order_count', { p_branch: branch }),
        supabase.rpc('get_handover_order_counts', { p_branch: branch }),
      ]);

      if (requestId !== dashboardRequestId.current) return;

      if (pickupResult.error) {
        const message = pickupResult.error.message;
        console.error('Unable to load pending pickup count:', message);
        setPendingError(message);
      } else if (pickupResult.count === null) {
        setPendingError('Pending Pickup အရေအတွက် မရရှိပါ။');
      } else {
        setPendingCount(pickupResult.count);
        setPendingError('');
      }

      if (transitResult.error) {
        const message = transitResult.error.message;
        console.error('Unable to load to-transit order count:', message);
        setToTransitError(message);
      } else if (
        !Array.isArray(transitResult.data) ||
        !transitResult.data.every((item) =>
          typeof item.receiver_loc === 'string' && typeof item.order_count === 'number',
        )
      ) {
        setToTransitError('To Transit အရေအတွက် မရရှိပါ။');
      } else {
        setToTransitCounts(transitResult.data);
        setToTransitError('');
      }

      if (handoverResult.error) {
        const message = handoverResult.error.message;
        console.error('Unable to load handover rider counts:', message);
        setHandoverRiderError(message);
      } else if (
        !Array.isArray(handoverResult.data) ||
        !handoverResult.data.every((item) =>
          typeof item.rider_id === 'string' &&
          typeof item.rider_name === 'string' &&
          typeof item.order_count === 'number',
        )
      ) {
        setHandoverRiderError('Handover အရေအတွက် မရရှိပါ။');
      } else {
        setHandoverRiderCounts(handoverResult.data);
        setHandoverRiderError('');
      }
    } catch (error: unknown) {
      if (requestId !== dashboardRequestId.current) return;
      const message = error instanceof Error ? error.message : 'Dashboard အရေအတွက်များကို ဖတ်မရပါ။';
      console.error('Unable to load dashboard counts:', message);
      setPendingError(message);
      setToTransitError(message);
      setHandoverRiderError(message);
    } finally {
      if (requestId === dashboardRequestId.current && isRefresh) setRefreshing(false);
    }
  }, [branch]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let queueRequestId = 0;
      const syncIntakeQueue = () => {
        setIntakeQueueStatus(getIntakeQueueStatus());
        const requestId = ++queueRequestId;
        void getIntakeQueue()
          .then((items) => {
            if (!active || requestId !== queueRequestId) return;
            setIntakeQueueCount(items.length);
            setIntakeQueueError('');
          })
          .catch((error: unknown) => {
            if (!active || requestId !== queueRequestId) return;
            const message = error instanceof Error ? error.message : 'Queue ကိုဖတ်မရပါ။';
            console.error('Unable to load intake queue count:', message);
            setIntakeQueueError(message);
          });
      };
      const unsubscribe = subscribeToIntakeQueue(syncIntakeQueue);
      syncIntakeQueue();
      void loadDashboard();
      return () => {
        active = false;
        unsubscribe();
        dashboardRequestId.current += 1;
        setRefreshing(false);
      };
    }, [loadDashboard]),
  );

  const intakeQueueFailed = Boolean(intakeQueueError) || intakeQueueStatus === 'failed';
  const intakeQueueAccent = intakeQueueFailed
    ? palette.queueFailed
    : intakeQueueStatus === 'uploading'
      ? palette.queueUploading
      : intakeQueueStatus === 'completed'
        ? palette.queueCompleted
        : palette.orangeLight;
  const showIntakeQueueReminder = Boolean(intakeQueueError) ||
    (intakeQueueCount !== null &&
      (intakeQueueCount > 0 || intakeQueueStatus === 'completed'));
  const intakeQueueMessage = intakeQueueError
    ? 'တင်ရန်စောင့်နေသောစာရင်းကို ဖတ်မရပါ'
    : intakeQueueStatus === 'uploading'
      ? 'Uploading'
      : intakeQueueFailed
        ? 'Failed · ပြန်တင်ရန်လို'
        : intakeQueueStatus === 'completed'
          ? 'Upload complete'
          : 'မတင်ရသေးသော မှတ်တမ်းများ';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.brandCard}>
          <View style={styles.logoFrame}>
            <Image
              accessibilityLabel="All In One logo"
              resizeMode="contain"
              source={require('../../../assets/images/logo.png')}
              style={styles.logo}
            />
          </View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>ALL IN ONE EXPRESS</Text>
            <Text style={styles.brandSubtitle}>OPERATORS APP</Text>
          </View>
        </View>
        {canSelectBranch ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Branch ${branch}. Tap to change branch.`}
            accessibilityHint="Choose MDY or YGN"
            onPress={() => setBranchPickerVisible(true)}
            style={({ pressed }) => [styles.branchBadge, pressed && styles.branchBadgePressed]}
          >
            <View style={styles.branchDot} />
            <Text style={styles.branchText}>{branch}</Text>
            <SymbolView name="chevron.down" tintColor={palette.orangeLight} size={11} />
          </Pressable>
        ) : (
          <View
            accessibilityLabel={`Branch ${branch}`}
            accessibilityRole="text"
            style={styles.branchBadge}
          >
            <View style={styles.branchDot} />
            <Text style={styles.branchText}>{branch}</Text>
          </View>
        )}
      </View>
      <ScrollView
        style={styles.dashboardScroll}
        contentContainerStyle={styles.dashboardContent}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadDashboard(true)}
            tintColor={palette.orangeLight}
            colors={[palette.orangeLight]}
            progressBackgroundColor="#1d140e"
          />
        }
      >
      {showIntakeQueueReminder ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            `${intakeQueueMessage}${intakeQueueCount !== null ? ` · ${intakeQueueCount} ခု` : ''}`
          }
          accessibilityHint="တင်ရန်စောင့်နေသောစာရင်းကို ဖွင့်ရန်"
          onPress={() => router.push({ pathname: '/intake', params: { screen: 'queue' } })}
          style={({ pressed }) => [
            styles.intakeQueueReminder,
            intakeQueueFailed && styles.intakeQueueReminderError,
            intakeQueueStatus === 'uploading' && styles.intakeQueueReminderUploading,
            intakeQueueStatus === 'completed' && styles.intakeQueueReminderCompleted,
            pressed && styles.pendingCardPressed,
          ]}
        >
          <SymbolView
            name="tray.full"
            tintColor={intakeQueueAccent}
            size={17}
            fallback={<Text style={[styles.intakeQueueIconFallback, { color: intakeQueueAccent }]}>▤</Text>}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.intakeQueueReminderText,
              intakeQueueFailed && styles.intakeQueueReminderErrorText,
              intakeQueueStatus === 'uploading' && styles.intakeQueueReminderUploadingText,
              intakeQueueStatus === 'completed' && styles.intakeQueueReminderCompletedText,
            ]}
          >
            {intakeQueueMessage}
          </Text>
          {!intakeQueueError ? (
            <View
              style={[
                styles.intakeQueueCount,
                intakeQueueStatus === 'uploading' && styles.intakeQueueCountUploading,
                intakeQueueFailed && styles.intakeQueueCountFailed,
                intakeQueueStatus === 'completed' && styles.intakeQueueCountCompleted,
              ]}
            >
              <Text
                style={[
                  styles.intakeQueueCountText,
                  { color: intakeQueueAccent },
                ]}
              >
                {intakeQueueCount}
              </Text>
            </View>
          ) : null}
          <SymbolView
            name="chevron.right"
            tintColor={intakeQueueAccent}
            size={13}
          />
        </Pressable>
      ) : null}
      <View style={styles.quickActionsSection}>
        <Text style={[styles.quickActionsTitle, styles.quickActionsSectionTitle]}>QUICK ACTIONS</Text>
        <View style={styles.quickActionsGrid}>
          <View style={styles.quickActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Handover status mode"
              onPress={() => router.push('/status?mode=handover')}
              style={({ pressed }) => [styles.quickAction, styles.quickActionHandover, pressed && styles.quickActionPressed]}
            >
              <View style={[styles.quickActionIcon, styles.quickActionHandoverIcon]}>
                <SymbolView name="person.fill.checkmark" tintColor={palette.orangeLight} size={20} fallback={<Text style={[styles.quickActionFallback, styles.quickActionHandoverText]}>H</Text>} />
              </View>
              <Text numberOfLines={1} style={[styles.quickActionTitle, styles.quickActionHandoverText]}>Handover</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open On Hold status mode"
              onPress={() => router.push('/status?mode=on-hold')}
              style={({ pressed }) => [styles.quickAction, styles.quickActionHold, pressed && styles.quickActionPressed]}
            >
              <View style={[styles.quickActionIcon, styles.quickActionHoldIcon]}>
                <SymbolView name="pause.fill" tintColor={palette.holdAccent} size={19} fallback={<Text style={[styles.quickActionFallback, styles.quickActionHoldText]}>Ⅱ</Text>} />
              </View>
              <Text numberOfLines={1} style={[styles.quickActionTitle, styles.quickActionHoldText]}>On Hold</Text>
            </Pressable>
          </View>
          <View style={styles.quickActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Returned status mode"
              onPress={() => router.push('/status?mode=returned')}
              style={({ pressed }) => [styles.quickAction, styles.quickActionReturned, pressed && styles.quickActionPressed]}
            >
              <View style={[styles.quickActionIcon, styles.quickActionReturnedIcon]}>
                <SymbolView name="arrow.uturn.backward" tintColor={palette.returnedAccent} size={19} fallback={<Text style={[styles.quickActionFallback, styles.quickActionReturnedText]}>↩</Text>} />
              </View>
              <Text numberOfLines={1} style={[styles.quickActionTitle, styles.quickActionReturnedText]}>Returned</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open parcel lookup"
              onPress={() => router.push('/lookup')}
              style={({ pressed }) => [styles.quickAction, styles.quickActionLookup, pressed && styles.quickActionPressed]}
            >
              <View style={[styles.quickActionIcon, styles.quickActionLookupIcon]}>
                <SymbolView name="printer" tintColor={palette.printAccent} size={19} fallback={<Text style={[styles.quickActionFallback, styles.quickActionLookupText]}>⌕</Text>} />
              </View>
              <Text numberOfLines={1} style={[styles.quickActionTitle, styles.quickActionLookupText]}>Print</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Transit Arrival"
              accessibilityHint="Receive incoming transit parcels"
              onPress={() => router.push('/status?arrival=true')}
              style={({ pressed }) => [styles.quickAction, styles.quickActionArrival, pressed && styles.quickActionPressed]}
            >
              <View style={[styles.quickActionIcon, styles.quickActionArrivalIcon]}>
                <SymbolView name="airplane.arrival" tintColor={palette.arrivalAccent} size={19} fallback={<Text style={[styles.quickActionFallback, styles.quickActionArrivalText]}>↓</Text>} />
              </View>
              <Text numberOfLines={1} style={[styles.quickActionTitle, styles.quickActionArrivalText]}>Arrival</Text>
            </Pressable>
          </View>
        </View>
      </View>

      
      <View style={styles.quickReviewSection}>
        <Text style={[styles.quickActionsTitle, styles.quickReviewSectionTitle]}>QUICK REVIEWS</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Pending pickups: ${pendingCount ?? (pendingError ? 'unavailable' : 'loading')}`}
        accessibilityHint="Open pickups"
        onPress={() => router.navigate('/(tabs)/pickups')}
        style={({ pressed }) => [
          styles.pendingCard,
          styles.pendingPickupCard,
          pressed && styles.pendingCardPressed,
        ]}
      >
        
        <View style={styles.pendingCopy}>
          <View style={styles.pendingEyebrow}>
            <View style={styles.pendingDot} />
            <Text style={styles.pendingEyebrowText}>PICKUP STATUS</Text>
          </View>
          <Text style={styles.pendingTitle}>Pending Pickups</Text>
          <Text style={[styles.pendingSubtitle, pendingError ? styles.pendingError : null]} numberOfLines={2}>
            {pendingError || (pendingCount === null ? 'Loading count...' : 'You have pending pickups to process.')}
          </Text>
        </View>
        <View style={styles.pendingCountBox}>
          <Text style={styles.pendingCount}>{pendingError ? '!' : pendingCount ?? '—'}</Text>
          <Text style={styles.pendingCountLabel}>{pendingError ? 'ERROR' : 'PENDING'}</Text>
        </View>
        <View style={styles.pendingIcon}>
          <SymbolView
            name="shippingbox.fill"
            tintColor={palette.orangeLight}
            size={22}
            fallback={<Text style={styles.pendingIconFallback}>▣</Text>}
          />
        </View>
      </Pressable>
      <View style={[styles.pendingCard, styles.toTransitCard]}>
        <View style={styles.toTransitHeader}>
          <View style={styles.pendingCopy}>
            <View style={styles.pendingEyebrow}>
              <View style={[styles.pendingDot, styles.toTransitDot]} />
              <Text style={[styles.pendingEyebrowText, styles.toTransitEyebrow]}>TO TRANSIT · {branch}</Text>
            </View>
            <Text style={styles.pendingTitle}>To Transit</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open To Transit for ${branch}`}
            accessibilityHint="Open Transit Out mode"
            onPress={() => router.push('/status?mode=transit-out')}
            style={({ pressed }) => [
              styles.pendingIcon,
              styles.toTransitAction,
              pressed && styles.pendingCardPressed,
            ]}
          >
            <SymbolView
              name="arrow.trianglehead.2.clockwise.rotate.90"
              tintColor="#17100a"
              size={18}
              fallback={<Text style={[styles.pendingIconFallback, styles.toTransitIconFallback]}>⇄</Text>}
            />
            <Text style={styles.toTransitActionText}>TRANSIT</Text>
          </Pressable>
        </View>
        {toTransitError ? (
          <Text style={[styles.pendingSubtitle, styles.pendingError]}>{toTransitError}</Text>
        ) : toTransitCounts === null ? (
          <Text style={styles.pendingSubtitle}>Loading counts...</Text>
        ) : toTransitCounts.length === 0 ? (
          <Text style={styles.pendingSubtitle}>No orders to transit.</Text>
        ) : (
          <View style={styles.toTransitCounts}>
            {toTransitCounts.map((item) => (
              <Pressable
                key={item.receiver_loc}
                accessibilityRole="button"
                accessibilityLabel={`${item.receiver_loc}, ${item.order_count} orders. Show way list.`}
                onPress={() => openToTransitOrders(item.receiver_loc)}
                style={({ pressed }) => [
                  styles.toTransitCountItem,
                  pressed && styles.toTransitCountItemPressed,
                ]}
              >
                <Text style={styles.toTransitLocation}>{item.receiver_loc}</Text>
                <Text style={styles.toTransitNumber}>{item.order_count.toLocaleString()}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <View
        accessibilityLabel={`Handover parcels by rider for ${branch}`}
        style={[styles.pendingCard, styles.handoverCard]}
      >
        <View style={styles.toTransitHeader}>
          <View style={styles.pendingCopy}>
            <View style={styles.pendingEyebrow}>
              <View style={[styles.pendingDot, styles.handoverDot]} />
              <Text style={[styles.pendingEyebrowText, styles.handoverEyebrow]}>HANDOVER · {branch}</Text>
            </View>
            <Text style={styles.pendingTitle}>Rider Handover</Text>
          </View>
          <View style={[styles.pendingIcon, styles.handoverIcon]}>
            <SymbolView
              name="person.2.fill"
              tintColor={palette.handoverAccent}
              size={20}
              fallback={<Text style={[styles.pendingIconFallback, styles.handoverIconFallback]}>♙</Text>}
            />
          </View>
        </View>
        {handoverRiderError ? (
          <Text style={[styles.pendingSubtitle, styles.pendingError]}>{handoverRiderError}</Text>
        ) : handoverRiderCounts === null ? (
          <Text style={styles.pendingSubtitle}>Loading rider counts...</Text>
        ) : handoverRiderCounts.length === 0 ? (
          <Text style={styles.pendingSubtitle}>No Handover orders.</Text>
        ) : (
          <View style={styles.toTransitCounts}>
            {handoverRiderCounts.map((item) => (
              <Pressable
                key={item.rider_id}
                accessibilityRole="button"
                accessibilityLabel={`${item.rider_name}, ${item.order_count} handover orders. Show way list.`}
                onPress={() => openHandoverOrders(item)}
                style={({ pressed }) => [
                  styles.toTransitCountItem,
                  styles.handoverCountItem,
                  pressed && styles.toTransitCountItemPressed,
                ]}
              >
                <Text numberOfLines={1} style={[styles.toTransitLocation, styles.handoverRiderName]}>
                  {item.rider_name}
                </Text>
                <Text style={[styles.toTransitNumber, styles.handoverCount]}>
                  {item.order_count.toLocaleString()}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      </ScrollView>
      <Modal
        transparent
        visible={branchPickerVisible}
        animationType="fade"
        onRequestClose={() => setBranchPickerVisible(false)}
      >
        <View style={styles.branchPickerBackdrop}>
          <Pressable
            accessibilityLabel="Close branch picker"
            style={StyleSheet.absoluteFill}
            onPress={() => setBranchPickerVisible(false)}
          />
          <View style={styles.branchPickerCard}>
            <Text style={styles.branchPickerEyebrow}>ADMIN BRANCH</Text>
            <Text style={styles.branchPickerTitle}>Select Branch</Text>
            <Text style={styles.branchPickerSubtitle}>Dashboard data ကို ပြမည့် branch ကို ရွေးပါ။</Text>
            {(['MDY', 'YGN'] as const).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: branch === option }}
                onPress={() => {
                  setBranch(option);
                  closeToTransitOrders();
                  setBranchPickerVisible(false);
                }}
                style={({ pressed }) => [
                  styles.branchPickerOption,
                  branch === option && styles.branchPickerOptionSelected,
                  pressed && styles.branchBadgePressed,
                ]}
              >
                <View style={styles.branchPickerOptionCopy}>
                  <Text style={[styles.branchPickerOptionCode, branch === option && styles.branchPickerOptionCodeSelected]}>
                    {option}
                  </Text>
                  <Text style={styles.branchPickerOptionName}>
                    {option === 'MDY' ? 'Mandalay' : 'Yangon'}
                  </Text>
                </View>
                {branch === option ? (
                  <SymbolView name="checkmark.circle.fill" tintColor={palette.orangeLight} size={20} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
      <Modal
        visible={selectedOrderGroup !== null}
        transparent
        animationType="slide"
        onRequestClose={closeToTransitOrders}
      >
        <View style={styles.ordersModalBackdrop}>
          <View
            style={[
              styles.ordersModal,
              selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersModal,
            ]}
          >
            <View style={styles.ordersModalHeader}>
              <View style={styles.ordersModalTitleCopy}>
                <Text
                  style={[
                    styles.ordersModalEyebrow,
                    selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersModalEyebrow,
                  ]}
                >
                  {selectedOrderGroup?.kind === 'rider' ? 'HANDOVER' : 'TO TRANSIT'} · {branch}
                </Text>
                <Text
                  style={[
                    styles.ordersModalTitle,
                    selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersModalTitle,
                  ]}
                >
                  {selectedOrderImage
                    ? 'Parcel Photo'
                    : selectedOrderGroup?.kind === 'rider'
                      ? `${selectedRider?.rider_name ?? 'Rider'} Way List`
                      : `${selectedReceiverLoc ?? ''} Way List`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={selectedOrderImage ? 'Back to way list' : 'Close way list'}
                onPress={selectedOrderImage ? () => setSelectedOrderImage(null) : closeToTransitOrders}
                style={({ pressed }) => [
                  styles.ordersCloseButton,
                  selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersCloseButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.ordersCloseText,
                    selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersCloseText,
                  ]}
                >
                  {selectedOrderImage ? '‹' : '×'}
                </Text>
              </Pressable>
            </View>
            {selectedOrderImage ? (
              <View
                style={[
                  styles.orderImageViewer,
                  selectedOrderGroup?.kind === 'rider' && styles.handoverOrderImageViewer,
                ]}
              >
                {selectedImageLoadError ? (
                  <Text
                    style={[
                      styles.ordersErrorText,
                      selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersErrorText,
                    ]}
                  >
                    ပုံဖွင့်မရပါ။ Network ကိုစစ်ပြီး ပြန်ကြိုးစားပါ။
                  </Text>
                ) : (
                  <Image
                    accessibilityLabel="Parcel photo"
                    source={{ uri: selectedOrderImage }}
                    style={[
                      styles.orderImageFull,
                      selectedOrderGroup?.kind === 'rider' && styles.handoverOrderImageFull,
                    ]}
                    resizeMode="contain"
                    onError={() => setSelectedImageLoadError(true)}
                  />
                )}
              </View>
            ) : ordersLoading ? (
              <View
                style={[
                  styles.ordersState,
                  selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersState,
                ]}
              >
                <ActivityIndicator color={palette.orangeLight} />
                <Text
                  style={[
                    styles.ordersStateText,
                    selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersStateText,
                  ]}
                >
                  Way စာရင်း ဖတ်နေသည်...
                </Text>
              </View>
            ) : ordersError && toTransitOrders.length === 0 ? (
              <View
                style={[
                  styles.ordersState,
                  selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersState,
                ]}
              >
                <Text
                  style={[
                    styles.ordersErrorText,
                    selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersErrorText,
                  ]}
                >
                  {ordersError}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={retryToTransitOrders}
                  style={({ pressed }) => [
                    styles.ordersRetryButton,
                    selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersRetryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.ordersRetryText,
                      selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersRetryText,
                    ]}
                  >
                    ထပ်ကြိုးစားရန်
                  </Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={toTransitOrders}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.orderRow,
                      selectedOrderGroup?.kind === 'rider' && styles.handoverOrderRow,
                    ]}
                  >
                    <Pressable
                      accessibilityRole={item.image_url ? 'button' : undefined}
                      accessibilityLabel={item.image_url ? `View parcel photo for ${item.item_id || item.barcode || 'way'}` : undefined}
                      disabled={!item.image_url || failedThumbnailIds.has(item.id)}
                      onPress={() => {
                        setSelectedImageLoadError(false);
                        setSelectedOrderImage(item.image_url);
                      }}
                      style={({ pressed }) => [
                        styles.orderThumbnail,
                        selectedOrderGroup?.kind === 'rider' && styles.handoverOrderThumbnail,
                        pressed && item.image_url && !failedThumbnailIds.has(item.id)
                          ? styles.orderThumbnailPressed
                          : null,
                      ]}
                    >
                      {item.image_url && !failedThumbnailIds.has(item.id) ? (
                        <Image
                          source={{ uri: item.image_url }}
                          style={[
                            styles.orderThumbnailImage,
                          ]}
                          resizeMode="cover"
                          onError={() => setFailedThumbnailIds((current) => new Set(current).add(item.id))}
                        />
                      ) : (
                        <SymbolView
                          name="shippingbox"
                          tintColor={palette.orangeLight}
                          size={20}
                          fallback={
                            <Text
                            style={[
                              styles.orderThumbnailFallback,
                              selectedOrderGroup?.kind === 'rider' && styles.handoverOrderThumbnailFallback,
                            ]}
                            >
                              ▣
                            </Text>
                          }
                        />
                      )}
                    </Pressable>
                    <View style={styles.orderRowCopy}>
                      <Text
                        style={[
                          styles.orderWay,
                          selectedOrderGroup?.kind === 'rider' && styles.handoverOrderWay,
                        ]}
                        numberOfLines={1}
                      >
                        {item.item_id || item.barcode || 'Way မရှိပါ'}
                      </Text>
                      <Text
                        style={[
                          styles.orderSender,
                          selectedOrderGroup?.kind === 'rider' && styles.handoverOrderSender,
                        ]}
                        numberOfLines={1}
                      >
                        ပို့သူ · {item.sender_name || 'မသတ်မှတ်ရသေး'}
                      </Text>
                      <Text
                        style={[
                          styles.orderReceiver,
                          selectedOrderGroup?.kind === 'rider' && styles.handoverOrderReceiver,
                        ]}
                        numberOfLines={1}
                      >
                        {[item.receiver_name, item.receiver_phone].filter(Boolean).join(' · ') || 'လက်ခံသူအချက်အလက်မရှိပါ'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.orderStatus,
                        selectedOrderGroup?.kind === 'rider' && styles.handoverOrderStatus,
                      ]}
                    >
                      {item.status}
                    </Text>
                  </View>
                )}
                contentContainerStyle={styles.ordersListContent}
                ItemSeparatorComponent={() => <View style={styles.ordersListSeparator} />}
                onEndReached={loadMoreToTransitOrders}
                onEndReachedThreshold={0.4}
                ListEmptyComponent={
                  <View
                    style={[
                      styles.ordersState,
                      selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersState,
                    ]}
                  >
                    <Text
                      style={[
                        styles.ordersStateText,
                        selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersStateText,
                      ]}
                    >
                      {selectedOrderGroup?.kind === 'rider'
                        ? 'ဒီ rider အတွက် Handover Way မရှိပါ။'
                        : 'ဒီနေရာအတွက် Way မရှိပါ။'}
                    </Text>
                  </View>
                }
                ListFooterComponent={(
                  <View style={styles.ordersFooter}>
                    {ordersLoadingMore ? (
                      <ActivityIndicator color={palette.orangeLight} />
                    ) : null}
                    {ordersError && toTransitOrders.length > 0 ? (
                      <Pressable
                        onPress={retryToTransitOrders}
                        style={[
                          styles.ordersRetryButton,
                          selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersRetryButton,
                        ]}
                      >
                        <Text
                          style={[
                            styles.ordersRetryText,
                            selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersRetryText,
                          ]}
                        >
                          {ordersError} · ထပ်ကြိုးစားရန်
                        </Text>
                      </Pressable>
                    ) : null}
                    {!ordersLoadingMore && !ordersError && hasMoreOrders ? (
                      <Text
                        style={[
                          styles.ordersStateText,
                          selectedOrderGroup?.kind === 'rider' && styles.handoverOrdersStateText,
                        ]}
                      >
                        အောက်သို့ဆွဲ၍ နောက်ထပ်ကြည့်ပါ
                      </Text>
                    ) : null}
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  dashboardScroll: { flex: 1 },
  dashboardContent: { flexGrow: 1, paddingTop: 10, paddingBottom: 120 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 3,
  },
  brandCard: {
    minWidth: 0,
    flex: 1,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 6,
  },
  logoFrame: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 13,
    backgroundColor: palette.white,
  },
  logo: {
    width: 37,
    height: 37,
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  branchBadge: {
    minWidth: 58,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 9,
  },
  branchBadgePressed: { opacity: 0.76 },
  branchDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.orangeLight,
  },
  branchText: {
    color: palette.orangeLight,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  branchPickerBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  branchPickerCard: {
    width: '100%',
    maxWidth: 360,
    gap: 9,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  branchPickerEyebrow: { color: palette.orangeLight, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  branchPickerTitle: { color: palette.white, fontSize: 19, fontWeight: '900' },
  branchPickerSubtitle: { color: palette.muted, fontSize: 11, lineHeight: 16, marginBottom: 3 },
  branchPickerOption: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#1a1a1a',
  },
  branchPickerOptionSelected: { borderColor: '#794619', backgroundColor: '#24180f' },
  branchPickerOptionCopy: { gap: 2 },
  branchPickerOptionCode: { color: '#e4ddd7', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  branchPickerOptionCodeSelected: { color: palette.orangeLight },
  branchPickerOptionName: { color: palette.muted, fontSize: 10 },
  pendingCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 18,
    marginTop: 20,
    padding: 18,
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#59371f',
    backgroundColor: '#19130e',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 4,
  },
  pendingCardPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  pendingPickupCard: { marginTop: 14, paddingVertical: 12 },
  pendingCopy: { flex: 1, minWidth: 0, gap: 7 },
  pendingEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pendingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.orangeLight },
  pendingEyebrowText: { color: palette.orangeLight, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  pendingTitle: { color: palette.white, fontSize: 15, lineHeight: 22, fontWeight: '800' },
  pendingSubtitle: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  pendingError: { color: '#ff8273' },
  pendingCountBox: {
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 15,
    backgroundColor: '#2b1c12',
  },
  pendingCount: { color: palette.orangeLight, fontSize: 40, lineHeight: 46, fontWeight: '900' },
  pendingCountLabel: { color: palette.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  intakeQueueReminder: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 18,
    marginBottom: 5,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#49301f',
    backgroundColor: '#1b150f',
  },
  intakeQueueReminderError: { borderColor: '#693032', backgroundColor: '#241315' },
  intakeQueueReminderUploading: { borderColor: '#315879', backgroundColor: '#111c27' },
  intakeQueueReminderCompleted: { borderColor: '#315b43', backgroundColor: '#122119' },
  intakeQueueReminderText: { flex: 1, color: palette.orangeLight, fontSize: 11, fontWeight: '800' },
  intakeQueueReminderErrorText: { color: palette.queueFailed },
  intakeQueueReminderUploadingText: { color: palette.queueUploading },
  intakeQueueReminderCompletedText: { color: palette.queueCompleted },
  intakeQueueIconFallback: { color: palette.orangeLight, fontSize: 15 },
  intakeQueueCount: {
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: '#302014',
  },
  intakeQueueCountUploading: { backgroundColor: '#1b2b3a' },
  intakeQueueCountFailed: { backgroundColor: '#351d20' },
  intakeQueueCountCompleted: { backgroundColor: '#1b3023' },
  intakeQueueCountText: { color: palette.orangeLight, fontSize: 11, fontWeight: '900' },
  pendingIcon: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#25180f',
  },
  pendingIconFallback: { color: palette.orangeLight, fontSize: 18 },
  toTransitIconFallback: { color: palette.transitAccent },
  handoverIconFallback: { color: palette.handoverAccent },
  toTransitCard: {
    minHeight: 104,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 9,
    marginTop: 9,
    padding: 14,
    borderRadius: 17,
    borderLeftWidth: 3,
    borderLeftColor: '#c56d32',
    borderColor: '#49301f',
    backgroundColor: '#17130f',
    shadowColor: '#000',
  },
  toTransitHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', paddingRight: 104 },
  toTransitDot: { backgroundColor: palette.orangeLight },
  toTransitEyebrow: { color: palette.orangeLight },
  toTransitCounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  toTransitCountItem: {
    minHeight: 36,
    minWidth: 0,
    flexGrow: 1,
    flexBasis: '40%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#49301f',
    backgroundColor: '#21170f',
  },
  toTransitCountItemPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  pressed: { opacity: 0.72 },
  toTransitLocation: { color: '#f0dfcf', fontSize: 11, fontWeight: '800' },
  toTransitNumber: { color: palette.orangeLight, fontSize: 16, fontWeight: '900' },
  toTransitAction: {
    top: -4,
    right: 8,
    width: 96,
    height: 42,
    flexDirection: 'row',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.orangeLight,
    backgroundColor: palette.orange,
  },
  toTransitActionText: { color: '#17100a', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  handoverCard: {
    minHeight: 104,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 9,
    marginHorizontal: 18,
    marginTop: 9,
    padding: 14,
    borderRadius: 17,
    borderLeftWidth: 3,
    borderLeftColor: palette.orangeLight,
    borderColor: '#49301f',
    backgroundColor: '#17130f',
    shadowColor: '#000',
  },
  handoverDot: { backgroundColor: palette.orangeLight },
  handoverEyebrow: { color: palette.orangeLight },
  handoverIcon: { backgroundColor: '#271d35' },
  handoverCountItem: { borderColor: '#49301f', backgroundColor: '#21170f' },
  handoverRiderName: { flex: 1, color: '#f0dfcf' },
  handoverCount: { color: palette.orangeLight },
  quickActionsSection: { gap: 8, marginHorizontal: 18, marginTop: 8 },
  quickActionsDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: palette.border,
  },
  quickReviewSection: { marginHorizontal: 18, marginTop: 20 },
  quickActionsTitle: { color: palette.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginLeft: 2, marginBottom: 10 },
  quickActionsSectionTitle: { color: palette.orangeLight },
  quickReviewSectionTitle: { color: '#e5b17f' },
  quickActionsGrid: { gap: 8 },
  quickActionsRow: { flexDirection: 'row', gap: 8 },
  quickAction: {
    minHeight: 86,
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  quickActionPressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  quickActionIcon: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  quickActionFallback: { fontSize: 14, fontWeight: '900' },
  quickActionTitle: { maxWidth: '100%', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  quickActionHandover: { borderColor: '#56371f', backgroundColor: '#19130e' },
  quickActionHandoverIcon: { backgroundColor: '#2d1d11' },
  quickActionHandoverText: { color: palette.orangeLight },
  quickActionHold: { borderColor: '#56371f', backgroundColor: '#19130e' },
  quickActionHoldIcon: { backgroundColor: '#302912' },
  quickActionHoldText: { color: palette.holdAccent },
  quickActionReturned: { borderColor: '#56371f', backgroundColor: '#19130e' },
  quickActionReturnedIcon: { backgroundColor: '#321c1a' },
  quickActionReturnedText: { color: palette.returnedAccent },
  quickActionLookup: { borderColor: '#56371f', backgroundColor: '#19130e' },
  quickActionLookupIcon: { backgroundColor: '#192534' },
  quickActionLookupText: { color: palette.printAccent },
  quickActionArrival: { borderColor: '#56371f', backgroundColor: '#19130e' },
  quickActionArrivalIcon: { backgroundColor: '#172b25' },
  quickActionArrivalText: { color: palette.arrivalAccent },
  handoverOrderStatus: { color: palette.orangeLight },
  handoverOrdersModal: { borderColor: palette.border, backgroundColor: palette.surface },
  handoverOrdersModalEyebrow: { color: palette.orangeLight },
  handoverOrdersModalTitle: { color: palette.white },
  handoverOrdersCloseButton: { backgroundColor: '#25180f' },
  handoverOrdersCloseText: { color: palette.orangeLight },
  handoverOrdersState: { backgroundColor: palette.surface },
  handoverOrdersStateText: { color: palette.muted },
  handoverOrdersErrorText: { color: '#ff9aa8' },
  handoverOrdersRetryButton: { backgroundColor: '#25180f' },
  handoverOrdersRetryText: { color: palette.orangeLight },
  handoverOrderRow: { borderColor: palette.border, backgroundColor: '#1a1a1a' },
  handoverOrderThumbnail: { backgroundColor: '#21170f' },
  handoverOrderThumbnailFallback: { color: palette.orangeLight },
  handoverOrderWay: { color: palette.white },
  handoverOrderSender: { color: '#e1d9d2' },
  handoverOrderReceiver: { color: palette.muted },
  handoverOrderImageViewer: { backgroundColor: palette.background },
  handoverOrderImageFull: { borderRadius: 14 },
  ordersListSeparator: { height: 8 },
  ordersModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  ordersModal: {
    height: '84%',
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  ordersModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  ordersModalTitleCopy: { flex: 1, gap: 5 },
  ordersModalEyebrow: { color: palette.orangeLight, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  ordersModalTitle: { color: palette.white, fontSize: 19, fontWeight: '900' },
  ordersCloseButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#25180f',
  },
  ordersCloseText: { color: palette.orangeLight, fontSize: 27, lineHeight: 30 },
  ordersListContent: { flexGrow: 1, paddingBottom: 12 },
  ordersState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  ordersStateText: { color: palette.muted, fontSize: 12, textAlign: 'center' },
  ordersErrorText: { color: '#ff8273', fontSize: 12, textAlign: 'center' },
  ordersRetryButton: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#25180f',
  },
  ordersRetryText: { color: palette.orangeLight, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  orderRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  orderRowCopy: { flex: 1, minWidth: 0, gap: 5 },
  orderThumbnail: {
    width: 54,
    height: 54,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: '#21170f',
  },
  orderThumbnailPressed: { opacity: 0.7 },
  orderThumbnailImage: { width: '100%', height: '100%' },
  orderThumbnailFallback: { color: palette.orangeLight, fontSize: 20 },
  orderWay: { color: palette.white, fontSize: 14, fontWeight: '800' },
  orderSender: { color: '#e1d9d2', fontSize: 11, fontWeight: '700' },
  orderReceiver: { color: palette.muted, fontSize: 11 },
  orderStatus: {
    color: palette.orangeLight,
    fontSize: 10,
    fontWeight: '800',
  },
  orderImageViewer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: palette.background,
  },
  orderImageFull: { width: '100%', height: '100%' },
  ordersFooter: { minHeight: 48, justifyContent: 'center', gap: 8, paddingVertical: 8 },
  brandName: {
    color: palette.white,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  brandSubtitle: {
    color: palette.orangeLight,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
});
