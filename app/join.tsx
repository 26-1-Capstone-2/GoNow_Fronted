import { setPendingInviteCode } from '@/src/utils/inviteDeepLink';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

/**
 * gonow://join?code=... 전용 착지 화면. join.html의 intent:// 우회로 들어오는 경우
 * expo-router 자체의 딥링크 매칭이 이 경로("join")를 처리하는데, 이 파일이 없으면
 * "일치하는 라우트 없음"으로 판단해 +not-found 화면을 먼저 보여준 뒤 _layout.tsx의 수동
 * Linking 리스너가 뒤늦게 daily-alarm으로 옮겨서, 뒤로가기 시 +not-found가 히스토리에
 * 남아있던 문제가 있었다. 이 화면이 즉시 replace하면서 그 유령 화면 자체가 안 생긴다.
 * (https://gonow-api.uk/join?code=... 형태는 expo-router가 인식하는 prefix가 아니라서
 * 이 파일과 무관하게 _layout.tsx의 수동 리스너가 그대로 처리한다.)
 */
export default function JoinRedirectScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    (async () => {
      if (code) await setPendingInviteCode(code);
      router.replace('/daily-alarm');
    })();
  }, [code]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
