import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { TOKEN_KEY } from '@/src/store/authStore';
import { syncStagedAlarms, cancelStagedAlarms, AlarmType, sendDebugNotification } from '@/src/utils/notifications';
import type { KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { enterNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';
import { enterDepartingGeofenceMode } from '@/src/tasks/departingGeofenceTask';
import { enterMovingGeofenceMode, exitMovingGeofenceMode } from '@/src/tasks/movingGeofenceTask';
import { enterReadyGeofenceMode, exitReadyGeofenceMode } from '@/src/tasks/readyGeofenceTask';
import { dlog } from '@/src/utils/deviceLogger';
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

// 서버가 아무 값도 안 준 경우의 기본값(폴백)로만 쓴다 — 실제 네이티브 구독 등록값은
// getMinDesiredIntervalMs()가 DESIRED_INTERVALS_KEY 기준으로 동적으로 결정한다(버그3/8 수정,
// 2026-08-14). FGS와 GPS를 분리한 덕분에(위 LOCATION_FGS_ACTIVE_KEY 주석 참고) 이 구독을
// stop→restart해도 FGS 관련 크래시 위험이 없어져서, 값이 바뀔 때마다 안전하게 재등록할 수 있다.
const BACKGROUND_LOCATION_TIME_INTERVAL_MS = 30000;
// ⚠️ 2026-08-14 임시 테스트 코드 — 검증 끝나면 반드시 제거할 것. alarmService.ts의 동명 상수와
// 반드시 같은 값으로 맞춰야 한다(포/백이 서로 다른 값을 강제하면 그 자체로 새 불일치가 생김).
const DEBUG_FORCE_INTERVAL_SEC: number | null = 15;
// 2026-08-14(버그3/8, 재발 수정): 알람 생성 직후 짧은 AppState 블립 동안 포그라운드(alarmService.ts)
// 쪽 poll()이 GPS 콜드 픽스를 기다리는 사이, 이 헤드리스 틱이 먼저 같은 key로 /location을 호출해
// 버릴 수 있다(반대로 이 틱이 먼저 호출하고 포그라운드가 뒤늦게 중복 호출하는 문제는 이미
// alarmService.ts에 같은 상수로 가드를 넣었다 — 여긴 반대 방향 대칭 가드). 정상적인 폴링 간격
// (최소 30초)보다 훨씬 짧게 잡아서 정상 동작과는 겹치지 않는다.
const DUPLICATE_CALL_GUARD_MS = 5000;
// 네이티브 구독에 지금 등록된 timeInterval(ms) — Location API가 "등록된 값"을 조회하는
// 방법을 제공하지 않아서 직접 추적한다. startGpsPolling()이 이 값과 새로 계산한 값을
// 비교해서 다르면만 stop→restart한다.
const CURRENT_GPS_INTERVAL_KEY = 'gonow_current_gps_interval_ms';

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
  // 개인/귀가(Journey) 전용 — 반복 요일 비트마스크(0/undefined면 반복 없음). 그룹(Appointment)은
  // 항상 undefined. ARRIVED 도달 시 nav info를 "파킹"(다음 회차까지 유지)할지 판단하는 근거(버그45).
  repeatDays?: number;
};

// 읽고→고치고→쓰는 구조라, alarmService.start()가 여러 개 동시에 불리면(예: 새벽 4시
// FCM으로 여러 여정이 한꺼번에 READY 전환될 때 Promise.all로 병렬 호출됨) 나중에 쓴 쪽이
// 먼저 쓴 쪽을 덮어써서 좌표가 사라질 수 있음 — 같은 프로세스 안에서는 순서대로만 처리되게
// 직렬화(notifications.ts의 withStagingLock과 동일한 패턴)
let navInfoQueue: Promise<void> = Promise.resolve();
// removeOrParkAlarmNavInfo()가 "파킹했는지" 결과값을 돌려줘야 해서 제네릭으로 뺐다(버그45) —
// 큐 자체(navInfoQueue)는 순서 보장 목적일 뿐이라 여전히 Promise<void>로 둔다.
function withNavInfoLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = navInfoQueue.then(fn, fn); // 이전 호출이 실패했어도 다음 호출은 정상 진행
  navInfoQueue = run.then(() => {}, () => {});
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

// 로그아웃 등 "전부 한 번에" 초기화하는 지점 전용(clearActiveIds()와 동일한 목적·패턴) —
// 파킹된(ARRIVED, 반복 여정이라 다음 회차까지 nav info를 남겨둔) 엔트리까지 포함해 통째로
// 비운다. 이게 없으면 로그아웃 후 다른 계정으로 로그인해도 이전 계정의 파킹 엔트리가
// hasAnyTrackedAlarm()을 계속 true로 만들어 FGS가 잘못 켜진 채 남을 수 있다(버그45).
export function clearAlarmNavInfo(): Promise<void> {
  return withNavInfoLock(async () => {
    await AsyncStorage.setItem(ALARM_NAV_INFO_KEY, JSON.stringify({})).catch(() => {});
  });
}

// ARRIVED류 이벤트(수동 도착확인 버튼, 서버 강제 auto_arrived FCM)를 처리하는 헤드리스 경로
// (notifications.ts의 백그라운드 도착확인, backgroundAlarmTask.ts의 auto_arrived) 전용 —
// 이 경로들은 AlarmManager를 거치지 않고 nav info를 직접 지웠었는데, 반복 여정이면 지우지 않고
// 파킹해야 한다(버그45). 읽기→반복여부 판단→(필요시)삭제를 한 락 안에서 원자적으로 처리해서
// 그 사이 다른 컨텍스트가 같은 key를 갱신하는 경쟁을 피한다. 반환값: true면 파킹(유지),
// false면 실제로 지움(반복 아님, 또는 원래 없던 key).
export function removeOrParkAlarmNavInfo(key: string): Promise<boolean> {
  return withNavInfoLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY);
      if (!raw) {
        dlog('POLLING', `[removeOrParkAlarmNavInfo] key:${key} — ALARM_NAV_INFO_KEY 자체가 비어있음`);
        return false;
      }
      const map: Record<string, AlarmNavInfo> = JSON.parse(raw);
      dlog('POLLING', `[removeOrParkAlarmNavInfo] key:${key} — 엔트리:${map[key] ? '있음' : '없음'} repeatDays:${map[key]?.repeatDays ?? 0}`);
      const parking = isRepeatingJourney(map[key]?.repeatDays);
      if (!parking) {
        delete map[key];
        await AsyncStorage.setItem(ALARM_NAV_INFO_KEY, JSON.stringify(map));
      }
      return parking;
    } catch {
      return false;
    }
  });
}

