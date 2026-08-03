import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { TOKEN_KEY } from '@/src/store/authStore';
import { sendAlarm, syncStagedAlarms, cancelStagedAlarms, AlarmType, CHANNEL_SILENT } from '@/src/utils/notifications';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND-LOCATION-TASK';
export const ACTIVE_JOURNEYS_KEY = 'gonow_active_journeys';
export const ACTIVE_APPOINTMENTS_KEY = 'gonow_active_appointments';
export const DESIRED_INTERVALS_KEY = 'gonow_desired_intervals'; // Record<key, seconds>
export const SESSION_READY_KEY = 'gonow_session_ready';         // init() 완료 후 '1' 세팅
const LAST_CALL_TIMES_KEY = 'gonow_last_call_times';           // Record<key, ms timestamp>

const BASE_URL = 'https://gonow-api.uk';

async function patchLocation(path: string, token: string, lat: number, lng: number) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let _startingLocationUpdates = false; // 동시 호출 race condition 방지

export async function startBackgroundLocationUpdates(): Promise<void> {
  // Foreground Service는 포그라운드 상태에서만 시작 가능 (Android 정책)
  // backgroundAlarmTask는 이 함수 대신 Location.startLocationUpdatesAsync() 직접 호출
  if (AppState.currentState !== 'active') {
    console.log('[startBackgroundLocationUpdates] 백그라운드 상태 — skip');
    return;
  }
  if (_startingLocationUpdates) {
    console.log('[startBackgroundLocationUpdates] 시작 중 — skip');
    return;
  }
  _startingLocationUpdates = true;
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isRunning) {
    _startingLocationUpdates = false;
    console.log('[startBackgroundLocationUpdates] 이미 실행 중 — skip');
    return;
  }
  console.log('[startBackgroundLocationUpdates] 시작');
  try {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 30000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: 'GoNow 알람 실행 중',
        notificationBody: '출발 시간을 모니터링하고 있어요.',
        notificationColor: '#4CAF50',
        notificationChannelId: CHANNEL_SILENT,
      },
    });
    console.log('[startBackgroundLocationUpdates] 완료 — 상단바 알림 표시됨');
  } finally {
    _startingLocationUpdates = false;
  }
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    console.log('[stopBackgroundLocationUpdates] 이미 중지됨 — skip');
    return;
  }
  console.log('[stopBackgroundLocationUpdates] 중지');
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
  console.log('[stopBackgroundLocationUpdates] 완료 — 상단바 알림 제거됨');
}

