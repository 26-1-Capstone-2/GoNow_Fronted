import { AddressResult, PlaceResult, searchAll } from '@/src/api/kakao';
import { Feather } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

export interface SearchResult {
  id: string;
  name: string;
  address: string;
  isCurrent?: boolean;
  isHome?: boolean;
}

interface Props {
  initialResults?: SearchResult[];   // 초기 목록 (현재 설정된 주소 등)
  selectedId?: string;               // 현재 선택된 항목 id
  onSelect: (item: SearchResult) => void;
  placeholder?: string;
  selectedIsHome?: boolean;          // 선택된 항목을 집 아이콘으로 표시
}

export default function AddressSearchView({
  initialResults = [],
  selectedId,
  onSelect,
  placeholder = '지번, 도로명, 건물명으로 검색',
  selectedIsHome = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>(initialResults);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);

    if (text.trim() === '') {
      setResults(initialResults);
      return;
    }

    setLoading(true);
    try {
      const { places, addresses } = await searchAll(text);

      const combined: SearchResult[] = [
        ...places.map((p: PlaceResult) => ({
          id: `place_${p.id}`,
          name: p.place_name,
          address: p.road_address_name || p.address_name,
        })),
        ...addresses.map((a: AddressResult, i: number) => ({
          id: `addr_${i}`,
          name: a.road_address?.building_name || a.address_name,
          address: a.road_address?.address_name || a.address?.address_name || a.address_name,
        })),
      ].filter((r) => r.name);

      setResults(combined.length > 0 ? combined : []);
    } catch (e) {
      console.error('검색 오류:', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [initialResults]);

  return (
    <View style={styles.container}>
      {/* 검색창 */}
      <View style={styles.searchContainer}>
        <Feather name="search" size={15} color="#AAAAAA" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor="#BBBBBB"
          value={query}
          onChangeText={handleSearch}
          autoCorrect={false}
        />
        {loading && <ActivityIndicator size="small" color="#AAAAAA" style={{ marginRight: 4 }} />}
        {query.length > 0 && !loading && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults(initialResults); }}>
            <Feather name="x-circle" size={15} color="#AAAAAA" />
          </TouchableOpacity>
        )}
      </View>

      {/* 결과 리스트 */}
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>검색 결과가 없습니다.</Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => {
          const isSelected = selectedId === item.id;
          return (
            <TouchableOpacity style={styles.resultItem} onPress={() => onSelect(item)}>
              <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
                <Feather
                  name={isSelected && selectedIsHome ? 'home' : (item.isHome ? 'home' : 'map-pin')}
                  size={16}
                  color={isSelected ? '#FFFFFF' : '#AAAAAA'}
                />
              </View>
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  {item.isCurrent && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>현재 설정된 주소</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.address} numberOfLines={1}>{item.address}</Text>
              </View>
              {isSelected && <Feather name="check" size={18} color="#1A1A1A" />}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1A1A' },
  emptyContainer: { paddingTop: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#AAAAAA' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#E0E0E0', marginHorizontal: 16 },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#EEEEEE',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  iconWrapSelected: { backgroundColor: '#1A1A1A' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  name: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', flexShrink: 1 },
  address: { fontSize: 12, color: '#888888' },
  badge: { backgroundColor: '#E8F5E9', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, color: '#4CAF50', fontWeight: '500' },
});