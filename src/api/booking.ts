import type { ApiClientOptions } from './client';
import { createApiClient } from './client';

export function createBookingApi(clientOptions?: ApiClientOptions) {
  const { request } = createApiClient(clientOptions);

  return {
    list: () => request<unknown[]>('/bookings', { method: 'GET' }),
    getById: (id: string) =>
      request<unknown>(`/bookings/${id}`, { method: 'GET' }),
  };
}
