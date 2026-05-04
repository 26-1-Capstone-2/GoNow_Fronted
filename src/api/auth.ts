import type { ApiClientOptions } from './client';
import { createApiClient } from './client';

export type LoginPayload = { email: string; password: string };

export function createAuthApi(clientOptions?: ApiClientOptions) {
  const { request } = createApiClient(clientOptions);

  return {
    login: (body: LoginPayload) =>
      request<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  };
}
