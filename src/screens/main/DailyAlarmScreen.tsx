import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const SAMPLE_ALARMS = {
  personal: [
    { id: '1', ampm: '오후', time: '3:00', place: '중앙대학교 후문 입구, 4/7', enabled: true, transport: 'public' as 'public' | 'car' },
  ],
  group: [
    {
      id: '2', ampm: '오후', time: '7:00', place: '홍대역 2번 출구, 4/7', enabled: true,
      members: [{ active: true }, { active: false }],
      transport: 'public' as 'public' | 'car',
    },
  ],
  home: [
    { id: '3', ampm: '', time: '막차', place: '우리집', enabled: true, transport: 'public' as 'public' | 'car' },
  ],
};

interface Props {
  onPersonalPress: () => void;
  onGroupPress: () => void;
  onHomePress: () => void;
  onArrivalPress: () => void;
  isArrivalActive?: boolean;
}

export default function DailyAlarmScreen({ onPersonalPress, onGroupPress, onHomePress, onArrivalPress, isArrivalActive = false }: Props) {
  const router = useRouter();
  const { selectedDate, selectedMonth, setSelectedDate } = useCalendarStore();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => { setSelectedDate(todayStr); router.back(); }}>
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
            <TouchableOpacity onPress={onPersonalPress}>
              <Feather name="menu" size={20} color="#888888" />
            </TouchableOpacity>
          </View>
          {alarms.personal.map((alarm) => (
            <View key={alarm.id} style={styles.alarmCard}>
              <View style={styles.alarmInfo}>
                <Text style={styles.alarmPlace}>{alarm.place}</Text>
                <View style={styles.alarmMeta}>
                  <Text style={styles.alarmDeadline}>{alarm.ampm} {alarm.time} 까지</Text>
                  {alarm.transport === 'public'
                    ? <MaterialCommunityIcons name="bus-side" size={15} color="#4A90D9" />
                    : <FontAwesome5 name="car-side" size={13} color="#F5A623" />
                  }
                </View>
              </View>
              <View style={styles.cardRight}>
                <Switch
                  value={alarm.enabled}
                  onValueChange={() => toggleAlarm('personal', alarm.id)}
                  trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          ))}
        </View>

        {/* 그룹 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>그룹</Text>
            <TouchableOpacity onPress={onGroupPress}>
              <Feather name="menu" size={20} color="#888888" />
            </TouchableOpacity>
          </View>
          {alarms.group.map((alarm) => (
            <View key={alarm.id} style={styles.alarmCard}>
              <View style={styles.alarmInfo}>
                <Text style={styles.alarmPlace}>{alarm.place}</Text>
                <View style={styles.alarmMeta}>
                  <Text style={styles.alarmDeadline}>{alarm.ampm} {alarm.time} 까지</Text>
                  {alarm.transport === 'public'
                    ? <MaterialCommunityIcons name="bus-side" size={15} color="#4A90D9" />
                    : <FontAwesome5 name="car-side" size={13} color="#F5A623" />
                  }
                </View>
              </View>
              <View style={styles.cardRight}>
                <View style={styles.memberBadge}>
                  <Feather name="users" size={11} color="#555555" />
                  <Text style={styles.memberCount}>{alarm.members.length}명</Text>
                </View>
                <TouchableOpacity
                  onPress={onArrivalPress}
                  disabled={!isArrivalActive}
                  style={[styles.arrivalBtn, isArrivalActive && styles.arrivalBtnActive]}
                >
                  <FontAwesome6 name="person-walking" size={14} color={isArrivalActive ? '#FFFFFF' : '#CCCCCC'} />
                </TouchableOpacity>
                <Switch
                  value={alarm.enabled}
                  onValueChange={() => toggleAlarm('group', alarm.id)}
                  trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          ))}
        </View>

        {/* 귀가 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>귀가</Text>
            <TouchableOpacity onPress={onHomePress}>
              <Feather name="menu" size={20} color="#888888" />
            </TouchableOpacity>
          </View>
          {alarms.home.map((alarm) => (
            <View key={alarm.id} style={styles.alarmCard}>
              <View style={styles.alarmInfo}>
                <Text style={styles.alarmPlace}>{alarm.place}</Text>
                <View style={styles.alarmMeta}>
                  <Text style={styles.alarmDeadline}>
                    {alarm.time === '막차' ? '막차 기준' : `${alarm.ampm ?? ''} ${alarm.time} 까지`}
                  </Text>
                  {alarm.time === '막차' || alarm.transport === 'public'
                    ? <MaterialCommunityIcons name="bus-side" size={15} color="#4A90D9" />
                    : <FontAwesome5 name="car-side" size={13} color="#F5A623" />
                  }
                </View>
              </View>
              <View style={styles.cardRight}>
                <Switch
                  value={alarm.enabled}
                  onValueChange={() => toggleAlarm('home', alarm.id)}
                  trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'ios' ? 50 : 0,
  },
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

  alarmCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    marginBottom: 8,
  },
  alarmInfo: { flex: 1, marginRight: 8, justifyContent: 'center' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alarmPlace: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 5 },
  alarmDeadline: { fontSize: 13, fontWeight: '500', color: '#555555' },
  alarmMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardPlaceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#E8E8E8', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  memberCount: { fontSize: 11, color: '#555555', fontWeight: '500' },
  arrivalBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrivalBtnActive: {
    backgroundColor: '#92DEFE',
  },
});