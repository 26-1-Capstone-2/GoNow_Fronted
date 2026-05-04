import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

type AppTextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
};

export function AppTextField({ label, error, style, ...rest }: AppTextFieldProps) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#999"
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500', color: '#222' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111',
  },
  inputError: { borderColor: '#c00' },
  error: { fontSize: 12, color: '#c00' },
});
