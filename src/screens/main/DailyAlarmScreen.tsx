import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { createAppointmentsApi } from '@/src/api/appointments';
import { createJourneysApi, targetTimeToAmpmHourMinute } from '@/src/api/journeys';
import { createMembersApi } from '@/src/api/members';
import { alarmService } from '@/src/services/alarmService';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACTIVE_JOURNEYS_KEY, ACTIVE_APPOINTMENTS_KEY } from '@/src/tasks/backgroundLocationTask';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const alarmsApi = createAlarmsApi();
const journeysApi = createJourneysApi();
const appointmentsApi = createAppointmentsApi();
const membersApi = createMembersApi();

type AlarmCard = {
  id: string;
  journeyId?: number;
  appointmentId?: number;
  ampm: string;
  time: string;
  place: string;
  enabled: boolean;
  transport: 'public' | 'car';
  isLastMode?: boolean;
  participantCount?: number;
  myStatus?: string;
  appointmentStatus?: string;
};

function toAlarmCard(item: AlarmItem): AlarmCard {
  const { ampm, hour, minute } = targetTimeToAmpmHourMinute(item.target_time);
  return {
    id: String(item.journey_id ?? item.appointment_id),
    journeyId: item.journey_id ?? undefined,
    appointmentId: item.appointment_id ?? undefined,
    ampm,
    time: `${hour}:${minute}`,
    place: item.dest_name,
    enabled: item.is_active,
    transport: item.transport_type === 'TRANSIT' ? 'public' : 'car',
    isLastMode: item.is_last_mode,
    participantCount: item.participant_count ?? undefined,
    myStatus: item.my_status,
    appointmentStatus: item.appointment_status ?? undefined,
  };
}

interface Props {
  onPersonalAdd: () => void;
  onPersonalEdit: (journeyId: number, alarm: AlarmCard) => void;
  onGroupAdd: () => void;
  onGroupEdit: (appointmentId: number, alarm: AlarmCard) => void;
  onHomeAdd: () => void;
  onHomeEdit: (journeyId: number, alarm: AlarmCard) => void;
  onArrivalPress: (appointmentId: number) => void;
}

