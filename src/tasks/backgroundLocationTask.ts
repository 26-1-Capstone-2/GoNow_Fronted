import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { TOKEN_KEY } from '@/src/store/authStore';
import { syncStagedAlarms, cancelStagedAlarms, AlarmType, sendDebugNotification } from '@/src/utils/notifications';
import type { KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { enterNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';
import ForegroundService from '@/modules/foreground-service';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND-LOCATION-TASK';
export const ACTIVE_JOURNEYS_KEY = 'gonow_active_journeys';
export const ACTIVE_APPOINTMENTS_KEY = 'gonow_active_appointments';
export const DESIRED_INTERVALS_KEY = 'gonow_desired_intervals'; // Record<key, seconds>
export const SESSION_READY_KEY = 'gonow_session_ready';         // init() 완료 후 '1' 세팅
const LAST_CALL_TIMES_KEY = 'gonow_last_call_times';           // Record<key, ms timestamp>

// 2026-08-13: FGS(상단바 알림)와 GPS 위치 구독을 완전히 분리했다(modules/foreground-service
// 도입) — 예전엔 Location.startLocationUpdatesAsync()의 foregroundService 옵션이 FGS를
// 겸했는데, 그러면 FGS를 유지하려고 GPS 폴링(30초 간격)도 항상 같이 돌아서 NEARDEST처럼
// 지오펜싱만으로 충분한 상태에서도 불필요한 GPS 비용이 발생했다(geofencing-migration-plan.md
// 참고). 이제 GPS 구독은 항상 foregroundService 옵션 없이만 시작하므로
// hasStartedLocationUpdatesAsync() 하나로 실행 여부 판단이 충분해졌고, 이 플래그는 순수하게
// "새 FGS 모듈이 지금 켜져 있는가"만 추적한다. 헤드리스 태스크마다 별도 JS 컨텍스트라
// 인메모리 변수로는 안 되고 AsyncStorage에 영속시켜야 함(ACTIVE_JOURNEYS_KEY 등과 동일한 이유).
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

// 로그아웃처럼 "전부 한 번에 정리"가 필요한 지점 전용 — 개별 add/removeActiveId와 같은 잠금을
// 타야 다른 갱신과 순서가 섞여도 유실 없이 처리된다(alarmService.ts의 stopAll() 참고).
export function clearActiveIds(): Promise<void> {
  return withActiveIdsLock(async () => {
    await AsyncStorage.multiSet([
      [ACTIVE_JOURNEYS_KEY, '[]'],
      [ACTIVE_APPOINTMENTS_KEY, '[]'],
    ]).catch(() => {});
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

// DESIRED_INTERVALS_KEY는 이 파일의 헤드리스 틱뿐 아니라 alarmService.ts(포그라운드 폴링의
// interval 갱신)와 nearDestGeofenceTask.ts(fallbackToPolling()의 폴백 시 interval 초기화)도
// 건드린다 — 서로 다른 헤드리스 태스크/실행 컨텍스트가 동시에 "읽고→고치고→쓰는" 구조라
// ACTIVE_JOURNEYS_KEY 등과 동일한 이유로 직렬화가 필요하다. 안 그러면 예를 들어 이 틱이 값을
// 읽은 "이후" fallbackToPolling()이 특정 key를 지워도, 이 틱이 자기가 읽은 스냅샷을 통째로
// 다시 써버리면서 그 삭제를 되살리는 경쟁이 생긴다(2026-08-13 고친 "NEARDEST 재진입 5분 지연"
// 버그가 이 경쟁 창에서 재발할 수 있는 구조였음 — 그래서 뒤늦게 추가).
let intervalsQueue: Promise<void> = Promise.resolve();
function withIntervalsLock(fn: () => Promise<void>): Promise<void> {
  const run = intervalsQueue.then(fn, fn);
  intervalsQueue = run.catch(() => {});
  return run;
}

export function setDesiredInterval(key: string, interval: number): Promise<void> {
  return withIntervalsLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(DESIRED_INTERVALS_KEY);
      const intervals: Record<string, number> = raw ? JSON.parse(raw) : {};
      intervals[key] = interval;
      await AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(intervals));
    } catch {}
  });
}

export function clearDesiredInterval(key: string): Promise<void> {
  return withIntervalsLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(DESIRED_INTERVALS_KEY);
      if (!raw) return;
      const intervals: Record<string, number> = JSON.parse(raw);
      if (key in intervals) {
        delete intervals[key];
        await AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(intervals));
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

let _startingLocationUpdates = false; // startGpsPolling 동시 호출 race condition 방지

// FGS(상단바 알림)만 켠다/끈다 — GPS는 전혀 안 건드린다(modules/foreground-service, Stage 1에서
// 실기기로 격리 검증 완료: FGS 시작 중 GPS 요청 0건, 강제종료해도 좀비 알림 없음).
export async function startAlarmForegroundService(): Promise<void> {
  // Foreground Service는 포그라운드 상태에서만 시작 가능(Android 정책) — 이건 어느 API로
  // 시작하든 동일한 OS 레벨 제약이라 새 모듈에도 그대로 적용된다.
  if (AppState.currentState !== 'active') {
    console.log('[startAlarmForegroundService] 백그라운드 상태 — skip');
    return;
  }
  const fgsActive = (await AsyncStorage.getItem(LOCATION_FGS_ACTIVE_KEY).catch(() => null)) === '1';
  if (fgsActive) {
    console.log('[startAlarmForegroundService] 이미 실행 중 — skip');
    return;
  }
  // 위치 권한 승인 전에 location 타입 FGS를 시작하면 SecurityException으로 앱 전체가
  // 죽는다(2026-08-13 신규 설치 기기 실측 — 로그인 직후 서버에 기존 알람이 있으면 권한
  // 요청 화면을 거치기도 전에 FGS부터 켜려다 네이티브 크래시 발생, ForegroundAlarmService.kt
  // 쪽에도 방어 코드를 추가했지만 애초에 여기서 막는 게 우선). 위치 권한 없인 FGS 자체가
  // 의미 없으므로(위치 기반 알람 모니터링 목적) 조용히 skip — 정상 흐름에서는
  // AlarmRunner.start()가 이미 requestForegroundPermissionsAsync()로 권한을 확인하므로
  // 이 skip이 실제로 발동하는 건 신규 설치 직후 같은 예외적 타이밍뿐이다.
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    console.log('[startAlarmForegroundService] 위치 권한 미승인 — FGS 시작 skip');
    return;
  }
  ForegroundService.start('GoNow 알람 실행 중', '출발 시간을 모니터링하고 있어요.');
  await AsyncStorage.setItem(LOCATION_FGS_ACTIVE_KEY, '1');
  console.log('[startAlarmForegroundService] 완료 — 상단바 알림 표시됨');
  sendDebugNotification('FGS 켜짐', 'ForegroundService.start() 성공').catch(() => {});
}

export async function stopAlarmForegroundService(): Promise<void> {
  const fgsActive = (await AsyncStorage.getItem(LOCATION_FGS_ACTIVE_KEY).catch(() => null)) === '1';
  if (!fgsActive) {
    console.log('[stopAlarmForegroundService] 이미 중지됨 — skip');
    return;
  }
  ForegroundService.stop();
  await AsyncStorage.removeItem(LOCATION_FGS_ACTIVE_KEY).catch(() => {});
  console.log('[stopAlarmForegroundService] 완료 — 상단바 알림 제거됨');
  sendDebugNotification('FGS 꺼짐', 'ForegroundService.stop() 호출').catch(() => {});
}

// GPS 위치 구독만 켠다/끈다 — FGS(상단바 알림)는 전혀 안 건드린다. foregroundService 옵션을
// 절대 안 쓰므로(FGS는 이제 startAlarmForegroundService()가 완전히 독립적으로 담당),
// hasStartedLocationUpdatesAsync() 하나로 실행 여부 판단이 충분하다 — 예전에 있던 "FGS 없는
// 구독 발견 시 stop→재시작(승격)" 로직은 이제 개념 자체가 사라져 필요 없다(과거
// ForegroundServiceDidNotStartInTimeException 크래시 전례가 있던 위험한 패턴이었음).
export async function startGpsPolling(): Promise<void> {
  if (_startingLocationUpdates) {
    console.log('[startGpsPolling] 시작 중 — skip');
    return;
  }
  _startingLocationUpdates = true;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (isRunning) {
      console.log('[startGpsPolling] 이미 실행 중 — skip');
      return;
    }
    console.log(`[startGpsPolling] 시작(timeInterval:${BACKGROUND_LOCATION_TIME_INTERVAL_MS}ms)`);
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: BACKGROUND_LOCATION_TIME_INTERVAL_MS,
      distanceInterval: 0,
    });
  } finally {
    _startingLocationUpdates = false;
  }
}

