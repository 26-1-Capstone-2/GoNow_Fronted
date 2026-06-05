import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import {
  BACKGROUND_LOCATION_TASK,
  ACTIVE_JOURNEYS_KEY,
  ACTIVE_APPOINTMENTS_KEY,
} from '@/src/tasks/backgroundLocationTask';

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
  // FCM으로 깨어난 백그라운드에서는 foregroundService 없이 시작 (Android 정책상 불가)
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
