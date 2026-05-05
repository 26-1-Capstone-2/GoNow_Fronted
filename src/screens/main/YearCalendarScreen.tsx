import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
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
  View
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COL_GAP = 12;
const H_PADDING = 16;
const MONTH_WIDTH = (SCREEN_WIDTH - H_PADDING * 2 - COL_GAP * 2) / 3;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const TOTAL_YEARS = 21;
const CENTER_INDEX = 10;

function getCalendarWeeks(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: { date: number; cur: boolean }[] = [];

  for (let i = 0; i < firstDay; i++) days.push({ date: 0, cur: false });
  for (let i = 1; i <= daysInMonth; i++) days.push({ date: i, cur: true });

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    while (week.length < 7) week.push({ date: 0, cur: false });
    weeks.push(week);
  }
  return weeks;
}

const MiniMonth = memo(function MiniMonth({
  year, month, todayYear, todayMonth, todayDate, daySize, onPress,
}: {
  year: number; month: number; todayYear: number; todayMonth: number;
  todayDate: number; daySize: number; onPress: () => void;
}) {
  const weeks = getCalendarWeeks(year, month);
  const isCurrentMonth = year === todayYear && month === todayMonth;

  return (
    <TouchableOpacity style={[styles.miniMonth, { width: MONTH_WIDTH }]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.miniMonthTitle, isCurrentMonth && styles.currentMonthTitle]}>
        {month}월
      </Text>
      <View style={styles.miniWeekdayRow}>
        {DAYS.map((d, i) => (
          <Text key={d} style={[
            { width: daySize, textAlign: 'center', fontSize: 8, color: '#AAAAAA', fontWeight: '500' },
            i === 0 && styles.sundayText,
            i === 6 && styles.saturdayText,
          ]}>
            {d}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row' }}>
          {week.map((day, di) => {
            const isToday = isCurrentMonth && day.date === todayDate;
            return (
              <View key={di} style={{ width: daySize, height: daySize, alignItems: 'center', justifyContent: 'center' }}>
                {day.cur && (
                  <View style={[
                    { width: daySize, height: daySize, alignItems: 'center', justifyContent: 'center', borderRadius: daySize / 2 },
                    isToday && styles.todayCircle,
                  ]}>
                    <Text style={[
                      styles.miniDayNum,
                      isToday && styles.todayText,
                      di === 0 && !isToday && styles.sundayText,
                      di === 6 && !isToday && styles.saturdayText,
                    ]}>
                      {day.date}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </TouchableOpacity>
  );
});

const YearPage = memo(function YearPage({
  year, todayYear, todayMonth, todayDate, containerHeight, onMonthPress,
}: {
  year: number; todayYear: number; todayMonth: number; todayDate: number;
  containerHeight: number; onMonthPress: (year: number, month: number) => void;
}) {
  const YEAR_TITLE_H = 60;
  const AVAILABLE_H = containerHeight - YEAR_TITLE_H;
  const ROW_H = Math.floor(AVAILABLE_H / 4);
  const MONTH_INNER_H = ROW_H - 8;
  const DAY_SIZE = Math.floor(Math.min(MONTH_WIDTH / 7, (MONTH_INNER_H - 28) / 6));
  const monthRows = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];

  return (
    <View style={{ width: SCREEN_WIDTH, height: containerHeight }}>
      <View style={{ height: YEAR_TITLE_H, justifyContent: 'flex-end', paddingHorizontal: H_PADDING, paddingBottom: 8 }}>
        <Text style={styles.yearTitle}>{year}년</Text>
      </View>
      {monthRows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', height: ROW_H, paddingHorizontal: H_PADDING, gap: COL_GAP }}>
          {row.map((month) => (
            <MiniMonth
              key={month}
              year={year}
              month={month}
              todayYear={todayYear}
              todayMonth={todayMonth}
              todayDate={todayDate}
              daySize={DAY_SIZE}
              onPress={() => onMonthPress(year, month)}
            />
          ))}
        </View>
      ))}
    </View>
  );
});

export default function YearCalendarScreen() {
  const today = new Date();
  const router = useRouter();
  const { setYearMonth } = useCalendarStore();

  const [currentIndex, setCurrentIndex] = useState(CENTER_INDEX);
  const [containerHeight, setContainerHeight] = useState(0);
  const isAtTodayRef = useRef(true);
  const isMountedRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);

  const years = Array.from({ length: TOTAL_YEARS }, (_, i) => i);

  // containerHeight 확정 후 정확한 위치로 이동
  useEffect(() => {
    if (containerHeight === 0) return;
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToIndex({ index: CENTER_INDEX, animated: false });
      });
    }
  }, [containerHeight]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setContainerHeight(h);
  }, []);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (containerHeight === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.y / containerHeight);
    setCurrentIndex(index);
    isAtTodayRef.current = index === CENTER_INDEX;
  }, [containerHeight]);

  const handleMonthPress = useCallback((year: number, month: number) => {
    setYearMonth(year, month);
    router.back();
  }, []);

  const goToToday = useCallback(() => {
    if (isAtTodayRef.current) {
      setYearMonth(today.getFullYear(), today.getMonth() + 1);
      router.back();
    } else {
      flatListRef.current?.scrollToIndex({ index: CENTER_INDEX, animated: true });
      setCurrentIndex(CENTER_INDEX);
      isAtTodayRef.current = true;
    }
  }, []);

  const renderItem = useCallback(({ item }: { item: number }) => {
    const y = today.getFullYear() - CENTER_INDEX + item;
    return (
      <YearPage
        year={y}
        todayYear={today.getFullYear()}
        todayMonth={today.getMonth() + 1}
        todayDate={today.getDate()}
        containerHeight={containerHeight}
        onMonthPress={handleMonthPress}
      />
    );
  }, [containerHeight, handleMonthPress]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }} />
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.headerIcon} onPress={() => router.push('/home-address')}>
            <Feather name="home" size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIcon} onPress={() => router.push('/profile-settings')}>
            <Feather name="user" size={22} color="#1A1A1A" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.calendarArea} onLayout={onLayout}>
        {containerHeight > 0 && (
          <FlatList
            ref={flatListRef}
            data={years}
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
            renderItem={renderItem}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews
          />
        )}
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.todayBtn} onPress={goToToday} activeOpacity={0.7}>
          <Text style={styles.todayBtnNum}>{today.getDate()}</Text>
          <Text style={styles.todayBtnLabel}>오늘</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerIcons: { flexDirection: 'row', gap: 16 },
  headerIcon: { padding: 4 },
  calendarArea: { flex: 1 },
  yearTitle: { fontSize: 36, fontWeight: '800', color: '#FF3B30' },
  miniMonth: { flex: 1 },
  miniMonthTitle: { fontSize: 12, fontWeight: '700', color: '#1A1A1A', marginBottom: 3 },
  currentMonthTitle: { color: '#FF3B30' },
  miniWeekdayRow: { flexDirection: 'row', marginBottom: 1 },
  sundayText: { color: '#FF3B30' },
  saturdayText: { color: '#007AFF' },
  todayCircle: { backgroundColor: '#FF3B30' },
  miniDayNum: { fontSize: 9, color: '#1A1A1A', fontWeight: '400' },
  todayText: { color: '#FFFFFF', fontWeight: '700' },
  bottomBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8E8',
    backgroundColor: '#FFFFFF',
  },
  todayBtn: { alignItems: 'center', justifyContent: 'center', minWidth: 44, alignSelf: 'flex-start' },
  todayBtnNum: { fontSize: 20, fontWeight: '300', color: '#FF3B30', lineHeight: 24 },
  todayBtnLabel: { fontSize: 11, color: '#FF3B30', fontWeight: '500' },
});