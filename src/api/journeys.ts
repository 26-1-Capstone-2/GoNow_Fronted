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
  };
};

export type JourneyDetail = {
  journey_id: number;
  journey_type: 'PERSONAL' | 'HOME';
  is_last_mode: boolean;
  plan_date: string;
  target_time: string;
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

export function ensureFutureDateTime(planDate: string, targetTime: string): { plan_date: string; target_time: string } {
  const now = new Date();
  if (new Date(targetTime) > now) return { plan_date: planDate, target_time: targetTime };

  const timePart = targetTime.split('T')[1];
  const d = new Date(planDate);
  do {
    d.setDate(d.getDate() + 1);
  } while (new Date(`${d.toISOString().split('T')[0]}T${timePart}`) <= now);

  const advancedDate = d.toISOString().split('T')[0];
  // plan_date는 캘린더 날짜 유지, target_time만 미래로 이동
  return { plan_date: planDate, target_time: `${advancedDate}T${timePart}` };
}

export function repeatDaysToMask(repeat: string[]): number {
  if (repeat.includes('안함') || repeat.length === 0) return 0;
  return repeat.reduce((acc, day) => acc | (DAY_BITS[day] ?? 0), 0);
}

export function maskToRepeatDays(mask: number): string[] {
  if (mask === 0) return ['안함'];
  return Object.entries(DAY_BITS)
    .filter(([, bit]) => mask & bit)
    .map(([day]) => day);
}

export function targetTimeToAmpmHourMinute(targetTime: string): { ampm: string; hour: string; minute: string } {
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
