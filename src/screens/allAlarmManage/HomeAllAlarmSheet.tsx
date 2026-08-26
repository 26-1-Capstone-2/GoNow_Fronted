import AddressSearchView, { SearchResult } from '@/src/components/common/AddressSearchView';
import MiniCalendar from '@/src/components/common/MiniCalendar';
import { SegmentedToggle } from '@/src/components/common/SegmentedToggle';
import SwipeableAlarmCard from '@/src/components/common/SwipeableAlarmCard';
import AlarmTimeBlock from '@/src/components/common/AlarmTimeBlock';
import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { createJourneysApi, ensureFutureDateTime, getRepeatLabel, HomeJourneyPayload, JourneyDetail, maskToRepeatDays, nextOccurrenceDate, repeatDaysToMask, targetTimeToAmpmHourMinute, toTargetTime } from '@/src/api/journeys';
import { alarmService } from '@/src/services/alarmService';
import { extractApiErrorMessage } from '@/src/utils/notifications';
import { checkCoreAlarmPermissions } from '@/src/utils/permissions';
import { toTransportMode, canNavigateAlarm, handleNavigateAlarm } from '@/src/utils/kakaoMapDeeplink';
import { getAlarmTimeDisplay } from '@/src/utils/alarmTimeDisplay';
import { subscribeAlarmLocationUpdate } from '@/src/services/alarmEvents';
import { usePlaces } from '@/src/hooks/usePlaces';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Platform, StyleSheet, Switch, Text, ToastAndroid, TouchableOpacity, View } from 'react-native';
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

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type AlarmMode = 'lastTrain' | 'deadline';
type Transport = 'public' | 'car';
type ViewType = 'list' | 'edit' | 'homePlace' | 'date';

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
  date: string;
  isActive?: boolean;
  myStatus?: string;
  departureAlarmTime: string | null;
  // 막차 모드 target_time 확정 여부(getAlarmTimeDisplay의 hasTargetTime으로 전달)
  targetTimeKnown?: boolean;
}

interface Props { onClose: () => void; initialEditId?: number; }

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
    date: item.plan_date,
    isActive: ['MOVING'].includes(item.my_status),
    myStatus: item.my_status,
    departureAlarmTime: item.departure_alarm_time,
    targetTimeKnown: item.target_time != null,
  };
}