// 특정 key가 지금 nav info에 등록돼 있는지만 가볍게 확인 — AlarmManager.stop()이 "애초에
// 추적된 적 없는 key"(예: SCHEDULED 상태에서 한 번도 시작 안 한 알람을 토글 OFF)까지 지오펜스
// 해제 4종 + cancelStagedAlarms + FGS/GPS 재확인을 매번 도는 걸 막기 위한 조회용(버그45 리뷰
// 중 발견된 효율 이슈).
export async function hasAlarmNavInfo(key: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY).catch(() => null);
  if (!raw) return false;
  try {
    return key in JSON.parse(raw);
  } catch {
    return false;
  }
}

// repeatDays 비트마스크가 "반복"을 의미하는지 판단하는 단일 기준 — alarmService.ts(포그라운드
// ARRIVED 처리)와 이 파일의 헤드리스 틱(백그라운드 ARRIVED 처리) 양쪽에서 재사용해서 "무엇을
// 반복으로 볼지" 판단이 어긋나지 않게 한다(버그45).
export function isRepeatingJourney(repeatDays?: number | null): boolean {
  return !!repeatDays;
}

// ALARM_NAV_INFO_KEY는 NEARDEST로 폴링이 멈춘 알람도 계속 남아있다(ARRIVED/삭제 때만 지움) —
// 그래서 "폴링이 필요한 알람"(ACTIVE_JOURNEYS_KEY)이 아니라 "존재하는 알람 자체가 있는지"를
// 판단하는 용도로는 이 키가 맞다. 2026-08-12 정책 변경(FGS는 알람이 하나라도 있으면 상시
// 유지, NEARDEST라고 안 끔)으로 배경 틱이 FGS를 끌지 말지 판단할 때 이걸 써야 한다 —
// ACTIVE_JOURNEYS_KEY만 보면 NEARDEST로 넘어간 알람은 목록에서 빠지므로, 그것만 보고
// "추적 대상 없음"이라 판단해 FGS를 잘못 꺼버리는 문제가 있었다.
export async function hasAnyTrackedAlarm(): Promise<boolean> {
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
// 2026-08-14(진단용 로그, 힘든 콜드스타트 버그 재검토): 이 락 큐 자체가 어딘가에서 멈추는 게
// 아닌지 의심되는 상황이라(콜드 스타트 후 addActiveId 완료 로그가 안 찍힌 사례 있었음),
// label로 어느 호출이 언제 락을 잡고 언제 놓는지 추적 가능하게 한다.
function withActiveIdsLock(label: string, fn: () => Promise<void>): Promise<void> {
  dlog('POLLING', `[activeIdsLock] 대기열 진입 — label:${label}`);
  const run = activeIdsQueue.then(
    async () => {
      dlog('POLLING', `[activeIdsLock] 락 획득 — label:${label}`);
      try {
        await fn();
        dlog('POLLING', `[activeIdsLock] 락 해제(성공) — label:${label}`);
      } catch (e) {
        dlog('POLLING', `[activeIdsLock] 락 해제(실패) — label:${label} error:${e}`);
        throw e;
      }
    },
    (e) => {
      dlog('POLLING', `[activeIdsLock] 이전 큐 실패로 락 획득 — label:${label} error:${e}`);
    }
  );
  activeIdsQueue = run.catch(() => {});
  return run;
}

export function addActiveId(journeyId?: number, appointmentId?: number): Promise<void> {
  return withActiveIdsLock(`add(j:${journeyId ?? '-'},a:${appointmentId ?? '-'})`, async () => {
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
  return withActiveIdsLock('clear', async () => {
    await AsyncStorage.multiSet([
      [ACTIVE_JOURNEYS_KEY, '[]'],
      [ACTIVE_APPOINTMENTS_KEY, '[]'],
    ]).catch(() => {});
  });
}

export function removeActiveId(journeyId?: number, appointmentId?: number): Promise<void> {
  return withActiveIdsLock(`remove(j:${journeyId ?? '-'},a:${appointmentId ?? '-'})`, async () => {
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
function withIntervalsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = intervalsQueue.then(fn, fn);
  intervalsQueue = run.then(() => undefined, () => undefined);
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

// 2026-08-14(버그3/8, 검토 중 발견): 생성 직후 중복 호출 가드(alarmService.ts의
// DUPLICATE_CALL_GUARD_MS)가 스킵할 때, 스킵한 쪽(주로 foreground AlarmRunner)은 상대방이 방금
// 서버로부터 받은 실제 interval을 모른 채 자기 메모리의 기본값(30초)으로 재예약해버려서, 얼마 뒤
// 또 한 번 불필요한 조기 호출이 나가는 잔여 문제가 있었다 — 스킵 시 이미 저장된 최신 desired
// interval을 조회해 반영하도록 이 getter를 추가했다.
export function getDesiredInterval(key: string): Promise<number | null> {
  return withIntervalsLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(DESIRED_INTERVALS_KEY);
      const intervals: Record<string, number> = raw ? JSON.parse(raw) : {};
      return intervals[key] ?? null;
    } catch {
      return null;
    }
  });
}

// 2026-08-14(버그3/8): LAST_CALL_TIMES_KEY("마지막으로 실제 /location을 호출한 시각")를
// alarmService.ts(포그라운드 AlarmRunner)도 같이 읽고 쓰게 됐다 — 원래는 이 파일의 헤드리스
// 틱만 쓰는 값이라 _taskRunning 가드만으로 충분했지만, 이제 두 실행 컨텍스트가 동시에
// 건드릴 수 있어 DESIRED_INTERVALS_KEY와 같은 이유로 직렬화가 필요하다. 포그라운드가 이 값을
// 같이 쓰는 이유: 포그라운드 복귀 시 무조건 즉시 재폴링하면(경과 시간 무관) 포그라운드/백그라운드를
// 빠르게 반복할 때마다 서버가 준 interval보다 더 자주 호출하게 되는 문제가 있어서 — 이제
// "마지막 실제 호출 이후 얼마나 지났는지"를 포그라운드/백그라운드 공통 기준으로 판단한다.
let lastCallTimesQueue: Promise<void> = Promise.resolve();
function withLastCallTimesLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lastCallTimesQueue.then(fn, fn);
  lastCallTimesQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function getLastCallTime(key: string): Promise<number> {
  return withLastCallTimesLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(LAST_CALL_TIMES_KEY);
      const times: Record<string, number> = raw ? JSON.parse(raw) : {};
      return times[key] ?? 0;
    } catch {
      return 0;
    }
  });
}

