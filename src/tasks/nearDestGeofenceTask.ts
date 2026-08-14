import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { TOKEN_KEY, NICKNAME_KEY } from '@/src/store/authStore';
import { sendArrivalCheckAlarm, sendDebugNotification } from '@/src/utils/notifications';
import {
  SESSION_READY_KEY,
  patchLocation,
  addActiveId,
  startGpsPolling,
} from '@/src/tasks/backgroundLocationTask';

// Doze 모드에서 위치 요청이 응답 없이 무한 대기할 수 있어(실측으로 확인됨 — 백그라운드/종료
// 상태에서 EXIT 콜백이 몇십 분씩 안 오다가 포그라운드 복귀 순간 한꺼번에 처리되는 증상), 반드시
// 타임아웃을 걸어서 "실패"로 확정지어야 catch 경로(폴백)로 넘어갈 수 있다.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

export const NEARDEST_GEOFENCE_TASK = 'NEARDEST-GEOFENCE-TASK';

// 현재 NEARDEST 지오펜스로 모니터링 중인 key(j_<journeyId> | a_<appointmentId>) → 목적지 좌표.
// startGeofencingAsync는 "새 배열로 전체 재등록"만 지원(add/remove API 없음)이라, 이 목록이
// 등록된 region의 단일 진실 공급원(source of truth) 역할을 한다.
const NEARDEST_GEOFENCE_REGIONS_KEY = 'gonow_neardest_geofence_regions'; // Record<key, {latitude, longitude}>

// 포그라운드(alarmService.ts NEARDEST 최초 감지·EXIT 응답 처리)와 백그라운드
// (backgroundLocationTask.ts NEARDEST 최초 감지)가 이 목록을 동시에 고칠 수 있어
// backgroundLocationTask.ts의 withNavInfoLock과 동일한 패턴으로 직렬화한다.
let regionLockQueue: Promise<void> = Promise.resolve();
function withRegionLock(fn: () => Promise<void>): Promise<void> {
  const run = regionLockQueue.then(fn, fn); // 이전 호출이 실패했어도 다음 호출은 정상 진행
  regionLockQueue = run.catch(() => {});
  return run;
}

