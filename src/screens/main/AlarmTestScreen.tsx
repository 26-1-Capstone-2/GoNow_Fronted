import { AlarmStage, AlarmType, requestNotificationPermission, sendAlarm, sendAllArrivalAlarms, sendArrivalAlarm, sendArrivalCheckAlarm, sendArrivalConfirmAlarm } from '@/src/utils/notifications';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import notifee from '@notifee/react-native';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const ALARM_TYPES: { type: AlarmType; label: string; color: string; icon: string }[] = [
  { type: 'personal', label: '개인', color: '#4A90D9', icon: 'user' },
  { type: 'group', label: '그룹', color: '#9B59B6', icon: 'users' },
  { type: 'home', label: '귀가', color: '#27AE60', icon: 'home' },
];

const SAMPLE_MEMBERS = [
  { name: '나나나', arrivalTime: '오후 7시 3분' },
  { name: '다다다', arrivalTime: '오후 6시 58분' },
];

const STAGES: { stage: AlarmStage; label: string; desc: string; color: string }[] = [
  { stage: 1, label: '1단계', desc: '여유 구간 · 배너/약한 소리', color: '#2ECC71' },
  { stage: 2, label: '2단계', desc: '주의 구간 · 일반 알림', color: '#F39C12' },
  { stage: 3, label: '3단계', desc: '위험 구간 · 소리+진동', color: '#E67E22' },
  { stage: 4, label: '4단계', desc: '임계 구간 · 강한소리+반복진동', color: '#E74C3C' },
];