export function setLastCallTime(key: string, ms: number): Promise<void> {
  return withLastCallTimesLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(LAST_CALL_TIMES_KEY);
      const times: Record<string, number> = raw ? JSON.parse(raw) : {};
      times[key] = ms;
      await AsyncStorage.setItem(LAST_CALL_TIMES_KEY, JSON.stringify(times));
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
    dlog('POLLING', `[patchLocation] +${Date.now() - t0}ms 1차 성공`);
    return result;
  } catch (e: any) {
    if (e?.message?.startsWith('HTTP ')) throw e; // 서버가 명시적으로 응답한 거부는 재시도 무의미
    const failMsg = e?.message ?? String(e);
    const firstElapsed = Date.now() - t0;
    dlog('POLLING', `[patchLocation] +${firstElapsed}ms 1차 실패(${failMsg}) — 새 연결로 재시도`);
    sendDebugNotification('patchLocation 1차 실패 → 재시도', `+${firstElapsed}ms ${failMsg}`).catch(() => {});
    try {
      const result = await patchLocationOnce(path, token, lat, lng, 10000);
      const elapsed = Date.now() - t0;
      dlog('POLLING', `[patchLocation] +${elapsed}ms 재시도 성공`);
      sendDebugNotification('patchLocation 재시도 성공', `+${elapsed}ms`).catch(() => {});
      return result;
    } catch (e2: any) {
      const elapsed = Date.now() - t0;
      const failMsg2 = e2?.message ?? String(e2);
      dlog('POLLING', `[patchLocation] +${elapsed}ms 재시도도 실패(${failMsg2})`);
      sendDebugNotification('patchLocation 재시도도 실패', `+${elapsed}ms ${failMsg2}`).catch(() => {});
      throw e2;
    }
  }
}

// 활성 추적 대상(ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY) 중 DESIRED_INTERVALS_KEY에 저장된
// 서버 지시값의 최솟값을 ms로 반환한다 — 여러 알람을 동시에 추적 중이면 가장 급한 쪽 기준으로
// 네이티브 GPS 구독 자체의 주기를 맞춰야 한다(개별 key의 실제 /location 호출 스킵 여부는
// 헤드리스 틱 안의 elapsed 체크가 이미 별도로 담당 — 이 함수는 "네이티브가 얼마나 자주
// 깨어나야 하는가"만 결정). 대상이 없으면 기본값(30초)으로 폴백.
async function getMinDesiredIntervalMs(): Promise<number> {
  const [journeysRaw, appointmentsRaw, desiredRaw] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY),
    AsyncStorage.getItem(DESIRED_INTERVALS_KEY),
  ]);
  const journeyIds: number[] = journeysRaw ? JSON.parse(journeysRaw) : [];
  const appointmentIds: number[] = appointmentsRaw ? JSON.parse(appointmentsRaw) : [];
  const desired: Record<string, number> = desiredRaw ? JSON.parse(desiredRaw) : {};
  const keys = [...journeyIds.map((id) => `j_${id}`), ...appointmentIds.map((id) => `a_${id}`)];
  if (keys.length === 0) return BACKGROUND_LOCATION_TIME_INTERVAL_MS;
  const perKey = keys.map((k) => `${k}:${desired[k] ?? 30}s`);
  const minSeconds = Math.min(...keys.map((k) => desired[k] ?? 30));
  // 알람이 여러 개 동시에 추적 중일 때 "어느 key가 최솟값을 만들었는지"가 startGpsPolling()의
  // 최종 로그(timeInterval:Nms)만으론 안 보여서, 계산 근거 자체를 여기서 남겨둔다.
  dlog('POLLING', `[getMinDesiredIntervalMs] ${perKey.join(', ')} → 최소:${minSeconds}s`);
  return minSeconds * 1000;
}

let _startingLocationUpdates = false; // startGpsPolling 동시 호출 race condition 방지

// start/stopAlarmForegroundService 둘 다 "AsyncStorage에서 현재 상태 읽기 → 판단 → 쓰기"
// 구조라, 서로 다른 두 호출부(예: alarmService.stop()의 onFinish와 startReadyAlarms()의
// syncForegroundService())가 수 ms 안에 겹치면 둘 다 "아직 안 바뀐" 값을 읽어버려 방어 코드
// (이미 꺼져있으면 skip)를 무력화한다 — 실기기로 "FGS 꺼짐" 알림이 한 번의 도착 확인에
// 두 번 뜨는 것으로 확인됨(2026-08-17). withNavInfoLock/withIntervalsLock과 동일한 패턴으로
// 직렬화해서 두 함수 중 하나만 항상 동시에 실행되게 한다.
let fgsLockQueue: Promise<void> = Promise.resolve();
function withFgsLock(fn: () => Promise<void>): Promise<void> {
  const run = fgsLockQueue.then(fn, fn);
  fgsLockQueue = run.catch(() => {});
  return run;
}

// FGS(상단바 알림)만 켠다/끈다 — GPS는 전혀 안 건드린다(modules/foreground-service, Stage 1에서
// 실기기로 격리 검증 완료: FGS 시작 중 GPS 요청 0건, 강제종료해도 좀비 알림 없음).
export function startAlarmForegroundService(): Promise<void> {
  return withFgsLock(startAlarmForegroundServiceInternal);
}

async function startAlarmForegroundServiceInternal(): Promise<void> {
  // Foreground Service는 포그라운드 상태에서만 시작 가능(Android 정책) — 이건 어느 API로
  // 시작하든 동일한 OS 레벨 제약이라 새 모듈에도 그대로 적용된다.
  if (AppState.currentState !== 'active') {
    dlog('POLLING', '[startAlarmForegroundService] 백그라운드 상태 — skip');
    return;
  }
  const fgsActive = (await AsyncStorage.getItem(LOCATION_FGS_ACTIVE_KEY).catch(() => null)) === '1';
  if (fgsActive) {
    dlog('POLLING', '[startAlarmForegroundService] 이미 실행 중 — skip');
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
    dlog('POLLING', '[startAlarmForegroundService] 위치 권한 미승인 — FGS 시작 skip');
    return;
  }
  ForegroundService.start('GoNow 알람 실행 중', '출발 시간을 모니터링하고 있어요.');
  await AsyncStorage.setItem(LOCATION_FGS_ACTIVE_KEY, '1');
  dlog('POLLING', '[startAlarmForegroundService] 완료 — 상단바 알림 표시됨');
  dlog('FGS', 'startAlarmForegroundService — 실제로 켬');
  sendDebugNotification('FGS 켜짐', 'ForegroundService.start() 성공').catch(() => {});
}

export function stopAlarmForegroundService(): Promise<void> {
  return withFgsLock(stopAlarmForegroundServiceInternal);
}

async function stopAlarmForegroundServiceInternal(): Promise<void> {
  const fgsActive = (await AsyncStorage.getItem(LOCATION_FGS_ACTIVE_KEY).catch(() => null)) === '1';
  if (!fgsActive) {
    dlog('POLLING', '[stopAlarmForegroundService] 이미 중지됨 — skip');
    dlog('FGS', 'stopAlarmForegroundService 호출됐지만 이미 꺼져있어 스킵(알림 안 뜸)');
    return;
  }
  ForegroundService.stop();
  await AsyncStorage.removeItem(LOCATION_FGS_ACTIVE_KEY).catch(() => {});
  dlog('POLLING', '[stopAlarmForegroundService] 완료 — 상단바 알림 제거됨');
  dlog('FGS', 'stopAlarmForegroundService — 실제로 끔(알림 뜸)');
  sendDebugNotification('FGS 꺼짐', 'ForegroundService.stop() 호출').catch(() => {});
}

