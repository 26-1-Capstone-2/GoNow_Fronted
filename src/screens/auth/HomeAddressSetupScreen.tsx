import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const CURRENT_HOME: SearchResult = {
  id: 'current',
  name: '우리집',
  address: '서울 어쩌고 저쩌고',
  isCurrent: true,
  isHome: true,
};

interface Props {
  isOnboarding?: boolean;
}

export default function HomeAddressSetupScreen({ isOnboarding = false }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<SearchResult | null>(CURRENT_HOME);

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

      {/* 주소 검색 공통 컴포넌트 */}
      <AddressSearchView
        initialResults={[CURRENT_HOME]}
        selectedId={selected?.id}
        onSelect={(item) => setSelected(item)}
        selectedIsHome
      />

      {/* 완료 버튼 */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.completeButton, !selected && styles.completeButtonDisabled]}
          onPress={handleComplete}
          disabled={!selected}
        >
          <Text style={styles.completeButtonText}>{isOnboarding ? '다음' : '완료'}</Text>
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
  backButton: { position: 'absolute', left: 16, padding: 4 },
  title: { fontSize: 17, fontWeight: '600', color: '#1A1A1A' },
  footer: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  completeButton: {
    backgroundColor: '#4CAF50', borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 48,
  },
  completeButtonDisabled: { backgroundColor: '#CCCCCC' },
  completeButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});