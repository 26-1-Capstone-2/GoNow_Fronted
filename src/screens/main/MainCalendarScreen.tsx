import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAllAlarmSheet from '@/src/screens/allAlarmManage/GroupAllAlarmSheet';
import HomeAllAlarmSheet from '@/src/screens/allAlarmManage/HomeAllAlarmSheet';
import PersonalAllAlarmSheet from '@/src/screens/allAlarmManage/PersonalAllAlarmSheet';
import AlarmSettingsSheet from '@/src/screens/main/AlarmSettingsSheet';
import { AlarmItem, createAlarmsApi } from '@/src/api/alarms';
import { targetTimeToAmpmHourMinute } from '@/src/api/journeys';
import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
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
}

const KIND_META: Record<AlarmKind, { label: string; color: string; bg: string }> = {
  personal: { label: '개인', color: '#0A84FF', bg: '#EAF3FF' },
  group: { label: '그룹', color: '#FF9F0A', bg: '#FFF3E5' },
  home: { label: '귀가', color: '#30D158', bg: '#EAF9EE' },
};

function getOffsetFromBase(baseYear: number, baseMonth: number, targetYear: number, targetMonth: number) {
  return (targetYear - baseYear) * 12 + (targetMonth - baseMonth);
}

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
  const [personalEditId, setPersonalEditId] = useState<number | undefined>(undefined);
  const [groupEditId, setGroupEditId] = useState<number | undefined>(undefined);
  const [homeEditId, setHomeEditId] = useState<number | undefined>(undefined);
  const [showArrivalSheet, setShowArrivalSheet] = useState(false);
  const [selectedGroupAlarm, setSelectedGroupAlarm] = useState<any>(null);
  const [events, setEvents] = useState<EventMap>({});
  const [alarmCounts, setAlarmCounts] = useState<AlarmCountMap>({});
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const isAtTodayRef = useRef(true);
  const isMountedRef = useRef(false);
  const pendingScrollRef = useRef(false);
  const containerHeightRef = useRef(0);
  const prevContainerHeightRef = useRef(0);

  const currentIndex = CENTER_INDEX + getOffsetFromBase(
    today.getFullYear(), today.getMonth() + 1,
    selectedYear, selectedMonth
  );

  const months = Array.from({ length: TOTAL_MONTHS }, (_, i) => i);

  const monthStats = (() => {
    const stats = { personal: 0, group: 0, home: 0 };
    getCalendarWeeks(selectedYear, selectedMonth).forEach((week) => week.forEach((day) => {
      if (day.month !== 'cur') return;
      const c = alarmCounts[day.fullDate];
      if (c) { stats.personal += c.personal; stats.group += c.group; stats.home += c.home; }
    }));
    return stats;
  })();

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

      // 반복 알람: plan_date(생성일)는 무조건 카운트
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

    function formatUpcomingMeta(kind: AlarmKind, planDate: string, targetTime: string): string {
      const { ampm, hour, minute } = targetTimeToAmpmHourMinute(targetTime);
      const dateLabel = planDate === todayStr
        ? '오늘'
        : (() => { const d = new Date(planDate + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}`; })();
      return `${KIND_META[kind].label} · ${dateLabel} ${ampm} ${hour}:${minute}`;
    }

    function buildUpcoming(items: { kind: AlarmKind; item: AlarmItem }[]): UpcomingItem[] {
      return items
        .map(({ kind, item }) => ({ kind, item, dateKey: item.plan_date.split('T')[0] }))
        .filter(({ dateKey }) => dateKey >= todayStr && diffDays(dateKey) <= 7)
        .filter(({ item }) => (item.journey_id ?? item.appointment_id) != null)
        .sort((a, b) => (a.dateKey !== b.dateKey
          ? a.dateKey.localeCompare(b.dateKey)
          : a.item.target_time.localeCompare(b.item.target_time)))
        .map(({ kind, item, dateKey }) => ({
          id: `${kind}-${item.journey_id ?? item.appointment_id}`,
          kind,
          targetId: (item.journey_id ?? item.appointment_id) as number,
          title: item.dest_name,
          meta: formatUpcomingMeta(kind, dateKey, item.target_time),
          dday: dateKey === todayStr ? 'D-DAY' : `D-${diffDays(dateKey)}`,
          color: KIND_META[kind].color,
          bg: KIND_META[kind].bg,
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

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (containerHeight === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.y / containerHeight);
    const { year, month } = getYearMonthFromIndex(today.getFullYear(), today.getMonth() + 1, index);
    setYearMonth(year, month);
    isAtTodayRef.current = year === today.getFullYear() && month === today.getMonth() + 1;
  }, [containerHeight]);

  const goToToday = useCallback(() => {
    if (isAtTodayRef.current) {
      router.push('/daily-alarm');
    } else {
      setYearMonth(today.getFullYear(), today.getMonth() + 1);
      setSelectedDate(todayStr);
      isAtTodayRef.current = true;
    }
  }, [todayStr]);

  const renderItem = useCallback(({ item }: { item: number }) => {
    const { year, month } = getYearMonthFromIndex(today.getFullYear(), today.getMonth() + 1, item);
    return (
      <CalendarMonth
        year={year}
        month={month}
        todayStr={todayStr}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onDayPress={(date) => { setSelectedDate(date); router.push('/daily-alarm'); }}
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
            onMomentumScrollEnd={onMomentumScrollEnd}
            renderItem={renderItem}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews
          />
        )}
      </View>

      <View style={styles.upcomingSection}>
        <Text style={styles.upcomingTitle}>다가오는 일정</Text>
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
                  if (u.kind === 'personal') { setPersonalEditId(u.targetId); setShowPersonalSheet(true); }
                  else if (u.kind === 'group') { setGroupEditId(u.targetId); setShowGroupSheet(true); }
                  else { setHomeEditId(u.targetId); setShowHomeSheet(true); }
                }}
              >
                <View style={[styles.upcomingIconChip, { backgroundColor: u.bg }]}>
                  <Feather name="map-pin" size={17} color={u.color} />
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
          onClose={() => { setShowPersonalSheet(false); setPersonalEditId(undefined); }}
          initialEditId={personalEditId}
        />
      )}
      {showGroupSheet && (
        <GroupAllAlarmSheet
          onClose={() => { setShowGroupSheet(false); setGroupEditId(undefined); }}
          initialEditId={groupEditId}
          onArrivalPress={(alarm) => {
            setSelectedGroupAlarm(alarm);
            setShowArrivalSheet(true);
          }}
        />
      )}
      {showHomeSheet && (
        <HomeAllAlarmSheet
          onClose={() => { setShowHomeSheet(false); setHomeEditId(undefined); }}
          initialEditId={homeEditId}
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