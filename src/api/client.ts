import { router } from 'expo-router';
import { useAuthStore } from '@/src/store/authStore';

const defaultBaseUrl = 'https://gonow-api.uk';

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
