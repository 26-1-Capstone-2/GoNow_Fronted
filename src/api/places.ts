import { getToken } from '@/src/store/authStore';
import { createApiClient } from './client';

export type PlaceType = 'HOME' | 'DEST';

export type SavedPlace = {
  place_id: number;
  place_type: PlaceType;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export type SavePlacePayload = {
  place_id: number;
  place_type: PlaceType;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

type PlacesApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

export function createPlacesApi() {
  const { request } = createApiClient({ getToken });

  return {
    getPlaces: (placeType?: PlaceType) => {
      const query = placeType ? `?place_type=${placeType}` : '';
      return request<PlacesApiResponse<SavedPlace[]>>(`/api/places${query}`);
    },

    savePlace: (body: SavePlacePayload) =>
      request<PlacesApiResponse<{ place_id: number }>>('/api/places', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    deletePlace: (placeId: number) =>
      request<PlacesApiResponse<null>>(`/api/places/${placeId}`, {
        method: 'DELETE',
      }),
  };
}
