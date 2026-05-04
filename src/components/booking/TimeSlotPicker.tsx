import { StyleSheet, Text, View } from 'react-native';

/** 시간 슬롯 선택 UI — 디자인 확정 후 슬롯 그리드·리스트로 확장 */
export function TimeSlotPicker() {
  return (
    <View style={styles.box}>
      <Text style={styles.hint}>TimeSlotPicker</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: 13, color: '#888' },
});
