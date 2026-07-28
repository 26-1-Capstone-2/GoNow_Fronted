import type { Href } from 'expo-router';

/**
 * Expo Router `app/` 구조와 1:1로 맞춘 경로.
 * 화면에서는 문자열 대신 이 상수 + `useAppNavigation()`만 사용합니다.
 */
export const ROUTES = {
  login: '/login' satisfies Href,
  signUp: '/sign-up' satisfies Href,
  /** typed routes 재생성 전까지 Href 단언 (경로: `app/(auth)/home-address-setup.tsx`) */
  homeAddressSetup: '/home-address-setup' as Href,
  leaveTimeSetup: '/leave-time-setup' as Href,
  permissionSetup: '/permission-setup' as Href,
  mainTabs: '/(tabs)' satisfies Href,
  yearCalendar: '/year-calendar' as Href,
} as const;

export type AppHref = (typeof ROUTES)[keyof typeof ROUTES];
