import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { SymbolView } from '@/components/AppSymbol';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';

const palette = {
  background: '#090909',
  surface: '#141414',
  border: '#292929',
  orange: '#ff7417',
  orangeLight: '#ff9b47',
  white: '#f7f4f1',
  muted: '#aaa39c',
  red: '#ff8273',
};

function metadataString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export default function ProfileScreen() {
  const { user, role, branch, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateError, setUpdateError] = useState('');

  const displayName =
    metadataString(user?.user_metadata?.full_name) ??
    metadataString(user?.user_metadata?.username);
  const phone = metadataString(user?.phone);

  const handleCheckUpdate = async () => {
    setUpdateMessage('');
    setUpdateError('');
    setIsCheckingUpdate(true);
    try {
      if (__DEV__ || Platform.OS === 'web' || !Updates.isEnabled) {
        setUpdateMessage('OTA update ကို installed release app မှာသာ စစ်ဆေးနိုင်ပါတယ်။');
        return;
      }

      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        setUpdateMessage('နောက်ဆုံး version ကို အသုံးပြုနေပါတယ်။');
        return;
      }

      setUpdateMessage('Update ကို download လုပ်နေပါတယ်…');
      const result = await Updates.fetchUpdateAsync();
      if (!result.isNew) {
        setUpdateMessage('အသစ်ထွက် update မရှိပါ။');
        return;
      }

      setUpdateMessage('Update ပြီးပါပြီ။ App ကို ပြန်ဖွင့်နေပါတယ်…');
      await Updates.reloadAsync();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'အမှားတစ်ခု ဖြစ်ပွားခဲ့ပါတယ်။';
      setUpdateError(`Update စစ်ဆေးမရပါ။ ${detail}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleSignOut = async () => {
    setSignOutError('');
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'ထွက်ရန် မအောင်မြင်ပါ။');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>ACCOUNT</Text>
        <Text style={styles.title}>Profile</Text>
        

        <View style={styles.identityCard}>
          <View style={styles.avatar}>
            <SymbolView
              name="person.fill"
              tintColor={palette.orangeLight}
              size={30}
              fallback={<Text style={styles.avatarFallback}>●</Text>}
            />
          </View>
          <Text style={styles.name}>{displayName ?? 'ဝန်ထမ်းအကောင့်'}</Text>
          <Text style={styles.email}>{user?.email ?? 'အီးမေးလ် မရှိပါ'}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account Details</Text>
          <View style={styles.sectionRule} />
        </View>
        <View style={styles.detailsCard}>
          <InfoRow label="Email" value={user?.email ?? 'မရှိပါ'} />
          {phone ? <InfoRow label="ဖုန်းနံပါတ်" value={phone} /> : null}
          <InfoRow label="Role" value={role ?? 'ဝန်ထမ်း'} />
          <InfoRow
            label="Branch"
            value={`${branch} · ${branch === 'MDY' ? 'Mandalay' : 'Yangon'}`}
            last
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>App Update</Text>
          <View style={styles.sectionRule} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isCheckingUpdate }}
          disabled={isCheckingUpdate}
          onPress={() => void handleCheckUpdate()}
          style={({ pressed }) => [
            styles.updateButton,
            pressed && !isCheckingUpdate && styles.pressed,
            isCheckingUpdate && styles.disabled,
          ]}
        >
          {isCheckingUpdate ? (
            <ActivityIndicator color={palette.orangeLight} />
          ) : (
            <SymbolView
              name="arrow.down.circle"
              tintColor={palette.orangeLight}
              size={20}
              fallback={<Text style={styles.signOutFallback}>↓</Text>}
            />
          )}
          <Text style={styles.updateText}>
            {isCheckingUpdate ? 'Checking for updates…' : 'Check for updates'}
          </Text>
        </Pressable>
        {updateMessage ? <Text style={styles.updateMessage}>{updateMessage}</Text> : null}
        {updateError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {updateError}
          </Text>
        ) : null}

        <View style={styles.signOutSection}>
         
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSigningOut }}
            disabled={isSigningOut}
            onPress={() => void handleSignOut()}
            style={({ pressed }) => [
              styles.signOutButton,
              pressed && !isSigningOut && styles.pressed,
              isSigningOut && styles.disabled,
            ]}
          >
            {isSigningOut ? (
              <ActivityIndicator color={palette.orangeLight} />
            ) : (
              <SymbolView
                name="rectangle.portrait.and.arrow.right"
                tintColor={palette.red}
                size={20}
                fallback={<Text style={styles.signOutFallback}>↗</Text>}
              />
            )}
            <Text style={styles.signOutText}>
              {isSigningOut ? 'Logging out…' : 'Logout'}
            </Text>
          </Pressable>
          {signOutError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {signOutError}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last && styles.lastInfoRow]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 24, paddingBottom: 110 },
  eyebrow: { color: palette.orangeLight, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: palette.white, fontSize: 29, lineHeight: 55, fontWeight: '900', marginTop: 5 },
  description: { color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  identityCard: {
    alignItems: 'center',
    padding: 22,
    marginTop: 22,
    borderRadius: 21,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25180f',
    borderWidth: 1,
    borderColor: '#49301f',
    marginBottom: 13,
  },
  avatarFallback: { color: palette.orangeLight, fontSize: 24 },
  name: { color: palette.white, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  email: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 27, marginBottom: 12 },
  sectionTitle: { color: palette.white, fontSize: 15, fontWeight: '800' },
  sectionRule: { flex: 1, height: 1, backgroundColor: palette.border },
  detailsCard: {
    paddingHorizontal: 15,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  infoRow: {
    minHeight: 62,
    justifyContent: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  lastInfoRow: { borderBottomWidth: 0 },
  infoLabel: { color: palette.muted, fontSize: 11, fontWeight: '700' },
  infoValue: { color: palette.white, fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 4 },
  updateButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#49301f',
    backgroundColor: '#1c140e',
  },
  updateText: { color: palette.orangeLight, fontSize: 14, fontWeight: '800' },
  updateMessage: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  signOutSection: { marginTop: 27 },
  signOutButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#49301f',
    backgroundColor: '#1c140e',
  },
  signOutFallback: { color: palette.orangeLight, fontSize: 19, fontWeight: '800' },
  signOutText: { color: palette.red, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.65 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  error: { color: palette.red, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
