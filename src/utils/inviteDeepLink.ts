import AsyncStorage from '@react-native-async-storage/async-storage';

// https://gonow-api.uk/join?code=... 형태의 그룹 초대 링크 파싱 + 로그인 전(콜드스타트)에
// 받아도 잃어버리지 않도록 잠깐 보관하는 용도(안드로이드 App Links로 앱이 직접 가로챔 —
// Chrome, 문자, 슬랙 등 자체 인앱브라우저 없는 곳에서 링크 탭 시).
// 카카오톡/인스타그램처럼 자체 인앱브라우저가 App Links를 무시하는 곳에서는 join.html이
// intent://로 gonow://join?code=... 커스텀 스킴을 강제 호출하는데, 이건 expo-router가
// app/join.tsx로 자체 라우팅하므로 여기서 다루지 않는다(app/join.tsx 주석 참고 — 예전엔
// 여기서도 gonow:// 를 같이 매칭했는데, expo-router의 자체 딥링크 매칭과 이 리스너가 동시에
// 반응해서 뒤로가기 시 +not-found 유령 화면이 남는 경쟁 상태가 있었다).
const PENDING_INVITE_CODE_KEY = 'pending_invite_code';

/**
 * 위 형태의 URL에서 초대코드만 뽑아낸다. 매칭 안 되면 null.
 * RN/Hermes의 URL 전역 객체 지원이 버전마다 들쭉날쭉이라(이 프로젝트는 폴리필 미설치) 정규식으로
 * 직접 파싱한다 — kakaoMapDeeplink.ts가 URL 파라미터를 수동 문자열 조합으로 다루는 것과 같은 이유.
 */
export function extractInviteCodeFromUrl(url: string): string | null {
  const isMatchingUrl = /^https:\/\/gonow-api\.uk\/join(?:[?#]|$)/.test(url);
  if (!isMatchingUrl) return null;
  const match = url.match(/[?&]code=([^&#]+)/);
  if (!match) return null;
  try {
    const code = decodeURIComponent(match[1]).trim();
    return code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

export async function setPendingInviteCode(code: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_INVITE_CODE_KEY, code);
}

/** 저장된 코드를 읽고 즉시 지운다(한 번 소비되면 재사용 안 함). */
export async function consumePendingInviteCode(): Promise<string | null> {
  const code = await AsyncStorage.getItem(PENDING_INVITE_CODE_KEY);
  if (code) await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY);
  return code;
}
