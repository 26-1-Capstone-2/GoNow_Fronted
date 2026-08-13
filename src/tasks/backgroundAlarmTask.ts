import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import {
  BACKGROUND_LOCATION_TASK,
  removeAlarmNavInfo,
  addActiveId,
  removeActiveId,
} from '@/src/tasks/backgroundLocationTask';
import { exitNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';
import { cancelStagedAlarms } from '@/src/utils/notifications';

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

    await Promise.all([
      ...arrivedJourneyIds.map(async (id) => {
        const key = `j_${id}`;
        await cancelStagedAlarms(key).catch(() => {});
        await removeAlarmNavInfo(key).catch(() => {});
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

  // 백그라운드 위치 추적 시작 → backgroundLocationTask가 GPS 폴링하며 상태 감지
  // FCM으로 깨어난 백그라운드에서는 foregroundService 없이 시작 (Android 정책상 불가 —
  // 고우선순위 FCM 예외로 우회 가능한지 2026-08-12 실기기로 검증했으나 실패 확정,
  // docs/planning/geofencing-migration-plan.md "FGS 생명주기 정책" 참고)
  // 포그라운드 진입 시 startBackgroundLocationUpdates()가 foregroundService 포함으로 재시작됨
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 30000,
      distanceInterval: 0,
    }).then(() => {
      console.log('[BACKGROUND_ALARM_TASK] 위치추적 시작 완료 (foregroundService 없음 — Android 정책상 백그라운드에서 불가)');
    }).catch((e) => {
      console.log('[BACKGROUND_ALARM_TASK] 위치추적 시작 실패:', e?.message);
    });
  } else {
    console.log('[BACKGROUND_ALARM_TASK] 위치추적 이미 실행 중');
  }
});
