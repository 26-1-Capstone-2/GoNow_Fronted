import { getToken } from '@/src/store/authStore';
import { createApiClient } from './client';

export type TransportType = 'TRANSIT' | 'DRIVING';

export type PersonalJourneyPayload = {
  title?: string;
  plan_date: string;
  target_time: string;
  dest_name: string;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  transport_type: TransportType;
  repeat_days: number;
};

export type HomeJourneyDeadlinePayload = {
  title?: string;
  is_last_mode: false;
  plan_date: string;
  target_time: string;
  dest_name: string;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  transport_type: TransportType;
  repeat_days: number;
};

export type HomeJourneyLastModePayload = {
  title?: string;
  is_last_mode: true;
  plan_date: string;
  dest_name: string;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  repeat_days: number;
};

export type HomeJourneyPayload = HomeJourneyDeadlinePayload | HomeJourneyLastModePayload;

export type JourneyStatus = 'SCHEDULED' | 'READY' | 'DEPARTING' | 'MOVING' | 'ARRIVED' | 'NEARDEST';

export type JourneyResponse = {
  success: boolean;
  message: string;
  data: {
    journey_id: number;
    journey_status: JourneyStatus;
  };
};

export type LocationResponse = {
  status: boolean;
  message: string;
  data: {
    journey_status: JourneyStatus;
    departure_alarm_time: string;
    preparation_time: number;
    interval: number | null;
    which_station: string | null;
    boarding_time: string | null;
  };
};

export type JourneyDetail = {
  journey_id: number;
  journey_type: 'PERSONAL' | 'HOME';
  is_last_mode: boolean;
  plan_date: string;
  // 막차 모드에서 서버가 아직 계산 전이면 null — 데드라인 모드는 항상 non-null
  target_time: string | null;
  dest_name: string;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  transport_type: TransportType;
  repeat_days: number;
  is_active: boolean;
};

export type JourneyDetailResponse = {
  success: boolean;
  message: string;
  data: JourneyDetail;
};

const DAY_BITS: Record<string, number> = {
  '월요일마다': 1,
  '화요일마다': 2,
  '수요일마다': 4,
  '목요일마다': 8,
  '금요일마다': 16,
  '토요일마다': 32,
  '일요일마다': 64,
};

// Date.getDay()(0=일~6=토) 인덱스 기준 — MainCalendarScreen.tsx의 DAY_TO_BIT와 동일한 매핑
const DAY_OF_WEEK_TO_BIT = [64, 1, 2, 4, 8, 16, 32];

// repeatDaysMask를 넘기면(반복 알람) 단순히 "다음 날"이 아니라 실제 반복 요일과 일치하면서
// 동시에 미래인 첫 날짜까지 전진한다 — 요일 체크 없이 하루씩만 전진하면(과거 버전의 버그)
// 반복 패턴과 무관한 날짜가 앵커(plan_date)가 되어버려 또 다른 유령 발생일을 만들 수 있다.
export function ensureFutureDateTime(planDate: string, targetTime: string, repeatDaysMask?: number): { plan_date: string; target_time: string } {
  const now = new Date();
  // 아직 안 지났으면 그대로 둔다 — plan_date가 repeat 요일과 안 맞아도(예: 다른 요일로 앵커를
  // 직접 고른 경우) 그건 정상 허용 범위(캘린더 표시 쪽에서 앵커는 항상 유효 발생일로 취급함) —
  // 여기서 강제로 맞추지 않는다. 아래 전진 로직은 "이미 지나서 어쩔 수 없이 옮겨야 할 때"만 탄다.
  if (new Date(targetTime) > now) return { plan_date: planDate, target_time: targetTime };
  const matchesRepeat = (d: Date) => !repeatDaysMask || (repeatDaysMask & DAY_OF_WEEK_TO_BIT[d.getDay()]) !== 0;

  const timePart = targetTime.split('T')[1];
  const d = new Date(planDate);
  do {
    d.setDate(d.getDate() + 1);
  } while (
    new Date(`${d.toISOString().split('T')[0]}T${timePart}`) <= now ||
    !matchesRepeat(d)
  );

  const advancedDate = d.toISOString().split('T')[0];
  // plan_date도 target_time과 같은 날짜로 함께 이동시킨다 — plan_date만 원래 날짜(예: 오늘)에
  // 남아있으면 "이미 지난 시각의 오늘"이 유효한 발생일처럼 취급돼버린다(2026-08-24 발견 —
  // 반복 알람 생성 시 오늘 시각이 이미 지났어도 생성이 통과하던 버그의 원인).
  return { plan_date: advancedDate, target_time: `${advancedDate}T${timePart}` };
}

export function repeatDaysToMask(repeat: string[]): number {
  if (repeat.includes('안함') || repeat.length === 0) return 0;
  return repeat.reduce((acc, day) => acc | (DAY_BITS[day] ?? 0), 0);
}

