import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAlarmSheet from '@/src/screens/alarmManage/GroupAlarmSheet';
import HomeAlarmSheet from '@/src/screens/alarmManage/HomeAlarmSheet';
import PersonalAlarmSheet from '@/src/screens/alarmManage/PersonalAlarmSheet';
import DailyAlarmScreen from '@/src/screens/main/DailyAlarmScreen';
import { useState } from 'react';
import { View } from 'react-native';

type SheetState = { mode: 'add' | 'create' | 'edit'; id?: number; alarm?: any } | null;

export default function DailyAlarmPage() {
  const [personalSheet, setPersonalSheet] = useState<SheetState>(null);
  const [groupSheet, setGroupSheet] = useState<SheetState>(null);
  const [homeSheet, setHomeSheet] = useState<SheetState>(null);
  const [showArrivalSheet, setShowArrivalSheet] = useState(false);
  const [selectedGroupAlarm, setSelectedGroupAlarm] = useState<any>(null);

  return (
    <View style={{ flex: 1 }}>
      <DailyAlarmScreen
        onPersonalAdd={() => setPersonalSheet({ mode: 'add' })}
        onPersonalEdit={(journeyId, alarm) => setPersonalSheet({ mode: 'edit', id: journeyId, alarm })}
        onGroupAdd={() => setGroupSheet({ mode: 'create' })}
        onGroupEdit={(appointmentId, alarm) => setGroupSheet({ mode: 'edit', id: appointmentId, alarm })}
        onHomeAdd={() => setHomeSheet({ mode: 'add' })}
        onHomeEdit={(journeyId, alarm) => setHomeSheet({ mode: 'edit', id: journeyId, alarm })}
        onArrivalPress={(appointmentId) => {
          setSelectedGroupAlarm({ appointmentId });
          setShowArrivalSheet(true);
        }}
      />
      {personalSheet && (
        <PersonalAlarmSheet
          onClose={() => setPersonalSheet(null)}
          initialMode={personalSheet.mode}
          editJourneyId={personalSheet.id}
          initialAlarm={personalSheet.alarm}
        />
      )}
      {groupSheet && (
        <GroupAlarmSheet
          onClose={() => setGroupSheet(null)}
          initialMode={groupSheet.mode}
          editAppointmentId={groupSheet.id}
          initialAlarm={groupSheet.alarm}
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
          initialAlarm={homeSheet.alarm}
        />
      )}
    </View>
  );
}
