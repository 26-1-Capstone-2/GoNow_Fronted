import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createAuthApi } from '@/src/api/auth';
import { getErrorMessage } from '@/src/api/client';
import { useAppNavigation } from '@/src/navigation';
import { useSignUpStore } from '@/src/store/signUpStore';
import { getWebmailUrl } from '@/src/utils/webmail';

const authApi = createAuthApi();

// 서버(EmailVerificationService.RESEND_COOLDOWN)와 동일하게 맞춘 UI용 값 — 실제 판정은 서버가 최종 담당,
// 여기선 버튼을 미리 비활성화해서 "어차피 거부될 요청"을 안 보내는 용도.
const RESEND_COOLDOWN_SECONDS = 60;

// EmailVerificationService.sendCode()가 쿨다운 중 던지는 메시지 형식과 동일하게 맞춤("33초 후 다시 시도해주세요.").
// 뒤로가기 후 재진입 등 어떤 경로로 오든, 서버가 알려준 실제 남은 시간으로 카운트다운을 동기화하기 위해 파싱한다.
// ⚠️ 이것도 메시지 문자열에 의존하는 임시방편 — docs/planning/api-error-code-backlog.md 참고.
const COOLDOWN_MESSAGE_PATTERN = /^(\d+)초 후 다시 시도해주세요\.$/;

// 백엔드 EmailVerificationService.VERIFIED_GRACE(10분)와 동일한 로컬 추정값.
// 뒤로가기 후 이메일을 안 바꾸고 재진입했을 때 재발송을 건너뛸지 판단하는 데만 쓰는 "추정"이라,
// 실제로 어긋나도(백엔드 유예가 이미 끝났어도) 안전함 — leave-time-setup의 recovery 흐름이 최종 안전망.
const LOCAL_VERIFIED_GRACE_MS = 10 * 60 * 1000;

export default function EmailVerifyScreen() {
  const { goBack, goToHomeAddressSetup } = useAppNavigation();
  const email = useSignUpStore((s) => s.email);
  // 알려진 이메일 서비스면 문구의 이메일 부분을 탭해서 웹메일로 바로 이동시켜준다(모르는 도메인이면 null).
  const webmailUrl = getWebmailUrl(email);
  const verifiedEmail = useSignUpStore((s) => s.verifiedEmail);
  const verifiedAt = useSignUpStore((s) => s.verifiedAt);
  const setVerified = useSignUpStore((s) => s.setVerified);
  // leave-time-setup에서 인증 만료로 되돌아온 경우(recovery)엔 앞으로(home-address-setup) 가면
  // 이미 입력한 주소/여유시간을 또 물어보게 되므로, 뒤로(leave-time-setup)로 돌려보낸다.
  const { recovery } = useLocalSearchParams<{ recovery?: string }>();
  const isRecovery = recovery === '1';

  // 뒤로가기 후 이메일을 그대로 두고 재진입한 경우, 재발송/재입력 없이 바로 통과시킨다.
  // recovery 모드에선 절대 적용 안 함 — 그 상황은 애초에 유예가 끝났다는 뜻이라 스킵하면 무한루프에 빠짐.
  const [alreadyVerified] = useState(
    () =>
      !isRecovery &&
      verifiedEmail === email &&
      verifiedAt !== null &&
      Date.now() - verifiedAt < LOCAL_VERIFIED_GRACE_MS,
  );

  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const hasSentRef = useRef(alreadyVerified);

  const sendCode = async () => {
    setErrorMsg('');
    try {
      await authApi.sendEmailVerification(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      const message = getErrorMessage(e, '인증코드 발송에 실패했습니다.');
      const cooldownMatch = message.match(COOLDOWN_MESSAGE_PATTERN);
      if (cooldownMatch) {
        // 뒤로가기 후 재진입 등으로 이미 쿨다운 중이었던 경우 — 에러로 취급하지 않고
        // 실제 남은 시간으로 카운트다운을 맞춰서 "재전송" 버튼 문구가 자연스럽게 줄어들게 한다.
        setCooldown(Number(cooldownMatch[1]));
      } else {
        setErrorMsg(message);
      }
    }
  };

  // 화면 진입 시 1회 자동 발송
  useEffect(() => {
    if (hasSentRef.current) return;
    hasSentRef.current = true;
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await sendCode();
    } finally {
      setResending(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 6 || confirming) return;
    setConfirming(true);
    setErrorMsg('');
    try {
      await authApi.confirmEmailVerification(email, code);
      setVerified(email);
      if (isRecovery) {
        goBack(); // leave-time-setup으로 복귀 — 이미 입력한 주소/여유시간 재입력 불필요
      } else {
        goToHomeAddressSetup();
      }
    } catch (e) {
      setErrorMsg(getErrorMessage(e, '인증코드 확인에 실패했습니다.'));
    } finally {
      setConfirming(false);
    }
  };

  const canConfirm = code.length === 6 && !confirming;

  if (alreadyVerified) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="뒤로"
          >
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>

          <Text style={styles.title}>이메일 인증</Text>
          <Text style={styles.desc}>
            {email}은 이미 인증된 이메일이에요.{'\n'}바로 다음으로 진행할 수 있어요.
          </Text>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.confirmButton} onPress={goToHomeAddressSetup}>
            <Text style={styles.confirmButtonText}>다음</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.content}>
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
          <Text style={styles.title}>이메일 인증</Text>
          <Text style={styles.desc}>
            {webmailUrl ? (
              <Text style={styles.emailLink} onPress={() => Linking.openURL(webmailUrl)}>
                {email}
              </Text>
            ) : (
              email
            )}
            로 인증코드를 보냈어요.{'\n'}5분 이내에 입력해주세요.
          </Text>

          {/* 코드 입력 */}
          <TextInput
            style={styles.codeInput}
            placeholder="6자리 코드 입력"
            placeholderTextColor="#BBBBBB"
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {/* 재전송 */}
          <TouchableOpacity
            style={styles.resendButton}
            onPress={handleResend}
            disabled={cooldown > 0 || resending}
          >
            {resending ? (
              <ActivityIndicator size="small" color="#888888" />
            ) : (
              <Text style={[styles.resendText, cooldown > 0 && styles.resendTextDisabled]}>
                {cooldown > 0 ? `${cooldown}초 후 재전송 가능` : '인증코드 재전송'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 확인 버튼 */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={!canConfirm}
          >
            {confirming ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.confirmButtonText}>확인</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
  },
  backButton: {
    marginTop: 16,
    marginBottom: 8,
  },
  backArrow: {
    fontSize: 32,
    color: '#1A1A1A',
    lineHeight: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  desc: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  emailLink: {
    color: '#1A1A1A',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  codeInput: {
    width: '100%',
    height: 52,
    borderWidth: 1.5,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 20,
    letterSpacing: 8,
    textAlign: 'center',
    color: '#1A1A1A',
    backgroundColor: '#FFFFFF',
  },
  errorText: {
    fontSize: 12,
    color: '#FF4444',
    marginTop: 8,
    textAlign: 'center',
  },
  resendButton: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
  },
  resendText: {
    fontSize: 14,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  resendTextDisabled: {
    color: '#AAAAAA',
  },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  confirmButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
