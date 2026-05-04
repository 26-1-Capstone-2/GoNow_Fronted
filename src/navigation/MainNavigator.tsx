import { StyleSheet, Text, View } from 'react-native';

/** 홈·캘린더·탭 등 메인 영역 네비게이터 플레이스홀더 */
export function MainNavigator() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>MainNavigator</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14, opacity: 0.6 },
});
