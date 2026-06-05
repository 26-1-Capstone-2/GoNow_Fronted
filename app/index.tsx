import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore, TOKEN_KEY } from '@/src/store/authStore';

export default function Index() {
  const token = useAuthStore(s => s.token);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY).then((saved) => {
      if (saved) useAuthStore.getState().setToken(saved);
      setReady(true);
    });
  }, []);

  if (!ready) return <View />;
  if (token) return <Redirect href="/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
