import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { createAuthApi } from '@/src/api/auth';
import { useAppNavigation } from '@/src/navigation';
import { useSignUpStore } from '@/src/store/signUpStore';

const authApi = createAuthApi();

type FieldStatus = 'idle' | 'checking' | 'ok' | 'error';

export default function SignUpScreen() {
  const { goBack, goToHomeAddressSetup } = useAppNavigation();
  const setBasicInfo = useSignUpStore((s) => s.setBasicInfo);

  const [email, setEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState<FieldStatus>('idle');
  const [emailMsg, setEmailMsg] = useState('');

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const [nickname, setNickname] = useState('');
  const [nicknameStatus, setNicknameStatus] = useState<FieldStatus>('idle');
  const [nicknameMsg, setNicknameMsg] = useState('');

  const handleEmailBlur = async () => {
    if (!email) return;
    setEmailStatus('checking');
    try {
      const res = await authApi.checkEmail(email);
      setEmailStatus(res.success ? 'ok' : 'error');
      setEmailMsg(res.message);
    } catch {
      setEmailStatus('error');
      setEmailMsg('이미 사용 중인 이메일입니다.');
    }
  };

  const handleNicknameBlur = async () => {
    if (!nickname) return;
    setNicknameStatus('checking');
    try {
      const res = await authApi.checkNickname(nickname);
      setNicknameStatus(res.success ? 'ok' : 'error');
      setNicknameMsg(res.message);
    } catch {
      setNicknameStatus('error');
      setNicknameMsg('이미 사용 중인 닉네임입니다.');
    }
  };

  const canProceed =
    emailStatus === 'ok' &&
    nicknameStatus === 'ok' &&
    password.length > 0 &&
    password === passwordConfirm;

  const handleNext = () => {
    if (!canProceed) return;
    setBasicInfo({ email, password, nickname });
    goToHomeAddressSetup();
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 뒤로가기 */}
          <TouchableOpacity style={styles.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="뒤로">
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>

          {/* 타이틀 */}
          <Text style={styles.title}>회원가입</Text>

          {/* 폼 */}
          <View style={styles.formContainer}>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={[
                styles.input,
                emailStatus === 'ok' && styles.inputOk,
                emailStatus === 'error' && styles.inputError,
              ]}
              placeholder="email@email.com"
              placeholderTextColor="#BBBBBB"
              value={email}
              onChangeText={(t) => { setEmail(t); setEmailStatus('idle'); setEmailMsg(''); }}
              onBlur={handleEmailBlur}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {emailMsg ? (
              <Text style={emailStatus === 'ok' ? styles.okText : styles.errorText}>
                {emailStatus === 'checking' ? '확인 중...' : emailMsg}
              </Text>
            ) : null}
            {emailStatus === 'checking' && (
              <Text style={styles.checkingText}>확인 중...</Text>
            )}

            <Text style={styles.label}>비밀번호</Text>
            <TextInput
              style={styles.input}
              placeholder="비밀번호"
              placeholderTextColor="#BBBBBB"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Text style={styles.label}>비밀번호 확인</Text>
            <TextInput
              style={[
                styles.input,
                passwordConfirm.length > 0 && password !== passwordConfirm
                  ? styles.inputError
                  : null,
                passwordConfirm.length > 0 && password === passwordConfirm
                  ? styles.inputOk
                  : null,
              ]}
              placeholder="비밀번호 확인"
              placeholderTextColor="#BBBBBB"
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
              secureTextEntry
            />
            {passwordConfirm.length > 0 && password !== passwordConfirm && (
              <Text style={styles.errorText}>비밀번호가 일치하지 않습니다.</Text>
            )}

            <Text style={styles.label}>닉네임</Text>
            <TextInput
              style={[
                styles.input,
                nicknameStatus === 'ok' && styles.inputOk,
                nicknameStatus === 'error' && styles.inputError,
              ]}
              placeholder="12글자 이내로 입력하세요."
              placeholderTextColor="#BBBBBB"
              value={nickname}
              onChangeText={(t) => { if (t.length <= 12) { setNickname(t); setNicknameStatus('idle'); setNicknameMsg(''); } }}
              onBlur={handleNicknameBlur}
              maxLength={12}
            />
            {nicknameMsg ? (
              <Text style={nicknameStatus === 'ok' ? styles.okText : styles.errorText}>
                {nicknameMsg}
              </Text>
            ) : null}
            {nicknameStatus === 'checking' && (
              <Text style={styles.checkingText}>확인 중...</Text>
            )}
          </View>

          {/* 다음 버튼 */}
          <TouchableOpacity
            style={[styles.signUpButton, !canProceed && styles.signUpButtonDisabled]}
            onPress={handleNext}
            disabled={!canProceed}
          >
            <Text style={styles.signUpButtonText}>다음</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 32,
    paddingBottom: 40,
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
    marginBottom: 32,
  },
  formContainer: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
    marginBottom: 6,
    marginTop: 16,
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
  inputOk: {
    borderColor: '#4CAF50',
  },
  inputError: {
    borderColor: '#FF4444',
  },
  okText: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#FF4444',
    marginTop: 4,
  },
  checkingText: {
    fontSize: 12,
    color: '#AAAAAA',
    marginTop: 4,
  },
  signUpButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 36,
  },
  signUpButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  signUpButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
