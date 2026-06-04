import type { ApiClientOptions } from './client';
import { createApiClient } from './client';

export type LoginPayload = { email: string; password: string };

export type SignUpPayload = {
  email: string;
  password: string;
  nickname: string;
  home_name: string;
  home_address: string;
  home_lat: number;
  home_lng: number;
  preparation_time: number;
};

export type SignUpResponse = {
  success: boolean;
  message: string;
  data: null;
};

export type CheckResponse = {
  success: boolean;
  message: string;
  data: null;
};

export function createAuthApi(clientOptions?: ApiClientOptions) {
  const { request } = createApiClient(clientOptions);

  return {
    login: (body: LoginPayload) =>
      request<{ success: boolean; message: string; data: { member_id: number; access_token: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    signUp: (body: SignUpPayload) =>
      request<SignUpResponse>('/api/members', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    checkEmail: (email: string) =>
      request<CheckResponse>(`/api/members/check?email=${encodeURIComponent(email)}`),

    checkNickname: (nickname: string) =>
      request<CheckResponse>(`/api/members/check?nickname=${encodeURIComponent(nickname)}`),

    logout: () =>
      request<{ success: boolean; message: string; data: null }>('/api/auth/logout', {
        method: 'POST',
      }),
  };
}
