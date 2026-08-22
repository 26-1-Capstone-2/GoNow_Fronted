import React, { useEffect, useState } from 'react';
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
import { getWebmailUrl } from '@/src/utils/webmail';

const authApi = createAuthApi();

// 서버(EmailVerificationService.RESEND_COOLDOWN)와 동일 — 버튼을 미리 비활성화해서
// "어차피 거부될 요청"을 안 보내는 용도. 실제 판정은 서버가 최종 담당.
const RESEND_COOLDOWN_SECONDS = 60;

// EmailVerificationService.sendCode()가 쿨다운 중 던지는 메시지 형식과 동일("33초 후 다시 시도해주세요.")
// ⚠️ 메시지 문자열에 의존하는 임시방편 — docs/planning/api-error-code-backlog.md 참고.
const COOLDOWN_MESSAGE_PATTERN = /^(\d+)초 후 다시 시도해주세요\.$/;

// 서버(PasswordResetRequest.newPassword)와 동일한 규칙: 공백 없는 영문/숫자/특수문자 8~64자
const PASSWORD_REGEX = /^[\x21-\x7E]{8,64}$/;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 백엔드 EmailVerificationService.VERIFIED_GRACE(10분)와 동일한 로컬 추정값.
// newPassword 단계에서 실수로 뒤로가기를 눌러도 이미 인증된 상태면 코드 재입력 없이 넘어가게 하는 용도 —
// 회원가입(EmailVerifyScreen)과 달리 화면이 하나(스택 이동 없음)라 스토어 없이 로컬 state로만 충분하다.
const LOCAL_VERIFIED_GRACE_MS = 10 * 60 * 1000;

type Step = 'email' | 'code' | 'newPassword' | 'done';

