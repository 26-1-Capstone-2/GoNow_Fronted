import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
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
  Switch,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View
} from 'react-native';

const journeysApi = createJourneysApi();
const alarmsApi = createAlarmsApi();

function fromAlarmItem(item: AlarmItem): HomeAlarm {
  const { ampm, hour, minute } = targetTimeToAmpmHourMinute(item.target_time);
  return {
    id: String(item.journey_id),
    journeyId: item.journey_id ?? undefined,
    mode: item.is_last_mode ? 'lastTrain' : 'deadline',
    ampm, hour, minute,
    home_name: item.dest_name,
    home_address: '',
    home_lat: item.dest_lat,
    home_lng: item.dest_lng,
    repeat: maskToRepeatDays(item.repeat_days ?? 0),
    enabled: item.is_active,
    transport: item.transport_type === 'TRANSIT' ? 'public' : 'car',
    isActive: ['MOVING'].includes(item.my_status),
    myStatus: item.my_status,
  };
}

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

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const DAYS = ['일요일마다', '월요일마다', '화요일마다', '수요일마다', '목요일마다', '금요일마다', '토요일마다', '안함'];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

type AlarmMode = 'lastTrain' | 'deadline';
type Transport = 'public' | 'car';
type ViewType = 'list' | 'edit' | 'repeat' | 'homePlace' | 'transport';

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
  isActive?: boolean;
  myStatus?: string;
}