export default function AlarmTestScreen() {
  const router = useRouter();
  const [hasPermission, setHasPermission] = useState(false);
  const [selectedType, setSelectedType] = useState<AlarmType>('personal');
  const [lastSent, setLastSent] = useState<string>('');
  const [sentIds, setSentIds] = useState<Partial<Record<AlarmStage, string[]>>>({});

  useEffect(() => {
    requestNotificationPermission().then(({ granted }) => setHasPermission(granted));
  }, []);

  const handleSend = async (stage: AlarmStage) => {
    if (!hasPermission) {
      const { granted } = await requestNotificationPermission();
      if (!granted) {
        Alert.alert('알림 권한 필요', '설정에서 알림 권한을 허용해주세요.');
        return;
      }
      setHasPermission(true);
    }

    const destination = selectedType === 'personal' ? '중앙대학교 후문' :
                        selectedType === 'group' ? '홍대역 2번 출구' : '우리집';

    const ids = await sendAlarm(selectedType, stage, destination);
    setSentIds((prev) => ({ ...prev, [stage]: [...(prev[stage] ?? []), ...ids] }));
    setLastSent(`${ALARM_TYPES.find(t => t.type === selectedType)?.label} ${stage}단계 알람 전송됨`);
  };

  const handleDismiss = async (stage: AlarmStage) => {
    const ids = sentIds[stage] ?? [];
    for (const id of ids) {
      try { await notifee.cancelNotification(id); } catch {}
    }
    setSentIds((prev) => { const next = { ...prev }; delete next[stage]; return next; });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="chevron-left" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>알람 테스트</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* 권한 상태 */}
        <View style={[styles.permissionBadge, { backgroundColor: hasPermission ? '#E8F5E9' : '#FFEBEE' }]}>
          <Feather name={hasPermission ? 'check-circle' : 'alert-circle'} size={16} color={hasPermission ? '#4CAF50' : '#F44336'} />
          <Text style={[styles.permissionText, { color: hasPermission ? '#4CAF50' : '#F44336' }]}>
            {hasPermission ? '알림 권한 허용됨' : '알림 권한 없음 — 탭해서 요청'}
          </Text>
        </View>

        {/* 알람 타입 선택 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>알람 유형</Text>
          <View style={styles.typeRow}>
            {ALARM_TYPES.map((item) => (
              <TouchableOpacity
                key={item.type}
                style={[styles.typeBtn, selectedType === item.type && { backgroundColor: item.color }]}
                onPress={() => setSelectedType(item.type)}
              >
                <Feather name={item.icon as any} size={18} color={selectedType === item.type ? '#FFFFFF' : '#888888'} />
                <Text style={[styles.typeBtnLabel, selectedType === item.type && { color: '#FFFFFF' }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 단계별 알람 버튼 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>단계별 테스트</Text>
          {STAGES.map((item) => (
            <TouchableOpacity
              key={item.stage}
              style={[styles.stageBtn, { borderLeftColor: item.color }]}
              onPress={() => handleSend(item.stage)}
              activeOpacity={0.7}
            >
              <View style={[styles.stageBadge, { backgroundColor: item.color }]}>
                <Text style={styles.stageBadgeText}>{item.stage}</Text>
              </View>
              <View style={styles.stageInfo}>
                <Text style={styles.stageBtnLabel}>{item.label}</Text>
                <Text style={styles.stageBtnDesc}>{item.desc}</Text>
              </View>
              <Feather name="bell" size={18} color={item.color} />
              {sentIds[item.stage] && (
                <TouchableOpacity
                  style={styles.dismissBtn}
                  onPress={() => handleDismiss(item.stage)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={14} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* 전체 시나리오 테스트 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>전체 시나리오 (5초 간격)</Text>
          <TouchableOpacity
            style={styles.scenarioBtn}
            onPress={async () => {
              for (let i = 1; i <= 4; i++) {
                await new Promise(res => setTimeout(res, (i - 1) * 5000));
                await handleSend(i as AlarmStage);
              }
              setLastSent('전체 시나리오 시작됨 (20초 소요)');
            }}
            activeOpacity={0.7}
          >
            <Feather name="play-circle" size={20} color="#FFFFFF" />
            <Text style={styles.scenarioBtnText}>1→2→3→4단계 순서대로 발송</Text>
          </TouchableOpacity>
        </View>

        {/* 탑승역 포함 알람 예시 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>탑승역 포함 알람 예시</Text>
          <Text style={styles.sectionDesc}>which_station: 강남역 / preparation_time: 20분</Text>
          {([
            { stage: 1, mins: 20, color: '#2ECC71' },
            { stage: 2, mins: 15, color: '#F39C12' },
            { stage: 3, mins: 10, color: '#E67E22' },
            { stage: 4, mins: 5,  color: '#E74C3C' },
          ] as { stage: AlarmStage; mins: number; color: string }[]).map(({ stage, mins, color }) => (
            <TouchableOpacity
              key={stage}
              style={[styles.stageBtn, { borderLeftColor: color }]}
              onPress={async () => {
                const ids = await sendAlarm('personal', stage, '중앙대학교 후문', '강남역', mins);
                setSentIds((prev) => ({ ...prev, [stage]: [...(prev[stage] ?? []), ...ids] }));
                setLastSent(`${stage}단계 탑승역 알람 전송됨 (강남역 ${mins}분 전)`);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.stageBadge, { backgroundColor: color }]}>
                <Text style={styles.stageBadgeText}>{stage}</Text>
              </View>
              <View style={styles.stageInfo}>
                <Text style={styles.stageBtnLabel}>{stage}단계 — 강남역 {mins}분 전</Text>
                <Text style={styles.stageBtnDesc}>[중앙대학교 후문] 강남역 탑승까지 {mins}분 남았어요.</Text>
              </View>
              <Feather name="bell" size={18} color={color} />
            </TouchableOpacity>
          ))}
        </View>

        {/* 도착예정 알람 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>도착예정 알람 (그룹)</Text>
          <TouchableOpacity
            style={[styles.stageBtn, { borderLeftColor: '#92DEFE' }]}
            onPress={async () => {
              await sendArrivalAlarm('나나나', '오후 7시 3분', '홍대역 2번 출구');
              setLastSent('나나나 도착예정 알람 전송됨');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.stageBadge, { backgroundColor: '#92DEFE' }]}>
              <FontAwesome6 name="person-walking" size={16} color="#FFFFFF" />
            </View>
            <View style={styles.stageInfo}>
              <Text style={styles.stageBtnLabel}>개별 도착예정 알람</Text>
              <Text style={styles.stageBtnDesc}>나나나 · 오후 7시 3분 도착예정</Text>
            </View>
            <Feather name="bell" size={18} color="#92DEFE" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.stageBtn, { borderLeftColor: '#4A90D9' }]}
            onPress={async () => {
              await sendAllArrivalAlarms(SAMPLE_MEMBERS, '홍대역 2번 출구');
              setLastSent('전체 멤버 도착예정 알람 전송됨 (3초 간격)');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.stageBadge, { backgroundColor: '#4A90D9' }]}>
              <FontAwesome6 name="person-walking" size={16} color="#FFFFFF" />
            </View>
            <View style={styles.stageInfo}>
              <Text style={styles.stageBtnLabel}>전체 멤버 도착예정 알람</Text>
              <Text style={styles.stageBtnDesc}>나나나, 다다다 · 3초 간격으로 순차 발송</Text>
            </View>
            <Feather name="bell" size={18} color="#4A90D9" />
          </TouchableOpacity>
        </View>

        {/* 도착 확인/완료 알람 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>도착 알람</Text>

          <TouchableOpacity
            style={[styles.stageBtn, { borderLeftColor: '#F39C12' }]}
            onPress={async () => {
              await sendArrivalCheckAlarm('나나나', '홍대역 2번 출구');
              setLastSent('도착 확인 알람 전송됨');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.stageBadge, { backgroundColor: '#F39C12' }]}>
              <Feather name="help-circle" size={16} color="#FFFFFF" />
            </View>
            <View style={styles.stageInfo}>
              <Text style={styles.stageBtnLabel}>도착 여부 확인</Text>
              <Text style={styles.stageBtnDesc}>나나나님 목적지에 도착하신건가요?</Text>
            </View>
            <Feather name="bell" size={18} color="#F39C12" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.stageBtn, { borderLeftColor: '#27AE60' }]}
            onPress={async () => {
              await sendArrivalConfirmAlarm('나나나', '오후 7시 3분', '홍대역 2번 출구');
              setLastSent('도착 완료 알람 전송됨');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.stageBadge, { backgroundColor: '#27AE60' }]}>
              <Feather name="check-circle" size={16} color="#FFFFFF" />
            </View>
            <View style={styles.stageInfo}>
              <Text style={styles.stageBtnLabel}>도착 완료 알림</Text>
              <Text style={styles.stageBtnDesc}>나나나님이 오후 7시 3분에 도착하였습니다.</Text>
            </View>
            <Feather name="bell" size={18} color="#27AE60" />
          </TouchableOpacity>
        </View>

        {/* 카카오맵 딥링크 테스트 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>카카오맵 딥링크 테스트</Text>
          <TouchableOpacity
            style={styles.scenarioBtn}
            onPress={() => {
              Linking.openURL('kakaomap://').catch(() =>
                Linking.openURL('https://map.kakao.com').catch(() => {})
              );
            }}
            activeOpacity={0.7}
          >
            <Feather name="map-pin" size={20} color="#FFFFFF" />
            <Text style={styles.scenarioBtnText}>카카오맵으로 이동 테스트</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scenarioBtn, { marginTop: 10, backgroundColor: '#4A90D9' }]}
            onPress={() => router.push('/kakao-map-test' as any)}
            activeOpacity={0.7}
          >
            <Feather name="sliders" size={20} color="#FFFFFF" />
            <Text style={styles.scenarioBtnText}>상세 테스트 (출발지/도착지 입력)</Text>
          </TouchableOpacity>
        </View>

        {/* 마지막 전송 */}
        {lastSent !== '' && (
          <View style={styles.lastSentBox}>
            <Feather name="check" size={14} color="#4CAF50" />
            <Text style={styles.lastSentText}>{lastSent}</Text>
          </View>
        )}

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
  permissionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, marginTop: 16, marginBottom: 8,
  },
  permissionText: { fontSize: 13, fontWeight: '500' },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionDesc: { fontSize: 12, color: '#AAAAAA', marginBottom: 10, marginTop: -6 },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#F5F5F5',
  },
  typeBtnLabel: { fontSize: 14, fontWeight: '600', color: '#888888' },
  stageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#F9F9F9', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 10, borderLeftWidth: 4,
  },
  stageBadge: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  stageBadgeText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  stageInfo: { flex: 1 },
  stageBtnLabel: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  stageBtnDesc: { fontSize: 12, color: '#888888', marginTop: 2 },
  scenarioBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#1A1A1A', borderRadius: 14,
    paddingVertical: 16,
  },
  scenarioBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  dismissBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
    marginLeft: 6,
  },
  lastSentBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E8F5E9', borderRadius: 8,
    padding: 12, marginTop: 16, marginBottom: 40,
  },
  lastSentText: { fontSize: 13, color: '#4CAF50', fontWeight: '500' },
});