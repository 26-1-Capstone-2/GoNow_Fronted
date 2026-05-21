import { AddressResult, PlaceResult, searchAll } from '@/src/api/kakao';
import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PanGestureHandler, PanGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';

export interface SearchResult {
  id: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  serverPlaceId?: number;
  isCurrent?: boolean;
  isHome?: boolean;
}

interface Props {
  initialResults?: SearchResult[];
  selectedId?: string;
  onSelect: (item: SearchResult) => void;
  onDeleteServerPlace?: (serverPlaceId: number) => void;
  placeholder?: string;
  selectedIsHome?: boolean;
}

const DELETE_WIDTH = 70;
const THRESHOLD = -50;

function SwipeableResultItem({
  item,
  isSelected,
  selectedIsHome,
  onSelect,
  onDelete,
  canDelete,
}: {
  item: SearchResult;
  isSelected: boolean;
  selectedIsHome: boolean;
  onSelect: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const dragX = useRef(0);

  const onGestureEvent = ({ nativeEvent }: PanGestureHandlerGestureEvent) => {
    if (!canDelete) return;
    const x = isOpen.current
      ? Math.min(0, Math.max(-DELETE_WIDTH, -DELETE_WIDTH + nativeEvent.translationX))
      : Math.min(0, Math.max(-DELETE_WIDTH, nativeEvent.translationX));
    dragX.current = x;
    translateX.setValue(x);
  };

  const onHandlerStateChange = ({ nativeEvent }: PanGestureHandlerGestureEvent) => {
    if (!canDelete) return;
    if (nativeEvent.state === State.END) {
      const shouldOpen = dragX.current < THRESHOLD || nativeEvent.velocityX < -800;
      if (shouldOpen) {
        Animated.spring(translateX, { toValue: -DELETE_WIDTH, useNativeDriver: true, overshootClamping: true }).start();
        isOpen.current = true;
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, overshootClamping: true }).start();
        isOpen.current = false;
      }
    }
  };

  const handleDelete = () => {
    Animated.timing(translateX, { toValue: -300, duration: 200, useNativeDriver: true }).start(() => {
      onDelete();
    });
  };

  return (
    <View style={{ position: 'relative' }}>
      {canDelete && (
        <Animated.View style={[
          styles.deleteBackground,
          {
            opacity: translateX.interpolate({
              inputRange: [-DELETE_WIDTH, 0],
              outputRange: [1, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}>
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
            <Feather name="trash" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>
      )}
      <PanGestureHandler
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onHandlerStateChange}
        activeOffsetX={[-8, 8]}
        failOffsetY={[-12, 12]}
        enabled={canDelete}
      >
        <Animated.View style={{ transform: [{ translateX }] }}>
          <TouchableOpacity style={styles.resultItem} onPress={onSelect}>
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
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}

export default function AddressSearchView({
  initialResults = [],
  selectedId,
  onSelect,
  onDeleteServerPlace,
  placeholder = '지번, 도로명, 건물명으로 검색',
  selectedIsHome = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>(initialResults);
  const [loading, setLoading] = useState(false);
  const isSearching = query.trim().length > 0;

  useEffect(() => {
    if (!isSearching) {
      setResults(initialResults);
    }
  }, [initialResults]);

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
          lat: parseFloat(p.y),
          lng: parseFloat(p.x),
        })),
        ...addresses.map((a: AddressResult, i: number) => ({
          id: `addr_${i}`,
          name: a.road_address?.building_name || a.address_name,
          address: a.road_address?.address_name || a.address?.address_name || a.address_name,
          lat: parseFloat(a.y),
          lng: parseFloat(a.x),
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

  const handleDelete = (id: string) => {
    const item = results.find((r) => r.id === id);
    if (item?.serverPlaceId) onDeleteServerPlace?.(item.serverPlaceId);
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <View style={styles.container}>
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
        renderItem={({ item }) => (
          <SwipeableResultItem
            item={item}
            isSelected={selectedId === item.id}
            selectedIsHome={selectedIsHome}
            onSelect={() => onSelect(item)}
            onDelete={() => handleDelete(item.id)}
            canDelete={!isSearching}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1A1A' },
  emptyContainer: { paddingTop: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#AAAAAA' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#E0E0E0', marginHorizontal: 16 },
  resultItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#EEEEEE',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  iconWrapSelected: { backgroundColor: '#1A1A1A' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  name: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', flexShrink: 1 },
  address: { fontSize: 12, color: '#888888' },
  badge: { backgroundColor: '#E8F5E9', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, color: '#4CAF50', fontWeight: '500' },
  deleteBackground: {
    position: 'absolute', right: 12,
    top: '50%', marginTop: -24,
    width: 48, height: 48,
    justifyContent: 'center', alignItems: 'center',
  },
  deleteBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#FF3B30',
    justifyContent: 'center', alignItems: 'center',
  },
});