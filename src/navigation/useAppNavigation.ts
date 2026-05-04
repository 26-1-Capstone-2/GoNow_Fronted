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

  return useMemo(
    () => ({
      routes: ROUTES,
      goToSignUp,
      goToMainTabs,
      replace,
      push,
    }),
    [goToSignUp, goToMainTabs, replace, push],
  );
}
