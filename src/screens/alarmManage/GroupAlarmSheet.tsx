import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { maskToRepeatDays, targetTimeToAmpmHourMinute } from '@/src/api/journeys';
import { usePlaces } from '@/src/hooks/usePlaces';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, Platform, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type MemberTransport = 'public' | 'car';
interface Member { id: string; name: string; isMe: boolean; transport?: MemberTransport; }
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
}

interface Props {
  onClose: () => void;
  onArrivalPress?: (alarm: GroupAlarm) => void;
}

const alarmsApi = createAlarmsApi();

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
    isArrivalActive: item.appointment_status === 'ACTIVE',
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

export default function GroupAlarmSheet({ onClose, onArrivalPress }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const { selectedDate } = useCalendarStore();

  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('DEST');

  const [view, setView] = useState<ViewType>('list');
  const [alarms, setAlarms] = useState<GroupAlarm[]>([]);
  const [editAlarm, setEditAlarm] = useState<GroupAlarm>(DEFAULT_ALARM);
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState('');
  const isEditMode = !!editAlarm.id;

  useEffect(() => {
    loadPlaces().catch(() => {});
  }, [loadPlaces]);

  const loadAlarms = useCallback(async () => {
    try {
      const res = await alarmsApi.getAlarms(selectedDate);
      setAlarms((res.data ?? []).filter((a) => a.alarm_type === 'GROUP').map(fromAlarmItem));
    } catch {}
  }, [selectedDate]);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  const dateObj = new Date(selectedDate);
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayName = DAY_NAMES[dateObj.getDay()];

  const handleSheetChange = useCallback((index: number) => { if (index === -1) onClose(); }, [onClose]);
  const openAdd = () => { setEditAlarm(DEFAULT_ALARM); setView('edit'); };
  const openNewGroup = () => { setEditAlarm(DEFAULT_ALARM); setView('edit'); };
  const handleJoin = () => {
    if (inviteCode.trim().length === 0) { setInviteError('초대코드를 입력해주세요.'); return; }
    // TODO: 백엔드 API 연결
    console.log('그룹 참여:', inviteCode);
    setInviteCode('');
    setInviteError('');
    setView('list');
  };
  const openEdit = (alarm: GroupAlarm) => { setEditAlarm(alarm); setView('edit'); };
  const openPlace = () => {
    setTempPlace(
      editAlarm.dest_name
        ? { id: 'current_dest', name: editAlarm.dest_name, address: editAlarm.dest_address, lat: editAlarm.dest_lat, lng: editAlarm.dest_lng }
        : null
    );
    setView('place');
  };
  const handleSave = () => {
    if (isEditMode) setAlarms((prev) => prev.map((a) => a.id === editAlarm.id ? editAlarm : a));
    else setAlarms((prev) => [...prev, { ...editAlarm, id: String(Date.now()), inviteCode: Math.random().toString(36).slice(2, 8) }]);
    setView('list');
  };
  const handleDelete = () => { setAlarms((prev) => prev.filter((a) => a.id !== editAlarm.id)); setView('list'); };
  const toggleAlarm = (id: string) => setAlarms((prev) => prev.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a));
  const copyInviteCode = () => Clipboard.setString(editAlarm.inviteCode);
  const shareInviteCode = async () => {
    try {
      await Share.share({
        message: '[GoNow] 그룹 초대코드: ' + editAlarm.inviteCode + ' | 초대코드를 앱에 입력해 그룹에 참여하세요!',
      });
    } catch (e) {
      console.error('공유 오류:', e);
    }
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
              <SwipeableAlarmCard key={alarm.id} onDelete={() => setAlarms((prev) => prev.filter((a) => a.id !== alarm.id))}>
                <TouchableOpacity style={styles.alarmCard} onPress={() => openEdit(alarm)} activeOpacity={0.7}>
                  <View style={styles.alarmInfo}>
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
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('list')}>
              <Feather name="x" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>{isEditMode ? '그룹 알람 수정' : '그룹 알람 추가'}</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}><Feather name="check" size={20} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <View style={styles.pickerContainer}>
            <Picker selectedValue={editAlarm.ampm} onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, ampm: v }))} style={styles.picker} itemStyle={styles.pickerItem}>
              <Picker.Item label="오전" value="오전" /><Picker.Item label="오후" value="오후" />
            </Picker>
            <Picker selectedValue={editAlarm.hour} onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, hour: v }))} style={styles.picker} itemStyle={styles.pickerItem}>
              {HOURS.map((h) => <Picker.Item key={h} label={h} value={h} />)}
            </Picker>
            <Picker selectedValue={editAlarm.minute} onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, minute: v }))} style={styles.picker} itemStyle={styles.pickerItem}>
              {MINUTES.map((m) => <Picker.Item key={m} label={m} value={m} />)}
            </Picker>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>멤버({editAlarm.members.length})</Text>
              <View style={styles.optionBox}>
                {editAlarm.members.map((member, index) => (
                  <View key={member.id}>
                    <View style={styles.memberRow}>
                      <Text style={styles.memberName}>{member.name}</Text>
                      {member.transport === 'public' && (
                        <MaterialCommunityIcons name="bus-side" size={20} color="#4A90D9" />
                      )}
                      {member.transport === 'car' && (
                        <FontAwesome5 name="car-side" size={18} color="#F5A623" />
                      )}
                    </View>
                    {index < editAlarm.members.length - 1 && <View style={styles.separator} />}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.section}>
              <View style={styles.optionBox}>
                <TouchableOpacity style={styles.optionRow} onPress={openPlace}>
                  <Text style={styles.optionLabel}>목적지</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue} numberOfLines={1}>{editAlarm.dest_name || '선택'}</Text>
                    <Feather name="chevron-right" size={16} color="#AAAAAA" />
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
            {isEditMode && (
              <View style={styles.deleteContainer}>
                <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}><Text style={styles.deleteButtonText}>알람삭제</Text></TouchableOpacity>
              </View>
            )}
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 추가 선택 화면 ── */}
      {view === 'addChoice' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('list')}>
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
            <Text style={styles.joinDesc}>방장에게 받은 6자리 초대코드를 입력해주세요.</Text>
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
            initialResults={places}
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