import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface AddressResult {
  id: string;
  name: string;
  address: string;
  isCurrent?: boolean;
}

const MOCK_RESULTS: AddressResult[] = [
  {
    id: '1',
    name: '우리집',
    address: '서울 어쩌고 저쩌고',
    isCurrent: true,
  },
];

interface Props {
  isOnboarding?: boolean; // true: 온보딩 플로우 / false: 설정에서 진입
}

export default function HomeAddressSetupScreen({ isOnboarding = false }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AddressResult | null>(MOCK_RESULTS[0]);
  const [searchResults, setSearchResults] = useState<AddressResult[]>(MOCK_RESULTS);

  const handleSearch = (text: string) => {
    setQuery(text);
    // TODO: 카카오 주소 API 연결
    if (text.trim() === '') setSearchResults(MOCK_RESULTS);
  };

  const handleComplete = () => {
    if (!selected) return;
    if (isOnboarding) {
      router.push('/(auth)/leave-time-setup');
    } else {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        {!isOnboarding && (
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="chevron-left" size={26} color="#1A1A1A" />
          </TouchableOpacity>
        )}
        <Text style={styles.title}>귀가지 설정</Text>
        {!isOnboarding && <View style={{ width: 34 }} />}
      </View>

      {/* 검색창 */}
      <View style={styles.searchContainer}>
        <Feather name="search" size={16} color="#AAAAAA" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="지번, 도로명, 건물명으로 검색"
          placeholderTextColor="#BBBBBB"
          value={query}
          onChangeText={handleSearch}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setSearchResults(MOCK_RESULTS); }}>
            <Feather name="x-circle" size={16} color="#AAAAAA" />
          </TouchableOpacity>
        )}
      </View>

      {/* 검색 결과 리스트 */}
      <FlatList
        data={searchResults}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.resultItem}
            onPress={() => setSelected(item)}
          >
            <View style={styles.iconContainer}>
              <Feather name="home" size={18} color="#555555" />
            </View>

            <View style={styles.addressInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.placeName}>{item.name}</Text>
                {item.isCurrent && (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>현재 설정된 주소</Text>
                  </View>
                )}
              </View>
              <Text style={styles.addressText}>{item.address}</Text>
            </View>

            {selected?.id === item.id && (
              <Feather name="check" size={20} color="#1A1A1A" />
            )}
          </TouchableOpacity>
        )}
      />

      {/* 완료 버튼 */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.completeButton, !selected && styles.completeButtonDisabled]}
          onPress={handleComplete}
          disabled={!selected}
        >
          <Text style={styles.completeButtonText}>완료</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    padding: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginVertical: 14,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1A1A' },
  list: { flex: 1, paddingHorizontal: 20 },
  separator: { height: 1, backgroundColor: '#F0F0F0' },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  addressInfo: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  placeName: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  currentBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  currentBadgeText: { fontSize: 10, color: '#4CAF50', fontWeight: '500' },
  addressText: { fontSize: 13, color: '#888888' },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  completeButtonDisabled: { backgroundColor: '#CCCCCC' },
  completeButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});