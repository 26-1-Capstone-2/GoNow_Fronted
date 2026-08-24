import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import { SegmentedToggle } from '@/src/components/common/SegmentedToggle';
import { createJourneysApi, ensureFutureDateTime, JourneyDetail, maskToRepeatDays, PersonalJourneyPayload, repeatDaysToMask, targetTimeToAmpmHourMinute, toTargetTime } from '@/src/api/journeys';
import { alarmService } from '@/src/services/alarmService';
import { checkCoreAlarmPermissions } from '@/src/utils/permissions';
import { toTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { usePlaces } from '@/src/hooks/usePlaces';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const journeysApi = createJourneysApi();

function fromJourneyDetail(d: JourneyDetail): Alarm {
  const { ampm, hour, minute } = targetTimeToAmpmHourMinute(d.target_time);
  return {
    id: String(d.journey_id),
    journeyId: d.journey_id,
    ampm, hour, minute,
    dest_name: d.dest_name,
    dest_address: d.dest_address,
    dest_lat: d.dest_lat,
    dest_lng: d.dest_lng,
    repeat: maskToRepeatDays(d.repeat_days),
    enabled: d.is_active,
    transport: d.transport_type === 'TRANSIT' ? 'public' : 'car',
  };
}

const REPEAT_DAYS = [
  { short: '월', full: '월요일마다' },
  { short: '화', full: '화요일마다' },
  { short: '수', full: '수요일마다' },
  { short: '목', full: '목요일마다' },
  { short: '금', full: '금요일마다' },
  { short: '토', full: '토요일마다' },
  { short: '일', full: '일요일마다' },
];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type Transport = 'public' | 'car';

interface Alarm {
  id: string;
  journeyId?: number;
  ampm: string;
  hour: string;
  minute: string;
  dest_name: string;
  dest_address: string;
  dest_lat?: number;
  dest_lng?: number;
  repeat: string[];
  enabled: boolean;
  transport: Transport;
}

interface Props {
  onClose: () => void;
  initialMode: 'add' | 'edit';
  editJourneyId?: number;
  initialAlarm?: any;
}

const DEFAULT_ALARM: Alarm = {
  id: '', ampm: '오전', hour: '7', minute: '00',
  dest_name: '', dest_address: '', dest_lat: undefined, dest_lng: undefined,
  repeat: ['안함'], enabled: true, transport: 'public',
};

type ViewType = 'edit' | 'place';

export default function PersonalAlarmSheet({ onClose, initialMode, editJourneyId, initialAlarm }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['88%'], []);
  const { selectedDate, bumpAlarmVersion, setSelectedDate } = useCalendarStore();

  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('DEST');

  const [view, setView] = useState<ViewType>('edit');
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [editAlarm, setEditAlarm] = useState<Alarm>(() => {
    if (initialMode === 'edit' && editJourneyId && initialAlarm) {
      return { ...DEFAULT_ALARM, id: String(editJourneyId), journeyId: editJourneyId, dest_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '7', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport };
    }
    return { ...DEFAULT_ALARM, ...targetTimeToAmpmHourMinute(new Date().toISOString()), minute: '00' };
  });
  const [saving, setSaving] = useState(false);
  const isEditMode = !!editAlarm.id;

  useEffect(() => {
    loadPlaces().catch(() => {});
  }, [loadPlaces]);

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  useEffect(() => {
    if (initialMode === 'edit' && editJourneyId) {
      const base = initialAlarm
        ? { ...DEFAULT_ALARM, id: String(editJourneyId), journeyId: editJourneyId, dest_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '7', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport }
        : { ...DEFAULT_ALARM, id: String(editJourneyId), journeyId: editJourneyId };
      openEdit(base);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = async (alarm: Alarm) => {
    if (alarm.journeyId) {
      try {
        const res = await journeysApi.getJourney(alarm.journeyId);
        setEditAlarm(fromJourneyDetail(res.data));
      } catch {
        setEditAlarm(alarm);
      }
    } else {
      setEditAlarm(alarm);
    }
    setView('edit');
  };
  const openPlace = () => {
    setTempPlace(editAlarm.dest_name ? {
      id: 'current_dest',
      name: editAlarm.dest_name,
      address: editAlarm.dest_address,
      lat: editAlarm.dest_lat,
      lng: editAlarm.dest_lng,
      isCurrent: true,
    } : null);
    setView('place');
  };

  const handleSave = async () => {
    if (!editAlarm.dest_name) {
      Alert.alert('목적지를 선택해주세요.');
      return;
    }
    if (!editAlarm.dest_lat || !editAlarm.dest_lng) {
      Alert.alert('목적지를 선택해주세요.');
      return;
    }
    if (!(await checkCoreAlarmPermissions())) return;
    setSaving(true);
    try {
      const rawTime = toTargetTime(selectedDate, editAlarm.ampm, editAlarm.hour, editAlarm.minute);
      const isPast = new Date(rawTime) <= new Date();
      const hasRepeat = !editAlarm.repeat.includes('안함') && editAlarm.repeat.length > 0;
      const repeatMask = repeatDaysToMask(editAlarm.repeat);
      if (isPast && !hasRepeat) {
        Alert.alert('시간 오류', '이미 지난 시간입니다. 시간을 다시 설정해주세요.');
        setSaving(false);
        return;
      }
      const { plan_date, target_time } = hasRepeat
        ? ensureFutureDateTime(selectedDate, rawTime, repeatMask)
        : { plan_date: selectedDate, target_time: rawTime };

      const payload: PersonalJourneyPayload = {
        plan_date,
        target_time,
        dest_name: editAlarm.dest_name,
        dest_address: editAlarm.dest_address,
        dest_lat: editAlarm.dest_lat,
        dest_lng: editAlarm.dest_lng,
        transport_type: editAlarm.transport === 'public' ? 'TRANSIT' : 'DRIVING',
        repeat_days: repeatMask,
      };

      if (isEditMode && editAlarm.journeyId) {
        const res = await journeysApi.updatePersonal(editAlarm.journeyId, payload);
        if (res.data.journey_status === 'READY') {
          alarmService.start({ alarmType: 'personal', destination: payload.dest_name, journeyId: editAlarm.journeyId, destLat: editAlarm.dest_lat, destLng: editAlarm.dest_lng, transportMode: toTransportMode(editAlarm.transport === 'car'), repeatDays: payload.repeat_days });
        } else if (res.data.journey_status === 'SCHEDULED') {
          alarmService.stop(editAlarm.journeyId);
        }
      } else {
        const res = await journeysApi.createPersonal(payload);
        if (res.data.journey_status === 'READY') {
          alarmService.start({ alarmType: 'personal', destination: payload.dest_name, journeyId: res.data.journey_id, destLat: editAlarm.dest_lat, destLng: editAlarm.dest_lng, transportMode: toTransportMode(editAlarm.transport === 'car'), repeatDays: payload.repeat_days });
        }
      }
      bumpAlarmVersion();
      // 과거 날짜에 반복 알람을 만들면 서버는 그대로 저장하지 않고 앵커를 가장 가까운 미래
      // 발생일로 전진시킨다(ensureFutureDateTime) — 화면(selectedDate)은 그대로 과거 날짜에
      // 머물러 있어서, 저장했는데 리스트에 아무것도 안 뜨는 것처럼 보이는 문제가 있었다.
      // 실제로 날짜가 바뀐 경우 화면도 그 날짜로 따라가서 방금 만든 알람을 바로 보여준다.
      if (plan_date !== selectedDate) setSelectedDate(plan_date);
      onClose();
    } catch {
      Alert.alert('저장 실패', '다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (editAlarm.journeyId) {
      try {
        await journeysApi.deleteJourney(editAlarm.journeyId);
        // alarmService.stop()이 내부적으로 ACTIVE_JOURNEYS_KEY 제거까지 안전하게(잠금 걸린 채) 처리함
        alarmService.stop(editAlarm.journeyId);
      } catch {
        Alert.alert('삭제 실패', '다시 시도해주세요.');
        return;
      }
    }
    bumpAlarmVersion();
    onClose();
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
      animateOnMount={false}
      handleIndicatorStyle={styles.indicator}
      backgroundStyle={styles.background}
    >
      {/* ── 수정/추가 화면 ── */}
      {view === 'edit' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
              <Feather name="x" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>{isEditMode ? '개인 알람 수정' : '개인 알람 추가'}</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Feather name="check" size={20} color="#FFFFFF" />
              }
            </TouchableOpacity>
          </View>

          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldGroupLabel}>어디로 가시나요?</Text>
              <TouchableOpacity style={styles.fieldRow} onPress={openPlace} activeOpacity={0.7}>
                <Feather name="map-pin" size={17} color="#0A84FF" />
                <Text style={styles.fieldValue} numberOfLines={1}>{editAlarm.dest_name || '목적지 선택'}</Text>
                <Feather name="chevron-right" size={16} color="#B0B0B4" />
              </TouchableOpacity>
            </View>

            <View style={styles.timeCard}>
              <Text style={styles.timeCardLabel}>목표 시각</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={editAlarm.ampm}
                  onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, ampm: v }))}
                  style={styles.picker}
                  itemStyle={styles.pickerItem}
                >
                  <Picker.Item label="오전" value="오전" color="#1A1A1A" />
                  <Picker.Item label="오후" value="오후" color="#1A1A1A" />
                </Picker>
                <Picker
                  selectedValue={editAlarm.hour}
                  onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, hour: v }))}
                  style={styles.picker}
                  itemStyle={styles.pickerItem}
                >
                  {HOURS.map((h) => <Picker.Item key={h} label={h} value={h} color="#1A1A1A" />)}
                </Picker>
                <Picker
                  selectedValue={editAlarm.minute}
                  onValueChange={(v) => setEditAlarm((prev) => ({ ...prev, minute: v }))}
                  style={styles.picker}
                  itemStyle={styles.pickerItem}
                >
                  {MINUTES.map((m) => <Picker.Item key={m} label={m} value={m} color="#1A1A1A" />)}
                </Picker>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldGroupLabel}>반복</Text>
              <View style={styles.dayPillRow}>
                {REPEAT_DAYS.map(({ short, full }) => {
                  const selected = editAlarm.repeat.includes(full);
                  return (
                    <TouchableOpacity
                      key={full}
                      style={[styles.dayPill, selected && styles.dayPillSelected]}
                      onPress={() => toggleRepeat(full)}
                    >
                      <Text style={[styles.dayPillText, selected && styles.dayPillTextSelected]}>{short}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
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
              <View style={styles.deleteContainer}>
                <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
                  <Text style={styles.deleteButtonText}>알람삭제</Text>
                </TouchableOpacity>
              </View>
            )}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#0A84FF', alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  pickerContainer: {
    flexDirection: 'row', backgroundColor: '#F7F7F8', borderRadius: 14,
    overflow: 'hidden', height: Platform.OS === 'ios' ? 200 : 56, marginTop: 8,
  },
  picker: { flex: 1 },
  pickerItem: { fontSize: 20, color: '#1A1A1A', height: 200 },
  fieldGroup: { marginBottom: 16 },
  fieldGroupLabel: { fontSize: 12, fontWeight: '600', color: '#8A8A8E', marginBottom: 8 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F7F7F8', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14,
  },
  fieldValue: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  timeCard: { backgroundColor: '#F7F7F8', borderRadius: 18, padding: 12, marginBottom: 16 },
  timeCardLabel: { fontSize: 12, fontWeight: '600', color: '#8A8A8E', textAlign: 'center' },
  dayPillRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayPill: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0F0F1', alignItems: 'center', justifyContent: 'center' },
  dayPillSelected: { backgroundColor: '#FFCE0C' },
  dayPillText: { fontSize: 13, fontWeight: '700', color: '#8A8A8E' },
  dayPillTextSelected: { color: '#1A1A1A' },
  deleteContainer: { alignItems: 'center', marginTop: 8 },
  deleteButton: { backgroundColor: '#FF453A', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 48 },
  deleteButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
