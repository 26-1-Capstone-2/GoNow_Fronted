import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { createAppointmentsApi } from '@/src/api/appointments';
import { createJourneysApi, getRepeatLabel, maskToRepeatDays, targetTimeToAmpmHourMinute } from '@/src/api/journeys';
import { createMembersApi } from '@/src/api/members';
import { alarmService } from '@/src/services/alarmService';
import { subscribeAlarmLocationUpdate } from '@/src/services/alarmEvents';
import { toTransportMode, canNavigateAlarm, handleNavigateAlarm } from '@/src/utils/kakaoMapDeeplink';
import { getAlarmTimeDisplay } from '@/src/utils/alarmTimeDisplay';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import AlarmTimeBlock from '@/src/components/common/AlarmTimeBlock';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
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
  destLat: number;
  destLng: number;
  enabled: boolean;
  transport: 'public' | 'car';
  departureAlarmTime: string | null;
  isLastMode?: boolean;
  // 막차 모드 target_time 확정 여부(getAlarmTimeDisplay의 hasTargetTime으로 전달) — 그 외
  // 알람 타입은 항상 undefined로 두고 기본값(true) 그대로 씀
  targetTimeKnown?: boolean;
  participantCount?: number;
  myStatus?: string;
  appointmentStatus?: string;
  // 개인/귀가 전용 — 반복 요일 비트마스크(버그45, ARRIVED 파킹 판단용)
  repeatDays?: number;
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
    destLat: item.dest_lat,
    destLng: item.dest_lng,
    enabled: item.is_active,
    transport: item.transport_type === 'TRANSIT' ? 'public' : 'car',
    departureAlarmTime: item.departure_alarm_time,
    isLastMode: item.is_last_mode,
    targetTimeKnown: item.target_time != null,
    participantCount: item.participant_count ?? undefined,
    myStatus: item.my_status,
    appointmentStatus: item.appointment_status ?? undefined,
    repeatDays: item.repeat_days ?? undefined,
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
  // "다가오는 일정" 카드 탭 등 외부에서 특정 알람의 수정 화면으로 바로 이어서 열고 싶을 때
  // 사용 — 이 날짜의 알람 목록이 로드되면 해당 id를 찾아 카드 탭과 동일한 경로로 수정 시트를 연다.
  autoEditKind?: 'personal' | 'group' | 'home';
  autoEditId?: number;
}

