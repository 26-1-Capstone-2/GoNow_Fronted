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

// 대중교통 딥링크인데 출발지-목적지가 도보나 다름없는 거리면 대중교통 대신 도보(foot)로
// 연다 — 700m는 새로 정한 값이 아니라 플라스크 walk_fallback()(gps_api/core/transit_route.py의
// SHORT_DISTANCE_THRESHOLD_M)과 동일한 기준을 그대로 재사용한 것: 그 거리 이하면 ODsay
// 대중교통 검색 자체가 무의미하다고 이미 백엔드가 판단하고 있는 값이라 프론트도 같은
// 기준으로 판단하는 게 일관적이다. DRIVING(car)은 자차가 있는데 도보를 권할 이유가 없어
// 대상에서 제외.
const TRANSIT_WALK_FALLBACK_THRESHOLD_M = 700;

function haversineMeters(a: Coordinate, b: Coordinate): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function buildKakaoMapRouteUrls(origin: Coordinate, dest: Coordinate, mode: KakaoMapTransportMode | 'foot') {
  const params = `sp=${origin.lat},${origin.lng}&ep=${dest.lat},${dest.lng}&by=${mode}`;
  return {
    appUrl: `kakaomap://route?${params}`,
    // 앱 미설치 시 웹 폴백 — 카카오 공식 "모바일웹 URL Scheme". 파라미터 구조가 앱과 동일해서 그대로 대응됨.
    webFallbackUrl: `http://m.map.kakao.com/scheme/route?${params}`,
  };
}

// 길찾기 딥링크 버튼을 노출할 여정 상태 (docs/reference/kakao-map-deeplink-spec.md 2.1절 기준)
// READY(더 일찍 출발하고 싶은 사용자 편의)와 NEARDEST(목적지 100m 이내)도 노출 —
// 출발지=목적지에 가까운 경우 카카오맵이 에러 없이 "출발지와 도착지가 같은 곳이에요"
// 안내 메시지로 처리하는 것을 웹/실기기 앱 양쪽에서 확인해 노출 안 할 이유가 없다고 판단.
export const NAVIGABLE_STATUSES = ['READY', 'DEPARTING', 'MOVING', 'NEARDEST'];

/** 알람 카드 화면 6곳에 흩어져 있던 canNavigate 판정을 한 곳으로 통일 — 화면마다 조건이 어긋나는 걸 막기 위함. */
export function canNavigateAlarm(myStatus: string | null | undefined): boolean {
  return !!myStatus && NAVIGABLE_STATUSES.includes(myStatus);
}

/**
 * 알람 카드 화면 6곳에 흩어져 있던 handleNavigate(딥링크 오픈)를 한 곳으로 통일.
 * Promise를 반환하므로 호출부가 await해서 로딩 상태를 표시할 수 있다(매번 새로
 * GPS를 잡아 1~2초 걸릴 수 있음 — openKakaoMapRoute() 상단 주석 참고).
 */
export function handleNavigateAlarm(
  destLat: number | null | undefined,
  destLng: number | null | undefined,
  isDriving: boolean,
): Promise<boolean> {
  if (destLat == null || destLng == null) return Promise.resolve(false);
  return openKakaoMapRoute({ lat: destLat, lng: destLng }, toTransportMode(isDriving));
}

/**
 * 버튼을 누른 시점의 실시간 GPS를 출발지로, 저장된 목적지 좌표를 도착지로 카카오맵 길찾기를 연다.
 * 위치 권한이 없거나 GPS/딥링크 실행에 실패하면 사용자에게 안내하고 false를 반환한다.
 */
export async function openKakaoMapRoute(
  dest: Coordinate,
  mode: KakaoMapTransportMode,
): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('위치 권한 필요', '길찾기를 열려면 위치 권한이 필요해요.');
    return false;
  }

  let origin: Coordinate;
  try {
    // 이 버튼은 어쩌다 한 번 누르는 수동 액션이라(READY/DEPARTING/NEARDEST는 애초에
    // 폴링을 안 하고, MOVING도 폴링 주기가 3초~5분으로 가변적이라 캐시 신선도를 보장 못함
    // — journey-state-machine.md 참고) 캐시를 아예 안 쓰고 매번 새로 GPS를 잡는다.
    // 몇 초 지연은 이 사용 빈도에서 감수할 만한 트레이드오프 — 기왕 매번 새로 잡는 김에
    // 기본값(Balanced, ~100m)이 아니라 High로 정확도를 올린다. NEARDEST 100m/카카오
    // result_code 104(5m 이내 거부) 같은 좁은 임계값들과 비교하면 Balanced의 오차가
    // 결코 작지 않다(버그48 참고).
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    origin = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    Alert.alert('현재 위치를 가져올 수 없어요', '잠시 후 다시 시도해주세요.');
    return false;
  }

  const effectiveMode =
    mode === 'publictransit' && haversineMeters(origin, dest) < TRANSIT_WALK_FALLBACK_THRESHOLD_M
      ? 'foot'
      : mode;
  const { appUrl, webFallbackUrl } = buildKakaoMapRouteUrls(origin, dest, effectiveMode);
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
