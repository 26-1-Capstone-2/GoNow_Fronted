import { createMembersApi, PriorityType, TransitType } from '@/src/api/members';
import { Feather } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const membersApi = createMembersApi();

interface Props {
  onClose: () => void;
  onSave: () => void;
}

export default function AlarmSettingsSheet({ onClose, onSave }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['88%'], []);

  const [priorityType, setPriorityType] = useState<PriorityType>('MIN_TIME');
  const [transitType, setTransitType] = useState<TransitType>('ALL');
  const [leaveTime, setLeaveTime] = useState(10);
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    membersApi.getMyProfile()
      .then((res) => {
        setPriorityType(res.data.priority_type);
        setTransitType(res.data.transit_type);
        setLeaveTime(res.data.preparation_time);
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await membersApi.updateSetting({
        preparation_time: leaveTime,
        priority_type: priorityType,
        transit_type: transitType,
      });
      onSave();
      onClose();
    } catch {
      Alert.alert('저장 실패', '다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  }, [leaveTime, priorityType, transitType, onSave, onClose]);

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

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
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        {/* 헤더 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Feather name="x" size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.title}>개인설정</Text>
          <TouchableOpacity onPress={handleSave} style={styles.saveBtn} disabled={saving || fetching}>
            {saving
              ? <ActivityIndicator size="small" color="#1A1A1A" />
              : <Feather name="check" size={20} color="#1A1A1A" />
            }
          </TouchableOpacity>
        </View>

        {fetching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#888888" />
          </View>
        ) : (
          <>
            {/* 여유시간 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>여유시간</Text>
              <View style={styles.sectionBox}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>준비 및 여유시간</Text>
                  <View style={styles.timeControl}>
                    <TouchableOpacity
                      onPress={() => setLeaveTime((p) => Math.max(5, p - 5))}
                      style={[styles.timeBtn, leaveTime <= 5 && styles.timeBtnDisabled]}
                      disabled={leaveTime <= 5}
                    >
                      <Feather name="minus" size={16} color={leaveTime <= 5 ? '#CCCCCC' : '#888888'} />
                    </TouchableOpacity>
                    <Text style={styles.timeValue}>{leaveTime}분</Text>
                    <TouchableOpacity
                      onPress={() => setLeaveTime((p) => Math.min(60, p + 5))}
                      style={[styles.timeBtn, leaveTime >= 60 && styles.timeBtnDisabled]}
                      disabled={leaveTime >= 60}
                    >
                      <Feather name="plus" size={16} color={leaveTime >= 60 ? '#CCCCCC' : '#888888'} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>

            {/* 경로 옵션 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>경로 옵션</Text>
              <View style={styles.sectionBox}>
                {(['MIN_TIME', 'MIN_TRANSFER', 'MIN_WALK', 'MIN_WAIT'] as PriorityType[]).map((type, i, arr) => (
                  <View key={type}>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>
                        {type === 'MIN_TIME' ? '최소 시간' : type === 'MIN_TRANSFER' ? '최소 환승' : type === 'MIN_WALK' ? '최소 도보' : '최소 대기'}
                      </Text>
                      <Switch
                        value={priorityType === type}
                        onValueChange={() => setPriorityType(type)}
                        trackColor={{ false: '#E0E0E0', true: '#30D158' }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                    {i < arr.length - 1 && <View style={styles.separator} />}
                  </View>
                ))}
              </View>
            </View>

            {/* 선호 대중교통 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>선호 대중교통</Text>
              <View style={styles.sectionBox}>
                {(['ALL', 'SUBWAY', 'BUS'] as TransitType[]).map((type, i, arr) => (
                  <View key={type}>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>
                        {type === 'SUBWAY' ? '지하철' : type === 'BUS' ? '버스' : '상관없음'}
                      </Text>
                      <Switch
                        value={transitType === type}
                        onValueChange={() => setTransitType(type)}
                        trackColor={{ false: '#E0E0E0', true: '#30D158' }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                    {i < arr.length - 1 && <View style={styles.separator} />}
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  indicator: { backgroundColor: '#DDDDDD', width: 40 },
  background: { backgroundColor: '#FFFFFF', borderRadius: 20 },
  content: { paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  loadingContainer: { flex: 1, alignItems: 'center', paddingTop: 60 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  headerBtn: { padding: 4 },
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFCE0C', alignItems: 'center', justifyContent: 'center',
  },
  section: { paddingHorizontal: 16, marginBottom: 20 },
  sectionTitle: {
    fontSize: 13, fontWeight: '500', color: '#888888',
    marginBottom: 8, marginTop: 4, paddingLeft: 4,
  },
  sectionBox: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 12,
  },
  rowLabel: { fontSize: 15, color: '#1A1A1A', fontWeight: '400' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDDDDD' },
  timeControl: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeBtn: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: '#AAAAAA',
    alignItems: 'center', justifyContent: 'center',
  },
  timeBtnDisabled: { borderColor: '#DDDDDD' },
  timeValue: {
    fontSize: 15, fontWeight: '500', color: '#555555',
    minWidth: 36, textAlign: 'center',
  },
});
