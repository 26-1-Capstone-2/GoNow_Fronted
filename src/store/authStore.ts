import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auth_token';

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
  setNickname: (nickname) => set({ nickname }),
}));

export const getToken = () => useAuthStore.getState().token;
export const getNickname = () => useAuthStore.getState().nickname;
export { TOKEN_KEY };
