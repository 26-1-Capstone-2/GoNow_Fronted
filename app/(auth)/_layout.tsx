import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

export const unstable_settings = {
  initialRouteName: 'login' as const,
};

export default function AuthLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="home-address-setup" />
      <Stack.Screen name="leave-time-setup" />
    </Stack>
  );
}
