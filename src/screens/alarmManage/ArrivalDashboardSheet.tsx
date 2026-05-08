import { useCalendarStore } from '@/src/store/calendarStore';
import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useCallback, useMemo, useRef } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

interface MemberArrival {
  id: string;
  name: string;
  isMe: boolean;
  arrivalTime?: string;
  transport?: 'public' | 'car';
}

interface Props {
  onClose: () => void;
  destination: string;
  alarmTime: string;
  members: MemberArrival[];
}

function TransportBadge({ transport }: { transport?: 'public' | 'car' }) {
  if (!transport) return null;
  if (transport === 'public') {
    return <MaterialCommunityIcons name="bus-side" size={20} color="#4A90D9" />;
  }
  return <FontAwesome5 name="car-side" size={18} color="#F5A623" />;
}

export default function ArrivalDashboardSheet({ onClose, destination, alarmTime, members }: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const { selectedDate } = useCalendarStore();

  const dateObj = new Date(selectedDate);
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayName = DAY_NAMES[dateObj.getDay()];

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
        <Text style={styles.title}>도착예정</Text>
        <View style={{ width: 36 }} />
      </View>

      <BottomSheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.datePillContainer}>
          <View style={styles.datePill}>
            <Text style={styles.datePillText}>
              {month}월 {date}일 {dayName}요일 {alarmTime}
            </Text>
          </View>
        </View>

        <View style={styles.destinationContainer}>
          <View style={styles.destinationPill}>
            <Text style={styles.destinationText}>{destination}</Text>
          </View>
        </View>

        {/* 멤버 목록 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>멤버({members.length})</Text>
          {members.map((member) => (
            <View key={member.id} style={styles.memberCard}>
              <View style={styles.memberCardTop}>
                <Text style={styles.memberName}>{member.name}</Text>
                <TransportBadge transport={member.transport} />
              </View>
              <Text style={styles.arrivalTime}>
                {member.arrivalTime ? `${member.arrivalTime} 도착예정` : '계산 중…'}
              </Text>
            </View>
          ))}
        </View>
      </BottomSheetScrollView>
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
  title: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  datePillContainer: { alignItems: 'center', marginBottom: 10 },
  datePill: { backgroundColor: '#F5F5F5', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  datePillText: { fontSize: 13, fontWeight: '500', color: '#FF3B30' },
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
  memberCardTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginBottom: 10,
  },
  memberName: { fontSize: 13, color: '#888888' },
  arrivalTime: { fontSize: 22, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },

});