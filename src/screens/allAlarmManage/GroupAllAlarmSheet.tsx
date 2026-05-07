import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import { Feather, FontAwesome5, FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Clipboard,
  Platform,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type MemberTransport = 'public' | 'car';
interface Member {
  id: string;
  name: string;
  isMe: boolean;
  transport?: MemberTransport;
}

type Transport = 'public' | 'car';

interface GroupAlarm {
  id: string;
  ampm: string;
  hour: string;
  minute: string;
  place: string;
  enabled: boolean;
  members: Member[];
  inviteCode: string;
  isArrivalActive?: boolean;
  transport: Transport;
}

interface Props {
  onClose: () => void;
  onArrivalPress?: (alarm: GroupAlarm) => void;
}

const RECENT_PLACES: SearchResult[] = [
  { id: '1', name: '홍대역 2번 출구', address: '서울 마포구 양화로', isCurrent: true },
  { id: '2', name: '중앙대학교 후문 입구', address: '서울 동작구 흑석로', isCurrent: false },
];

const SAMPLE_GROUP_ALARMS: GroupAlarm[] = [
  {
    id: '1', ampm: '오후', hour: '7', minute: '00',
    place: '홍대역 2번 출구', enabled: true,
    members: [
      { id: '1', name: '가가가(본인)', isMe: true, transport: 'public' as MemberTransport },
      { id: '2', name: '나나나', isMe: false, transport: 'public' as MemberTransport },
      { id: '3', name: '다다다', isMe: false, transport: 'car' as MemberTransport },
    ],
    inviteCode: 'abcdeg',
    isArrivalActive: true,
    transport: 'public' as Transport,
  },
  {
    id: '2', ampm: '오후', hour: '6', minute: '00',
    place: '용산역', enabled: true,
    members: [
      { id: '1', name: '가가가(본인)', isMe: true },
    ],
    inviteCode: 'xyzabc',
    isArrivalActive: false,
    transport: 'public' as Transport,
  },
];

const DEFAULT_ALARM: GroupAlarm = {
  id: '', ampm: '오전', hour: '7', minute: '00',
  place: '', enabled: true,
  members: [{ id: 'me', name: '가가가(본인)', isMe: true }],
  inviteCode: '',
  isArrivalActive: false,
  transport: 'public' as Transport,
};

type ViewType = 'list' | 'edit' | 'place' | 'addChoice' | 'join' | 'transport';

export default function GroupAllAlarmSheet({ onClose, onArrivalPress }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  const [view, setView] = useState<ViewType>('list');
  const [alarms, setAlarms] = useState<GroupAlarm[]>(SAMPLE_GROUP_ALARMS);
  const [editAlarm, setEditAlarm] = useState<GroupAlarm>(DEFAULT_ALARM);
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState('');
  const isEditMode = !!editAlarm.id;

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const openAdd = () => { setView('addChoice'); };
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
    const cur = RECENT_PLACES.find((p) => p.name === editAlarm.place);
    setTempPlace(cur ?? null);
    setView('place');
  };
  const handlePlaceConfirm = () => {
    if (tempPlace) setEditAlarm((prev) => ({ ...prev, place: tempPlace.name }));
    setView('edit');
  };

  const handleSave = () => {
    if (isEditMode) {
      setAlarms((prev) => prev.map((a) => a.id === editAlarm.id ? editAlarm : a));
    } else {
      setAlarms((prev) => [...prev, {
        ...editAlarm,
        id: String(Date.now()),
        inviteCode: Math.random().toString(36).slice(2, 8),
      }]);
    }
    setView('list');
  };

  const handleDelete = () => {
    setAlarms((prev) => prev.filter((a) => a.id !== editAlarm.id));
    setView('list');
  };

  const toggleAlarm = (id: string) => {
    setAlarms((prev) => prev.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a));
  };

  const copyInviteCode = () => {
    Clipboard.setString(editAlarm.inviteCode);
  };
  const shareInviteCode = async () => {
    try {
      await Share.share({
        message: '[GoNow] 그룹 초대코드: ' + editAlarm.inviteCode + ' | 초대코드를 앱에 입력해 그룹에 참여하세요!',
      });
    } catch (e) {
      console.error('공유 오류:', e);
    }
  };

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      onClose={onClose}
      enablePanDownToClose
      enableDynamicSizing={false}
      handleIndicatorStyle={styles.indicator}
      backgroundStyle={styles.background}
    >
      {/* ── 목록 화면 ── */}
      {view === 'list' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
              <Feather name="x" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>그룹</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Feather name="plus" size={22} color="#1A1A1A" />
            </TouchableOpacity>
          </View>

          <View style={styles.datePillContainer}>
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>전체</Text>
            </View>
          </View>

          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {alarms.map((alarm) => (
              <SwipeableAlarmCard key={alarm.id} onDelete={() => setAlarms((prev) => prev.filter((a) => a.id !== alarm.id))}>
                <TouchableOpacity style={styles.alarmCard} onPress={() => openEdit(alarm)} activeOpacity={0.7}>
                  <View style={styles.alarmInfo}>
                    <View style={styles.timeRow}>
                      <Text style={styles.ampmSmall}>{alarm.ampm}</Text>
                      <Text style={styles.alarmTime}>{alarm.hour}:{alarm.minute}</Text>
                    </View>
                    <Text style={styles.alarmPlace}>{alarm.place}</Text>
                  </View>
                  <View style={styles.cardRight}>
                    <TouchableOpacity
                      onPress={() => onArrivalPress?.(alarm)}
                      disabled={!alarm.isArrivalActive}
                      style={[styles.arrivalBtn, alarm.isArrivalActive && styles.arrivalBtnActive]}
                    >
                      <FontAwesome6
                        name="person-walking"
                        size={14}
                        color={alarm.isArrivalActive ? '#FFFFFF' : '#CCCCCC'}
                      />
                    </TouchableOpacity>
                    <Switch
                      value={alarm.enabled}
                      onValueChange={() => toggleAlarm(alarm.id)}
                      trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                      thumbColor="#FFFFFF"
                    />
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
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={editAlarm.ampm}
              onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, ampm: v }))}
              style={styles.picker}
              itemStyle={styles.pickerItem}
            >
              <Picker.Item label="오전" value="오전" />
              <Picker.Item label="오후" value="오후" />
            </Picker>
            <Picker
              selectedValue={editAlarm.hour}
              onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, hour: v }))}
              style={styles.picker}
              itemStyle={styles.pickerItem}
            >
              {HOURS.map((h) => <Picker.Item key={h} label={h} value={h} />)}
            </Picker>
            <Picker
              selectedValue={editAlarm.minute}
              onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, minute: v }))}
              style={styles.picker}
              itemStyle={styles.pickerItem}
            >
              {MINUTES.map((m) => <Picker.Item key={m} label={m} value={m} />)}
            </Picker>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

            {/* 멤버 */}
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

            {/* 목적지 / 초대코드 */}
            <View style={styles.section}>
              <View style={styles.optionBox}>
                <TouchableOpacity style={styles.optionRow} onPress={openPlace}>
                  <Text style={styles.optionLabel}>목적지</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue} numberOfLines={1}>
                      {editAlarm.place || '선택'}
                    </Text>
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
                {isEditMode && (
                  <>
                    <View style={styles.separator} />
                    <View style={styles.optionRow}>
                      <Text style={styles.optionLabel}>초대코드</Text>
                      <View style={styles.rowRight}>
                        <Text style={styles.rowValue}>{editAlarm.inviteCode}</Text>
                        <TouchableOpacity onPress={copyInviteCode} style={{ marginLeft: 8 }}>
                          <Feather name="copy" size={16} color="#AAAAAA" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={shareInviteCode} style={{ marginLeft: 8 }}>
                          <Feather name="share" size={16} color="#AAAAAA" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </View>

            {isEditMode && (
              <View style={styles.deleteContainer}>
                <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
                  <Text style={styles.deleteButtonText}>알람삭제</Text>
                </TouchableOpacity>
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
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>목적지</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handlePlaceConfirm}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <AddressSearchView
            initialResults={RECENT_PLACES}
            selectedId={tempPlace?.id}
            onSelect={(item) => setTempPlace(item)}
          />
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  indicator: { backgroundColor: '#DDDDDD', width: 40 },
  background: { backgroundColor: '#FFFFFF', borderRadius: 20 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center',
  },
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F5A623', alignItems: 'center', justifyContent: 'center',
  },
  datePillContainer: { alignItems: 'center', marginBottom: 16 },
  datePill: {
    backgroundColor: '#E8E8E8', borderRadius: 20,
    paddingHorizontal: 24, paddingVertical: 6,
  },
  datePillText: { fontSize: 13, fontWeight: '500', color: '#FF3B30' },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  alarmCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 16,
    backgroundColor: '#F5F5F5', borderRadius: 12, marginBottom: 8,
  },
  alarmInfo: { flex: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  ampmSmall: { fontSize: 14, color: '#1A1A1A', marginBottom: 8 },
  alarmTime: { fontSize: 48, fontWeight: '500', color: '#1A1A1A', letterSpacing: -1, lineHeight: 54 },
  alarmPlace: { fontSize: 12, color: '#888888', marginTop: 2 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  arrivalBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center',
  },
  arrivalBtnActive: { backgroundColor: '#92DEFE' },
  pickerContainer: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F5', borderRadius: 14,
    overflow: 'hidden', height: 200,
    marginHorizontal: 16, marginBottom: 8,
  },
  picker: { flex: 1 },
  pickerItem: { fontSize: 20, color: '#1A1A1A', height: 200 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 },
  optionBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', height: 50,
  },
  optionLabel: { fontSize: 15, color: '#1A1A1A' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowValue: { fontSize: 14, color: '#AAAAAA' },
  memberRow: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memberName: { fontSize: 15, color: '#1A1A1A' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDDDDD' },
  deleteContainer: { alignItems: 'center', marginTop: 8 },
  deleteButton: {
    backgroundColor: '#FF3B30', borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 48,
  },
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