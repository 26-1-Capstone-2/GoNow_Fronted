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

import { useAppNavigation } from '@/src/navigation';

export default function SignUpScreen() {
  const { goBack, goToHomeAddressSetup } = useAppNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [nickname, setNickname] = useState('');

  const handleNext = () => {
    // TODO: API 연동
    console.log({ email, password, nickname });
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
              style={styles.input}
              placeholder="email@email.com"
              placeholderTextColor="#BBBBBB"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

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
              style={styles.input}
              placeholder="12글자 이내로 입력하세요."
              placeholderTextColor="#BBBBBB"
              value={nickname}
              onChangeText={(t) => t.length <= 12 && setNickname(t)}
              maxLength={12}
            />
          </View>

          {/* 다음 버튼 */}
          <TouchableOpacity style={styles.signUpButton} onPress={handleNext}>
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
  inputError: {
    borderColor: '#FF4444',
  },
  errorText: {
    fontSize: 12,
    color: '#FF4444',
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
  signUpButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
