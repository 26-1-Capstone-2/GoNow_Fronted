import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import MiniCalendar from '@/src/components/common/MiniCalendar';
import { SegmentedToggle } from '@/src/components/common/SegmentedToggle';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { createJourneysApi, ensureFutureDateTime, getRepeatLabel, JourneyDetail, maskToRepeatDays, nextOccurrenceDate, PersonalJourneyPayload, repeatDaysToMask, targetTimeToAmpmHourMinute, toTargetTime } from '@/src/api/journeys';
import { alarmService } from '@/src/services/alarmService';
import { checkCoreAlarmPermissions } from '@/src/utils/permissions';
import { toTransportMode, canNavigateAlarm, handleNavigateAlarm } from '@/src/utils/kakaoMapDeeplink';
import { getAlarmTimeDisplay } from '@/src/utils/alarmTimeDisplay';
import { subscribeAlarmLocationUpdate } from '@/src/services/alarmEvents';
import AlarmTimeBlock from '@/src/components/common/AlarmTimeBlock';
import { usePlaces } from '@/src/hooks/usePlaces';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Switch, Text, ToastAndroid, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const journeysApi = createJourneysApi();
const alarmsApi = createAlarmsApi();

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];
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
type ViewType = 'list' | 'edit' | 'place' | 'date';

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
  date: string;
  isActive?: boolean;
  myStatus?: string;
  departureAlarmTime: string | null;
}

interface Props { onClose: () => void; initialEditId?: number; }

function fromAlarmItem(item: AlarmItem): Alarm {
  const { ampm, hour, minute } = targetTimeToAmpmHourMinute(item.target_time);
  return {
    id: String(item.journey_id),
    journeyId: item.journey_id ?? undefined,
    ampm, hour, minute,
    dest_name: item.dest_name,
    dest_address: '',
    dest_lat: item.dest_lat,
    dest_lng: item.dest_lng,
    repeat: maskToRepeatDays(item.repeat_days ?? 0),
    enabled: item.is_active,
    transport: item.transport_type === 'TRANSIT' ? 'public' : 'car',
    date: item.plan_date,
    isActive: ['MOVING'].includes(item.my_status),
    myStatus: item.my_status,
    departureAlarmTime: item.departure_alarm_time,
  };
}

function fromJourneyDetail(d: JourneyDetail, planDate: string): Alarm {
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
    date: planDate,
    departureAlarmTime: null,
  };
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, '0')}월 ${String(d.getDate()).padStart(2, '0')}일 ${DAY_LABEL[d.getDay()]}요일`;
}
function formatCardDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_LABEL[d.getDay()]}요일`;
}

