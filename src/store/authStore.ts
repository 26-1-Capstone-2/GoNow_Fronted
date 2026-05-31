import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auth_token';

interface AuthState {
  token: string | null;
  setToken: (token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  setToken: (token) => {
    set({ token });
    if (token) {
      AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      AsyncStorage.removeItem(TOKEN_KEY);
    }
  },
}));

export const getToken = () => useAuthStore.getState().token;
export { TOKEN_KEY };
