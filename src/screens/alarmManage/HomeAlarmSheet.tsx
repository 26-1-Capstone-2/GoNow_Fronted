import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const DAYS = ['일요일마다', '월요일마다', '화요일마다', '수요일마다', '목요일마다', '금요일마다', '토요일마다', '안함'];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type AlarmMode = 'lastTrain' | 'deadline';
type ViewType = 'list' | 'edit' | 'repeat' | 'homePlace';

interface HomeAlarm {
  id: string;
  mode: AlarmMode;
  ampm: string;
  hour: string;
  minute: string;
  place: string;
  repeat: string[];
  enabled: boolean;
}

interface Props {
  onClose: () => void;
}

const HOME_PLACES: SearchResult[] = [
  { id: 'home1', name: '우리집', address: '서울 어쩌고 저쩌고', isCurrent: true, isHome: true },
  { id: 'home2', name: '서울 가가가', address: '서울 저쩌고 어쩌고', isCurrent: false, isHome: false },
];

function getRepeatLabel(repeat: string[]): string {
  if (repeat.includes('안함') || repeat.length === 0) return '안함';
  const weekdays = ['월요일마다', '화요일마다', '수요일마다', '목요일마다', '금요일마다'];
  const weekend = ['토요일마다', '일요일마다'];
  const all = [...weekdays, ...weekend];
  if (all.every((d) => repeat.includes(d))) return '매일';
  if (weekdays.every((d) => repeat.includes(d)) && repeat.length === weekdays.length) return '주중';
  if (weekend.every((d) => repeat.includes(d)) && repeat.length === weekend.length) return '주말';
  return repeat.map((r) => r.replace('요일마다', '')).join(', ');
}

const SAMPLE_HOME_ALARMS: HomeAlarm[] = [
  { id: '1', mode: 'lastTrain', ampm: '오후', hour: '11', minute: '00', place: '우리집', repeat: ['안함'], enabled: true },
  { id: '2', mode: 'deadline', ampm: '오후', hour: '11', minute: '00', place: '우리집', repeat: ['주중'], enabled: false },
];

const DEFAULT_ALARM: HomeAlarm = {
  id: '', mode: 'lastTrain', ampm: '오후', hour: '11', minute: '00',
  place: '우리집', repeat: ['안함'], enabled: true,
};