// 반복 알람의 앵커(plan_date)가 이미 지났을 때, "전체 관리" 목록 카드에 보여줄 다음 발생일을
// 계산한다. 오늘이 반복 요일에 해당하면 오늘 그대로 반환(서버가 이미 오늘 기준으로 상태를
// 갱신해뒀으므로 실시간 상태를 신뢰할 수 있음) — 오늘이 반복 요일이 아니면(예: 화요일→다음
// 월요일처럼 요일 사이 텀이 있는 경우) 다음으로 일치하는 미래 날짜까지 전진시킨다. 이 미래
// 날짜는 서버가 아직 계산한 적 없으므로, 호출부가 getAlarmTimeDisplay에 그대로 넘기면
// planDate > todayStr 분기를 타서 자연스럽게 D-day로 표시된다(캘린더의 "다가오는 일정"
// 위젯과 동일한 방식 — MainCalendarScreen.tsx의 DAY_TO_BIT 전개 로직 참고).
export function nextOccurrenceDate(anchor: string, repeatMask: number, now: Date = new Date()): string {
  const anchorKey = anchor.split('T')[0];
  if (!repeatMask) return anchorKey;
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (anchorKey >= todayKey) return anchorKey;
  if ((repeatMask & DAY_OF_WEEK_TO_BIT[now.getDay()]) !== 0) return todayKey;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  do {
    d.setDate(d.getDate() + 1);
  } while ((repeatMask & DAY_OF_WEEK_TO_BIT[d.getDay()]) === 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function maskToRepeatDays(mask: number): string[] {
  if (mask === 0) return ['안함'];
  return Object.entries(DAY_BITS)
    .filter(([, bit]) => mask & bit)
    .map(([day]) => day);
}

// maskToRepeatDays()가 돌려주는 문자열 배열을 "매일"/"주중"/"주말"/"월, 수" 같은 짧은
// 표시 라벨로 축약 — 알람 카드에 반복 요일을 보여주는 모든 화면이 공용으로 쓴다.
export function getRepeatLabel(repeat: string[]): string {
  if (repeat.includes('안함') || repeat.length === 0) return '안함';
  const weekdays = ['월요일마다', '화요일마다', '수요일마다', '목요일마다', '금요일마다'];
  const weekend = ['토요일마다', '일요일마다'];
  const all = [...weekdays, ...weekend];
  if (all.every((d) => repeat.includes(d))) return '매일';
  if (weekdays.every((d) => repeat.includes(d)) && repeat.length === weekdays.length) return '주중';
  if (weekend.every((d) => repeat.includes(d)) && repeat.length === weekend.length) return '주말';
  return repeat.map((r) => r.replace('요일마다', '')).join(', ');
}

export function targetTimeToAmpmHourMinute(targetTime: string | null): { ampm: string; hour: string; minute: string } {
  // targetTime이 null이면(막차 모드 계산 전) 호출부가 이 반환값을 화면에 안 쓰는 게 원칙 —
  // 그래도 타입상 항상 유효한 문자열을 돌려줘야 해서 안전한 자리표시자를 준다.
  if (targetTime == null) {
    return { ampm: '오전', hour: '12', minute: '00' };
  }
  const d = new Date(targetTime);
  const h = d.getHours();
  return {
    ampm: h < 12 ? '오전' : '오후',
    hour: String(h % 12 || 12),
    minute: String(d.getMinutes()).padStart(2, '0'),
  };
}

export function toTargetTime(planDate: string, ampm: string, hour: string, minute: string): string {
  let h = parseInt(hour, 10);
  if (ampm === '오전') {
    if (h === 12) h = 0;
  } else {
    if (h !== 12) h += 12;
  }
  return `${planDate}T${String(h).padStart(2, '0')}:${minute}:00`;
}

export function createJourneysApi() {
  const { request } = createApiClient({ getToken });

  return {
    createPersonal: (body: PersonalJourneyPayload) =>
      request<JourneyResponse>('/api/journeys/personal', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    updatePersonal: (journeyId: number, body: PersonalJourneyPayload) =>
      request<JourneyResponse>(`/api/journeys/personal/${journeyId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),

    getJourney: (journeyId: number) =>
      request<JourneyDetailResponse>(`/api/journeys/${journeyId}`, { method: 'GET' }),

    createHome: (body: HomeJourneyPayload) =>
      request<JourneyResponse>('/api/journeys/home', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    updateHome: (journeyId: number, body: HomeJourneyPayload) =>
      request<JourneyResponse>(`/api/journeys/home/${journeyId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),

    toggleActive: (journeyId: number, isActive: boolean) =>
      request<{ status: boolean; message: string; data: null }>(`/api/journeys/${journeyId}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: isActive }),
      }),

    deleteJourney: (journeyId: number) =>
      request<{ status: boolean; message: string; data: null }>(`/api/journeys/${journeyId}`, {
        method: 'DELETE',
      }),

    updateLocation: (journeyId: number, lat: number, lng: number) =>
      request<LocationResponse>(`/api/journeys/${journeyId}/location`, {
        method: 'PATCH',
        body: JSON.stringify({ lat, lng }),
      }),

    arrive: (journeyId: number) =>
      request<{ status: boolean; message: string; data: null }>(`/api/journeys/${journeyId}/arrive`, {
        method: 'PATCH',
      }),
  };
}
