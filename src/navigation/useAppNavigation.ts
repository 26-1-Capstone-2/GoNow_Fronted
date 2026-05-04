import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { ROUTES } from './routes';

/**
 * Expo Router `useRouter`를 한곳에서 감싼 앱 공통 네비게이션.
 * 화면·`app/*` 라우트는 가능하면 `expo-router`를 직접 import하지 않고 이 훅을 씁니다.
 */
export function useAppNavigation() {
  const router = useRouter();

  const goToSignUp = useCallback(() => {
    router.push(ROUTES.signUp);
  }, [router]);

  const goToMainTabs = useCallback(() => {
    router.replace(ROUTES.mainTabs);
  }, [router]);

  /** 로그인 성공(또는 데모) 후 필수 설정: 귀가지 */
  const goToHomeAddressSetup = useCallback(() => {
    router.replace(ROUTES.homeAddressSetup);
  }, [router]);

  /** 귀가지 설정 완료 후: 여유시간 설정 (뒤로가기로 귀가지 화면 복귀 가능) */
  const goToLeaveTimeSetup = useCallback(() => {
    router.push(ROUTES.leaveTimeSetup);
  }, [router]);

  const replace = useCallback(
    (href: Href) => {
      router.replace(href);
    },
    [router],
  );

  const push = useCallback(
    (href: Href) => {
      router.push(href);
    },
    [router],
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    }
  }, [router]);

  return useMemo(
    () => ({
      routes: ROUTES,
      goToSignUp,
      goToHomeAddressSetup,
      goToLeaveTimeSetup,
      goToMainTabs,
      goBack,
      replace,
      push,
    }),
    [goToSignUp, goToHomeAddressSetup, goToLeaveTimeSetup, goToMainTabs, goBack, replace, push],
  );
}
