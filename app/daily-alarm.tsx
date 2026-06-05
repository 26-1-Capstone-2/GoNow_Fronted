import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAlarmSheet from '@/src/screens/alarmManage/GroupAlarmSheet';
import HomeAlarmSheet from '@/src/screens/alarmManage/HomeAlarmSheet';
import PersonalAlarmSheet from '@/src/screens/alarmManage/PersonalAlarmSheet';
import DailyAlarmScreen from '@/src/screens/main/DailyAlarmScreen';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import { useState } from 'react';
import { View } from 'react-native';

type SheetState = { mode: 'add' | 'edit'; id?: number } | null;

export default function DailyAlarmPage() {
  const [personalSheet, setPersonalSheet] = useState<SheetState>(null);
  const [groupSheet, setGroupSheet] = useState<SheetState>(null);
  const [homeSheet, setHomeSheet] = useState<SheetState>(null);
  const [showArrivalSheet, setShowArrivalSheet] = useState(false);
  const [selectedGroupAlarm, setSelectedGroupAlarm] = useState<any>(null);

  const { statuses, activeAppointmentId } = useAppointmentStatusStore();
  const isArrivalActive = activeAppointmentId != null
    ? (statuses[activeAppointmentId] ?? 'WAITING') !== 'WAITING'
    : false;

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
      {showArrivalSheet && selectedGroupAlarm?.appointmentId != null && (
        <ArrivalDashboardSheet
          onClose={() => setShowArrivalSheet(false)}
          appointmentId={selectedGroupAlarm.appointmentId}
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
