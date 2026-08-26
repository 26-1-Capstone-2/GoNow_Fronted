import ArrivalDashboardSheet from '@/src/screens/alarmManage/ArrivalDashboardSheet';
import GroupAlarmSheet from '@/src/screens/alarmManage/GroupAlarmSheet';
import HomeAlarmSheet from '@/src/screens/alarmManage/HomeAlarmSheet';
import PersonalAlarmSheet from '@/src/screens/alarmManage/PersonalAlarmSheet';
import DailyAlarmScreen from '@/src/screens/main/DailyAlarmScreen';
import { consumePendingInviteCode } from '@/src/utils/inviteDeepLink';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, View } from 'react-native';

type PersonalHomeSheetState = { mode: 'add' | 'edit'; id?: number; alarm?: any } | null;
type GroupSheetState = { mode: 'add' | 'create' | 'edit' | 'join'; id?: number; alarm?: any; inviteCode?: string } | null;

export default function DailyAlarmPage() {
  // "다가오는 일정" 카드 탭으로 진입한 경우(MainCalendarScreen) — 날짜별 리스트가 로드되면
  // 해당 알람의 수정 화면까지 자동으로 이어서 연다.
  const { editKind, editId } = useLocalSearchParams<{ editKind?: string; editId?: string }>();

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

  // 알람 생성(+)/카드 탭으로 여는 시트들은 새 화면(라우트)이 아니라 이 화면 위에 얹는
  // 오버레이라 내비게이션 스택은 그대로 daily-alarm 하나뿐이다 — 그래서 시트가 열린 채로
  // 뒤로가기(스와이프 포함)를 하면 시트만 닫혀야 하는데 daily-alarm 화면 자체가 통째로
  // pop되어 캘린더로 바로 돌아가버렸다(MainCalendarScreen 하단바 시트에서 2026-08-25에 먼저
  // 발견·수정된 것과 동일한 유형의 문제, 2026-08-26). 열린 시트가 있으면 그것부터 닫고 이번
  // 뒤로가기는 소비하며, 아무 시트도 없을 때만 기본 동작(화면 자체를 pop, 캘린더로 복귀)을
  // 그대로 둔다. 가장 위에 겹쳐 뜨는 도착 대시보드부터 먼저 검사한다.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (showArrivalSheet) { setShowArrivalSheet(false); return true; }
        if (homeSheet) { setHomeSheet(null); return true; }
        if (groupSheet) { setGroupSheet(null); return true; }
        if (personalSheet) { setPersonalSheet(null); return true; }
        return false;
      });
      return () => sub.remove();
    }, [showArrivalSheet, homeSheet, groupSheet, personalSheet])
  );

  return (
    <View style={{ flex: 1 }}>
      <DailyAlarmScreen
        autoEditKind={editKind as 'personal' | 'group' | 'home' | undefined}
        autoEditId={editId != null ? Number(editId) : undefined}
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
