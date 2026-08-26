import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { ROUTES } from './routes';

/**
 * Expo Router `useRouter`를 한곳에서 감싼 앱 공통 네비게이션.
 * 화면·`app/*` 라우트는 가능하면 `expo-router`를 직접 import하지 않고 이 훅을 씁니다.
 */
export function useAppNavigation() {
  const router = useRouter();

  // dismissAll() 먼저 호출하는 이유: replace()만 쓰면 지금 화면 하나만 로그인 화면으로 바뀌고
  // 그 아래 쌓여있던 인증된 화면은 스택에 그대로 남아, 로그인 화면에서 뒤로가기(스와이프)를
  // 하면 그 화면이 그대로 노출되는 문제가 있었다(client.ts/ProfileSettingsScreen.tsx에서
  // 2026-08-25 발견 후 동일하게 적용) — "로그인 화면으로 보낸다"는 이 함수의 목적상 항상
  // 스택을 비우는 게 안전하다.
  const goToLogin = useCallback(() => {
    router.dismissAll();
    router.replace(ROUTES.login);
  }, [router]);

  const goToSignUp = useCallback(() => {
    router.push(ROUTES.signUp);
  }, [router]);

  /**
   * 회원가입 기본정보 입력 완료 후: 이메일 인증 (뒤로가기로 이메일 수정 가능하도록 push).
   * recovery: true면 "인증 유효시간 만료로 인한 재인증"(leave-time-setup에서 진입) —
   * 이 경우 EmailVerifyScreen이 성공 시 앞으로(home-address-setup)가 아니라
   * 뒤로(leave-time-setup)가야 이미 입력한 주소/여유시간을 다시 안 물어봄.
   */
  const goToEmailVerify = useCallback(
    (options?: { recovery?: boolean }) => {
      router.push({
        pathname: ROUTES.emailVerify,
        params: options?.recovery ? { recovery: '1' } : {},
      } as Href);
    },
    [router],
  );

  /** 로그인 화면에서: 비밀번호 찾기 (뒤로가기로 로그인 화면 복귀 가능하도록 push) */
  const goToPasswordReset = useCallback(() => {
    router.push(ROUTES.passwordReset);
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
      goToEmailVerify,
      goToPasswordReset,
      goToHomeAddressSetup,
      goToLeaveTimeSetup,
      goToPermissionSetup,
      goToYearCalendar,
      goToMainTabs,
      goBack,
      replace,
      push,
    }),
    [goToLogin, goToSignUp, goToEmailVerify, goToPasswordReset, goToHomeAddressSetup, goToLeaveTimeSetup, goToPermissionSetup, goToYearCalendar, goToMainTabs, goBack, replace, push],
  );
}
