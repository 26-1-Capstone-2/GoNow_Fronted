import { Feather } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Platform,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const DAYS = ['일요일마다', '월요일마다', '화요일마다', '수요일마다', '목요일마다', '금요일마다', '토요일마다', '안함'];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

interface Alarm {
  id: string;
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

const SAMPLE_PLACES = [
  { id: '1', name: '홍대역 2번 출구', address: '서울 저쩌고 어쩌고', isCurrent: true },
  { id: '2', name: '중앙대학교 후문 입구', address: '서울 어쩌고 저쩌고', isCurrent: false },
];

const SAMPLE_ALARMS: Alarm[] = [
  { id: '1', ampm: '오후', hour: '3', minute: '00', place: '중앙대학교 후문 입구', repeat: ['안함'], enabled: true },
  { id: '2', ampm: '오전', hour: '9', minute: '00', place: '중앙대학교 후문 입구', repeat: ['금요일마다'], enabled: true },
];

const DEFAULT_ALARM: Alarm = {
  id: '', ampm: '오전', hour: '7', minute: '00',
  place: '', repeat: ['안함'], enabled: true,
};

type ViewType = 'list' | 'edit' | 'repeat' | 'place';

export default function PersonalAllAlarmSheet({ onClose }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  const [view, setView] = useState<ViewType>('list');
  const [alarms, setAlarms] = useState<Alarm[]>(SAMPLE_ALARMS);
  const [editAlarm, setEditAlarm] = useState<Alarm>(DEFAULT_ALARM);
  const [tempPlace, setTempPlace] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const isEditMode = !!editAlarm.id;

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const openAdd = () => { setEditAlarm(DEFAULT_ALARM); setView('edit'); };
  const openEdit = (alarm: Alarm) => { setEditAlarm(alarm); setView('edit'); };
  const openPlace = () => { setTempPlace(editAlarm.place); setView('place'); };

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
            <Text style={styles.title}>개인</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Feather name="plus" size={22} color="#1A1A1A" />
            </TouchableOpacity>
          </View>

          {/* 전체 pill */}
          <View style={styles.datePillContainer}>
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>전체</Text>
            </View>
          </View>

          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {alarms.map((alarm) => (
              <TouchableOpacity
                key={alarm.id}
                style={styles.alarmCard}
                onPress={() => openEdit(alarm)}
                activeOpacity={0.7}
              >
                <View style={styles.alarmInfo}>
                  <View style={styles.timeRow}>
                    <Text style={styles.ampmSmall}>{alarm.ampm}</Text>
                    <Text style={styles.alarmTime}>{alarm.hour}:{alarm.minute}</Text>
                  </View>
                  <Text style={styles.alarmPlace}>
                    {alarm.place}{alarm.repeat[0] !== '안함' ? `, ${getRepeatLabel(alarm.repeat)}` : ''}
                  </Text>
                </View>
                <Switch
                  value={alarm.enabled}
                  onValueChange={() => toggleAlarm(alarm.id)}
                  trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                  thumbColor="#FFFFFF"
                />
              </TouchableOpacity>
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
            <Text style={styles.title}>{isEditMode ? '알람 수정' : '알람 추가'}</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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

      {/* ── 목적지 선택 화면 ── */}
      {view === 'place' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>목적지</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => { setEditAlarm((prev) => ({ ...prev, place: tempPlace })); setView('edit'); }}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.searchContainer}>
            <Feather name="search" size={15} color="#AAAAAA" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="지번, 도로명, 건물명으로 검색"
              placeholderTextColor="#BBBBBB"
              value={placeQuery}
              onChangeText={setPlaceQuery}
            />
            {placeQuery.length > 0 && (
              <TouchableOpacity onPress={() => setPlaceQuery('')}>
                <Feather name="x-circle" size={15} color="#AAAAAA" />
              </TouchableOpacity>
            )}
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.optionBox}>
              {SAMPLE_PLACES.map((place, index) => {
                const isSelected = tempPlace === place.name;
                return (
                  <View key={place.id}>
                    <TouchableOpacity style={styles.placeRow} onPress={() => setTempPlace(place.name)}>
                      <View style={[styles.placeIconWrap, isSelected && { backgroundColor: '#1A1A1A' }]}>
                        <Feather name="map-pin" size={18} color={isSelected ? '#FFFFFF' : '#AAAAAA'} />
                      </View>
                      <View style={styles.placeInfo}>
                        <View style={styles.placeNameRow}>
                          <Text style={styles.placeName}>{place.name}</Text>
                          {place.isCurrent && (
                            <View style={styles.currentBadge}>
                              <Text style={styles.currentBadgeText}>현재 설정된 주소</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.placeAddress}>{place.address}</Text>
                      </View>
                      {isSelected && <Feather name="check" size={18} color="#1A1A1A" />}
                    </TouchableOpacity>
                    {index < SAMPLE_PLACES.length - 1 && <View style={styles.separator} />}
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
  pickerContainer: {
    flexDirection: 'row', marginBottom: 24,
    backgroundColor: '#F5F5F5', borderRadius: 14,
    overflow: 'hidden', height: 200,
  },
  picker: { flex: 1 },
  pickerItem: { fontSize: 20, color: '#1A1A1A', height: 200 },
  section: { marginBottom: 20 },
  optionBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', height: 50,
  },
  optionLabel: { fontSize: 15, color: '#1A1A1A' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowValue: { fontSize: 14, color: '#AAAAAA' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDDDDD' },
  deleteContainer: { alignItems: 'center', marginTop: 8 },
  deleteButton: {
    backgroundColor: '#FF3B30', borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 48,
  },
  deleteButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1A1A' },
  placeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  placeIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#EEEEEE',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  placeInfo: { flex: 1 },
  placeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  placeName: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  currentBadge: { backgroundColor: '#E8F5E9', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  currentBadgeText: { fontSize: 10, color: '#4CAF50', fontWeight: '500' },
  placeAddress: { fontSize: 12, color: '#888888' },
});