import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auth_token';
const NICKNAME_KEY = 'auth_nickname';

interface AuthState {
  token: string | null;
  nickname: string | null;
  setToken: (token: string | null) => void;
  setNickname: (nickname: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  nickname: null,
  setToken: (token) => {
    set({ token });
    if (token) {
      AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      AsyncStorage.removeItem(TOKEN_KEY);
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
export { TOKEN_KEY, NICKNAME_KEY };