async function loadRegions(): Promise<Record<string, { latitude: number; longitude: number }>> {
  try {
    const raw = await AsyncStorage.getItem(NEARDEST_GEOFENCE_REGIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveRegionsAndSync(regions: Record<string, { latitude: number; longitude: number }>): Promise<void> {
  await AsyncStorage.setItem(NEARDEST_GEOFENCE_REGIONS_KEY, JSON.stringify(regions));
  const entries = Object.entries(regions);
  if (entries.length === 0) {
    const isRunning = await Location.hasStartedGeofencingAsync(NEARDEST_GEOFENCE_TASK).catch(() => false);
    if (isRunning) await Location.stopGeofencingAsync(NEARDEST_GEOFENCE_TASK).catch(() => {});
    return;
  }
  const geofenceRegions: Location.LocationRegion[] = entries.map(([key, coords]) => ({
    identifier: key,
    latitude: coords.latitude,
    longitude: coords.longitude,
    radius: 100,
    notifyOnEnter: false, // ENTER는 READY 폴링이 이미 감지해서 진입시키므로 여기선 EXIT만
    notifyOnExit: true,
  }));
  await Location.startGeofencingAsync(NEARDEST_GEOFENCE_TASK, geofenceRegions);
}

function parseKey(key: string): { journeyId?: number; appointmentId?: number } {
  if (key.startsWith('j_')) return { journeyId: Number(key.slice(2)) };
  if (key.startsWith('a_')) return { appointmentId: Number(key.slice(2)) };
  return {};
}

// NEARDEST 최초 진입 시 포그라운드(alarmService.ts)/백그라운드(backgroundLocationTask.ts)
// 공통으로 호출 — 지오펜스 등록 + 도착 확인 알림 발송을 여기 한 곳으로 모아서, 기존에
// 백그라운드 경로엔 도착 확인 알림이 아예 없던 결함도 같이 해소한다.
export function enterNearDestGeofenceMode(
  key: string,
  destLat: number | undefined,
  destLng: number | undefined,
  destination: string | undefined,
  // 그룹 참가자 개인 알람 스위치(isActive) 반영용 — false면 지오펜스 등록/추적은 그대로 하되
  // 알림만 억제(기존 handleGroupStatus의 "추적은 계속, 알림만 끔" 정책과 동일하게 유지)
  notify = true,
): Promise<void> {
  return withRegionLock(async () => {
    if (destLat == null || destLng == null) {
      console.log(`[NEARDEST 지오펜스] key:${key} 목적지 좌표 없음 — 등록 스킵`);
      return;
    }
    const regions = await loadRegions();
    if (regions[key]) {
      console.log(`[NEARDEST 지오펜스] key:${key} 이미 등록됨 — skip`);
      return;
    }
    regions[key] = { latitude: destLat, longitude: destLng };
    await saveRegionsAndSync(regions);
    console.log(`[NEARDEST 지오펜스] key:${key} 등록 완료 (${destLat}, ${destLng})`);

    if (!notify) return;
    const nickname = (await AsyncStorage.getItem(NICKNAME_KEY)) ?? '사용자';
    const { journeyId, appointmentId } = parseKey(key);
    sendArrivalCheckAlarm(nickname, destination ?? '목적지', journeyId, appointmentId).catch(() => {});
  });
}

// key의 NEARDEST 지오펜스 모니터링 종료 — EXIT 처리 후(결과 무관), 도착 확인 알림의
// "예"/"아니오" 액션 처리 시(아직 EXIT가 안 뜬 상태로 확인한 경우), 여정 재시작 시 각각 호출.
export function exitNearDestGeofenceMode(key: string): Promise<void> {
  return withRegionLock(async () => {
    const regions = await loadRegions();
    if (!(key in regions)) return;
    delete regions[key];
    await saveRegionsAndSync(regions);
    console.log(`[NEARDEST 지오펜스] key:${key} 해제 완료`);
  });
}

// 앱 부팅/로그인 시점, 서버에서 새로 받아온 활성 알람 key 목록과 등록된 지오펜스 region을
// 대조해 orphan(더 이상 활성이 아닌데 지오펜스만 남은 key)을 정리하는 저비용 안전망.
// 정상 플로우(도착확인 버튼, EXIT 처리)에서 이미 정리되지만, 네트워크 실패 등 예상 못한
// 경로로 정리가 누락된 경우를 대비 — 안드로이드 지오펜스 개수 상한(100개)과 직결됨.
export async function reconcileNearDestGeofences(activeKeys: string[]): Promise<void> {
  const regions = await loadRegions();
  const activeSet = new Set(activeKeys);
  const orphanKeys = Object.keys(regions).filter((k) => !activeSet.has(k));
  if (orphanKeys.length === 0) return;
  console.log(`[NEARDEST 지오펜스] 정합화 — orphan 제거: ${orphanKeys}`);
  await withRegionLock(async () => {
    const current = await loadRegions();
    for (const k of orphanKeys) delete current[k];
    await saveRegionsAndSync(current);
  });
}

// EXIT 이후(READY 복귀) 또는 /location 호출 자체가 실패했을 때, 이 key를 일반 폴링 경로로
// 되돌린다 — 지오펜스 EXIT는 폴링과 달리 재시도가 없는 단발 이벤트라, 실패를 그냥 버리지
// 않고 알려진 안정적 경로(기존 폴링)로 폴백시키는 게 안전하다.
async function fallbackToPolling(journeyId?: number, appointmentId?: number): Promise<void> {
  // 2026-08-14(재검토, 실기기로 발견 — 되돌림): 예전(2026-08-13)엔 여기서 clearDesiredInterval()로
  // DESIRED_INTERVALS_KEY를 강제로 지워서 EXIT 직후 기본값(30초)부터 다시 시작하게 했다 — 그
  // 당시엔 NEARDEST 시절의 긴 주기가 그대로 남아있어 재진입 감지가 5분씩 느려지는 문제가
  // 있었기 때문. 그런데 이후 NEARDEST 자체가 서버 계산으로 이미 짧은 interval(30~120초, 시간
  // 기반)을 받도록 개선되면서 이 방어 코드가 불필요해졌고, 오히려 역효과를 낸다 — 지운 직후
  // 서버가 "interval:null"(변경 없음)로 응답하면 아무도 복구를 안 해줘서 백그라운드 네이티브
  // 구독이 30초에 영구히 갇힌다(포그라운드는 러너 메모리 intervalSec을 그대로 써서 정상으로
  // 보이는 통에 실측 전까진 안 드러났음 — 실외 EXIT 테스트로 발견). NEARDEST 시절 값을 그대로
  // 이어받는 게 이미 충분히 짧고, 위 DESIRED_INTERVALS_KEY 초기화 버그와 같은 클래스라 제거.

  // backgroundLocationTask.ts의 잠금 걸린 공용 함수를 그대로 재사용 — 백그라운드 틱/alarmService
  // 시작·종료와 같은 큐를 타야 통째 덮어쓰기로 서로의 갱신을 유실시키는 일이 없다.
  await addActiveId(journeyId, appointmentId);

  if (AppState.currentState === 'active') {
    // 2026-08-14: 화면에 뜨는 알림은 EXIT 처리 완료 알림(AppState 필드 포함, 위 TaskManager.defineTask
    // 안)에 이미 나가므로 여기서 별도 알림을 또 보내면 사실상 같은 정보가 알림 두 개로 쪼개져
    // 나오는 것 — adb로 상세 추적할 때만 필요한 로그로 남긴다.
    console.log(`[NEARDEST 지오펜스] fallbackToPolling — 포그라운드 경로(resumeFromGeofence) 선택 — j:${journeyId ?? '-'} a:${appointmentId ?? '-'}`);
    try {
      // 순환 import 회피 — notifications.ts의 onBackgroundEvent와 동일한 동적 import 패턴
      const { alarmService } = await import('@/src/services/alarmService');
      alarmService.resumeFromGeofence(journeyId, appointmentId);
      return;
    } catch (e: any) {
      // dev-client(Metro 번들러) 환경은 일부 모듈을 그때그때 Metro 서버에서 받아오는데, USB가
      // 빠져있거나 같은 네트워크가 아니면 이 동적 import 자체가 실패한다(실측:
      // LoadBundleFromServerRequestError — 2026-08-13 실외 테스트 중 재현, 예외가 안 잡혀서
      // TaskManager 태스크 전체가 죽었었음). EAS 빌드(프로덕션/preview)는 모든 JS가 빌드
      // 시점에 정적으로 번들링돼 있어 이 실패 자체가 발생하지 않는 dev-client 전용 케이스다.
      // 여기서 그냥 던지면 addActiveId()까지는 이미 반영됐는데도 폴링이 전혀 재개 안 된 채
      // 다음 포그라운드 전환까지 방치되므로, 실패 시 아래 백그라운드 폴링 경로로 폴백시켜
      // 최소한의 복구 수단을 보장한다.
      console.log('[NEARDEST 지오펜스] alarmService 동적 import 실패 — 백그라운드 폴링으로 폴백:', e?.message);
    }
  }

  // backgroundLocationTask.ts의 공용 함수를 그대로 재사용 — foregroundService 옵션 없이만
  // 시작하므로(Android 정책상 백그라운드에서 포그라운드 서비스 시작 불가) 여기서도 안전하고,
  // 2026-08-14(버그3/8)부터는 하드코딩된 30초 대신 getMinDesiredIntervalMs() 기준 동적
  // interval로 시작한다 — 방금 위에서 addActiveId()로 이 key를 추가했으니 그 값이 이미
  // 최솟값 계산에 반영된다. 이미 실행 중이면 내부에서 interval 변경 여부만 확인하고 필요
  // 시에만 재시작하므로 매번 호출해도 안전.
  console.log(`[NEARDEST 지오펜스] fallbackToPolling — 백그라운드 경로(startGpsPolling) 선택 — j:${journeyId ?? '-'} a:${appointmentId ?? '-'}`);
  await startGpsPolling().catch((e) => {
    console.log('[NEARDEST 지오펜스] 폴백 위치추적 시작 실패:', e?.message);
  });
}

TaskManager.defineTask(NEARDEST_GEOFENCE_TASK, async ({ data, error }) => {
  // eventType 로그 이후 다음 로그까지 25초 이상 비는 지연이 관측된 적 있었다 — 원인은
  // patchLocation()의 fetch()+AbortController 타임아웃이 JS setTimeout 기반이라 백그라운드에서
  // 제때 발동하지 않았던 것(XMLHttpRequest.timeout 네이티브 타임아웃으로 전환해 해결, 아래
  // patchLocation() 참고). t0 기준 단계별 경과 시간 로그는 앞으로도 지오펜스 관련 지연을
  // 진단할 때 계속 유용하므로 유지한다.
  const t0 = Date.now();
  console.log('[NEARDEST_GEOFENCE_TASK] 발화');
  if (error) {
    console.log('[NEARDEST_GEOFENCE_TASK] 에러:', JSON.stringify(error));
    return;
  }

  const sessionReady = await AsyncStorage.getItem(SESSION_READY_KEY);
  if (sessionReady !== '1') {
    console.log('[NEARDEST_GEOFENCE_TASK] 세션 미준비 — init() 완료 전 skip');
    return;
  }

  const { eventType, region } = (data as { eventType?: number; region?: Location.LocationRegion & { error?: string } }) ?? {};
  console.log(`[NEARDEST_GEOFENCE_TASK] +${Date.now() - t0}ms eventType:${eventType} region:${JSON.stringify(region)}`);

  // GONOW_PATCH(2026-08-13): expo-location 네이티브 패치(GeofencingTaskConsumer.kt)가
  // addGeofences() 등록 실패를 이 eventType(-1)으로 알려준다 — 원래는 실패해도 조용히
  // "성공"으로 믿었던 부분. 어느 key가 실패했는지는 특정 못 하므로(등록은 항상 전체
  // region 목록을 한 번에 보내는 방식), 현재 등록돼 있다고 믿는 모든 key를 안전하게
  // 폴링으로 되돌린다.
  if (eventType === -1) {
    const errorMsg = region?.error ?? 'unknown';
    console.log(`[NEARDEST_GEOFENCE_TASK] 지오펜스 등록 실패 감지 — ${errorMsg}`);
    await sendDebugNotification('지오펜스 등록 실패 감지', String(errorMsg));
    const affected = await loadRegions();
    const affectedKeys = Object.keys(affected);
    // key마다 exitNearDestGeofenceMode()를 반복 호출하면 그때마다 saveRegionsAndSync()가
    // "남은 목록으로" startGeofencingAsync를 다시 불러서, 지금 피하려는 "짧은 시간 재등록
    // 경쟁"(stop→start race)을 이 복구 코드 스스로 다시 만들게 된다 — 한 번에 통째로 비운다.
    await withRegionLock(async () => {
      await saveRegionsAndSync({});
      console.log(`[NEARDEST 지오펜스] 등록 실패로 전체 해제 완료 — 대상:${affectedKeys}`);
    });
    for (const affectedKey of affectedKeys) {
      const parsed = parseKey(affectedKey);
      await fallbackToPolling(parsed.journeyId, parsed.appointmentId);
    }
    return;
  }

  if (eventType !== Location.LocationGeofencingEventType.Exit || !region?.identifier) {
    console.log('[NEARDEST_GEOFENCE_TASK] EXIT 아니거나 identifier 없음 — skip');
    return;
  }

  const key = region.identifier;
  const { journeyId, appointmentId } = parseKey(key);
  if (journeyId == null && appointmentId == null) {
    console.log(`[NEARDEST_GEOFENCE_TASK] key 파싱 실패 — key:${key}`);
    return;
  }

  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) {
    console.log('[NEARDEST_GEOFENCE_TASK] 토큰 없음 — skip');
    return;
  }

  // 좌표 확보 — 원래는 캐시를 먼저 시도했으나(Doze 콜드스타트로 신규 GPS가 멈추면 복구 불가라는
  // 우려 때문), 2026-08-13 실측 테스트 목적상 정확도가 더 중요해서 순서를 뒤집었다: 신규 GPS를
  // 먼저 시도하고, 실패해야 캐시로 폴백한다. 그래도 "재시도 없는 단발 이벤트"라는 특성은
  // 그대로라 캐시 폴백 + fallbackToPolling()으로 이어지는 안전망은 유지한다.
  let coords: { latitude: number; longitude: number } | null = null;
  // EXIT 처리에 쓰인 좌표가 캐시(getLastKnownPositionAsync)에서 왔는지 신규 GPS 호출
  // (getCurrentPositionAsync)에서 왔는지 로그/디버그 알림에 남겨두기 위한 진단값 — 계속 유지.
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
    console.log(`[NEARDEST_GEOFENCE_TASK] +${Date.now() - t0}ms 좌표 획득 실패 — key:${key} 일반 폴링으로 폴백`);
    await sendDebugNotification('좌표 획득 실패 → 폴백', `key:${key}`);
    await exitNearDestGeofenceMode(key);
    await fallbackToPolling(journeyId, appointmentId);
    return;
  }
  console.log(`[NEARDEST_GEOFENCE_TASK] +${Date.now() - t0}ms 좌표 확보 완료(${coordSource}) — /location 호출 시작`);

  try {
    const response = journeyId != null
      ? await patchLocation(`/api/journeys/${journeyId}/location`, token, coords.latitude, coords.longitude)
      : await patchLocation(`/api/appointments/${appointmentId}/participants/location`, token, coords.latitude, coords.longitude);

    const status = journeyId != null ? response?.data?.journey_status : response?.data?.participant_status;
    const elapsed = Date.now() - t0;
    console.log(`[NEARDEST_GEOFENCE_TASK] +${elapsed}ms /location 응답 — key:${key} status:${status} 좌표출처:${coordSource} AppState:${AppState.currentState}`);
    // 2026-08-14(사용자 요청): 알림에서 "AppState:background" 같은 raw 값 대신, 화면에서 바로
    // 읽히는 "(포그라운드)"/"(백그라운드)" 표기로 제목 옆에 붙인다.
    const appStateLabel = AppState.currentState === 'active' ? '포그라운드' : '백그라운드';
    await sendDebugNotification(`EXIT 처리 완료 (${appStateLabel})`, `+${elapsed}ms key:${key} status:${status} 좌표출처:${coordSource === 'cache' ? '캐시' : '신규GPS'}`);

    await exitNearDestGeofenceMode(key);

    if (status === 'READY') {
      await fallbackToPolling(journeyId, appointmentId);
    }
    // NEARDEST(고정, P>=Q)면 아무것도 안 함 — 더 이상 위치로 할 수 있는 일이 없음
    // (/arrive 수동 확인이나 서버 스케줄러의 자동 ARRIVED만 남음)
  } catch (e) {
    console.log(`[NEARDEST_GEOFENCE_TASK] /location 호출 실패 — key:${key} 일반 폴링으로 폴백`, e);
    await sendDebugNotification('/location 호출 실패 → 폴백', `key:${key} 좌표출처:${coordSource === 'cache' ? '캐시' : '신규GPS'} 에러:${String(e)}`);
    await exitNearDestGeofenceMode(key);
    await fallbackToPolling(journeyId, appointmentId);
  }
});
