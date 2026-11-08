import { SymbolView } from '@/components/AppSymbol';
import { useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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

const colors = {
  background: '#090909',
  surface: '#141414',
  border: '#292929',
  orange: '#ff7417',
  orangeLight: '#ff9b47',
  text: '#f7f4f1',
  muted: '#938d87',
  red: '#ff6a57',
};

export default function LoginScreen() {
  const { signIn, isConfigured, configurationError, authError } = useAuth();
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Email နဲ့ password နှစ်ခုလုံး ဖြည့်ပါ။');
      return;
    }

    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (signInError) {
      const message = signInError instanceof Error ? signInError.message : '';
      setError(
        message.toLowerCase().includes('invalid login credentials')
          ? 'Email သို့မဟုတ် password မှားနေပါတယ်။ ပြန်စစ်ပြီး ထပ်ကြိုးစားပါ။'
          : message.toLowerCase().includes('login request timed out')
            ? 'Login request timed out. Please check your internet connection and try again.'
            : message || 'Login မဝင်နိုင်ပါ။ အင်တာနက်ချိတ်ဆက်မှုကို စစ်ဆေးပြီး ထပ်ကြိုးစားပါ။',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Image
                accessibilityLabel="All In One logo"
                resizeMode="contain"
                source={require('../../assets/images/logo.png')}
                style={styles.logo}
              />
            </View>
           
          </View>

          <View style={styles.hero}>
            
            <Text style={[styles.eyebrow, styles.centeredText]}>Please Login to Your Account</Text>
            <Text style={[styles.title, styles.centeredText]}>All IN ONE Express</Text>
            <Text style={[styles.titleAccent, styles.centeredText]}>Operation Manger</Text>
            
          </View>

          <View style={styles.formCard}>
            <Text style={[styles.fieldLabel, styles.leftedText]}>EMAIL</Text>
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={setEmail}
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder="name@example.com"
              placeholderTextColor="#716b66"
              returnKeyType="next"
              style={styles.input}
              textContentType="emailAddress"
              value={email}
            />

            <Text style={[styles.fieldLabel, styles.passwordLabel, styles.leftedText]}>PASSWORD</Text>
            <View style={styles.passwordRow}>
              <TextInput
                ref={passwordRef}
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoComplete="current-password"
                onChangeText={setPassword}
                onSubmitEditing={() => void handleSignIn()}
                placeholder="Password"
                placeholderTextColor="#716b66"
                returnKeyType="go"
                secureTextEntry={!showPassword}
                style={[styles.input, styles.passwordInput]}
                textContentType="password"
                value={password}
              />
              <Pressable
                accessibilityLabel={showPassword ? 'Password ဖျောက်ရန်' : 'Password ပြရန်'}
                accessibilityRole="button"
                onPress={() => setShowPassword((current) => !current)}
                style={styles.passwordToggle}
              >
                <SymbolView
                  name={{
                    ios: showPassword ? 'eye.slash' : 'eye',
                    android: showPassword ? 'visibility_off' : 'visibility',
                    web: showPassword ? 'visibility_off' : 'visibility',
                  }}
                  tintColor={colors.orangeLight}
                  size={18}
                />
              </Pressable>
            </View>

            {(error || authError) && (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Text style={[styles.errorText, styles.centeredText]}>{error || authError}</Text>
              </View>
            )}
            {!isConfigured && (
              <View style={styles.configBox}>
                <Text style={[styles.configTitle, styles.centeredText]}>Supabase ချိတ်ဆက်မှု လိုအပ်နေပါတယ်</Text>
                <Text style={[styles.configText, styles.centeredText]}>{configurationError}</Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={loading || !isConfigured}
              onPress={() => void handleSignIn()}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.pressed,
                (loading || !isConfigured) && styles.disabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#17100a" />
              ) : (
                <>
                  <Text style={styles.submitText}>Login</Text>
                  <Text style={styles.submitArrow}>→</Text>
                </>
              )}
            </Pressable>

            
          </View>

          <Text style={styles.footer}>ALL-IN-ONE . Customer Service & Operations</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  brand: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 11, marginBottom: 24 },
  brandMark: { width: 80, height: 80, borderRadius: 15, backgroundColor: '#faf9f8', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#17100a', fontSize: 24, fontWeight: '900', fontStyle: 'italic' },
  brandName: { color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  brandCaption: { color: colors.muted, fontSize: 8, fontWeight: '700', letterSpacing: 1.5, marginTop: 3 },
  centeredText: { textAlign: 'center' },
  leftedText: { textAlign: 'left' },
  hero: { alignItems: 'center', marginBottom: 24 },
  heroIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: '#24170e', borderWidth: 1, borderColor: '#3c291a', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  heroIconFallback: { color: colors.orange, fontSize: 25 },
  eyebrow: { color: colors.orangeLight, fontSize: 12, fontWeight: '500', letterSpacing: 1, marginBottom: 10 },
  title: { color: colors.text, fontSize: 27, fontWeight: '900', letterSpacing: -0.4 },
  titleAccent: { color: colors.orange, fontSize: 20, fontWeight: '900', marginTop: 2 },
  description: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 11, maxWidth: 320 },
  formCard: { width: '100%', maxWidth: 420, padding: 19, borderRadius: 23, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  fieldLabel: { color: '#a9a19b', fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginBottom: 9 },
  input: { height: 50, borderRadius: 14, backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#302d2a', color: colors.text, fontSize: 14, paddingHorizontal: 14, textAlign: 'left' },
  passwordLabel: { marginTop: 20 },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 74 },
  passwordToggle: { position: 'absolute', right: 3, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  errorBox: { marginTop: 15, padding: 12, borderRadius: 12, backgroundColor: '#2a1513', borderWidth: 1, borderColor: '#57302b' },
  errorText: { color: '#ff9b8f', fontSize: 11, lineHeight: 17 },
  configBox: { marginTop: 15, padding: 12, borderRadius: 12, backgroundColor: '#291c10', borderWidth: 1, borderColor: '#50371e' },
  configTitle: { color: colors.orangeLight, fontSize: 11, fontWeight: '800' },
  configText: { color: '#c8b9a8', fontSize: 10, lineHeight: 16, marginTop: 5 },
  submitButton: { minHeight: 52, borderRadius: 16, backgroundColor: colors.orange, marginTop: 20, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#17100a', fontSize: 13, fontWeight: '900' },
  submitArrow: { position: 'absolute', right: 17, color: '#17100a', fontSize: 21, fontWeight: '800' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
  secureNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: 16 },
  secureNoteText: { color: '#8f8175', fontSize: 9 },
  lockFallback: { color: '#8f8175', fontSize: 12 },
  footer: { color: '#514b46', fontSize: 8, fontWeight: '700', letterSpacing: 1.4, textAlign: 'center', marginTop: 27 },
  logo: {
    width: 80,
    height: 80,
  },
});
