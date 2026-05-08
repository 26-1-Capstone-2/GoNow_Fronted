import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function getCalendarWeeks(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();
  const days: { date: number; kind: 'prev' | 'cur' | 'next'; fullDate: string }[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    days.push({ date: d, kind: 'prev', fullDate: `${py}-${String(pm).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ date: i, kind: 'cur', fullDate: `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
  }
  const remaining = (7 - (days.length % 7)) % 7;
  const nm = month === 12 ? 1 : month + 1;
  const ny = month === 12 ? year + 1 : year;
  for (let i = 1; i <= remaining; i++) {
    days.push({ date: i, kind: 'next', fullDate: `${ny}-${String(nm).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
  }

  const weeks: (typeof days)[] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

interface Props {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export default function MiniCalendar({ selectedDate, onSelectDate }: Props) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const initYear = selectedDate ? parseInt(selectedDate.split('-')[0]) : today.getFullYear();
  const initMonth = selectedDate ? parseInt(selectedDate.split('-')[1]) : today.getMonth() + 1;

  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);

  const weeks = getCalendarWeeks(year, month);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  return (
    <View style={styles.container}>
      <View style={styles.monthHeader}>
        <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
          <Feather name="chevron-left" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{year}년 {month}월</Text>
        <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
          <Feather name="chevron-right" size={22} color="#1A1A1A" />
        </TouchableOpacity>
      </View>

      <View style={styles.weekdayRow}>
        {DAYS.map((d, i) => (
          <Text key={d} style={[styles.weekdayText, i === 0 && styles.sundayText, i === 6 && styles.saturdayText]}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((day, di) => {
            const isToday = day.fullDate === todayStr;
            const isSelected = day.fullDate === selectedDate;
            const isCur = day.kind === 'cur';
            return (
              <TouchableOpacity
                key={di}
                style={styles.dayCell}
                onPress={() => { if (isCur) onSelectDate(day.fullDate); }}
                activeOpacity={isCur ? 0.7 : 1}
              >
                <View style={[
                  styles.dayNumWrap,
                  isToday && styles.todayCircle,
                  isSelected && !isToday && styles.selectedCircle,
                ]}>
                  <Text style={[
                    styles.dayNum,
                    !isCur && styles.otherMonthDay,
                    isToday && styles.todayDayText,
                    isSelected && !isToday && styles.selectedDayText,
                    di === 0 && isCur && !isToday && !isSelected && styles.sundayText,
                    di === 6 && isCur && !isToday && !isSelected && styles.saturdayText,
                  ]}>
                    {day.date}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 12 },
  monthHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  navBtn: { padding: 8 },
  monthTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekdayText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '500', color: '#AAAAAA' },
  sundayText: { color: '#FF3B30' },
  saturdayText: { color: '#007AFF' },
  weekRow: { flexDirection: 'row' },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayNumWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  todayCircle: { backgroundColor: '#FF3B30' },
  selectedCircle: { backgroundColor: '#1A1A1A' },
  dayNum: { fontSize: 15, fontWeight: '400', color: '#1A1A1A' },
  todayDayText: { color: '#FFFFFF', fontWeight: '700' },
  selectedDayText: { color: '#FFFFFF', fontWeight: '700' },
  otherMonthDay: { color: '#C8C8C8' },
});