// GPS 위치 구독만 켠다/끈다 — FGS(상단바 알림)는 전혀 안 건드린다. foregroundService 옵션을
// 절대 안 쓰므로(FGS는 이제 startAlarmForegroundService()가 완전히 독립적으로 담당),
// hasStartedLocationUpdatesAsync() 하나로 실행 여부 판단이 충분하다 — 예전에 있던 "FGS 없는
// 구독 발견 시 stop→재시작(승격)" 로직은 이제 개념 자체가 사라져 필요 없다(과거
// ForegroundServiceDidNotStartInTimeException 크래시 전례가 있던 위험한 패턴이었음).
// 2026-08-14(버그3/8): timeInterval을 하드코딩된 30초 대신 getMinDesiredIntervalMs()로 동적
// 계산한다. 이미 실행 중이어도 등록된 값(CURRENT_GPS_INTERVAL_KEY)과 새로 계산한 값이
// 다르면 stop→restart — FGS와 완전히 분리된 순수 GPS 구독이라 이 재시작이 어느 컨텍스트
// (포그라운드/백그라운드/헤드리스)에서 불려도 안전하다(예전 크래시는 FGS 포함 구독을
// 백그라운드에서 재시작하려다 난 것 — 지금은 그 조합 자체가 없음).
export async function startGpsPolling(): Promise<void> {
  if (_startingLocationUpdates) {
    dlog('POLLING', '[startGpsPolling] 시작 중 — skip');
    return;
  }
  _startingLocationUpdates = true;
  try {
    const desiredMs = await getMinDesiredIntervalMs();
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (isRunning) {
      const currentMs = Number((await AsyncStorage.getItem(CURRENT_GPS_INTERVAL_KEY).catch(() => null)) ?? '0');
      if (currentMs === desiredMs) {
        dlog('POLLING', `[startGpsPolling] 이미 실행 중(interval:${desiredMs}ms 동일) — skip`);
        return;
      }
      dlog('POLLING', `[startGpsPolling] interval 변경 감지(${currentMs}ms → ${desiredMs}ms) — 재시작`);
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      // 2026-08-14: 이 시점은 "OS에 구독을 등록/재등록"한 순간일 뿐 실제 GPS 호출과는 무관해서
      // (포그라운드↔백그라운드를 오갈 때마다 매번 뜨는 게 오히려 헷갈린다는 실사용 피드백으로
      // 확인) 알림은 제거하고 로그만 남긴다. 실제 호출 시점 알림은 아래 patchLocation 응답
      // 처리 지점(이 파일의 헤드리스 틱, alarmService.ts의 poll)에서 따로 남긴다.
    } else {
      dlog('POLLING', `[startGpsPolling] 시작(timeInterval:${desiredMs}ms)`);
    }
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: desiredMs,
      distanceInterval: 0,
    });
    await AsyncStorage.setItem(CURRENT_GPS_INTERVAL_KEY, String(desiredMs));
  } finally {
    _startingLocationUpdates = false;
  }
}

export async function stopGpsPolling(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    dlog('POLLING', '[stopGpsPolling] 이미 중지됨 — skip');
    return;
  }
  dlog('POLLING', '[stopGpsPolling] 중지');
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
  await AsyncStorage.removeItem(CURRENT_GPS_INTERVAL_KEY).catch(() => {});
}

// ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY와 AppState를 다시 읽어 "지금 GPS 폴링이
// 실제로 필요한가"를 재판단하고 그에 맞게 시작/중지한다(FGS는 안 건드림 —
// hasAnyTrackedAlarm() 기준의 별도 판단과 완전히 분리).
// 2026-08-14(버그8): 포그라운드에서는 alarmService.ts의 AlarmRunner가 GPS 획득을 전담하므로
// (자체 JS 타이머 + getCurrentPositionAsync() 단발 요청 — 포그라운드에서는 JS 타이머가
// 신뢰할 수 있어 이 방식으로 충분하다), 네이티브 구독을 같이 켜두면 GPS 칩이 이중으로
// 깨어난다. 그래서 AppState.currentState === 'active'면 추적 대상 존재 여부와 무관하게
// 무조건 끈다 — 이게 이 함수가 양방향(시작/중지)인 이유이자 핵심 로직이다.
// 백그라운드에서는 반대로 JS 타이머가 신뢰할 수 없어서(XMLHttpRequest.timeout 관련 조사로
// 실측 확인, docs/history/resolved-bugs.md "2026-08-13" 참고) 네이티브 구독이 유일하게
// 신뢰할 수 있는 폴링 수단이라, 추적 대상이 있으면 켠다(interval은 startGpsPolling() 내부의
// getMinDesiredIntervalMs()가 서버 지시값 기준으로 동적 계산).
// 2026-08-14(재검토, 실기기로 발견): resumeIfDue()가 "이 key가 NEARDEST인가"를 판단할 때
// AlarmRunner.status(포그라운드 러너의 메모리 값)를 썼는데, NEARDEST를 백그라운드 헤드리스
// 틱이 먼저 감지한 경우(걸어서 이동 중이면 흔함) 그 값이 갱신 안 돼서 지오펜스 전담 구간인데도
// 포그라운드 복귀 시 재폴링해버리는 문제가 있었다. 신뢰할 수 있는 단일 진실 공급원은 어디서나
// 이미 쓰는 ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY 멤버십이라 이걸로 판단하게 한다 —
// NEARDEST 진입 시 removeActiveId()가 포그라운드/백그라운드 어느 쪽이 감지했든 항상 일어나는
// 유일하게 일관된 신호다.
export async function isKeyActivelyTracked(key: string): Promise<boolean> {
  const [journeysRaw, appointmentsRaw] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY),
  ]);
  const journeyIds: number[] = journeysRaw ? JSON.parse(journeysRaw) : [];
  const appointmentIds: number[] = appointmentsRaw ? JSON.parse(appointmentsRaw) : [];
  if (key.startsWith('j_')) return journeyIds.includes(Number(key.slice(2)));
  if (key.startsWith('a_')) return appointmentIds.includes(Number(key.slice(2)));
  return false;
}

