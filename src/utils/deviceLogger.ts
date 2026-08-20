import AsyncStorage from '@react-native-async-storage/async-storage';

// adb logcat 버퍼는 시스템 전체 로그가 섞여서 앱 로그가 몇 초~몇 분 만에 밀려날 수 있다(실기기
// 실측 — 화면 잠금 해제 몇 초만으로도 5MiB 버퍼가 다 참). 야외 실기기 테스트처럼 PC에 계속
// 연결해둘 수 없는 상황에서는 adb 자체가 신뢰할 수 없는 수단이라, 앱이 직접 남긴 줄만 별도로
// 저장해두고 나중에(테스트 다녀온 뒤) 앱 화면에서 바로 읽을 수 있게 한다.
const DEVICE_LOG_KEY = 'gonow_device_debug_log';
// AsyncStorage 값 하나가 무한정 커지지 않도록 최근 분량만 유지(대략 최근 로그, 오래된 줄부터 버림).
const MAX_LOG_CHARS = 200_000;

// 같은 JS 컨텍스트 안에서 dlog()가 짧은 시간에 여러 번 불리면 읽고→고치고→쓰는 구조라 서로의
// 갱신을 덮어쓸 수 있어 직렬화한다(backgroundLocationTask.ts의 다른 락들과 동일한 이유). 단,
// 헤드리스 태스크는 서로 다른 JS 컨텍스트에서 뜨므로 이 락은 "같은 컨텍스트 안 동시 호출"만
// 막아준다 — 서로 다른 헤드리스 태스크가 정확히 동시에 쓰면 드물게 한쪽 줄이 유실될 수 있지만,
// 디버그 전용 로그라 감내 가능한 수준으로 판단.
let writeQueue: Promise<void> = Promise.resolve();
function withWriteLock(fn: () => Promise<void>): Promise<void> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

// 필요한 지점에서만 선택적으로 호출할 것 — 모든 console.log를 대체하려는 용도가 아니라, 지오펜스
// 등록/발화/서버응답/스킵처럼 "야외 테스트 후 나중에 확인해야 하는" 핵심 이벤트 전용.
export function dlog(tag: string, message: string): void {
  const line = `${new Date().toLocaleTimeString('ko-KR', { hour12: false })} [${tag}] ${message}`;
  console.log(line);
  withWriteLock(async () => {
    try {
      const existing = (await AsyncStorage.getItem(DEVICE_LOG_KEY)) ?? '';
      let next = existing ? `${existing}\n${line}` : line;
      if (next.length > MAX_LOG_CHARS) {
        next = next.slice(next.length - MAX_LOG_CHARS);
      }
      await AsyncStorage.setItem(DEVICE_LOG_KEY, next);
    } catch {}
  }).catch(() => {});
}

export async function readDeviceLog(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(DEVICE_LOG_KEY)) ?? '(저장된 로그 없음)';
  } catch (e) {
    return `로그 읽기 실패: ${e}`;
  }
}

export async function clearDeviceLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEVICE_LOG_KEY);
  } catch {}
}
