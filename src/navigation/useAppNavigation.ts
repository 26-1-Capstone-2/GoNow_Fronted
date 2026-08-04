import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { ROUTES } from './routes';

/**
 * Expo Router `useRouter`를 한곳에서 감싼 앱 공통 네비게이션.
 * 화면·`app/*` 라우트는 가능하면 `expo-router`를 직접 import하지 않고 이 훅을 씁니다.
 */
export function useAppNavigation() {
  const router = useRouter();

  const goToLogin = useCallback(() => {
    router.replace(ROUTES.login);
  }, [router]);

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

  /**
   * 회원가입 완료 후: 필수 권한 안내 (뒤로가기로 못 돌아가게 replace).
   * fromOnboarding 파라미터로 표시해둬야 PermissionSetupScreen의 "완료" 버튼이
   * (설정 화면에서 들어왔을 때처럼) 뒤로가기 대신 메인 탭으로 가야 함을 판단할 수 있음 —
   * replace를 써도 그 아래(home-address-setup 등) 스택이 남아있어 canGoBack()만으로는
   * "회원가입 중"인지 구별이 안 됨.
   */
  const goToPermissionSetup = useCallback(() => {
    router.replace({ pathname: ROUTES.permissionSetup, params: { fromOnboarding: '1' } } as Href);
  }, [router]);

  const goToYearCalendar = useCallback(
    (y: number) => {
      router.push({
        pathname: ROUTES.yearCalendar,
        params: { year: String(y) },
      } as Href);
    },
    [router],
  );

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
      goToLogin,
      goToSignUp,
      goToHomeAddressSetup,
      goToLeaveTimeSetup,
      goToPermissionSetup,
      goToYearCalendar,
      goToMainTabs,
      goBack,
      replace,
      push,
    }),
    [goToLogin, goToSignUp, goToHomeAddressSetup, goToLeaveTimeSetup, goToPermissionSetup, goToYearCalendar, goToMainTabs, goBack, replace, push],
  );
}
