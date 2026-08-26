import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import { SegmentedToggle } from '@/src/components/common/SegmentedToggle';
import { createAppointmentsApi } from '@/src/api/appointments';
import { alarmService } from '@/src/services/alarmService';
import { checkCoreAlarmPermissions } from '@/src/utils/permissions';
import { toTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { targetTimeToAmpmHourMinute } from '@/src/api/journeys';
import { createMembersApi } from '@/src/api/members';
import { usePlaces } from '@/src/hooks/usePlaces';
import { useCalendarStore } from '@/src/store/calendarStore';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import { Entypo, Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Platform, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  members: Member[]; inviteCode: string;
  transport: Transport;
  isCurrentUserHost?: boolean;
}

interface Props {
  onClose: () => void;
  initialMode: 'add' | 'create' | 'edit' | 'join';
  editAppointmentId?: number;
  initialAlarm?: any;
  initialInviteCode?: string;
}

const appointmentsApi = createAppointmentsApi();
const membersApi = createMembersApi();

function toTargetTime(date: string, ampm: string, hour: string, minute: string): string {
  let h = parseInt(hour, 10);
  if (ampm === '오후' && h !== 12) h += 12;
  if (ampm === '오전' && h === 12) h = 0;
  return `${date}T${String(h).padStart(2, '0')}:${minute}:00`;
}

const DEFAULT_ALARM: GroupAlarm = {
  id: '', ampm: '오전', hour: '7', minute: '00',
  dest_name: '', dest_address: '', dest_lat: undefined, dest_lng: undefined,
  members: [{ id: 'me', name: '가가가(본인)', isMe: true }], inviteCode: '',
  transport: 'public' as Transport,
};

type ViewType = 'edit' | 'place' | 'addChoice' | 'join';

export default function GroupAlarmSheet({ onClose, initialMode, editAppointmentId, initialAlarm, initialInviteCode }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['88%'], []);
  const { selectedDate, bumpAlarmVersion } = useCalendarStore();
  const { participantsVersion, deletedAppointmentId, setDeletedAppointmentId, removedAppointmentId, setRemovedAppointmentId } = useAppointmentStatusStore();

  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('DEST');

  const [view, setView] = useState<ViewType>(
    initialMode === 'join' ? 'join'
      : initialMode === 'add' ? 'addChoice'
      : 'edit'
  );
  const [editAlarm, setEditAlarm] = useState<GroupAlarm>(() => {
    if (initialMode === 'edit' && editAppointmentId && initialAlarm) {
      return { ...DEFAULT_ALARM, id: String(editAppointmentId), appointmentId: editAppointmentId, dest_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '7', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport };
    }
    return { ...DEFAULT_ALARM, ...targetTimeToAmpmHourMinute(new Date().toISOString()), minute: '00' };
  });
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? '');
  const [inviteError, setInviteError] = useState('');
  const [joinTransport, setJoinTransport] = useState<Transport>('public');
  const isEditMode = !!editAlarm.id;

  // place/join 화면에서 뒤로가기(스와이프 포함)를 하면 상위(edit/addChoice)로 안 돌아가고
  // 이 시트 전체가 닫혀버리는 문제 방지(2026-08-26, daily-alarm.tsx의 시트 전체 닫기
  // 핸들러와 같은 유형) — place/join에서는 이 핸들러가 먼저 소비해서 한 단계만 되돌리고,
  // edit/addChoice(이 컴포넌트의 최상위 화면)에서 누르면 소비하지 않고 넘겨서 상위
  // (daily-alarm.tsx)가 시트 전체를 닫도록 한다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'place') { setView('edit'); return true; }
      if (view === 'join') { setView('addChoice'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [view]);

  useEffect(() => {
    loadPlaces().catch(() => {});
  }, [loadPlaces]);

  useEffect(() => {
    if (initialMode === 'edit' && editAppointmentId) {
      const base = initialAlarm
        ? { ...DEFAULT_ALARM, id: String(editAppointmentId), appointmentId: editAppointmentId, dest_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '7', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport }
        : { ...DEFAULT_ALARM, id: String(editAppointmentId), appointmentId: editAppointmentId };
      openEdit(base);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSheetChange = useCallback((index: number) => { if (index === -1) onClose(); }, [onClose]);
  const openNewGroup = () => {
    setEditAlarm({ ...DEFAULT_ALARM, ...targetTimeToAmpmHourMinute(new Date().toISOString()), minute: '00' });
    setView('edit');
  };
  const handleJoin = async () => {
    if (inviteCode.trim().length === 0) { setInviteError('초대코드를 입력해주세요.'); return; }
    if (!(await checkCoreAlarmPermissions())) return;
    try {
      const res = await appointmentsApi.joinAppointment(
        inviteCode.trim(),
        joinTransport === 'public' ? 'TRANSIT' : 'DRIVING',
      );
      if (res.success && res.data) {
        if (res.data.participant_status === 'READY') {
          const detail = await appointmentsApi.getAppointment(res.data.appointment_id);
          if (detail.data) {
            alarmService.start({ alarmType: 'group', destination: detail.data.dest_name, appointmentId: res.data.appointment_id, destLat: detail.data.dest_lat, destLng: detail.data.dest_lng, transportMode: toTransportMode(joinTransport === 'car') });
          }
        }
        setInviteCode('');
        setInviteError('');
        setJoinTransport('public');
        bumpAlarmVersion();
        onClose();
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

  // 참가자 참여/탈퇴/추방/이동수단변경/방장수정 FCM 수신 시 상세정보 다시 불러오기
  // (마운트 시 최초 1회는 건너뜀 — 상세화면 진입 시 이미 openEdit이 직접 호출되므로 중복 호출 방지)
  const skipFirstParticipantsSync = useRef(true);
  useEffect(() => {
    if (skipFirstParticipantsSync.current) { skipFirstParticipantsSync.current = false; return; }
    if (view !== 'edit' || editAlarm.appointmentId == null) return;
    openEdit(editAlarm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantsVersion[editAlarm.appointmentId ?? -1]]);

  // 방장이 이 약속을 삭제했다는 FCM 수신 시 강제 종료
  useEffect(() => {
    if (deletedAppointmentId != null && deletedAppointmentId === editAlarm.appointmentId) {
      Alert.alert('약속 삭제', '방장님이 이 약속을 삭제했습니다.');
      setDeletedAppointmentId(null);
      onClose();
    }
  }, [deletedAppointmentId]);

  // 방장이 나를 추방했다는 FCM 수신 시 강제 종료
  useEffect(() => {
    if (removedAppointmentId != null && removedAppointmentId === editAlarm.appointmentId) {
      Alert.alert('약속 추방', '방장님이 이 약속에서 내보냈습니다.');
      setRemovedAppointmentId(null);
      onClose();
    }
  }, [removedAppointmentId]);

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
            alarmService.start({ alarmType: 'group', destination: editAlarm.dest_name, appointmentId: editAlarm.appointmentId, destLat: editAlarm.dest_lat, destLng: editAlarm.dest_lng, transportMode: toTransportMode(editAlarm.transport === 'car') });
            bumpAlarmVersion();
            onClose();
          } else {
            Alert.alert('수정 실패', res.message ?? '다시 시도해주세요.');
          }
        } else {
          if (!(await checkCoreAlarmPermissions())) return;
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
              alarmService.start({ alarmType: 'group', destination: editAlarm.dest_name, appointmentId: editAlarm.appointmentId, destLat: editAlarm.dest_lat, destLng: editAlarm.dest_lng, transportMode: toTransportMode(editAlarm.transport === 'car') });
            } else if (res.data?.participant_status === 'SCHEDULED' && editAlarm.appointmentId != null) {
              alarmService.stop(undefined, editAlarm.appointmentId);
            }
            bumpAlarmVersion();
            onClose();
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
    if (!(await checkCoreAlarmPermissions())) return;
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
          alarmService.start({ alarmType: 'group', destination: editAlarm.dest_name, appointmentId: res.data.appointment_id, destLat: editAlarm.dest_lat, destLng: editAlarm.dest_lng, transportMode: toTransportMode(editAlarm.transport === 'car') });
        }
        bumpAlarmVersion();
        onClose();
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
              bumpAlarmVersion();
              Alert.alert('탈퇴 완료', '그룹에서 탈퇴했습니다.', [
                { text: '확인', onPress: onClose },
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
        // alarmService.stop()이 내부적으로 ACTIVE_APPOINTMENTS_KEY 제거까지 안전하게(잠금 걸린 채) 처리함
        alarmService.stop(undefined, editAlarm.appointmentId);
        bumpAlarmVersion();
        onClose();
      } else {
        Alert.alert('삭제 실패', res.message ?? '다시 시도해주세요.');
      }
    } catch {
      Alert.alert('삭제 실패', '네트워크 오류가 발생했습니다.');
    }
  };
  const shareInviteCode = async () => {
    try {
      await Share.share({
        // https 유니버설 링크 — 앱이 설치돼 있으면 탭 한 번에 앱이 열리고 초대코드가 자동 입력된다
        // (app.json의 Android App Links + app/_layout.tsx의 딥링크 리스너 참고).
        message:
          '[GoNow] 모임에 초대되었습니다!\n' +
          '아래 링크를 누르면 그룹에 바로 참여할 수 있어요.\n' +
          `https://gonow-api.uk/join?code=${editAlarm.inviteCode}`,
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

      {/* ── 수정/추가 화면 ── */}
      {view === 'edit' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
              <Feather name="x" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>
              {isEditMode
                ? editAlarm.isCurrentUserHost === false ? '그룹 알람 (참여)' : '그룹 알람 수정'
                : '그룹 알람 추가'}
            </Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}><Feather name="check" size={20} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View
              style={[styles.timeCard, editAlarm.isCurrentUserHost === false && styles.pickerDisabled]}
              pointerEvents={editAlarm.isCurrentUserHost === false ? 'none' : 'auto'}
            >
              <Text style={styles.timeCardLabel}>목표 시각</Text>
              <View style={styles.pickerContainer}>
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
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>멤버({editAlarm.members.length})</Text>
              <View style={styles.optionBox}>
                {editAlarm.members.map((member, index) => (
                  <View key={member.id}>
                    <View style={styles.memberRow}>
                      <View style={styles.memberLeft}>
                        <Text style={styles.memberName}>{member.name}</Text>
                        {member.isHost && (
                          <MaterialCommunityIcons name="crown" size={14} color="#FF9F0A" style={{ marginLeft: 5 }} />
                        )}
                      </View>
                      <View style={styles.memberRight}>
                        {member.transport === 'public' && (
                          <MaterialCommunityIcons name="bus-side" size={20} color="#FF9F0A" />
                        )}
                        {member.transport === 'car' && (
                          <FontAwesome5 name="car-side" size={18} color="#FF9F0A" />
                        )}
                        {editAlarm.isCurrentUserHost && !member.isHost && (
                          <TouchableOpacity onPress={() => handleKickMember(member)} style={{ marginLeft: 16 }}>
                            <Entypo name="block" size={22} color="#FF453A" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    {index < editAlarm.members.length - 1 && <View style={styles.separator} />}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldGroupLabel}>어디로 가시나요?</Text>
              <TouchableOpacity
                style={[styles.fieldRow, editAlarm.isCurrentUserHost === false && styles.fieldRowDisabled]}
                onPress={openPlace}
                disabled={editAlarm.isCurrentUserHost === false}
                activeOpacity={0.7}
              >
                <Feather name="map-pin" size={17} color="#FF9F0A" />
                <Text style={styles.fieldValue} numberOfLines={1}>{editAlarm.dest_name || '목적지 선택'}</Text>
                {editAlarm.isCurrentUserHost !== false && <Feather name="chevron-right" size={16} color="#B0B0B4" />}
              </TouchableOpacity>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldGroupLabel}>이동 수단</Text>
              <SegmentedToggle
                value={editAlarm.transport}
                onChange={(v) => setEditAlarm((prev) => ({ ...prev, transport: v }))}
                options={[
                  { value: 'public', label: '대중교통', icon: (sel) => <MaterialCommunityIcons name="bus-side" size={16} color={sel ? '#1A1A1A' : '#8A8A8E'} /> },
                  { value: 'car', label: '자가용', icon: (sel) => <FontAwesome5 name="car-side" size={14} color={sel ? '#1A1A1A' : '#8A8A8E'} /> },
                ]}
              />
            </View>

            {isEditMode && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldGroupLabel}>초대코드</Text>
                <View style={styles.fieldRow}>
                  <Feather name="key" size={17} color="#FF9F0A" />
                  <Text style={styles.fieldValue}>{editAlarm.inviteCode}</Text>
                  <TouchableOpacity onPress={shareInviteCode}>
                    <Feather name="share" size={17} color="#B0B0B4" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
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
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
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
                {joinTransport === 'public' && <Feather name="check" size={18} color="#FF9F0A" />}
              </TouchableOpacity>
              <View style={styles.separator} />
              <TouchableOpacity style={styles.optionRow} onPress={() => setJoinTransport('car')}>
                <Text style={styles.optionLabel}>자가용</Text>
                {joinTransport === 'car' && <Feather name="check" size={18} color="#FF9F0A" />}
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
  saveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF9F0A', alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  pickerContainer: { flexDirection: 'row', backgroundColor: '#F7F7F8', borderRadius: 14, overflow: 'hidden', height: Platform.OS === 'ios' ? 200 : 56, marginTop: 8 },
  picker: { flex: 1 },
  pickerItem: { fontSize: 20, color: '#1A1A1A', height: 200 },
  fieldGroup: { marginBottom: 16 },
  fieldGroupLabel: { fontSize: 12, fontWeight: '600', color: '#8A8A8E', marginBottom: 8 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F7F7F8', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14,
  },
  fieldRowDisabled: { opacity: 0.5 },
  fieldValue: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  timeCard: { backgroundColor: '#F7F7F8', borderRadius: 18, padding: 12, marginBottom: 16 },
  timeCardLabel: { fontSize: 12, fontWeight: '600', color: '#8A8A8E', textAlign: 'center' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 },
  optionBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16 },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 50 },
  optionLabel: { fontSize: 15, color: '#1A1A1A' },
  memberRow: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memberLeft: { flexDirection: 'row', alignItems: 'center' },
  memberRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerDisabled: { opacity: 0.4 },
  memberName: { fontSize: 15, color: '#1A1A1A' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDDDDD' },
  deleteContainer: { alignItems: 'center', marginTop: 8 },
  deleteButton: { backgroundColor: '#FF453A', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 48 },
  deleteButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },


  choiceBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  choiceIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' },
  choiceInfo: { flex: 1 },
  choiceTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  choiceDesc: { fontSize: 12, color: '#888888', marginTop: 2 },
  joinLabel: { fontSize: 13, fontWeight: '600', color: '#888888', marginBottom: 8 },
  inviteInputBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16, height: 52, justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  inviteInputBoxError: { borderColor: '#FF453A' },
  inviteInput: { fontSize: 16, color: '#1A1A1A', letterSpacing: 2 },
  inviteError: { fontSize: 12, color: '#FF453A', marginTop: 6 },
  joinDesc: { fontSize: 13, color: '#AAAAAA', marginTop: 12, textAlign: 'center' },
});