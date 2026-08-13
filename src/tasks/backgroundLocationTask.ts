import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { TOKEN_KEY } from '@/src/store/authStore';
import { sendAlarm, syncStagedAlarms, cancelStagedAlarms, AlarmType, sendDebugNotification } from '@/src/utils/notifications';
import type { KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { enterNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND-LOCATION-TASK';
export const ACTIVE_JOURNEYS_KEY = 'gonow_active_journeys';
export const ACTIVE_APPOINTMENTS_KEY = 'gonow_active_appointments';
export const DESIRED_INTERVALS_KEY = 'gonow_desired_intervals'; // Record<key, seconds>
export const SESSION_READY_KEY = 'gonow_session_ready';         // init() 완료 후 '1' 세팅
const LAST_CALL_TIMES_KEY = 'gonow_last_call_times';           // Record<key, ms timestamp>

// Location.hasStartedLocationUpdatesAsync()는 "그 이름의 구독이 켜져 있나"만 알려주고
// "FGS를 포함해서 켜져 있나"는 구분 못 함 — 그래서 한 번 FGS 없이(backgroundAlarmTask.ts의
// FCM 웨이크업, nearDestGeofenceTask.ts의 지오펜스 폴백) 구독이 시작되면, 이후
// startBackgroundLocationUpdates()가 "이미 실행 중"이라 오판해서 영원히 FGS로 승격을
// 시도조차 안 하는 버그가 있었음(2026-08-12 발견). 이 플래그로 "지금 켜진 구독이 FGS를
// 포함하는지"를 직접 추적한다. 헤드리스 태스크마다 별도 JS 컨텍스트라 인메모리 변수로는
// 안 되고 AsyncStorage에 영속시켜야 함(ACTIVE_JOURNEYS_KEY 등과 동일한 이유).
const LOCATION_FGS_ACTIVE_KEY = 'gonow_location_fgs_active';

const BACKGROUND_LOCATION_TIME_INTERVAL_MS = 30000;

// /location 응답 자체엔 목적지 좌표가 없어서(목적지는 안 바뀌는 값이라 매 폴링에 안 실어줌),
// 헤드리스(백그라운드) 경로가 카카오맵 딥링크 버튼을 알림에 붙이려면 이 캐시가 필요함.
// alarmService.ts의 AlarmRunner.start()/stop()이 기록/삭제하고, 이 파일의 폴링 루프가 읽어서
// syncStagedAlarms()에 그대로 넘김 — 포그라운드(alarmService.ts)와 동일한 값을 쓰게 만드는 게 목적.
export const ALARM_NAV_INFO_KEY = 'gonow_alarm_nav_info'; // Record<key, AlarmNavInfo>

export type AlarmNavInfo = {
  destLat?: number;
  destLng?: number;
  destination?: string; // NEARDEST 지오펜스 진입 시 도착 확인 알림 문구용(nearDestGeofenceTask.ts)
  transportMode?: KakaoMapTransportMode;
  isLastMode?: boolean;
};

// 읽고→고치고→쓰는 구조라, alarmService.start()가 여러 개 동시에 불리면(예: 새벽 4시
// FCM으로 여러 여정이 한꺼번에 READY 전환될 때 Promise.all로 병렬 호출됨) 나중에 쓴 쪽이
// 먼저 쓴 쪽을 덮어써서 좌표가 사라질 수 있음 — 같은 프로세스 안에서는 순서대로만 처리되게
// 직렬화(notifications.ts의 withStagingLock과 동일한 패턴)
let navInfoQueue: Promise<void> = Promise.resolve();
function withNavInfoLock(fn: () => Promise<void>): Promise<void> {
  const run = navInfoQueue.then(fn, fn); // 이전 호출이 실패했어도 다음 호출은 정상 진행
  navInfoQueue = run.catch(() => {});
  return run;
}

export function saveAlarmNavInfo(key: string, info: AlarmNavInfo): Promise<void> {
  return withNavInfoLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY);
      const map: Record<string, AlarmNavInfo> = raw ? JSON.parse(raw) : {};
      map[key] = info;
      await AsyncStorage.setItem(ALARM_NAV_INFO_KEY, JSON.stringify(map));
    } catch {}
  });
}