let _taskRunning = false;

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  console.log(`[BackgroundLocation] 태스크 발화 @ ${ts}`);
  if (error) {
    console.log('[BackgroundLocation] 에러:', JSON.stringify(error));
    return;
  }
  if (_taskRunning) {
    console.log('[BackgroundLocation] 이전 태스크 실행 중 — skip');
    return;
  }
  _taskRunning = true;
  try {
  // init() 완료 전이면 이전 세션 데이터가 남아있을 수 있으므로 skip
  const sessionReady = await AsyncStorage.getItem(SESSION_READY_KEY);
  if (sessionReady !== '1') {
    console.log('[BackgroundLocation] 세션 미준비 — init() 완료 전 skip');
    return;
  }
  // 포그라운드 상태면 alarmService가 폴링 담당 → 백그라운드 태스크는 skip
  if (AppState.currentState === 'active') {
    console.log('[BackgroundLocation] 포그라운드 상태 — alarmService가 처리하므로 skip');
    return;
  }
  const { locations } = data as { locations: Location.LocationObject[] };
  const loc = locations?.[0];
  if (!loc) {
    console.log('[BackgroundLocation] 위치 데이터 없음 — skip');
    return;
  }

  const { latitude: lat, longitude: lng } = loc.coords;
  console.log(`[BackgroundLocation] GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`);

  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) {
    console.log('[BackgroundLocation] 토큰 없음 — skip');
    return;
  }

  const [journeysRaw, appointmentsRaw] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY),
  ]);

  const journeyIds: number[] = journeysRaw ? JSON.parse(journeysRaw) : [];
  const appointmentIds: number[] = appointmentsRaw ? JSON.parse(appointmentsRaw) : [];

  console.log('[BackgroundLocation] 활성 IDs — journeys:', journeyIds, 'appointments:', appointmentIds);

  if (journeyIds.length === 0 && appointmentIds.length === 0) {
    console.log('[BackgroundLocation] ID 없음 → 위치추적 종료');
    await stopBackgroundLocationUpdates();
    return;
  }

  const remainingJourneys: number[] = [];
  const remainingAppointments: number[] = [];

  const [lastCallTimesRaw, desiredIntervalsRaw] = await Promise.all([
    AsyncStorage.getItem(LAST_CALL_TIMES_KEY),
    AsyncStorage.getItem(DESIRED_INTERVALS_KEY),
  ]);
  const lastCallTimes: Record<string, number> = lastCallTimesRaw ? JSON.parse(lastCallTimesRaw) : {};
  const desiredIntervals: Record<string, number> = desiredIntervalsRaw ? JSON.parse(desiredIntervalsRaw) : {};
  const now = Date.now();

  await Promise.all([
    ...journeyIds.map(async (id) => {
      const key = `j_${id}`;

      const intervalMs = (desiredIntervals[key] ?? 30) * 1000;
      const elapsed = now - (lastCallTimes[key] ?? 0);
      if (elapsed < intervalMs) {
        console.log(`[백그라운드] journeyId:${id} interval 미달 (${Math.round(elapsed/1000)}s / ${Math.round(intervalMs/1000)}s) — skip`);
        remainingJourneys.push(id);
        return;
      }
      lastCallTimes[key] = now;

      try {
        console.log(`[백그라운드] /location 호출 — journeyId:${id}`);
        const res = await patchLocation(`/api/journeys/${id}/location`, token, lat, lng);
        const { journey_status, preparation_time, journey_type, dest_name, which_station, interval, departure_alarm_time } = res?.data ?? {};
        console.log(`[백그라운드] /location 응답 — journeyId:${id} status:${journey_status} interval:${interval}`);
        const type: AlarmType = journey_type === 'HOME' ? 'home' : 'personal';

        if (interval != null) {
          console.log(`[백그라운드] interval 갱신 — journeyId:${id} → ${interval}s`);
          desiredIntervals[key] = interval;
        }

        if ((journey_status === 'DEPARTING' || journey_status === 'NEARDEST') && departure_alarm_time) {
          console.log(`[백그라운드] ${journey_status} — journeyId:${id} 단계별 알람 동기화`);
          await syncStagedAlarms(key, type, dest_name, id, undefined, preparation_time ?? 0, which_station, departure_alarm_time);
        }

        if (journey_status === 'ARRIVED') {
          console.log(`[백그라운드] ARRIVED — journeyId:${id} ID 제거`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
        } else {
          remainingJourneys.push(id);
        }
      } catch (e: any) {
        if (e?.message?.startsWith('HTTP 4')) {
          console.log(`[백그라운드] journeyId:${id} 서버 ${e.message} → ID 제거 (삭제된 알람)`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
        } else {
          console.log(`[백그라운드] journeyId:${id} 네트워크 오류 → 다음 주기 재시도`, e?.message);
          remainingJourneys.push(id);
        }
      }
    }),
    ...appointmentIds.map(async (id) => {
      const key = `a_${id}`;

      const intervalMs = (desiredIntervals[key] ?? 30) * 1000;
      const elapsed = now - (lastCallTimes[key] ?? 0);
      if (elapsed < intervalMs) {
        console.log(`[백그라운드] appointmentId:${id} interval 미달 (${Math.round(elapsed/1000)}s / ${Math.round(intervalMs/1000)}s) — skip`);
        remainingAppointments.push(id);
        return;
      }
      lastCallTimes[key] = now;

      try {
        console.log(`[백그라운드] /location 호출 — appointmentId:${id}`);
        const res = await patchLocation(`/api/appointments/${id}/participants/location`, token, lat, lng);
        const { participant_status, preparation_time, dest_name, which_station, interval, departure_alarm_time } = res?.data ?? {};
        console.log(`[백그라운드] /location 응답 — appointmentId:${id} status:${participant_status} interval:${interval}`);

        if (interval != null) {
          console.log(`[백그라운드] interval 갱신 — appointmentId:${id} → ${interval}s`);
          desiredIntervals[key] = interval;
        }

        if ((participant_status === 'DEPARTING' || participant_status === 'NEARDEST') && departure_alarm_time) {
          console.log(`[백그라운드] ${participant_status} — appointmentId:${id} 단계별 알람 동기화`);
          await syncStagedAlarms(key, 'group', dest_name, undefined, id, preparation_time ?? 0, which_station, departure_alarm_time);
        }

        if (participant_status === 'ARRIVED') {
          console.log(`[백그라운드] ARRIVED — appointmentId:${id} ID 제거`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
        } else {
          remainingAppointments.push(id);
        }
      } catch (e: any) {
        if (e?.message?.startsWith('HTTP 4')) {
          console.log(`[백그라운드] appointmentId:${id} 서버 ${e.message} → ID 제거 (삭제된 알람)`);
          await cancelStagedAlarms(key);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
        } else {
          console.log(`[백그라운드] appointmentId:${id} 네트워크 오류 → 다음 주기 재시도`, e?.message);
          remainingAppointments.push(id);
        }
      }
    }),
  ]);

  await Promise.all([
    AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(remainingJourneys)),
    AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(remainingAppointments)),
    AsyncStorage.setItem(LAST_CALL_TIMES_KEY, JSON.stringify(lastCallTimes)),
    AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(desiredIntervals)),
  ]);

  console.log(`[BackgroundLocation] 처리 완료 — 남은 journeys:${remainingJourneys} appointments:${remainingAppointments}`);

  if (remainingJourneys.length === 0 && remainingAppointments.length === 0) {
    console.log('[BackgroundLocation] 모든 알람 완료 → 위치추적 종료');
    await stopBackgroundLocationUpdates();
  }
  } finally {
    _taskRunning = false;
  }
});
