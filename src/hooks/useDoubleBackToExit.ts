import { useCallback, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { useFocusEffect } from 'expo-router';

// 앱 최상위 화면(스택에 더 이상 pop할 게 없는 화면)에서 뒤로가기를 누르면 원래도 조용히
// 백그라운드로 내려갈 뿐 프로세스가 죽지는 않는다(안드로이드 기본 동작) — 다만 사용자에게 그
// 사실이 안 보여서 "꺼진 건가?" 헷갈릴 수 있어, 한 번은 안내만 하고 실제 동작(백그라운드
// 전환)은 그대로 둔다. useFocusEffect로 이 화면이 실제 최상단일 때만 리스너를 걸어야, 위에
// 쌓인 다른 화면에서 누르는 뒤로가기(정상적인 화면 pop)까지 가로채지 않는다.
//
// onBackPressed: 시트 닫기 등 "종료 안내보다 먼저 처리해야 할 뒤로가기 동작"이 있으면 여기서
// 처리하고 true를 반환 — 그러면 이번 뒤로가기는 그 동작으로 소비되고 종료 안내 로직은 안 탄다.
export function useDoubleBackToExit(options?: { onBackPressed?: () => boolean; message?: string }) {
  const lastBackPressRef = useRef(0);
  const { onBackPressed, message = '한 번 더 누르면 종료됩니다' } = options ?? {};

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (onBackPressed?.()) return true;

        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          return false; // 기본 동작(백그라운드 전환) 허용
        }
        lastBackPressRef.current = now;
        ToastAndroid.show(message, ToastAndroid.SHORT);
        return true; // 이번 뒤로가기는 소비 — 기본 동작을 1회 막음
      });
      return () => sub.remove();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onBackPressed, message])
  );
}
