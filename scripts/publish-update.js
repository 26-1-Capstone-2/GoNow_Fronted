#!/usr/bin/env node
// eas update를 실행할 때 대상 브랜치(채널)를 사람이 고르지 않고 EXPO_PUBLIC_API_BASE_URL
// 존재 여부로 자동 선택한다. 값은 그대로 흘려보내기만 하고(강제로 비우지 않음 — client.ts가
// ?? 로 null/undefined만 기본값으로 처리하므로, 빈 문자열로 밀어버리면 오히려 앱이 깨짐),
// 어느 브랜치로 나가는지 실행 전에 화면에 명확히 보여준다.
// 사용법: node scripts/publish-update.js "커밋 메시지"
// (docs/local-vs-ec2-server.md 참고, 2026-08-23)

const { spawnSync } = require('child_process');

const message = process.argv[2];
if (!message) {
  console.error('사용법: node scripts/publish-update.js "커밋 메시지"');
  process.exit(1);
}

const isLocal = Boolean(process.env.EXPO_PUBLIC_API_BASE_URL);
const branch = isLocal ? 'local-dev' : 'preview';

console.log('='.repeat(60));
console.log(`대상 브랜치: ${branch}`);
console.log(`EXPO_PUBLIC_API_BASE_URL: ${isLocal ? '설정됨 (로컬 서버 겨냥 번들)' : '없음 (EC2 기본값)'}`);
console.log('='.repeat(60));

// shell: true인 경우 Node가 인자를 자동으로 따옴표 처리해주지 않아(Windows cmd 기준),
// 공백 포함 메시지가 여러 개의 별도 인자로 쪼개져 전달되는 문제가 있었다 — 직접 감싸준다.
const result = spawnSync(
  'npx',
  ['eas', 'update', '--branch', branch, '--message', `"${message}"`],
  { stdio: 'inherit', shell: true },
);

process.exit(result.status ?? 1);
