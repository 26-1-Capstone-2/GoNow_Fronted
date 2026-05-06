const KAKAO_REST_API_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY;
const BASE_URL = 'https://dapi.kakao.com';

const headers = {
  Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`,
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
    const res = await fetch(
      `${BASE_URL}/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=10`,
      { headers }
    );
    const json = await res.json();
    return json.documents ?? [];
  } catch (e) {
    console.error('주소 검색 오류:', e);
    return [];
  }
}

// 장소 검색 (키워드)
export async function searchPlace(query: string): Promise<PlaceResult[]> {
    if (!query.trim()) return [];
    try {
      console.log('API KEY:', process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY);
      const res = await fetch(
        `${BASE_URL}/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=10`,
        { headers }
      );
      console.log('STATUS:', res.status);
      const json = await res.json();
      console.log('RESULT:', JSON.stringify(json));
      return json.documents ?? [];
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

