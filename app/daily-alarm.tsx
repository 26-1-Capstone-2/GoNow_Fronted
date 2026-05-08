import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAlarmSheet from '@/src/screens/alarmManage/GroupAlarmSheet';
import HomeAlarmSheet from '@/src/screens/alarmManage/HomeAlarmSheet';
import PersonalAlarmSheet from '@/src/screens/alarmManage/PersonalAlarmSheet';
import DailyAlarmScreen from '@/src/screens/main/DailyAlarmScreen';
import { useState } from 'react';
import { View } from 'react-native';

export default function DailyAlarmPage() {
  const [showPersonalSheet, setShowPersonalSheet] = useState(false);
  const [showGroupSheet, setShowGroupSheet] = useState(false);
  const [showArrivalSheet, setShowArrivalSheet] = useState(false);
  const [showHomeSheet, setShowHomeSheet] = useState(false);
  const [isArrivalActive] = useState(true);
  const [selectedGroupAlarm, setSelectedGroupAlarm] = useState<any>(null);

  return (
    <View style={{ flex: 1 }}>
      <DailyAlarmScreen
        onPersonalPress={() => setShowPersonalSheet(true)}
        onGroupPress={() => setShowGroupSheet(true)}
        onArrivalPress={() => setShowArrivalSheet(true)}
        isArrivalActive={isArrivalActive}
        onHomePress={() => setShowHomeSheet(true)}
      />
      {showPersonalSheet && (
        <PersonalAlarmSheet onClose={() => setShowPersonalSheet(false)} />
      )}
      {showGroupSheet && (
        <GroupAlarmSheet
          onClose={() => setShowGroupSheet(false)}
          onArrivalPress={(alarm) => {
            setSelectedGroupAlarm(alarm);
            setShowArrivalSheet(true);
          }}
        />
      )}
      {showArrivalSheet && (
        <ArrivalDashboardSheet
          onClose={() => setShowArrivalSheet(false)}
          destination={selectedGroupAlarm?.place ?? '홍대역 2번 출구'}
          alarmTime={selectedGroupAlarm ? selectedGroupAlarm.ampm + ' ' + selectedGroupAlarm.hour + '시' : '오후 7시'}
          members={selectedGroupAlarm?.members.map((m: any) => ({
            ...m,
            transport: m.transport ?? 'public',
            arrivalTime: m.isMe ? '오후 7시 2분' : '오후 7시 3분',
          })) ?? [
            { id: '1', name: '가가가(본인)', isMe: true, transport: 'public', arrivalTime: '오후 7시 2분' },
            { id: '2', name: '나나나', isMe: false, transport: 'public', arrivalTime: '오후 7시 3분' },
            { id: '3', name: '다다다', isMe: false, transport: 'car', arrivalTime: '오후 6시 58분' },
          ]}
        />
      )}
      {showHomeSheet && (
        <HomeAlarmSheet onClose={() => setShowHomeSheet(false)} />
      )}
    </View>
  );
}