import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// 카카오맵 공식 딥링크 스펙 기준 소문자 값(docs/planning/kakao-map-deeplink-spec.md 참고)
type TransportMode = 'publictransit' | 'car';
type ScreenMode = 'form' | 'searchOrigin' | 'searchDest';

const TRANSPORT_MODES: { mode: TransportMode; label: string; icon: string }[] = [
  { mode: 'publictransit', label: '대중교통', icon: 'navigation' },
  { mode: 'car', label: '자동차', icon: 'truck' },
];

interface ResolvedPlace {
  name: string;
  lat: string;
  lng: string;
}

export default function KakaoMapTestScreen() {
  const router = useRouter();
  const [view, setView] = useState<ScreenMode>('form');
  const [origin, setOrigin] = useState<ResolvedPlace | null>(null);
  const [dest, setDest] = useState<ResolvedPlace | null>(null);
  const [transportMode, setTransportMode] = useState<TransportMode>('publictransit');

  const handleUseCurrentLocation = async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('위치 권한 필요', '현재 위치를 쓰려면 위치 권한이 필요해요.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    setOrigin({
      name: '현재 위치',
      lat: String(loc.coords.latitude),
      lng: String(loc.coords.longitude),
    });
  };

  const handleOpenKakaoMap = () => {
    if (!origin || !dest) {
      Alert.alert('출발지/도착지 필요', '출발지와 도착지를 먼저 검색해서 선택해주세요.');
      return;
    }
    const url = `kakaomap://route?sp=${origin.lat},${origin.lng}&ep=${dest.lat},${dest.lng}&by=${transportMode}`;
    // 앱 미설치 시 웹 폴백 — 카카오 공식 문서의 "모바일웹 URL Scheme" 사용.
    // 앱 버전과 파라미터 구조가 동일(순수 십진수 좌표, 인코딩 불필요)해서 그대로 대응됨.
    // (docs/planning/kakao-map-deeplink-spec.md 참고)
    const webFallback = `http://m.map.kakao.com/scheme/route?sp=${origin.lat},${origin.lng}&ep=${dest.lat},${dest.lng}&by=${transportMode}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(webFallback).catch(() => {})
    );
  };

  if (view === 'searchOrigin' || view === 'searchDest') {
    const onSelect = (item: SearchResult) => {
      const resolved = { name: item.name, lat: String(item.lat), lng: String(item.lng) };
      if (view === 'searchOrigin') setOrigin(resolved);
      else setDest(resolved);
      setView('form');
    };
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setView('form')}>
            <Feather name="chevron-left" size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{view === 'searchOrigin' ? '출발지 검색' : '도착지 검색'}</Text>
          <View style={{ width: 36 }} />
        </View>
        <AddressSearchView onSelect={onSelect} placeholder="장소명, 지번, 도로명으로 검색" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="chevron-left" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>카카오맵 딥링크 테스트</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 출발지 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>출발지</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setView('searchOrigin')}>
            <Feather name="search" size={16} color="#888888" />
            <Text style={[styles.selectBtnText, origin && styles.selectBtnTextFilled]}>
              {origin ? origin.name : '출발지 검색'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.currentLocationBtn} onPress={handleUseCurrentLocation}>
            <Feather name="crosshair" size={14} color="#4A90D9" />
            <Text style={styles.currentLocationBtnText}>현재 위치로 채우기</Text>
          </TouchableOpacity>
          {origin && (
            <View style={styles.resolvedBox}>
              <Feather name="map-pin" size={14} color="#30D158" />
              <Text style={styles.resolvedText}>{origin.name} ({origin.lat}, {origin.lng})</Text>
            </View>
          )}
        </View>

        {/* 도착지 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>도착지</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setView('searchDest')}>
            <Feather name="search" size={16} color="#888888" />
            <Text style={[styles.selectBtnText, dest && styles.selectBtnTextFilled]}>
              {dest ? dest.name : '도착지 검색'}
            </Text>
          </TouchableOpacity>
          {dest && (
            <View style={styles.resolvedBox}>
              <Feather name="map-pin" size={14} color="#30D158" />
              <Text style={styles.resolvedText}>{dest.name} ({dest.lat}, {dest.lng})</Text>
            </View>
          )}
        </View>

        {/* 이동수단 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>이동수단</Text>
          <View style={styles.typeRow}>
            {TRANSPORT_MODES.map((item) => (
              <TouchableOpacity
                key={item.mode}
                style={[styles.typeBtn, transportMode === item.mode && { backgroundColor: '#4A90D9' }]}
                onPress={() => setTransportMode(item.mode)}
              >
                <Feather name={item.icon as any} size={18} color={transportMode === item.mode ? '#FFFFFF' : '#888888'} />
                <Text style={[styles.typeBtnLabel, transportMode === item.mode && { color: '#FFFFFF' }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 딥링크 실행 */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.goBtn} onPress={handleOpenKakaoMap} activeOpacity={0.7}>
            <Feather name="map" size={20} color="#FFFFFF" />
            <Text style={styles.goBtnText}>카카오맵으로 길찾기</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E0',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  scroll: { flex: 1, paddingHorizontal: 20 },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  selectBtnText: { fontSize: 14, color: '#BBBBBB' },
  selectBtnTextFilled: { color: '#1A1A1A', fontWeight: '500' },
  currentLocationBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, alignSelf: 'flex-start',
  },
  currentLocationBtnText: { fontSize: 13, color: '#4A90D9', fontWeight: '500' },
  resolvedBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E8F5E9', borderRadius: 8,
    padding: 10, marginTop: 10,
  },
  resolvedText: { fontSize: 12, color: '#30D158', fontWeight: '500', flexShrink: 1 },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#F5F5F5',
  },
  typeBtnLabel: { fontSize: 14, fontWeight: '600', color: '#888888' },
  goBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#1A1A1A', borderRadius: 14,
    paddingVertical: 16, marginBottom: 40,
  },
  goBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
