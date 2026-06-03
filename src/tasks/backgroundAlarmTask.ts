import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BACKGROUND_LOCATION_TASK,
  ACTIVE_JOURNEYS_KEY,
  ACTIVE_APPOINTMENTS_KEY,
  startBackgroundLocationUpdates,
} from '@/src/tasks/backgroundLocationTask';

export const BACKGROUND_ALARM_TASK = 'BACKGROUND-ALARM-TASK';

// 모듈 로드 시 태스크 정의 (registerTaskAsync 전에 반드시 실행돼야 함)
TaskManager.defineTask(BACKGROUND_ALARM_TASK, async ({ data, error }) => {
  console.log('[BACKGROUND_ALARM_TASK] fired');
  if (error) {
    console.log('[BACKGROUND_ALARM_TASK] error:', JSON.stringify(error));
    return;
  }

  console.log('[BACKGROUND_ALARM_TASK] data:', JSON.stringify(data));
  const fcmData = (data as any) as Record<string, unknown>;
  if (!fcmData) return;

  const journeyIds: number[] = fcmData?.journey_ids
    ? String(fcmData.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
    : [];
  const appointmentIds: number[] = fcmData?.appointment_ids
    ? String(fcmData.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
    : [];

  if (journeyIds.length === 0 && appointmentIds.length === 0) return;

  // 기존 active IDs와 병합
  const [existingJourneys, existingAppointments] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY).then(r => r ? JSON.parse(r) : [] as number[]),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY).then(r => r ? JSON.parse(r) : [] as number[]),
  ]);

  const mergedJourneys = [...new Set([...existingJourneys, ...journeyIds])];
  const mergedAppointments = [...new Set([...existingAppointments, ...appointmentIds])];

  await Promise.all([
    AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(mergedJourneys)),
    AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(mergedAppointments)),
  ]);

  // 백그라운드 위치 추적 시작 → backgroundLocationTask가 GPS 폴링하며 상태 감지
  // 백그라운드 태스크 내에서 getBackgroundPermissionsAsync()가 false를 반환하는 경우가 있어 체크 생략
  await startBackgroundLocationUpdates().catch(() => {});
});
