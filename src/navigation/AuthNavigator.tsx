import { StyleSheet, Text, View } from 'react-native';

/** 로그인·회원가입 플로우용 스택/그룹 (구현 시 @react-navigation/native-stack 등과 연결) */
export function AuthNavigator() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>AuthNavigator</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14, opacity: 0.6 },
});
