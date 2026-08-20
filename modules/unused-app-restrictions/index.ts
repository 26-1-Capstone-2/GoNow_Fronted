import { requireNativeModule } from 'expo-modules-core';

interface UnusedAppRestrictionsModule {
  isRestrictionEnabled(): Promise<boolean>;
  openSettings(): void;
}

let nativeModule: UnusedAppRestrictionsModule;
try {
  nativeModule = requireNativeModule<UnusedAppRestrictionsModule>('UnusedAppRestrictions');
} catch {
  // 재빌드 전(네이티브 모듈 미연결) 등으로 로드 실패 시, import 시점에 앱 전체가
  // 죽지 않도록 안전한 기본값(제약 없음으로 간주)을 반환하는 폴백으로 대체
  nativeModule = {
    isRestrictionEnabled: async () => false,
    openSettings: () => {},
  };
}

export default nativeModule;
