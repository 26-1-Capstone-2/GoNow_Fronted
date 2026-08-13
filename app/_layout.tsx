import { setupNotificationCategories, AlarmType, getChannelId, sendDebugNotification } from '@/src/utils/notifications';
import { openKakaoMapRoute, NAVIGATE_CACHE_MAX_AGE_MS, toTransportMode, type KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { createJourneysApi } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { createAlarmsApi } from '@/src/api/alarms';
import { alarmService } from '@/src/services/alarmService';
import * as Notifications from 'expo-notifications';
import { BACKGROUND_ALARM_TASK } from '@/src/tasks/backgroundAlarmTask';
import { DESIRED_INTERVALS_KEY, SESSION_READY_KEY } from '@/src/tasks/backgroundLocationTask';
import { reconcileNearDestGeofences } from '@/src/tasks/nearDestGeofenceTask';
import { getToken, useAuthStore, TOKEN_KEY } from '@/src/store/authStore';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import { useCalendarStore } from '@/src/store/calendarStore';
import { createMembersApi } from '@/src/api/members';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as Location from 'expo-location';
import * as Updates from 'expo-updates';
import { AppState, Platform, ToastAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import notifee, { EventType } from '@notifee/react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  initialRouteName: 'index' as const,
};

// FGS(백그라운드 위치추적)가 "모두 닫기" 스와이프에도 살아남게 설계돼 있어서, 알람이
// 하나라도 살아있으면 스와이프로는 안드로이드 프로세스 자체가 안 죽는다 — 그래서
// expo-updates의 "재시작 두 번 걸쳐 다운로드→적용" 자연스러운 흐름이 실제로는 거의 안 탄다.
// JS 레벨 재시작(reloadAsync)은 네이티브 서비스를 안 건드리므로, 앱을 한 번만 열어도
// 그 자리에서 최신 번들을 받아 즉시 적용한다.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

async function checkAndApplyUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const result = await withTimeout(Updates.checkForUpdateAsync(), 5000);
    if (!result.isAvailable) return;
    await sendDebugNotification('업데이트 발견', '새 번들 다운로드 중...');
    await withTimeout(Updates.fetchUpdateAsync(), 15000);
    await sendDebugNotification('업데이트 적용', '재시작합니다');
    await Updates.reloadAsync();
  } catch (e: any) {
    console.log('[expo-updates] 체크/적용 실패, 기존 번들로 계속:', e?.message ?? e);
  }
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    let cleanup = () => {};

    const init = async () => {
      // 이 아래 초기화보다 먼저 — 업데이트가 있으면 여기서 즉시 재시작되므로 나머지 초기화는
      // 새 번들에서 다시 실행된다(리로드 시 현재 함수 실행은 중단됨)
      await checkAndApplyUpdate();

      // 앱 시작 시 이전 세션 유령 ID 초기화 (await 필수 — 완료 전 startReadyAlarms 실행 방지)
      // SESSION_READY_KEY를 먼저 '0'으로 초기화 → backgroundLocationTask가 init() 완료 전 발화해도 skip
      await AsyncStorage.setItem(SESSION_READY_KEY, '0');
      // (예전엔 여기서 무조건 stopBackgroundLocationUpdates()를 호출했음 — "매번 진짜 콜드스타트"라는
      // 잘못된 가정이었음. 스와이프+재실행은 FGS가 이미 정상적으로 켜져 있는 상태에서 JS만 다시
      // 시작되는 경우가 많아서, 이 무조건 호출이 멀쩡히 켜져있던 FGS를 껐다가 아래에서 다시 켜는
      // 불필요한 깜빡임을 만들었다. 이제는 아래 "이미 active 상태" 체크와 AppState 리스너가
      // syncForegroundService()로 실제 필요 여부에 맞게만 토글하므로, 여기서 미리 끌 필요가 없다.
      //
      // 같은 이유로 ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY도 여기서 더 이상 비우지 않는다.
      // 지금은 alarmService.start()/종료 시점마다 addActiveId/removeActiveId가 항상 최신으로
      // 맞춰주고 있어서(백그라운드 틱과 동일한 잠금 큐를 탐), 여기서 미리 비웠다가 알람이 다시
      // 등록되기 전 그 짧은 틈에 헤드리스 배경 태스크가 하필 발화하면 "추적할 게 없다"고 오판할
      // 여지가 있었다. 로그아웃(ProfileSettingsScreen.tsx)이 이미 명시적으로 비워주고, 방치된
      // 유령 ID가 남아있어도 다음 폴링에서 서버가 404를 주면 자동으로 정리되므로 안전하다.
      // DESIRED_INTERVALS_KEY는 "얼마나 자주 부를지"만 다루는 값이라 오래된 값이 한 주기 정도
      // 남아있어도 상관없어 그대로 초기화한다.
      await AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify({}));

      // 알림 권한 요청은 더 이상 여기서 자동으로 안 함 — PermissionSetupScreen(회원가입 직후/설정 화면)에서
      // 맥락 설명과 함께 요청하도록 이동함
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
          // 서버 기준 최신 활성 목록과 등록된 NEARDEST 지오펜스를 대조해 orphan 정리(저비용 안전망)
          const activeKeys = readyItems.map((a) =>
            a.alarm_type === 'GROUP' ? `a_${a.appointment_id}` : `j_${a.journey_id}`
          );
          reconcileNearDestGeofences(activeKeys).catch(() => {});
          readyItems.forEach((a) => {
            if (a.alarm_type === 'GROUP' && a.appointment_id != null) {
              if (alarmService.isRunning(undefined, a.appointment_id)) return;
              alarmService.start({ alarmType: 'group', destination: a.dest_name, appointmentId: a.appointment_id, isActive: a.is_active, destLat: a.dest_lat, destLng: a.dest_lng, transportMode: toTransportMode(a.transport_type === 'DRIVING') });
            } else if (a.alarm_type === 'HOME' && a.journey_id != null) {
              if (alarmService.isRunning(a.journey_id)) return;
              alarmService.start({ alarmType: 'home', destination: a.dest_name, journeyId: a.journey_id, destLat: a.dest_lat, destLng: a.dest_lng, transportMode: toTransportMode(a.transport_type === 'DRIVING'), isLastMode: a.is_last_mode });
            } else if (a.alarm_type === 'PERSONAL' && a.journey_id != null) {
              if (alarmService.isRunning(a.journey_id)) return;
              alarmService.start({ alarmType: 'personal', destination: a.dest_name, journeyId: a.journey_id, destLat: a.dest_lat, destLng: a.dest_lng, transportMode: toTransportMode(a.transport_type === 'DRIVING') });
            }
          });
          // alarmService.start()는 runner를 map에 동기적으로 등록하므로(내부 await 이전), 위 forEach
          // 직후 시점에 이미 새로 복원된 알람들이 반영돼있음 — 여기서 FGS 필요 여부 재점검
          alarmService.syncForegroundService().catch(() => {});
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
          const now = Date.now();
          if (now - lastForegroundAt < 3000) {
            console.log('[AppState] active 3초 내 중복 — skip');
            return;
          }
          lastForegroundAt = now;
          console.log('[AppState] active → startReadyAlarms 호출');
          startReadyAlarms();
          // 기존 runner들의 현재 상태 기준으로 FGS 필요 여부 재점검(실제로 바뀔 때만 토글됨).
          // startReadyAlarms()가 새로 복원하는 알람은 doStartReadyAlarms() 안에서 별도로 재점검함.
          await alarmService.syncForegroundService();
        } else if (nextState === 'background') {
          const nowBg = Date.now();
          if (nowBg - lastBackgroundAt < 3000) {
            return;
          }
          lastBackgroundAt = nowBg;
          // ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY는 이제 alarmService.start()/종료 시점에
          // 곧바로 기록되므로(backgroundLocationTask.ts의 addActiveId/removeActiveId), 여기서
          // 백그라운드 전환 시점에 다시 쓸 필요가 없다 — 예전엔 이 쓰기가 끝나기 전에 배경
          // 위치추적 태스크가 먼저 발화해 빈 목록으로 잘못 읽고 FGS를 꺼버리는 경쟁 조건이 있었음.
        }
      });

      // 위 리스너가 감지하는 건 "앞으로 일어날" active 전환뿐이다. 네이티브 Activity는 앱이
      // 열리는 즉시 active 상태가 되는데, 여기 도달하기까지 checkAndApplyUpdate/토큰 복원 등
      // 여러 비동기 단계를 거치는 동안 그 전환이 이미 끝나있을 수 있다 — 그러면 리스너는 영원히
      // 안 불려서 알람 복원이 누락된다(실기기에서 스와이프 종료 후 재실행 시 실제로 재현됨).
      // lastForegroundAt을 여기서도 갱신해야 하는 이유: 이 직접 호출 직후 "진짜" active
      // 이벤트가 뒤이어 들어올 수 있는데(놓치지 않고 정상적으로 감지되는 경우), 리스너의 3초
      // 디바운스가 이걸 모르면 syncForegroundService()가 두 번 겹쳐 호출된다 — 이 시점엔 아직
      // getAlarms 응답 전이라 runners가 비어있어서, 둘 다 "끌 필요 있음"으로 판단해
      // stopBackgroundLocationUpdates가 중복 호출되는 게 실기기에서 실제로 관측됨(기능상
      // 해는 없지만 불필요한 네이티브 서비스 토글). 여기서 갱신해두면 리스너 쪽이 자연히 skip한다.
      if (AppState.currentState === 'active') {
        console.log('[init] 이미 active 상태 — startReadyAlarms 직접 호출');
        lastForegroundAt = Date.now();
        startReadyAlarms();
        await alarmService.syncForegroundService();
      }

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
            const res = await appointmentsApi.getAppointment(appointmentId);
            if (res.data) {
              // 그룹 약속은 이동수단을 참가자별로 각자 고르므로, 응답 최상위가 아니라 내 참가자 레코드에서 찾아야 함
              const profileRes = await createMembersApi().getMyProfile();
              const myTransport = res.data.participants.find((p) => p.member_id === profileRes.data?.member_id)?.transport_type;
              await alarmService.start({ alarmType: 'group', destination: res.data.dest_name, appointmentId, destLat: res.data.dest_lat, destLng: res.data.dest_lng, transportMode: toTransportMode(myTransport === 'DRIVING') });
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

      // 약속 삭제 FCM → 열려있는 상세화면 강제 종료 + 목록/캘린더 새로고침 + 폴링/단계별 알람 정리
      if (data?.appointment_id && data?.sync_event === 'appointment_deleted') {
        const appointmentId = Number(data.appointment_id);
        console.log(`[FCM] 약속 삭제 — appointmentId:${appointmentId}`);
        alarmService.stop(undefined, appointmentId);
        useAppointmentStatusStore.getState().setDeletedAppointmentId(appointmentId);
        useCalendarStore.getState().bumpAlarmVersion();
        return;
      }

      // 참가자 추방 FCM (쫓겨난 당사자 전용) → 열려있는 상세화면 강제 종료 + 목록/캘린더 새로고침 + 폴링/단계별 알람 정리
      if (data?.appointment_id && data?.sync_event === 'removed_from_appointment') {
        const appointmentId = Number(data.appointment_id);
        console.log(`[FCM] 추방됨 — appointmentId:${appointmentId}`);
        alarmService.stop(undefined, appointmentId);
        useAppointmentStatusStore.getState().setRemovedAppointmentId(appointmentId);
        useCalendarStore.getState().bumpAlarmVersion();
        return;
      }

      // NEARDEST 자동 ARRIVED (서버 스케줄러가 targetTime 초과로 강제 전환) → 클라이언트 정리
      // NEARDEST는 지오펜싱 기반이라 폴링도 지오펜스 이벤트도 없어서, 이 FCM이 없으면 앱이
      // 이 여정이 끝난 걸 영영 모름 — alarmService.stop()이 지오펜스 해제까지 대신 처리함
      if (data?.sync_event === 'auto_arrived' && (data?.journey_ids || data?.appointment_ids)) {
        const journeyIds: number[] = data?.journey_ids
          ? String(data.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
          : [];
        const appointmentIds: number[] = data?.appointment_ids
          ? String(data.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
          : [];
        console.log(`[FCM] NEARDEST 자동 ARRIVED — journeyIds:${journeyIds} appointmentIds:${appointmentIds}`);
        journeyIds.forEach((id) => alarmService.stop(id));
        appointmentIds.forEach((id) => alarmService.stop(undefined, id));
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
              await alarmService.start({ alarmType: type, destination: res.data.dest_name, journeyId: id, destLat: res.data.dest_lat, destLng: res.data.dest_lng, transportMode: toTransportMode(res.data.transport_type === 'DRIVING'), isLastMode: res.data.is_last_mode });
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
              // 그룹 약속은 이동수단을 참가자별로 각자 고르므로, 응답 최상위가 아니라 내 참가자 레코드에서 찾아야 함
              const profileRes = await createMembersApi().getMyProfile();
              const myTransport = res.data.participants.find((p) => p.member_id === profileRes.data?.member_id)?.transport_type;
              await alarmService.start({ alarmType: 'group', destination: res.data.dest_name, appointmentId: id, destLat: res.data.dest_lat, destLng: res.data.dest_lng, transportMode: toTransportMode(myTransport === 'DRIVING') });
            } catch (e) {
              console.log(`[FCM] appointmentId:${id} start 실패`, e);
            }
          }),
        ]);
        return;
      }

      // FCM Notification 메시지 (그룹 도착 알람 등) → 포그라운드에서 notifee로 직접 표시
      // channel_id는 스프링이 data에 함께 실어 보냄(백그라운드용 AndroidConfig의 channelId와 동일 값) —
      // 포그라운드에서 어느 채널로 재표시할지 이 값으로 판단. 없으면 도착예정 채널로 폴백.
      if (title && body) {
        const channelId = typeof data?.channel_id === 'string' ? data.channel_id : await getChannelId('arrival-expected');
        console.log(`[FCM] Notification 포그라운드 표시 — title:${title} channelId:${channelId}`);
        await notifee.displayNotification({
          title,
          body,
          android: {
            channelId,
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
          if (Platform.OS === 'android') {
            ToastAndroid.show('남은 출발 알림을 껐어요.', ToastAndroid.SHORT);
          }
        }

        if (actionId === 'arrival-yes' && notifId) {
          console.log(`[알람] 도착확인 YES버튼 눌림 — journeyId:${journeyId} appointmentId:${appointmentId} → /arrive 호출`);
          notifee.cancelNotification(notifId);
          if (journeyId != null) journeysApi.arrive(journeyId);
          if (appointmentId != null) appointmentsApi.arriveParticipant(appointmentId);
          // alarmService.stop()이 지오펜스 해제까지 내부에서 처리(아직 EXIT 전에 확인해도 안전)
          alarmService.stop(journeyId, appointmentId);
        }

        if (actionId === 'arrival-no' && notifId) {
          notifee.cancelNotification(notifId);
        }

        if (actionId === 'navigate' && data?.destLat && data?.destLng && data?.transportMode) {
          // 단계별 출발 알람(1~4단계)은 전부 DEPARTING 구간에서만 발생 — 캐시 유효기간도 그에 맞춤
          openKakaoMapRoute(
            { lat: Number(data.destLat), lng: Number(data.destLng) },
            data.transportMode as KakaoMapTransportMode,
            NAVIGATE_CACHE_MAX_AGE_MS.DEPARTING,
          );
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
          <Stack.Screen name="permission-setup" />
          <Stack.Screen name="alarm-test" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}