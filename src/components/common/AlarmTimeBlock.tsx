import { AlarmTimeDisplay } from '@/src/utils/alarmTimeDisplay';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  display: AlarmTimeDisplay;
  // 이동수단 아이콘, 반복 라벨 등 sub 줄 끝에 붙는 요소 (카드마다 다르므로 호출부에서 전달)
  trailing?: React.ReactNode;
}

export default function AlarmTimeBlock({ display, trailing }: Props) {
  return (
    <View>
      <Text style={styles.hero} numberOfLines={1}>{display.heroText}</Text>
      <View style={styles.subRow}>
        <Text style={styles.sub} numberOfLines={1}>{display.subText}</Text>
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', marginBottom: 3 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sub: { fontSize: 12, fontWeight: '500', color: '#8A8A8E' },
});
