import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { TOKEN_KEY } from '@/src/store/authStore';
import { sendDebugNotification } from '@/src/utils/notifications';
import { dlog } from '@/src/utils/deviceLogger';
import {
  SESSION_READY_KEY,
  ALARM_NAV_INFO_KEY,
  patchLocation,
  addActiveId,
  startGpsPolling,
} from '@/src/tasks/backgroundLocationTask';
import { enterNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';
import { enterDepartingGeofenceMode, finishAsArrived } from '@/src/tasks/departingGeofenceTask';

// nearDestGeofenceTask.ts/departingGeofenceTask.ts와 동일한 이유(Doze 모드 무한 대기 방지).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

export const READY_GEOFENCE_TASK = 'READY-GEOFENCE-TASK';

// key(j_<id>|a_<id>) → 앵커(500m EXIT) + 목적지(100m ENTER) 좌표.
const READY_GEOFENCE_REGIONS_KEY = 'gonow_ready_geofence_regions';

type ReadyRegions = Record<string, {
  anchor: { latitude: number; longitude: number };
  // 막차 모드 700m 미만(target_time 미확정) 동안은 dest 자체를 등록하지 않는다 — 확정 전엔
  // isLastTrainTimeConfirmed() 가드 때문에 NEARDEST로 전이할 수 없어 dest ENTER가 무의미하고,
  // 이미 반경 안인 채로 등록하면 즉시 재발화하는 라이브록 위험만 있다(enterReadyGeofenceMode
  // armDest 참고). target_time이 확정되는 순간부터 정상적으로 채워진다.
  dest?: { latitude: number; longitude: number };
}>;

let regionLockQueue: Promise<void> = Promise.resolve();
function withRegionLock(fn: () => Promise<void>): Promise<void> {
  const run = regionLockQueue.then(fn, fn);
  regionLockQueue = run.catch(() => {});
  return run;
}

// departingGeofenceTask.ts/movingGeofenceTask.ts에서 실기기로 확인된 동시성 버그(같은 콜백이
// 중복 전달되거나 여러 지오펜스가 거의 동시에 발화하면 각자 독립적으로 GPS+서버 호출) 방지 —
// 처음부터 적용. 배경은 departingGeofenceTask.ts의 동일한 이름 함수 주석 참고.
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

async function loadRegions(): Promise<ReadyRegions> {
  try {
    const raw = await AsyncStorage.getItem(READY_GEOFENCE_REGIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveRegionsAndSync(regions: ReadyRegions): Promise<void> {
  await AsyncStorage.setItem(READY_GEOFENCE_REGIONS_KEY, JSON.stringify(regions));
  const entries = Object.entries(regions);
  if (entries.length === 0) {
    const isRunning = await Location.hasStartedGeofencingAsync(READY_GEOFENCE_TASK).catch(() => false);
    if (isRunning) await Location.stopGeofencingAsync(READY_GEOFENCE_TASK).catch(() => {});
    return;
  }
  const geofenceRegions: Location.LocationRegion[] = entries.flatMap(([key, r]) => [
    {
      identifier: `${key}_anchor`,
      latitude: r.anchor.latitude,
      longitude: r.anchor.longitude,
      radius: 500,
      notifyOnEnter: false,
      notifyOnExit: true, // 앵커 500m 이탈 → 재계산(재센터링) 또는 DEPARTING/NEARDEST
    },
    // r.dest가 없으면(target_time 미확정) 목적지 지오펜스 자체를 등록하지 않는다.
    ...(r.dest ? [{
      identifier: `${key}_dest`,
      latitude: r.dest.latitude,
      longitude: r.dest.longitude,
      radius: 100,
      notifyOnEnter: true, // 목적지 100m 진입 → NEARDEST
      notifyOnExit: false,
    }] : []),
  ]);
  await Location.startGeofencingAsync(READY_GEOFENCE_TASK, geofenceRegions);
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

// DepartingTransitionScheduler(서버, 시간 트리거)의 FCM sync_event:departing_transition 처리 시
// backgroundAlarmTask.ts가 이 함수로 "READY 진입 때 이 클라이언트가 직접 찍었던 마지막 앵커"를
// 읽어간다 — 서버가 좌표를 새로 안 보내도 되는 이유(geofencing-migration-plan.md "READY→DEPARTING
// 시간 트리거" 참고). ALARM_NAV_INFO_KEY에 중복 저장하지 않고 이 파일의 region 저장소를 단일
// 진실 공급원으로 재사용.
export async function getReadyAnchor(key: string): Promise<{ latitude: number; longitude: number } | null> {
  const regions = await loadRegions();
  return regions[key]?.anchor ?? null;
}

// READY 진입/재센터링 시 공통 호출. 다른 상태의 enterXGeofenceMode()들과 달리 "이미 등록돼 있으면
// skip"이 아니라 **항상 덮어쓴다** — READY만 유일하게 앵커가 유동적이라(500m마다 재계산),
// 매번 최신 좌표로 재등록해야 의미가 있다. 이 좌표는 항상 방금 실제로 GPS를 찍은 결과라(폴링
// 응답이든 이 태스크 자신의 재확인이든) 근사치 오차 문제가 없다 — DEPARTING 진입 시점의 앵커
// 근사치(departingGeofenceTask.ts 주석 참고)와 다른 점.
// armDest: 막차 모드 700m 미만이라 target_time이 아직 미확정이면 false로 넘겨서 목적지 100m
// 지오펜스를 등록하지 않는다(호출부에서 departureAlarmTime != null로 판단 — 미확정 동안엔 Flask가
// departureAlarmTime도 함께 null로 반환하므로 이 값이 곧 확정 여부의 신뢰할 수 있는 대리 신호).
// 나머지 모든 모드(개인/귀가-데드라인/target_time 확정된 막차)는 이 값이 항상 non-null이라
// 실질적으로 항상 true. 기본값을 두지 않고 호출부마다 명시하게 강제한다 — 기본값(true)이 있으면
// 나중에 새 호출부가 실수로 이 인자를 빠뜨렸을 때 조용히 구버전 동작(라이브록 재발 가능)으로
// 폴백해버리는데, 필수 인자로 두면 그 실수를 컴파일 타임에 막을 수 있다.
export function enterReadyGeofenceMode(
  key: string,
  anchorLat: number,
  anchorLng: number,
  destLat: number | undefined,
  destLng: number | undefined,
  armDest: boolean,
): Promise<void> {
  return withRegionLock(async () => {
    if (destLat == null || destLng == null) {
      dlog('READY', `key:${key} 목적지 좌표 없음 — 등록 스킵`);
      return;
    }
    const regions = await loadRegions();
    regions[key] = {
      anchor: { latitude: anchorLat, longitude: anchorLng },
      ...(armDest ? { dest: { latitude: destLat, longitude: destLng } } : {}),
    };
    await saveRegionsAndSync(regions);
    dlog('READY', `key:${key} 등록/재센터링 완료 — 앵커(${anchorLat.toFixed(6)}, ${anchorLng.toFixed(6)}) 목적지(${armDest ? `${destLat.toFixed(6)}, ${destLng.toFixed(6)}` : '미등록(target_time 미확정)'})`);
  });
}

export function exitReadyGeofenceMode(key: string): Promise<void> {
  return withRegionLock(async () => {
    const regions = await loadRegions();
    if (!(key in regions)) return;
    delete regions[key];
    await saveRegionsAndSync(regions);
    dlog('READY', `key:${key} 해제 완료`);
  });
}

export async function reconcileReadyGeofences(activeKeys: string[]): Promise<void> {
  const regions = await loadRegions();
  const activeSet = new Set(activeKeys);
  const orphanKeys = Object.keys(regions).filter((k) => !activeSet.has(k));
  if (orphanKeys.length === 0) return;
  dlog('READY', `정합화 — orphan 제거: ${orphanKeys}`);
  await withRegionLock(async () => {
    const current = await loadRegions();
    for (const k of orphanKeys) delete current[k];
    await saveRegionsAndSync(current);
  });
}

// 지오펜스 등록/GPS 실패 시 폴백 — READY는 원래 폴링 상태였으므로(Phase 3 이전과 동일 경로)
// 그냥 일반 폴링으로 되돌리면 backgroundLocationTask.ts/alarmService.ts의 기존 READY 처리가
// 그대로 이어받는다(신규 코드 불필요, else 분기가 이미 처리). departingGeofenceTask.ts의
// resumeAsPolling()과 동일한 패턴 — 포그라운드에선 AlarmRunner가 GPS를 전담하므로(코드베이스
// 전역 불변식), 여기서 무조건 네이티브 구독을 켜버리면 포그라운드 중에도 이중으로 GPS가
// 돌게 된다. 포그라운드면 살아있는 러너를 먼저 깨우고, 그게 안 되면(백그라운드거나 러너가
// 아예 없을 때) 네이티브 폴링으로 대체한다.
async function fallbackToPolling(journeyId?: number, appointmentId?: number): Promise<void> {
  await addActiveId(journeyId, appointmentId);
  if (AppState.currentState === 'active') {
    try {
      const { alarmService } = await import('@/src/services/alarmService');
      alarmService.resumeFromGeofence(journeyId, appointmentId);
      return;
    } catch (e: any) {
      dlog('READY', `alarmService 동적 import 실패 — 백그라운드 폴링으로 폴백: ${e?.message}`);
    }
  }
  await startGpsPolling().catch((e) => {
    dlog('READY', `폴백 위치추적 시작 실패: ${e?.message}`);
  });
}

TaskManager.defineTask(READY_GEOFENCE_TASK, async ({ data, error }) => {
  const t0 = Date.now();
  if (error) {
    dlog('READY', `태스크 에러: ${JSON.stringify(error)}`);
    return;
  }

  const sessionReady = await AsyncStorage.getItem(SESSION_READY_KEY);
  if (sessionReady !== '1') {
    dlog('READY', '세션 미준비 — init() 완료 전 skip');
    return;
  }

  const { eventType, region } = (data as { eventType?: number; region?: Location.LocationRegion & { error?: string } }) ?? {};
  dlog('READY', `발화 — eventType:${eventType} identifier:${region?.identifier ?? '-'}`);

  if (eventType === -1) {
    const errorMsg = region?.error ?? 'unknown';
    dlog('READY', `지오펜스 등록 실패 감지 — ${errorMsg}`);
    await sendDebugNotification('READY 지오펜스 등록 실패 감지', String(errorMsg));
    const affected = await loadRegions();
    const affectedKeys = Object.keys(affected);
    await withRegionLock(async () => {
      await saveRegionsAndSync({});
    });
    for (const affectedKey of affectedKeys) {
      const parsed = parseKey(affectedKey);
      await fallbackToPolling(parsed.journeyId, parsed.appointmentId);
    }
    return;
  }

  if (!region?.identifier) {
    dlog('READY', 'identifier 없음 — skip');
    return;
  }
  const parsedId = parseIdentifier(region.identifier);
  if (!parsedId) {
    dlog('READY', `identifier 파싱 실패 — ${region.identifier}`);
    return;
  }
  const { key, kind } = parsedId;
  const isAnchorExit = kind === 'anchor' && eventType === Location.LocationGeofencingEventType.Exit;
  const isDestEnter = kind === 'dest' && eventType === Location.LocationGeofencingEventType.Enter;
  if (!isAnchorExit && !isDestEnter) {
    dlog('READY', `무시 대상 이벤트 — kind:${kind} eventType:${eventType}`);
    return;
  }

  const { journeyId, appointmentId } = parseKey(key);
  if (journeyId == null && appointmentId == null) {
    dlog('READY', `key 파싱 실패 — key:${key}`);
    return;
  }

  await withKeyLock(key, async () => {
    const stillRegistered = key in (await loadRegions());
    if (!stillRegistered) {
      dlog('READY', `key:${key} kind:${kind} 이미 처리됨(동시 발화) — skip`);
      return;
    }

    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) {
      dlog('READY', '토큰 없음 — skip');
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
      dlog('READY', `key:${key} +${Date.now() - t0}ms 좌표 획득 실패 — 폴백`);
      await sendDebugNotification('좌표 획득 실패 → 폴백', `key:${key}`);
      await exitReadyGeofenceMode(key);
      await fallbackToPolling(journeyId, appointmentId);
      return;
    }

    try {
      const response = journeyId != null
        ? await patchLocation(`/api/journeys/${journeyId}/location`, token, coords.latitude, coords.longitude)
        : await patchLocation(`/api/appointments/${appointmentId}/participants/location`, token, coords.latitude, coords.longitude);

      const status = journeyId != null ? response?.data?.journey_status : response?.data?.participant_status;
      const departureAlarmTime = response?.data?.departure_alarm_time;
      const elapsed = Date.now() - t0;
      const appStateLabel = AppState.currentState === 'active' ? '포그라운드' : '백그라운드';
      dlog('READY', `key:${key} kind:${kind} +${elapsed}ms /location 응답 status:${status} (${appStateLabel}, 좌표출처:${coordSource})`);
      await sendDebugNotification(`${kind === 'anchor' ? '앵커 EXIT[->재센터링]' : '목적지 ENTER[->NEARDEST]'} (${appStateLabel})`, `+${elapsed}ms key:${key} status:${status} 좌표출처:${coordSource === 'cache' ? '캐시' : '신규GPS'}`);

      const navRaw = await AsyncStorage.getItem(ALARM_NAV_INFO_KEY);
      const nav = navRaw ? JSON.parse(navRaw)[key] : undefined;

      if (status === 'NEARDEST') {
        dlog('READY', `key:${key} → NEARDEST 확정, 기존 NEARDEST 지오펜스로 전환`);
        await exitReadyGeofenceMode(key);
        await enterNearDestGeofenceMode(key, nav?.destLat, nav?.destLng, nav?.destination);
      } else if (status === 'DEPARTING') {
        dlog('READY', `key:${key} → DEPARTING 확정, DEPARTING 지오펜스로 전환`);
        await exitReadyGeofenceMode(key);
        // 방금 확보한 좌표를 앵커로 그대로 전달 — 이 좌표는 실제 GPS 판독값이라 Phase 1
        // 당시의 "폴링 응답 근사치" 문제가 없음(departingGeofenceTask.ts 주석 참고).
        await enterDepartingGeofenceMode(key, coords.latitude, coords.longitude, nav?.destLat, nav?.destLng);
      } else if (status === 'READY') {
        // 재계산 결과 여전히 READY — 방금 좌표로 재센터링. enterReadyGeofenceMode()가 항상
        // 덮어쓰는 구조라(다른 상태로의 핸드오프와 달리 같은 READY 지오펜스 태스크 안에서의
        // 갱신이므로) exitReadyGeofenceMode()를 먼저 호출할 필요가 없다 — 그러면 네이티브
        // 재등록이 불필요하게 2번(해제+등록) 일어나고, 위 "지오펜스 콜백 신뢰성" 섹션의 짧은
        // 시간 재등록 경쟁 위험도 괜히 키운다. 한 번만 호출.
        // armDest(departureAlarmTime != null)로 목적지 지오펜스 등록 여부를 매번 최신 응답
        // 기준으로 다시 판단한다 — 막차 모드 target_time 미확정 동안엔 애초에 dest가 등록된 적이
        // 없으므로 kind==='dest' 이벤트 자체가 발생하지 않고(라이브록 원천 차단), 확정되는 순간의
        // anchor EXIT 재계산에서 자연스럽게 dest가 새로 등록된다.
        dlog('READY', `key:${key} 여전히 READY — 재센터링`);
        await enterReadyGeofenceMode(key, coords.latitude, coords.longitude, nav?.destLat, nav?.destLng, departureAlarmTime != null);
      } else if (status === 'ARRIVED') {
        // READY의 정상 전이 경로엔 없지만(NEARDEST/DEPARTING만 가능), 이 /location 호출 사이에
        // 서버의 지각 정리 스케줄러(targetTime+1시간 초과)가 먼저 ARRIVED로 강제 전환했을 수
        // 있다 — 이 경우도 다른 상태의 ARRIVED 처리와 동일하게 완전히 정리해야 한다(단계별 알람
        // 취소, nav info 제거 등). 지오펜스만 내리고 끝내면 좀비 알람(추적은 안 되지만 로컬
        // 캐시/예약 알림은 안 지워진 상태)이 남는다.
        dlog('READY', `key:${key} → ARRIVED 확정(지각 정리 등으로 이미 종료됨), 정리`);
        await exitReadyGeofenceMode(key);
        await finishAsArrived(key, journeyId, appointmentId);
      } else {
        // 진짜 예상 밖 상태 — 방어적으로 지오펜스만 정리.
        dlog('READY', `key:${key} 예상 밖 status:${status} — READY 지오펜스만 정리`);
        await exitReadyGeofenceMode(key);
      }
    } catch (e) {
      dlog('READY', `key:${key} /location 호출 실패 — 폴백. 에러:${String(e)}`);
      await sendDebugNotification('/location 호출 실패 → 폴백', `key:${key} 좌표출처:${coordSource === 'cache' ? '캐시' : '신규GPS'} 에러:${String(e)}`);
      await exitReadyGeofenceMode(key);
      await fallbackToPolling(journeyId, appointmentId);
    }
  });
});