interface Props {
  onClose: () => void;
  initialMode?: 'add' | 'edit';
  editJourneyId?: number;
  initialAlarm?: any;
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

const DEFAULT_ALARM: HomeAlarm = {
  id: '', mode: 'lastTrain', ampm: '오후', hour: '11', minute: '00',
  home_name: '', home_address: '', home_lat: undefined, home_lng: undefined,
  repeat: ['안함'], enabled: true, transport: 'public',
};

export default function HomeAlarmSheet({ onClose, initialMode, editJourneyId, initialAlarm }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const { selectedDate, bumpAlarmVersion } = useCalendarStore();

  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('HOME');

  const [view, setView] = useState<ViewType>(initialMode ? 'edit' : 'list');
  const [alarms, setAlarms] = useState<HomeAlarm[]>([]);
  const [editAlarm, setEditAlarm] = useState<HomeAlarm>(() => {
    if (initialMode === 'edit' && editJourneyId && initialAlarm) {
      return { ...DEFAULT_ALARM, id: String(editJourneyId), journeyId: editJourneyId, mode: initialAlarm.isLastMode ? 'lastTrain' : 'deadline', home_name: initialAlarm.place, ampm: initialAlarm.ampm, hour: initialAlarm.time?.split(':')[0] ?? '11', minute: initialAlarm.time?.split(':')[1] ?? '00', transport: initialAlarm.transport };
    }
    return DEFAULT_ALARM;
  });
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const isEditMode = !!editAlarm.id;

  useEffect(() => {
    loadPlaces().catch(() => {});
  }, [loadPlaces]);

  const loadAlarms = useCallback(async () => {
    try {
      const res = await alarmsApi.getAlarms(selectedDate);
      setAlarms((res.data ?? []).filter((a) => a.alarm_type === 'HOME').map(fromAlarmItem));
    } catch {}
  }, [selectedDate]);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  const dateObj = new Date(selectedDate);
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayName = DAY_NAMES[dateObj.getDay()];

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

  const openAdd = () => { setEditAlarm(DEFAULT_ALARM); setView('edit'); };
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
    if (alarm.isActive) return;
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

  const handleSave = async () => {
    if (!editAlarm.home_name || !editAlarm.home_lat || !editAlarm.home_lng) {
      Alert.alert('귀가지를 선택해주세요.');
      return;
    }
    if (!(await checkCoreAlarmPermissions())) return;
    setSaving(true);
    try {
      const rawTime = editAlarm.mode === 'lastTrain'
        ? `${selectedDate}T00:00:00`
        : toTargetTime(selectedDate, editAlarm.ampm, editAlarm.hour, editAlarm.minute);
      const isPast = new Date(rawTime) <= new Date();
      const hasRepeat = !editAlarm.repeat.includes('안함') && editAlarm.repeat.length > 0;
      if (isPast && !hasRepeat && editAlarm.mode === 'deadline') {
        Alert.alert('시간 오류', '이미 지난 시간입니다. 시간을 다시 설정해주세요.');
        setSaving(false);
        return;
      }
      const commonFields = {
        dest_name: editAlarm.home_name,
        dest_address: editAlarm.home_address,
        dest_lat: editAlarm.home_lat,
        dest_lng: editAlarm.home_lng,
        repeat_days: repeatDaysToMask(editAlarm.repeat),
      };

      let payload: HomeJourneyPayload;
      if (editAlarm.mode === 'lastTrain') {
        payload = { is_last_mode: true, plan_date: selectedDate, ...commonFields };
      } else {
        const { plan_date, target_time } = isPast && hasRepeat
          ? ensureFutureDateTime(selectedDate, rawTime)
          : { plan_date: selectedDate, target_time: rawTime };
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
          alarmService.start({ alarmType: 'home', destination: editAlarm.home_name, journeyId: editAlarm.journeyId, destLat: editAlarm.home_lat, destLng: editAlarm.home_lng, transportMode: toTransportMode(editAlarm.transport === 'car'), isLastMode: editAlarm.mode === 'lastTrain' });
        } else if (res.data.journey_status === 'SCHEDULED') {
          alarmService.stop(editAlarm.journeyId);
        }
      } else {
        const res = await journeysApi.createHome(payload);
        if (res.data.journey_status === 'READY') {
          alarmService.start({ alarmType: 'home', destination: editAlarm.home_name, journeyId: res.data.journey_id, destLat: editAlarm.home_lat, destLng: editAlarm.home_lng, transportMode: toTransportMode(editAlarm.transport === 'car'), isLastMode: editAlarm.mode === 'lastTrain' });
        }
      }
      await loadAlarms();
      bumpAlarmVersion();
      initialMode ? onClose() : setView('list');
    } catch (e: any) {
      console.error('귀가 알람 저장 실패:', e);
      Alert.alert('저장 실패', extractApiErrorMessage(e?.message ?? '', '다시 시도해주세요.'));
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
    setAlarms((prev) => prev.filter((a) => a.id !== editAlarm.id));
    bumpAlarmVersion();
    initialMode ? onClose() : setView('list');
  };

  const toggleAlarm = (alarm: HomeAlarm) => {
    const newEnabled = !alarm.enabled;
    setAlarms((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: newEnabled } : a));
    if (alarm.journeyId) {
      journeysApi.toggleActive(alarm.journeyId, newEnabled).catch(() => {
        setAlarms((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: !newEnabled } : a));
      });
      if (!newEnabled) {
        alarmService.stop(alarm.journeyId);
      } else if (!!alarm.myStatus && ['READY', 'DEPARTING', 'MOVING', 'NEARDEST'].includes(alarm.myStatus)) {
        alarmService.start({ alarmType: 'home', destination: alarm.home_name, journeyId: alarm.journeyId, destLat: alarm.home_lat, destLng: alarm.home_lng, transportMode: toTransportMode(alarm.transport === 'car'), isLastMode: alarm.mode === 'lastTrain' });
      }
    }
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
            {alarms.map((alarm) => (
              <SwipeableAlarmCard key={alarm.id} onDelete={async () => {
                if (alarm.journeyId) {
                  try {
                    await journeysApi.deleteJourney(alarm.journeyId);
                    // alarmService.stop()이 내부적으로 ACTIVE_JOURNEYS_KEY 제거까지 안전하게(잠금 걸린 채) 처리함
                    alarmService.stop(alarm.journeyId);
                  } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
                }
                setAlarms((prev) => prev.filter((a) => a.id !== alarm.id));
                bumpAlarmVersion();
              }}>
                <TouchableOpacity
                  style={styles.alarmCard}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (alarm.isActive) {
                      Platform.OS === 'android'
                        ? ToastAndroid.show('이동 중에는 수정할 수 없어요.', ToastAndroid.SHORT)
                        : Alert.alert('', '이동 중에는 수정할 수 없어요.');
                      return;
                    }
                    openEdit(alarm);
                  }}
                >
                  <View style={[styles.alarmInfo, alarm.isActive && { opacity: 0.45 }]}>
                    <Text style={styles.alarmPlace}>{alarm.home_name}</Text>
                    <View style={styles.alarmMeta}>
                      {alarm.mode === 'lastTrain'
                        ? <Text style={styles.alarmDeadline}>막차 기준</Text>
                        : <Text style={styles.alarmDeadline}>{alarm.ampm} {alarm.hour}:{alarm.minute} 까지</Text>
                      }
                      {alarm.mode === 'lastTrain' || alarm.transport === 'public'
                        ? <MaterialCommunityIcons name="bus-side" size={15} color="#4A90D9" />
                        : <FontAwesome5 name="car-side" size={13} color="#F5A623" />
                      }
                      {getRepeatLabel(alarm.repeat) !== '안함' && (
                        <Text style={styles.repeatLabel}>· {getRepeatLabel(alarm.repeat)}</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardRight}>
                    <Switch
                      value={alarm.enabled}
                      onValueChange={() => toggleAlarm(alarm)}
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
            <TouchableOpacity style={styles.headerBtn} onPress={() => initialMode ? onClose() : setView('list')}>
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
            )}

