import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from '@/components/AppSymbol';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const palette = {
  background: '#090909',
  surface: '#141414',
  border: '#292929',
  orangeLight: '#ff9b47',
  white: '#f7f4f1',
  muted: '#aaa39c',
};

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeading}>
          <Text style={styles.eyebrow}>ALL-IN-ONE · OPERATIONS</Text>
          <Text style={styles.title}>လုပ်ဆောင်ချက်များ အားလုံး</Text>
          
        </View>

        <View style={styles.shortcutList}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/intake')}
            style={({ pressed }) => [styles.shortcutCard, styles.primaryCard, pressed && styles.pressed]}
          >
            <View style={styles.shortcutIcon}>
              <SymbolView
                name="shippingbox.fill"
                tintColor={palette.orangeLight}
                size={23}
                fallback={<Text style={styles.iconFallback}>▣</Text>}
              />
            </View>
            <View style={styles.shortcutCopy}>
              <Text style={styles.shortcutTitle}>ပါဆယ်လက်ခံမည်</Text>
              <Text style={styles.shortcutDescription} numberOfLines={1}>Barcode စစ်ဆေးပြီး ဓာတ်ပုံနှင့် မှတ်တမ်းတင်ရန်</Text>
            </View>
            <View style={styles.arrowIcon}>
              <SymbolView
                name="arrow.right"
                tintColor={palette.orangeLight}
                size={18}
                fallback={<Text style={styles.arrowFallback}>›</Text>}
              />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/stock-check')}
            style={({ pressed }) => [styles.shortcutCard, pressed && styles.pressed]}
          >
            <View style={styles.shortcutIcon}>
              <SymbolView
                name="checkmark.seal.fill"
                tintColor={palette.orangeLight}
                size={21}
                fallback={<Text style={styles.iconFallback}>✓</Text>}
              />
            </View>
            <View style={styles.shortcutCopy}>
              <Text style={styles.shortcutTitle}>Stock Check</Text>
              <Text style={styles.shortcutDescription} numberOfLines={1}>စာရင်းကြည့်၊ barcode scan လုပ်ပြီး နေ့စဉ်စစ်ဆေးရန်</Text>
            </View>
            <SymbolView
              name="chevron.right"
              tintColor={palette.muted}
              size={16}
              fallback={<Text style={styles.chevronFallback}>›</Text>}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/status')}
            style={({ pressed }) => [styles.shortcutCard, pressed && styles.pressed]}
          >
            <View style={styles.shortcutIcon}>
              <SymbolView
                name="arrow.trianglehead.2.clockwise.rotate.90"
                tintColor={palette.orangeLight}
                size={21}
                fallback={<Text style={styles.iconFallback}>↻</Text>}
              />
            </View>
            <View style={styles.shortcutCopy}>
              <Text style={styles.shortcutTitle}>Rider & parcel status</Text>
              <Text style={styles.shortcutDescription} numberOfLines={1}>Parcel ရှာဖွေပြီး status ပြောင်းရန်</Text>
            </View>
            <SymbolView
              name="chevron.right"
              tintColor={palette.muted}
              size={16}
              fallback={<Text style={styles.chevronFallback}>›</Text>}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/lookup')}
            style={({ pressed }) => [styles.shortcutCard, pressed && styles.pressed]}
          >
            <View style={styles.shortcutIcon}>
              <SymbolView
                name="doc.text.magnifyingglass"
                tintColor={palette.orangeLight}
                size={21}
                fallback={<Text style={styles.iconFallback}>⌕</Text>}
              />
            </View>
            <View style={styles.shortcutCopy}>
              <Text style={styles.shortcutTitle}>Parcel lookup & voucher</Text>
              <Text style={styles.shortcutDescription} numberOfLines={1}>ရှာဖွေ၊ voucher ကြည့်ပြီး print ထုတ်ရန်</Text>
            </View>
            <SymbolView
              name="chevron.right"
              tintColor={palette.muted}
              size={16}
              fallback={<Text style={styles.chevronFallback}>›</Text>}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/status?arrival=true')}
            style={({ pressed }) => [styles.shortcutCard, pressed && styles.pressed]}
          >
            <View style={styles.shortcutIcon}>
              <SymbolView
                name="airplane.arrival"
                tintColor={palette.orangeLight}
                size={21}
                fallback={<Text style={styles.iconFallback}>↓</Text>}
              />
            </View>
            <View style={styles.shortcutCopy}>
              <Text style={styles.shortcutTitle}>Transit arrival</Text>
              <Text style={styles.shortcutDescription} numberOfLines={1}>ဝင်လာသော transit parcel ကို လက်ခံရန်</Text>
            </View>
            <SymbolView
              name="chevron.right"
              tintColor={palette.muted}
              size={16}
              fallback={<Text style={styles.chevronFallback}>›</Text>}
            />
          </Pressable>
        </View>

        <Pressable
          accessibilityLabel="App အကြောင်း"
          accessibilityRole="button"
          onPress={() => router.push('/modal')}
          style={({ pressed }) => [styles.helpLink, pressed && styles.pressed]}
        >
          <SymbolView
            name="questionmark.circle"
            tintColor={palette.muted}
            size={16}
            fallback={<Text style={styles.helpFallback}>?</Text>}
          />
          <Text style={styles.helpText}>App အကြောင်း</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 120,
  },
  pageHeading: { marginBottom: 22 },
  eyebrow: { color: palette.orangeLight, fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: palette.white, fontSize: 20, lineHeight: 55, fontWeight: '900', marginTop: 6 },
  subtitle: { color: palette.muted, fontSize: 13, lineHeight: 25, marginTop: 3 },
  shortcutList: { gap: 10, marginHorizontal: 10 },
  shortcutCard: {
    minHeight: 82,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  primaryCard: {
    borderColor: '#55351f',
    backgroundColor: '#19130f',
  },
  shortcutIcon: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#3a2618',
    backgroundColor: '#25180f',
  },
  iconFallback: { color: palette.orangeLight, fontSize: 21, fontWeight: '800' },
  shortcutCopy: { flex: 1, minWidth: 0, gap: 3 },
  shortcutTitle: { color: palette.white, fontSize: 14, lineHeight: 27, fontWeight: '800', flexShrink: 1 },
  shortcutDescription: { color: palette.muted, fontSize: 11, lineHeight: 22 },
  arrowIcon: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#2b1b10',
  },
  arrowFallback: { color: palette.orangeLight, fontSize: 22, fontWeight: '700' },
  chevronFallback: { color: palette.muted, fontSize: 24, lineHeight: 26 },
  helpLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 20,
  },
  helpFallback: { color: palette.muted, fontSize: 16 },
  helpText: { color: palette.muted, fontSize: 12, lineHeight: 23, fontWeight: '600' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