export default function DailyAlarmScreen({ onPersonalAdd, onPersonalEdit, onGroupAdd, onGroupEdit, onHomeAdd, onHomeEdit, onArrivalPress }: Props) {
  const router = useRouter();
  const { selectedDate, selectedMonth, setSelectedDate, alarmVersion, bumpAlarmVersion } = useCalendarStore();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [personal, setPersonal] = useState<AlarmCard[]>([]);
  const [group, setGroup] = useState<AlarmCard[]>([]);
  const [home, setHome] = useState<AlarmCard[]>([]);

  const dateObj = new Date(selectedDate);
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayName = DAY_NAMES[dateObj.getDay()];

  const loadAlarms = useCallback(async () => {
    try {
      const res = await alarmsApi.getAlarms(selectedDate);
      const data = res.data ?? [];
      setPersonal(data.filter((a) => a.alarm_type === 'PERSONAL').map(toAlarmCard));
      setGroup(data.filter((a) => a.alarm_type === 'GROUP').map(toAlarmCard));
      setHome(data.filter((a) => a.alarm_type === 'HOME').map(toAlarmCard));
    } catch {}
  }, [selectedDate, alarmVersion]);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  const toggleAlarm = (setter: React.Dispatch<React.SetStateAction<AlarmCard[]>>, alarm: AlarmCard) => {
    const newEnabled = !alarm.enabled;
    setter((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: newEnabled } : a));
    if (alarm.journeyId) {
      const alarmType = alarm.isLastMode ? 'home' : 'personal';
      journeysApi.toggleActive(alarm.journeyId, newEnabled).catch(() => {
        setter((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: !newEnabled } : a));
      });
      if (!newEnabled) {
        alarmService.stop(alarm.journeyId);
      } else if (['READY', 'DEPARTING', 'MOVING', 'NEARDEST'].includes(alarm.myStatus)) {
        alarmService.start({ alarmType, destination: alarm.place, journeyId: alarm.journeyId });
      }
    } else if (alarm.appointmentId) {
      appointmentsApi.toggleParticipantAlarm(alarm.appointmentId, newEnabled).catch(() => {
        setter((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: !newEnabled } : a));
      });
      alarmService.setActive(newEnabled, undefined, alarm.appointmentId);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
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
            <TouchableOpacity onPress={onPersonalAdd}>
              <Feather name="plus" size={22} color="#888888" />
            </TouchableOpacity>
          </View>
          {personal.map((alarm) => (
            <SwipeableAlarmCard key={alarm.id} onDelete={async () => {
              if (!alarm.journeyId) return;
              try {
                await journeysApi.deleteJourney(alarm.journeyId);
                alarmService.stop(alarm.journeyId);
                const raw = await AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY);
                const ids: number[] = raw ? JSON.parse(raw) : [];
                await AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(ids.filter(id => id !== alarm.journeyId)));
              } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
              setPersonal(prev => prev.filter(a => a.id !== alarm.id));
              bumpAlarmVersion();
            }}>
              <TouchableOpacity style={styles.alarmCard} activeOpacity={0.7}
                onPress={() => alarm.journeyId && onPersonalEdit(alarm.journeyId, alarm)}>
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
                    onValueChange={() => toggleAlarm(setPersonal, alarm)}
                    trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </TouchableOpacity>
            </SwipeableAlarmCard>
          ))}
        </View>

        {/* 그룹 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>그룹</Text>
            <TouchableOpacity onPress={onGroupAdd}>
              <Feather name="plus" size={22} color="#888888" />
            </TouchableOpacity>
          </View>
          {group.map((alarm) => {
            const isGroupActive = alarm.appointmentStatus !== 'WAITING';
            return (
            <SwipeableAlarmCard key={alarm.id} onDelete={async () => {
              if (!alarm.appointmentId) return;
              try {
                const [detailRes, profileRes] = await Promise.all([
                  appointmentsApi.getAppointment(alarm.appointmentId),
                  membersApi.getMyProfile(),
                ]);
                if (!detailRes.success || !detailRes.data || !profileRes.data) return;
                const myMemberId = profileRes.data.member_id;
                const isHost = detailRes.data.participants.some(p => p.member_id === myMemberId && p.is_host);
                if (isHost) {
                  const res = await appointmentsApi.deleteAppointment(alarm.appointmentId);
                  if (!res.success) { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
                } else {
                  const res = await appointmentsApi.removeParticipant(alarm.appointmentId, myMemberId);
                  if (!res.success) { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
                }
                alarmService.stop(undefined, alarm.appointmentId);
                const raw = await AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY);
                const ids: number[] = raw ? JSON.parse(raw) : [];
                await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(ids.filter(id => id !== alarm.appointmentId)));
              } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
              setGroup(prev => prev.filter(a => a.id !== alarm.id));
              bumpAlarmVersion();
            }} icon="trash">
              <TouchableOpacity
                style={[styles.alarmCard, isGroupActive && { opacity: 0.45 }]}
                activeOpacity={0.7}
                onPress={() => {
                  if (isGroupActive) {
                    Platform.OS === 'android'
                      ? ToastAndroid.show('약속이 진행 중에는 수정할 수 없어요.', ToastAndroid.SHORT)
                      : Alert.alert('', '약속이 진행 중에는 수정할 수 없어요.');
                    return;
                  }
                  alarm.appointmentId && onGroupEdit(alarm.appointmentId, alarm);
                }}>
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
                    <Text style={styles.memberCount}>{alarm.participantCount ?? 0}명</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { if (alarm.appointmentId) { onArrivalPress(alarm.appointmentId); } }}
                    disabled={!isGroupActive}
                    style={[styles.arrivalBtn, isGroupActive && styles.arrivalBtnActive]}
                  >
                    <FontAwesome6 name="person-walking" size={14} color={isGroupActive ? '#FFFFFF' : '#CCCCCC'} />
                  </TouchableOpacity>
                  <Switch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(setGroup, alarm)}
                    trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </TouchableOpacity>
            </SwipeableAlarmCard>
            );
          })}
        </View>

        {/* 귀가 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>귀가</Text>
            <TouchableOpacity onPress={onHomeAdd}>
              <Feather name="plus" size={22} color="#888888" />
            </TouchableOpacity>
          </View>
          {home.map((alarm) => (
            <SwipeableAlarmCard key={alarm.id} onDelete={async () => {
              if (!alarm.journeyId) return;
              try {
                await journeysApi.deleteJourney(alarm.journeyId);
                alarmService.stop(alarm.journeyId);
                const raw = await AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY);
                const ids: number[] = raw ? JSON.parse(raw) : [];
                await AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(ids.filter(id => id !== alarm.journeyId)));
              } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
              setHome(prev => prev.filter(a => a.id !== alarm.id));
              bumpAlarmVersion();
            }}>
              <TouchableOpacity style={styles.alarmCard} activeOpacity={0.7}
                onPress={() => alarm.journeyId && onHomeEdit(alarm.journeyId, alarm)}>
                <View style={styles.alarmInfo}>
                  <Text style={styles.alarmPlace}>{alarm.place}</Text>
                  <View style={styles.alarmMeta}>
                    <Text style={styles.alarmDeadline}>
                      {alarm.isLastMode ? '막차 기준' : `${alarm.ampm} ${alarm.time} 까지`}
                    </Text>
                    {alarm.isLastMode || alarm.transport === 'public'
                      ? <MaterialCommunityIcons name="bus-side" size={15} color="#4A90D9" />
                      : <FontAwesome5 name="car-side" size={13} color="#F5A623" />
                    }
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <Switch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(setHome, alarm)}
                    trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </TouchableOpacity>
            </SwipeableAlarmCard>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
  },
  alarmInfo: { flex: 1, marginRight: 8, justifyContent: 'center' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alarmPlace: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 5 },
  alarmDeadline: { fontSize: 13, fontWeight: '500', color: '#555555' },
  alarmMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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