export async function stopGpsPolling(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    console.log('[stopGpsPolling] 이미 중지됨 — skip');
    return;
  }
  console.log('[stopGpsPolling] 중지');
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
}

// ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY를 다시 읽어 "지금 GPS 폴링이 실제로 필요한가"를
// 재판단하고 그에 맞게 시작/중지한다(FGS는 안 건드림 — hasAnyTrackedAlarm() 기준의 별도 판단과
// 완전히 분리). 양방향(대상 있으면 시작, 없으면 중지)인 이유는 호출부가 두 종류라서다:
// ① NEARDEST 진입 등으로 폴링 대상이 줄어든 직후(alarmService.ts의 pollPersonal/pollGroup
// NEARDEST 분기, AlarmManager onFinish) — 헤드리스 배경 틱은 AppState가 'active'면 아예
// skip하므로, 포그라운드에 계속 머물면 GPS 중단 로직이 영원히 안 도는 구멍을 메운다.
// ② syncForegroundService()(포그라운드 재진입 등) — 예전엔 무조건 startGpsPolling()을 불러서,
// 추적 중인 알람이 전부 NEARDEST(지오펜스 전용)뿐이어도 포그라운드 복귀할 때마다 불필요하게
// GPS 폴링이 다시 켜지는 버그가 있었음(2026-08-13 실기기 실측으로 발견) — 여기서도 이 함수로
// 통일해 "진짜 필요할 때만" 켜지도록 고쳤다.
export async function maybeSyncGpsPolling(): Promise<void> {
  const [journeysRaw, appointmentsRaw] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY),
  ]);
  const journeyIds: number[] = journeysRaw ? JSON.parse(journeysRaw) : [];
  const appointmentIds: number[] = appointmentsRaw ? JSON.parse(appointmentsRaw) : [];
  if (journeyIds.length === 0 && appointmentIds.length === 0) {
    console.log('[maybeSyncGpsPolling] 폴링 대상 없음 → GPS 폴링 중단');
    await stopGpsPolling();
  } else {
    await startGpsPolling();
  }
}

