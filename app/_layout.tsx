import { requestNotificationPermission, setupNotificationCategories } from '@/src/utils/notifications';
import { createJourneysApi } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { alarmService } from '@/src/services/alarmService';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import notifee, { EventType } from '@notifee/react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  initialRouteName: 'index' as const,
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    requestNotificationPermission();
    setupNotificationCategories();

    // 포그라운드에서 X 버튼 누를 때 알림 닫기
    const journeysApi = createJourneysApi();
    const appointmentsApi = createAppointmentsApi();

    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.ACTION_PRESS) {
        const actionId = detail.pressAction?.id;
        const notifId = detail.notification?.id;
        const data = detail.notification?.data;

        if (actionId === 'dismiss' && notifId) {
          notifee.cancelNotification(notifId);
          alarmService.cancelRemainingStages();
        }

        if (actionId === 'arrival-yes' && notifId) {
          notifee.cancelNotification(notifId);
          if (data?.journeyId) journeysApi.arrive(Number(data.journeyId));
          if (data?.appointmentId) appointmentsApi.arriveParticipant(Number(data.appointmentId));
          alarmService.stop();
        }

        if (actionId === 'arrival-no' && notifId) {
          notifee.cancelNotification(notifId);
        }
      }
    });
    return () => unsub();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="year-calendar" options={{ animation: 'fade' }} />
          <Stack.Screen name="home-address" />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', headerShown: true }} />
          <Stack.Screen name="profile-settings" />
          <Stack.Screen name="change-nickname" />
          <Stack.Screen name="change-password" />
          <Stack.Screen name="daily-alarm" />
          <Stack.Screen name="alarm-test" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}