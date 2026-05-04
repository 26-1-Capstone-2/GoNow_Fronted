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

import { useAppNavigation } from '@/src/navigation';

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

export default function HomeAddressSetupScreen() {
  const { goToLeaveTimeSetup } = useAppNavigation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AddressResult | null>(MOCK_RESULTS[0]);
  const [searchResults, setSearchResults] = useState<AddressResult[]>(MOCK_RESULTS);

  const handleSearch = (text: string) => {
    setQuery(text);
    // TODO: 주소 검색 API 연결 (카카오 주소 API 등)
    if (text.trim() === '') {
      setSearchResults(MOCK_RESULTS);
    }
  };

  const handleSelect = (item: AddressResult) => {
    setSelected(item);
  };

  const handleComplete = () => {
    if (!selected) return;
    // TODO: 주소 저장 API 연동
    goToLeaveTimeSetup();
  };
  return (
    <SafeAreaView style={styles.container}>
      {/* 타이틀 */}
      <View style={styles.header}>
        <Text style={styles.title}>귀가지 설정</Text>
      </View>

      {/* 검색창 */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="지번, 도로명, 건물명으로 검색"
          placeholderTextColor="#BBBBBB"
          value={query}
          onChangeText={handleSearch}
        />
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
            onPress={() => handleSelect(item)}
          >
            <View style={styles.iconContainer}>
              <Text style={styles.houseIcon}>🏠</Text>
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
              <Text style={styles.checkIcon}>✓</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
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
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
  },
  list: {
    flex: 1,
    paddingHorizontal: 20,
  },
  separator: {
    height: 1,
    backgroundColor: '#F0F0F0',
  },
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
  houseIcon: {
    fontSize: 18,
  },
  addressInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  placeName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  currentBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 10,
    color: '#4CAF50',
    fontWeight: '500',
  },
  addressText: {
    fontSize: 13,
    color: '#888888',
  },
  checkIcon: {
    fontSize: 18,
    color: '#1A1A1A',
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  completeButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  completeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});