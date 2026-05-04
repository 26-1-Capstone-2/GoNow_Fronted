import type { NavigatorScreenParams } from '@react-navigation/native';

/** React Navigation + Expo Router 혼용 시 파라미터 타입 예시 */
export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

export type BookingStackParamList = {
  BookingList: undefined;
  BookingDetail: { id: string };
  TimeSelect: { bookingId?: string };
  BookingConfirm: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Calendar: undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  BookingFlow: NavigatorScreenParams<BookingStackParamList>;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