// 기존 호출부(alarmService.ts의 stopAll/onFinish 등)와의 호환을 위해 유지하는 얇은 래퍼 —
// FGS와 GPS 폴링을 함께 끈다("알람이 전부 사라졌다"는 신호일 때 사용). 시작 쪽은 FGS/GPS를
// 항상 따로 켜야 할 이유가 생겨서(예: 포그라운드 진입 시 FGS만, NEARDEST 재개 시 GPS만) 대응하는
// startBackgroundLocationUpdates()는 더 이상 아무도 안 써서 제거됨 — 필요하면
// startAlarmForegroundService()/startGpsPolling()을 조합해서 호출.
export async function stopBackgroundLocationUpdates(): Promise<void> {
  await stopGpsPolling();
  await stopAlarmForegroundService();
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
    console.log('[BackgroundLocation] 폴링 대상 ID 없음 → GPS 폴링 중단');
    await stopGpsPolling();
    if (await hasAnyTrackedAlarm()) {
      console.log('[BackgroundLocation] NEARDEST 등으로 대기 중인 알람이 있어 FGS 유지');
    } else {
      console.log('[BackgroundLocation] 추적 중인 알람 자체가 없음 → FGS도 종료');
      await stopAlarmForegroundService();
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

  // DESIRED_INTERVALS_KEY는 다른 헤드리스 태스크(nearDestGeofenceTask.ts의 fallbackToPolling())도
  // 동시에 건드릴 수 있어서, 이 틱이 시작 시점에 읽은 스냅샷을 끝에 통째로 덮어쓰면 그 사이에
  // 일어난 삭제를 되살릴 위험이 있다(위 withIntervalsLock 주석 참고) — 그래서 이 틱이 실제로
  // 바꾼 key만 델타로 모아뒀다가, 쓰기 시점에 최신 상태를 다시 읽어 병합한다.
  const intervalSets: Record<string, number> = {};
  const intervalDeletes = new Set<string>();

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
          intervalSets[key] = interval;
          intervalDeletes.delete(key);
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
          intervalDeletes.add(key);
          delete intervalSets[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(id, undefined).catch(() => {});
        } else if (journey_status === 'NEARDEST') {
          console.log(`[백그라운드] NEARDEST — journeyId:${id} 지오펜스로 전환, 폴링 중단`);
          delete lastCallTimes[key];
          // desiredIntervals[key]는 여기서 안 지운다 — NEARDEST 동안은 폴링 대상 목록에서
          // 빠져있어 아무도 안 읽으므로 무해하고, 포그라운드 진입 경로(alarmService.ts)는
          // 애초에 이 값을 안 건드려서 여기만 지우면 진입 경로별로 비대칭이 생긴다. 대신
          // "지오펜스에서 폴링으로 복귀하는" 단일 지점(nearDestGeofenceTask.ts의
          // fallbackToPolling())에서 무조건 지우도록 통일했다(2026-08-13, 여러 ENTER 경로에
          // 각자 정리를 맡기는 것보다 안전 — 실제로 이 비대칭 때문에 5분 지연 버그가 있었음).
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
          intervalDeletes.add(key);
          delete intervalSets[key];
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
          intervalSets[key] = interval;
          intervalDeletes.delete(key);
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
          intervalDeletes.add(key);
          delete intervalSets[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(undefined, id).catch(() => {});
        } else if (participant_status === 'NEARDEST') {
          console.log(`[백그라운드] NEARDEST — appointmentId:${id} 지오펜스로 전환, 폴링 중단`);
          delete lastCallTimes[key];
          // desiredIntervals[key]는 여기서 안 지운다 — 이유는 위 journey_status NEARDEST
          // 분기 주석 참고(fallbackToPolling()에서 통일해서 지움).
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
          intervalDeletes.add(key);
          delete intervalSets[key];
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
  // LAST_CALL_TIMES_KEY는 이 파일 안에서만 쓰이는 값이라(다른 태스크가 안 건드림) _taskRunning
  // 가드만으로 충분해 그대로 통째 덮어쓴다. DESIRED_INTERVALS_KEY는 nearDestGeofenceTask.ts/
  // alarmService.ts도 건드리므로 위 withIntervalsLock으로 최신 상태를 다시 읽어 이 틱이 실제로
  // 바꾼 key(intervalSets/intervalDeletes)만 병합해서 쓴다(통째 덮어쓰면 그 사이 다른 태스크의
  // 삭제를 되살릴 위험이 있음).
  await Promise.all([
    AsyncStorage.setItem(LAST_CALL_TIMES_KEY, JSON.stringify(lastCallTimes)),
    withIntervalsLock(async () => {
      const raw = await AsyncStorage.getItem(DESIRED_INTERVALS_KEY);
      const fresh: Record<string, number> = raw ? JSON.parse(raw) : {};
      for (const [k, v] of Object.entries(intervalSets)) fresh[k] = v;
      for (const k of intervalDeletes) delete fresh[k];
      await AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(fresh));
    }),
  ]);

  console.log(`[BackgroundLocation] 처리 완료 — 남은 journeys:${remainingJourneys} appointments:${remainingAppointments}`);

  if (remainingJourneys.length === 0 && remainingAppointments.length === 0) {
    console.log('[BackgroundLocation] 폴링 대상 소진 → GPS 폴링 중단');
    await stopGpsPolling();
    if (await hasAnyTrackedAlarm()) {
      console.log('[BackgroundLocation] 폴링 대상은 없지만 NEARDEST 등으로 대기 중인 알람이 있어 FGS 유지');
    } else {
      console.log('[BackgroundLocation] 모든 알람 완료 → FGS도 종료');
      await stopAlarmForegroundService();
    }
  }
  } finally {
    _taskRunning = false;
  }
});
