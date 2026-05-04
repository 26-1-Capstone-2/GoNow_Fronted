import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="personal" />
      <Tabs.Screen name="group" />
      <Tabs.Screen name="home-alarm" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="year-calendar" />
    </Tabs>
  );
}