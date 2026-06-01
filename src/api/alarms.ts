import { getToken } from '@/src/store/authStore';
import { createApiClient } from './client';
import { TransportType, JourneyStatus } from './journeys';

export type AlarmType = 'PERSONAL' | 'HOME' | 'GROUP';

export type AlarmItem = {
  alarm_type: AlarmType;
  journey_id: number | null;
  appointment_id: number | null;
  dest_name: string;
  plan_date: string;
  target_time: string;
  departure_alarm_time: string | null;
  transport_type: TransportType;
  is_active: boolean;
  is_last_mode: boolean;
  repeat_days: number | null;
  appointment_status: string | null;
  participant_count: number | null;
  my_status: JourneyStatus;
};

export type AlarmsResponse = {
  success: boolean;
  message: string;
  data: AlarmItem[] | null;
};

export function createAlarmsApi() {
  const { request } = createApiClient({ getToken });
  return {
    getAlarms: (date: string) =>
      request<AlarmsResponse>(`/api/alarms?date=${date}`, { method: 'GET' }),

    getAlarmsByType: (type: AlarmType) =>
      request<AlarmsResponse>(`/api/alarms?type=${type}`, { method: 'GET' }),
  };
}
