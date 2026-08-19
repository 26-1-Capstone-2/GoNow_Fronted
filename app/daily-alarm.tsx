import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAlarmSheet from '@/src/screens/alarmManage/GroupAlarmSheet';
import HomeAlarmSheet from '@/src/screens/alarmManage/HomeAlarmSheet';
import PersonalAlarmSheet from '@/src/screens/alarmManage/PersonalAlarmSheet';
import DailyAlarmScreen from '@/src/screens/main/DailyAlarmScreen';
import { consumePendingInviteCode } from '@/src/utils/inviteDeepLink';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

type PersonalHomeSheetState = { mode: 'add' | 'edit'; id?: number; alarm?: any } | null;
type GroupSheetState = { mode: 'add' | 'create' | 'edit' | 'join'; id?: number; alarm?: any; inviteCode?: string } | null;

export default function DailyAlarmPage() {
  const [personalSheet, setPersonalSheet] = useState<PersonalHomeSheetState>(null);
  const [groupSheet, setGroupSheet] = useState<GroupSheetState>(null);
  const [homeSheet, setHomeSheet] = useState<PersonalHomeSheetState>(null);
  const [showArrivalSheet, setShowArrivalSheet] = useState(false);
  const [selectedGroupAlarm, setSelectedGroupAlarm] = useState<any>(null);

  // 그룹 초대 유니버설 링크로 들어온 경우(app/_layout.tsx가 저장해둠) 초대코드 참여 화면을 자동으로 연다.
  useEffect(() => {
    consumePendingInviteCode().then((code) => {
      if (code) setGroupSheet({ mode: 'join', inviteCode: code });
    });
  }, []);

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
          initialInviteCode={groupSheet.inviteCode}
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
