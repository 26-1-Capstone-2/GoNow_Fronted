import { create } from 'zustand';

interface SignUpState {
  email: string;
  password: string;
  nickname: string;
  home_name: string;
  home_address: string;
  home_lat: number;
  home_lng: number;

  setBasicInfo: (info: { email: string; password: string; nickname: string }) => void;
  setHomeInfo: (info: { home_name: string; home_address: string; home_lat: number; home_lng: number }) => void;
  reset: () => void;
}

const initialState = {
  email: '',
  password: '',
  nickname: '',
  home_name: '',
  home_address: '',
  home_lat: 0,
  home_lng: 0,
};

export const useSignUpStore = create<SignUpState>((set) => ({
  ...initialState,

  setBasicInfo: (info) => set(info),
  setHomeInfo: (info) => set(info),
  reset: () => set(initialState),
}));
