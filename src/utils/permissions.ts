import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

/**
 * 안드로이드가 런타임 팝업으로 자동 승인해주지 않는 3가지 필수 설정(위치 항상 허용,
 * 정확한 알람, 배터리 최적화 제외) 중 위치 관련 확인/요청 + 알람/배터리 설정화면
 * 이동을 담당하는 헬퍼. iOS는 해당 제약이 없어 위치 권한만 의미가 있다.
 * (정확한 알람의 상태 "확인"은 notifee를 쓰는 `src/utils/notifications.ts`의
 * `getExactAlarmGranted()`에 있음 — 배터리는 상태 확인 API 자체가 없어서 이동만 가능)
 *
 * 알람/배터리는 앱 하나만 바로 찾아가는 화면이 있긴 하지만(각각 별도 매니페스트 권한
 * 선언 + 네이티브 모듈 필요, 배터리는 추가로 스토어 심사 리스크까지) 그 정도 편의 향상 대비
 * 부담이 커서, 전체 목록 화면으로 이동만 시키고 사용자가 직접 gonow를 찾게 하는
 * 가장 단순하고 안전한 방식을 쓴다. 순수 RN 코어 Linking만 사용 — 추가 패키지/재빌드 불필요.
 */

export type LocationAlwaysStatus = 'granted' | 'foregroundOnly' | 'denied';

// 위치 권한이 "항상 허용" 상태인지 확인 (foreground + background 둘 다 필요)
export async function getLocationAlwaysStatus(): Promise<LocationAlwaysStatus> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'foregroundOnly';
  return 'granted';
}

export interface RequestLocationResult {
  status: LocationAlwaysStatus;
  // 둘 다 false면 안드로이드가 반복 거부로 인해 팝업 자체를 더 이상 안 띄우는 상태 —
  // 이때는 설정 화면으로 안내해야 함 (버튼을 눌러도 아무 반응 없는 것처럼 보이는 원인)
  canAskAgain: boolean;
}

// 위치 권한 요청 (foreground 먼저, 그다음 background) — 안드로이드는 background 요청 시
// OS가 직접 설정 화면으로 보낼 수도 있음(기기/버전에 따라 팝업으로 안 뜰 수 있음)
export async function requestLocationAlways(): Promise<RequestLocationResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { status: 'denied', canAskAgain: fg.canAskAgain };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return {
    status: bg.status === 'granted' ? 'granted' : 'foregroundOnly',
    canAskAgain: bg.canAskAgain,
  };
}

// "정확한 알람" 설정 화면(전체 앱 목록)으로 이동 — 상태 확인 API는 없어서 이동만 제공.
export function openExactAlarmSettings(): void {
  if (Platform.OS !== 'android') return;
  // sendIntent는 Promise를 반환 — await 없이 fire-and-forget하려면 반드시 .catch로
  // 받아야 함(안 그러면 일부 기기에서 해당 화면이 없을 때 Unhandled Promise Rejection 발생)
  Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM').catch(() => {
    // 일부 기기/OS 버전에는 해당 화면이 없을 수 있음 — 무시
  });
}

// "배터리 최적화 제외" 목록 화면으로 이동 (앱 이름을 사용자가 직접 찾아서 눌러야 함)
export function openBatteryOptimizationSettings(): void {
  if (Platform.OS !== 'android') return;
  Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => {
    // 일부 기기/OS 버전에는 해당 화면이 없을 수 있음 — 무시
  });
}
