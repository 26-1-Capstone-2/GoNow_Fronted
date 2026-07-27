import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { createAppointmentsApi } from '@/src/api/appointments';
import { alarmService } from '@/src/services/alarmService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACTIVE_APPOINTMENTS_KEY } from '@/src/tasks/backgroundLocationTask';
import { targetTimeToAmpmHourMinute } from '@/src/api/journeys';
import { createMembersApi } from '@/src/api/members';
import { usePlaces } from '@/src/hooks/usePlaces';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Entypo, Feather, FontAwesome5, FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Share, StyleSheet, Switch, Text, TextInput, ToastAndroid, TouchableOpacity, View } from 'react-native';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type MemberTransport = 'public' | 'car';
interface Member { id: string; name: string; isMe: boolean; isHost?: boolean; transport?: MemberTransport; }
type Transport = 'public' | 'car';

interface GroupAlarm {
  id: string;
  appointmentId?: number;
  ampm: string; hour: string; minute: string;
  dest_name: string; dest_address: string; dest_lat?: number; dest_lng?: number;
  enabled: boolean; members: Member[]; inviteCode: string;
  isArrivalActive?: boolean;
  transport: Transport;
  appointment_status?: string;
  participant_count?: number;
  isCurrentUserHost?: boolean;
}

interface Props {
  onClose: () => void;
  onArrivalPress?: (alarm: GroupAlarm) => void;
  initialMode?: 'add' | 'create' | 'edit';
  editAppointmentId?: number;
  initialAlarm?: any;
}

const alarmsApi = createAlarmsApi();
const appointmentsApi = createAppointmentsApi();
const membersApi = createMembersApi();

function toTargetTime(date: string, ampm: string, hour: string, minute: string): string {
  let h = parseInt(hour, 10);
  if (ampm === '오후' && h !== 12) h += 12;
  if (ampm === '오전' && h === 12) h = 0;
  return `${date}T${String(h).padStart(2, '0')}:${minute}:00`;
}

function fromAlarmItem(item: AlarmItem): GroupAlarm {
  const { ampm, hour, minute } = targetTimeToAmpmHourMinute(item.target_time);
  return {
    id: String(item.appointment_id),
    appointmentId: item.appointment_id ?? undefined,
    ampm, hour, minute,
    dest_name: item.dest_name,
    dest_address: '',
    enabled: item.is_active,
    members: [],
    inviteCode: '',
    isArrivalActive: item.appointment_status !== 'WAITING',
    transport: item.transport_type === 'TRANSIT' ? 'public' : 'car',
    appointment_status: item.appointment_status ?? undefined,
    participant_count: item.participant_count ?? undefined,
  };
}

const DEFAULT_ALARM: GroupAlarm = {
  id: '', ampm: '오전', hour: '7', minute: '00',
  dest_name: '', dest_address: '', dest_lat: undefined, dest_lng: undefined,
  enabled: true, members: [{ id: 'me', name: '가가가(본인)', isMe: true }], inviteCode: '',
  isArrivalActive: false, transport: 'public' as Transport,
};

type ViewType = 'list' | 'edit' | 'place' | 'addChoice' | 'join' | 'transport';

