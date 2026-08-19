import { getToken } from '@/src/store/authStore';
import type { ApiClientOptions } from './client';
import { createApiClient } from './client';

export type UpdateHomePayload = {
  name: string;
  address: string;
  lat: string;
  lng: string;
};

export type PriorityType = 'MIN_TIME' | 'MIN_TRANSFER' | 'MIN_WALK' | 'MIN_WAIT';
export type TransitType = 'ALL' | 'SUBWAY' | 'BUS';

export type UpdateSettingPayload = {
  preparation_time: number;
  priority_type: PriorityType;
  transit_type: TransitType;
};

export type AlarmSoundMode = 'SOUND' | 'VIBRATE' | 'SILENT';

// 부분 업데이트 — 바뀐 필드만 보내면 됨(둘 다 필수 아님, 스프링도 null인 필드는 유지)
export type UpdateArrivalSoundPayload = {
  arrival_expected_sound_mode?: AlarmSoundMode;
  arrival_complete_sound_mode?: AlarmSoundMode;
};

export type MyProfile = {
  member_id: number;
  email: string;
  nickname: string;
  home_name: string;
  home_address: string;
  home_lat: number;
  home_lng: number;
  transit_type: TransitType;
  priority_type: PriorityType;
  preparation_time: number;
  arrival_expected_sound_mode: AlarmSoundMode;
  arrival_complete_sound_mode: AlarmSoundMode;
};

type MemberApiResponse = {
  success: boolean;
  message: string;
  data: null;
};

export function createMembersApi(clientOptions?: ApiClientOptions) {
  const { request } = createApiClient({
    getToken,
    ...clientOptions,
  });

  return {
    getMyProfile: () =>
      request<{ success: boolean; message: string; data: MyProfile }>('/api/members/me'),

    updateHome: (body: UpdateHomePayload) =>
      request<MemberApiResponse>('/api/members/me/home', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    updateSetting: (body: UpdateSettingPayload) =>
      request<MemberApiResponse>('/api/members/me/setting', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    updateArrivalSound: (body: UpdateArrivalSoundPayload) =>
      request<MemberApiResponse>('/api/members/me/arrival-sound', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    updateNickname: (nickname: string) =>
      request<MemberApiResponse>('/api/members/me/nickname', {
        method: 'PATCH',
        body: JSON.stringify({ nickname }),
      }),

    updatePassword: (current_password: string, new_password: string) =>
      request<MemberApiResponse>('/api/members/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ current_password, new_password }),
      }),

    registerFcmToken: (fcm_token: string) =>
      request<MemberApiResponse>('/api/members/me/fcm-token', {
        method: 'PATCH',
        body: JSON.stringify({ fcm_token }),
      }),
  };
}
