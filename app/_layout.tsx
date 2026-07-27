import { requestNotificationPermission, setupNotificationCategories, AlarmType } from '@/src/utils/notifications';
import { createJourneysApi } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { createAlarmsApi } from '@/src/api/alarms';
import { alarmService } from '@/src/services/alarmService';
import * as Notifications from 'expo-notifications';
import { BACKGROUND_ALARM_TASK } from '@/src/tasks/backgroundAlarmTask';
import { ACTIVE_JOURNEYS_KEY, ACTIVE_APPOINTMENTS_KEY, DESIRED_INTERVALS_KEY, SESSION_READY_KEY, startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '@/src/tasks/backgroundLocationTask';
import { getToken, useAuthStore, TOKEN_KEY } from '@/src/store/authStore';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import { useCalendarStore } from '@/src/store/calendarStore';
import { createMembersApi } from '@/src/api/members';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
    let cleanup = () => {};

    const init = async () => {
      // 앱 시작 시 이전 세션 유령 ID 초기화 (await 필수 — 완료 전 startReadyAlarms 실행 방지)
      // SESSION_READY_KEY를 먼저 '0'으로 초기화 → backgroundLocationTask가 init() 완료 전 발화해도 skip
      await AsyncStorage.setItem(SESSION_READY_KEY, '0');
      await stopBackgroundLocationUpdates().catch(() => {});
      await AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify([]));
      await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify([]));
      await AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify({}));

      requestNotificationPermission();
      setupNotificationCategories();

      // registerTaskAsync는 앱 초기화 완료 후 호출해야 함 (너무 이르면 NullPointerException)
      // 재시도 로직: 실패하면 3초 후 재시도
      const registerBackgroundTask = (retryCount = 0) => {
        Notifications.registerTaskAsync(BACKGROUND_ALARM_TASK)
          .then(() => console.log('[BACKGROUND_ALARM_TASK] 등록 성공'))
          .catch((e) => {
            console.log(`[BACKGROUND_ALARM_TASK] 등록 실패 (시도 ${retryCount + 1}):`, e);
            if (retryCount < 5) {
              setTimeout(() => registerBackgroundTask(retryCount + 1), 3000);
            }
          });
      };
      setTimeout(() => registerBackgroundTask(), 2000);
      Location.requestBackgroundPermissionsAsync().catch(() => {});

      const journeysApi = createJourneysApi();
      const appointmentsApi = createAppointmentsApi();
      const alarmsApi = createAlarmsApi();

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      let lastStartReadyAlarmsAt = 0;
      const doStartReadyAlarms = () => {
        alarmsApi.getAlarms(todayStr).then((res) => {
          const readyItems = (res.data ?? []).filter((a) => ['READY', 'DEPARTING', 'MOVING', 'NEARDEST'].includes(a.my_status) && a.is_active);
          console.log(`[startReadyAlarms] getAlarms 응답 — 전체:${res.data?.length ?? 0} 추적대상:${readyItems.length}`);
          readyItems.forEach((a) => {
            if (a.alarm_type === 'GROUP' && a.appointment_id != null) {
              if (alarmService.isRunning(undefined, a.appointment_id)) return;
              alarmService.start({ alarmType: 'group', destination: a.dest_name, appointmentId: a.appointment_id, isActive: a.is_active });
            } else if (a.alarm_type === 'HOME' && a.journey_id != null) {
              if (alarmService.isRunning(a.journey_id)) return;
              alarmService.start({ alarmType: 'home', destination: a.dest_name, journeyId: a.journey_id });
            } else if (a.alarm_type === 'PERSONAL' && a.journey_id != null) {
              if (alarmService.isRunning(a.journey_id)) return;
              alarmService.start({ alarmType: 'personal', destination: a.dest_name, journeyId: a.journey_id });
            }
          });
        }).catch((e) => { console.log('[startReadyAlarms] getAlarms 실패:', e?.message ?? e); });
      };
      const startReadyAlarms = () => {
        if (!getToken()) {
          console.log('[startReadyAlarms] 토큰 없음 — skip');
          return;
        }
        const now = Date.now();
        if (now - lastStartReadyAlarmsAt < 10000) {
          console.log('[startReadyAlarms] 10초 내 중복 — skip');
          return;
        }
        lastStartReadyAlarmsAt = now;
        doStartReadyAlarms();
      };

      // init() 완료 — backgroundLocationTask가 이 시점부터 정상 동작 가능
      await AsyncStorage.setItem(SESSION_READY_KEY, '1');

      // AsyncStorage에서 토큰 복원 → 자동 로그인
      const savedToken = await AsyncStorage.getItem(TOKEN_KEY);
      if (savedToken) {
        useAuthStore.getState().setToken(savedToken);
        try {
          const profileRes = await createMembersApi().getMyProfile();
          if (profileRes.data?.nickname) useAuthStore.getState().setNickname(profileRes.data.nickname);
        } catch (e) {
          console.log('[_layout] 닉네임 조회 실패:', e);
        }
        try {
          const tokenData = await Notifications.getDevicePushTokenAsync();
          await createMembersApi().registerFcmToken(tokenData.data);
        } catch (e) {
          console.log('[_layout] FCM 토큰 등록 실패:', e);
        }
      }

      // AppState 감지 → active/background 3초 디바운스로 중복 발화 방지
      let lastForegroundAt = 0;
      let lastBackgroundAt = 0;
      const appStateSub = AppState.addEventListener('change', async (nextState) => {
        console.log('[AppState] 상태 변경:', nextState);
        if (nextState === 'active') {
          console.log('[AppState] active → stopBackgroundLocationUpdates 호출');
          await stopBackgroundLocationUpdates().catch(() => {});
          const now = Date.now();
          if (now - lastForegroundAt < 3000) {
            console.log('[AppState] active 3초 내 중복 — skip');
            if (alarmService.hasRunning()) {
              await startBackgroundLocationUpdates().catch(() => {});
            }
            return;
          }
          lastForegroundAt = now;
          console.log('[AppState] active → startReadyAlarms 호출');
          startReadyAlarms();
          if (alarmService.hasRunning()) {
            await startBackgroundLocationUpdates().catch(() => {});
          }
        } else if (nextState === 'background') {
          const nowBg = Date.now();
          if (nowBg - lastBackgroundAt < 3000) {
            return;
          }
          lastBackgroundAt = nowBg;
          console.log('[AppState] background 진입 — AsyncStorage에 활성 알람 ID 등록');
          // 백그라운드 전환 시 현재 실행 중인 알람 ID를 AsyncStorage에 등록
          // → backgroundLocationTask가 발화 시 이 ID로 /location 호출
          const { journeyIds, appointmentIds } = alarmService.getRunningIds();
          if (journeyIds.length > 0 || appointmentIds.length > 0) {
            await Promise.all([
              AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(journeyIds)),
              AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(appointmentIds)),
            ]);
            console.log(`[AppState] background — AsyncStorage 등록 완료 journeys:${journeyIds} appointments:${appointmentIds}`);
          }
        }
      });

    // FCM 서버 푸시 수신 → 해당하는 알람 모두 동시 시작
    const fcmSub = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      const title = notification.request.content.title;
      const body = notification.request.content.body;
      console.log('[FCM] 수신 — data keys:', Object.keys(data ?? {}), 'title:', title ?? '(없음)');

      // 방장 알람 수정 시 참가자 상태 동기화 FCM
      if (data?.appointment_id && data?.participant_status) {
        const appointmentId = Number(data.appointment_id);
        const participantStatus = String(data.participant_status);
        console.log(`[FCM] 방장 수정 동기화 — appointmentId:${appointmentId} participantStatus:${participantStatus}`);
        useAppointmentStatusStore.getState().bumpParticipants(appointmentId);
        useCalendarStore.getState().bumpAlarmVersion();
        try {
          if (participantStatus === 'READY') {
            if (alarmService.isRunning(undefined, appointmentId)) {
              console.log(`[FCM] 방장 수정 READY — appointmentId:${appointmentId} 이미 실행 중 skip`);
              return;
            }
            const res = await appointmentsApi.getAppointment(appointmentId);
            if (res.data) {
              await alarmService.start({ alarmType: 'group', destination: res.data.dest_name, appointmentId });
            }
          } else if (participantStatus === 'SCHEDULED') {
            console.log(`[FCM] 방장 수정 SCHEDULED — appointmentId:${appointmentId} 폴링 중단`);
            alarmService.stop(undefined, appointmentId);
          }
        } catch (e) {
          console.log(`[FCM] 방장 수정 동기화 실패 — appointmentId:${appointmentId}`, e);
        }
        return;
      }

      // 참가자 참여/탈퇴/추방/이동수단 변경 FCM → 열려있는 상세화면 refetch + 목록/캘린더 새로고침
      if (data?.appointment_id && data?.sync_event === 'participants_changed') {
        const appointmentId = Number(data.appointment_id);
        console.log(`[FCM] 참가자 목록 변경 — appointmentId:${appointmentId}`);
        useAppointmentStatusStore.getState().bumpParticipants(appointmentId);
        useCalendarStore.getState().bumpAlarmVersion();
        return;
      }

      // 약속 삭제 FCM → 열려있는 상세화면 강제 종료 + 목록/캘린더 새로고침
      if (data?.appointment_id && data?.sync_event === 'appointment_deleted') {
        const appointmentId = Number(data.appointment_id);
        console.log(`[FCM] 약속 삭제 — appointmentId:${appointmentId}`);
        useAppointmentStatusStore.getState().setDeletedAppointmentId(appointmentId);
        useCalendarStore.getState().bumpAlarmVersion();
        return;
      }

      // 참가자 추방 FCM (쫓겨난 당사자 전용) → 열려있는 상세화면 강제 종료 + 목록/캘린더 새로고침
      if (data?.appointment_id && data?.sync_event === 'removed_from_appointment') {
        const appointmentId = Number(data.appointment_id);
        console.log(`[FCM] 추방됨 — appointmentId:${appointmentId}`);
        useAppointmentStatusStore.getState().setRemovedAppointmentId(appointmentId);
        useCalendarStore.getState().bumpAlarmVersion();
        return;
      }

      // FCM Data 메시지 (새벽 4시 READY 전환) → GPS 폴링 시작
      if (data?.journey_ids || data?.appointment_ids) {
        const journeyIds: number[] = data?.journey_ids
          ? String(data.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
          : [];
        const appointmentIds: number[] = data?.appointment_ids
          ? String(data.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
          : [];
        console.log(`[FCM] READY 전환 트리거 — journeyIds:${journeyIds} appointmentIds:${appointmentIds}`);

        await Promise.all([
          ...journeyIds.map(async (id) => {
            if (alarmService.isRunning(id)) {
              console.log(`[FCM] journeyId:${id} 이미 실행 중 — skip`);
              return;
            }
            try {
              const res = await journeysApi.getJourney(id);
              if (!res.data) {
                console.log(`[FCM] journeyId:${id} 조회 실패`);
                return;
              }
              const type: AlarmType = res.data.journey_type === 'HOME' ? 'home' : 'personal';
              await alarmService.start({ alarmType: type, destination: res.data.dest_name, journeyId: id });
            } catch (e) {
              console.log(`[FCM] journeyId:${id} start 실패`, e);
            }
          }),
          ...appointmentIds.map(async (id) => {
            if (alarmService.isRunning(undefined, id)) {
              console.log(`[FCM] appointmentId:${id} 이미 실행 중 — skip`);
              return;
            }
            try {
              const res = await appointmentsApi.getAppointment(id);
              if (!res.data) {
                console.log(`[FCM] appointmentId:${id} 조회 실패`);
                return;
              }
              await alarmService.start({ alarmType: 'group', destination: res.data.dest_name, appointmentId: id });
            } catch (e) {
              console.log(`[FCM] appointmentId:${id} start 실패`, e);
            }
          }),
        ]);
        return;
      }

      // FCM Notification 메시지 (그룹 도착 알람 등) → 포그라운드에서 notifee로 직접 표시
      if (title && body) {
        console.log(`[FCM] Notification 포그라운드 표시 — title:${title}`);
        await notifee.displayNotification({
          title,
          body,
          android: {
            channelId: 'gonow-alarm-2',
            pressAction: { id: 'default' },
          },
        });
      }
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
          console.log(`[알람] 출발알람 X버튼 눌림 — journeyId:${journeyId} appointmentId:${appointmentId} → 남은 단계 취소`);
          notifee.cancelNotification(notifId);
          alarmService.cancelRemainingStages(journeyId, appointmentId);
        }

        if (actionId === 'arrival-yes' && notifId) {
          console.log(`[알람] 도착확인 YES버튼 눌림 — journeyId:${journeyId} appointmentId:${appointmentId} → /arrive 호출`);
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

      cleanup = () => {
        fcmSub.remove();
        notifSub();
        appStateSub.remove();
      };
    };

    init();
    return () => cleanup();
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