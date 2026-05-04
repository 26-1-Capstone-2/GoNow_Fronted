import { Feather } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Platform,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

interface Props {
  onClose: () => void;
  onSave: (settings: AlarmSettings) => void;
}

interface AlarmSettings {
  fastestRoute: boolean;
  subway: boolean;
  bus: boolean;
  anyTransport: boolean;
  minWalk: boolean;
  minTransfer: boolean;
  anyWalk: boolean;
  leaveTime: number;
}

export default function AlarmSettingsSheet({ onClose, onSave }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  const [settings, setSettings] = useState<AlarmSettings>({
    fastestRoute: false,
    subway: false,
    bus: false,
    anyTransport: true,
    minWalk: false,
    minTransfer: false,
    anyWalk: true,
    leaveTime: 10,
  });

  const handleMinus = () => {
    setSettings((prev) => ({ ...prev, leaveTime: Math.max(5, prev.leaveTime - 5) }));
  };

  const handlePlus = () => {
    setSettings((prev) => ({ ...prev, leaveTime: Math.min(60, prev.leaveTime + 5) }));
  };

  const toggle = (key: keyof AlarmSettings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = useCallback(() => {
    onSave(settings);
    onClose();
  }, [settings]);

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
          <TouchableOpacity onPress={handleSave} style={styles.saveBtn}>
            <Feather name="check" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* 여유시간 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>여유시간</Text>
          <View style={styles.sectionBox}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>준비 및 여유시간</Text>
              <View style={styles.timeControl}>
                <TouchableOpacity
                  onPress={handleMinus}
                  style={[styles.timeBtn, settings.leaveTime <= 5 && styles.timeBtnDisabled]}
                  disabled={settings.leaveTime <= 5}
                >
                  <Feather name="minus" size={16} color={settings.leaveTime <= 5 ? '#CCCCCC' : '#888888'} />
                </TouchableOpacity>
                <Text style={styles.timeValue}>{settings.leaveTime}분</Text>
                <TouchableOpacity
                  onPress={handlePlus}
                  style={[styles.timeBtn, settings.leaveTime >= 60 && styles.timeBtnDisabled]}
                  disabled={settings.leaveTime >= 60}
                >
                  <Feather name="plus" size={16} color={settings.leaveTime >= 60 ? '#CCCCCC' : '#888888'} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
        {/* 제일 빨리 집으로 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>제일 빨리 집으로</Text>
          <View style={styles.sectionBox}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>최단시간</Text>
            <Switch
              value={settings.fastestRoute}
              onValueChange={() => toggle('fastestRoute')}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>
          </View>
        </View>

        {/* 선호 대중교통 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>선호 대중교통</Text>
          <View style={styles.sectionBox}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>지하철</Text>
            <Switch
              value={settings.subway}
              onValueChange={() => toggle('subway')}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>버스</Text>
            <Switch
              value={settings.bus}
              onValueChange={() => toggle('bus')}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>상관없음</Text>
            <Switch
              value={settings.anyTransport}
              onValueChange={() => toggle('anyTransport')}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>
          </View>
        </View>

        {/* 걷기싫어 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>걷기싫어</Text>
          <View style={styles.sectionBox}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>최소 도보</Text>
            <Switch
              value={settings.minWalk}
              onValueChange={() => toggle('minWalk')}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>최소 환승</Text>
            <Switch
              value={settings.minTransfer}
              onValueChange={() => toggle('minTransfer')}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>상관없음</Text>
            <Switch
              value={settings.anyWalk}
              onValueChange={() => toggle('anyWalk')}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="#FFFFFF"
            />
          </View>
          </View>
        </View>
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
  content: {
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerBtn: {
    padding: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  saveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#888888',
    marginBottom: 8,
    marginTop: 4,
    paddingLeft: 4,
  },
  sectionBox: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLabel: {
    fontSize: 15,
    color: '#1A1A1A',
    fontWeight: '400',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#DDDDDD',
  },
  timeControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#AAAAAA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBtnDisabled: {
    borderColor: '#DDDDDD',
  },
  timeValue: {
    fontSize: 15,
    fontWeight: '500',
    color: '#555555',
    minWidth: 36,
    textAlign: 'center',
  },
});