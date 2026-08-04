import React from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { openChannelSettings } from '@/src/utils/permissions';
import {
  ChannelKey,
  getChannelId,
  requestNotificationPermission,
  resetAlarmChannel,
  sendAlarm,
  sendArrivalAlarm,
  sendArrivalCheckAlarm,
  sendArrivalConfirmAlarm,
} from '@/src/utils/notifications';

type CardDef = {
  key: ChannelKey;
  title: string;
  desc: string;
  color: string;
  canReset: boolean;
  onPreview: () => Promise<unknown>;
};

const DEPARTURE_CARDS: CardDef[] = [
  { key: 1, title: '🟢 1단계 — 여유 구간', desc: '기본: 잔잔한 벨 소리 · 진동 없음', color: '#2ECC71', canReset: true, onPreview: () => sendAlarm('personal', 1) },
  { key: 2, title: '🟡 2단계 — 주의 구간', desc: '기본: 가벼운 알림음 · 진동 있음', color: '#F39C12', canReset: true, onPreview: () => sendAlarm('personal', 2) },
  { key: 3, title: '🟠 3단계 — 위험 구간', desc: '기본: 강한 경고음 · 진동 있음', color: '#E67E22', canReset: true, onPreview: () => sendAlarm('personal', 3) },
  { key: 4, title: '🔴 4단계 — 임계 구간', desc: '기본: 가장 강한 경고음 3번 연속 발송 · 진동 있음', color: '#E74C3C', canReset: true, onPreview: () => sendAlarm('personal', 4) },
];

// 도착 3종 전부 canReset: false. 도착 예정/완료는 스프링이 채널ID를 고정값으로 알고 있어서
// (FCM 발송용) 초기화 버튼을 줄 수 없음(기술적 제약). 도착 여부 확인은 기술적으로는
// 초기화가 안전하지만(100% 로컬), 커스텀 사운드 없이 시스템 기본음만 쓰는 상태라 지킬 값이
// 없어 통일성을 위해 뺌 — 나중에 커스텀 사운드를 넣게 되면 이 카드만 다시 true로 바꾸면 됨.
const ARRIVAL_CARDS: CardDef[] = [
  {
    key: 'arrival-check',
    title: '📍 도착 여부 확인',
    desc: '기본: 시스템 기본음 · 진동 있음',
    color: '#4A90D9',
    canReset: false,
    onPreview: () => sendArrivalCheckAlarm('나', '테스트 목적지'),
  },
  {
    key: 'arrival-expected',
    title: '🏃 도착 예정 알림',
    desc: '기본: 시스템 기본음 · 진동 있음 (그룹원에게 FCM으로 발송)',
    color: '#9B59B6',
    canReset: false,
    onPreview: () => sendArrivalAlarm('나', '오후 3시 20분', '테스트 목적지'),
  },
  {
    key: 'arrival-complete',
    title: '✅ 도착 완료 알림',
    desc: '기본: 시스템 기본음 · 진동 있음 (그룹원에게 FCM으로 발송)',
    color: '#27AE60',
    canReset: false,
    onPreview: () => sendArrivalConfirmAlarm('나', '오후 3시 20분', '테스트 목적지'),
  },
];

export default function AlarmSoundSettingsScreen() {
  const router = useRouter();

  const handlePreview = async (card: CardDef) => {
    const { granted } = await requestNotificationPermission();
    if (!granted) return; // 미리듣기라 별도 안내 없이 조용히 무시(허용 안 함이면 그냥 재생만 안 됨)
    await card.onPreview();
  };

  const handleOpenSettings = async (key: ChannelKey) => {
    const channelId = await getChannelId(key);
    openChannelSettings(channelId);
  };

  const handleReset = (key: ChannelKey, title: string) => {
    Alert.alert(
      '기본값으로 초기화',
      `${title}의 소리/진동을 앱 기본값으로 되돌릴까요? 직접 설정한 내용은 사라져요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '초기화',
          style: 'destructive',
          onPress: () => resetAlarmChannel(key).catch(() => {}),
        },
      ],
    );
  };

  const renderCard = (card: CardDef) => (
    <View key={card.key} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{card.title}</Text>
        <TouchableOpacity
          style={[styles.previewButton, { backgroundColor: card.color }]}
          onPress={() => handlePreview(card)}
          hitSlop={8}
        >
          <Feather name="play" size={13} color="#FFFFFF" />
          <Text style={styles.previewButtonText}>미리듣기</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.cardDesc}>{card.desc}</Text>
      {Platform.OS === 'android' && Number(Platform.Version) >= 26 && (
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleOpenSettings(card.key)}>
            <Text style={styles.actionButtonText}>소리/진동 변경</Text>
          </TouchableOpacity>
          {card.canReset && (
            <TouchableOpacity style={styles.resetButton} onPress={() => handleReset(card.key, card.title)}>
              <Text style={styles.resetButtonText}>기본값으로 초기화</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {Platform.OS === 'android' && Number(Platform.Version) < 26 && (
        <Text style={styles.unsupportedText}>안드로이드 8.0 미만 지원 X</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Feather name="chevron-left" size={26} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.title}>알람 소리 설정</Text>
        <View style={{ width: 26 }} />
      </View>

      <Text style={styles.subtitle}>
        단계마다 기본 소리가 이미 설정돼 있어요. 원하시면 각 항목의 소리/진동을 직접 바꿀 수 있어요.
      </Text>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>출발</Text>
        {DEPARTURE_CARDS.map(renderCard)}

        <Text style={styles.sectionTitle}>도착</Text>
        {ARRIVAL_CARDS.map(renderCard)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  subtitle: {
    fontSize: 13,
    color: '#888888',
    lineHeight: 19,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#AAAAAA',
    marginTop: 8,
    marginBottom: 2,
  },
  card: {
    backgroundColor: '#F5F5F5',
    borderRadius: 16,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  previewButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  cardDesc: { fontSize: 13, color: '#666666', lineHeight: 19, marginTop: 6 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 12 },
  actionButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  actionButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  resetButton: { alignSelf: 'flex-start', paddingVertical: 8 },
  resetButtonText: { color: '#888888', fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  unsupportedText: { marginTop: 10, fontSize: 12, color: '#AAAAAA' },
});