export default function GroupAlarmSheet({ onClose, onArrivalPress, initialMode, editAppointmentId, initialAlarm }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const { selectedDate, bumpAlarmVersion } = useCalendarStore();

  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('DEST');

  const [view, setView] = useState<ViewType>(
    initialMode === 'add' ? 'addChoice' : (initialMode === 'create' || initialMode === 'edit') ? 'edit' : 'list'
  );
  const [alarms, setAlarms] = useState<GroupAlarm[]>([]);
  const [editAlarm, setEditAlarm] = useState<GroupAlarm>(() => {
    if (initialMode === 'edit' && editAppointmentId && initialAlarm) {
      return { ...DEFAULT_ALARM, id: String(editAppointmentId), appointmentId: editAppointmentId, dest_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '7', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport };
    }
    return DEFAULT_ALARM;
  });
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [joinTransport, setJoinTransport] = useState<Transport>('public');
  const isEditMode = !!editAlarm.id;

  useEffect(() => {
    loadPlaces().catch(() => {});
  }, [loadPlaces]);

  const loadAlarms = useCallback(async () => {
    try {
      const [alarmsRes, profileRes] = await Promise.all([
        alarmsApi.getAlarms(selectedDate),
        membersApi.getMyProfile(),
      ]);
      const groupItems = (alarmsRes.data ?? []).filter((a) => a.alarm_type === 'GROUP');
      const myMemberId = profileRes.data?.member_id;
      const resolved = await Promise.all(
        groupItems.map(async (item) => {
          const base = fromAlarmItem(item);
          if (!item.appointment_id || myMemberId == null) return { ...base, isCurrentUserHost: true };
          try {
            const detail = await appointmentsApi.getAppointment(item.appointment_id);
            const isHost = detail.success && detail.data
              ? detail.data.participants.some((p) => p.member_id === myMemberId && p.is_host)
              : true;
            return { ...base, isCurrentUserHost: isHost };
          } catch {
            return { ...base, isCurrentUserHost: true };
          }
        }),
      );
      setAlarms(resolved);
    } catch {}
  }, [selectedDate]);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  useEffect(() => {
    if (initialMode === 'edit' && editAppointmentId) {
      const base = initialAlarm
        ? { ...DEFAULT_ALARM, id: String(editAppointmentId), appointmentId: editAppointmentId, dest_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '7', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport }
        : { ...DEFAULT_ALARM, id: String(editAppointmentId), appointmentId: editAppointmentId };
      openEdit(base);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateObj = new Date(selectedDate);
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayName = DAY_NAMES[dateObj.getDay()];

  const handleSheetChange = useCallback((index: number) => { if (index === -1) onClose(); }, [onClose]);
  const openAdd = () => { setEditAlarm(DEFAULT_ALARM); setView('edit'); };
  const openNewGroup = () => { setEditAlarm(DEFAULT_ALARM); setView('edit'); };
  const handleJoin = async () => {
    if (inviteCode.trim().length === 0) { setInviteError('초대코드를 입력해주세요.'); return; }
    try {
      const res = await appointmentsApi.joinAppointment(
        inviteCode.trim(),
        joinTransport === 'public' ? 'TRANSIT' : 'DRIVING',
      );
      if (res.success && res.data) {
        if (res.data.participant_status === 'READY') {
          const detail = await appointmentsApi.getAppointment(res.data.appointment_id);
          if (detail.data) {
            alarmService.start({ alarmType: 'group', destination: detail.data.dest_name, appointmentId: res.data.appointment_id });
          }
        }
        setInviteCode('');
        setInviteError('');
        setJoinTransport('public');
        await loadAlarms();
        bumpAlarmVersion();
        setView('list');
      } else {
        setInviteError(res.message ?? '참여에 실패했습니다.');
      }
    } catch (e: any) {
      let message = '네트워크 오류가 발생했습니다.';
      try {
        const parsed = JSON.parse(e?.message ?? '');
        if (parsed?.message) message = parsed.message;
      } catch {
        // e.message가 JSON이 아니면 실제 네트워크 단절 등 — 기본 문구 유지
      }
      setInviteError(message);
    }
  };
  const openEdit = async (alarm: GroupAlarm) => {
    if (alarm.isArrivalActive) return;
    setEditAlarm(alarm);
    setView('edit');
    if (!alarm.appointmentId) return;
    try {
      const [detailRes, profileRes] = await Promise.all([
        appointmentsApi.getAppointment(alarm.appointmentId),
        membersApi.getMyProfile(),
      ]);
      if (detailRes.success && detailRes.data) {
        const d = detailRes.data;
        const myMemberId = profileRes.data?.member_id;
        const isCurrentUserHost = myMemberId != null
          ? d.participants.some((p) => p.member_id === myMemberId && p.is_host)
          : true;
        const { ampm, hour, minute } = targetTimeToAmpmHourMinute(d.target_time);
        setEditAlarm({
          ...alarm,
          ampm, hour, minute,
          dest_name: d.dest_name,
          dest_address: d.dest_address,
          dest_lat: d.dest_lat,
          dest_lng: d.dest_lng,
          inviteCode: d.invite_code,
          appointment_status: d.appointment_status,
          participant_count: d.participants.length,
          isCurrentUserHost,
          members: d.participants.map((p) => ({
            id: String(p.member_id),
            name: p.nickname,
            isMe: p.member_id === myMemberId,
            isHost: p.is_host,
            transport: p.transport_type === 'TRANSIT' ? 'public' : 'car',
          })),
        });
      }
    } catch {}
  };

  const openPlace = () => {
    setTempPlace(
      editAlarm.dest_name
        ? { id: 'current_dest', name: editAlarm.dest_name, address: editAlarm.dest_address, lat: editAlarm.dest_lat, lng: editAlarm.dest_lng, isCurrent: true }
        : null
    );
    setView('place');
  };
  const handleSave = async () => {
    if (isEditMode) {
      if (!editAlarm.appointmentId) { Alert.alert('수정 실패', '약속 정보를 찾을 수 없습니다.'); return; }
      try {
        const transportType = editAlarm.transport === 'public' ? 'TRANSIT' : 'DRIVING';
        if (editAlarm.isCurrentUserHost === false) {
          const res = await appointmentsApi.updateParticipantTransport(editAlarm.appointmentId, transportType);
          if (res.success) {
            await loadAlarms();
            bumpAlarmVersion();
            initialMode ? onClose() : setView('list');
          } else {
            Alert.alert('수정 실패', res.message ?? '다시 시도해주세요.');
          }
        } else {
          const res = await appointmentsApi.updateAppointment(editAlarm.appointmentId, {
            plan_date: selectedDate,
            target_time: toTargetTime(selectedDate, editAlarm.ampm, editAlarm.hour, editAlarm.minute),
            dest_name: editAlarm.dest_name,
            dest_address: editAlarm.dest_address,
            dest_lat: editAlarm.dest_lat ?? 0,
            dest_lng: editAlarm.dest_lng ?? 0,
            transport_type: transportType,
          });
          if (res.success) {
            if (res.data?.participant_status === 'READY') {
              alarmService.start({ alarmType: 'group', destination: editAlarm.dest_name, appointmentId: editAlarm.appointmentId });
            } else if (res.data?.participant_status === 'SCHEDULED' && editAlarm.appointmentId != null) {
              alarmService.stop(undefined, editAlarm.appointmentId);
            }
            await loadAlarms();
            bumpAlarmVersion();
            initialMode ? onClose() : setView('list');
          } else {
            Alert.alert('수정 실패', res.message ?? '다시 시도해주세요.');
          }
        }
      } catch {
        Alert.alert('수정 실패', '네트워크 오류가 발생했습니다.');
      }
      return;
    }
    if (!editAlarm.dest_name) { Alert.alert('목적지를 선택해주세요.'); return; }
    if (!editAlarm.dest_lat || !editAlarm.dest_lng) { Alert.alert('목적지를 다시 선택해주세요.'); return; }
    try {
      const res = await appointmentsApi.createAppointment({
        plan_date: selectedDate,
        target_time: toTargetTime(selectedDate, editAlarm.ampm, editAlarm.hour, editAlarm.minute),
        dest_name: editAlarm.dest_name,
        dest_address: editAlarm.dest_address,
        dest_lat: editAlarm.dest_lat,
        dest_lng: editAlarm.dest_lng,
        transport_type: editAlarm.transport === 'public' ? 'TRANSIT' : 'DRIVING',
      });
      if (res.success && res.data) {
        if (res.data.participant_status === 'READY') {
          alarmService.start({ alarmType: 'group', destination: editAlarm.dest_name, appointmentId: res.data.appointment_id });
        }
        await loadAlarms();
        bumpAlarmVersion();
        initialMode ? onClose() : setView('list');
      } else {
        Alert.alert('저장 실패', res.message ?? '다시 시도해주세요.');
      }
    } catch {
      Alert.alert('저장 실패', '네트워크 오류가 발생했습니다.');
    }
  };
  const handleKickMember = async (member: Member) => {
    if (!editAlarm.appointmentId) return;
    Alert.alert('참가자 추방', `${member.name}님을 추방하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '추방', style: 'destructive', onPress: async () => {
          try {
            const res = await appointmentsApi.removeParticipant(editAlarm.appointmentId!, parseInt(member.id));
            if (res.success) {
              await loadAlarms();
              bumpAlarmVersion();
              await openEdit(editAlarm);
              Alert.alert('추방 완료', `${member.name}님을 추방했습니다.`);
            } else {
              Alert.alert('추방 실패', '다시 시도해주세요.');
            }
          } catch {
            Alert.alert('추방 실패', '네트워크 오류가 발생했습니다.');
          }
        },
      },
    ]);
  };
  const handleLeave = async () => {
    if (!editAlarm.appointmentId) return;
    const myMember = editAlarm.members.find((m) => m.isMe);
    if (!myMember) return;
    Alert.alert('그룹 탈퇴', '그룹에서 탈퇴하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '탈퇴', style: 'destructive', onPress: async () => {
          try {
            const res = await appointmentsApi.removeParticipant(editAlarm.appointmentId!, parseInt(myMember.id));
            if (res.success) {
              await loadAlarms();
              bumpAlarmVersion();
              Alert.alert('탈퇴 완료', '그룹에서 탈퇴했습니다.', [
                { text: '확인', onPress: () => initialMode ? onClose() : setView('list') },
              ]);
            } else {
              Alert.alert('탈퇴 실패', '다시 시도해주세요.');
            }
          } catch {
            Alert.alert('탈퇴 실패', '네트워크 오류가 발생했습니다.');
          }
        },
      },
    ]);
  };
  const handleDelete = async () => {
    if (!editAlarm.appointmentId) return;
    try {
      const res = await appointmentsApi.deleteAppointment(editAlarm.appointmentId);
      if (res.success) {
        alarmService.stop(undefined, editAlarm.appointmentId);
        const raw = await AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY);
        const ids: number[] = raw ? JSON.parse(raw) : [];
        await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(ids.filter(id => id !== editAlarm.appointmentId)));
        await loadAlarms();
        bumpAlarmVersion();
        initialMode ? onClose() : setView('list');
      } else {
        Alert.alert('삭제 실패', res.message ?? '다시 시도해주세요.');
      }
    } catch {
      Alert.alert('삭제 실패', '네트워크 오류가 발생했습니다.');
    }
  };
  const toggleAlarm = async (id: string) => {
    const alarm = alarms.find((a) => a.id === id);
    if (!alarm?.appointmentId) return;
    const newValue = !alarm.enabled;
    setAlarms((prev) => prev.map((a) => a.id === id ? { ...a, enabled: newValue } : a));
    try {
      await appointmentsApi.toggleParticipantAlarm(alarm.appointmentId, newValue);
      alarmService.setActive(newValue, undefined, alarm.appointmentId);
    } catch {
      setAlarms((prev) => prev.map((a) => a.id === id ? { ...a, enabled: alarm.enabled } : a));
    }
  };
  const copyInviteCode = async () => {
    try {
      await Share.share({ message: editAlarm.inviteCode });
    } catch {}
  };
  const shareInviteCode = async () => {
    try {
      await Share.share({
        message: '[GoNow] 그룹 초대코드: ' + editAlarm.inviteCode + ' | 초대코드를 앱에 입력해 그룹에 참여하세요!',
      });
    } catch {}
  };
  const handlePlaceConfirm = () => {
    if (tempPlace?.lat && tempPlace?.lng) {
      setEditAlarm((prev) => ({
        ...prev,
        dest_name: tempPlace.name,
        dest_address: tempPlace.address,
        dest_lat: tempPlace.lat,
        dest_lng: tempPlace.lng,
      }));
      savePlace(tempPlace).catch(() => {});
    }
    setView('edit');
  };

  return (
    <BottomSheet ref={bottomSheetRef} index={0} snapPoints={snapPoints} onChange={handleSheetChange}
      onClose={onClose} enablePanDownToClose enableDynamicSizing={false}
      animateOnMount={false}
      handleIndicatorStyle={styles.indicator} backgroundStyle={styles.background}>

      {/* ── 목록 화면 ── */}
      {view === 'list' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}><Feather name="x" size={22} color="#1A1A1A" /></TouchableOpacity>
            <Text style={styles.title}>그룹</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}><Feather name="plus" size={22} color="#1A1A1A" /></TouchableOpacity>
          </View>
          <View style={styles.datePillContainer}>
            <View style={styles.datePill}><Text style={styles.datePillText}>{month}월 {date}일 {dayName}요일</Text></View>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {alarms.map((alarm) => (
              <SwipeableAlarmCard key={alarm.id} icon={alarm.isCurrentUserHost === false ? 'log-out' : 'trash'} onDelete={async () => {
                if (!alarm.appointmentId) return;
                try {
                  const [detailRes, profileRes] = await Promise.all([
                    appointmentsApi.getAppointment(alarm.appointmentId),
                    membersApi.getMyProfile(),
                  ]);
                  if (!detailRes.success || !detailRes.data || !profileRes.data) return;
                  const myMemberId = profileRes.data.member_id;
                  const isHost = detailRes.data.participants.some(
                    (p) => p.member_id === myMemberId && p.is_host,
                  );
                  if (isHost) {
                    const res = await appointmentsApi.deleteAppointment(alarm.appointmentId);
                    if (res.success) {
                      alarmService.stop(undefined, alarm.appointmentId);
                      const raw = await AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY);
                      const ids: number[] = raw ? JSON.parse(raw) : [];
                      await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(ids.filter(id => id !== alarm.appointmentId)));
                      await loadAlarms(); bumpAlarmVersion();
                    }
                  } else {
                    const res = await appointmentsApi.removeParticipant(alarm.appointmentId, myMemberId);
                    if (res.success) {
                      alarmService.stop(undefined, alarm.appointmentId);
                      const raw = await AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY);
                      const ids: number[] = raw ? JSON.parse(raw) : [];
                      await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(ids.filter(id => id !== alarm.appointmentId)));
                      await loadAlarms(); bumpAlarmVersion();
                    }
                  }
                } catch {}
              }}>
                <TouchableOpacity
                  style={styles.alarmCard}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (alarm.isArrivalActive) {
                      Platform.OS === 'android'
                        ? ToastAndroid.show('약속이 진행 중에는 수정할 수 없어요.', ToastAndroid.SHORT)
                        : Alert.alert('', '약속이 진행 중에는 수정할 수 없어요.');
                      return;
                    }
                    openEdit(alarm);
                  }}
                >
                  <View style={[styles.alarmInfo, alarm.isArrivalActive && { opacity: 0.45 }]}>
                    <Text style={styles.alarmPlace}>{alarm.dest_name}</Text>
                    <View style={styles.alarmMeta}>
                      <Text style={styles.alarmDeadline}>{alarm.ampm} {alarm.hour}:{alarm.minute} 까지</Text>
                      {alarm.transport === 'public'
                        ? <MaterialCommunityIcons name="bus-side" size={15} color="#4A90D9" />
                        : <FontAwesome5 name="car-side" size={13} color="#F5A623" />
                      }
                    </View>
                  </View>
                  <View style={styles.cardRight}>
                    <View style={styles.memberBadge}>
                      <Feather name="users" size={11} color="#555555" />
                      <Text style={styles.memberCount}>{alarm.participant_count ?? alarm.members.length}명</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => onArrivalPress?.(alarm)}
                      disabled={!alarm.isArrivalActive}
                      style={[styles.arrivalBtn, alarm.isArrivalActive && styles.arrivalBtnActive]}
                    >
                      <FontAwesome6 name="person-walking" size={14} color={alarm.isArrivalActive ? '#FFFFFF' : '#CCCCCC'} />
                    </TouchableOpacity>
                    <Switch value={alarm.enabled} onValueChange={() => toggleAlarm(alarm.id)}
                      trackColor={{ false: '#E0E0E0', true: '#4CAF50' }} thumbColor="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </SwipeableAlarmCard>
            ))}
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 수정/추가 화면 ── */}
      {view === 'edit' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => initialMode ? onClose() : setView('list')}>
              <Feather name="x" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>
              {isEditMode
                ? editAlarm.isCurrentUserHost === false ? '그룹 알람 (참여)' : '그룹 알람 수정'
                : '그룹 알람 추가'}
            </Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}><Feather name="check" size={20} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <View
            style={[styles.pickerContainer, editAlarm.isCurrentUserHost === false && styles.pickerDisabled]}
            pointerEvents={editAlarm.isCurrentUserHost === false ? 'none' : 'auto'}
          >
            <Picker selectedValue={editAlarm.ampm} onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, ampm: v }))} style={styles.picker} itemStyle={styles.pickerItem}>
              <Picker.Item label="오전" value="오전" color="#1A1A1A" /><Picker.Item label="오후" value="오후" color="#1A1A1A" />
            </Picker>
            <Picker selectedValue={editAlarm.hour} onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, hour: v }))} style={styles.picker} itemStyle={styles.pickerItem}>
              {HOURS.map((h) => <Picker.Item key={h} label={h} value={h} color="#1A1A1A" />)}
            </Picker>
            <Picker selectedValue={editAlarm.minute} onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, minute: v }))} style={styles.picker} itemStyle={styles.pickerItem}>
              {MINUTES.map((m) => <Picker.Item key={m} label={m} value={m} color="#1A1A1A" />)}
            </Picker>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>멤버({editAlarm.members.length})</Text>
              <View style={styles.optionBox}>
                {editAlarm.members.map((member, index) => (
                  <View key={member.id}>
                    <View style={styles.memberRow}>
                      <View style={styles.memberLeft}>
                        <Text style={styles.memberName}>{member.name}</Text>
                        {member.isHost && (
                          <MaterialCommunityIcons name="crown" size={14} color="#F5A623" style={{ marginLeft: 5 }} />
                        )}
                      </View>
                      <View style={styles.memberRight}>
                        {member.transport === 'public' && (
                          <MaterialCommunityIcons name="bus-side" size={20} color="#4A90D9" />
                        )}
                        {member.transport === 'car' && (
                          <FontAwesome5 name="car-side" size={18} color="#F5A623" />
                        )}
                        {editAlarm.isCurrentUserHost && !member.isHost && (
                          <TouchableOpacity onPress={() => handleKickMember(member)} style={{ marginLeft: 16 }}>
                            <Entypo name="block" size={22} color="#FF3B30" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    {index < editAlarm.members.length - 1 && <View style={styles.separator} />}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.section}>
              <View style={styles.optionBox}>
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={openPlace}
                  disabled={editAlarm.isCurrentUserHost === false}
                >
                  <Text style={[styles.optionLabel, editAlarm.isCurrentUserHost === false && { color: '#AAAAAA' }]}>목적지</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue} numberOfLines={1}>{editAlarm.dest_name || '선택'}</Text>
                    {editAlarm.isCurrentUserHost !== false && (
                      <Feather name="chevron-right" size={16} color="#AAAAAA" />
                    )}
                  </View>
                </TouchableOpacity>
                <View style={styles.separator} />
                <TouchableOpacity style={styles.optionRow} onPress={() => setView('transport')}>
                  <Text style={styles.optionLabel}>이동수단</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue}>{editAlarm.transport === 'public' ? '대중교통' : '자가용'}</Text>
                    <Feather name="chevron-right" size={16} color="#AAAAAA" />
                  </View>
                </TouchableOpacity>
                {isEditMode && (<>
                  <View style={styles.separator} />
                  <View style={styles.optionRow}>
                    <Text style={styles.optionLabel}>초대코드</Text>
                    <View style={styles.rowRight}>
                      <Text style={styles.inviteCode}>{editAlarm.inviteCode}</Text>
                      <TouchableOpacity onPress={copyInviteCode} style={{ marginLeft: 8 }}><Feather name="copy" size={16} color="#AAAAAA" /></TouchableOpacity>
                      <TouchableOpacity onPress={shareInviteCode} style={{ marginLeft: 8 }}><Feather name="share" size={16} color="#AAAAAA" /></TouchableOpacity>
                    </View>
                  </View>
                </>)}
              </View>
            </View>
            {isEditMode && editAlarm.isCurrentUserHost === true && (
              <View style={styles.deleteContainer}>
                <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}><Text style={styles.deleteButtonText}>그룹 삭제</Text></TouchableOpacity>
              </View>
            )}
            {isEditMode && editAlarm.isCurrentUserHost === false && (
              <View style={styles.deleteContainer}>
                <TouchableOpacity style={styles.deleteButton} onPress={handleLeave}><Text style={styles.deleteButtonText}>그룹 탈퇴</Text></TouchableOpacity>
              </View>
            )}
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 추가 선택 화면 ── */}
      {view === 'addChoice' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => initialMode ? onClose() : setView('list')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>그룹 추가</Text>
            <View style={{ width: 36 }} />
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.choiceBox}>
              <TouchableOpacity style={styles.choiceRow} onPress={openNewGroup}>
                <View style={styles.choiceIcon}>
                  <Feather name="plus-circle" size={22} color="#1A1A1A" />
                </View>
                <View style={styles.choiceInfo}>
                  <Text style={styles.choiceTitle}>새 그룹 만들기</Text>
                  <Text style={styles.choiceDesc}>새로운 그룹 알람을 만들어요</Text>
                </View>
                <Feather name="chevron-right" size={16} color="#AAAAAA" />
              </TouchableOpacity>
              <View style={styles.separator} />
              <TouchableOpacity style={styles.choiceRow} onPress={() => setView('join')}>
                <View style={styles.choiceIcon}>
                  <Feather name="user-plus" size={22} color="#1A1A1A" />
                </View>
                <View style={styles.choiceInfo}>
                  <Text style={styles.choiceTitle}>초대코드로 참여</Text>
                  <Text style={styles.choiceDesc}>받은 초대코드로 그룹에 참여해요</Text>
                </View>
                <Feather name="chevron-right" size={16} color="#AAAAAA" />
              </TouchableOpacity>
            </View>
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 초대코드 참여 화면 ── */}
      {view === 'join' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('addChoice')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>초대코드로 참여</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleJoin}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.joinLabel}>초대코드 입력</Text>
            <View style={[styles.inviteInputBox, inviteError ? styles.inviteInputBoxError : null]}>
              <TextInput
                style={styles.inviteInput}
                placeholder="초대코드를 입력하세요"
                placeholderTextColor="#BBBBBB"
                value={inviteCode}
                onChangeText={(t) => { setInviteCode(t); setInviteError(''); }}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {inviteError !== '' && (
              <Text style={styles.inviteError}>{inviteError}</Text>
            )}
            <Text style={styles.joinDesc}>방장에게 받은 8자리 초대코드를 입력해주세요.</Text>

            <Text style={[styles.joinLabel, { marginTop: 24 }]}>이동수단</Text>
            <View style={styles.optionBox}>
              <TouchableOpacity style={styles.optionRow} onPress={() => setJoinTransport('public')}>
                <Text style={styles.optionLabel}>대중교통</Text>
                {joinTransport === 'public' && <Feather name="check" size={18} color="#F5A623" />}
              </TouchableOpacity>
              <View style={styles.separator} />
              <TouchableOpacity style={styles.optionRow} onPress={() => setJoinTransport('car')}>
                <Text style={styles.optionLabel}>자가용</Text>
                {joinTransport === 'car' && <Feather name="check" size={18} color="#F5A623" />}
              </TouchableOpacity>
            </View>
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 이동수단 선택 화면 ── */}
      {view === 'transport' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>이동수단</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => setView('edit')}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.optionBox}>
              <TouchableOpacity style={styles.optionRow} onPress={() => setEditAlarm((prev) => ({ ...prev, transport: 'public' }))}>
                <Text style={styles.optionLabel}>대중교통</Text>
                {editAlarm.transport === 'public' && <Feather name="check" size={18} color="#F5A623" />}
              </TouchableOpacity>
              <View style={styles.separator} />
              <TouchableOpacity style={styles.optionRow} onPress={() => setEditAlarm((prev) => ({ ...prev, transport: 'car' }))}>
                <Text style={styles.optionLabel}>자가용</Text>
                {editAlarm.transport === 'car' && <Feather name="check" size={18} color="#F5A623" />}
              </TouchableOpacity>
            </View>
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 목적지 선택 화면 ── */}
      {view === 'place' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}><Feather name="chevron-left" size={22} color="#1A1A1A" /></TouchableOpacity>
            <Text style={styles.title}>목적지</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handlePlaceConfirm}><Feather name="check" size={20} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <AddressSearchView
            key={searchKey}
            initialResults={tempPlace?.id === 'current_dest' ? [tempPlace!, ...places] : places}
            selectedId={tempPlace?.id}
            onSelect={(item) => setTempPlace(item)}
            onDeleteServerPlace={deletePlace}
          />
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  indicator: { backgroundColor: '#DDDDDD', width: 40 },
  background: { backgroundColor: '#FFFFFF', borderRadius: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center' },
  saveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5A623', alignItems: 'center', justifyContent: 'center' },
  datePillContainer: { alignItems: 'center', marginBottom: 16 },
  datePill: { backgroundColor: '#E8E8E8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  datePillText: { fontSize: 13, fontWeight: '500', color: '#FF3B30' },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  alarmCard: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#F5F5F5', borderRadius: 12, marginBottom: 8 },
  alarmInfo: { flex: 1, marginRight: 8, justifyContent: 'center' },
  alarmPlace: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 5 },
  alarmMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alarmDeadline: { fontSize: 13, fontWeight: '500', color: '#555555' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#E8E8E8', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  memberCount: { fontSize: 11, color: '#555555', fontWeight: '500' },
  arrivalBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center' },
  arrivalBtnActive: { backgroundColor: '#92DEFE' },
  pickerContainer: { flexDirection: 'row', backgroundColor: '#F5F5F5', borderRadius: 14, overflow: 'hidden', height: 200, marginHorizontal: 16, marginBottom: 8 },
  picker: { flex: 1 },
  pickerItem: { fontSize: 20, color: '#1A1A1A', height: 200 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 },
  optionBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16 },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 50 },
  optionLabel: { fontSize: 15, color: '#1A1A1A' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowValue: { fontSize: 14, color: '#AAAAAA' },
  inviteCode: { fontSize: 14, color: '#AAAAAA', letterSpacing: 1 },
  memberRow: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memberLeft: { flexDirection: 'row', alignItems: 'center' },
  memberRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerDisabled: { opacity: 0.4 },
  memberName: { fontSize: 15, color: '#1A1A1A' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDDDDD' },
  deleteContainer: { alignItems: 'center', marginTop: 8 },
  deleteButton: { backgroundColor: '#FF3B30', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 48 },
  deleteButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },


  choiceBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  choiceIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' },
  choiceInfo: { flex: 1 },
  choiceTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  choiceDesc: { fontSize: 12, color: '#888888', marginTop: 2 },
  joinLabel: { fontSize: 13, fontWeight: '600', color: '#888888', marginBottom: 8 },
  inviteInputBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16, height: 52, justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  inviteInputBoxError: { borderColor: '#FF3B30' },
  inviteInput: { fontSize: 16, color: '#1A1A1A', letterSpacing: 2 },
  inviteError: { fontSize: 12, color: '#FF3B30', marginTop: 6 },
  joinDesc: { fontSize: 13, color: '#AAAAAA', marginTop: 12, textAlign: 'center' },
});