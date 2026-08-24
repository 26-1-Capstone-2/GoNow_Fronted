import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAllAlarmSheet from '@/src/screens/allAlarmManage/GroupAllAlarmSheet';
import HomeAllAlarmSheet from '@/src/screens/allAlarmManage/HomeAllAlarmSheet';
import PersonalAllAlarmSheet from '@/src/screens/allAlarmManage/PersonalAllAlarmSheet';
import AlarmSettingsSheet from '@/src/screens/main/AlarmSettingsSheet';
import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { targetTimeToAmpmHourMinute } from '@/src/api/journeys';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Dimensions,
  FlatList,
  InteractionManager,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DAY_WIDTH = Math.floor(SCREEN_WIDTH / 7);
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const TOTAL_MONTHS = 49;
const CENTER_INDEX = 24;

const SERVICE_KEY = 'f72192a95a1f1c519e3d89b202a2e0811505d0fbb33385bc5770a4ec5fa03ba6';
const BASE_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService';

interface Holiday {
  dateName: string;
  locdate: number;
}

async function fetchHolidays(year: number, month: number): Promise<Holiday[]> {
  const url = `${BASE_URL}/getRestDeInfo?serviceKey=${SERVICE_KEY}&solYear=${year}&solMonth=${String(month).padStart(2, '0')}&_type=json&numOfRows=20`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const items = json?.response?.body?.items?.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    console.error('공휴일 API 오류:', e);
    return [];
  }
}

function locdateToString(locdate: number): string {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

type EventMap = Record<string, { label: string; color: string }[]>;
type AlarmCountMap = Record<string, { personal: number; group: number; home: number }>;
type AlarmKind = 'personal' | 'group' | 'home';
interface UpcomingItem {
  id: string;
  kind: AlarmKind;
  targetId: number;
  title: string;
  meta: string;
  dday: string;
  color: string;
  bg: string;
  dateKey: string;
}

const KIND_META: Record<AlarmKind, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Feather>['name'] }> = {
  personal: { label: '개인', color: '#0A84FF', bg: '#EAF3FF', icon: 'user' },
  group: { label: '그룹', color: '#FF9F0A', bg: '#FFF3E5', icon: 'users' },
  home: { label: '귀가', color: '#30D158', bg: '#EAF9EE', icon: 'navigation' },
};

function getOffsetFromBase(baseYear: number, baseMonth: number, targetYear: number, targetMonth: number) {
  return (targetYear - baseYear) * 12 + (targetMonth - baseMonth);
}

// FlatList가 "이 설정이 매 렌더마다 바뀌지 않는다"고 가정하므로 컴포넌트 바깥에서 고정값으로 둔다.
const MONTH_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 51 };

function getYearMonthFromIndex(baseYear: number, baseMonth: number, index: number) {
  const offset = index - CENTER_INDEX;
  let m = baseMonth - 1 + offset;
  let y = baseYear + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}