function fromJourneyDetail(d: JourneyDetail, planDate: string): HomeAlarm {
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
    date: planDate,
    departureAlarmTime: null,
    targetTimeKnown: d.target_time != null,
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
// 지나도 값이 안 바뀌는 버그가 생긴다(2026-08-25 발견 — 막차 "이미 지남" 판정에 이 값을
// 쓰는데, 날짜가 하루 밀려서 판정이 틀어질 수 있었음). 호출 시점마다 새로 계산한다.
function getTodayStr(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function isRepeatingAlarm(repeat: string[]): boolean {
  return !repeat.includes('안함') && repeat.length > 0;
}

const DEFAULT_ALARM: HomeAlarm = {
  id: '', mode: 'lastTrain', ampm: '오후', hour: '11', minute: '00',
  home_name: '', home_address: '', home_lat: undefined, home_lng: undefined,
  repeat: ['안함'], enabled: true, transport: 'public', date: '',
  departureAlarmTime: null,
};

export default function HomeAllAlarmSheet({ onClose, initialEditId }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ['88%'], []);
  const { bumpAlarmVersion, alarmVersion } = useCalendarStore();
  const { places, searchKey, loadPlaces, savePlace, deletePlace } = usePlaces('HOME');

  const [view, setView] = useState<ViewType>('list');
  const [alarms, setAlarms] = useState<HomeAlarm[]>([]);
  const [editAlarm, setEditAlarm] = useState<HomeAlarm>(DEFAULT_ALARM);
  const [tempPlace, setTempPlace] = useState<SearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const isEditMode = !!editAlarm.id;

  useEffect(() => { loadPlaces().catch(() => {}); }, [loadPlaces]);

  // 재조회(loadAlarms)와 실시간 패치(subscribeAlarmLocationUpdate)가 거의 동시에 발생할 때,
  // 먼저 나간 재조회가 네트워크 지연으로 나중에 도착하면 이미 반영된 최신 패치를 덮어써버리는
  // 경쟁 조건 방지용(2026-08-26). 매 loadAlarms 호출과 패치마다 세대를 올려서, 그 사이 더
  // 최신 정보가 이미 반영됐다면(세대가 바뀌었다면) 낡은 응답은 버린다.
  const loadGenRef = useRef(0);

  const loadAlarms = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const res = await alarmsApi.getAlarmsByType('HOME');
      if (loadGenRef.current !== gen) return;
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
      loadGenRef.current++;
      setAlarms((prev) => prev.map((a) =>
        a.journeyId === update.journeyId
          ? { ...a, departureAlarmTime: update.departureAlarmTime, myStatus: update.status }
          : a
      ));
    });
  }, []);

  // 이 시트는 새 화면(라우트)이 아니라 MainCalendarScreen 위에 얹힌 오버레이라, MainCalendarScreen
  // 이 하단바 시트 전체를 닫는 뒤로가기 핸들러를 별도로 갖고 있다(2026-08-25). 그 핸들러가
  // "시트가 열려 있으면 통째로 닫는다"는 식으로만 판단해서, 이 시트 안에서 카드를 눌러 수정
  // 화면(edit)까지 들어간 상태로 뒤로가기(스와이프 포함)를 하면 목록(list)으로 안 돌아가고
  // 시트 전체가 닫혀버렸다(2026-08-26 발견). view 스택 한 단계만 되돌리고, list에서 누르면
  // 그제서야 상위 핸들러가 시트 전체를 닫도록 이번 이벤트를 소비하지 않고 넘긴다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'list') return false;
      setView(view === 'edit' ? 'list' : 'edit');
      return true;
    });
    return () => sub.remove();
  }, [view]);

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

  const openEdit = async (alarm: HomeAlarm) => {
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

  const openHomePlace = () => {
    setTempPlace(editAlarm.home_name ? {
      id: 'current_home', name: editAlarm.home_name, address: editAlarm.home_address, lat: editAlarm.home_lat, lng: editAlarm.home_lng, isHome: true, isCurrent: true,
    } : null);
    setView('homePlace');
  };

  const handleHomePlaceConfirm = () => {
    if (tempPlace?.lat && tempPlace?.lng) {
      setEditAlarm((prev) => ({ ...prev, home_name: tempPlace.name, home_address: tempPlace.address, home_lat: tempPlace.lat, home_lng: tempPlace.lng }));
      savePlace(tempPlace).catch(() => {});
    }
    setView('edit');
  };

  // 실제 저장 API 호출 — baseDate가 이 저장의 plan_date 기준이 된다(평소엔 editAlarm.date,
  // "내일 막차로 생성" 확인 후엔 그 다음 날짜). lastTrainAlreadyMissed는 baseDate 기준으로
  // 다시 판정되므로, baseDate가 이미 내일이면 자연히 통과한다.
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
        const now = new Date();
        const todayStr = getTodayStr();
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
      await loadAlarms();
      bumpAlarmVersion();
      setView('list');
    } catch (e: any) {
      Alert.alert('저장 실패', extractApiErrorMessage(e?.message ?? '', '다시 시도해주세요.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editAlarm.home_name) { Alert.alert('귀가지를 선택해주세요.'); return; }
    if (!isEditMode && (!editAlarm.home_lat || !editAlarm.home_lng)) { Alert.alert('귀가지를 선택해주세요.'); return; }
    if (!editAlarm.date) { Alert.alert('날짜를 선택해주세요.'); return; }
    if (!(await checkCoreAlarmPermissions())) return;

    const hasRepeat = !editAlarm.repeat.includes('안함') && editAlarm.repeat.length > 0;
    if (editAlarm.mode === 'lastTrain' && !hasRepeat) {
      const now = new Date();
      const todayStr = getTodayStr();
      const lastTrainAlreadyMissed = editAlarm.date < todayStr
        || (editAlarm.date === todayStr && now.getHours() >= 1 && now.getHours() < 4);
      if (lastTrainAlreadyMissed) {
        // 버그47 UX 개선 — 무조건 에러로 막고 날짜를 직접 다시 고르게 하는 대신, 바로 다음
        // 날짜(내일)로 생성할지 물어본다. 반복 알람은 이미 ensureFutureDateTime이 자동으로
        // 다음 발생일을 찾아주므로 이 확인 절차가 필요 없다(!hasRepeat인 경우만 해당).
        Alert.alert(
          '시간 오류',
          '오늘 밤 막차는 이미 지났습니다. 내일 막차로 생성하시겠습니까?',
          [
            { text: '취소', style: 'cancel' },
            { text: '내일로 생성', onPress: () => { void saveWithBaseDate(addDaysStr(editAlarm.date, 1)); } },
          ],
        );
        return;
      }
    }
    await saveWithBaseDate(editAlarm.date);
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
        alarmService.start({ alarmType: 'home', destination: alarm.home_name, journeyId: alarm.journeyId, destLat: alarm.home_lat, destLng: alarm.home_lng, transportMode: toTransportMode(alarm.transport === 'car'), isLastMode: alarm.mode === 'lastTrain', repeatDays: repeatDaysToMask(alarm.repeat) });
      }
    }
  };

  // DRIVING/TRANSIT 공통 카카오맵 딥링크 — 단일 딥링크 설계 (docs/reference/kakao-map-deeplink-spec.md §2.2~2.4 참고)
  const canNavigate = (alarm: HomeAlarm) => canNavigateAlarm(alarm.myStatus);

  // 매번 새로 GPS를 잡아 열기까지 1~2초 걸릴 수 있어(kakaoMapDeeplink.ts 참고),
  // 버튼이 멈춘 건지 헷갈리지 않도록 눌린 카드의 id만 로딩 표시한다.
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const handleNavigate = async (alarm: HomeAlarm) => {
    setNavigatingId(alarm.id);
    try {
      await handleNavigateAlarm(alarm.home_lat, alarm.home_lng, alarm.transport === 'car');
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
            <Text style={styles.title}>귀가</Text>
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
                isLastMode: alarm.mode === 'lastTrain',
                hasTargetTime: alarm.targetTimeKnown,
                isRepeating: isRepeatingAlarm(alarm.repeat),
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
                    <Feather name="navigation" size={17} color="#30D158" />
                  </View>
                  <View style={[styles.alarmInfo, dimmed && { opacity: 0.45 }]}>
                    {alarm.date ? <Text style={styles.alarmDate}>{formatCardDate(alarm.date)}</Text> : null}
                    <Text style={styles.alarmPlace} numberOfLines={1}>{alarm.home_name}</Text>
                    <AlarmTimeBlock
                      display={display}
                      trailing={<>
                        {alarm.mode === 'lastTrain' || alarm.transport === 'public'
                          ? <MaterialCommunityIcons name="bus-side" size={15} color="#30D158" />
                          : <FontAwesome5 name="car-side" size={13} color="#30D158" />
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
            <Text style={styles.title}>{isEditMode ? '귀가 알람 수정' : '귀가 알람 추가'}</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Feather name="check" size={20} color="#FFFFFF" />}
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

            <TouchableOpacity style={styles.fieldRow} onPress={() => setView('date')} activeOpacity={0.7}>
              <Feather name="calendar" size={17} color="#30D158" />
              <Text style={styles.fieldValue}>{editAlarm.date ? formatDateLabel(editAlarm.date) : '날짜 선택'}</Text>
              <Feather name="chevron-right" size={16} color="#B0B0B4" />
            </TouchableOpacity>

            {editAlarm.mode === 'lastTrain' ? (
              <View style={styles.lastTrainInfo}>
                <Text style={styles.lastTrainBig}>막차</Text>
                <Text style={styles.lastTrainDesc}>설정한 귀가지까지의 막차를 기준으로 알람을 드립니다.</Text>
              </View>
            ) : (
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

      {/* ── 귀가지 ── */}
      {view === 'homePlace' && (
        <>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setView('edit')}><Feather name="chevron-left" size={22} color="#1A1A1A" /></TouchableOpacity>
            <Text style={styles.title}>귀가지</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleHomePlaceConfirm}><Feather name="check" size={20} color="#FFFFFF" /></TouchableOpacity>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 20,
    backgroundColor: '#FFCE0C', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  saveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
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
  typeChip: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#EAF9EE', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  alarmInfo: { flex: 1, marginRight: 8, justifyContent: 'center' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navigateBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EAF2FB', alignItems: 'center', justifyContent: 'center' },
  navigateBtnDisabled: { backgroundColor: '#EEEEEE' },
  alarmDate: { fontSize: 11, fontWeight: '500', color: '#FF453A', marginBottom: 3 },
  alarmPlace: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 5 },
  repeatLabel: { fontSize: 12, color: '#888888' },
  lastTrainInfo: { alignItems: 'center', paddingVertical: 24, backgroundColor: '#F7F7F8', borderRadius: 16, marginBottom: 16 },
  lastTrainBig: { fontSize: 36, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 },
  lastTrainDesc: { fontSize: 13, color: '#888888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
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
