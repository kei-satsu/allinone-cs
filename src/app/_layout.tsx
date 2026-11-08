import { useFonts } from 'expo-font';
import { DarkTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/lib/auth-context';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  if (!loaded) {
    return null;
  }

  return (
    <AuthProvider>
      <RootLayoutNav fontsLoaded={loaded} />
    </AuthProvider>
  );
}

function RootLayoutNav({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isLoading, user } = useAuth();

  useEffect(() => {
    if (fontsLoaded && !isLoading) {
      void SplashScreen.hideAsync().catch((splashError: unknown) => {
        console.error('Unable to hide splash screen:', splashError);
      });
    }
  }, [fontsLoaded, isLoading]);

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#090909' },
          headerStyle: { backgroundColor: '#0d0d0d' },
          headerTintColor: '#f7f4f1',
          headerTitleStyle: { fontWeight: '700' },
        }}>
        <Stack.Protected guard={user !== null}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="intake" options={{ headerShown: false }} />
          <Stack.Screen name="stock-check" options={{ headerShown: false }} />
          <Stack.Screen name="status" options={{ headerShown: false }} />
          <Stack.Screen name="lookup" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={user === null}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
