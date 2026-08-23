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
import { getErrorMessage } from '@/src/api/client';
import { useSignUpStore } from '@/src/store/signUpStore';
import { useAuthStore } from '@/src/store/authStore';
import * as Notifications from 'expo-notifications';

const authApi = createAuthApi();

// MemberService.signUp()이 이메일 인증 미완료/만료 시 던지는 메시지 원문과 동일하게 맞춤.
// 이 화면까지 왔다는 건 email-verify에서 이미 확인(confirm)에 성공했다는 뜻이라,
// 여기서 이 메시지가 뜨면 "인증 안 함"이 아니라 100% "10분 유효시간 만료"로 확정할 수 있다
// (백엔드는 Redis TTL 특성상 이 둘을 구분 못 해서 일부러 문구를 애매하게 남겨둠 — 프론트만 아는 문맥).
//
// ⚠️ 문자열 매칭이라 깨지기 쉬움: 서버 응답에 code 필드가 없어서(ApiResult가 message만 줌)
// 임시로 message 문구를 그대로 비교한다. 백엔드에서 이 문구를 조금이라도 바꾸면
// 이 분기는 예외 없이 조용히 else(일반 실패 알럿)로 빠지고 재인증 자동이동만 없어진다.
// 백엔드 message를 바꿀 일이 있으면 이 상수도 반드시 같이 바꿀 것.
// 근본 해결책(에러 코드 필드 도입)은 docs/planning/api-error-code-backlog.md 참고.
const EMAIL_VERIFICATION_REQUIRED_MESSAGE = '이메일 인증을 먼저 완료해주세요.';

export default function LeaveTimeSetupScreen() {
  const { goBack, goToEmailVerify, goToPermissionSetup } = useAppNavigation();
  const email = useSignUpStore((s) => s.email);
  const password = useSignUpStore((s) => s.password);
  const nickname = useSignUpStore((s) => s.nickname);
  const home_name = useSignUpStore((s) => s.home_name);
  const home_address = useSignUpStore((s) => s.home_address);
  const home_lat = useSignUpStore((s) => s.home_lat);
  const home_lng = useSignUpStore((s) => s.home_lng);
  const resetSignUp = useSignUpStore((s) => s.reset);
  const setToken = useAuthStore((s) => s.setToken);
  const setRefreshToken = useAuthStore((s) => s.setRefreshToken);
  const setMemberId = useAuthStore((s) => s.setMemberId);
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
      setRefreshToken(loginRes.data.refresh_token);
      setMemberId(loginRes.data.member_id);

      try {
        const tokenData = await Notifications.getDevicePushTokenAsync();
        await createMembersApi().registerFcmToken(tokenData.data);
      } catch {}

      resetSignUp();
      goToPermissionSetup();
    } catch (e) {
      const message = getErrorMessage(e, '다시 시도해주세요.');
      if (message === EMAIL_VERIFICATION_REQUIRED_MESSAGE) {
        Alert.alert(
          '이메일 인증 유효시간(10분)이 지났어요',
          '다시 인증해주세요.',
          [{ text: '확인', onPress: () => goToEmailVerify({ recovery: true }) }],
        );
      } else {
        Alert.alert('회원가입 실패', message);
      }
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
    borderColor: '#FFCE0C',
    backgroundColor: '#FFCE0C',
  },
  chipText: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#1A1A1A',
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: '#FFCE0C',
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
    fontWeight: '700',
    color: '#1A1A1A',
  },
});