import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { TOKEN_KEY } from '@/src/store/authStore';
import { sendDebugNotification } from '@/src/utils/notifications';
import { dlog } from '@/src/utils/deviceLogger';
import { SESSION_READY_KEY, patchLocation } from '@/src/tasks/backgroundLocationTask';
import { finishAsArrived } from '@/src/tasks/departingGeofenceTask';

// nearDestGeofenceTask.ts/departingGeofenceTask.ts와 동일한 이유(Doze 모드 무한 대기 방지).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

export const MOVING_GEOFENCE_TASK = 'MOVING-GEOFENCE-TASK';

// key(j_<id>|a_<id>) → 목적지 좌표. MOVING은 실시간 속도/방향/ETA 계산이 필요해 지오펜싱으로
// 완전히 대체할 수 없다(geofencing-migration-plan.md L21) — 그래서 폴링은 그대로 유지하고, 이
// 지오펜스는 목적지 100m 진입을 폴링 주기(30~120초)보다 더 빠르게 감지하는 "보조" 트리거일 뿐이다.
const MOVING_GEOFENCE_REGIONS_KEY = 'gonow_moving_geofence_regions';

// nearDestGeofenceTask.ts/departingGeofenceTask.ts와 동일한 패턴 — 포그라운드/백그라운드가 이
// 목록을 동시에 고칠 수 있어 직렬화.
let regionLockQueue: Promise<void> = Promise.resolve();
function withRegionLock(fn: () => Promise<void>): Promise<void> {
  const run = regionLockQueue.then(fn, fn);
  regionLockQueue = run.catch(() => {});
  return run;
}

// departingGeofenceTask.ts에서 실기기로 확인된 동시성 버그(같은 콜백이 중복 전달되면 각자 독립적으로
// GPS+서버 호출) 방지 패턴을 처음부터 적용 — 배경은 그쪽 파일의 동일한 이름 함수 주석 참고.
const keyLockQueues: Record<string, Promise<void>> = {};
function withKeyLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prior = keyLockQueues[key] ?? Promise.resolve();
  const run = prior.then(fn, fn);
  keyLockQueues[key] = run.catch(() => {});
  return run;
}