export default function HomeAlarmSheet({ onClose }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const { selectedDate } = useCalendarStore();

  const [view, setView] = useState<ViewType>('list');
  const [alarms, setAlarms] = useState<HomeAlarm[]>(SAMPLE_HOME_ALARMS);
  const [editAlarm, setEditAlarm] = useState<HomeAlarm>(DEFAULT_ALARM);
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const isEditMode = !!editAlarm.id;

  const dateObj = new Date(selectedDate);
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayName = DAY_NAMES[dateObj.getDay()];

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const openAdd = () => { setEditAlarm(DEFAULT_ALARM); setView('edit'); };
  const openHomePlace = () => {
    const cur = HOME_PLACES.find((p) => p.name === editAlarm.place);
    setTempPlace(cur ?? null);
    setView('homePlace');
  };
  const handleHomePlaceConfirm = () => {
    if (tempPlace) setEditAlarm((prev) => ({ ...prev, place: tempPlace.name }));
    setView('edit');
  };
  const openEdit = (alarm: HomeAlarm) => { setEditAlarm(alarm); setView('edit'); };

  const handleSave = () => {
    if (isEditMode) {
      setAlarms((prev) => prev.map((a) => a.id === editAlarm.id ? editAlarm : a));
    } else {
      setAlarms((prev) => [...prev, { ...editAlarm, id: String(Date.now()) }]);
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

  const toggleRepeat = (day: string) => {
    setEditAlarm((prev) => {
      if (day === '안함') return { ...prev, repeat: ['안함'] };
      const has = prev.repeat.includes(day);
      let next = has
        ? prev.repeat.filter((r) => r !== day)
        : prev.repeat.filter((r) => r !== '안함').concat(day);
      if (next.length === 0) next = ['안함'];
      return { ...prev, repeat: next };
    });
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
            <Text style={styles.title}>귀가</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Feather name="plus" size={22} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
          <View style={styles.datePillContainer}>
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>{month}월 {date}일 {dayName}요일</Text>
            </View>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {alarms.map((alarm, index) => (
              <View key={alarm.id}>
                <TouchableOpacity style={styles.alarmCard} onPress={() => openEdit(alarm)} activeOpacity={0.7}>
                  <View style={styles.alarmInfo}>
                    {alarm.mode === 'lastTrain' ? (
                      <Text style={styles.lastTrainText}>막차</Text>
                    ) : (
                      <View style={styles.timeRow}>
                        <Text style={styles.ampmSmall}>{alarm.ampm}</Text>
                        <Text style={styles.alarmTime}>{alarm.hour}:{alarm.minute}</Text>
                      </View>
                    )}
                    <Text style={styles.alarmPlace}>{alarm.place}, {getRepeatLabel(alarm.repeat)}</Text>
                  </View>
                  <Switch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(alarm.id)}
                    trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                    thumbColor="#FFFFFF"
                  />
                </TouchableOpacity>

              </View>
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
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* 막차 / 데드라인 탭 */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, editAlarm.mode === 'lastTrain' && styles.tabActive]}
              onPress={() => setEditAlarm((prev) => ({ ...prev, mode: 'lastTrain' }))}
            >
              <Text style={[styles.tabText, editAlarm.mode === 'lastTrain' && styles.tabTextActive]}>막차</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, editAlarm.mode === 'deadline' && styles.tabActive]}
              onPress={() => setEditAlarm((prev) => ({ ...prev, mode: 'deadline' }))}
            >
              <Text style={[styles.tabText, editAlarm.mode === 'deadline' && styles.tabTextActive]}>데드라인</Text>
            </TouchableOpacity>
          </View>

          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* 막차 모드 */}
            {editAlarm.mode === 'lastTrain' ? (
              <View style={styles.lastTrainInfo}>
                <Text style={styles.lastTrainBig}>막차</Text>
                <Text style={styles.lastTrainDesc}>설정한 귀가지까지의 막차를 기준으로 알람을 드립니다.</Text>
              </View>
            ) : (
              /* 데드라인 모드 - 시간 피커 */
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
            )}

            <View style={styles.divider} />

{/* 귀가지 + 반복 */}
            <View style={styles.section}>
              <View style={styles.optionBox}>
                <TouchableOpacity style={styles.optionRow} onPress={openHomePlace}>
                  <Text style={styles.optionLabel}>귀가지</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue}>{editAlarm.place}</Text>
                    <Feather name="chevron-right" size={16} color="#AAAAAA" />
                  </View>
                </TouchableOpacity>
                <View style={styles.separator} />
                <TouchableOpacity style={styles.optionRow} onPress={() => setView('repeat')}>
                  <Text style={styles.optionLabel}>반복</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue}>{getRepeatLabel(editAlarm.repeat)}</Text>
                    <Feather name="chevron-right" size={16} color="#AAAAAA" />
                  </View>
                </TouchableOpacity>
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

      {/* ── 귀가지 선택 화면 ── */}
      {view === 'homePlace' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>귀가지</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleHomePlaceConfirm}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <AddressSearchView
            initialResults={HOME_PLACES}
            selectedId={tempPlace?.id}
            onSelect={(item) => setTempPlace(item)}
            selectedIsHome
          />
        </>
      )}

      {/* ── 반복 선택 화면 ── */}
      {view === 'repeat' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>반복</Text>
            <View style={{ width: 36 }} />
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.optionBox}>
              {DAYS.map((day, index) => {
                const selected = editAlarm.repeat.includes(day);
                return (
                  <View key={day}>
                    <TouchableOpacity style={styles.optionRow} onPress={() => toggleRepeat(day)}>
                      <Text style={styles.optionLabel}>{day}</Text>
                      {selected && <Feather name="check" size={18} color="#F5A623" />}
                    </TouchableOpacity>
                    {index < DAYS.length - 1 && <View style={styles.separator} />}
                  </View>
                );
              })}
            </View>
          </BottomSheetScrollView>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  indicator: { backgroundColor: '#DDDDDD', width: 40 },
  background: { backgroundColor: '#FFFFFF', borderRadius: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E0E0E0',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E0E0E0',
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F5A623',
    alignItems: 'center', justifyContent: 'center',
  },
  datePillContainer: { alignItems: 'center', marginBottom: 16 },
  datePill: {
    backgroundColor: '#E8E8E8', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  datePillText: { fontSize: 13, fontWeight: '500', color: '#FF3B30' },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: '#FFFFFF' },
  tabText: { fontSize: 14, fontWeight: '500', color: '#AAAAAA' },
  tabTextActive: { color: '#1A1A1A', fontWeight: '600' },
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
  lastTrainText: { fontSize: 36, fontWeight: '600', color: '#1A1A1A', lineHeight: 44 },
  alarmPlace: { fontSize: 12, color: '#888888', marginTop: 2 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDDDDD' },
  lastTrainInfo: { alignItems: 'center', paddingVertical: 32 },
  lastTrainBig: { fontSize: 40, fontWeight: '700', color: '#1A1A1A', marginBottom: 12 },
  lastTrainDesc: { fontSize: 13, color: '#888888', textAlign: 'center', lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E0E0E0', marginVertical: 16 },
  pickerContainer: {
    flexDirection: 'row',
    marginBottom: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    overflow: 'hidden',
    height: 200,
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
  rowValue: { fontSize: 14, color: '#AAAAAA' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deleteContainer: { alignItems: 'center', marginTop: 8 },
  deleteButton: {
    backgroundColor: '#FF3B30', borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 48,
  },
  deleteButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});