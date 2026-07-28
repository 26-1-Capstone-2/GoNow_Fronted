import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppNavigation } from '@/src/navigation';
import { createAuthApi } from '@/src/api/auth';
import { createMembersApi } from '@/src/api/members';
import { useSignUpStore } from '@/src/store/signUpStore';
import { useAuthStore } from '@/src/store/authStore';
import * as Notifications from 'expo-notifications';

const authApi = createAuthApi();

export default function LeaveTimeSetupScreen() {
  const { goBack, goToPermissionSetup } = useAppNavigation();
  const email = useSignUpStore((s) => s.email);
  const password = useSignUpStore((s) => s.password);
  const nickname = useSignUpStore((s) => s.nickname);
  const home_name = useSignUpStore((s) => s.home_name);
  const home_address = useSignUpStore((s) => s.home_address);
  const home_lat = useSignUpStore((s) => s.home_lat);
  const home_lng = useSignUpStore((s) => s.home_lng);
  const resetSignUp = useSignUpStore((s) => s.reset);
  const setToken = useAuthStore((s) => s.setToken);
  const [minutes, setMinutes] = useState(10);
  const [loading, setLoading] = useState(false);

  const handleMinus = () => {
    if (minutes > 5) setMinutes((prev) => prev - 5);
  };

  const handlePlus = () => {
    if (minutes < 60) setMinutes((prev) => prev + 5);
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      await authApi.signUp({ email, password, nickname, home_name, home_address, home_lat, home_lng, preparation_time: minutes });

      const loginRes = await authApi.login({ email, password });
      setToken(loginRes.data.access_token);

      try {
        const tokenData = await Notifications.getDevicePushTokenAsync();
        await createMembersApi().registerFcmToken(tokenData.data);
      } catch {}

      resetSignUp();
      goToPermissionSetup();
    } catch (e: any) {
      Alert.alert('회원가입 실패', e?.message ?? '다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };
  return (
    <SafeAreaView style={styles.container}>
      {/* 뒤로가기 */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="뒤로"
      >
        <Text style={styles.backArrow}>‹</Text>
      </TouchableOpacity>

      {/* 타이틀 */}
      <View style={styles.header}>
        <Text style={styles.title}>여유시간 설정</Text>
      </View>

      {/* 안내 텍스트 */}
      <View style={styles.descContainer}>
        <Text style={styles.descTitle}>여유시간을 설정해주세요.</Text>
        <Text style={styles.descSub}>
          이 시간은 사용자가 실제로 나갈 준비를 하는{'\n'}
          준비시간 및 여유시간에 해당됩니다.
        </Text>
      </View>

      {/* 시간 선택 영역 */}
      <View style={styles.timePickerContainer}>
        <TouchableOpacity
          style={[styles.controlButton, minutes <= 5 && styles.controlButtonDisabled]}
          onPress={handleMinus}
          disabled={minutes <= 5}
        >
          <Text style={[styles.controlButtonText, minutes <= 5 && styles.controlButtonTextDisabled]}>－</Text>
        </TouchableOpacity>

        <View style={styles.timeDisplay}>
          <Text style={styles.timeNumber}>{minutes}</Text>
          <Text style={styles.timeUnit}>분</Text>
        </View>

        <TouchableOpacity
          style={[styles.controlButton, minutes >= 60 && styles.controlButtonDisabled]}
          onPress={handlePlus}
          disabled={minutes >= 60}
        >
          <Text style={[styles.controlButtonText, minutes >= 60 && styles.controlButtonTextDisabled]}>＋</Text>
        </TouchableOpacity>
      </View>

      {/* 빠른 선택 칩 */}
      <View style={styles.chipContainer}>
        {[5, 10, 15, 20, 30].map((min) => (
          <TouchableOpacity
            key={min}
            style={[styles.chip, minutes === min && styles.chipSelected]}
            onPress={() => setMinutes(min)}
          >
            <Text style={[styles.chipText, minutes === min && styles.chipTextSelected]}>
              {min}분
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 완료 버튼 */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.completeButton, loading && styles.completeButtonDisabled]}
          onPress={handleComplete}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={styles.completeButtonText}>완료</Text>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    position: 'absolute',
    top: 52,
    left: 20,
    zIndex: 10,
    padding: 4,
  },
  backArrow: {
    fontSize: 32,
    color: '#1A1A1A',
    lineHeight: 36,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  descContainer: {
    marginTop: 48,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  descTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
    textAlign: 'center',
  },
  descSub: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 22,
  },
  timePickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 56,
    gap: 28,
  },
  controlButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonDisabled: {
    borderColor: '#DDDDDD',
  },
  controlButtonText: {
    fontSize: 24,
    color: '#1A1A1A',
    lineHeight: 28,
  },
  controlButtonTextDisabled: {
    color: '#DDDDDD',
  },
  timeDisplay: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 120,
    justifyContent: 'center',
  },
  timeNumber: {
    fontSize: 64,
    fontWeight: '700',
    color: '#1A1A1A',
    lineHeight: 72,
  },
  timeUnit: {
    fontSize: 22,
    fontWeight: '500',
    color: '#555555',
    marginBottom: 10,
  },
  chipContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 36,
    paddingHorizontal: 24,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#DDDDDD',
    backgroundColor: '#FFFFFF',
  },
  chipSelected: {
    borderColor: '#1A1A1A',
    backgroundColor: '#1A1A1A',
  },
  chipText: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
    minWidth: 140,
    alignItems: 'center',
  },
  completeButtonDisabled: {
    backgroundColor: '#AAAAAA',
  },
  completeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});