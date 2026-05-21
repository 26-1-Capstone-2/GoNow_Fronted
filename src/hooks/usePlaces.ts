import { createPlacesApi, PlaceType, SavedPlace } from '@/src/api/places';
import { SearchResult } from '@/src/components/common/AddressSearchView';
import { useCallback, useState } from 'react';

const placesApi = createPlacesApi();

function toSearchResult(p: SavedPlace): SearchResult {
  return {
    id: `server_${p.place_id}`,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    serverPlaceId: p.place_id,
  };
}

function parseKakaoId(searchResultId: string): number {
  return searchResultId.startsWith('place_')
    ? parseInt(searchResultId.replace('place_', ''), 10)
    : 0;
}

export function usePlaces(placeType: PlaceType) {
  const [places, setPlaces] = useState<SearchResult[]>([]);
  const [searchKey, setSearchKey] = useState(0);

  const loadPlaces = useCallback(async () => {
    try {
      const res = await placesApi.getPlaces(placeType);
      setPlaces(res.data.map(toSearchResult));
    } catch {}
  }, [placeType]);

  const savePlace = useCallback(async (item: SearchResult): Promise<void> => {
    if (item.serverPlaceId || !item.lat || !item.lng) return;
    try {
      const res = await placesApi.savePlace({
        place_id: parseKakaoId(item.id),
        place_type: placeType,
        name: item.name,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
      });
      setPlaces((prev) => [
        ...prev,
        { ...toSearchResult({ place_id: res.data.place_id, place_type: placeType, name: item.name, address: item.address, lat: item.lat!, lng: item.lng! }) },
      ]);
    } catch {}
  }, [placeType]);

  const deletePlace = useCallback((serverPlaceId: number) => {
    placesApi.deletePlace(serverPlaceId).catch(() => {});
    setPlaces((prev) => prev.filter((p) => p.serverPlaceId !== serverPlaceId));
  }, []);

  const resetSearch = useCallback(() => {
    setSearchKey((k) => k + 1);
  }, []);

  return { places, searchKey, loadPlaces, savePlace, deletePlace, resetSearch };
}
