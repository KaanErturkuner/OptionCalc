import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '@/ui/theme';
import { initNotifications } from '@/ui/notify';
import '@/ui/monitor'; // arka plan görevi tanımı (modül düzeyinde olmalı)

initNotifications();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />
    </SafeAreaProvider>
  );
}