function getCalendarWeeks(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();
  const days: { date: number; month: 'prev' | 'cur' | 'next'; fullDate: string }[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const pm = month - 1 === 0 ? 12 : month - 1;
    const py = month - 1 === 0 ? year - 1 : year;
    days.push({ date: d, month: 'prev', fullDate: `${py}-${String(pm).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ date: i, month: 'cur', fullDate: `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
  }
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    const nm = month + 1 === 13 ? 1 : month + 1;
    const ny = month + 1 === 13 ? year + 1 : year;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: i, month: 'next', fullDate: `${ny}-${String(nm).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

interface CalendarMonthProps {
  year: number;
  month: number;
  todayStr: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onDayPress: (date: string) => void;
  containerHeight: number;
  events: EventMap;
  alarmCounts: AlarmCountMap;
}

const alarmsApi = createAlarmsApi();

const CalendarMonth = memo(function CalendarMonth({
  year, month, todayStr, selectedDate, onSelectDate, onDayPress, containerHeight, events, alarmCounts,
}: CalendarMonthProps) {
  const weeks = getCalendarWeeks(year, month);
  const WEEKDAY_H = 32;
  const GRID_H = containerHeight - WEEKDAY_H;
  const ROW_HEIGHT = Math.floor(GRID_H / weeks.length);

  return (
    <View style={{ width: SCREEN_WIDTH, height: containerHeight }}>
      <View style={[styles.weekdayRow, { height: WEEKDAY_H }]}>
        {DAYS.map((d, i) => (
          <Text key={d} style={[styles.weekdayText, i === 0 && styles.sundayText, i === 6 && styles.saturdayText]}>
            {d}
          </Text>
        ))}
      </View>
      <View>
        {weeks.map((week, wi) => (
          <View key={wi} style={[styles.weekRow, { height: ROW_HEIGHT }, wi < weeks.length - 1 && styles.weekBorder]}>
            {week.map((day, di) => {
              const isToday = day.fullDate === todayStr;
              const isSelected = day.fullDate === selectedDate;
              const isCur = day.month === 'cur';
              const dayEvents = events[day.fullDate] || [];
              return (
                <TouchableOpacity
                  key={di}
                  style={styles.dayCell}
                  onPress={() => { if (isCur) onDayPress(day.fullDate); }}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.dayNumWrap,
                    isToday && styles.todayCircle,
                    isSelected && !isToday && styles.selectedCircle,
                  ]}>
                    <Text style={[
                      styles.dayNum,
                      !isCur && styles.otherMonthDay,
                      isToday && styles.todayText,
                      isSelected && !isToday && styles.selectedText,
                      di === 0 && isCur && !isToday && !isSelected && styles.sundayText,
                      di === 6 && isCur && !isToday && !isSelected && styles.saturdayText,
                    ]}>
                      {day.date}
                    </Text>
                  </View>
                  {dayEvents.slice(0, 1).map((ev, ei) => (
                    <View key={ei} style={[styles.eventBadge, { backgroundColor: ev.color + '22' }]}>
                      <View style={[styles.eventDot, { backgroundColor: ev.color }]} />
                      <Text style={[styles.eventLabel, { color: ev.color }]} numberOfLines={1}>{ev.label}</Text>
                    </View>
                  ))}
                  {(() => {
                    const c = alarmCounts[day.fullDate];
                    const dots: string[] = [];
                    if (c?.personal) dots.push('#0A84FF');
                    if (c?.group) dots.push('#FF9F0A');
                    if (c?.home) dots.push('#30D158');
                    if (dots.length === 0) return null;
                    return (
                      <View style={[styles.dotRow, !isCur && { opacity: 0.35 }]}>
                        {dots.map((color, i) => (
                          <View key={i} style={[styles.dot, { backgroundColor: color }]} />
                        ))}
                      </View>
                    );
                  })()}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
});

export default function MainCalendarScreen() {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const router = useRouter();

  const { selectedYear, selectedMonth, selectedDate, setSelectedDate, setYearMonth, alarmVersion } = useCalendarStore();

  const [containerHeight, setContainerHeight] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showPersonalSheet, setShowPersonalSheet] = useState(false);
  const [showGroupSheet, setShowGroupSheet] = useState(false);
  const [showHomeSheet, setShowHomeSheet] = useState(false);
  const [showArrivalSheet, setShowArrivalSheet] = useState(false);
  const [selectedGroupAlarm, setSelectedGroupAlarm] = useState<any>(null);
  const [events, setEvents] = useState<EventMap>({});
  const [alarmCounts, setAlarmCounts] = useState<AlarmCountMap>({});
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const lastBackPressRef = useRef(0);
  const isAtTodayRef = useRef(true);
  const isMountedRef = useRef(false);
  const pendingScrollRef = useRef(false);
  // 스와이프 자체(onMomentumScrollEnd)가 selectedYear/selectedMonth를 바꾼 경우엔 FlatList가
  // pagingEnabled로 이미 정확한 위치에 스냅돼 있으므로 보정 스크롤이 불필요하다 — 그런데도
  // 보정 스크롤을 또 걸면, 빠르게 스와이프했을 때 아직 안 멈춘 네이티브 스크롤과 부딪혀서
  // 달이 앞뒤로 튕기는 버그가 있었다(2026-08-24). 버튼(이전/다음달, 오늘) 변경에는 여전히
  // 보정이 필요하므로, 스와이프로 인한 변경일 때만 다음 보정을 건너뛴다.
  const skipPendingScrollRef = useRef(false);
  const containerHeightRef = useRef(0);
  const prevContainerHeightRef = useRef(0);

  const currentIndex = CENTER_INDEX + getOffsetFromBase(
    today.getFullYear(), today.getMonth() + 1,
    selectedYear, selectedMonth
  );

  const months = Array.from({ length: TOTAL_MONTHS }, (_, i) => i);

  const monthStats = useMemo(() => {
    const stats = { personal: 0, group: 0, home: 0 };
    getCalendarWeeks(selectedYear, selectedMonth).forEach((week) => week.forEach((day) => {
      if (day.month !== 'cur') return;
      const c = alarmCounts[day.fullDate];
      if (c) { stats.personal += c.personal; stats.group += c.group; stats.home += c.home; }
    }));
    return stats;
  }, [selectedYear, selectedMonth, alarmCounts]);

  const goPrevMonth = useCallback(() => {
    let y = selectedYear, m = selectedMonth - 1;
    if (m === 0) { m = 12; y -= 1; }
    setYearMonth(y, m);
  }, [selectedYear, selectedMonth]);

  const goNextMonth = useCallback(() => {
    let y = selectedYear, m = selectedMonth + 1;
    if (m === 13) { m = 1; y += 1; }
    setYearMonth(y, m);
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    if (!isMountedRef.current) return;
    if (skipPendingScrollRef.current) {
      skipPendingScrollRef.current = false;
      return;
    }
    pendingScrollRef.current = true;
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    if (containerHeight === 0) return;
    const clampedIndex = Math.max(0, Math.min(TOTAL_MONTHS - 1, currentIndex));
    const heightChanged = prevContainerHeightRef.current !== containerHeight;
    prevContainerHeightRef.current = containerHeight;

    if (!isMountedRef.current) {
      isMountedRef.current = true;
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToOffset({ offset: clampedIndex * containerHeight, animated: false });
      });
      return;
    }

    if (heightChanged) {
      // 레이아웃 재계산으로 높이가 바뀌면 현재 달 위치로 즉시 재스냅
      flatListRef.current?.scrollToOffset({ offset: clampedIndex * containerHeight, animated: false });
      return;
    }

    if (pendingScrollRef.current) {
      pendingScrollRef.current = false;
      flatListRef.current?.scrollToOffset({ offset: clampedIndex * containerHeight, animated: true });
    }
  }, [containerHeight, selectedYear, selectedMonth]);

  useEffect(() => {
    // 달력 표시 범위: 오늘 기준 ±24개월
    const rangeStart = new Date(today.getFullYear(), today.getMonth() - 24, 1);
    const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 25, 0);

    // getDay() → repeat_days 비트 (0=일, 1=월, ..., 6=토)
    const DAY_TO_BIT = [64, 1, 2, 4, 8, 16, 32];

    function toDateKey(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function addCount(key: string, type: 'personal' | 'group' | 'home', counts: AlarmCountMap) {
      if (!counts[key]) counts[key] = { personal: 0, group: 0, home: 0 };
      counts[key][type]++;
    }

    function expandAlarm(planDateRaw: string, repeatDays: number | null, type: 'personal' | 'group' | 'home', counts: AlarmCountMap) {
      const baseKey = planDateRaw.split('T')[0]; // datetime 형식 대비 정규화

      if (!repeatDays) {
        addCount(baseKey, type, counts);
        return;
      }

      // 반복 알람: plan_date(생성일)는 무조건 카운트 — 생성한 날짜 자체도 유효한 발생일이다.
      addCount(baseKey, type, counts);

      // 반복 알람: 각 요일별로 범위 내 모든 날짜에 카운트 (plan_date 제외 — 이미 위에서 카운트)
      const planDate = new Date(baseKey);
      planDate.setHours(0, 0, 0, 0);

      for (let dow = 0; dow < 7; dow++) {
        if (!(repeatDays & DAY_TO_BIT[dow])) continue;

        // plan_date와 rangeStart 중 더 늦은 날부터 해당 요일 첫 날 찾기
        const start = new Date(Math.max(planDate.getTime(), rangeStart.getTime()));
        const daysUntil = (dow - start.getDay() + 7) % 7;
        const cur = new Date(start);
        cur.setDate(cur.getDate() + daysUntil);

        while (cur <= rangeEnd) {
          if (toDateKey(cur) !== baseKey) addCount(toDateKey(cur), type, counts);
          cur.setDate(cur.getDate() + 7);
        }
      }
    }

    function diffDays(dateStr: string): number {
      const d1 = new Date(dateStr + 'T00:00:00');
      const d2 = new Date(todayStr + 'T00:00:00');
      return Math.round((d1.getTime() - d2.getTime()) / 86400000);
    }

    function formatUpcomingMeta(kind: AlarmKind, planDate: string, targetTime: string | null, isLastMode: boolean, isRepeating: boolean): string {
      const dateLabel = planDate === todayStr
        ? '오늘'
        : (() => { const d = new Date(planDate + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}`; })();
      // 막차+반복 조합은 target_time이 "오늘" 발생일에만 유효하다(alarmTimeDisplay.ts와 동일 이유
      // — 레코드 필드 하나뿐이라 새벽 4시 READY 전환 때 오늘 것으로만 재계산됨). 오늘이 아닌
      // 발생일(dateKey)에 그 값을 그대로 쓰면 실제로는 무관한 시각이 새어나온다.
      const targetTimeTrusted = isLastMode && isRepeating ? planDate === todayStr : true;
      // 막차 모드에서 target_time이 서버 계산 전(null)이거나 이 발생일엔 신뢰할 수 없으면
      // 실제 시각 대신 자리표시자를 쓴다 (alarmTimeDisplay.ts의 "막차 기준"과 동일한 문구로 통일)
      if (targetTime == null || !targetTimeTrusted) {
        return `${KIND_META[kind].label} · ${dateLabel} 막차 기준`;
      }
      const { ampm, hour, minute } = targetTimeToAmpmHourMinute(targetTime);
      // "다음날"은 귀가-막차 모드에만 적용한다. target_time은 여정마다 필드 하나뿐이라(occurrence별
      // 저장 아님) 개인/그룹/귀가-데드라인은 그 날짜 부분이 애초에 신뢰할 수 있는 정보가 아니다
      // (편집 화면도 시각만 보여주고 날짜는 신경 안 씀, plan_date와 다르게 저장돼 있어도 의미 없음).
      // 귀가-막차만 서버가 매일 새벽 4시 READY 전환 때 그날 것으로 target_time을 실제로 다시
      // 계산해 넣어주므로, 그 날짜가 plan_date보다 뒤라면(자정 넘긴 막차) 진짜 의미 있는 정보다.
      if (isLastMode && targetTime.slice(0, 10) > planDate) {
        return `${KIND_META[kind].label} · 다음날 새벽 ${hour}:${minute}`;
      }
      return `${KIND_META[kind].label} · ${dateLabel} ${ampm} ${hour}:${minute}`;
    }

    // 같은 dateKey(서비스데이) 안에서 정렬용. target_time은 (막차 모드가 자정을 넘긴 경우를
    // 포함해) 항상 정확한 실제 날짜가 붙어 있으므로(플라스크가 datetime 연산으로 계산, 문자열
    // 조작 아님 — 확인 완료) 실제 타임스탬프로 비교하면 자정 넘긴 항목도 자동으로 맨 뒤에 온다.
    function upcomingSortValue(targetTime: string | null): number {
      if (targetTime == null) return Infinity; // 막차 기준(계산 전) — 이 그룹의 맨 뒤로
      return new Date(targetTime).getTime();
    }

    function buildUpcoming(items: { kind: AlarmKind; item: AlarmItem }[]): UpcomingItem[] {
      // expandAlarm()과 동일하게 반복 알람(repeat_days)은 7일 이내에 걸리는 요일마다
      // 별도 항목으로 펼친다 — 캘린더의 날짜별 점 표시와 동일한 기준을 맞추기 위함.
      const horizonEnd = new Date(today);
      horizonEnd.setDate(horizonEnd.getDate() + 7);

      const occurrences: { kind: AlarmKind; item: AlarmItem; dateKey: string }[] = [];
      items.forEach(({ kind, item }) => {
        const baseKey = item.plan_date.split('T')[0];
        if (baseKey >= todayStr && diffDays(baseKey) <= 7) {
          occurrences.push({ kind, item, dateKey: baseKey });
        }
        if (!item.repeat_days) return;

        const planDate = new Date(baseKey);
        planDate.setHours(0, 0, 0, 0);
        for (let dow = 0; dow < 7; dow++) {
          if (!(item.repeat_days & DAY_TO_BIT[dow])) continue;
          const start = new Date(Math.max(planDate.getTime(), today.getTime()));
          const daysUntil = (dow - start.getDay() + 7) % 7;
          const cur = new Date(start);
          cur.setDate(cur.getDate() + daysUntil);
          while (cur <= horizonEnd) {
            const key = toDateKey(cur);
            if (key !== baseKey) occurrences.push({ kind, item, dateKey: key });
            cur.setDate(cur.getDate() + 7);
          }
        }
      });

      return occurrences
        .filter(({ item }) => (item.journey_id ?? item.appointment_id) != null)
        // my_status는 "오늘 시점" 상태만 담고 있어 오늘 occurrence에만 적용 —
        // 반복 알람의 미래 occurrence까지 같이 걸러지면 안 된다.
        .filter(({ item, dateKey }) => !(dateKey === todayStr && item.my_status === 'ARRIVED'))
        .sort((a, b) => (a.dateKey !== b.dateKey
          ? a.dateKey.localeCompare(b.dateKey)
          : upcomingSortValue(a.item.target_time) - upcomingSortValue(b.item.target_time)))
        .map(({ kind, item, dateKey }) => ({
          id: `${kind}-${item.journey_id ?? item.appointment_id}-${dateKey}`,
          kind,
          targetId: (item.journey_id ?? item.appointment_id) as number,
          title: item.dest_name,
          meta: formatUpcomingMeta(kind, dateKey, item.target_time, item.is_last_mode, !!item.repeat_days),
          dday: dateKey === todayStr ? 'D-DAY' : `D-${diffDays(dateKey)}`,
          color: KIND_META[kind].color,
          bg: KIND_META[kind].bg,
          dateKey,
        }));
    }

    Promise.all([
      alarmsApi.getAlarmsByType('PERSONAL'),
      alarmsApi.getAlarmsByType('GROUP'),
      alarmsApi.getAlarmsByType('HOME'),
    ]).then(([personal, group, home]) => {
      const counts: AlarmCountMap = {};
      (personal.data ?? []).forEach((a) => expandAlarm(a.plan_date, a.repeat_days, 'personal', counts));
      (group.data ?? []).forEach((a) => expandAlarm(a.plan_date, a.repeat_days, 'group', counts));
      (home.data ?? []).forEach((a) => expandAlarm(a.plan_date, a.repeat_days, 'home', counts));
      setAlarmCounts(counts);

      setUpcoming(buildUpcoming([
        ...(personal.data ?? []).map((item) => ({ kind: 'personal' as const, item })),
        ...(group.data ?? []).map((item) => ({ kind: 'group' as const, item })),
        ...(home.data ?? []).map((item) => ({ kind: 'home' as const, item })),
      ]));
    }).catch(() => {});
  }, [alarmVersion, todayStr]);

  useEffect(() => {
    fetchHolidays(selectedYear, selectedMonth).then((holidays) => {
      const map: EventMap = {};
      holidays.forEach((h) => {
        const dateStr = locdateToString(h.locdate);
        map[dateStr] = [{ label: h.dateName, color: '#FF453A' }];
      });
      setEvents((prev) => ({ ...prev, ...map }));
    });
  }, [selectedYear, selectedMonth]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) {
      containerHeightRef.current = h;
      setContainerHeight(h);
    }
  }, []);

  // onMomentumScrollEnd(관성까지 완전히 멈춘 뒤 발동) 대신 onViewableItemsChanged를 쓴다 —
  // 다음 달이 화면에 51% 이상 보이는 순간 바로 발동해서(전환 애니메이션이 채 끝나기 전) 상단
  // 월 표시/건수 갱신이 스와이프 동작과 훨씬 가깝게 맞아떨어진다(2026-08-24, "숫자가 한 템포
  // 늦게 바뀐다" 피드백으로 발견).
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: Array<{ item: number; isViewable: boolean }> }) => {
    const visible = viewableItems.find((v) => v.isViewable);
    if (visible == null) return;
    const { year, month } = getYearMonthFromIndex(today.getFullYear(), today.getMonth() + 1, visible.item);
    // pagingEnabled로 FlatList가 이미 정확한 위치로 스냅되는 중이라, 여기서 비롯된 변경은 보정
    // 스크롤이 필요 없다(오직 실제로 달이 바뀔 때만 표시해서, 값이 그대로일 때 플래그가
    // 잘못 남아 다음 버튼 조작의 정상 보정을 막지 않게 한다).
    if (year !== selectedYear || month !== selectedMonth) {
      skipPendingScrollRef.current = true;
    }
    setYearMonth(year, month);
    isAtTodayRef.current = year === today.getFullYear() && month === today.getMonth() + 1;
  }, [selectedYear, selectedMonth]);

  const goToToday = useCallback(() => {
    if (isAtTodayRef.current) {
      router.push('/daily-alarm');
    } else {
      setYearMonth(today.getFullYear(), today.getMonth() + 1);
      setSelectedDate(todayStr);
      isAtTodayRef.current = true;
    }
  }, [todayStr]);

  // 앱 최상위(탭) 화면에서 뒤로가기를 누르면 원래도 조용히 백그라운드로 내려갈 뿐 프로세스가
  // 죽지는 않는다(BackHandler 커스텀 없이 안드로이드 기본 동작) — 다만 사용자에게 그 사실이
  // 안 보여서 "꺼진 건가?" 헷갈릴 수 있어, 한 번은 안내만 하고 실제 동작(백그라운드 전환)은
  // 그대로 둔다. useFocusEffect로 이 탭이 실제 최상단일 때만 리스너를 걸어야, daily-alarm 등
  // 위에 쌓인 화면에서 누르는 뒤로가기(정상적인 화면 pop)까지 이 로직이 가로채지 않는다.
  //
  // 하단바(개인/그룹/귀가/설정) 버튼은 새 화면으로 이동하는 게 아니라 이 화면 위에 바텀시트를
  // 띄우는 것뿐이라 내비게이션 스택은 그대로다 — 그래서 시트가 열려있는 채로 뒤로가기를 누르면
  // (시트를 안 닫고) 곧장 종료 안내가 뜨는 게 비직관적이었다(2026-08-25 발견). 열린 시트가
  // 있으면 그 시트부터 닫고, 아무 시트도 없을 때만 종료 안내 로직을 탄다. 가장 위에 겹쳐 뜨는
  // 도착 대시보드(그룹 시트 위)부터 먼저 검사해야 한 번 누를 때마다 가장 바깥 레이어부터 닫힌다.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (showArrivalSheet) { setShowArrivalSheet(false); return true; }
        if (showSettings) { setShowSettings(false); return true; }
        if (showPersonalSheet) { setShowPersonalSheet(false); return true; }
        if (showGroupSheet) { setShowGroupSheet(false); return true; }
        if (showHomeSheet) { setShowHomeSheet(false); return true; }

        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          return false; // 기본 동작(백그라운드 전환) 허용
        }
        lastBackPressRef.current = now;
        ToastAndroid.show('한 번 더 누르면 종료됩니다', ToastAndroid.SHORT);
        return true; // 이번 뒤로가기는 소비 — 기본 동작을 1회 막음
      });
      return () => sub.remove();
    }, [showArrivalSheet, showSettings, showPersonalSheet, showGroupSheet, showHomeSheet])
  );

  const renderItem = useCallback(({ item }: { item: number }) => {
    const { year, month } = getYearMonthFromIndex(today.getFullYear(), today.getMonth() + 1, item);
    return (
      <CalendarMonth
        year={year}
        month={month}
        todayStr={todayStr}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onDayPress={(date) => {
          // 상태 갱신과 네비게이션을 같은 틱에서 동시에 실행하면 전환 애니메이션 도중 두 화면이
          // 동시에 리렌더링되면서 Fabric이 크래시할 수 있다("View already has a parent",
          // daily-alarm 쪽 뒤로가기 버튼에서 실기기로 확인된 것과 동일한 패턴) — 네비게이션을
          // 먼저 보내고 상태 갱신은 전환이 끝난 뒤로 미룬다.
          router.push('/daily-alarm');
          InteractionManager.runAfterInteractions(() => setSelectedDate(date));
        }}
        containerHeight={containerHeight}
        events={events}
        alarmCounts={alarmCounts}
      />
    );
  }, [containerHeight, events, alarmCounts, selectedDate, todayStr]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.monthNav}>
          <TouchableOpacity style={styles.monthNavBtn} onPress={goPrevMonth} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color="#1A1A1A" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/year-calendar')}>
            <Text style={styles.monthNavText}>{selectedYear}년 {selectedMonth}월</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.monthNavBtn} onPress={goNextMonth} hitSlop={8}>
            <Ionicons name="chevron-forward" size={18} color="#1A1A1A" />
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.devToolBtn} onPress={() => router.push('/alarm-test' as any)}>
            <Feather name="tool" size={14} color="#888888" />
          </TouchableOpacity>
          <View style={styles.headerIconPill}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.push('/home-address')}>
              <Feather name="home" size={18} color="#1A1A1A" />
            </TouchableOpacity>
            <View style={styles.headerIconDivider} />
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.push('/profile-settings')}>
              <Feather name="user" size={18} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <View style={styles.statLabelRow}>
            <View style={[styles.statDot, { backgroundColor: '#0A84FF' }]} />
            <Text style={styles.statLabel}>개인</Text>
          </View>
          <Text style={styles.statCount}>{monthStats.personal}<Text style={styles.statUnit}> 건</Text></Text>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statLabelRow}>
            <View style={[styles.statDot, { backgroundColor: '#FF9F0A' }]} />
            <Text style={styles.statLabel}>그룹</Text>
          </View>
          <Text style={styles.statCount}>{monthStats.group}<Text style={styles.statUnit}> 건</Text></Text>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statLabelRow}>
            <View style={[styles.statDot, { backgroundColor: '#30D158' }]} />
            <Text style={styles.statLabel}>귀가</Text>
          </View>
          <Text style={styles.statCount}>{monthStats.home}<Text style={styles.statUnit}> 건</Text></Text>
        </View>
      </View>

      <View style={styles.calendarArea} onLayout={onLayout}>
        {containerHeight > 0 && (
          <FlatList
            ref={flatListRef}
            data={months}
            keyExtractor={(item) => String(item)}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            initialScrollIndex={Math.max(0, Math.min(TOTAL_MONTHS - 1, currentIndex))}
            getItemLayout={(_, index) => ({
              length: containerHeight,
              offset: containerHeight * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={MONTH_VIEWABILITY_CONFIG}
            renderItem={renderItem}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews
          />
        )}
      </View>

      <View style={styles.upcomingSection}>
        <Text style={styles.upcomingTitle}>다가오는 일정 <Text style={styles.upcomingTitleSub}>(7일 이내)</Text></Text>
        {upcoming.length === 0 ? (
          <Text style={styles.upcomingEmpty}>다가오는 일정이 없어요</Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {upcoming.map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.upcomingCard}
                activeOpacity={0.7}
                onPress={() => {
                  // 전체 관리 리스트로 바로 점프하는 대신 날짜별 리스트를 거쳐 수정 화면으로
                  // 이동한다 — 그 날의 다른 알람도 같이 보여주고, 카드 탭과 동일한 수정 시트
                  // 경로를 재사용해서 전체 관리 리스트가 잠깐 보였다 사라지는 깜빡임도 없앤다.
                  // 네비게이션과 상태 갱신을 같은 틱에 함께 실행하면 Fabric 크래시 위험이 있어
                  // (daily-alarm.tsx 뒤로가기 버튼과 동일 패턴) 순서를 분리한다.
                  router.push({ pathname: '/daily-alarm', params: { editKind: u.kind, editId: String(u.targetId) } } as Href);
                  InteractionManager.runAfterInteractions(() => setSelectedDate(u.dateKey));
                }}
              >
                <View style={[styles.upcomingIconChip, { backgroundColor: u.bg }]}>
                  <Feather name={KIND_META[u.kind].icon} size={17} color={u.color} />
                </View>
                <View style={styles.upcomingInfo}>
                  <Text style={styles.upcomingCardTitle} numberOfLines={1}>{u.title}</Text>
                  <Text style={styles.upcomingMeta}>{u.meta}</Text>
                </View>
                <View style={[styles.ddayBadge, { backgroundColor: u.bg }]}>
                  <Text style={[styles.ddayText, { color: u.color }]}>{u.dday}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.todayBtn} onPress={goToToday} activeOpacity={0.7}>
          <Text style={styles.todayBtnNum}>{today.getDate()}</Text>
          <Text style={styles.todayBtnLabel}>오늘</Text>
        </TouchableOpacity>
        <View style={styles.rightBtns}>
          {/* 개인 */}
          <TouchableOpacity style={styles.rightBtn} onPress={() => setShowPersonalSheet(true)} activeOpacity={0.7}>
            <Feather name="user" size={24} color="#0A84FF" />
            <Text style={[styles.rightBtnLabel, { color: '#0A84FF' }]}>개인</Text>
          </TouchableOpacity>
          {/* 그룹 */}
          <TouchableOpacity style={styles.rightBtn} onPress={() => setShowGroupSheet(true)} activeOpacity={0.7}>
            <Feather name="users" size={24} color="#8A8A8E" />
            <Text style={styles.rightBtnLabel}>그룹</Text>
          </TouchableOpacity>
          {/* 귀가 */}
          <TouchableOpacity style={styles.rightBtn} onPress={() => setShowHomeSheet(true)} activeOpacity={0.7}>
            <Feather name="navigation" size={24} color="#8A8A8E" />
            <Text style={styles.rightBtnLabel}>귀가</Text>
          </TouchableOpacity>
          {/* 설정 */}
          <TouchableOpacity style={styles.rightBtn} onPress={() => setShowSettings(true)} activeOpacity={0.7}>
            <Feather name="settings" size={24} color="#8A8A8E" />
            <Text style={styles.rightBtnLabel}>설정</Text>
          </TouchableOpacity>
        </View>
      </View>

      {showSettings && (
        <AlarmSettingsSheet
          onClose={() => setShowSettings(false)}
          onSave={() => {}}
        />
      )}
      {showPersonalSheet && (
        <PersonalAllAlarmSheet
          onClose={() => setShowPersonalSheet(false)}
        />
      )}
      {showGroupSheet && (
        <GroupAllAlarmSheet
          onClose={() => setShowGroupSheet(false)}
          onArrivalPress={(alarm) => {
            setSelectedGroupAlarm(alarm);
            setShowArrivalSheet(true);
          }}
        />
      )}
      {showHomeSheet && (
        <HomeAllAlarmSheet
          onClose={() => setShowHomeSheet(false)}
        />
      )}
      {showArrivalSheet && selectedGroupAlarm?.appointmentId && (
        <ArrivalDashboardSheet
          onClose={() => setShowArrivalSheet(false)}
          appointmentId={selectedGroupAlarm.appointmentId}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#F0F0F0', paddingHorizontal: 6, paddingVertical: 6, borderRadius: 20 },
  monthNavBtn: { padding: 6 },
  monthNavText: { fontSize: 16, fontWeight: '700', color: '#1A1A1A', paddingHorizontal: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  devToolBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  headerIconPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F0F0', borderRadius: 20, overflow: 'hidden' },
  headerIconBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  headerIconDivider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: '#CCCCCC' },
  calendarArea: { height: 380 },
  statRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  statCard: { flex: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'space-between', backgroundColor: '#F7F7F8' },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statDot: { width: 7, height: 7, borderRadius: 4 },
  statLabel: { fontSize: 12, fontWeight: '600' },
  statCount: { fontSize: 19, fontWeight: '800', marginTop: 4 },
  statUnit: { fontSize: 12, fontWeight: '500' },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: 4, alignItems: 'center' },
  weekdayText: { width: DAY_WIDTH, textAlign: 'center', fontSize: 12, fontWeight: '500', color: '#AAAAAA' },
  sundayText: { color: '#FF453A' },
  saturdayText: { color: '#0A84FF' },
  weekRow: { flexDirection: 'row' },
  weekBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E0' },
  dayCell: { width: DAY_WIDTH, paddingTop: 4, alignItems: 'center' },
  dayNumWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  todayCircle: { backgroundColor: '#FFCE0C' },
  selectedCircle: { backgroundColor: '#1A1A1A' },
  dayNum: { fontSize: 16, fontWeight: '400', color: '#1A1A1A' },
  todayText: { color: '#1A1A1A', fontWeight: '700' },
  selectedText: { color: '#FFFFFF', fontWeight: '700' },
  otherMonthDay: { color: '#C8C8C8' },
  eventBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginTop: 1, maxWidth: DAY_WIDTH - 4, gap: 3 },
  eventDot: { width: 6, height: 6, borderRadius: 3 },
  eventLabel: { fontSize: 9, fontWeight: '500', flexShrink: 1 },
  upcomingSection: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  upcomingTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 },
  upcomingTitleSub: { fontSize: 12, fontWeight: '500', color: '#8A8A8E' },
  upcomingEmpty: { fontSize: 13, color: '#AAAAAA', paddingVertical: 8 },
  upcomingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 10,
    shadowColor: '#141413', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  upcomingIconChip: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  upcomingInfo: { flex: 1, minWidth: 0, gap: 2 },
  upcomingCardTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  upcomingMeta: { fontSize: 12, color: '#8A8A8E' },
  ddayBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  ddayText: { fontSize: 11, fontWeight: '700' },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8E8',
    backgroundColor: '#FFFFFF',
  },
  todayBtn: { alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  todayBtnNum: { fontSize: 20, fontWeight: '300', color: '#FF453A', lineHeight: 24 },
  todayBtnLabel: { fontSize: 11, color: '#FF453A', fontWeight: '500' },
  rightBtns: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  rightBtn: { alignItems: 'center', gap: 4 },
  rightBtnLabel: { fontSize: 10, fontWeight: '600', color: '#8A8A8E' },
  dotRow: { flexDirection: 'row', gap: 3, marginTop: 3, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});