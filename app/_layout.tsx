import { requestNotificationPermission, setupNotificationCategories, AlarmType } from '@/src/utils/notifications';
import { createJourneysApi } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { createAlarmsApi } from '@/src/api/alarms';
import { alarmService } from '@/src/services/alarmService';
import * as Notifications from 'expo-notifications';
import { BACKGROUND_ALARM_TASK } from '@/src/tasks/backgroundAlarmTask';
import '@/src/tasks/backgroundLocationTask';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as Location from 'expo-location';
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
    Notifications.registerTaskAsync(BACKGROUND_ALARM_TASK).catch(() => {});
    Location.requestBackgroundPermissionsAsync().catch(() => {});

    const journeysApi = createJourneysApi();
    const appointmentsApi = createAppointmentsApi();
    const alarmsApi = createAlarmsApi();

    // 앱 시작 시 오늘 날짜 알람 조회 → READY 상태인 것들 GPS 폴링 재개
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    alarmsApi.getAlarms(todayStr).then((res) => {
      (res.data ?? []).filter((a) => a.my_status === 'READY').forEach((a) => {
        if (a.alarm_type === 'GROUP' && a.appointment_id != null) {
          alarmService.start({ alarmType: 'group', destination: a.dest_name, appointmentId: a.appointment_id });
        } else if (a.alarm_type === 'HOME' && a.journey_id != null) {
          alarmService.start({ alarmType: 'home', destination: a.dest_name, journeyId: a.journey_id });
        } else if (a.alarm_type === 'PERSONAL' && a.journey_id != null) {
          alarmService.start({ alarmType: 'personal', destination: a.dest_name, journeyId: a.journey_id });
        }
      });
    }).catch(() => {});

    // FCM 서버 푸시 수신 → 해당하는 알람 모두 동시 시작
    const fcmSub = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request.content.data as Record<string, unknown>;

      // 방장 알람 수정 시 참가자 상태 동기화 FCM
      if (data?.appointment_id && data?.participant_status) {
        const appointmentId = Number(data.appointment_id);
        const participantStatus = String(data.participant_status);
        try {
          if (participantStatus === 'READY') {
            const res = await appointmentsApi.getAppointment(appointmentId);
            if (res.data) {
              await alarmService.start({ alarmType: 'group', destination: res.data.dest_name, appointmentId });
            }
          } else if (participantStatus === 'SCHEDULED') {
            alarmService.stop(undefined, appointmentId);
          }
        } catch {}
        return;
      }

      const journeyIds: number[] = data?.journey_ids
        ? String(data.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
        : [];
      const appointmentIds: number[] = data?.appointment_ids
        ? String(data.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
        : [];

      await Promise.all([
        ...journeyIds.map(async (id) => {
          try {
            const res = await journeysApi.getJourney(id);
            if (!res.data) return;
            const type: AlarmType = res.data.journey_type === 'HOME' ? 'home' : 'personal';
            await alarmService.start({ alarmType: type, destination: res.data.dest_name, journeyId: id });
          } catch {}
        }),
        ...appointmentIds.map(async (id) => {
          try {
            const res = await appointmentsApi.getAppointment(id);
            if (!res.data) return;
            await alarmService.start({ alarmType: 'group', destination: res.data.dest_name, appointmentId: id });
          } catch {}
        }),
      ]);
    });

    // 포그라운드 알림 버튼 처리
    const notifSub = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.ACTION_PRESS) {
        const actionId = detail.pressAction?.id;
        const notifId = detail.notification?.id;
        const data = detail.notification?.data;

        const journeyId = data?.journeyId ? Number(data.journeyId) : undefined;
        const appointmentId = data?.appointmentId ? Number(data.appointmentId) : undefined;

        if (actionId === 'dismiss' && notifId) {
          notifee.cancelNotification(notifId);
          alarmService.cancelRemainingStages(journeyId, appointmentId);
        }

        if (actionId === 'arrival-yes' && notifId) {
          notifee.cancelNotification(notifId);
          if (journeyId != null) journeysApi.arrive(journeyId);
          if (appointmentId != null) appointmentsApi.arriveParticipant(appointmentId);
          alarmService.stop(journeyId, appointmentId);
        }

        if (actionId === 'arrival-no' && notifId) {
          notifee.cancelNotification(notifId);
        }
      }
    });

    return () => {
      fcmSub.remove();
      notifSub();
    };
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