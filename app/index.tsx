import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore, TOKEN_KEY, REFRESH_TOKEN_KEY, MEMBER_ID_KEY } from '@/src/store/authStore';
import { createMembersApi } from '@/src/api/members';

export default function Index() {
  const token = useAuthStore(s => s.token);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      AsyncStorage.getItem(MEMBER_ID_KEY),
    ]).then(async ([saved, savedRefreshToken, savedMemberId]) => {
      if (saved) useAuthStore.getState().setToken(saved);
      if (savedRefreshToken) useAuthStore.getState().setRefreshToken(savedRefreshToken);
      if (savedMemberId) useAuthStore.getState().setMemberId(Number(savedMemberId));

      if (saved) {
        // 저장된 토큰이 있어도 지금 서버 기준으로 유효한지 확인한다 — 다른 백엔드에서
        // 발급된 토큰이거나 만료된 경우, client.ts의 401 처리(재발급 시도 → 실패 시 토큰
        // 초기화 + 로그인 화면 이동)가 여기서 자동으로 실행된다.
        try {
          await createMembersApi().getMyProfile();
        } catch {
          // client.ts가 이미 토큰 초기화를 처리했으므로 아래 setReady 이후
          // token이 null이 되어 로그인 화면으로 리다이렉트된다.
        }
      }
      setReady(true);
    });
  }, []);

  if (!ready) return <View />;
  if (token) return <Redirect href="/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