export default function DailyAlarmScreen({ onPersonalAdd, onPersonalEdit, onGroupAdd, onGroupEdit, onHomeAdd, onHomeEdit, onArrivalPress, autoEditKind, autoEditId }: Props) {
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
      // 서버 조회 쿼리(findAllByPlanDate)가 반복 요일만 보고 매칭해서, 그 여정이 생성되기
      // 전(=앵커 plan_date보다 이른) 날짜를 조회해도 유령처럼 매칭되는 버그가 있다(2026-08-24
      // 발견). 조회한 날짜가 여정 앵커보다 이르면 클라이언트에서 걸러낸다.
      const data = (res.data ?? []).filter((a) => selectedDate >= a.plan_date.split('T')[0]);
      setPersonal(data.filter((a) => a.alarm_type === 'PERSONAL').map(toAlarmCard));
      setGroup(data.filter((a) => a.alarm_type === 'GROUP').map(toAlarmCard));
      setHome(data.filter((a) => a.alarm_type === 'HOME').map(toAlarmCard));
    } catch {}
  }, [selectedDate, alarmVersion]);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  // 생성/수정 직후엔 서버가 아직 GPS 응답을 못 받아서 departureAlarmTime이 비어있는 채로
  // 화면이 렌더된다 — 이후 alarmService가 실제 GPS 응답을 받는 시점(수 초~수십 초 뒤)에
  // 재조회 없이 그 값을 바로 반영한다(이전엔 화면을 나갔다 다시 들어와야만 갱신됐음).
  useEffect(() => {
    return subscribeAlarmLocationUpdate((update) => {
      const patch = (arr: AlarmCard[]) => arr.map((a) =>
        (update.journeyId != null && a.journeyId === update.journeyId) ||
        (update.appointmentId != null && a.appointmentId === update.appointmentId)
          ? { ...a, departureAlarmTime: update.departureAlarmTime, myStatus: update.status }
          : a
      );
      if (update.journeyId != null) {
        setPersonal(patch);
        setHome(patch);
      } else if (update.appointmentId != null) {
        setGroup(patch);
      }
    });
  }, []);

  // "다가오는 일정" 카드 탭으로 진입한 경우, 이 날짜의 목록이 로드되면 해당 알람을 찾아 카드
  // 탭과 동일한 경로로 수정 시트를 자동으로 연다. selectedDate가 아직 목표 날짜로 안 바뀐
  // 시점(라우팅 직후)엔 못 찾는 게 정상이고, 그러면 아무 것도 안 하고 다음 로드를 기다린다
  // (setSelectedDate 반영 후 loadAlarms가 다시 돌면서 personal/group/home이 갱신되어 재시도됨).
  const consumedAutoEditRef = useRef(false);
  useEffect(() => {
    if (!autoEditKind || autoEditId == null || consumedAutoEditRef.current) return;
    if (autoEditKind === 'personal') {
      const alarm = personal.find((a) => a.journeyId === autoEditId);
      if (!alarm) return;
      consumedAutoEditRef.current = true;
      if (alarm.myStatus !== 'MOVING') onPersonalEdit(autoEditId, alarm);
    } else if (autoEditKind === 'home') {
      const alarm = home.find((a) => a.journeyId === autoEditId);
      if (!alarm) return;
      consumedAutoEditRef.current = true;
      if (alarm.myStatus !== 'MOVING') onHomeEdit(autoEditId, alarm);
    } else if (autoEditKind === 'group') {
      const alarm = group.find((a) => a.appointmentId === autoEditId);
      if (!alarm) return;
      consumedAutoEditRef.current = true;
      if (alarm.appointmentStatus === 'WAITING') onGroupEdit(autoEditId, alarm);
    }
  }, [autoEditKind, autoEditId, personal, home, group, onPersonalEdit, onHomeEdit, onGroupEdit]);

  // alarmType은 isLastMode(막차 모드 여부)로 유추하면 안 된다 — HOME 여정도 데드라인 모드
  // (is_last_mode=false)면 PERSONAL로 잘못 판정된다. 호출부가 이미 personal/home 중 어느
  // 목록(setPersonal/setHome)에서 토글했는지 알고 있으므로 명시적으로 받는다.
  const toggleAlarm = (setter: React.Dispatch<React.SetStateAction<AlarmCard[]>>, alarm: AlarmCard, alarmType: 'personal' | 'home' = 'personal') => {
    const newEnabled = !alarm.enabled;
    setter((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: newEnabled } : a));
    if (alarm.journeyId) {
      journeysApi.toggleActive(alarm.journeyId, newEnabled).catch(() => {
        setter((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: !newEnabled } : a));
      });
      if (!newEnabled) {
        alarmService.stop(alarm.journeyId);
      } else if (!!alarm.myStatus && ['READY', 'DEPARTING', 'MOVING', 'NEARDEST'].includes(alarm.myStatus)) {
        alarmService.start({ alarmType, destination: alarm.place, journeyId: alarm.journeyId, destLat: alarm.destLat, destLng: alarm.destLng, transportMode: toTransportMode(alarm.transport === 'car'), isLastMode: alarm.isLastMode, repeatDays: alarm.repeatDays });
      }
    } else if (alarm.appointmentId) {
      appointmentsApi.toggleParticipantAlarm(alarm.appointmentId, newEnabled).catch(() => {
        setter((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: !newEnabled } : a));
      });
      alarmService.setActive(newEnabled, undefined, alarm.appointmentId);
    }
  };

  // DRIVING/TRANSIT 공통 카카오맵 딥링크 — 단일 딥링크 설계
  // (docs/reference/kakao-map-deeplink-spec.md §2.2~2.4 참고)
  const canNavigate = (alarm: AlarmCard) => canNavigateAlarm(alarm.myStatus);

  // 매번 새로 GPS를 잡아 열기까지 1~2초 걸릴 수 있어(kakaoMapDeeplink.ts 참고),
  // 버튼이 멈춘 건지 헷갈리지 않도록 눌린 카드의 id만 로딩 표시한다.
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const handleNavigate = async (alarm: AlarmCard) => {
    setNavigatingId(alarm.id);
    try {
      await handleNavigateAlarm(alarm.destLat, alarm.destLng, alarm.transport === 'car');
    } finally {
      setNavigatingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => {
          // setSelectedDate와 router.back()을 같은 틱에서 동시에 실행하면, 전환 애니메이션
          // 도중 이 화면과 캘린더 화면이 동시에 같은 selectedDate를 보고 리렌더링되면서
          // Fabric이 뷰를 두 부모에 동시에 붙이려다 크래시하는 경우가 있었다(2026-08-24,
          // "View already has a parent" IllegalStateException 실기기 로그로 확인). 네비게이션을
          // 먼저 보내고, 상태 갱신은 전환이 끝난 뒤로 미룬다.
          router.back();
          InteractionManager.runAfterInteractions(() => setSelectedDate(todayStr));
        }}>
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
            <TouchableOpacity style={[styles.sectionAddBtn, { backgroundColor: '#EAF3FF' }]} onPress={onPersonalAdd}>
              <Feather name="plus" size={18} color="#0A84FF" />
            </TouchableOpacity>
          </View>
          {personal.map((alarm) => (
            <SwipeableAlarmCard key={alarm.id} onDelete={async () => {
              if (!alarm.journeyId) return;
              try {
                await journeysApi.deleteJourney(alarm.journeyId);
                // alarmService.stop()이 내부적으로 ACTIVE_JOURNEYS_KEY 제거까지 안전하게(잠금 걸린 채) 처리함
                alarmService.stop(alarm.journeyId);
              } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
              setPersonal(prev => prev.filter(a => a.id !== alarm.id));
              bumpAlarmVersion();
            }}>
              <TouchableOpacity style={styles.alarmCard} activeOpacity={0.7}
                onPress={() => {
                  if (alarm.myStatus === 'MOVING') {
                    Platform.OS === 'android'
                      ? ToastAndroid.show('이동 중에는 수정할 수 없어요.', ToastAndroid.SHORT)
                      : Alert.alert('', '이동 중에는 수정할 수 없어요.');
                    return;
                  }
                  alarm.journeyId && onPersonalEdit(alarm.journeyId, alarm);
                }}>
                <View style={[styles.typeChip, { backgroundColor: '#EAF3FF' }, (selectedDate < todayStr || (alarm.myStatus === 'ARRIVED' && selectedDate === todayStr)) && { opacity: 0.45 }]}>
                  <Feather name="map-pin" size={17} color="#0A84FF" />
                </View>
                <View style={[styles.alarmInfo, (selectedDate < todayStr || (alarm.myStatus === 'ARRIVED' && selectedDate === todayStr)) && { opacity: 0.45 }]}>
                  <Text style={styles.alarmPlace} numberOfLines={1}>{alarm.place}</Text>
                  <AlarmTimeBlock
                    display={getAlarmTimeDisplay({
                      targetAmpm: alarm.ampm,
                      targetHour: alarm.time.split(':')[0],
                      targetMinute: alarm.time.split(':')[1],
                      departureAlarmTime: alarm.departureAlarmTime,
                      planDate: selectedDate,
                      myStatus: alarm.myStatus,
                    })}
                    trailing={<>
                      {alarm.transport === 'public'
                        ? <MaterialCommunityIcons name="bus-side" size={15} color="#0A84FF" />
                        : <FontAwesome5 name="car-side" size={13} color="#0A84FF" />}
                      {getRepeatLabel(maskToRepeatDays(alarm.repeatDays ?? 0)) !== '안함' && (
                        <Text style={styles.repeatLabel}>· {getRepeatLabel(maskToRepeatDays(alarm.repeatDays ?? 0))}</Text>
                      )}
                    </>}
                  />
                </View>
                <View style={styles.cardRight}>
                  <TouchableOpacity
                    style={[styles.navigateBtn, !canNavigate(alarm) && styles.navigateBtnDisabled]}
                    onPress={() => handleNavigate(alarm)}
                    disabled={!canNavigate(alarm) || navigatingId === alarm.id}
                  >
                    {navigatingId === alarm.id
                      ? <ActivityIndicator size="small" color="#4A90D9" />
                      : <Feather name="map" size={14} color={canNavigate(alarm) ? '#4A90D9' : '#CCCCCC'} />}
                  </TouchableOpacity>
                  <Switch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(setPersonal, alarm, 'personal')}
                    trackColor={{ false: '#E0E0E0', true: '#30D158' }}
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
            <TouchableOpacity style={[styles.sectionAddBtn, { backgroundColor: '#FFF3E5' }]} onPress={onGroupAdd}>
              <Feather name="plus" size={18} color="#FF9F0A" />
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
                // alarmService.stop()이 내부적으로 ACTIVE_APPOINTMENTS_KEY 제거까지 안전하게(잠금 걸린 채) 처리함
                alarmService.stop(undefined, alarm.appointmentId);
              } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
              setGroup(prev => prev.filter(a => a.id !== alarm.id));
              bumpAlarmVersion();
            }} icon="trash">
              <TouchableOpacity
                style={styles.alarmCard}
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
                <View style={[styles.typeChip, { backgroundColor: '#FFF3E5' }, isGroupActive && { opacity: 0.45 }]}>
                  <Feather name="users" size={17} color="#FF9F0A" />
                </View>
                <View style={[styles.alarmInfo, isGroupActive && { opacity: 0.45 }]}>
                  <Text style={styles.alarmPlace} numberOfLines={1}>{alarm.place}</Text>
                  <AlarmTimeBlock
                    display={getAlarmTimeDisplay({
                      targetAmpm: alarm.ampm,
                      targetHour: alarm.time.split(':')[0],
                      targetMinute: alarm.time.split(':')[1],
                      departureAlarmTime: alarm.departureAlarmTime,
                      planDate: selectedDate,
                      myStatus: alarm.myStatus,
                    })}
                    trailing={alarm.transport === 'public'
                      ? <MaterialCommunityIcons name="bus-side" size={15} color="#FF9F0A" />
                      : <FontAwesome5 name="car-side" size={13} color="#FF9F0A" />}
                  />
                </View>
                <View style={styles.cardRight}>
                  <TouchableOpacity
                    onPress={() => { if (alarm.appointmentId) { onArrivalPress(alarm.appointmentId); } }}
                    disabled={!isGroupActive}
                    style={[styles.arrivalBtn, isGroupActive && styles.arrivalBtnActive]}
                  >
                    <FontAwesome6 name="person-walking" size={14} color={isGroupActive ? '#FFFFFF' : '#CCCCCC'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.navigateBtn, !canNavigate(alarm) && styles.navigateBtnDisabled]}
                    onPress={() => handleNavigate(alarm)}
                    disabled={!canNavigate(alarm) || navigatingId === alarm.id}
                  >
                    {navigatingId === alarm.id
                      ? <ActivityIndicator size="small" color="#4A90D9" />
                      : <Feather name="map" size={14} color={canNavigate(alarm) ? '#4A90D9' : '#CCCCCC'} />}
                  </TouchableOpacity>
                  <Switch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(setGroup, alarm)}
                    trackColor={{ false: '#E0E0E0', true: '#30D158' }}
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
            <TouchableOpacity style={[styles.sectionAddBtn, { backgroundColor: '#EAF9EE' }]} onPress={onHomeAdd}>
              <Feather name="plus" size={18} color="#30D158" />
            </TouchableOpacity>
          </View>
          {home.map((alarm) => (
            <SwipeableAlarmCard key={alarm.id} onDelete={async () => {
              if (!alarm.journeyId) return;
              try {
                await journeysApi.deleteJourney(alarm.journeyId);
                // alarmService.stop()이 내부적으로 ACTIVE_JOURNEYS_KEY 제거까지 안전하게(잠금 걸린 채) 처리함
                alarmService.stop(alarm.journeyId);
              } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
              setHome(prev => prev.filter(a => a.id !== alarm.id));
              bumpAlarmVersion();
            }}>
              <TouchableOpacity style={styles.alarmCard} activeOpacity={0.7}
                onPress={() => {
                  if (alarm.myStatus === 'MOVING') {
                    Platform.OS === 'android'
                      ? ToastAndroid.show('이동 중에는 수정할 수 없어요.', ToastAndroid.SHORT)
                      : Alert.alert('', '이동 중에는 수정할 수 없어요.');
                    return;
                  }
                  alarm.journeyId && onHomeEdit(alarm.journeyId, alarm);
                }}>
                <View style={[styles.typeChip, { backgroundColor: '#EAF9EE' }, (selectedDate < todayStr || (alarm.myStatus === 'ARRIVED' && selectedDate === todayStr)) && { opacity: 0.45 }]}>
                  <Feather name="navigation" size={17} color="#30D158" />
                </View>
                <View style={[styles.alarmInfo, (selectedDate < todayStr || (alarm.myStatus === 'ARRIVED' && selectedDate === todayStr)) && { opacity: 0.45 }]}>
                  <Text style={styles.alarmPlace} numberOfLines={1}>{alarm.place}</Text>
                  <AlarmTimeBlock
                    display={getAlarmTimeDisplay({
                      targetAmpm: alarm.ampm,
                      targetHour: alarm.time.split(':')[0],
                      targetMinute: alarm.time.split(':')[1],
                      departureAlarmTime: alarm.departureAlarmTime,
                      planDate: selectedDate,
                      isLastMode: alarm.isLastMode,
                      hasTargetTime: alarm.targetTimeKnown,
                      isRepeating: !!alarm.repeatDays,
                      myStatus: alarm.myStatus,
                    })}
                    trailing={<>
                      {alarm.isLastMode || alarm.transport === 'public'
                        ? <MaterialCommunityIcons name="bus-side" size={15} color="#30D158" />
                        : <FontAwesome5 name="car-side" size={13} color="#30D158" />}
                      {getRepeatLabel(maskToRepeatDays(alarm.repeatDays ?? 0)) !== '안함' && (
                        <Text style={styles.repeatLabel}>· {getRepeatLabel(maskToRepeatDays(alarm.repeatDays ?? 0))}</Text>
                      )}
                    </>}
                  />
                </View>
                <View style={styles.cardRight}>
                  <TouchableOpacity
                    style={[styles.navigateBtn, !canNavigate(alarm) && styles.navigateBtnDisabled]}
                    onPress={() => handleNavigate(alarm)}
                    disabled={!canNavigate(alarm) || navigatingId === alarm.id}
                  >
                    {navigatingId === alarm.id
                      ? <ActivityIndicator size="small" color="#4A90D9" />
                      : <Feather name="map" size={14} color={canNavigate(alarm) ? '#4A90D9' : '#CCCCCC'} />}
                  </TouchableOpacity>
                  <Switch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(setHome, alarm, 'home')}
                    trackColor={{ false: '#E0E0E0', true: '#30D158' }}
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
    color: '#FF453A',
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
  sectionAddBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },

  alarmCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginBottom: 10,
    shadowColor: '#141413',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  typeChip: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  alarmInfo: { flex: 1, marginRight: 8, justifyContent: 'center' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alarmPlace: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 5 },
  repeatLabel: { fontSize: 12, color: '#888888' },
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
  navigateBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EAF2FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigateBtnDisabled: {
    backgroundColor: '#EEEEEE',
  },
});