export function removeAlarmNavInfo(key: string): Promise<void> {
  return withNavInfoLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY);
      if (!raw) return;
      const map: Record<string, AlarmNavInfo> = JSON.parse(raw);
      delete map[key];
      await AsyncStorage.setItem(ALARM_NAV_INFO_KEY, JSON.stringify(map));
    } catch {}
  });
}

// ALARM_NAV_INFO_KEY는 NEARDEST로 폴링이 멈춘 알람도 계속 남아있다(ARRIVED/삭제 때만 지움) —
// 그래서 "폴링이 필요한 알람"(ACTIVE_JOURNEYS_KEY)이 아니라 "존재하는 알람 자체가 있는지"를
// 판단하는 용도로는 이 키가 맞다. 2026-08-12 정책 변경(FGS는 알람이 하나라도 있으면 상시
// 유지, NEARDEST라고 안 끔)으로 배경 틱이 FGS를 끌지 말지 판단할 때 이걸 써야 한다 —
// ACTIVE_JOURNEYS_KEY만 보면 NEARDEST로 넘어간 알람은 목록에서 빠지므로, 그것만 보고
// "추적 대상 없음"이라 판단해 FGS를 잘못 꺼버리는 문제가 있었다.
async function hasAnyTrackedAlarm(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY).catch(() => null);
  if (!raw) return false;
  try {
    return Object.keys(JSON.parse(raw)).length > 0;
  } catch {
    return false;
  }
}

// ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY도 읽고→고치고→쓰는 구조라 위와 같은 이유로
// 직렬화 필요 — 이 값은 배경 위치추적 태스크가 "추적할 게 남았는지" 판단하는 유일한 근거라서,
// alarmService(시작/종료), 이 파일의 백그라운드 틱, nearDestGeofenceTask(지오펜스 폴백)가
// 잠금 없이 각자 통째로 덮어쓰면 유실된 갱신 때문에 실제로는 추적 중인데 빈 목록으로 잘못
// 읽혀 FGS가 잘못 꺼지는 문제가 있었음 — 이 두 함수로 모든 갱신 지점을 통일한다.
let activeIdsQueue: Promise<void> = Promise.resolve();
function withActiveIdsLock(fn: () => Promise<void>): Promise<void> {
  const run = activeIdsQueue.then(fn, fn);
  activeIdsQueue = run.catch(() => {});
  return run;
}

export function addActiveId(journeyId?: number, appointmentId?: number): Promise<void> {
  return withActiveIdsLock(async () => {
    try {
      if (journeyId != null) {
        const raw = await AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY);
        const ids: number[] = raw ? JSON.parse(raw) : [];
        if (!ids.includes(journeyId)) {
          ids.push(journeyId);
          await AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(ids));
        }
      } else if (appointmentId != null) {
        const raw = await AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY);
        const ids: number[] = raw ? JSON.parse(raw) : [];
        if (!ids.includes(appointmentId)) {
          ids.push(appointmentId);
          await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(ids));
        }
      }
    } catch {}
  });
}

export function removeActiveId(journeyId?: number, appointmentId?: number): Promise<void> {
  return withActiveIdsLock(async () => {
    try {
      if (journeyId != null) {
        const raw = await AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY);
        const ids: number[] = raw ? JSON.parse(raw) : [];
        const next = ids.filter((id) => id !== journeyId);
        if (next.length !== ids.length) {
          await AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(next));
        }
      } else if (appointmentId != null) {
        const raw = await AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY);
        const ids: number[] = raw ? JSON.parse(raw) : [];
        const next = ids.filter((id) => id !== appointmentId);
        if (next.length !== ids.length) {
          await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(next));
        }
      }
    } catch {}
  });
}

const BASE_URL = 'https://gonow-api.uk';

