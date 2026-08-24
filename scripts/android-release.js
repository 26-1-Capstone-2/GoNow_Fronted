#!/usr/bin/env node
// android/ 밑의 Gradle wrapper를 OS에 맞게 실행한다 — Windows는 gradlew.bat(백슬래시 상대경로),
// Mac/Linux는 gradlew(슬래시)라 셸 문법이 서로 호환 안 돼서 package.json 스크립트 문자열
// 하나로는 양쪽을 동시에 못 맞춘다. --rerun-tasks는 항상 붙인다 — EXPO_PUBLIC_API_BASE_URL만
// 바꿔서 재빌드해도 Gradle이 JS 번들을 캐시로 재사용해 예전 서버를 계속 가리키는 사고를 막기
// 위함(clean은 쓰지 않는다 — 네이티브 CMake 빌드 캐시가 깨짐, docs/local-vs-ec2-server.md 참고).

const { spawnSync } = require('child_process');
const path = require('path');

const androidDir = path.join(__dirname, '..', 'android');
const isWindows = process.platform === 'win32';

const command = isWindows ? '.\\gradlew.bat' : './gradlew';
const args = ['assembleRelease', '--rerun-tasks'];

console.log(`[${process.platform}] ${command} ${args.join(' ')} (cwd: ${androidDir})`);

const result = spawnSync(command, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
