import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { SymbolView } from '@/components/AppSymbol';
import { useTabBlurTarget } from '@/components/TabBlurContext';
import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type DockIcon = 'house.fill' | 'shippingbox.fill' | 'safari' | 'person.crop.circle';

type DockTab = {
  name: string;
  label: string;
  icon: DockIcon;
};

const dockTabs: DockTab[] = [
  { name: 'index', label: 'Home', icon: 'house.fill' },
  { name: 'pickups', label: 'Pickups', icon: 'shippingbox.fill' },
  { name: 'explore', label: 'Explore', icon: 'safari' },
  { name: 'profile', label: 'Profile', icon: 'person.crop.circle' },
];

type BottomDockProps =
  BottomTabBarProps;

export function BottomDock(tabNavigation: BottomDockProps) {
  const insets = useSafeAreaInsets();
  const activeRouteName = tabNavigation.state.routes[tabNavigation.state.index]?.name;
  const activeRouteKey = tabNavigation.state.routes[tabNavigation.state.index]?.key;
  const blurTarget = useTabBlurTarget(activeRouteKey);
  const activeTabIndex = Math.max(0, dockTabs.findIndex((tab) => tab.name === activeRouteName));
  const pillWidth = useSharedValue(0);
  const indicatorIndex = useSharedValue(activeTabIndex);
  const indicatorStyle = useAnimatedStyle(() => {
    const itemWidth = Math.max(0, (pillWidth.value - 12) / dockTabs.length);
    return {
      width: itemWidth,
      transform: [{ translateX: itemWidth * indicatorIndex.value }],
    };
  });

  useEffect(() => {
    indicatorIndex.value = withSpring(activeTabIndex, {
      damping: 13,
      stiffness: 190,
      mass: 0.7,
    });
  }, [activeTabIndex, indicatorIndex]);

  const navigateToTab = (name: string) => {
    const route = tabNavigation.state.routes.find((item) => item.name === name);
    if (!route) return;

    const event = tabNavigation.emitter.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented && route.name !== activeRouteName) {
      tabNavigation.navigateToTab(route.key);
    }
  };

  return (
    <View
      style={[
        styles.dockArea,
        {
          bottom: Math.max(0, insets.bottom - 4),
          paddingLeft: Math.max(insets.left, 14),
          paddingRight: Math.max(insets.right, 14),
        },
      ]}
    >
      <View style={styles.dockRow}>
        <View style={styles.tabPillShadow}>
          <View
            style={styles.tabPill}
            onLayout={(event) => {
              pillWidth.value = event.nativeEvent.layout.width;
            }}
          >
            <BlurView
              blurTarget={blurTarget}
              blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              blurReductionFactor={2}
              intensity={45}
              tint="systemUltraThinMaterialDark"
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.glassTint} />
            <Animated.View pointerEvents="none" style={[styles.activeIndicator, indicatorStyle]} />
            {dockTabs.map((tab) => {
              const focused = activeRouteName === tab.name;
              return (
                <JellyPressable
                  key={tab.name}
                  onPress={() => navigateToTab(tab.name)}
                  accessibilityLabel={tab.label}
                  selected={focused}
                  style={styles.tabButton}
                >
                  <SymbolView
                    name={tab.icon}
                    tintColor={focused ? colors.active : colors.inactive}
                    size={21}
                    fallback={<Text style={[styles.iconFallback, focused && styles.iconFallbackFocused]}>•</Text>}
                  />
                  <Text style={[styles.tabLabel, focused && styles.tabLabelFocused]}>{tab.label}</Text>
                </JellyPressable>
              );
            })}
          </View>
        </View>
        <JellyPressable
          accessibilityLabel="Start parcel intake"
          onPress={() => router.push('/intake')}
          style={styles.intakeButton}
        >
          <View pointerEvents="none" style={styles.intakeGlassTint} />
          <SymbolView
            name="plus"
            tintColor="#17100a"
            size={23}
            fallback={<Text style={styles.plusFallback}>+</Text>}
          />
        </JellyPressable>
      </View>
    </View>
  );
}

function JellyPressable({
  children,
  accessibilityLabel,
  selected = false,
  onPress,
  style,
}: PropsWithChildren<{
  accessibilityLabel: string;
  selected?: boolean;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
}>) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected }}
        onPress={onPress}
        onPressIn={() => {
          scale.set(withSpring(0.88, { damping: 7, stiffness: 300, mass: 0.55 }));
        }}
        onPressOut={() => {
          scale.set(withSpring(1, { damping: 8, stiffness: 240, mass: 0.55 }));
        }}
        style={styles.pressableContent}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const colors = {
  selected: 'rgba(255, 155, 71, 0.16)',
  active: '#ff9b47',
  inactive: '#c2b5ab',
  border: 'rgba(255, 255, 255, 0.28)',
};

const styles = StyleSheet.create({
  dockArea: {
    position: 'absolute',
    right: 0,
    left: 0,
    paddingTop: 4,
  },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tabPillShadow: {
    height: 60,
    flex: 1,
    borderRadius: 30,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 10,
  },
  tabPill: {
    position: 'relative',
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    paddingHorizontal: 5,
    borderRadius: 30,
    backgroundColor: 'rgba(34, 29, 26, 0.2)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  glassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(47, 39, 34, 0.1)',
  },
  activeIndicator: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    left: 6,
    borderRadius: 24,
    backgroundColor: colors.selected,
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 140, 0.24)',
  },
  tabButton: {
    minWidth: 0,
    height: 50,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 24,
  },
  pressableContent: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 30, overflow: 'hidden' },
  iconFallback: { color: colors.inactive, fontSize: 20, lineHeight: 20 },
  iconFallbackFocused: { color: colors.active },
  tabLabel: { color: colors.inactive, fontSize: 9, fontWeight: '600' },
  tabLabelFocused: { color: colors.active, fontWeight: '700' },
  intakeButton: {
    position: 'relative',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    backgroundColor: 'rgb(249, 116, 22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 173, 112, 0.52)',
    shadowColor: '#ff7417',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 9,
    overflow: 'hidden',
  },
  intakeGlassTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 115, 0, 0.36)',
  },
  plusFallback: { color: '#17100a', fontSize: 26, lineHeight: 29, fontWeight: '400' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
});
