import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import { SegmentedToggle } from '@/src/components/common/SegmentedToggle';
import { createJourneysApi, ensureFutureDateTime, HomeJourneyPayload, JourneyDetail, maskToRepeatDays, repeatDaysToMask, targetTimeToAmpmHourMinute, toTargetTime } from '@/src/api/journeys';
import { alarmService } from '@/src/services/alarmService';
import { extractApiErrorMessage } from '@/src/utils/notifications';
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
  View
} from 'react-native';

const journeysApi = createJourneysApi();

function fromJourneyDetail(d: JourneyDetail): HomeAlarm {
  const { ampm, hour, minute } = targetTimeToAmpmHourMinute(d.target_time);
  return {
    id: String(d.journey_id),
    journeyId: d.journey_id,
    mode: d.is_last_mode ? 'lastTrain' : 'deadline',
    ampm, hour, minute,
    home_name: d.dest_name,
    home_address: d.dest_address,
    home_lat: d.dest_lat,
    home_lng: d.dest_lng,
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

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type AlarmMode = 'lastTrain' | 'deadline';
type Transport = 'public' | 'car';
type ViewType = 'edit' | 'homePlace';

interface HomeAlarm {
  id: string;
  journeyId?: number;
  mode: AlarmMode;
  ampm: string;
  hour: string;
  minute: string;
  home_name: string;
  home_address: string;
  home_lat?: number;
  home_lng?: number;
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

const DEFAULT_ALARM: HomeAlarm = {
  id: '', mode: 'lastTrain', ampm: '오후', hour: '11', minute: '00',
  home_name: '', home_address: '', home_lat: undefined, home_lng: undefined,
  repeat: ['안함'], enabled: true, transport: 'public',
};

export default function HomeAlarmSheet({ onClose, initialMode, editJourneyId, initialAlarm }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['88%'], []);
  const { selectedDate, bumpAlarmVersion, setSelectedDate } = useCalendarStore();

  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('HOME');

  const [view, setView] = useState<ViewType>('edit');
  const [editAlarm, setEditAlarm] = useState<HomeAlarm>(() => {
    if (initialMode === 'edit' && editJourneyId && initialAlarm) {
      return { ...DEFAULT_ALARM, id: String(editJourneyId), journeyId: editJourneyId, mode: initialAlarm.isLastMode ? 'lastTrain' : 'deadline', home_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '11', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport };
    }
    return { ...DEFAULT_ALARM, ...targetTimeToAmpmHourMinute(new Date().toISOString()), minute: '00' };
  });
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
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
        ? { ...DEFAULT_ALARM, id: String(editJourneyId), journeyId: editJourneyId, mode: initialAlarm.isLastMode ? 'lastTrain' : 'deadline' as AlarmMode, home_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '11', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport }
        : { ...DEFAULT_ALARM, id: String(editJourneyId), journeyId: editJourneyId };
      openEdit(base);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openHomePlace = () => {
    setTempPlace(editAlarm.home_name ? {
      id: 'current_home',
      name: editAlarm.home_name,
      address: editAlarm.home_address,
      lat: editAlarm.home_lat,
      lng: editAlarm.home_lng,
      isHome: true,
      isCurrent: true,
    } : null);
    setView('homePlace');
  };
  const handleHomePlaceConfirm = () => {
    if (tempPlace?.lat && tempPlace?.lng) {
      setEditAlarm((prev) => ({
        ...prev,
        home_name: tempPlace.name,
        home_address: tempPlace.address,
        home_lat: tempPlace.lat,
        home_lng: tempPlace.lng,
      }));
      savePlace(tempPlace).catch(() => {});
    }
    setView('edit');
  };
  const openEdit = async (alarm: HomeAlarm) => {
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

  // 실제 저장 API 호출 — baseDate가 이 저장의 plan_date 기준이 된다(평소엔 selectedDate,
  // "내일 막차로 생성" 확인 후엔 그 다음 날짜). lastTrainAlreadyMissed는 baseDate 기준으로
  // 다시 판정되므로, baseDate가 이미 내일이면 자연히 통과한다(서버 검증도 plan_date==오늘일
  // 때만 막으므로 동일하게 통과).
  const saveWithBaseDate = async (baseDate: string) => {
    setSaving(true);
    try {
      const rawTime = editAlarm.mode === 'lastTrain'
        ? `${baseDate}T00:00:00`
        : toTargetTime(baseDate, editAlarm.ampm, editAlarm.hour, editAlarm.minute);
      const hasRepeat = !editAlarm.repeat.includes('안함') && editAlarm.repeat.length > 0;
      const repeatMask = repeatDaysToMask(editAlarm.repeat);
      const commonFields = {
        dest_name: editAlarm.home_name,
        dest_address: editAlarm.home_address,
        dest_lat: editAlarm.home_lat!,
        dest_lng: editAlarm.home_lng!,
        repeat_days: repeatMask,
      };

      let payload: HomeJourneyPayload;
      if (editAlarm.mode === 'lastTrain') {
        // 막차 모드는 "자정이 지났는지"가 아니라 서버(validateLastTrainNotAlreadyMissed)와
        // 동일한 기준으로 판단한다 — 과거 날짜이거나, 오늘인데 막차 탐색 시간대(23시~다음날 01시)를
        // 넘긴 새벽(01시~day-boundary-hour) 구간이면 오늘 밤 막차는 확정적으로 이미 지난 것이다.
        // (그 외 시간대의 "오늘"은 자정이 지났어도 여전히 유효한 앵커 — 데드라인 모드의
        // isPast 판정과 달리 하루 종일 지난 것으로 취급하면 안 된다.)
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const lastTrainAlreadyMissed = baseDate < todayStr
          || (baseDate === todayStr && now.getHours() >= 1 && now.getHours() < 4);
        if (lastTrainAlreadyMissed && !hasRepeat) {
          // handleSave가 이 경우엔 이미 "내일로 생성" 확인 절차를 거쳐서 호출하므로 여기까지
          // 오면 안 되지만, 방어적으로 동일한 에러를 유지한다.
          Alert.alert('시간 오류', '오늘 밤 막차는 이미 지났습니다. 날짜를 다시 설정해주세요.');
          setSaving(false);
          return;
        }
        const plan_date = lastTrainAlreadyMissed && hasRepeat
          ? ensureFutureDateTime(baseDate, rawTime, repeatMask).plan_date
          : baseDate;
        payload = { is_last_mode: true, plan_date, ...commonFields };
      } else {
        const isPast = new Date(rawTime) <= new Date();
        if (isPast && !hasRepeat) {
          Alert.alert('시간 오류', '이미 지난 시간입니다. 시간을 다시 설정해주세요.');
          setSaving(false);
          return;
        }
        const { plan_date, target_time } = isPast && hasRepeat
          ? ensureFutureDateTime(baseDate, rawTime, repeatMask)
          : { plan_date: baseDate, target_time: rawTime };
        payload = {
          is_last_mode: false,
          plan_date,
          target_time,
          transport_type: editAlarm.transport === 'public' ? 'TRANSIT' : 'DRIVING',
          ...commonFields,
        };
      }

      if (isEditMode && editAlarm.journeyId) {
        const res = await journeysApi.updateHome(editAlarm.journeyId, payload);
        if (res.data.journey_status === 'READY') {
          alarmService.start({ alarmType: 'home', destination: editAlarm.home_name, journeyId: editAlarm.journeyId, destLat: editAlarm.home_lat, destLng: editAlarm.home_lng, transportMode: toTransportMode(editAlarm.transport === 'car'), isLastMode: editAlarm.mode === 'lastTrain', repeatDays: payload.repeat_days });
        } else if (res.data.journey_status === 'SCHEDULED') {
          alarmService.stop(editAlarm.journeyId);
        }
      } else {
        const res = await journeysApi.createHome(payload);
        if (res.data.journey_status === 'READY') {
          alarmService.start({ alarmType: 'home', destination: editAlarm.home_name, journeyId: res.data.journey_id, destLat: editAlarm.home_lat, destLng: editAlarm.home_lng, transportMode: toTransportMode(editAlarm.transport === 'car'), isLastMode: editAlarm.mode === 'lastTrain', repeatDays: payload.repeat_days });
        }
      }
      bumpAlarmVersion();
      // 과거 날짜에 반복 알람을 만들면 서버는 그대로 저장하지 않고 앵커를 가장 가까운 미래
      // 발생일로 전진시킨다(ensureFutureDateTime) — 화면(selectedDate)은 그대로 과거 날짜에
      // 머물러 있어서, 저장했는데 리스트에 아무것도 안 뜨는 것처럼 보이는 문제가 있었다.
      // 실제로 날짜가 바뀐 경우 화면도 그 날짜로 따라가서 방금 만든 알람을 바로 보여준다.
      if (payload.plan_date !== selectedDate) setSelectedDate(payload.plan_date);
      onClose();
    } catch (e: any) {
      console.error('귀가 알람 저장 실패:', e);
      Alert.alert('저장 실패', extractApiErrorMessage(e?.message ?? '', '다시 시도해주세요.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editAlarm.home_name || !editAlarm.home_lat || !editAlarm.home_lng) {
      Alert.alert('귀가지를 선택해주세요.');
      return;
    }
    if (!(await checkCoreAlarmPermissions())) return;

    const hasRepeat = !editAlarm.repeat.includes('안함') && editAlarm.repeat.length > 0;
    if (editAlarm.mode === 'lastTrain' && !hasRepeat) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const lastTrainAlreadyMissed = selectedDate < todayStr
        || (selectedDate === todayStr && now.getHours() >= 1 && now.getHours() < 4);
      if (lastTrainAlreadyMissed) {
        // 버그47 UX 개선 — 무조건 에러로 막고 날짜를 직접 다시 고르게 하는 대신, 바로 다음
        // 날짜(내일)로 생성할지 물어본다. 반복 알람은 이미 ensureFutureDateTime이 자동으로
        // 다음 발생일을 찾아주므로 이 확인 절차가 필요 없다(!hasRepeat인 경우만 해당).
        Alert.alert(
          '시간 오류',
          '오늘 밤 막차는 이미 지났습니다. 내일 막차로 생성하시겠습니까?',
          [
            { text: '취소', style: 'cancel' },
            { text: '내일로 생성', onPress: () => { void saveWithBaseDate(addDaysStr(selectedDate, 1)); } },
          ],
        );
        return;
      }
    }
    await saveWithBaseDate(selectedDate);
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
            <Text style={styles.title}>{isEditMode ? '귀가 알람 수정' : '귀가 알람 추가'}</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Feather name="check" size={20} color="#FFFFFF" />
              }
            </TouchableOpacity>
          </View>

          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldGroupLabel}>기준</Text>
              <SegmentedToggle
                value={editAlarm.mode}
                onChange={(v) => setEditAlarm((prev) => ({ ...prev, mode: v }))}
                options={[
                  { value: 'lastTrain', label: '막차' },
                  { value: 'deadline', label: '데드라인' },
                ]}
              />
            </View>

            {/* 막차 모드 */}
            {editAlarm.mode === 'lastTrain' ? (
              <View style={styles.lastTrainInfo}>
                <Text style={styles.lastTrainBig}>막차</Text>
                <Text style={styles.lastTrainDesc}>설정한 귀가지까지의 막차를 기준으로 알람을 드립니다.</Text>
              </View>
            ) : (
              /* 데드라인 모드 - 시간 피커 */
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
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldGroupLabel}>귀가지</Text>
              <TouchableOpacity style={styles.fieldRow} onPress={openHomePlace} activeOpacity={0.7}>
                <Feather name="map-pin" size={17} color="#30D158" />
                <Text style={styles.fieldValue}>{editAlarm.home_name || '귀가지 선택'}</Text>
                <Feather name="chevron-right" size={16} color="#B0B0B4" />
              </TouchableOpacity>
            </View>

            {editAlarm.mode === 'deadline' && (
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
            )}

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
            key={searchKey}
            initialResults={tempPlace?.id === 'current_home' ? [tempPlace!, ...places] : places}
            selectedId={tempPlace?.id}
            onSelect={(item) => setTempPlace(item)}
            onDeleteServerPlace={deletePlace}
            selectedIsHome
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
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#30D158',
    alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  lastTrainInfo: { alignItems: 'center', paddingVertical: 24, backgroundColor: '#F7F7F8', borderRadius: 16, marginBottom: 16 },
  lastTrainBig: { fontSize: 36, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 },
  lastTrainDesc: { fontSize: 13, color: '#888888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
  pickerContainer: {
    flexDirection: 'row',
    backgroundColor: '#F7F7F8',
    borderRadius: 14,
    overflow: 'hidden',
    height: Platform.OS === 'ios' ? 200 : 56,
    marginTop: 8,
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
  deleteButton: {
    backgroundColor: '#FF453A', borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 48,
  },
  deleteButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
