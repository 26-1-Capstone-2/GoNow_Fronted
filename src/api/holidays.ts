const SERVICE_KEY = '여기에_일반인증키_인코딩_붙여넣기';
const BASE_URL = 'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService';

export interface Holiday {
  dateName: string;  // 공휴일 이름
  locdate: number;   // 날짜 (20260101 형식)
  isHoliday: string; // Y/N
}

export async function fetchHolidays(year: number, month: number): Promise<Holiday[]> {
  const url = `${BASE_URL}/getRestDeInfo?serviceKey=${SERVICE_KEY}&solYear=${year}&solMonth=${String(month).padStart(2, '0')}&_type=json&numOfRows=20`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const items = json?.response?.body?.items?.item;

    if (!items) return [];

    // 결과가 1개면 배열이 아닌 객체로 오는 경우 처리
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    console.error('공휴일 API 오류:', e);
    return [];
  }
}

// locdate(20260101) → 'YYYY-MM-DD' 변환
export function locdateToString(locdate: number): string {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}