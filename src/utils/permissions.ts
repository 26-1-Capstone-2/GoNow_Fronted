import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Alert, Linking, Platform } from 'react-native';

import BatteryOptimizationModule from '@/modules/battery-optimization';
import UnusedAppRestrictionsModule from '@/modules/unused-app-restrictions';
import WifiScanStatusModule from '@/modules/wifi-scan-status';
import { ROUTES } from '@/src/navigation/routes';
import { getNotificationPermissionGranted } from '@/src/utils/notifications';

/**
 * 안드로이드가 런타임 팝업으로 자동 승인해주지 않는 필수 설정(위치 항상 허용, 정확한 알람,
 * 배터리 최적화 제외, 사용하지 않는 앱 관리, Wi-Fi 찾기) 중 위치 관련 확인/요청 + 각종
 * 설정화면 이동을 담당하는 헬퍼. iOS는 해당 제약이 없어 위치 권한만 의미가 있다.
 * (정확한 알람의 상태 "확인"은 notifee를 쓰는 `src/utils/notifications.ts`의
 * `getExactAlarmGranted()`에 있음 — 배터리/사용하지 않는 앱 관리/Wi-Fi 찾기 상태 확인은
 * 각각 로컬 네이티브 모듈(`modules/battery-optimization`, `modules/unused-app-restrictions`,
 * `modules/wifi-scan-status`) 사용, 재빌드 필요)
 *
 * 정확한 알람/배터리는 앱 하나만 바로 찾아가는 화면이 있긴 하지만(각각 별도 매니페스트
 * 권한 선언 + 네이티브 모듈 필요, 배터리는 추가로 스토어 심사 리스크까지) 그 정도 편의
 * 향상 대비 부담이 커서, 전체 목록 화면으로 이동만 시키고 사용자가 직접 gonow를 찾게 하는
 * 가장 단순하고 안전한 방식을 쓴다. 순수 RN 코어 Linking만 사용 — 추가 패키지/재빌드 불필요.
 * (반면 사용하지 않는 앱 관리는 구글이 공식 제공하는 앱 전용 딥링크라 이 리스크가 없어서
 * 네이티브 모듈로 바로 앱 화면까지 이동시킨다 — 아래 `openUnusedAppRestrictionsSettings` 참고)
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

// 기기 전체의 위치(GPS) 서비스 자체가 켜져 있는지 확인 — 앱별 권한("항상 허용")과는
// 별개 개념. 권한이 있어도 기기 위치 서비스(상단바 GPS 토글)가 꺼져 있으면 좌표를 못
// 가져옴(비행기 모드를 켜면 대부분 같이 꺼짐).
export async function getLocationServicesEnabled(): Promise<boolean> {
  return Location.hasServicesEnabledAsync();
}

// 기기 전체의 위치(GPS) 서비스 켜기/끄기 화면으로 바로 이동.
export function openLocationServiceSettings(): void {
  if (Platform.OS !== 'android') return;
  Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => {
    // 일부 기기/OS 버전에는 해당 화면이 없을 수 있음 — 앱 설정 화면으로라도 보냄
    Linking.openSettings().catch(() => {});
  });
}

// "위치 서비스"(Wi-Fi/블루투스 찾기 등 정확도 향상 옵션) 화면으로 바로 이동 시도.
// LOCATION_SCANNING_SETTINGS는 AOSP 소스에 실존하지만 @hide(비공개 API)라 기기/OS
// 버전에 따라 없을 수 있음 — 실패하면 기존처럼 "위치" 최상위 화면으로 폴백(그 안에서
// 한 단계 더 들어가야 함, 일부 제조사 UI는 이마저도 필요할 수 있음).
export function openLocationScanningSettings(): void {
  if (Platform.OS !== 'android') return;
  Linking.sendIntent('android.settings.LOCATION_SCANNING_SETTINGS').catch(() => {
    openLocationServiceSettings();
  });
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

// 알람 생성/수정 시점에 확인하는 핵심 권한 2가지 — 위치(항상 허용)와 알림. 이 둘이 없으면
// 알람이 절대 작동할 수 없음(완전 무음)이라, 저장 직전에 막고 유도한다. 위치 서비스(GPS
// 토글)는 일부러 여기 포함 안 함 — 배터리 아끼려고 자주 껐다 켜는 값이라 "지금 꺼져있음"이
// "알람 실행 시점에도 꺼져있을 것"을 의미하지 않기 때문(실행 시점에 alarmService.ts가
// 별도로 재확인함). 위치 권한/알림 권한은 한 번 꺼지면 웬만해선 계속 꺼져있는 안정적인
// 상태라 생성 시점 체크가 의미 있음.
//
// 여기서 직접 OS 권한 팝업을 띄우지 않고 조회만 한다(getNotificationPermissionGranted/
// getLocationAlwaysStatus 둘 다 팝업 없이 현재 상태만 확인). "저장" 버튼을 누르자마자
// 맥락 없이 시스템 다이얼로그가(위치는 심하면 다이얼로그 → 시스템 설정 화면 자동 이동까지)
// 튀어나오는 게 사용자 입장에서 뜬금없고, 알림/위치가 둘 다 꺼져있으면 하나 고칠 때마다
// 저장을 다시 눌러야 하는 문제도 있었다. 대신 뭐가 꺼져있든 항상 같은 안내 Alert 하나만
// 띄우고 "필수 권한 설정" 화면(PermissionSetupScreen)으로 보내서, 이미 있는 상태 배지 +
// 개별 허용 버튼으로 몇 개가 꺼져있든 한 번에 다 고치게 한다.
export async function checkCoreAlarmPermissions(): Promise<boolean> {
  const notificationGranted = await getNotificationPermissionGranted();
  const locationStatus = await getLocationAlwaysStatus();

  if (notificationGranted && locationStatus === 'granted') return true;

  Alert.alert(
    '필수 권한 필요',
    '알람이 정확히 울리려면 알림·위치 권한이 모두 켜져 있어야 해요. 필수 권한 설정 화면에서 확인해주세요.',
    [
      { text: '취소', style: 'cancel' },
      { text: '권한 설정으로 이동', onPress: () => router.push(ROUTES.permissionSetup) },
    ],
  );
  return false;
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

// 배터리 최적화 제외 상태 확인 — 로컬 네이티브 모듈(modules/battery-optimization)이
// PowerManager.isIgnoringBatteryOptimizations()를 감싸서 제공. iOS는 해당 개념이
// 없어 항상 true(제약 없음으로 간주).
export function getBatteryOptimizationIgnored(): boolean {
  if (Platform.OS !== 'android') return true;
  try {
    return BatteryOptimizationModule.isIgnoringBatteryOptimizations();
  } catch {
    // 재빌드 전(네이티브 모듈 미연결) 등 예외 상황 — 미확인 상태를 false로 취급
    return false;
  }
}

// "Wi-Fi 찾기"(Wi-Fi가 꺼져 있어도 위치 정확도를 위해 스캔) 상태 확인 — 로컬 네이티브
// 모듈(modules/wifi-scan-status)이 WifiManager.isScanAlwaysAvailable()을 감싸서 제공.
// 전용 딥링크 화면은 따로 없어 기존 위치 서비스 설정 화면(openLocationServiceSettings)을
// 그대로 재사용 — 거기서 "정확도 향상" 섹션까지 한 단계만 더 들어가면 됨. iOS는 해당 개념 없음.
export function getWifiScanAlwaysAvailable(): boolean {
  if (Platform.OS !== 'android') return true;
  try {
    return WifiScanStatusModule.isScanAlwaysAvailable();
  } catch {
    // 재빌드 전(네이티브 모듈 미연결) 등 예외 상황 — 미확인 상태를 false로 취급
    return false;
  }
}

// "사용하지 않는 앱 관리"(미사용 시 권한 자동 삭제) 상태 확인 — 로컬 네이티브 모듈
// (modules/unused-app-restrictions)이 androidx PackageManagerCompat.
// getUnusedAppRestrictionsStatus()를 감싸서 제공.
export async function getUnusedAppRestrictionsDisabled(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const enabled = await UnusedAppRestrictionsModule.isRestrictionEnabled();
    return !enabled;
  } catch {
    // 재빌드 전(네이티브 모듈 미연결) 등 예외 상황 — 미확인 상태를 false로 취급
    return false;
  }
}

// "사용하지 않는 앱 관리" 화면(gonow 전용)으로 바로 이동 — 배터리 최적화 요청 인텐트와
// 달리 별도 매니페스트 권한/스토어 심사 리스크가 없는 구글 공식 권장 패턴이라 앱 전용
// 화면으로 바로 보낼 수 있음(전체 목록에서 사용자가 직접 찾을 필요 없음).
export function openUnusedAppRestrictionsSettings(): void {
  if (Platform.OS !== 'android') return;
  try {
    UnusedAppRestrictionsModule.openSettings();
  } catch {
    // 재빌드 전(네이티브 모듈 미연결) 등 예외 상황 — 무시
  }
}

// 특정 알림 채널의 시스템 설정 화면(소리/진동 변경)으로 바로 이동.
// REQUEST_SCHEDULE_EXACT_ALARM/IGNORE_BATTERY_OPTIMIZATION_SETTINGS와 달리 이 인텐트는
// extras로 앱+채널을 직접 지정할 수 있어서, 전체 목록이 아니라 그 채널 화면으로 바로 진입함.
export function openChannelSettings(channelId: string): void {
  if (Platform.OS !== 'android') return;
  const packageName = Constants.expoConfig?.android?.package ?? 'com.hyeongwon.gonow';
  Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
    { key: 'android.provider.extra.APP_PACKAGE', value: packageName },
    { key: 'android.provider.extra.CHANNEL_ID', value: channelId },
  ]).catch(() => {
    // 극히 일부 기기/롬엔 채널 설정 화면이 없을 수 있음 — 앱 설정 화면으로라도 보내서
    // 완전히 아무 반응 없는 상태는 피함(거기서 "알림" 한 단계만 더 들어가면 됨)
    Linking.openSettings().catch(() => {});
  });
}