export async function maybeSyncGpsPolling(): Promise<void> {
  if (AppState.currentState === 'active') {
    dlog('POLLING', '[maybeSyncGpsPolling] 포그라운드 — 네이티브 구독 중단(AlarmRunner 전담)');
    await stopGpsPolling();
    return;
  }
  const [journeysRaw, appointmentsRaw] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY),
  ]);
  const journeyIds: number[] = journeysRaw ? JSON.parse(journeysRaw) : [];
  const appointmentIds: number[] = appointmentsRaw ? JSON.parse(appointmentsRaw) : [];
  if (journeyIds.length === 0 && appointmentIds.length === 0) {
    dlog('POLLING', '[maybeSyncGpsPolling] 폴링 대상 없음 → GPS 폴링 중단');
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
  dlog('POLLING', `[BackgroundLocation] 태스크 발화 @ ${ts}`);
  if (error) {
    dlog('POLLING', `[BackgroundLocation] 에러: ${JSON.stringify(error)}`);
    return;
  }
  if (_taskRunning) {
    dlog('POLLING', '[BackgroundLocation] 이전 태스크 실행 중 — skip');
    return;
  }
  _taskRunning = true;
  try {
  // init() 완료 전이면 이전 세션 데이터가 남아있을 수 있으므로 skip
  const sessionReady = await AsyncStorage.getItem(SESSION_READY_KEY);
  if (sessionReady !== '1') {
    dlog('POLLING', '[BackgroundLocation] 세션 미준비 — init() 완료 전 skip');
    return;
  }
  // 포그라운드 상태면 alarmService가 폴링 담당 → 백그라운드 태스크는 skip
  if (AppState.currentState === 'active') {
    dlog('POLLING', '[BackgroundLocation] 포그라운드 상태 — alarmService가 처리하므로 skip');
    return;
  }
  const { locations } = data as { locations: Location.LocationObject[] };
  const loc = locations?.[0];
  if (!loc) {
    dlog('POLLING', '[BackgroundLocation] 위치 데이터 없음 — skip');
    return;
  }

  const { latitude: lat, longitude: lng } = loc.coords;
  dlog('POLLING', `[BackgroundLocation] GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`);

  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) {
    dlog('POLLING', '[BackgroundLocation] 토큰 없음 — skip');
    return;
  }

  const [journeysRaw, appointmentsRaw] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY),
  ]);

  const journeyIds: number[] = journeysRaw ? JSON.parse(journeysRaw) : [];
  const appointmentIds: number[] = appointmentsRaw ? JSON.parse(appointmentsRaw) : [];

  dlog('POLLING', `[BackgroundLocation] 활성 IDs — journeys:${journeyIds} appointments:${appointmentIds}`);

  if (journeyIds.length === 0 && appointmentIds.length === 0) {
    dlog('POLLING', '[BackgroundLocation] 폴링 대상 ID 없음 → GPS 폴링 중단');
    await stopGpsPolling();
    if (await hasAnyTrackedAlarm()) {
      dlog('POLLING', '[BackgroundLocation] NEARDEST 등으로 대기 중인 알람이 있어 FGS 유지');
    } else {
      dlog('POLLING', '[BackgroundLocation] 추적 중인 알람 자체가 없음 → FGS도 종료');
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
  // 2026-08-14: LAST_CALL_TIMES_KEY도 이제 alarmService.ts(포그라운드)가 같이 읽으므로
  // (위 withLastCallTimesLock 주석 참고) 같은 이유로 델타만 모아뒀다가 병합해서 쓴다.
  const lastCallTimeSets: Record<string, number> = {};
  const lastCallTimeDeletes = new Set<string>();

  await Promise.all([
    ...journeyIds.map(async (id) => {
      const key = `j_${id}`;

      const intervalMs = (desiredIntervals[key] ?? 30) * 1000;
      const elapsed = now - (lastCallTimes[key] ?? 0);
      if (elapsed < intervalMs) {
        dlog('POLLING', `[백그라운드] journeyId:${id} interval 미달 (${Math.round(elapsed/1000)}s / ${Math.round(intervalMs/1000)}s) — skip`);
        remainingJourneys.push(id);
        return;
      }
      // 위 elapsed 체크는 틱 시작 시점의 스냅샷 기준이라, 그 사이(대개 GPS 픽스 대기 중) 포그라운드
      // 쪽이 이미 호출했을 수 있다 — 실제 호출 직전에 최신 값으로 한 번 더 확인한다.
      const freshLastCall = await getLastCallTime(key);
      if (freshLastCall > 0 && now - freshLastCall < DUPLICATE_CALL_GUARD_MS) {
        dlog('POLLING', `[백그라운드] journeyId:${id} 최근 ${DUPLICATE_CALL_GUARD_MS / 1000}초 내 이미 호출됨(포그라운드) — 중복 스킵`);
        remainingJourneys.push(id);
        return;
      }
      lastCallTimes[key] = now;
      lastCallTimeSets[key] = now;
      lastCallTimeDeletes.delete(key);
      // 2026-08-14(재검토, 잔여 경쟁 제거): 이 값은 원래 틱이 다 끝난 뒤 한꺼번에(delta 병합으로)
      // 저장됐는데, 그 사이(포그라운드가 자기 GPS 픽스를 기다리는 몇 초 동안) alarmService.ts의
      // 중복 가드가 아직 저장 안 된 값을 읽어 못 보고 지나칠 아주 좁은 이론적 틈이 있었다.
      // 실기기로 재현된 적은 없지만(포그라운드 콜드 픽스가 훨씬 느려서 실질적으로 안전했음),
      // 호출을 실제로 시작하는 이 시점에 바로 한 번 더 기록해 그 틈 자체를 없앤다 — 아래
      // 델타 병합 저장과 값이 같아 중복 저장이어도 무해하다.
      setLastCallTime(key, now).catch(() => {});

      try {
        dlog('POLLING', `/location 호출 — journeyId:${id}`);
        const res = await patchLocation(`/api/journeys/${id}/location`, token, lat, lng);
        const { journey_status, preparation_time, journey_type, dest_name, which_station, interval, departure_alarm_time } = res?.data ?? {};
        dlog('POLLING', `/location 응답 — journeyId:${id} status:${journey_status} interval:${interval}`);
        const type: AlarmType = journey_type === 'HOME' ? 'home' : 'personal';

        if (interval != null) {
          const effectiveInterval = DEBUG_FORCE_INTERVAL_SEC ?? interval;
          dlog('POLLING', `[백그라운드] interval 갱신 — journeyId:${id} → ${effectiveInterval}s${DEBUG_FORCE_INTERVAL_SEC != null ? `(서버값 ${interval}s 무시, 테스트 강제)` : ''}`);
          desiredIntervals[key] = effectiveInterval;
          intervalSets[key] = effectiveInterval;
          intervalDeletes.delete(key);
        }
        // 2026-08-14: 등록 시점 알림 대신, 실제 호출이 성공한 이 시점에 "다음 호출까지 약
        // N초"를 알려주는 게 더 직관적이다(사용자 피드백) — 다음 호출 예정 간격은 방금 받은
        // 새 값(있으면) 또는 이미 알고 있던 값(desiredIntervals[key], 없으면 기본 30초).
        // 2026-08-14(사용자 요청): 서버가 실제로 준 값도 함께 보여준다(interval: 서버값 →
        // 적용값초) — DEBUG_FORCE_INTERVAL_SEC로 강제 중일 때 서버 원본값을 가리지 않기 위함.
        sendDebugNotification('GPS 호출 완료(백그라운드)', `journeyId:${id} status:${journey_status} interval: ${interval != null ? interval : '유지'} → ${desiredIntervals[key] ?? 30}초`).catch(() => {});

        // 2026-08-17(Phase 3): READY도 추가 — READY 지오펜스 전환 직전(최초이자 유일하게 이
        // 분기를 타는 시점)에 departureAlarmTime이 이미 확정돼 있으면 단계별 알람을 미리
        // 등록해야 한다(포그라운드 handlePersonalStatus의 READY 분기와 동일한 이유 — 단계별
        // 알람은 departureAlarmTime "도달 전"에 미리 울려야 하므로 DEPARTING까지 기다리면 늦음).
        if ((journey_status === 'DEPARTING' || journey_status === 'NEARDEST' || journey_status === 'READY') && departure_alarm_time) {
          dlog('POLLING', `[백그라운드] ${journey_status} — journeyId:${id} 단계별 알람 동기화`);
          const nav = navInfo[key];
          await syncStagedAlarms(key, type, dest_name, id, undefined, preparation_time ?? 0, which_station, departure_alarm_time, nav?.destLat, nav?.destLng, nav?.transportMode, nav?.isLastMode);
        }

        if (journey_status === 'ARRIVED') {
          const parking = isRepeatingJourney(navInfo[key]?.repeatDays);
          dlog('POLLING', `ARRIVED — journeyId:${id} ${parking ? '반복 여정 — 다음 회차까지 nav info 유지(파킹, 버그45)' : 'ID 제거 (폴링이 확정)'}`);
          // 이 태스크는 AppState가 active면 최상단에서 이미 return하지만(위 참고), 프로세스
          // 자체는 살아있을 수 있다(스와이프만 한 흔한 케이스) — 그러면 AlarmManager.runners에
          // 좀비 러너가 남아 다음 회차 진입 시 isRunning()이 잘못 true를 반환해서 새 러너
          // 시작이 스킵될 수 있다(notifications.ts/departingGeofenceTask.ts/backgroundAlarmTask.ts
          // 는 이미 forgetIfExists()로 방어 중이었는데 정작 최초로 파킹을 구현한 이 지점이
          // 빠져 있었음 — 2026-08-18 코드 리뷰 중 발견). 진짜 헤드리스면 조용히 no-op.
          import('@/src/services/alarmService')
            .then(({ alarmService }) => alarmService.forgetIfExists(id, undefined))
            .catch(() => {});
          // 2026-08-14(재검토): 지금 상태머신상 SCHEDULED에서 생성 직후 첫 폴링만으로 바로
          // ARRIVED에 도달하는 경로는 없어서(반드시 NEARDEST를 거침) 지금은 안전하지만, NEARDEST
          // 분기와 같은 이유로 lastCallTimes는 여기서도 안 지운다 — 나중에 상태머신이 바뀌어
          // 생성 직후 바로 ARRIVED 도달이 가능해지면 같은 경쟁이 재현될 수 있는 패턴이라 미리
          // 통일해둔다(위 NEARDEST 분기 주석 참고).
          delete desiredIntervals[key];
          intervalDeletes.add(key);
          delete intervalSets[key];
          if (!parking) {
            removeAlarmNavInfo(key).catch(() => {});
          }
          removeActiveId(id, undefined).catch(() => {});
          // MOVING 보조 지오펜스가 등록돼 있었을 수 있다 — 폴링이 지오펜스보다 먼저 ARRIVED를
          // 확정한 경합 상황(2026-08-17 실기기 테스트로 지적됨)에서, 폴링만 정리하고 지오펜스
          // 등록을 그대로 방치하면 이미 끝난 여정에 대한 지오펜스가 기기에 계속 남는다.
          exitMovingGeofenceMode(key).catch(() => {});
        } else if (journey_status === 'NEARDEST' && Platform.OS === 'android') {
          dlog('POLLING', `NEARDEST — journeyId:${id} 지오펜스로 전환, 폴링 중단`);
          // 2026-08-14(재검토, 실기기로 발견): 예전엔 여기서 lastCallTimes[key]도 지웠는데,
          // 생성 직후 경쟁에서 이 틱이 먼저 NEARDEST를 확인하고 방금 자기가 기록한 값을 곧바로
          // 지워버리면, 아직 자기 GPS 픽스를 기다리느라 느린 포그라운드 쪽이 뒤늦게 중복 가드를
          // 확인할 때 "호출 기록 없음"으로 오판해 똑같은 alarm에 또 실제 호출을 만드는 문제가
          // 실기기로 재현됐다(귀가 알람을 목적지 100m 이내에서 생성한 테스트). 이 값은 지워도
          // desiredIntervals와 달리 안 지운다고 해를 끼치지 않는다 — NEARDEST 진입 후 이 key는
          // ACTIVE_JOURNEYS_KEY에서 빠져서 elapsed 체크 쪽에서 아무도 안 읽고, 남은 유일한
          // 소비자인 중복 가드 입장에선 오히려 남겨두는 쪽이 안전하다. ARRIVED/삭제 시에는
          // 기존대로 정상적으로 지워진다.
          // desiredIntervals[key]는 여기서도 안 지운다 — NEARDEST 동안은 폴링 대상 목록에서
          // 빠져있어 아무도 안 읽으므로 무해하다. 2026-08-13엔 EXIT 지점(nearDestGeofenceTask.ts의
          // fallbackToPolling())에서 clearDesiredInterval()로 무조건 지우도록 했었는데, 그건
          // NEARDEST 자체가 아직 짧은 interval을 못 받던 시절의 임시방편이었다 — 이후 NEARDEST가
          // 서버로부터 이미 짧은 interval(30~120초)을 받도록 개선되면서 그 초기화가 오히려
          // "EXIT 직후 서버가 interval:null(변경 없음)로 응답하면 복구가 안 돼 백그라운드가 30초에
          // 영구히 갇히는" 부작용만 남겨서 2026-08-14 재검토 때 제거했다(위 lastCallTimes 주석과
          // 같은 클래스의 문제). 지금은 아무도 이 값을 지우지 않고, NEARDEST 시절의 마지막 값을
          // EXIT 이후에도 그대로 이어받는다 — 어차피 짧은 값이라 재진입 감지에도 문제없다.
          // READY 지오펜스가 등록돼 있었을 수 있어 방어적으로 먼저 정리(멱등이라 등록 안 돼있으면 무해).
          await exitReadyGeofenceMode(key).catch(() => {});
          await enterNearDestGeofenceMode(key, navInfo[key]?.destLat, navInfo[key]?.destLng, navInfo[key]?.destination);
          removeActiveId(id, undefined).catch(() => {});
        } else if (journey_status === 'DEPARTING' && Platform.OS === 'android') {
          dlog('POLLING', `DEPARTING — journeyId:${id} 지오펜스로 전환, 폴링 중단`);
          // 앵커 근사치 근거는 departingGeofenceTask.ts의 enterDepartingGeofenceMode() 주석 참고
          // — 이 호출에 실제로 보낸 좌표(lat,lng)를 앵커로 씀.
          await exitReadyGeofenceMode(key).catch(() => {});
          await enterDepartingGeofenceMode(key, lat, lng, navInfo[key]?.destLat, navInfo[key]?.destLng);
          removeActiveId(id, undefined).catch(() => {});
        } else if (journey_status === 'MOVING') {
          // MOVING은 폴링 유지(실시간 ETA 계산 필요) — 목적지 100m ENTER 보조 지오펜스만 추가
          // 등록(Phase 2, 안드로이드 전용 — iOS는 폴링만으로 커버). enterMovingGeofenceMode()가
          // 내부적으로 이미 등록됐는지 확인하므로 매 폴링 틱마다 호출해도 안전(두 번째부터는 내부에서 조용히 skip).
          dlog('POLLING', `MOVING — journeyId:${id} 폴링 유지, 보조 지오펜스 확인/등록`);
          if (Platform.OS === 'android') {
            await enterMovingGeofenceMode(key, navInfo[key]?.destLat, navInfo[key]?.destLng);
          }
          remainingJourneys.push(id);
        } else if (journey_status === 'READY' && Platform.OS === 'android') {
          // READY — 지오펜싱으로 감시 이관(Phase 3, 안드로이드 전용). 방금 이 틱에서 실제로
          // 보낸 좌표(lat,lng)를 앵커로 등록 — 근사치 문제 없음(정확한 GPS 판독값).
          dlog('POLLING', `READY — journeyId:${id} 지오펜스로 전환, 폴링 중단`);
          await enterReadyGeofenceMode(key, lat, lng, navInfo[key]?.destLat, navInfo[key]?.destLng);
          removeActiveId(id, undefined).catch(() => {});
        } else {
          remainingJourneys.push(id);
        }
      } catch (e: any) {
        if (e?.message?.startsWith('HTTP 4')) {
          dlog('POLLING', `[백그라운드] journeyId:${id} 서버 ${e.message} → ID 제거 (삭제된 알람)`);
          delete lastCallTimes[key];
          lastCallTimeDeletes.add(key);
          delete lastCallTimeSets[key];
          delete desiredIntervals[key];
          intervalDeletes.add(key);
          delete intervalSets[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(id, undefined).catch(() => {});
          exitMovingGeofenceMode(key).catch(() => {}); // 삭제된 알람에 대한 MOVING 지오펜스 방치 방지(위 ARRIVED 분기와 동일 이유)
        } else {
          dlog('POLLING', `[백그라운드] journeyId:${id} 네트워크 오류 → 다음 주기 재시도 error:${e?.message}`);
          remainingJourneys.push(id);
        }
      }
    }),
    ...appointmentIds.map(async (id) => {
      const key = `a_${id}`;

      const intervalMs = (desiredIntervals[key] ?? 30) * 1000;
      const elapsed = now - (lastCallTimes[key] ?? 0);
      if (elapsed < intervalMs) {
        dlog('POLLING', `[백그라운드] appointmentId:${id} interval 미달 (${Math.round(elapsed/1000)}s / ${Math.round(intervalMs/1000)}s) — skip`);
        remainingAppointments.push(id);
        return;
      }
      // journeyIds 루프와 동일 — 틱 시작 시점 스냅샷 이후 포그라운드가 이미 호출했을 수 있어
      // 실제 호출 직전에 최신 값으로 한 번 더 확인한다.
      const freshLastCall = await getLastCallTime(key);
      if (freshLastCall > 0 && now - freshLastCall < DUPLICATE_CALL_GUARD_MS) {
        dlog('POLLING', `[백그라운드] appointmentId:${id} 최근 ${DUPLICATE_CALL_GUARD_MS / 1000}초 내 이미 호출됨(포그라운드) — 중복 스킵`);
        remainingAppointments.push(id);
        return;
      }
      lastCallTimes[key] = now;
      lastCallTimeSets[key] = now;
      lastCallTimeDeletes.delete(key);
      // journeyIds 루프와 동일 — 잔여 경쟁 제거(위 주석 참고).
      setLastCallTime(key, now).catch(() => {});

      try {
        dlog('POLLING', `/location 호출 — appointmentId:${id}`);
        const res = await patchLocation(`/api/appointments/${id}/participants/location`, token, lat, lng);
        const { participant_status, preparation_time, dest_name, which_station, interval, departure_alarm_time } = res?.data ?? {};
        dlog('POLLING', `/location 응답 — appointmentId:${id} status:${participant_status} interval:${interval}`);

        if (interval != null) {
          const effectiveInterval = DEBUG_FORCE_INTERVAL_SEC ?? interval;
          dlog('POLLING', `[백그라운드] interval 갱신 — appointmentId:${id} → ${effectiveInterval}s${DEBUG_FORCE_INTERVAL_SEC != null ? `(서버값 ${interval}s 무시, 테스트 강제)` : ''}`);
          desiredIntervals[key] = effectiveInterval;
          intervalSets[key] = effectiveInterval;
          intervalDeletes.delete(key);
        }
        sendDebugNotification('GPS 호출 완료(백그라운드)', `appointmentId:${id} status:${participant_status} interval: ${interval != null ? interval : '유지'} → ${desiredIntervals[key] ?? 30}초`).catch(() => {});

        // 2026-08-17(Phase 3): READY도 추가 — 위 journey_status 분기와 동일한 이유.
        if ((participant_status === 'DEPARTING' || participant_status === 'NEARDEST' || participant_status === 'READY') && departure_alarm_time) {
          dlog('POLLING', `[백그라운드] ${participant_status} — appointmentId:${id} 단계별 알람 동기화`);
          const nav = navInfo[key];
          await syncStagedAlarms(key, 'group', dest_name, undefined, id, preparation_time ?? 0, which_station, departure_alarm_time, nav?.destLat, nav?.destLng, nav?.transportMode, nav?.isLastMode);
        }

        if (participant_status === 'ARRIVED') {
          dlog('POLLING', `ARRIVED — appointmentId:${id} ID 제거 (폴링이 확정)`);
          // journey_status ARRIVED 분기와 동일 이유 — 좀비 러너 방지(2026-08-18 코드 리뷰 발견).
          import('@/src/services/alarmService')
            .then(({ alarmService }) => alarmService.forgetIfExists(undefined, id))
            .catch(() => {});
          // lastCallTimes는 여기서 안 지운다 — 이유는 위 journey_status ARRIVED 분기 주석 참고.
          delete desiredIntervals[key];
          intervalDeletes.add(key);
          delete intervalSets[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(undefined, id).catch(() => {});
          // 폴링이 지오펜스보다 먼저 ARRIVED를 확정한 경합 상황 대비 — 위 journey_status
          // ARRIVED 분기와 동일 이유.
          exitMovingGeofenceMode(key).catch(() => {});
        } else if (participant_status === 'NEARDEST' && Platform.OS === 'android') {
          dlog('POLLING', `NEARDEST — appointmentId:${id} 지오펜스로 전환, 폴링 중단`);
          // lastCallTimes[key]는 여기서 안 지운다 — 이유는 위 journey_status NEARDEST 분기
          // 주석 참고(생성 직후 경쟁에서 중복 호출을 만들던 실기기 재현 버그).
          // desiredIntervals[key]는 여기서 안 지운다 — 이유는 위 journey_status NEARDEST
          // 분기 주석 참고(fallbackToPolling()에서 통일해서 지움).
          await exitReadyGeofenceMode(key).catch(() => {});
          await enterNearDestGeofenceMode(key, navInfo[key]?.destLat, navInfo[key]?.destLng, navInfo[key]?.destination);
          removeActiveId(undefined, id).catch(() => {});
        } else if (participant_status === 'DEPARTING' && Platform.OS === 'android') {
          dlog('POLLING', `DEPARTING — appointmentId:${id} 지오펜스로 전환, 폴링 중단`);
          await exitReadyGeofenceMode(key).catch(() => {});
          await enterDepartingGeofenceMode(key, lat, lng, navInfo[key]?.destLat, navInfo[key]?.destLng);
          removeActiveId(undefined, id).catch(() => {});
        } else if (participant_status === 'MOVING') {
          dlog('POLLING', `MOVING — appointmentId:${id} 폴링 유지, 보조 지오펜스 확인/등록`);
          if (Platform.OS === 'android') {
            await enterMovingGeofenceMode(key, navInfo[key]?.destLat, navInfo[key]?.destLng);
          }
          remainingAppointments.push(id);
        } else if (participant_status === 'READY' && Platform.OS === 'android') {
          dlog('POLLING', `READY — appointmentId:${id} 지오펜스로 전환, 폴링 중단`);
          await enterReadyGeofenceMode(key, lat, lng, navInfo[key]?.destLat, navInfo[key]?.destLng);
          removeActiveId(undefined, id).catch(() => {});
        } else {
          remainingAppointments.push(id);
        }
      } catch (e: any) {
        if (e?.message?.startsWith('HTTP 4')) {
          dlog('POLLING', `[백그라운드] appointmentId:${id} 서버 ${e.message} → ID 제거 (삭제된 알람)`);
          await cancelStagedAlarms(key);
          delete lastCallTimes[key];
          lastCallTimeDeletes.add(key);
          delete lastCallTimeSets[key];
          delete desiredIntervals[key];
          intervalDeletes.add(key);
          delete intervalSets[key];
          removeAlarmNavInfo(key).catch(() => {});
          removeActiveId(undefined, id).catch(() => {});
          exitMovingGeofenceMode(key).catch(() => {}); // 삭제된 알람에 대한 MOVING 지오펜스 방치 방지(위 ARRIVED 분기와 동일 이유)
        } else {
          dlog('POLLING', `[백그라운드] appointmentId:${id} 네트워크 오류 → 다음 주기 재시도 error:${e?.message}`);
          remainingAppointments.push(id);
        }
      }
    }),
  ]);

  // ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY는 위에서 개별 removeActiveId()로 이미 최신화됨
  // — 여기서 remainingJourneys/remainingAppointments로 통째 덮어쓰면, 이 틱이 도는 동안 다른
  // 경로(지오펜스 폴백 등)가 새로 추가한 ID를 유실시킬 수 있어 의도적으로 안 씀.
  // LAST_CALL_TIMES_KEY/DESIRED_INTERVALS_KEY 둘 다 alarmService.ts(포그라운드)도 같이
  // 건드리므로(2026-08-14, 버그3/8) 위 withLastCallTimesLock/withIntervalsLock으로 최신 상태를
  // 다시 읽어 이 틱이 실제로 바꾼 key만 병합해서 쓴다(통째 덮어쓰면 그 사이 다른 컨텍스트의
  // 갱신을 되살릴 위험이 있음 — DESIRED_INTERVALS_KEY에서 이미 겪은 것과 같은 클래스의 문제).
  await Promise.all([
    withLastCallTimesLock(async () => {
      const raw = await AsyncStorage.getItem(LAST_CALL_TIMES_KEY);
      const fresh: Record<string, number> = raw ? JSON.parse(raw) : {};
      for (const [k, v] of Object.entries(lastCallTimeSets)) fresh[k] = v;
      for (const k of lastCallTimeDeletes) delete fresh[k];
      await AsyncStorage.setItem(LAST_CALL_TIMES_KEY, JSON.stringify(fresh));
    }),
    withIntervalsLock(async () => {
      const raw = await AsyncStorage.getItem(DESIRED_INTERVALS_KEY);
      const fresh: Record<string, number> = raw ? JSON.parse(raw) : {};
      for (const [k, v] of Object.entries(intervalSets)) fresh[k] = v;
      for (const k of intervalDeletes) delete fresh[k];
      await AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(fresh));
    }),
  ]);

  dlog('POLLING', `[BackgroundLocation] 처리 완료 — 남은 journeys:${remainingJourneys} appointments:${remainingAppointments}`);

  if (remainingJourneys.length === 0 && remainingAppointments.length === 0) {
    dlog('POLLING', '[BackgroundLocation] 폴링 대상 소진 → GPS 폴링 중단');
    await stopGpsPolling();
    if (await hasAnyTrackedAlarm()) {
      dlog('POLLING', '[BackgroundLocation] 폴링 대상은 없지만 NEARDEST 등으로 대기 중인 알람이 있어 FGS 유지');
    } else {
      dlog('POLLING', '[BackgroundLocation] 모든 알람 완료 → FGS도 종료');
      await stopAlarmForegroundService();
    }
  } else if (Object.keys(intervalSets).length > 0) {
    // 이 틱에서 interval이 바뀐 key가 있었으면 네이티브 구독의 등록값도 최신으로 맞춘다
    // (startGpsPolling() 내부에서 실제로 값이 다를 때만 재시작하므로 매번 불러도 안전 —
    // 버그3: 이게 없으면 서버가 새 interval을 줘도 다음 앱 재시작/전환 전까지 반영 안 됨).
    dlog('POLLING', '[BackgroundLocation] interval 변경 감지 — GPS 구독 재동기화');
    await startGpsPolling();
  }
  } finally {
    _taskRunning = false;
  }
});
