import { StyleSheet, Text, View } from 'react-native';

/** 예약 다단계 플로우 전용 스택 플레이스홀더 */
export function BookingNavigator() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>BookingNavigator</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14, opacity: 0.6 },
});
