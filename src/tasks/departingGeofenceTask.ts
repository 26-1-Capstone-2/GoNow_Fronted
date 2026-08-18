import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { TOKEN_KEY } from '@/src/store/authStore';
import { sendDebugNotification, cancelStagedAlarms } from '@/src/utils/notifications';
import { dlog } from '@/src/utils/deviceLogger';
import {
  SESSION_READY_KEY,
  ALARM_NAV_INFO_KEY,
  patchLocation,
  addActiveId,
  removeActiveId,
  removeOrParkAlarmNavInfo,
  startGpsPolling,
} from '@/src/tasks/backgroundLocationTask';

// nearDestGeofenceTask.ts와 동일한 이유(Doze 모드 무한 대기 방지) — 상세 주석은 그쪽 참고.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

export const DEPARTING_GEOFENCE_TASK = 'DEPARTING-GEOFENCE-TASK';

// key(j_<journeyId> | a_<appointmentId>) → 앵커(300m EXIT) + 목적지(100m ENTER) 좌표.
// startGeofencingAsync는 "전체 재등록"만 지원(add/remove API 없음)이라 이 목록이 단일 진실 공급원.
const DEPARTING_GEOFENCE_REGIONS_KEY = 'gonow_departing_geofence_regions';

type DepartingRegions = Record<string, {
  anchor: { latitude: number; longitude: number };
  dest: { latitude: number; longitude: number };
}>;

// nearDestGeofenceTask.ts와 동일한 패턴 — 포그라운드/백그라운드가 이 목록을 동시에 고칠 수 있어 직렬화.
let regionLockQueue: Promise<void> = Promise.resolve();
function withRegionLock(fn: () => Promise<void>): Promise<void> {
  const run = regionLockQueue.then(fn, fn);
  regionLockQueue = run.catch(() => {});
  return run;
}

// key(j_<id>|a_<id>)별 처리 직렬화 — 앵커(300m EXIT)와 목적지(100m ENTER) 두 지오펜스가 반경이
// 겹칠 만큼 가깝게 배치되면(예: 앵커-목적지 거리가 두 반경 합에 근접) 둘이 거의 동시에 발화하거나
// OS가 같은 이벤트를 중복 전달할 수 있다(2026-08-16 실기기 실측 — 35ms 안에 EXIT 2회+ENTER 1회
// 동시 발화, 각자 독립적으로 GPS 재확보+/location 호출까지 진행해 서버 호출이 3배로 나감 + 디버그
// 알림도 3개 뜸). withRegionLock은 AsyncStorage 쓰기 자체만 직렬화할 뿐 GPS/서버 호출까지는
// 못 막으므로, key 단위로 별도 락을 둬서 같은 key의 두 번째 이후 호출은 GPS/서버 호출 자체를
// 아예 안 하게 막는다.
const keyLockQueues: Record<string, Promise<void>> = {};
function withKeyLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prior = keyLockQueues[key] ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const settled = run.catch(() => {});
  keyLockQueues[key] = settled;
  // 아직 자신이 최신 체인이면(그사이 같은 key로 새 호출이 안 들어왔으면) 정리 —
  // 안 지우면 앱 수명 내내 한번 등장한 key마다 엔트리가 영구히 쌓인다.
  settled.then(() => {
    if (keyLockQueues[key] === settled) delete keyLockQueues[key];
  });
  return run;
}

