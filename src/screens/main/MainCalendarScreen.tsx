import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DAY_WIDTH = Math.floor(SCREEN_WIDTH / 7);
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const TOTAL_MONTHS = 49;
const CENTER_INDEX = 24;

// ── 공휴일 API ──────────────────────────────────────────
const SERVICE_KEY = 'f72192a95a1f1c519e3d89b202a2e0811505d0fbb33385bc5770a4ec5fa03ba6';
const BASE_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService';

interface Holiday {
  dateName: string;
  locdate: number;
  isHoliday: string;
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
// ────────────────────────────────────────────────────────

type EventMap = Record<string, { label: string; color: string }[]>;

function getYearMonth(baseYear: number, baseMonth: number, offset: number) {
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
  containerHeight: number;
  events: EventMap;
}

function CalendarMonth({ year, month, todayStr, selectedDate, onSelectDate, containerHeight, events }: CalendarMonthProps) {
  const weeks = getCalendarWeeks(year, month);
  const MONTH_TITLE_H = 60;
  const WEEKDAY_H = 32;
  const GRID_H = containerHeight - MONTH_TITLE_H - WEEKDAY_H;
  const ROW_HEIGHT = Math.floor(GRID_H / weeks.length);

  return (
    <View style={{ width: SCREEN_WIDTH, height: containerHeight }}>
      <View style={[styles.monthTitleRow, { height: MONTH_TITLE_H }]}>
        <Text style={styles.monthTitle}>{month}월</Text>
      </View>
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
                  onPress={() => isCur && onSelectDate(day.fullDate)}
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
                  {dayEvents.slice(0, 2).map((ev, ei) => (
                    <View key={ei} style={[styles.eventBadge, { backgroundColor: ev.color + '22' }]}>
                      <View style={[styles.eventDot, { backgroundColor: ev.color }]} />
                      <Text style={[styles.eventLabel, { color: ev.color }]} numberOfLines={1}>{ev.label}</Text>
                    </View>
                  ))}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export default function MainCalendarScreen() {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const router = useRouter();

  const [currentIndex, setCurrentIndex] = useState(CENTER_INDEX);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [containerHeight, setContainerHeight] = useState(0);
  const [events, setEvents] = useState<EventMap>({});
  const flatListRef = useRef<FlatList>(null);

  const { year, month } = getYearMonth(today.getFullYear(), today.getMonth() + 1, currentIndex - CENTER_INDEX);
  const months = Array.from({ length: TOTAL_MONTHS }, (_, i) => i);

  // 월 바뀔 때마다 공휴일 불러오기
  useEffect(() => {
    fetchHolidays(year, month).then((holidays) => {
      const map: EventMap = {};
      holidays.forEach((h) => {
        const dateStr = locdateToString(h.locdate);
        map[dateStr] = [{ label: h.dateName, color: '#FF3B30' }];
      });
      setEvents((prev) => ({ ...prev, ...map }));
    });
  }, [year, month]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setContainerHeight(h);
    if (h > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: CENTER_INDEX, animated: false });
      }, 50);
    }
  }, []);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (containerHeight === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.y / containerHeight);
    setCurrentIndex(index);
  }, [containerHeight]);

  const goToToday = useCallback(() => {
    flatListRef.current?.scrollToIndex({ index: CENTER_INDEX, animated: true });
    setCurrentIndex(CENTER_INDEX);
    setSelectedDate(todayStr);
  }, [todayStr]);

  return (
    <SafeAreaView style={styles.container}>
      {/* 상단 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.yearNav} onPress={goToToday}>
          <Ionicons name="chevron-back" size={18} color="#1A1A1A" />
          <Text style={styles.yearText}>{year}년</Text>
        </TouchableOpacity>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.headerIcon}>
            <Feather name="home" size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIcon}>
            <Feather name="user" size={22} color="#1A1A1A" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 캘린더 영역 */}
      <View style={styles.calendarArea} onLayout={onLayout}>
        {containerHeight > 0 && (
          <FlatList
            ref={flatListRef}
            data={months}
            keyExtractor={(item) => String(item)}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            initialScrollIndex={CENTER_INDEX}
            getItemLayout={(_, index) => ({
              length: containerHeight,
              offset: containerHeight * index,
              index,
            })}
            onMomentumScrollEnd={onMomentumScrollEnd}
            decelerationRate="fast"
            snapToInterval={containerHeight}
            snapToAlignment="start"
            renderItem={({ item }) => {
              const { year: y, month: m } = getYearMonth(
                today.getFullYear(),
                today.getMonth() + 1,
                item - CENTER_INDEX
              );
              return (
                <CalendarMonth
                  year={y}
                  month={m}
                  todayStr={todayStr}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  containerHeight={containerHeight}
                  events={events}
                />
              );
            }}
          />
        )}
      </View>

      {/* 하단 버튼 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.todayBtn} onPress={goToToday} activeOpacity={0.7}>
          <Text style={styles.todayBtnNum}>{today.getDate()}</Text>
          <Text style={styles.todayBtnLabel}>오늘</Text>
        </TouchableOpacity>
        <View style={styles.rightBtns}>
          {[
            { icon: 'user', label: '개인', route: '/personal' },
            { icon: 'users', label: '그룹', route: '/group' },
            { icon: 'navigation', label: '귀가', route: '/home-alarm' },
            { icon: 'settings', label: '설정', route: '/settings' },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.rightBtn}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.7}
            >
              <Feather name={item.icon as any} size={26} color="#444444" />
              <Text style={styles.rightBtnLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
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
  yearNav: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  yearText: { fontSize: 15, fontWeight: '500', color: '#1A1A1A' },
  headerIcons: { flexDirection: 'row', gap: 16 },
  headerIcon: { padding: 4 },
  calendarArea: { flex: 1 },
  monthTitleRow: {
    paddingHorizontal: 20,
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  monthTitle: { fontSize: 34, fontWeight: '800', color: '#1A1A1A' },
  weekdayRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  weekdayText: {
    width: DAY_WIDTH,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: '#AAAAAA',
  },
  sundayText: { color: '#FF3B30' },
  saturdayText: { color: '#007AFF' },
  weekRow: { flexDirection: 'row' },
  weekBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  dayCell: { width: DAY_WIDTH, paddingTop: 4, alignItems: 'center' },
  dayNumWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  todayCircle: { backgroundColor: '#FF3B30' },
  selectedCircle: { backgroundColor: '#1A1A1A' },
  dayNum: { fontSize: 16, fontWeight: '400', color: '#1A1A1A' },
  todayText: { color: '#FFFFFF', fontWeight: '700' },
  selectedText: { color: '#FFFFFF', fontWeight: '700' },
  otherMonthDay: { color: '#C8C8C8' },
  eventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 1,
    maxWidth: DAY_WIDTH - 4,
    gap: 3,
  },
  eventDot: { width: 6, height: 6, borderRadius: 3 },
  eventLabel: { fontSize: 9, fontWeight: '500', flexShrink: 1 },
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
  todayBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
  todayBtnNum: {
    fontSize: 20,
    fontWeight: '300',
    color: '#FF3B30',
    lineHeight: 24,
  },
  todayBtnLabel: {
    fontSize: 11,
    color: '#FF3B30',
    fontWeight: '500',
  },
  rightBtns: {
    flexDirection: 'row',
    gap: 28,
    alignItems: 'center',
  },
  rightBtn: { alignItems: 'center', gap: 3 },
  rightBtnLabel: { fontSize: 10, color: '#444444', fontWeight: '500' },
});