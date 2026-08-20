import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { createMembersApi, AlarmSoundMode as ApiAlarmSoundMode } from '@/src/api/members';
import {
  AlarmStage,
  ArrivalCheckSoundMode,
  DepartureSoundMode,
  getArrivalCheckSoundMode,
  getDepartureSoundMode,
  requestNotificationPermission,
  sendAlarm,
  sendArrivalAlarm,
  sendArrivalCheckAlarm,
  sendArrivalConfirmAlarm,
  setArrivalCheckSoundMode,
  setDepartureSoundMode,
} from '@/src/utils/notifications';

// 프론트 로컬 모드('sound'|'vibrate'|'silent')와 스프링 AlarmSoundMode('SOUND'|'VIBRATE'|'SILENT') 간 변환
const toApiMode = (m: ArrivalCheckSoundMode): ApiAlarmSoundMode => m.toUpperCase() as ApiAlarmSoundMode;
const fromApiMode = (m: ApiAlarmSoundMode): ArrivalCheckSoundMode => m.toLowerCase() as ArrivalCheckSoundMode;

type ToggleMode = 'sound' | 'vibrate' | 'silent';
const MODE_LABELS: Record<ToggleMode, string> = { sound: '소리', vibrate: '진동', silent: '무음' };

// 모든 알람 카드 공용 — OS 채널 설정 화면 대신 앱 자체 소리/진동/무음 토글로 제어(도착
// 예정/완료는 서버 동기화, 나머지는 로컬 저장이라는 차이만 있고 UI는 동일). 토글 선택
// 자체가 미리듣기 — 고른 모드로 바로 테스트 알림을 하나 띄워서 소리/진동을 즉시 들려줌
// (무음을 고르면 그 무음 상태 그대로가 피드백). 별도 "미리듣기" 버튼 불필요.
function ToggleAlarmCard({
  title,
  desc,
  mode,
  loaded,
  onSelect,
}: {
  title: string;
  desc: string;
  mode: ToggleMode;
  loaded: boolean;
  onSelect: (mode: ToggleMode) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardDesc}>{desc}</Text>
      {Platform.OS === 'android' && Number(Platform.Version) >= 26 && (
        <View style={styles.toggleRow}>
          {(Object.keys(MODE_LABELS) as ToggleMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              disabled={!loaded}
              style={[styles.toggleButton, mode === m && styles.toggleButtonActive]}
              onPress={() => onSelect(m)}
            >
              <Text style={[styles.toggleButtonText, mode === m && styles.toggleButtonTextActive]}>
                {MODE_LABELS[m]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {Platform.OS === 'android' && Number(Platform.Version) < 26 && (
        <Text style={styles.unsupportedText}>안드로이드 8.0 미만 지원 X</Text>
      )}
    </View>
  );
}

function ArrivalCheckCard() {
  const [mode, setMode] = useState<ArrivalCheckSoundMode>('sound');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getArrivalCheckSoundMode().then((m) => {
      if (!cancelled) {
        setMode(m);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (next: ArrivalCheckSoundMode) => {
    setMode(next); // 낙관적 업데이트 — 실패해도 다음 발송 때 저장된 값 기준으로 다시 시도되므로 롤백 불필요
    await setArrivalCheckSoundMode(next).catch(() => {});
    const { granted } = await requestNotificationPermission();
    if (!granted) return; // 피드백용이라 별도 안내 없이 조용히 무시
    await sendArrivalCheckAlarm('나', '테스트 목적지').catch(() => {});
  };

  return (
    <ToggleAlarmCard
      title="📍 도착 여부 확인"
      desc="도착했는지 확인하는 알림이에요. 버튼을 누르면 바로 그 느낌으로 알림이 와요."
      mode={mode}
      loaded={loaded}
      onSelect={handleSelect}
    />
  );
}

const STAGE_TITLES: Record<AlarmStage, string> = {
  1: '🟢 1단계 — 여유 구간',
  2: '🟡 2단계 — 주의 구간',
  3: '🟠 3단계 — 위험 구간',
  4: '🔴 4단계 — 임계 구간',
};
const STAGE_DESCS: Record<AlarmStage, string> = {
  1: '출발 준비를 시작하라는 알림이에요. 버튼을 누르면 바로 그 느낌으로 알림이 와요.',
  2: '출발 시간이 다가온다는 알림이에요. 버튼을 누르면 바로 그 느낌으로 알림이 와요.',
  3: '지금 바로 출발하라는 알림이에요. 버튼을 누르면 바로 그 느낌으로 알림이 와요.',
  4: '가장 급한 마지막 알림이에요(3번 연속 발송). 버튼을 누르면 바로 그 느낌으로 알림이 와요.',
};

function DepartureStageCard({ stage }: { stage: AlarmStage }) {
  const [mode, setMode] = useState<DepartureSoundMode>('sound');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDepartureSoundMode(stage).then((m) => {
      if (!cancelled) {
        setMode(m);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  const handleSelect = async (next: DepartureSoundMode) => {
    setMode(next);
    await setDepartureSoundMode(stage, next).catch(() => {});
    const { granted } = await requestNotificationPermission();
    if (!granted) return;
    await sendAlarm('personal', stage).catch(() => {});
  };

  return (
    <ToggleAlarmCard
      title={STAGE_TITLES[stage]}
      desc={STAGE_DESCS[stage]}
      mode={mode}
      loaded={loaded}
      onSelect={handleSelect}
    />
  );
}

// 도착 예정/완료는 FCM이라 발송 시점에 스프링이 선호도를 알고 있어야 함 — 로컬 저장이 아니라
// 서버(MemberSetting)에 저장한다. API가 부분 업데이트를 지원해서(PATCH /api/members/me/arrival-sound,
// 바뀐 필드만 보내면 나머지는 서버에서 유지) 토글 하나 누를 때마다 그 필드만 딱 보내면 됨 —
// 다른 쪽 값을 매번 같이 챙겨 보낼 필요가 없어서 두 토글이 서로 완전히 독립적으로 동작함.
function ArrivalGroupCards() {
  const [expectedMode, setExpectedMode] = useState<ArrivalCheckSoundMode>('sound');
  const [completeMode, setCompleteMode] = useState<ArrivalCheckSoundMode>('sound');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createMembersApi()
      .getMyProfile()
      .then((res) => {
        if (cancelled || !res.data) return;
        setExpectedMode(fromApiMode(res.data.arrival_expected_sound_mode));
        setCompleteMode(fromApiMode(res.data.arrival_complete_sound_mode));
      })
      .catch(() => {}) // 조회 실패 시 기본값(소리) 유지 — 아래 finally에서 어차피 토글은 활성화됨
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (field: 'expected' | 'complete', next: ArrivalCheckSoundMode) => {
    if (field === 'expected') setExpectedMode(next);
    else setCompleteMode(next);

    // 부분 업데이트라 바뀐 필드만 보냄 — 다른 쪽 현재값을 알 필요 없음
    createMembersApi()
      .updateArrivalSound(
        field === 'expected'
          ? { arrival_expected_sound_mode: toApiMode(next) }
          : { arrival_complete_sound_mode: toApiMode(next) },
      )
      .catch(() => {});

    const { granted } = await requestNotificationPermission();
    if (!granted) return; // 피드백용이라 별도 안내 없이 조용히 무시
    if (field === 'expected') {
      await sendArrivalAlarm('나', '오후 3시 20분', '테스트 목적지', next).catch(() => {});
    } else {
      await sendArrivalConfirmAlarm('나', '오후 3시 20분', '테스트 목적지', next).catch(() => {});
    }
  };

  return (
    <>
      <ToggleAlarmCard
        title="🏃 도착 예정 알림"
        desc="그룹원에게 도착 예정 시각을 알려주는 알림이에요. 버튼을 누르면 바로 그 느낌으로 알림이 와요."
        mode={expectedMode}
        loaded={loaded}
        onSelect={(m) => handleSelect('expected', m)}
      />
      <ToggleAlarmCard
        title="✅ 도착 완료 알림"
        desc="그룹원에게 도착 완료를 알려주는 알림이에요. 버튼을 누르면 바로 그 느낌으로 알림이 와요."
        mode={completeMode}
        loaded={loaded}
        onSelect={(m) => handleSelect('complete', m)}
      />
    </>
  );
}

export default function AlarmSoundSettingsScreen() {
  const router = useRouter();

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
        <DepartureStageCard stage={1} />
        <DepartureStageCard stage={2} />
        <DepartureStageCard stage={3} />
        <DepartureStageCard stage={4} />

        <Text style={styles.sectionTitle}>도착</Text>
        <ArrivalCheckCard />
        <ArrivalGroupCards />
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
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  cardDesc: { fontSize: 13, color: '#666666', lineHeight: 19, marginTop: 6 },
  unsupportedText: { marginTop: 10, fontSize: 12, color: '#AAAAAA' },
  toggleRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  toggleButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 20,
    paddingVertical: 8,
    backgroundColor: '#EAEAEA',
  },
  toggleButtonActive: { backgroundColor: '#4A90D9' },
  toggleButtonText: { color: '#666666', fontSize: 13, fontWeight: '600' },
  toggleButtonTextActive: { color: '#FFFFFF' },
});