export default function PasswordResetScreen() {
  const { goBack, goToLogin } = useAppNavigation();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  // 알려진 이메일 서비스면 문구의 이메일 부분을 탭해서 웹메일로 바로 이동시켜준다(모르는 도메인이면 null).
  const webmailUrl = getWebmailUrl(email);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  // 인증 완료된 이메일/시각 — code 단계에서 재입력 없이 넘어갈 수 있는지 판단하는 데만 쓰는 로컬 추정값.
  // 실제 만료 판정은 서버(비밀번호 재설정 시점의 isRecentlyVerified())가 최종 담당.
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);
  const alreadyVerified =
    verifiedEmail === email && verifiedAt !== null && Date.now() - verifiedAt < LOCAL_VERIFIED_GRACE_MS;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async () => {
    setErrorMsg('');
    try {
      await authApi.sendEmailVerification(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep('code');
    } catch (e) {
      const message = getErrorMessage(e, '인증코드 발송에 실패했습니다.');
      const cooldownMatch = message.match(COOLDOWN_MESSAGE_PATTERN);
      if (cooldownMatch) {
        // 직전에 이미 발송된 상태 — 에러로 취급하지 않고 코드 입력 단계로 넘겨서 이어서 진행
        setCooldown(Number(cooldownMatch[1]));
        setStep('code');
      } else {
        setErrorMsg(message);
      }
    }
  };

  const handleSendCode = async () => {
    if (!EMAIL_REGEX.test(email) || sending) return;
    // 뒤로가기를 여러 번 거쳐도(code → email → code) 이메일이 그대로면 재발송/재인증 없이 바로 이어가도록.
    if (alreadyVerified) {
      setStep('code');
      return;
    }
    setSending(true);
    try {
      await sendCode();
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await sendCode();
    } finally {
      setResending(false);
    }
  };

  const handleConfirmCode = async () => {
    if (code.length !== 6 || confirming) return;
    setConfirming(true);
    setErrorMsg('');
    try {
      await authApi.confirmEmailVerification(email, code);

      // 코드 확인(=이메일 소유 증명)까지 통과한 뒤라 계정 존재 여부를 알려줘도 안전한 시점 —
      // 새 비밀번호까지 입력시킨 뒤에야 걸러내지 않도록 여기서 바로 확인한다.
      try {
        const existsRes = await authApi.checkEmail(email);
        if (!existsRes.data.exists) {
          setErrorMsg('가입된 계정이 없습니다.');
          return;
        }
      } catch {
        // 존재 확인 자체가 실패해도(네트워크 오류 등) 막지 않고 통과시킨다 — 최종 안전망인
        // password-reset 호출이 어차피 다시 검증하므로, 여기서 오탐으로 막는 것보다 안전하다.
      }

      setVerifiedEmail(email);
      setVerifiedAt(Date.now());
      setStep('newPassword');
    } catch (e) {
      setErrorMsg(getErrorMessage(e, '인증코드 확인에 실패했습니다.'));
    } finally {
      setConfirming(false);
    }
  };

  // 인증 유효시간(10분)이 지나 재설정이 거부된 경우 등 — 처음(이메일 입력)부터 다시 시도.
  // verifiedEmail/verifiedAt은 일부러 안 지운다 — 이메일을 안 바꾸고 왔다 갔다 하는 거면
  // alreadyVerified가 그대로 유지돼야 재인증 없이 넘어갈 수 있음(email을 실제로 바꾸면
  // alreadyVerified 계산식(verifiedEmail === email)이 자연히 false가 되므로 그때만 새로 인증하면 됨).
  const restartFromEmail = () => {
    setStep('email');
    setCode('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setErrorMsg('');
  };

  // newPassword 단계에서 뒤로가기 — 이미 인증된 상태라 code를 다시 입력할 필요는 없으므로
  // (code 자체는 확인 시 서버에서 이미 소진됨) 완전 초기화 대신 code 단계로 한 칸만 되돌아간다.
  const backToCode = () => {
    setStep('code');
    setErrorMsg('');
  };

  const canReset =
    PASSWORD_REGEX.test(newPassword) && newPassword === newPasswordConfirm && !resetting;

  const handleReset = async () => {
    if (!canReset) return;
    setResetting(true);
    setErrorMsg('');
    try {
      await authApi.resetPassword(email, newPassword);
      setStep('done');
    } catch (e) {
      setErrorMsg(getErrorMessage(e, '비밀번호 재설정에 실패했습니다.'));
    } finally {
      setResetting(false);
    }
  };

  const isPasswordInvalid = newPassword.length > 0 && !PASSWORD_REGEX.test(newPassword);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.content}>
          {/* 뒤로가기 — 완료 화면에선 로그인으로 명확히 이동시키는 버튼만 노출 */}
          {step !== 'done' && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={step === 'email' ? goBack : step === 'code' ? restartFromEmail : backToCode}
              accessibilityRole="button"
              accessibilityLabel="뒤로"
            >
              <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.title}>비밀번호 찾기</Text>

          {step === 'email' && (
            <>
              <Text style={styles.desc}>가입하신 이메일로 인증코드를 보내드려요.</Text>
              <Text style={styles.label}>E-mail</Text>
              <TextInput
                style={styles.input}
                placeholder="email@email.com"
                placeholderTextColor="#BBBBBB"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
              />
              {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
            </>
          )}

          {step === 'code' && alreadyVerified && (
            <Text style={styles.desc}>
              {email}은 이미 인증된 이메일이에요.{'\n'}바로 다음으로 진행할 수 있어요.
            </Text>
          )}

          {step === 'code' && !alreadyVerified && (
            <>
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
              {errorMsg ? (
                <Text style={[styles.errorText, styles.errorTextCenter]}>{errorMsg}</Text>
              ) : null}

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
            </>
          )}

          {step === 'newPassword' && (
            <>
              <Text style={styles.desc}>새로 사용할 비밀번호를 입력해주세요.</Text>
              <Text style={styles.label}>새 비밀번호</Text>
              <TextInput
                style={[styles.input, isPasswordInvalid && styles.inputError]}
                placeholder="비밀번호"
                placeholderTextColor="#BBBBBB"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
              {isPasswordInvalid && (
                <Text style={styles.errorText}>공백 없는 영문/숫자/특수문자로 8~64자여야 합니다.</Text>
              )}

              <Text style={[styles.label, { marginTop: 16 }]}>새 비밀번호 확인</Text>
              <TextInput
                style={[
                  styles.input,
                  newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm
                    ? styles.inputError
                    : null,
                ]}
                placeholder="비밀번호 확인"
                placeholderTextColor="#BBBBBB"
                value={newPasswordConfirm}
                onChangeText={setNewPasswordConfirm}
                secureTextEntry
              />
              {newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm && (
                <Text style={styles.errorText}>비밀번호가 일치하지 않습니다.</Text>
              )}
              {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
            </>
          )}

          {step === 'done' && (
            <Text style={styles.desc}>비밀번호가 재설정됐어요.{'\n'}새 비밀번호로 로그인해주세요.</Text>
          )}
        </View>

        {/* 하단 버튼 — 단계별로 동작만 바뀜 */}
        <View style={styles.footer}>
          {step === 'email' && (
            <TouchableOpacity
              style={[styles.confirmButton, !EMAIL_REGEX.test(email) && styles.confirmButtonDisabled]}
              onPress={handleSendCode}
              disabled={!EMAIL_REGEX.test(email) || sending}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmButtonText}>인증코드 받기</Text>
              )}
            </TouchableOpacity>
          )}

          {step === 'code' && alreadyVerified && (
            <TouchableOpacity style={styles.confirmButton} onPress={() => setStep('newPassword')}>
              <Text style={styles.confirmButtonText}>다음</Text>
            </TouchableOpacity>
          )}

          {step === 'code' && !alreadyVerified && (
            <TouchableOpacity
              style={[styles.confirmButton, code.length !== 6 && styles.confirmButtonDisabled]}
              onPress={handleConfirmCode}
              disabled={code.length !== 6 || confirming}
            >
              {confirming ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmButtonText}>확인</Text>
              )}
            </TouchableOpacity>
          )}

          {step === 'newPassword' && (
            <TouchableOpacity
              style={[styles.confirmButton, !canReset && styles.confirmButtonDisabled]}
              onPress={handleReset}
              disabled={!canReset}
            >
              {resetting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmButtonText}>비밀번호 재설정</Text>
              )}
            </TouchableOpacity>
          )}

          {step === 'done' && (
            <TouchableOpacity style={styles.confirmButton} onPress={goToLogin}>
              <Text style={styles.confirmButtonText}>로그인하러 가기</Text>
            </TouchableOpacity>
          )}
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
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1.5,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#1A1A1A',
    backgroundColor: '#FFFFFF',
  },
  inputError: {
    borderColor: '#FF4444',
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
  },
  errorTextCenter: {
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
