import * as Location from 'expo-location';
import { Alert, Linking } from 'react-native';

// 카카오맵 공식 딥링크 스펙 기준 소문자 값 (docs/reference/kakao-map-deeplink-spec.md 참고)
export type KakaoMapTransportMode = 'car' | 'publictransit';

/** DRIVING 여부(boolean)를 카카오맵 딥링크 모드로 변환 — 호출부마다 반복되던 삼항연산자를 통일. */
export function toTransportMode(isDriving: boolean): KakaoMapTransportMode {
  return isDriving ? 'car' : 'publictransit';
}

interface Coordinate {
  lat: number;
  lng: number;
}

function buildKakaoMapRouteUrls(origin: Coordinate, dest: Coordinate, mode: KakaoMapTransportMode) {
  const params = `sp=${origin.lat},${origin.lng}&ep=${dest.lat},${dest.lng}&by=${mode}`;
  return {
    appUrl: `kakaomap://route?${params}`,
    // 앱 미설치 시 웹 폴백 — 카카오 공식 "모바일웹 URL Scheme". 파라미터 구조가 앱과 동일해서 그대로 대응됨.
    webFallbackUrl: `http://m.map.kakao.com/scheme/route?${params}`,
  };
}

// 이동 중(MOVING)에는 실제 위치가 빨리 바뀌므로 캐시 허용 시간을 짧게,
// 출발 전(DEPARTING, 사실상 정지 상태)에는 넉넉하게 잡는다.
// 폴링 엔진의 실시간 interval 값을 그대로 끌어다 쓰는 것도 고려했으나,
// 상태 기반 두 단계 구분만으로도 오차가 실용적으로 충분히 작아지고(자세한 논의는
// docs/reference/kakao-map-deeplink-spec.md 2.1절 참고) 새로운 연동 지점을 늘리지
// 않아도 돼서 이 방식으로 확정함.
export const NAVIGATE_CACHE_MAX_AGE_MS = { DEPARTING: 60000, MOVING: 20000 } as const;

/**
 * 버튼을 누른 시점의 실시간 GPS를 출발지로, 저장된 목적지 좌표를 도착지로 카카오맵 길찾기를 연다.
 * 위치 권한이 없거나 GPS/딥링크 실행에 실패하면 사용자에게 안내하고 false를 반환한다.
 *
 * @param maxAgeMs OS가 캐싱해둔 최근 위치를 얼마나 오래된 것까지 재사용할지(ms).
 *   짧을수록 정확하지만 새로 GPS를 잡아야 할 확률이 높아져 느려진다. 기본값 60초.
 */
export async function openKakaoMapRoute(
  dest: Coordinate,
  mode: KakaoMapTransportMode,
  maxAgeMs: number = 60000,
): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('위치 권한 필요', '길찾기를 열려면 위치 권한이 필요해요.');
    return false;
  }

  let origin: Coordinate;
  try {
    // 이 버튼은 DEPARTING/MOVING 상태에서만 뜨고, 그 구간은 앱이 이미 GPS를
    // 짧은 주기로 계속 폴링하고 있어서 OS가 캐싱해둔 최근 위치가 사실상 실시간에 가깝다.
    // getCurrentPositionAsync()는 매번 GPS를 새로 잡느라 몇 초씩 걸릴 수 있어서,
    // 캐시가 있으면 그걸 먼저 쓰고 없을 때만 새로 요청해 체감 속도를 높인다.
    const cached = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs });
    const loc = cached ?? await Location.getCurrentPositionAsync({});
    origin = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    Alert.alert('현재 위치를 가져올 수 없어요', '잠시 후 다시 시도해주세요.');
    return false;
  }

  const { appUrl, webFallbackUrl } = buildKakaoMapRouteUrls(origin, dest, mode);
  try {
    await Linking.openURL(appUrl);
    return true;
  } catch {
    try {
      await Linking.openURL(webFallbackUrl);
      return true;
    } catch {
      Alert.alert('카카오맵을 열 수 없어요', '잠시 후 다시 시도해주세요.');
      return false;
    }
  }
}
