import { Feather } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const DAYS = ['일요일마다', '월요일마다', '화요일마다', '수요일마다', '목요일마다', '금요일마다', '토요일마다', '안함'];

interface Alarm {
  id?: string;
  ampm: string;
  hour: string;
  minute: string;
  place: string;
  repeat: string;
}

interface Props {
  onClose: () => void;
  onSave: (alarm: Alarm) => void;
  onDelete?: () => void;
  initialData?: Alarm; // 수정 모드일 때 기존 데이터
}

const DEFAULT_ALARM: Alarm = {
  ampm: '오후',
  hour: '3',
  minute: '00',
  place: '중앙대학교 후문 입구',
  repeat: '안함',
};

export default function PersonalAlarmEditSheet({ onClose, onSave, onDelete, initialData }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['88%'], []);
  const isEditMode = !!initialData?.id;

  const [alarm, setAlarm] = useState<Alarm>(initialData ?? DEFAULT_ALARM);

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const toggleAmPm = () => {
    setAlarm((prev) => ({ ...prev, ampm: prev.ampm === '오전' ? '오후' : '오전' }));
  };

  const incrementHour = () => {
    setAlarm((prev) => {
      const h = parseInt(prev.hour);
      return { ...prev, hour: String(h >= 12 ? 1 : h + 1) };
    });
  };

  const decrementHour = () => {
    setAlarm((prev) => {
      const h = parseInt(prev.hour);
      return { ...prev, hour: String(h <= 1 ? 12 : h - 1) };
    });
  };

  const incrementMinute = () => {
    setAlarm((prev) => {
      const m = parseInt(prev.minute);
      const next = m >= 55 ? 0 : m + 5;
      return { ...prev, minute: String(next).padStart(2, '0') };
    });
  };

  const decrementMinute = () => {
    setAlarm((prev) => {
      const m = parseInt(prev.minute);
      const next = m <= 0 ? 55 : m - 5;
      return { ...prev, minute: String(next).padStart(2, '0') };
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
      handleIndicatorStyle={styles.indicator}
      backgroundStyle={styles.background}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
          <Feather name="x" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={() => onSave(alarm)}>
          <Feather name="check" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <BottomSheetScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 시간 선택 */}
        <View style={styles.timeContainer}>
          <TouchableOpacity onPress={toggleAmPm}>
            <Text style={styles.ampm}>{alarm.ampm}</Text>
          </TouchableOpacity>
          <View style={styles.timePicker}>
            {/* 시 */}
            <TouchableOpacity onPress={incrementHour} onLongPress={decrementHour}>
              <Text style={styles.timeText}>{alarm.hour}</Text>
            </TouchableOpacity>
            <Text style={styles.timeSeparator}> : </Text>
            {/* 분 */}
            <TouchableOpacity onPress={incrementMinute} onLongPress={decrementMinute}>
              <Text style={styles.timeText}>{alarm.minute}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 목적지 */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.rowBox}>
            <Text style={styles.rowLabel}>목적지</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{alarm.place}</Text>
          </TouchableOpacity>
        </View>

        {/* 반복 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>반복</Text>
          <View style={styles.repeatBox}>
            {DAYS.map((day, index) => (
              <View key={day}>
                <TouchableOpacity
                  style={styles.repeatRow}
                  onPress={() => setAlarm((prev) => ({ ...prev, repeat: day }))}
                >
                  <Text style={styles.repeatLabel}>{day}</Text>
                  {alarm.repeat === day && (
                    <Feather name="check" size={16} color="#30D158" />
                  )}
                </TouchableOpacity>
                {index < DAYS.length - 1 && <View style={styles.separator} />}
              </View>
            ))}
          </View>
        </View>

        {/* 알람삭제 버튼 — 수정 모드일 때만 */}
        {isEditMode && onDelete && (
          <View style={styles.deleteContainer}>
            <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
              <Text style={styles.deleteButtonText}>알람삭제</Text>
            </TouchableOpacity>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  indicator: {
    backgroundColor: '#DDDDDD',
    width: 40,
  },
  background: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  timeContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  ampm: {
    fontSize: 16,
    fontWeight: '400',
    color: '#888888',
    marginBottom: 8,
  },
  timePicker: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 64,
    fontWeight: '300',
    color: '#1A1A1A',
    letterSpacing: -2,
    minWidth: 80,
    textAlign: 'center',
  },
  timeSeparator: {
    fontSize: 48,
    fontWeight: '300',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  rowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#888888',
  },
  rowValue: {
    fontSize: 14,
    color: '#1A1A1A',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  repeatBox: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  repeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  repeatLabel: {
    fontSize: 15,
    color: '#1A1A1A',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#DDDDDD',
  },
  deleteContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  deleteButton: {
    backgroundColor: '#FF453A',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});