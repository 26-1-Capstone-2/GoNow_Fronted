import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// 그룹 멤버 아이콘 컴포넌트 — 파랑(활성), 회색(비활성)
function MemberIcon({ active }: { active: boolean }) {
  return (
    <View style={[styles.memberCircle, active ? styles.memberActive : styles.memberInactive]}>
      <Feather name="user" size={14} color={active ? '#FFFFFF' : '#AAAAAA'} />
    </View>
  );
}

// 샘플 데이터
const SAMPLE_ALARMS = {
  personal: [
    { id: '1', ampm: '오후', time: '3:00', place: '중앙대학교 후문 입구, 4/7', enabled: true },
  ],
  group: [
    {
      id: '2', ampm: '오후', time: '7:00', place: '홍대역 2번 출구, 4/7', enabled: true,
      members: [{ active: true }, { active: false }],
    },
  ],
  home: [
    { id: '3', time: '막차', place: '우리집, 막차모드, 4/7', enabled: true },
  ],
};

export default function DailyAlarmScreen() {
  const router = useRouter();
  const { selectedDate, selectedMonth } = useCalendarStore();
  const [alarms, setAlarms] = useState(SAMPLE_ALARMS);

  const dateObj = new Date(selectedDate);
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayName = DAY_NAMES[dateObj.getDay()];

  const toggleAlarm = (section: 'personal' | 'group' | 'home', id: string) => {
    setAlarms((prev) => ({
      ...prev,
      [section]: prev[section].map((a: any) =>
        a.id === id ? { ...a, enabled: !a.enabled } : a
      ),
    }));
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="chevron-left" size={20} color="#1A1A1A" />
          <Text style={styles.backMonth}>{selectedMonth}월</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/profile-settings' as any)}>
          <View style={styles.profileIcon}>
            <Feather name="user" size={18} color="#1A1A1A" />
          </View>
        </TouchableOpacity>
      </View>

      {/* 날짜 */}
      <Text style={styles.dateTitle}>{month}월 {date}일 {dayName}요일</Text>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>

        {/* 개인 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>개인</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/personal' as any)}>
              <Feather name="menu" size={20} color="#888888" />
            </TouchableOpacity>
          </View>
          {alarms.personal.map((alarm) => (
            <View key={alarm.id} style={styles.alarmCard}>
              <View style={styles.alarmInfo}>
                <View style={styles.timeRow}>
                  <Text style={styles.ampm}>{alarm.ampm}</Text>
                  <Text style={styles.alarmTime}>{alarm.time}</Text>
                </View>
                <Text style={styles.alarmPlace}>{alarm.place}</Text>
              </View>
              <Switch
                value={alarm.enabled}
                onValueChange={() => toggleAlarm('personal', alarm.id)}
                trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </View>

        {/* 그룹 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.groupTitleRow}>
              <Text style={styles.sectionTitle}>그룹</Text>
              {/* 멤버 활성화 아이콘 */}
              <View style={styles.memberIcons}>
                {SAMPLE_ALARMS.group[0].members.map((m, i) => (
                  <MemberIcon key={i} active={m.active} />
                ))}
              </View>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/group' as any)}>
              <Feather name="menu" size={20} color="#888888" />
            </TouchableOpacity>
          </View>
          {alarms.group.map((alarm) => (
            <View key={alarm.id} style={styles.alarmCard}>
              <View style={styles.alarmInfo}>
                <View style={styles.timeRow}>
                  <Text style={styles.ampm}>{alarm.ampm}</Text>
                  <Text style={styles.alarmTime}>{alarm.time}</Text>
                </View>
                <Text style={styles.alarmPlace}>{alarm.place}</Text>
              </View>
              <Switch
                value={alarm.enabled}
                onValueChange={() => toggleAlarm('group', alarm.id)}
                trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </View>

        {/* 귀가 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>귀가</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/home-alarm' as any)}>
              <Feather name="menu" size={20} color="#888888" />
            </TouchableOpacity>
          </View>
          {alarms.home.map((alarm) => (
            <View key={alarm.id} style={styles.alarmCard}>
              <View style={styles.alarmInfo}>
                <Text style={styles.alarmTimeHome}>{alarm.time}</Text>
                <Text style={styles.alarmPlace}>{alarm.place}</Text>
              </View>
              <Switch
                value={alarm.enabled}
                onValueChange={() => toggleAlarm('home', alarm.id)}
                trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </View>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 2,
  },
  backMonth: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  profileIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF3B30',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  scrollView: { flex: 1 },
  section: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  memberIcons: {
    flexDirection: 'row',
    gap: -6,
  },
  memberCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  memberActive: {
    backgroundColor: '#4A90D9',
  },
  memberInactive: {
    backgroundColor: '#DDDDDD',
  },
  alarmCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    marginBottom: 8,
  },
  alarmInfo: { flex: 1 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  ampm: {
    fontSize: 14,
    fontWeight: '400',
    color: '#1A1A1A',
    marginBottom: 6,
  },
  alarmTime: {
    fontSize: 44,
    fontWeight: '500',
    color: '#1A1A1A',
    letterSpacing: -1,
    lineHeight: 50,
  },
  alarmTimeHome: {
    fontSize: 32,
    fontWeight: '500',
    color: '#1A1A1A',
    lineHeight: 38,
  },
  alarmPlace: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
});