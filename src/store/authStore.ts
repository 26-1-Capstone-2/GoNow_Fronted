import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'auth_token';
// Refresh Token은 수명이 길어서(2주) AsyncStorage보다 강한 보호가 필요해 SecureStore(암호화 저장소)를 씀.
// Access Token은 백그라운드 지오펜싱 태스크 5개가 AsyncStorage에서 직접 읽는 구조라(authStore를 못 거침)
// 그대로 유지 — Refresh Token은 그런 헤드리스 사용처가 없어서 저장소를 바꿔도 안전함.
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
// Refresh Token 재발급(POST /api/auth/reissue) 요청에 필요 — 민감값 아니라 AsyncStorage로 충분
const MEMBER_ID_KEY = 'auth_member_id';
const NICKNAME_KEY = 'auth_nickname';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  memberId: number | null;
  nickname: string | null;
  setToken: (token: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  setMemberId: (memberId: number | null) => void;
  setNickname: (nickname: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  refreshToken: null,
  memberId: null,
  nickname: null,
  setToken: (token) => {
    set({ token });
    if (token) {
      AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      AsyncStorage.removeItem(TOKEN_KEY);
    }
  },
  setRefreshToken: (refreshToken) => {
    set({ refreshToken });
    if (refreshToken) {
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    } else {
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    }
  },
  setMemberId: (memberId) => {
    set({ memberId });
    if (memberId !== null) {
      AsyncStorage.setItem(MEMBER_ID_KEY, String(memberId));
    } else {
      AsyncStorage.removeItem(MEMBER_ID_KEY);
    }
  },
  setNickname: (nickname) => {
    set({ nickname });
    // 지오펜스 헤드리스 태스크(nearDestGeofenceTask.ts)가 도착 확인 알림을 보낼 때
    // 인메모리 상태 대신 이 값을 읽음 — token과 동일 패턴으로 영속화
    if (nickname) {
      AsyncStorage.setItem(NICKNAME_KEY, nickname);
    } else {
      AsyncStorage.removeItem(NICKNAME_KEY);
    }
  },
}));

export const getToken = () => useAuthStore.getState().token;
export const getNickname = () => useAuthStore.getState().nickname;
export { TOKEN_KEY, REFRESH_TOKEN_KEY, MEMBER_ID_KEY, NICKNAME_KEY };
