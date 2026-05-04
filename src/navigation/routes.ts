import type { Href } from 'expo-router';

/**
 * Expo Router `app/` 구조와 1:1로 맞춘 경로.
 * 화면에서는 문자열 대신 이 상수 + `useAppNavigation()`만 사용합니다.
 */
export const ROUTES = {
  login: '/login' satisfies Href,
  signUp: '/sign-up' satisfies Href,
  mainTabs: '/(tabs)' satisfies Href,
} as const;

export type AppHref = (typeof ROUTES)[keyof typeof ROUTES];