// 이 화면은 백그라운드 GPS 추적 때문에 자정을 넘겨서도 계속 떠 있을 수 있는 앱(모듈은 앱
// 시작/마지막 리로드 시점에 딱 한 번만 평가됨)이라, 모듈 최상단 상수로 고정해두면 자정이
// 지나도 값이 안 바뀌는 버그가 생긴다 — "추가" 시 기본 날짜가 어제로 뜨게 됨. 호출 시점마다
// 새로 계산한다(HomeAllAlarmSheet.tsx와 동일 이유, 2026-08-25 발견).
function getTodayStr(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

const DEFAULT_ALARM: Alarm = {
  id: '', ampm: '오전', hour: '7', minute: '00',
  dest_name: '', dest_address: '', dest_lat: undefined, dest_lng: undefined,
  repeat: ['안함'], enabled: true, transport: 'public', date: '',
  departureAlarmTime: null,
};

export default function PersonalAllAlarmSheet({ onClose, initialEditId }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ['88%'], []);
  const { bumpAlarmVersion, alarmVersion } = useCalendarStore();
  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('DEST');

  const [view, setView] = useState<ViewType>('list');
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [editAlarm, setEditAlarm] = useState<Alarm>(DEFAULT_ALARM);
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const isEditMode = !!editAlarm.id;

  useEffect(() => { loadPlaces().catch(() => {}); }, [loadPlaces]);

  const loadAlarms = useCallback(async () => {
    try {
      const res = await alarmsApi.getAlarmsByType('PERSONAL');
      setAlarms((res.data ?? []).map(fromAlarmItem));
    } catch {}
    // alarmVersion 의존 이유: alarmService가 GPS 응답을 받을 때마다(target_time 등 로컬 패치로는
    // 못 따라잡는 값 포함) 이 값을 올려서 여기서도 다시 불러오게 한다.
  }, [alarmVersion]);

  useEffect(() => { loadAlarms(); }, [loadAlarms]);

  // 생성/수정 직후엔 서버가 아직 GPS 응답을 못 받아서 departureAlarmTime이 비어있는 채로
  // 카드가 렌더된다 — alarmService가 실제 GPS 응답을 받는 시점에 재조회 없이 바로 반영한다.
  useEffect(() => {
    return subscribeAlarmLocationUpdate((update) => {
      if (update.journeyId == null) return;
      setAlarms((prev) => prev.map((a) =>
        a.journeyId === update.journeyId
          ? { ...a, departureAlarmTime: update.departureAlarmTime, myStatus: update.status }
          : a
      ));
    });
  }, []);

  const consumedEditIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!initialEditId || alarms.length === 0) return;
    if (consumedEditIdRef.current === initialEditId) return;
    const match = alarms.find((a) => a.journeyId === initialEditId);
    if (match) {
      consumedEditIdRef.current = initialEditId;
      openEdit(match);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId, alarms]);

  const handleSheetChange = useCallback((index: number) => { if (index === -1) onClose(); }, [onClose]);
  const openAdd = () => {
    setEditAlarm({ ...DEFAULT_ALARM, ...targetTimeToAmpmHourMinute(new Date().toISOString()), minute: '00', date: getTodayStr() });
    setView('edit');
  };

  const openEdit = async (alarm: Alarm) => {
    if (alarm.isActive) return;
    if (alarm.journeyId) {
      try {
        const res = await journeysApi.getJourney(alarm.journeyId);
        setEditAlarm(fromJourneyDetail(res.data, alarm.date));
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
      id: 'current_dest', name: editAlarm.dest_name, address: editAlarm.dest_address, lat: editAlarm.dest_lat, lng: editAlarm.dest_lng, isCurrent: true,
    } : null);
    setView('place');
  };

  const handlePlaceConfirm = () => {
    if (tempPlace?.lat && tempPlace?.lng) {
      setEditAlarm((prev) => ({ ...prev, dest_name: tempPlace.name, dest_address: tempPlace.address, dest_lat: tempPlace.lat, dest_lng: tempPlace.lng }));
      savePlace(tempPlace).catch(() => {});
    }
    setView('edit');
  };

  const handleSave = async () => {
    if (!editAlarm.dest_name) { Alert.alert('목적지를 선택해주세요.'); return; }
    if (!isEditMode && (!editAlarm.dest_lat || !editAlarm.dest_lng)) { Alert.alert('목적지를 선택해주세요.'); return; }
    if (!editAlarm.date) { Alert.alert('날짜를 선택해주세요.'); return; }
    if (!(await checkCoreAlarmPermissions())) return;
    setSaving(true);
    try {
      const rawTime = toTargetTime(editAlarm.date, editAlarm.ampm, editAlarm.hour, editAlarm.minute);
      const isPast = new Date(rawTime) <= new Date();
      const hasRepeat = !editAlarm.repeat.includes('안함') && editAlarm.repeat.length > 0;
      const repeatMask = repeatDaysToMask(editAlarm.repeat);
      if (isPast && !hasRepeat) {
        Alert.alert('시간 오류', '이미 지난 시간입니다. 시간을 다시 설정해주세요.');
        setSaving(false);
        return;
      }
      const { plan_date, target_time } = hasRepeat
        ? ensureFutureDateTime(editAlarm.date, rawTime, repeatMask)
        : { plan_date: editAlarm.date, target_time: rawTime };

      const payload: PersonalJourneyPayload = {
        plan_date,
        target_time,
        dest_name: editAlarm.dest_name,
        dest_address: editAlarm.dest_address,
        dest_lat: editAlarm.dest_lat!,
        dest_lng: editAlarm.dest_lng!,
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
      await loadAlarms();
      bumpAlarmVersion();
      setView('list');
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
      } catch { Alert.alert('삭제 실패', '다시 시도해주세요.'); return; }
    }
    setAlarms((prev) => prev.filter((a) => a.id !== editAlarm.id));
    bumpAlarmVersion();
    setView('list');
  };

  const toggleAlarm = (alarm: Alarm) => {
    const newEnabled = !alarm.enabled;
    setAlarms((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: newEnabled } : a));
    if (alarm.journeyId) {
      journeysApi.toggleActive(alarm.journeyId, newEnabled).catch(() => {
        setAlarms((prev) => prev.map((a) => a.id === alarm.id ? { ...a, enabled: !newEnabled } : a));
      });
      if (!newEnabled) {
        alarmService.stop(alarm.journeyId);
      } else if (!!alarm.myStatus && ['READY', 'DEPARTING', 'MOVING', 'NEARDEST'].includes(alarm.myStatus)) {
        alarmService.start({ alarmType: 'personal', destination: alarm.dest_name, journeyId: alarm.journeyId, destLat: alarm.dest_lat, destLng: alarm.dest_lng, transportMode: toTransportMode(alarm.transport === 'car'), repeatDays: repeatDaysToMask(alarm.repeat) });
      }
    }
  };

  // DRIVING/TRANSIT 공통 카카오맵 딥링크 — 단일 딥링크 설계 (docs/reference/kakao-map-deeplink-spec.md §2.2~2.4 참고)
  const canNavigate = (alarm: Alarm) => canNavigateAlarm(alarm.myStatus);

  // 매번 새로 GPS를 잡아 열기까지 1~2초 걸릴 수 있어(kakaoMapDeeplink.ts 참고),
  // 버튼이 멈춘 건지 헷갈리지 않도록 눌린 카드의 id만 로딩 표시한다.
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const handleNavigate = async (alarm: Alarm) => {
    setNavigatingId(alarm.id);
    try {
      await handleNavigateAlarm(alarm.dest_lat, alarm.dest_lng, alarm.transport === 'car');
    } finally {
      setNavigatingId(null);
    }
  };

  const toggleRepeat = (day: string) => {
    setEditAlarm((prev) => {
      if (day === '안함') return { ...prev, repeat: ['안함'] };
      const has = prev.repeat.includes(day);
      let next = has ? prev.repeat.filter((r) => r !== day) : prev.repeat.filter((r) => r !== '안함').concat(day);
      if (next.length === 0) next = ['안함'];
      return { ...prev, repeat: next };
    });
  };

  return (
    <BottomSheet ref={bottomSheetRef} index={0} snapPoints={snapPoints} onChange={handleSheetChange}
      onClose={onClose} enablePanDownToClose enableDynamicSizing={false}
      handleIndicatorStyle={styles.indicator} backgroundStyle={styles.background}>

      {/* ── 목록 ── */}
      {view === 'list' && (
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}><Feather name="x" size={22} color="#1A1A1A" /></TouchableOpacity>
            <Text style={styles.title}>개인</Text>
            <View style={{ width: 36 }} />
          </View>
          <View style={styles.datePillContainer}>
            <View style={styles.datePill}><Text style={styles.datePillText}>전체</Text></View>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {[...alarms].sort((a, b) => {
              if (!a.date) return 1; if (!b.date) return -1;
              return a.date.localeCompare(b.date);
            }).map((alarm) => {
              const display = getAlarmTimeDisplay({
                targetAmpm: alarm.ampm,
                targetHour: alarm.hour,
                targetMinute: alarm.minute,
                departureAlarmTime: alarm.departureAlarmTime,
                planDate: nextOccurrenceDate(alarm.date, repeatDaysToMask(alarm.repeat)),
                myStatus: alarm.myStatus,
              });
              // MOVING은 편집 자체를 막고(alarm.isActive), 도착 완료는 편집은 막지 않되
              // DailyAlarmScreen과 동일하게 시각적으로만 흐리게 표시한다.
              const dimmed = alarm.isActive || display.state === 'arrived';
              return (
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
                <TouchableOpacity style={styles.alarmCard} onPress={() => {
                    if (alarm.isActive) {
                      Platform.OS === 'android'
                        ? ToastAndroid.show('이동 중에는 수정할 수 없어요.', ToastAndroid.SHORT)
                        : Alert.alert('', '이동 중에는 수정할 수 없어요.');
                      return;
                    }
                    openEdit(alarm);
                  }} activeOpacity={0.7}>
                  <View style={[styles.typeChip, dimmed && { opacity: 0.45 }]}>
                    <Feather name="map-pin" size={17} color="#0A84FF" />
                  </View>
                  <View style={[styles.alarmInfo, dimmed && { opacity: 0.45 }]}>
                    {alarm.date ? <Text style={styles.alarmDate}>{formatCardDate(alarm.date)}</Text> : null}
                    <Text style={styles.alarmPlace} numberOfLines={1}>{alarm.dest_name}</Text>
                    <AlarmTimeBlock
                      display={display}
                      trailing={<>
                        {alarm.transport === 'public'
                          ? <MaterialCommunityIcons name="bus-side" size={15} color="#0A84FF" />
                          : <FontAwesome5 name="car-side" size={13} color="#0A84FF" />
                        }
                        {getRepeatLabel(alarm.repeat) !== '안함' && (
                          <Text style={styles.repeatLabel}>· {getRepeatLabel(alarm.repeat)}</Text>
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
                    <Switch value={alarm.enabled} onValueChange={() => toggleAlarm(alarm)}
                      trackColor={{ false: '#E0E0E0', true: '#30D158' }} thumbColor="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </SwipeableAlarmCard>
              );
            })}
          </BottomSheetScrollView>
          <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openAdd} activeOpacity={0.85}>
            <Feather name="plus" size={24} color="#1A1A1A" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── 수정/추가 ── */}
      {view === 'edit' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('list')}><Feather name="x" size={22} color="#1A1A1A" /></TouchableOpacity>
            <Text style={styles.title}>{isEditMode ? '개인 알람 수정' : '개인 알람 추가'}</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Feather name="check" size={20} color="#FFFFFF" />}
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

            <TouchableOpacity style={styles.fieldRow} onPress={() => setView('date')} activeOpacity={0.7}>
              <Feather name="calendar" size={17} color="#0A84FF" />
              <Text style={styles.fieldValue}>{editAlarm.date ? formatDateLabel(editAlarm.date) : '날짜 선택'}</Text>
              <Feather name="chevron-right" size={16} color="#B0B0B4" />
            </TouchableOpacity>

            <View style={styles.timeCard}>
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
                <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}><Text style={styles.deleteButtonText}>알람삭제</Text></TouchableOpacity>
              </View>
            )}
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 날짜 선택 ── */}
      {view === 'date' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}><Feather name="chevron-left" size={22} color="#1A1A1A" /></TouchableOpacity>
            <Text style={styles.title}>날짜 선택</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => setView('edit')}><Feather name="check" size={20} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <MiniCalendar
              selectedDate={editAlarm.date}
              onSelectDate={(date) => { setEditAlarm((prev) => ({ ...prev, date })); setView('edit'); }}
            />
          </BottomSheetScrollView>
        </>
      )}

      {/* ── 목적지 ── */}
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
  saveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#0A84FF', alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 20,
    backgroundColor: '#FFCE0C', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  datePillContainer: { alignItems: 'center', marginBottom: 12 },
  datePill: { backgroundColor: '#E8E8E8', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 7 },
  datePillText: { fontSize: 13, fontWeight: '600', color: '#FF453A' },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  alarmCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14, backgroundColor: '#FFFFFF', borderRadius: 18,
    marginBottom: 10,
    shadowColor: '#141413', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  typeChip: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#EAF3FF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  alarmInfo: { flex: 1, marginRight: 8, justifyContent: 'center' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navigateBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EAF2FB', alignItems: 'center', justifyContent: 'center' },
  navigateBtnDisabled: { backgroundColor: '#EEEEEE' },
  alarmDate: { fontSize: 11, fontWeight: '500', color: '#FF453A', marginBottom: 3 },
  alarmPlace: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 5 },
  repeatLabel: { fontSize: 12, color: '#888888' },
  pickerContainer: { flexDirection: 'row', backgroundColor: '#F7F7F8', borderRadius: 14, overflow: 'hidden', height: Platform.OS === 'ios' ? 200 : 56, marginTop: 8 },
  picker: { flex: 1 },
  pickerItem: { fontSize: 20, color: '#1A1A1A', height: 200 },
  fieldGroup: { marginBottom: 16 },
  fieldGroupLabel: { fontSize: 12, fontWeight: '600', color: '#8A8A8E', marginBottom: 8 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F7F7F8', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 16,
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
