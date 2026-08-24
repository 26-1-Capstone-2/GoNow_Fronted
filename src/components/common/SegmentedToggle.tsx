import { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type SegmentedToggleOption<T extends string> = {
  value: T;
  label: string;
  icon?: (selected: boolean) => ReactNode;
};

type Props<T extends string> = {
  options: readonly [SegmentedToggleOption<T>, SegmentedToggleOption<T>];
  value: T;
  onChange: (value: T) => void;
};

// 개인/그룹/귀가 알람 생성·수정 화면(단일/전체목록 6곳)에서 "이동 수단"과 "막차/데드라인 기준"
// 선택에 공통으로 쓰던, 토씨 하나 안 다르게 복붙되어 있던 2択 pill 토글을 공용화한 것.
export function SegmentedToggle<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.track}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.btn, selected && styles.btnSelected]}
            onPress={() => onChange(opt.value)}
          >
            {opt.icon?.(selected)}
            <Text style={[styles.text, selected && styles.textSelected]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: '#F0F0F1', borderRadius: 16, padding: 4, gap: 4 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11 },
  btnSelected: { backgroundColor: '#FFCE0C' },
  text: { fontSize: 13, fontWeight: '600', color: '#8A8A8E' },
  textSelected: { color: '#1A1A1A', fontWeight: '700' },
});
