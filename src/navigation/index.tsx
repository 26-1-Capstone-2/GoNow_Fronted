/**
 * 루트 네비게이터 진입점.
 * Expo Router(`app/`)를 쓰는 경우 화면은 라우트에서 `src/screens` 컴포넌트를 감싸 연결하면 됩니다.
 * React Navigation 단독 스택이 필요하면 여기서 `NavigationContainer`와 최상위 Stack을 구성합니다.
 */
export { AuthNavigator } from './AuthNavigator';
export { MainNavigator } from './MainNavigator';
export { BookingNavigator } from './BookingNavigator';
