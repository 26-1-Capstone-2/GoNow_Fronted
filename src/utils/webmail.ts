// 주요 이메일 서비스의 웹메일 접속 주소 — 도메인별 고정값(잘 안 바뀜, 별도 API 조회 불필요).
// 인증코드 발송 후 "받은편지함 확인하러 가기" 같은 편의 기능에 사용.
const WEBMAIL_URLS: Record<string, string> = {
  'naver.com': 'https://mail.naver.com',
  'gmail.com': 'https://mail.google.com',
  'googlemail.com': 'https://mail.google.com',
  'daum.net': 'https://mail.daum.net',
  'hanmail.net': 'https://mail.daum.net',
  'nate.com': 'https://mail.nate.com',
  'outlook.com': 'https://outlook.live.com',
  'hotmail.com': 'https://outlook.live.com',
  'live.com': 'https://outlook.live.com',
  'icloud.com': 'https://www.icloud.com/mail',
  'yahoo.com': 'https://mail.yahoo.com',
};

// 이메일 주소의 도메인으로 웹메일 주소를 찾는다. 모르는 도메인(회사 이메일 등)이면 null —
// 호출부는 null일 때 탭 불가능한 일반 텍스트로 렌더링해야 한다.
// 앱이 깔려있으면 안드로이드 App Links로 자동 연결되고, 없으면 브라우저로 열린다(OS가 알아서 처리).
export function getWebmailUrl(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return WEBMAIL_URLS[domain] ?? null;
}
