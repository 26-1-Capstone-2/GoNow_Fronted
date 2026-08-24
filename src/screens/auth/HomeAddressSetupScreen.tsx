import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import { createMembersApi } from '@/src/api/members';
import { usePlaces } from '@/src/hooks/usePlaces';
import { useSignUpStore } from '@/src/store/signUpStore';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const membersApi = createMembersApi();

interface Props {
  isOnboarding?: boolean;
}

export default function HomeAddressSetupScreen({ isOnboarding = false }: Props) {
  const router = useRouter();
  const setHomeInfo = useSignUpStore((s) => s.setHomeInfo);

  const { places, searchKey, loadPlaces, savePlace, deletePlace, resetSearch } = usePlaces('HOME');

  const [currentHome, setCurrentHome] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadAll = useCallback(async () => {
    const [profile] = await Promise.all([
      membersApi.getMyProfile(),
      loadPlaces(),
    ]);
    const home: SearchResult = {
      id: 'current',
      name: profile.data.home_name,
      address: profile.data.home_address,
      lat: profile.data.home_lat,
      lng: profile.data.home_lng,
      isCurrent: true,
      isHome: true,
    };
    setCurrentHome(home);
    setSelected(home);
  }, [loadPlaces]);

  useFocusEffect(
    useCallback(() => {
      if (isOnboarding) return;
      setSaved(false);
      loadAll().catch(() => {});
    }, [isOnboarding, loadAll]),
  );

  // 현재 귀가지 + 저장된 HOME 장소 (중복 제거)
  const combinedPlaces = currentHome
    ? [currentHome, ...places.filter((p) => p.name !== currentHome.name)]
    : places;

  const handleComplete = async () => {
    if (!selected) return;

    if (isOnboarding) {
      if (!selected.lat || !selected.lng) {
        Alert.alert('주소 오류', '검색을 통해 주소를 선택해주세요.');
        return;
      }
      setHomeInfo({
        home_name: selected.name,
        home_address: selected.address,
        home_lat: selected.lat,
        home_lng: selected.lng,
      });
      router.push('/(auth)/leave-time-setup');
    } else {
      if (!selected.lat || !selected.lng) {
        Alert.alert('주소 오류', '검색을 통해 주소를 선택해주세요.');
        return;
      }
      setLoading(true);
      try {
        await membersApi.updateHome({
          name: selected.name,
          address: selected.address,
          lat: String(selected.lat),
          lng: String(selected.lng),
        });
        await savePlace(selected);
        await loadAll();
        resetSearch();
        setSaved(true);
      } catch (e: any) {
        Alert.alert('저장 실패', e?.message ?? '다시 시도해주세요.');
      } finally {
        setLoading(false);
      }
    }
  };

  const isDisabled = !selected || loading;

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        {/* space-between인 header에서 title이 항상 정중앙에 오려면 양쪽에 항상 같은 폭의
            요소가 있어야 한다 — onboarding 모드에서 뒤로가기 버튼을 아예 안 그리면 자리만
            빈 View로라도 채워서 3칸 구조(왼쪽/제목/오른쪽)를 유지한다. */}
        {!isOnboarding ? (
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="chevron-left" size={26} color="#1A1A1A" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 34 }} />
        )}
        <Text style={styles.title}>귀가지 설정</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* 주소 검색 공통 컴포넌트 */}
      <AddressSearchView
        key={searchKey}
        initialResults={combinedPlaces}
        selectedId={selected?.id}
        onSelect={(item) => { setSelected(item); setSaved(false); }}
        onDeleteServerPlace={deletePlace}
        selectedIsHome
      />

      {/* 완료 버튼 */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.completeButton, isDisabled && styles.completeButtonDisabled]}
          onPress={handleComplete}
          disabled={isDisabled}
        >
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : saved
              ? <Feather name="check" size={20} color="#FFFFFF" />
              : <Text style={styles.completeButtonText}>{isOnboarding ? '다음' : '완료'}</Text>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  // space-between이어야 backButton이 왼쪽 끝에 고정되고, 양쪽 폭이 같은 backButton/스페이서
  // 사이에서 title만 진짜 정중앙에 온다 — center로 두면 셋을 한 묶음으로 가운데 몰아버려서
  // backButton까지 화면 중앙 쪽으로 끌려온다(2026-08-25, 앞선 수정에서 놓친 부분).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  // absolute로 빼면 header의 justifyContent:'center' 계산에서 backButton이 빠져서, 제목이
  // 오른쪽 스페이서(width:34) 폭만큼 왼쪽으로 치우쳐 보이는 버그가 있었다(2026-08-25 발견).
  backButton: { padding: 4 },
  title: { fontSize: 17, fontWeight: '600', color: '#1A1A1A' },
  footer: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  completeButton: {
    backgroundColor: '#FFCE0C', borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 48,
    minWidth: 140, alignItems: 'center',
  },
  completeButtonDisabled: { backgroundColor: '#CCCCCC' },
  completeButtonText: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
});