async function loadRegions(): Promise<Record<string, { latitude: number; longitude: number }>> {
  try {
    const raw = await AsyncStorage.getItem(MOVING_GEOFENCE_REGIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveRegionsAndSync(regions: Record<string, { latitude: number; longitude: number }>): Promise<void> {
  await AsyncStorage.setItem(MOVING_GEOFENCE_REGIONS_KEY, JSON.stringify(regions));
  const entries = Object.entries(regions);
  if (entries.length === 0) {
    const isRunning = await Location.hasStartedGeofencingAsync(MOVING_GEOFENCE_TASK).catch(() => false);
    if (isRunning) await Location.stopGeofencingAsync(MOVING_GEOFENCE_TASK).catch(() => {});
    return;
  }
  const geofenceRegions: Location.LocationRegion[] = entries.map(([key, coords]) => ({
    identifier: key,
    latitude: coords.latitude,
    longitude: coords.longitude,
    radius: 100,
    notifyOnEnter: true, // 목적지 100m 진입 → ARRIVED 보조 감지(폴링도 계속 별도로 감시 중)
    notifyOnExit: false,
  }));
  await Location.startGeofencingAsync(MOVING_GEOFENCE_TASK, geofenceRegions);
}

function parseKey(key: string): { journeyId?: number; appointmentId?: number } {
  if (key.startsWith('j_')) return { journeyId: Number(key.slice(2)) };
  if (key.startsWith('a_')) return { appointmentId: Number(key.slice(2)) };
  return {};
}

// MOVING 진입 시 포그라운드(alarmService.ts)/백그라운드(backgroundLocationTask.ts)/DEPARTING EXIT
// (departingGeofenceTask.ts) 공통 호출. 폴링은 그대로 유지되므로(위 참고) ACTIVE_JOURNEYS_KEY/
// ACTIVE_APPOINTMENTS_KEY는 건드리지 않는다 — 순수 보조 트리거 등록일 뿐. regions[key] 존재
// 여부로 이미 등록됐는지 확인하므로, 매 폴링 틱마다 반복 호출해도 안전(2번째부터는 조용히 skip).
export function enterMovingGeofenceMode(
  key: string,
  destLat: number | undefined,
  destLng: number | undefined,
): Promise<void> {
  return withRegionLock(async () => {
    if (destLat == null || destLng == null) {
      dlog('MOVING', `key:${key} 목적지 좌표 없음 — 등록 스킵`);
      return;
    }
    const regions = await loadRegions();
    if (regions[key]) return;
    regions[key] = { latitude: destLat, longitude: destLng };
    await saveRegionsAndSync(regions);
    dlog('MOVING', `key:${key} 등록 완료 (${destLat.toFixed(6)}, ${destLng.toFixed(6)})`);
  });
}

// key의 MOVING 보조 지오펜스 해제 — ENTER 처리 후(결과 무관, 아래 참고) 또는 여정 종료 시 호출.
export function exitMovingGeofenceMode(key: string): Promise<void> {
  return withRegionLock(async () => {
    const regions = await loadRegions();
    if (!(key in regions)) return;
    delete regions[key];
    await saveRegionsAndSync(regions);
    dlog('MOVING', `key:${key} 해제 완료`);
  });
}

// 앱 부팅/로그인 시점 orphan 정리 — nearDestGeofenceTask.ts/departingGeofenceTask.ts의 동명 함수와 동일한 이유.
export async function reconcileMovingGeofences(activeKeys: string[]): Promise<void> {
  const regions = await loadRegions();
  const activeSet = new Set(activeKeys);
  const orphanKeys = Object.keys(regions).filter((k) => !activeSet.has(k));
  if (orphanKeys.length === 0) return;
  dlog('MOVING', `정합화 — orphan 제거: ${orphanKeys}`);
  await withRegionLock(async () => {
    const current = await loadRegions();
    for (const k of orphanKeys) delete current[k];
    await saveRegionsAndSync(current);
  });
}

TaskManager.defineTask(MOVING_GEOFENCE_TASK, async ({ data, error }) => {
  const t0 = Date.now();
  if (error) {
    dlog('MOVING', `태스크 에러: ${JSON.stringify(error)}`);
    return;
  }

  const sessionReady = await AsyncStorage.getItem(SESSION_READY_KEY);
  if (sessionReady !== '1') {
    dlog('MOVING', '세션 미준비 — init() 완료 전 skip');
    return;
  }

  const { eventType, region } = (data as { eventType?: number; region?: Location.LocationRegion & { error?: string } }) ?? {};
  dlog('MOVING', `발화 — eventType:${eventType} identifier:${region?.identifier ?? '-'}`);

  if (eventType === -1) {
    const errorMsg = region?.error ?? 'unknown';
    dlog('MOVING', `지오펜스 등록 실패 감지 — ${errorMsg}`);
    await sendDebugNotification('MOVING 지오펜스 등록 실패 감지', String(errorMsg));
    // 폴링이 어차피 계속 돌고 있어(MOVING은 폴링 유지) 별도 폴백이 불필요 — 등록 목록만 비운다.
    await withRegionLock(async () => {
      await saveRegionsAndSync({});
    });
    return;
  }

  if (eventType !== Location.LocationGeofencingEventType.Enter || !region?.identifier) {
    dlog('MOVING', 'ENTER 아니거나 identifier 없음 — skip');
    return;
  }

  const key = region.identifier;
  const { journeyId, appointmentId } = parseKey(key);
  if (journeyId == null && appointmentId == null) {
    dlog('MOVING', `key 파싱 실패 — key:${key}`);
    return;
  }

  await withKeyLock(key, async () => {
    // departingGeofenceTask.ts와 동일한 순서 — "이미 처리됨" 여부부터 확인해서, 동시 발화로
    // 스킵될 이벤트가 불필요하게 토큰 조회 등 뒷단 작업을 먼저 하지 않게 한다.
    const stillRegistered = key in (await loadRegions());
    if (!stillRegistered) {
      dlog('MOVING', `key:${key} 이미 처리됨(동시 발화) — skip`);
      return;
    }

    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) {
      dlog('MOVING', '토큰 없음 — skip');
      return;
    }

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
      // 폴링이 계속 감시 중이므로(MOVING 유지) DEPARTING/NEARDEST처럼 별도 폴백 로직이 필요 없다 —
      // 이 보조 지오펜스만 조용히 해제하고, 다음 폴링 틱이 정상적으로 도착을 감지하게 둔다.
      dlog('MOVING', `key:${key} +${Date.now() - t0}ms 좌표 획득 실패 — 폴링이 계속 감시 중이라 폴백 불필요`);
      await exitMovingGeofenceMode(key);
      return;
    }

    try {
      const response = journeyId != null
        ? await patchLocation(`/api/journeys/${journeyId}/location`, token, coords.latitude, coords.longitude)
        : await patchLocation(`/api/appointments/${appointmentId}/participants/location`, token, coords.latitude, coords.longitude);

      const status = journeyId != null ? response?.data?.journey_status : response?.data?.participant_status;
      const elapsed = Date.now() - t0;
      const appStateLabel = AppState.currentState === 'active' ? '포그라운드' : '백그라운드';
      dlog('MOVING', `key:${key} +${elapsed}ms /location 응답 status:${status} (${appStateLabel}, 좌표출처:${coordSource})`);
      await sendDebugNotification(`MOVING ENTER 처리 완료 (${appStateLabel})`, `+${elapsed}ms key:${key} status:${status} 좌표출처:${coordSource === 'cache' ? '캐시' : '신규GPS'}`);

      await exitMovingGeofenceMode(key);

      if (status === 'ARRIVED') {
        dlog('MOVING', `key:${key} → ARRIVED 확정, 정리`);
        await finishAsArrived(key, journeyId, appointmentId);
      }
      // 여전히 MOVING이면 별도 조치 없음 — 폴링이 계속 감시 중이라 다음 틱에서 자연히 재확인된다.
      // 이 지오펜스를 다시 등록하지 않는 이유: 이미 경계 안에 있는 상태로 재등록하면 ENTER가 다시
      // 발생하지 않을 수 있어서다(geofencing-migration-plan.md "지오펜스 등록 시점의 일반 원칙" —
      // 버그41과 동일 클래스의 문제). MOVING은 폴링이라는 안전망이 이미 있어 재등록 리스크를 감수할
      // 필요가 없다(DEPARTING/NEARDEST는 폴링이 꺼져 있어 재등록이 필수였던 것과 다른 점).
    } catch (e) {
      dlog('MOVING', `key:${key} /location 호출 실패 — 폴링이 계속 감시 중이라 폴백 불필요. 에러:${String(e)}`);
      await exitMovingGeofenceMode(key);
    }
  });
});