            <View style={styles.divider} />

{/* 귀가지 + 이동수단(데드라인) + 반복 */}
            <View style={styles.section}>
              <View style={styles.optionBox}>
                <TouchableOpacity style={styles.optionRow} onPress={openHomePlace}>
                  <Text style={styles.optionLabel}>귀가지</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue}>{editAlarm.home_name || '선택'}</Text>
                    <Feather name="chevron-right" size={16} color="#AAAAAA" />
                  </View>
                </TouchableOpacity>
                {editAlarm.mode === 'deadline' && (
                  <>
                    <View style={styles.separator} />
                    <TouchableOpacity style={styles.optionRow} onPress={() => setView('transport')}>
                      <Text style={styles.optionLabel}>이동수단</Text>
                      <View style={styles.rowRight}>
                        <Text style={styles.rowValue}>{editAlarm.transport === 'public' ? '대중교통' : '자가용'}</Text>
                        <Feather name="chevron-right" size={16} color="#AAAAAA" />
                      </View>
                    </TouchableOpacity>
                  </>
                )}
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

      {/* ── 반복 선택 화면 ── */}
      {view === 'repeat' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}>
              <Feather name="chevron-left" size={22} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.title}>반복</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => setView('edit')}>
              <Feather name="check" size={20} color="#FFFFFF" />
            </TouchableOpacity>
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
    flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: '#F5F5F5', borderRadius: 12, marginBottom: 8,
  },
  alarmInfo: { flex: 1, marginRight: 8, justifyContent: 'center' },
  cardRight: { justifyContent: 'center' },
  alarmPlace: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 5 },
  alarmMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  alarmDeadline: { fontSize: 13, fontWeight: '500', color: '#555555' },
  repeatLabel: { fontSize: 12, color: '#888888' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDDDDD' },
  lastTrainInfo: { alignItems: 'center', paddingVertical: 32 },
  lastTrainBig: { fontSize: 40, fontWeight: '700', color: '#1A1A1A', marginBottom: 12 },
  lastTrainDesc: { fontSize: 13, color: '#888888', textAlign: 'center', lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E0E0E0', marginVertical: 16 },
  pickerContainer: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    overflow: 'hidden',
    height: 200,
    marginHorizontal: 16,
    marginBottom: 8,
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