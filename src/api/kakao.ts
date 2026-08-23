import { getToken } from '@/src/store/authStore';
import { createApiClient } from './client';

// 카카오 REST API 키는 APK 디컴파일로 추출될 수 있어(버그50) 프론트가 직접 들고 있지 않는다.
// 스프링 프록시(GET /api/places/search/address, /search/keyword)를 대신 호출한다 — 회원가입 중
// 로그인 전 단계(HomeAddressSetupScreen)에서도 호출되므로 이 두 엔드포인트는 인증 없이 허용됨.
const { request } = createApiClient({ getToken });

type KakaoProxyResponse<T> = {
  success: boolean;
  message: string;
  data: { documents: T[] };
};

// 주소 검색 결과 타입
export interface AddressResult {
  address_name: string;      // 전체 주소
  address_type: string;      // 주소 타입 (ROAD, REGION 등)
  x: string;                 // 경도
  y: string;                 // 위도
  address: {
    address_name: string;    // 지번 주소
    region_1depth_name: string;
    region_2depth_name: string;
    region_3depth_name: string;
  } | null;
  road_address: {
    address_name: string;    // 도로명 주소
    building_name: string;   // 건물명
    region_1depth_name: string;
    region_2depth_name: string;
    road_name: string;
  } | null;
}

// 장소 검색 결과 타입
export interface PlaceResult {
  id: string;
  place_name: string;        // 장소명
  category_name: string;     // 카테고리
  address_name: string;      // 지번 주소
  road_address_name: string; // 도로명 주소
  x: string;                 // 경도
  y: string;                 // 위도
  phone: string;
}

// 주소 검색 (지번, 도로명)
export async function searchAddress(query: string): Promise<AddressResult[]> {
  if (!query.trim()) return [];
  try {
    const json = await request<KakaoProxyResponse<AddressResult>>(
      `/api/places/search/address?query=${encodeURIComponent(query)}`
    );
    return json.data.documents ?? [];
  } catch (e) {
    console.error('주소 검색 오류:', e);
    return [];
  }
}

// 장소 검색 (키워드)
export async function searchPlace(query: string): Promise<PlaceResult[]> {
  if (!query.trim()) return [];
  try {
    const json = await request<KakaoProxyResponse<PlaceResult>>(
      `/api/places/search/keyword?query=${encodeURIComponent(query)}`
    );
    return json.data.documents ?? [];
  } catch (e) {
    console.error('장소 검색 오류:', e);
    return [];
  }
}

// 주소 + 장소 통합 검색
export async function searchAll(query: string): Promise<{
  places: PlaceResult[];
  addresses: AddressResult[];
}> {
  const [places, addresses] = await Promise.all([
    searchPlace(query),
    searchAddress(query),
  ]);
  return { places, addresses };
}

