import {
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';

type AppButtonProps = PressableProps & {
  title: string;
  variant?: 'primary' | 'secondary';
};

export function AppButton({
  title,
  variant = 'primary',
  style,
  ...rest
}: AppButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        style as ViewStyle,
      ]}
      {...rest}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.labelPrimary : styles.labelSecondary,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: '#111' },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  pressed: { opacity: 0.85 },
  label: { fontSize: 16, fontWeight: '600' },
  labelPrimary: { color: '#fff' },
  labelSecondary: { color: '#111' },
});