// nearDestGeofenceTask.ts도 이 헬퍼를 그대로 재사용(EXIT 처리 시 /location 호출)
// 2026-08-13: 백그라운드에서 오랜만에(지오펜스 EXIT처럼 드물게) 호출할 때, 커넥션 풀에 있던
// 연결이 죽어있어 응답이 무기한(실측 25~33초) 안 오는 현상이 확인됨 — 타임아웃을 걸고, 타임아웃/
// 네트워크 오류(서버가 명시적으로 거부한 HTTP 4xx/5xx는 재시도해도 의미 없으므로 제외)면 1회
// 재시도한다. 지오펜스 위주 구조에서는 호출 자체가 원래 드문드문 일어나는 게 정상이라, 이 안전장치는
// 임시방편이 아니라 계속 필요하다.
// 2026-08-13(2차): 위 setTimeout+AbortController 타임아웃이 백그라운드에서 실측상 단 한 번도
// 제때 발동하지 않았다(항상 "1차 성공"으로 지연시간을 통째로 먹고 끝남) — 반면 같은 시간대에
// GPS 네이티브 호출/TaskManager 헤드리스 발화는 항상 즉시 실행됐다. 이 둘의 차이는 "JS
// setTimeout을 거치는가"뿐이라, JS 타이머가 백그라운드에서 지연 전달될 수 있다는 쪽으로
// 원인을 좁혔다. 그래서 fetch()+AbortController(JS 타이머 기반) 대신 XMLHttpRequest.timeout을
// 직접 쓴다 — 이건 JS 타이머가 아니라 네이티브 NetworkingModule.kt에서 OkHttp의
// callTimeout()으로 바로 연결되는, JS 스레드 상태와 무관하게 자체 감시 스레드로 동작하는
// 네이티브 레벨 타임아웃이다(코드로 확인, NetworkingModule.kt:329-330).
function patchLocationOnce(path: string, token: string, lat: number, lng: number, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = timeoutMs;
    xhr.open('PATCH', `${BASE_URL}${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('네트워크 오류'));
    xhr.ontimeout = () => reject(new Error(`timeout after ${timeoutMs}ms`));
    xhr.send(JSON.stringify({ lat, lng }));
  });
}

export async function patchLocation(path: string, token: string, lat: number, lng: number) {
  // TODO: 실측 테스트용 임시 타이밍 로그+알림(2026-08-13) — 재시도가 실제로 빠르게 성공하는지
  // (=새 연결 가설 지지) 로그 없이 폰 화면만 보고도 확인하기 위함. 검증 끝나면 정리할 것.
  // 1차 성공은 정상 케이스(자주 일어남)라 알림 스팸 방지 차원에서 알림 없이 로그만 남기고,
  // "재시도가 실제로 발동했는지"가 궁금한 포인트라 실패→재시도 전환/재시도 결과만 알림으로 띄운다.
  const t0 = Date.now();
  try {
    const result = await patchLocationOnce(path, token, lat, lng, 10000);
    console.log(`[patchLocation] +${Date.now() - t0}ms 1차 성공`);
    return result;
  } catch (e: any) {
    if (e?.message?.startsWith('HTTP ')) throw e; // 서버가 명시적으로 응답한 거부는 재시도 무의미
    const failMsg = e?.message ?? String(e);
    const firstElapsed = Date.now() - t0;
    console.log(`[patchLocation] +${firstElapsed}ms 1차 실패(${failMsg}) — 새 연결로 재시도`);
    sendDebugNotification('patchLocation 1차 실패 → 재시도', `+${firstElapsed}ms ${failMsg}`).catch(() => {});
    try {
      const result = await patchLocationOnce(path, token, lat, lng, 10000);
      const elapsed = Date.now() - t0;
      console.log(`[patchLocation] +${elapsed}ms 재시도 성공`);
      sendDebugNotification('patchLocation 재시도 성공', `+${elapsed}ms`).catch(() => {});
      return result;
    } catch (e2: any) {
      const elapsed = Date.now() - t0;
      const failMsg2 = e2?.message ?? String(e2);
      console.log(`[patchLocation] +${elapsed}ms 재시도도 실패(${failMsg2})`);
      sendDebugNotification('patchLocation 재시도도 실패', `+${elapsed}ms ${failMsg2}`).catch(() => {});
      throw e2;
    }
  }
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
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    const fgsActive = (await AsyncStorage.getItem(LOCATION_FGS_ACTIVE_KEY).catch(() => null)) === '1';
    if (isRunning && fgsActive) {
      console.log(`[startBackgroundLocationUpdates] 이미 FGS 포함 실행 중(요청값:${BACKGROUND_LOCATION_TIME_INTERVAL_MS}ms — 실제 적용 여부는 이 로그로 알 수 없음) — skip`);
      return;
    }
    if (isRunning && !fgsActive) {
      // FGS 없이(백그라운드 폴백 경로로) 시작된 구독이 이미 돌고 있음 — 지금은 포그라운드라
      // 안전하게 껐다가 FGS 포함해서 다시 켤 수 있으므로 승격시킨다.
      console.log(`[startBackgroundLocationUpdates] FGS 없는 구독 발견 → 승격 시도(timeInterval:${BACKGROUND_LOCATION_TIME_INTERVAL_MS}ms로 재시작)`);
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    } else {
      console.log(`[startBackgroundLocationUpdates] 시작(timeInterval:${BACKGROUND_LOCATION_TIME_INTERVAL_MS}ms)`);
    }
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: BACKGROUND_LOCATION_TIME_INTERVAL_MS,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: 'GoNow 알람 실행 중',
        notificationBody: '출발 시간을 모니터링하고 있어요.',
        notificationColor: '#4CAF50',
      },
    });
    await AsyncStorage.setItem(LOCATION_FGS_ACTIVE_KEY, '1');
    console.log('[startBackgroundLocationUpdates] 완료 — 상단바 알림 표시됨');
    // TODO: 실기기 지오펜싱 실측 테스트 완료 후 삭제(임시 디버그용) — FGS 온/오프를
    // 상단바 알림 육안 확인 대신 확실한 신호로 파악하기 위함.
    sendDebugNotification('FGS 켜짐', `startLocationUpdatesAsync 성공`).catch(() => {});
  } finally {
    _startingLocationUpdates = false;
  }
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    console.log('[stopBackgroundLocationUpdates] 이미 중지됨 — skip');
    await AsyncStorage.removeItem(LOCATION_FGS_ACTIVE_KEY).catch(() => {});
    return;
  }
  console.log('[stopBackgroundLocationUpdates] 중지');
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
  await AsyncStorage.removeItem(LOCATION_FGS_ACTIVE_KEY).catch(() => {});
  console.log('[stopBackgroundLocationUpdates] 완료 — 상단바 알림 제거됨');
  // TODO: 실기기 지오펜싱 실측 테스트 완료 후 삭제(임시 디버그용)
  sendDebugNotification('FGS 꺼짐', `stopLocationUpdatesAsync 완료`).catch(() => {});
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
    console.log('[BackgroundLocation] 폴링 대상 ID 없음');
    if (await hasAnyTrackedAlarm()) {
      console.log('[BackgroundLocation] NEARDEST 등으로 대기 중인 알람이 있어 FGS 유지');
    } else {
      console.log('[BackgroundLocation] 추적 중인 알람 자체가 없음 → 위치추적 종료');
      await stopBackgroundLocationUpdates();
    }
    return;
  }

  const remainingJourneys: number[] = [];
  const remainingAppointments: number[] = [];

  const [lastCallTimesRaw, desiredIntervalsRaw, navInfoRaw] = await Promise.all([
    AsyncStorage.getItem(LAST_CALL_TIMES_KEY),
    AsyncStorage.getItem(DESIRED_INTERVALS_KEY),
    AsyncStorage.getItem(ALARM_NAV_INFO_KEY),
  ]);
  const lastCallTimes: Record<string, number> = lastCallTimesRaw ? JSON.parse(lastCallTimesRaw) : {};
  const desiredIntervals: Record<string, number> = desiredIntervalsRaw ? JSON.parse(desiredIntervalsRaw) : {};
  const navInfo: Record<string, AlarmNavInfo> = navInfoRaw ? JSON.parse(navInfoRaw) : {};
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
          const nav = navInfo[key];
          await syncStagedAlarms(key, type, dest_name, id, undefined, preparation_time ?? 0, which_station, departure_alarm_time, nav?.destLat, nav?.destLng, nav?.transportMode, nav?.isLastMode);
        }

        if (journey_status === 'ARRIVED') {
          console.log(`[백그라운드] ARRIVED — journeyId:${id} ID 제거`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(id, undefined).catch(() => {});
        } else if (journey_status === 'NEARDEST') {
          console.log(`[백그라운드] NEARDEST — journeyId:${id} 지오펜스로 전환, 폴링 중단`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
          await enterNearDestGeofenceMode(key, navInfo[key]?.destLat, navInfo[key]?.destLng, navInfo[key]?.destination);
          removeActiveId(id, undefined).catch(() => {});
        } else {
          remainingJourneys.push(id);
        }
      } catch (e: any) {
        if (e?.message?.startsWith('HTTP 4')) {
          console.log(`[백그라운드] journeyId:${id} 서버 ${e.message} → ID 제거 (삭제된 알람)`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(id, undefined).catch(() => {});
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
          const nav = navInfo[key];
          await syncStagedAlarms(key, 'group', dest_name, undefined, id, preparation_time ?? 0, which_station, departure_alarm_time, nav?.destLat, nav?.destLng, nav?.transportMode, nav?.isLastMode);
        }

        if (participant_status === 'ARRIVED') {
          console.log(`[백그라운드] ARRIVED — appointmentId:${id} ID 제거`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(undefined, id).catch(() => {});
        } else if (participant_status === 'NEARDEST') {
          console.log(`[백그라운드] NEARDEST — appointmentId:${id} 지오펜스로 전환, 폴링 중단`);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
          await enterNearDestGeofenceMode(key, navInfo[key]?.destLat, navInfo[key]?.destLng, navInfo[key]?.destination);
          removeActiveId(undefined, id).catch(() => {});
        } else {
          remainingAppointments.push(id);
        }
      } catch (e: any) {
        if (e?.message?.startsWith('HTTP 4')) {
          console.log(`[백그라운드] appointmentId:${id} 서버 ${e.message} → ID 제거 (삭제된 알람)`);
          await cancelStagedAlarms(key);
          delete lastCallTimes[key];
          delete desiredIntervals[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(undefined, id).catch(() => {});
        } else {
          console.log(`[백그라운드] appointmentId:${id} 네트워크 오류 → 다음 주기 재시도`, e?.message);
          remainingAppointments.push(id);
        }
      }
    }),
  ]);

  // ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY는 위에서 개별 removeActiveId()로 이미 최신화됨
  // — 여기서 remainingJourneys/remainingAppointments로 통째 덮어쓰면, 이 틱이 도는 동안 다른
  // 경로(지오펜스 폴백 등)가 새로 추가한 ID를 유실시킬 수 있어 의도적으로 안 씀.
  await Promise.all([
    AsyncStorage.setItem(LAST_CALL_TIMES_KEY, JSON.stringify(lastCallTimes)),
    AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(desiredIntervals)),
  ]);

  console.log(`[BackgroundLocation] 처리 완료 — 남은 journeys:${remainingJourneys} appointments:${remainingAppointments}`);

  if (remainingJourneys.length === 0 && remainingAppointments.length === 0) {
    if (await hasAnyTrackedAlarm()) {
      console.log('[BackgroundLocation] 폴링 대상은 없지만 NEARDEST 등으로 대기 중인 알람이 있어 FGS 유지');
    } else {
      console.log('[BackgroundLocation] 모든 알람 완료 → 위치추적 종료');
      await stopBackgroundLocationUpdates();
    }
  }
  } finally {
    _taskRunning = false;
  }
});
