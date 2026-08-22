import { router } from 'expo-router';
import { useAuthStore } from '@/src/store/authStore';

// 로컬 스프링으로 테스트하고 싶을 때: .env.local(gitignore 대상)에
// EXPO_PUBLIC_API_BASE_URL=http://<내 노트북 LAN IP>:8080 추가 후 Metro 재시작(npx expo start -c)
const defaultBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://gonow-api.uk';

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | null | Promise<string | null>;
};

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? defaultBaseUrl;

  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = options.getToken ? await options.getToken() : null;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status === 401) {
      useAuthStore.getState().setToken(null);
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
