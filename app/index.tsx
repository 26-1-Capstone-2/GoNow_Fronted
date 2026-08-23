import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore, TOKEN_KEY, REFRESH_TOKEN_KEY, MEMBER_ID_KEY } from '@/src/store/authStore';

export default function Index() {
  const token = useAuthStore(s => s.token);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      AsyncStorage.getItem(MEMBER_ID_KEY),
    ]).then(([saved, savedRefreshToken, savedMemberId]) => {
      if (saved) useAuthStore.getState().setToken(saved);
      if (savedRefreshToken) useAuthStore.getState().setRefreshToken(savedRefreshToken);
      if (savedMemberId) useAuthStore.getState().setMemberId(Number(savedMemberId));
      setReady(true);
    });
  }, []);

  if (!ready) return <View />;
  if (token) return <Redirect href="/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
