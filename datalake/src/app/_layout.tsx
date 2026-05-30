import { Stack, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { databaseWrapper } from '@/modules/face-auth/database';

import { AnimatedSplashOverlay } from '../components/animated-icon';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // 1. Check for admin config on fresh install
    const config = databaseWrapper.getAdminConfig();
    if (!config) {
      console.log('[_layout] No admin config found. App will initialize it on LoginScreen.');
    }
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="home" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="enroll" />
        <Stack.Screen name="attendance" />
      </Stack>
    </ThemeProvider>
  );
}
