import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import {
  removeAlarmNavInfo,
  removeOrParkAlarmNavInfo,
  addActiveId,
  removeActiveId,
  startGpsPolling,
  ALARM_NAV_INFO_KEY,
} from '@/src/tasks/backgroundLocationTask';
import { exitNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';
import { getReadyAnchor, exitReadyGeofenceMode } from '@/src/tasks/readyGeofenceTask';
import { enterDepartingGeofenceMode } from '@/src/tasks/departingGeofenceTask';
import { cancelStagedAlarms } from '@/src/utils/notifications';
import { dlog } from '@/src/utils/deviceLogger';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BACKGROUND_ALARM_TASK = 'BACKGROUND-ALARM-TASK';

// 모듈 로드 시 태스크 정의 (registerTaskAsync 전에 반드시 실행돼야 함)
TaskManager.defineTask(BACKGROUND_ALARM_TASK, async ({ data, error }) => {
  console.log('[BACKGROUND_ALARM_TASK] fired');
  if (error) {
    console.log('[BACKGROUND_ALARM_TASK] error:', JSON.stringify(error));
    return;
  }

  // 포그라운드면 _layout.tsx의 fcmSub가 처리하므로 백그라운드 태스크는 빠짐
  // (포그라운드 alarmService와 백그라운드 30초 폴링 중복 방지)
  if (AppState.currentState === 'active') {
    console.log('[BACKGROUND_ALARM_TASK] 포그라운드 상태 — fcmSub가 처리하므로 skip');
    return;
  }

  console.log('[BACKGROUND_ALARM_TASK] data:', JSON.stringify(data));
  const fcmData = (data as any)?.data as Record<string, unknown>;
  if (!fcmData) return;

  // 방장이 약속 삭제/참가자 추방 시 → OS에 이미 예약된 단계별 알람을 즉시 취소
  // (포그라운드였다면 _layout.tsx의 fcmSub가 같은 이벤트를 처리하므로, 위 active 체크로 여기까진 안 옴)
  if (
    fcmData.appointment_id != null &&
    (fcmData.sync_event === 'appointment_deleted' || fcmData.sync_event === 'removed_from_appointment')
  ) {
    const appointmentId = Number(fcmData.appointment_id);
    console.log(`[BACKGROUND_ALARM_TASK] ${fcmData.sync_event} — appointmentId:${appointmentId} 단계별 알람 취소`);
    await cancelStagedAlarms(`a_${appointmentId}`).catch(() => {});
    await removeAlarmNavInfo(`a_${appointmentId}`).catch(() => {});
    await removeActiveId(undefined, appointmentId).catch(() => {});
    return;
  }

  // NEARDEST 자동 ARRIVED (서버 스케줄러가 targetTime 초과로 강제 전환) → 클라이언트 정리
  // NEARDEST는 지오펜싱 기반이라 폴링도 지오펜스 이벤트도 없어서, 이 FCM이 없으면 앱이
  // 이 여정이 끝난 걸 영영 모름(포그라운드는 _layout.tsx의 fcmSub가 alarmService.stop()으로
  // 처리하지만, 완전 종료 상태에선 AlarmRunner 인스턴스 자체가 없어 여기서 직접 정리해야 함)
  if (fcmData.sync_event === 'auto_arrived' && (fcmData.journey_ids != null || fcmData.appointment_ids != null)) {
    const arrivedJourneyIds: number[] = fcmData.journey_ids
      ? String(fcmData.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
      : [];
    const arrivedAppointmentIds: number[] = fcmData.appointment_ids
      ? String(fcmData.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
      : [];
    console.log(`[BACKGROUND_ALARM_TASK] auto_arrived — journeyIds:${arrivedJourneyIds} appointmentIds:${arrivedAppointmentIds}`);

    // 이 태스크는 AppState가 'active'가 아닐 때만 실행되지만(파일 상단 가드), 프로세스 자체는
    // 살아있을 수 있다(스와이프만 한 흔한 케이스) — 그러면 AlarmManager.runners에 좀비 러너가
    // 남아, 다음 회차 진입 시 isRunning()이 잘못 true를 반환해서 새 러너 시작이 스킵될 수 있다
    // (notifications.ts의 백그라운드 도착확인 경로는 forgetIfExists()로 이미 방어 중이었는데
    // 이 핸들러는 빠져 있었음 — 2026-08-18 코드 리뷰 중 발견). 진짜 헤드리스면 동적 import 실패
    // 또는 러너 자체가 없어 조용히 no-op.
    try {
      const { alarmService } = await import('@/src/services/alarmService');
      [...arrivedJourneyIds.map((id) => ({ id, isAppointment: false })), ...arrivedAppointmentIds.map((id) => ({ id, isAppointment: true }))]
        .forEach(({ id, isAppointment }) => alarmService.forgetIfExists(isAppointment ? undefined : id, isAppointment ? id : undefined));
    } catch (e: any) {
      console.log(`[BACKGROUND_ALARM_TASK] forgetIfExists 동적 import 실패(헤드리스로 추정, 무해): ${e?.message}`);
    }

    await Promise.all([
      ...arrivedJourneyIds.map(async (id) => {
        const key = `j_${id}`;
        await cancelStagedAlarms(key).catch(() => {});
        // 반복 여정이면 nav info를 지우지 않고 다음 회차까지 파킹한다(버그45) — 서버가 강제로
        // ARRIVED 전환시킨 것도 "이번 회차만 끝남"이지 "완전히 끝남"이 아니므로 삭제와 다르다.
        const parked = await removeOrParkAlarmNavInfo(key).catch(() => false);
        console.log(`[BACKGROUND_ALARM_TASK] auto_arrived journeyId:${id} ${parked ? '반복 여정 — nav info 파킹(버그45)' : 'nav info 제거'}`);
        await exitNearDestGeofenceMode(key).catch(() => {});
        await removeActiveId(id, undefined).catch(() => {});
      }),
      ...arrivedAppointmentIds.map(async (id) => {
        const key = `a_${id}`;
        await cancelStagedAlarms(key).catch(() => {});
        await removeAlarmNavInfo(key).catch(() => {});
        await exitNearDestGeofenceMode(key).catch(() => {});
        await removeActiveId(undefined, id).catch(() => {});
      }),
    ]);
    return;
  }

  // READY→DEPARTING 시간 트리거(서버 DepartingTransitionScheduler, P>=Q — 위치와 무관한 순수
  // 시간 조건이라 지오펜스로 못 잡음) → READY 지오펜스를 내리고 DEPARTING 지오펜스로 전환.
  // 서버가 좌표를 새로 안 보내줘도 됨 — READY 진입 시 이 클라이언트가 직접 찍었던 앵커를
  // readyGeofenceTask.ts의 저장소에서 그대로 읽어간다(geofencing-migration-plan.md
  // "READY→DEPARTING 시간 트리거" 참고).
  if (fcmData.sync_event === 'departing_transition' && (fcmData.journey_ids != null || fcmData.appointment_ids != null)) {
    const departingJourneyIds: number[] = fcmData.journey_ids
      ? String(fcmData.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
      : [];
    const departingAppointmentIds: number[] = fcmData.appointment_ids
      ? String(fcmData.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
      : [];
    console.log(`[BACKGROUND_ALARM_TASK] departing_transition — journeyIds:${departingJourneyIds} appointmentIds:${departingAppointmentIds}`);

    const handOffToDeparting = async (key: string, journeyId?: number, appointmentId?: number) => {
      const anchor = await getReadyAnchor(key);
      if (!anchor) {
        // READY 지오펜스가 등록 안 돼 있던 경우(iOS, 또는 등록 실패 등) — 기존 폴링 경로로
        // 폴백하면 backgroundLocationTask.ts의 기존 READY/DEPARTING 처리가 이어받는다.
        dlog('READY', `key:${key} 캐시된 앵커 없음 — 폴링으로 폴백`);
        await addActiveId(journeyId, appointmentId);
        await startGpsPolling().catch(() => {});
        return;
      }
      const navRaw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY);
      const nav = navRaw ? JSON.parse(navRaw)[key] : undefined;
      dlog('READY', `key:${key} departing_transition — 캐시된 앵커(${anchor.latitude.toFixed(6)}, ${anchor.longitude.toFixed(6)})로 DEPARTING 지오펜스 전환`);
      await exitReadyGeofenceMode(key).catch(() => {});
      await enterDepartingGeofenceMode(key, anchor.latitude, anchor.longitude, nav?.destLat, nav?.destLng);
    };

    await Promise.all([
      ...departingJourneyIds.map((id) => handOffToDeparting(`j_${id}`, id, undefined)),
      ...departingAppointmentIds.map((id) => handOffToDeparting(`a_${id}`, undefined, id)),
    ]);
    return;
  }

  // sync_event가 없는 경우도 READY로 간주 — 서버가 sync_event:'ready_transition' 태깅 전에
  // 배포된 구버전과의 하위호환용. sync_event가 다른 값이면(예: 미처리 이벤트) 여기로 안 떨어짐.
  const isReadyTransition = !fcmData?.sync_event || fcmData?.sync_event === 'ready_transition';
  if (!isReadyTransition) return;

  const journeyIds: number[] = fcmData?.journey_ids
    ? String(fcmData.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
    : [];
  const appointmentIds: number[] = fcmData?.appointment_ids
    ? String(fcmData.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
    : [];

  if (journeyIds.length === 0 && appointmentIds.length === 0) return;

  // 기존 active IDs와 병합 — addActiveId가 이미 "있으면 skip" 처리하므로 그냥 각각 호출하면 됨
  await Promise.all([
    ...journeyIds.map((id) => addActiveId(id, undefined)),
    ...appointmentIds.map((id) => addActiveId(undefined, id)),
  ]);

  // 백그라운드 위치 추적 시작 → backgroundLocationTask가 GPS 폴링하며 상태 감지.
  // FCM으로 깨어난 시점엔 FGS를 새로 못 켠다(Android 정책상 백그라운드에서 FGS 시작 불가 —
  // 고우선순위 FCM 예외로 우회 가능한지 2026-08-12 실기기로 검증했으나 실패 확정,
  // docs/planning/geofencing-migration-plan.md "FGS 생명주기 정책" 참고). 2026-08-13:
  // FGS와 GPS 폴링을 완전히 분리(modules/foreground-service)한 이후로는 startGpsPolling()이
  // 애초에 항상 FGS 없이만 GPS 구독을 시작하므로, 여기서 "FGS 없이 시작"이라고 따로 신경 쓸
  // 필요가 없어졌다. FGS는 이후 포그라운드 진입 시 startAlarmForegroundService()가 독립적으로
  // 담당하고, 이 GPS 구독은 "승격" 없이 그대로 계속 쓰인다(예전엔 이 구독을 stop→FGS 포함
  // 재시작하는 위험한 승격 로직이 있었으나 완전히 제거됨).
  await startGpsPolling();
});
