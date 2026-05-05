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
  const [isArrivalActive] = useState(true); // 백엔드에서 활성화 여부 받아올 예정
  const [showHomeSheet, setShowHomeSheet] = useState(false);

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
        <PersonalAlarmSheet
          onClose={() => setShowPersonalSheet(false)}
        />
      )}
      {showGroupSheet && (
        <GroupAlarmSheet onClose={() => setShowGroupSheet(false)} />
      )}
      {showArrivalSheet && (
        <ArrivalDashboardSheet
          onClose={() => setShowArrivalSheet(false)}
          destination="홍대역 2번 출구"
          alarmTime="오후 7시"
          members={[
            { id: '1', name: '가가가(본인)', isMe: true },
            { id: '2', name: '나나나', isMe: false, arrivalTime: '오후 7시 3분' },
            { id: '3', name: '다다다', isMe: false, arrivalTime: '오후 6시 58분' },
          ]}
        />
      )}
      {showHomeSheet && (
        <HomeAlarmSheet onClose={() => setShowHomeSheet(false)} />
      )}
    </View>
  );
}