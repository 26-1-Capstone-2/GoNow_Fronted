import { getToken } from '@/src/store/authStore';
import { createApiClient } from './client';
import { TransportType } from './journeys';

export type CreateAppointmentPayload = {
  title?: string;
  plan_date: string;
  target_time: string;
  dest_name: string;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  transport_type: TransportType;
};

export type CreateAppointmentResponse = {
  success: boolean;
  message: string;
  data: {
    appointment_id: number;
    invite_code: string;
  } | null;
};

export type UpdateAppointmentPayload = {
  plan_date: string;
  target_time: string;
  dest_name: string;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  transport_type: TransportType;
};

export type UpdateAppointmentResponse = {
  success: boolean;
  message: string;
  data: null;
};

export type AppointmentParticipant = {
  member_id: number;
  nickname: string;
  transport_type: 'TRANSIT' | 'DRIVING';
  is_host: boolean;
};

export type AppointmentDetail = {
  appointment_id: number;
  plan_date: string;
  target_time: string;
  dest_name: string;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  invite_code: string;
  appointment_status: string;
  participants: AppointmentParticipant[];
};

export type GetAppointmentResponse = {
  success: boolean;
  message: string;
  data: AppointmentDetail | null;
};

export type DashboardParticipant = {
  nickname: string;
  transport_type: 'TRANSIT' | 'DRIVING';
  estimated_arrival: string;
  is_me: boolean;
};

export type DashboardData = {
  target_time: string;
  dest_name: string;
  participants: DashboardParticipant[];
};

export type GetDashboardResponse = {
  success: boolean;
  message: string;
  data: DashboardData | null;
};

export function createAppointmentsApi() {
  const { request } = createApiClient({ getToken });
  return {
    createAppointment: (payload: CreateAppointmentPayload) =>
      request<CreateAppointmentResponse>('/api/appointments', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateAppointment: (appointmentId: number, payload: UpdateAppointmentPayload) =>
      request<UpdateAppointmentResponse>(`/api/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    getAppointment: (appointmentId: number) =>
      request<GetAppointmentResponse>(`/api/appointments/${appointmentId}`, { method: 'GET' }),
    deleteAppointment: (appointmentId: number) =>
      request<{ success: boolean; message: string; data: null }>(
        `/api/appointments/${appointmentId}`,
        { method: 'DELETE' },
      ),
    updateParticipantTransport: (appointmentId: number, transport_type: TransportType) =>
      request<{ success: boolean; message: string; data: null }>(
        `/api/appointments/${appointmentId}/participants/transport`,
        { method: 'PATCH', body: JSON.stringify({ transport_type }) },
      ),
    joinAppointment: (invite_code: string, transport_type: TransportType) =>
      request<{ success: boolean; message: string; data: { appointment_id: number } | null }>(
        '/api/appointments/join',
        { method: 'POST', body: JSON.stringify({ invite_code, transport_type }) },
      ),
    removeParticipant: (appointmentId: number, targetMemberId: number) =>
      request<{ success: boolean; message: string; data: null }>(
        `/api/appointments/${appointmentId}/participants/${targetMemberId}`,
        { method: 'DELETE' },
      ),
    getDashboard: (appointmentId: number) =>
      request<GetDashboardResponse>(`/api/appointments/${appointmentId}/dashboard`, { method: 'GET' }),
    toggleParticipantAlarm: (appointmentId: number, is_active: boolean) =>
      request<{ status: boolean; message: string; data: null }>(
        `/api/appointments/${appointmentId}/participants/active`,
        { method: 'PATCH', body: JSON.stringify({ is_active }) },
      ),
  };
}
