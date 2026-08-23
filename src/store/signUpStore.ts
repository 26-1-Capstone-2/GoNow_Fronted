import { create } from 'zustand';

interface SignUpState {
  email: string;
  password: string;
  nickname: string;
  home_name: string;
  home_address: string;
  home_lat: number;
  home_lng: number;
  // 이메일 인증에 성공한 이메일/시각 기록 — 뒤로가기 후 이메일을 안 바꾸고 재진입했을 때
  // 재발송 없이 건너뛸 수 있는지 판단하는 데 씀(EmailVerifyScreen). 백엔드가 여전히 최종 판단자라
  // 이 값이 틀려도(추정이 어긋나도) leave-time-setup의 복구 흐름이 안전망 역할을 함.
  verifiedEmail: string | null;
  verifiedAt: number | null;

  setBasicInfo: (info: { email: string; password: string; nickname: string }) => void;
  setHomeInfo: (info: { home_name: string; home_address: string; home_lat: number; home_lng: number }) => void;
  setVerified: (email: string) => void;
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
  verifiedEmail: null as string | null,
  verifiedAt: null as number | null,
};

export const useSignUpStore = create<SignUpState>((set) => ({
  ...initialState,

  setBasicInfo: (info) => set(info),
  setHomeInfo: (info) => set(info),
  setVerified: (email) => set({ verifiedEmail: email, verifiedAt: Date.now() }),
  reset: () => set(initialState),
}));
