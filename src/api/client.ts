import { router } from 'expo-router';
import { useAuthStore } from '@/src/store/authStore';
import { dlog } from '@/src/utils/deviceLogger';

// 로컬 스프링으로 테스트하고 싶을 때: .env.local(gitignore 대상)에
// EXPO_PUBLIC_API_BASE_URL=http://<내 노트북 LAN IP>:8080 추가 후 Metro 재시작(npx expo start -c)
const defaultBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://gonow-api.uk';

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | null | Promise<string | null>;
};

// 여러 요청이 거의 동시에 401을 맞아도(예: 앱이 포그라운드로 돌아오며 화면 여러 개가 한꺼번에 재조회)
// 재발급(reissue)은 한 번만 실행되도록 하는 단일 비행(single-flight) 잠금.
// 백엔드가 Refresh Token 회전(rotation) 방식이라 이 잠금이 없으면, 동시에 도착한 두 번째 재발급
// 요청은 첫 번째가 이미 교체해버린 옛 토큰을 들고 있어 실패 → 정상 유저도 로그아웃당하는 버그가 생김.
let reissuePromise: Promise<string | null> | null = null;

async function reissueAccessToken(baseUrl: string): Promise<string | null> {
  if (reissuePromise) {
    dlog('AUTH', '[reissue] 이미 진행 중인 재발급에 합류(single-flight)');
    return reissuePromise;
  }

  reissuePromise = (async () => {
    const { memberId, refreshToken } = useAuthStore.getState();
    if (!memberId || !refreshToken) {
      dlog('AUTH', '[reissue] memberId/refreshToken 없음 — 재발급 스킵, 로그인 화면으로');
      return null;
    }

    dlog('AUTH', `[reissue] 재발급 요청 시작 — memberId:${memberId}`);
    try {
      const res = await fetch(`${baseUrl}/api/auth/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ member_id: memberId, refresh_token: refreshToken }),
      });
      if (!res.ok) {
        dlog('AUTH', `[reissue] 서버 거부 — status:${res.status}`);
        return null;
      }

      const json = await res.json();
      const newAccessToken: string = json.data.access_token;
      const newRefreshToken: string = json.data.refresh_token;
      // 회전 방식 — 다음 재발급을 위해 새 Refresh Token으로 반드시 교체 저장해야 함
      useAuthStore.getState().setToken(newAccessToken);
      useAuthStore.getState().setRefreshToken(newRefreshToken);
      dlog('AUTH', '[reissue] 재발급 성공 — access/refresh 토큰 교체 완료');
      return newAccessToken;
    } catch (e) {
      dlog('AUTH', `[reissue] 네트워크 오류 — ${e}`);
      return null;
    }
  })();

  try {
    return await reissuePromise;
  } finally {
    reissuePromise = null;
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? defaultBaseUrl;

  async function request<T>(
    path: string,
    init: RequestInit = {},
    isRetry = false,
  ): Promise<T> {
    const token = options.getToken ? await options.getToken() : null;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });

    if (res.status === 401 && !isRetry) {
      dlog('AUTH', `[401] ${path} 요청이 401 — 재발급 시도`);
      // Access Token 만료 추정 — Refresh Token으로 재발급 성공 시 원 요청을 한 번만 재시도
      const newAccessToken = await reissueAccessToken(baseUrl);
      if (newAccessToken) {
        dlog('AUTH', `[401] 재발급된 토큰으로 ${path} 재시도`);
        return request<T>(path, init, true);
      }

      dlog('AUTH', '[401] 재발급 실패 — 로그아웃 처리, 로그인 화면으로 이동');
      useAuthStore.getState().setToken(null);
      useAuthStore.getState().setRefreshToken(null);
      useAuthStore.getState().setMemberId(null);
      router.replace('/(auth)/login');
      throw new Error('401 Unauthorized');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return { request, baseUrl };
}

export const api = createApiClient();

// request()는 실패 시 응답 바디 원문(JSON 문자열)을 그대로 Error.message에 담아 던진다.
// 여기서 그 문자열을 파싱해서 서버가 준 message 필드만 꺼내 화면에 보여줄 때 쓴다.
export function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) {
    try {
      const parsed = JSON.parse(e.message);
      if (typeof parsed?.message === 'string') return parsed.message;
    } catch {
      // JSON이 아니면 원문 그대로 사용
    }
    return e.message;
  }
  return fallback;
}
