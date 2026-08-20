import { requireNativeModule } from 'expo-modules-core';

interface ForegroundServiceModule {
  start(title: string, body: string): void;
  stop(): void;
}

let nativeModule: ForegroundServiceModule;
try {
  nativeModule = requireNativeModule<ForegroundServiceModule>('ForegroundService');
} catch {
  // 재빌드 전(네이티브 모듈 미연결) 등으로 로드 실패 시, import 시점에 앱 전체가
  // 죽지 않도록 아무 동작도 안 하는 안전한 폴백으로 대체
  nativeModule = { start: () => {}, stop: () => {} };
}

export default nativeModule;