async function loadRegions(): Promise<DepartingRegions> {
  try {
    const raw = await AsyncStorage.getItem(DEPARTING_GEOFENCE_REGIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveRegionsAndSync(regions: DepartingRegions): Promise<void> {
  await AsyncStorage.setItem(DEPARTING_GEOFENCE_REGIONS_KEY, JSON.stringify(regions));
  const entries = Object.entries(regions);
  if (entries.length === 0) {
    const isRunning = await Location.hasStartedGeofencingAsync(DEPARTING_GEOFENCE_TASK).catch(() => false);
    if (isRunning) await Location.stopGeofencingAsync(DEPARTING_GEOFENCE_TASK).catch(() => {});
    return;
  }
  // key 하나당 region 2개(앵커 EXIT + 목적지 ENTER) — identifier에 종류를 붙여 콜백에서 구분.
  const geofenceRegions: Location.LocationRegion[] = entries.flatMap(([key, r]) => [
    {
      identifier: `${key}_anchor`,
      latitude: r.anchor.latitude,
      longitude: r.anchor.longitude,
      radius: 300,
      notifyOnEnter: false,
      notifyOnExit: true, // 앵커 300m 이탈 → MOVING
    },
    {
      identifier: `${key}_dest`,
      latitude: r.dest.latitude,
      longitude: r.dest.longitude,
      radius: 100,
      notifyOnEnter: true, // 목적지 100m 진입 → ARRIVED
      notifyOnExit: false,
    },
  ]);
  await Location.startGeofencingAsync(DEPARTING_GEOFENCE_TASK, geofenceRegions);
}

function parseIdentifier(identifier: string): { key: string; kind: 'anchor' | 'dest' } | null {
  if (identifier.endsWith('_anchor')) return { key: identifier.slice(0, -'_anchor'.length), kind: 'anchor' };
  if (identifier.endsWith('_dest')) return { key: identifier.slice(0, -'_dest'.length), kind: 'dest' };
  return null;
}

function parseKey(key: string): { journeyId?: number; appointmentId?: number } {
  if (key.startsWith('j_')) return { journeyId: Number(key.slice(2)) };
  if (key.startsWith('a_')) return { appointmentId: Number(key.slice(2)) };
  return {};
}

// DEPARTING 진입 시 포그라운드(alarmService.ts)/백그라운드(backgroundLocationTask.ts) 공통 호출.
//
// anchorLat/Lng 근사치에 대한 참고(지오펜싱 확장 2단계 — READY는 아직 폴링 기반):
// READY가 지오펜싱으로 전환되기 전까지는(geofencing-migration-plan.md Phase 3, 미착수) 서버가
// 관리하는 진짜 앵커 좌표를 클라이언트가 알 방법이 없다 — 그래서 "DEPARTING 진입을 감지한 이
// /location 호출에 클라이언트가 실제로 보낸 좌표"를 앵커의 근사치로 쓴다. READY 동안 500m를 이미
// 넘었다면 그 순간 서버가 앵커를 이 좌표로 갱신했을 것이므로 오차 0, 안 넘었다면 진짜 앵커로부터
// 최대 just-under-500m 오차가 생길 수 있다(READY 폴링 주기가 짧을수록 실제 오차는 작아짐 — 최근
// 위치이므로). 이 오차의 유일한 부작용은 MOVING 감지가 최악의 경우 그만큼 늦어지는 것뿐 — 서버가
// EXIT 시 /location 재호출로 실제 판정을 하므로 상태 정확성 자체는 훼손되지 않는다(self-healing).
// READY 지오펜싱 도입 시 이 근사치는 READY 진입 때 확정해 로컬에 캐시해둔 진짜 앵커값으로
// 교체돼야 하며, 그러면 이 오차 자체가 사라진다.
export function enterDepartingGeofenceMode(
  key: string,
  anchorLat: number,
  anchorLng: number,
  destLat: number | undefined,
  destLng: number | undefined,
): Promise<void> {
  return withRegionLock(async () => {
    if (destLat == null || destLng == null) {
      dlog('DEPARTING', `[DEPARTING 지오펜스] key:${key} 목적지 좌표 없음 — 등록 스킵`);
      return;
    }
    const regions = await loadRegions();
    if (regions[key]) {
      dlog('DEPARTING', `[DEPARTING 지오펜스] key:${key} 이미 등록됨 — skip`);
      return;
    }
    regions[key] = {
      anchor: { latitude: anchorLat, longitude: anchorLng },
      dest: { latitude: destLat, longitude: destLng },
    };
    await saveRegionsAndSync(regions);
    dlog('DEPARTING', `key:${key} 등록 완료 — 앵커(${anchorLat.toFixed(6)}, ${anchorLng.toFixed(6)}) 목적지(${destLat.toFixed(6)}, ${destLng.toFixed(6)})`);
  });
}

// key의 DEPARTING 지오펜스 모니터링 종료 — EXIT/ENTER 처리 후(결과 무관), 여정 재시작 시 각각 호출.
export function exitDepartingGeofenceMode(key: string): Promise<void> {
  return withRegionLock(async () => {
    const regions = await loadRegions();
    if (!(key in regions)) return;
    delete regions[key];
    await saveRegionsAndSync(regions);
    dlog('DEPARTING', `[DEPARTING 지오펜스] key:${key} 해제 완료`);
  });
}

// 앱 부팅/로그인 시점 orphan 정리 — nearDestGeofenceTask.ts의 reconcileNearDestGeofences()와 동일한 이유.
export async function reconcileDepartingGeofences(activeKeys: string[]): Promise<void> {
  const regions = await loadRegions();
  const activeSet = new Set(activeKeys);
  const orphanKeys = Object.keys(regions).filter((k) => !activeSet.has(k));
  if (orphanKeys.length === 0) return;
  dlog('DEPARTING', `[DEPARTING 지오펜스] 정합화 — orphan 제거: ${orphanKeys}`);
  await withRegionLock(async () => {
    const current = await loadRegions();
    for (const k of orphanKeys) delete current[k];
    await saveRegionsAndSync(current);
  });
}

// MOVING 전이 — MOVING은 계속 폴링해야 하므로(실시간 속도/방향/ETA 계산 필요,
// geofencing-migration-plan.md L21) nearDestGeofenceTask.ts의 fallbackToPolling()과 동일한 패턴:
// 포그라운드면 살아있는 러너를 깨워 정상 poll() 루프로 복귀시키고, 백그라운드면 네이티브 GPS
// 구독을 재개한다.
async function resumeAsPolling(journeyId?: number, appointmentId?: number): Promise<void> {
  await addActiveId(journeyId, appointmentId);
  if (AppState.currentState === 'active') {
    try {
      // 순환 import 회피 — nearDestGeofenceTask.ts의 fallbackToPolling()과 동일한 동적 import 패턴
      const { alarmService } = await import('@/src/services/alarmService');
      alarmService.resumeFromGeofence(journeyId, appointmentId);
      return;
    } catch (e: any) {
      dlog('DEPARTING', `[DEPARTING 지오펜스] alarmService 동적 import 실패 — 백그라운드 폴링으로 폴백: ${e?.message}`);
    }
  }
  await startGpsPolling().catch((e) => {
    dlog('DEPARTING', `[DEPARTING 지오펜스] 폴백 위치추적 시작 실패: ${e?.message}`);
  });
}

// ARRIVED 전이(목적지 100m 진입) — 더 이상 위치로 할 일이 없으므로 완전히 정리한다. 포그라운드에
// 살아있는 러너가 있으면 원래 흐름(AlarmRunner.handlePersonalStatus/handleGroupStatus)이
// cancelRemainingStages()+stop()까지 정확히 처리하도록 resumeFromGeofence()로 넘긴다 — 이 호출이
// poll()을 한 번 더 만들지만 서버 응답은 멱등이라 무해하다(nearDestGeofenceTask.ts도 이미 같은
// 방식으로 EXIT 처리와 별개로 재확인 poll을 트리거하는 전례가 있음). 백그라운드/러너가 없을 땐
// backgroundLocationTask.ts의 ARRIVED 분기와 동일하게 직접 정리한다.
// movingGeofenceTask.ts(MOVING→ARRIVED 보조 지오펜스)도 동일한 정리 로직이 필요해 재사용한다 —
// ARRIVED 도달 시 할 일은 어느 상태에서 왔든 똑같기 때문(멱등한 알람 종료 절차).
export async function finishAsArrived(key: string, journeyId?: number, appointmentId?: number): Promise<void> {
  if (AppState.currentState === 'active') {
    try {
      const { alarmService } = await import('@/src/services/alarmService');
      if (alarmService.isRunning(journeyId, appointmentId)) {
        alarmService.resumeFromGeofence(journeyId, appointmentId);
        return;
      }
    } catch (e: any) {
      dlog('DEPARTING', `[DEPARTING 지오펜스] alarmService 동적 import 실패 — 직접 정리로 폴백: ${e?.message}`);
    }
  }
  // 프로세스가 살아있는데(스와이프만 하고 완전 종료는 아닌 흔한 케이스) 백그라운드라 위 분기를
  // 못 탄 경우, AlarmManager.runners에 좀비 러너가 남을 수 있다 — 지우지 않으면 다음 회차
  // 진입 시 isRunning()이 잘못 true를 반환해서 새 러너 시작 자체가 스킵된다(notifications.ts의
  // 백그라운드 도착확인 경로는 이미 forgetIfExists()로 이걸 방어하고 있었는데, 이 함수는 빠져
  // 있었음 — 2026-08-18 코드 리뷰 중 발견). 진짜 헤드리스면 alarmService 동적 import 자체가
  // 실패하거나 러너가 애초에 없어 조용히 no-op.
  try {
    const { alarmService } = await import('@/src/services/alarmService');
    alarmService.forgetIfExists(journeyId, appointmentId);
  } catch (e: any) {
    dlog('DEPARTING', `[DEPARTING 지오펜스] forgetIfExists 동적 import 실패(헤드리스로 추정, 무해): ${e?.message}`);
  }
  await cancelStagedAlarms(key).catch(() => {});
  // 반복 여정이면 nav info를 지우지 않고 다음 회차까지 파킹한다(버그45) — readyGeofenceTask.ts/
  // departingGeofenceTask.ts/movingGeofenceTask.ts 전부 이 함수를 공유하므로 세 지오펜스
  // 경로(READY/DEPARTING/MOVING 어디서 100m 진입이 감지되든) 전부 한 번에 적용된다.
  const parked = await removeOrParkAlarmNavInfo(key).catch(() => false);
  dlog('DEPARTING', `key:${key} ARRIVED 정리 — ${parked ? '반복 여정, nav info 파킹(버그45)' : 'nav info 제거'}`);
  await removeActiveId(journeyId, appointmentId).catch(() => {});
}

TaskManager.defineTask(DEPARTING_GEOFENCE_TASK, async ({ data, error }) => {
  const t0 = Date.now();
  if (error) {
    dlog('DEPARTING', `태스크 에러: ${JSON.stringify(error)}`);
    return;
  }

  const sessionReady = await AsyncStorage.getItem(SESSION_READY_KEY);
  if (sessionReady !== '1') {
    dlog('DEPARTING', '세션 미준비 — init() 완료 전 skip');
    return;
  }

  const { eventType, region } = (data as { eventType?: number; region?: Location.LocationRegion & { error?: string } }) ?? {};
  dlog('DEPARTING', `발화 — eventType:${eventType} identifier:${region?.identifier ?? '-'}`);

  // nearDestGeofenceTask.ts와 동일 — expo-location 네이티브 패치가 addGeofences() 등록 실패를
  // 이 eventType(-1)으로 알려준다. 등록 실패한 key를 특정 못 하므로(항상 전체 재등록) 전부 폴백.
  if (eventType === -1) {
    const errorMsg = region?.error ?? 'unknown';
    dlog('DEPARTING', `지오펜스 등록 실패 감지 — ${errorMsg}`);
    await sendDebugNotification('DEPARTING 지오펜스 등록 실패 감지', String(errorMsg));
    const affected = await loadRegions();
    const affectedKeys = Object.keys(affected);
    await withRegionLock(async () => {
      await saveRegionsAndSync({});
      dlog('DEPARTING', `[DEPARTING 지오펜스] 등록 실패로 전체 해제 완료 — 대상:${affectedKeys}`);
    });
    for (const affectedKey of affectedKeys) {
      const parsed = parseKey(affectedKey);
      await resumeAsPolling(parsed.journeyId, parsed.appointmentId);
    }
    return;
  }

  if (!region?.identifier) {
    dlog('DEPARTING', 'identifier 없음 — skip');
    return;
  }
  const parsedId = parseIdentifier(region.identifier);
  if (!parsedId) {
    dlog('DEPARTING', `identifier 파싱 실패 — ${region.identifier}`);
    return;
  }
  const { key, kind } = parsedId;
  const isAnchorExit = kind === 'anchor' && eventType === Location.LocationGeofencingEventType.Exit;
  const isDestEnter = kind === 'dest' && eventType === Location.LocationGeofencingEventType.Enter;
  if (!isAnchorExit && !isDestEnter) {
    dlog('DEPARTING', `무시 대상 이벤트 — kind:${kind} eventType:${eventType}`);
    return;
  }

  const { journeyId, appointmentId } = parseKey(key);
  if (journeyId == null && appointmentId == null) {
    dlog('DEPARTING', `key 파싱 실패 — key:${key}`);
    return;
  }

  await withKeyLock(key, async () => {
    // 같은 key의 다른 지오펜스(앵커/목적지)가 거의 동시에 발화했거나 OS가 이벤트를 중복
    // 전달한 경우, 먼저 처리된 호출이 이미 지오펜스를 해제했을 수 있다 — 그러면 이 호출은
    // 더 할 일이 없으므로 GPS/서버 호출 없이 조용히 스킵한다(2026-08-16 실기기 동시성 버그 수정).
    const stillRegistered = key in (await loadRegions());
    if (!stillRegistered) {
      dlog('DEPARTING', `key:${key} kind:${kind} 이미 처리됨(동시 발화) — skip`);
      return;
    }

    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) {
      dlog('DEPARTING', '토큰 없음 — skip');
      return;
    }

    // 좌표 확보 — nearDestGeofenceTask.ts와 동일한 순서(신규 GPS 우선, 실패 시 캐시 폴백).
    let coords: { latitude: number; longitude: number } | null = null;
    let coordSource: 'cache' | 'fresh' = 'fresh';
    try {
      const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 15000);
      coords = fresh.coords;
    } catch {}
    if (!coords) {
      coordSource = 'cache';
      try {
        const last = await withTimeout(Location.getLastKnownPositionAsync({ maxAge: 60000 }), 5000);
        if (last) coords = last.coords;
      } catch {}
    }
    if (!coords) {
      dlog('DEPARTING', `key:${key} +${Date.now() - t0}ms 좌표 획득 실패 — 폴백`);
      await sendDebugNotification('좌표 획득 실패 → 폴백', `key:${key}`);
      await exitDepartingGeofenceMode(key);
      await resumeAsPolling(journeyId, appointmentId);
      return;
    }

    try {
      const response = journeyId != null
        ? await patchLocation(`/api/journeys/${journeyId}/location`, token, coords.latitude, coords.longitude)
        : await patchLocation(`/api/appointments/${appointmentId}/participants/location`, token, coords.latitude, coords.longitude);

      const status = journeyId != null ? response?.data?.journey_status : response?.data?.participant_status;
      const elapsed = Date.now() - t0;
      const appStateLabel = AppState.currentState === 'active' ? '포그라운드' : '백그라운드';
      dlog('DEPARTING', `key:${key} kind:${kind} +${elapsed}ms /location 응답 status:${status} (${appStateLabel}, 좌표출처:${coordSource})`);
      await sendDebugNotification(`${kind === 'anchor' ? '출발지 EXIT[->MOVING]' : '목적지 ENTER[->ARRIVED]'} (${appStateLabel})`, `+${elapsed}ms key:${key} status:${status} 좌표출처:${coordSource === 'cache' ? '캐시' : '신규GPS'}`);

      await exitDepartingGeofenceMode(key);

      if (status === 'MOVING') {
        dlog('DEPARTING', `key:${key} → MOVING 확정, 폴링 재개`);
        await resumeAsPolling(journeyId, appointmentId);
        // MOVING 진입 시 목적지 100m ENTER 보조 지오펜스도 같이 등록(Phase 2) — 폴링(실시간 ETA용)은
        // 그대로 유지되고, 이 지오펜스는 도착을 폴링 주기보다 더 빠르게 감지하는 용도일 뿐이다.
        const navRaw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY);
        const nav = navRaw ? JSON.parse(navRaw)[key] : undefined;
        const { enterMovingGeofenceMode } = await import('@/src/tasks/movingGeofenceTask');
        await enterMovingGeofenceMode(key, nav?.destLat, nav?.destLng);
      } else if (status === 'ARRIVED') {
        dlog('DEPARTING', `key:${key} → ARRIVED 확정, 정리`);
        await finishAsArrived(key, journeyId, appointmentId);
      } else {
        // 여전히 DEPARTING(위 앵커 근사치 오차나 GPS 오차로 서버 판정이 클라이언트 예상과 다를 때
        // 발생 가능) — 방금 확보한 최신 좌표를 새 앵커 근사치로 삼아 지오펜스를 재등록해 계속 감시.
        dlog('DEPARTING', `key:${key} 여전히 DEPARTING — 새 앵커로 재등록`);
        const navRaw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY);
        const nav = navRaw ? JSON.parse(navRaw)[key] : undefined;
        if (nav?.destLat != null && nav?.destLng != null) {
          await enterDepartingGeofenceMode(key, coords.latitude, coords.longitude, nav.destLat, nav.destLng);
        } else {
          await resumeAsPolling(journeyId, appointmentId);
        }
      }
    } catch (e) {
      dlog('DEPARTING', `key:${key} /location 호출 실패 — 폴백. 에러:${String(e)}`);
      await sendDebugNotification('/location 호출 실패 → 폴백', `key:${key} 좌표출처:${coordSource === 'cache' ? '캐시' : '신규GPS'} 에러:${String(e)}`);
      await exitDepartingGeofenceMode(key);
      await resumeAsPolling(journeyId, appointmentId);
    }
  });
});
