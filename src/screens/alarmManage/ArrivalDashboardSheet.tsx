import { createAppointmentsApi, DashboardParticipant } from '@/src/api/appointments';
import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const appointmentsApi = createAppointmentsApi();

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatEstimatedArrival(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? '오후' : '오전';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${ampm} ${displayH}시` : `${ampm} ${displayH}시 ${m}분`;
}

function formatTargetTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? '오후' : '오전';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${ampm} ${displayH}시` : `${ampm} ${displayH}시 ${m}분`;
}

function TransportBadge({ transport }: { transport: 'TRANSIT' | 'DRIVING' }) {
  if (transport === 'TRANSIT') {
    return <MaterialCommunityIcons name="bus-side" size={20} color="#4A90D9" />;
  }
  return <FontAwesome5 name="car-side" size={18} color="#FF9F0A" />;
}

interface Props {
  onClose: () => void;
  appointmentId: number;
}

export default function ArrivalDashboardSheet({ onClose, appointmentId }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['88%'], []);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [destName, setDestName] = useState('');
  const [targetTime, setTargetTime] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [participants, setParticipants] = useState<DashboardParticipant[]>([]);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await appointmentsApi.getDashboard(appointmentId);
      if (res.success && res.data) {
        const d = res.data;
        setDestName(d.dest_name);
        setTargetTime(formatTargetTime(d.target_time));
        const dateObj = new Date(d.target_time);
        const month = dateObj.getMonth() + 1;
        const date = dateObj.getDate();
        const dayName = DAY_NAMES[dateObj.getDay()];
        setTargetDate(`${month}월 ${date}일 ${dayName}요일`);
        setParticipants(d.participants);
      }
    } catch {}
    if (isRefresh) setRefreshing(false);
    else setLoading(false);
  }, [appointmentId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

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
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
          <Feather name="x" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.title}>멤버 도착 현황</Text>
        <TouchableOpacity
          style={[styles.headerBtn, styles.refreshBtn]}
          onPress={() => loadDashboard(true)}
          disabled={refreshing}
        >
          {refreshing
            ? <ActivityIndicator size="small" color="#FF9F0A" />
            : <Feather name="refresh-cw" size={18} color="#FF9F0A" />
          }
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF9F0A" />
        </View>
      ) : (
        <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.datePillContainer}>
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>
                {targetDate} {targetTime}
              </Text>
            </View>
          </View>

          <View style={styles.destinationContainer}>
            <View style={styles.destinationPill}>
              <Text style={styles.destinationText}>{destName}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>멤버({participants.length})</Text>
            {participants.map((p, i) => (
              <View key={i} style={[styles.memberCard, p.is_me && styles.memberCardMe]}>
                <View style={styles.memberCardTop}>
                  <Text style={styles.memberName}>
                    {p.nickname}{p.is_me ? ' (나)' : ''}
                  </Text>
                  <TransportBadge transport={p.transport_type} />
                </View>
                <Text style={styles.arrivalTime}>
                  {p.participant_status === 'ARRIVED'
                    ? `${formatEstimatedArrival(p.estimated_arrival!)} 도착 완료`
                    : p.estimated_arrival
                      ? `${formatEstimatedArrival(p.estimated_arrival)} 도착 예정`
                      : '계산 중…'}
                </Text>
              </View>
            ))}
          </View>
        </BottomSheetScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  indicator: { backgroundColor: '#DDDDDD', width: 40 },
  background: { backgroundColor: '#FFFFFF', borderRadius: 20 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center',
  },
  refreshBtn: { backgroundColor: '#FFF3E0' },
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', flex: 1, textAlign: 'center' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  datePillContainer: { alignItems: 'center', marginBottom: 10 },
  datePill: { backgroundColor: '#F5F5F5', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  datePillText: { fontSize: 13, fontWeight: '500', color: '#FF453A' },
  destinationContainer: { alignItems: 'center', marginBottom: 24 },
  destinationPill: { backgroundColor: '#F5F5F5', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8 },
  destinationText: { fontSize: 14, fontWeight: '500', color: '#1A1A1A' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 },
  memberCard: {
    backgroundColor: '#F5F5F5', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 8, alignItems: 'center',
  },
  memberCardMe: { borderWidth: 1.5, borderColor: '#FF9F0A' },
  memberCardTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginBottom: 10,
  },
  memberName: { fontSize: 13, color: '#888888' },
  arrivalTime: { fontSize: 22, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },
});
