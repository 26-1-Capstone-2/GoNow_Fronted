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

export type ExistsResponse = {
  success: boolean;
  message: string;
  data: { exists: boolean };
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

    // 항상 200으로 응답하고 data.exists 값만 다르다 — 회원가입 실시간 중복확인과
    // 비밀번호 찾기(계정 존재 확인) 공용. "중복이면 에러로 취급"은 호출부가 알아서 판단한다.
    checkEmail: (email: string) =>
      request<ExistsResponse>(`/api/members/check?email=${encodeURIComponent(email)}`),

    checkNickname: (nickname: string) =>
      request<ExistsResponse>(`/api/members/check?nickname=${encodeURIComponent(nickname)}`),

    sendEmailVerification: (email: string) =>
      request<CheckResponse>('/api/members/email-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),

    confirmEmailVerification: (email: string, code: string) =>
      request<CheckResponse>('/api/members/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      }),

    resetPassword: (email: string, newPassword: string) =>
      request<CheckResponse>('/api/members/password-reset', {
        method: 'PATCH',
        body: JSON.stringify({ email, new_password: newPassword }),
      }),

    logout: () =>
      request<{ success: boolean; message: string; data: null }>('/api/auth/logout', {
        method: 'POST',
      }),
  };
}
