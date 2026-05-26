import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAlarmSheet from '@/src/screens/alarmManage/GroupAlarmSheet';
import HomeAlarmSheet from '@/src/screens/alarmManage/HomeAlarmSheet';
import PersonalAlarmSheet from '@/src/screens/alarmManage/PersonalAlarmSheet';
import DailyAlarmScreen from '@/src/screens/main/DailyAlarmScreen';
import { useState } from 'react';
import { View } from 'react-native';

type SheetState = { mode: 'add' | 'edit'; id?: number } | null;

export default function DailyAlarmPage() {
  const [personalSheet, setPersonalSheet] = useState<SheetState>(null);
  const [groupSheet, setGroupSheet] = useState<SheetState>(null);
  const [homeSheet, setHomeSheet] = useState<SheetState>(null);
  const [showArrivalSheet, setShowArrivalSheet] = useState(false);
  const [isArrivalActive] = useState(true);
  const [selectedGroupAlarm, setSelectedGroupAlarm] = useState<any>(null);

  return (
    <View style={{ flex: 1 }}>
      <DailyAlarmScreen
        onPersonalAdd={() => setPersonalSheet({ mode: 'add' })}
        onPersonalEdit={(journeyId) => setPersonalSheet({ mode: 'edit', id: journeyId })}
        onGroupAdd={() => setGroupSheet({ mode: 'add' })}
        onGroupEdit={(appointmentId) => setGroupSheet({ mode: 'edit', id: appointmentId })}
        onHomeAdd={() => setHomeSheet({ mode: 'add' })}
        onHomeEdit={(journeyId) => setHomeSheet({ mode: 'edit', id: journeyId })}
        onArrivalPress={() => setShowArrivalSheet(true)}
        isArrivalActive={isArrivalActive}
      />
      {personalSheet && (
        <PersonalAlarmSheet
          onClose={() => setPersonalSheet(null)}
          initialMode={personalSheet.mode}
          editJourneyId={personalSheet.id}
        />
      )}
      {groupSheet && (
        <GroupAlarmSheet
          onClose={() => setGroupSheet(null)}
          initialMode={groupSheet.mode}
          editAppointmentId={groupSheet.id}
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
      {homeSheet && (
        <HomeAlarmSheet
          onClose={() => setHomeSheet(null)}
          initialMode={homeSheet.mode}
          editJourneyId={homeSheet.id}
        />
      )}
    </View>
  );
}
