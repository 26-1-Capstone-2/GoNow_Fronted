import { createMembersApi } from '@/src/api/members';
import { getErrorMessage } from '@/src/api/client';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const membersApi = createMembersApi();

// 서버(PasswordUpdateRequest.newPassword)와 동일한 규칙: 공백 없는 영문/숫자/특수문자 8~64자
const PASSWORD_REGEX = /^[\x21-\x7E]{8,64}$/;

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const isNewPasswordInvalid = newPassword.length > 0 && !PASSWORD_REGEX.test(newPassword);
  // 서버(MemberService.updatePassword)와 동일한 규칙 — 기존과 같은 비밀번호로는 변경 불가
  const isSamePassword =
    currentPassword.length > 0 && newPassword.length > 0 && currentPassword === newPassword;
  const isValid = currentPassword.trim() && PASSWORD_REGEX.test(newPassword) && confirmPassword.trim();
  const isMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSave = async () => {
    if (!isValid || isMismatch || isSamePassword) return;
    setLoading(true);
    try {
      await membersApi.updatePassword(currentPassword, newPassword);
      router.back();
    } catch (e) {
      Alert.alert('변경 실패', getErrorMessage(e, '현재 비밀번호를 확인해주세요.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="chevron-left" size={26} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.title}>비밀번호 변경</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* 입력창 3개가 세로로 쌓여있어, 아래쪽 "새 비밀번호 확인" 포커스 시 키보드에 가려질 수
          있었다(2026-08-25 발견) — KeyboardAvoidingView + ScrollView로 감싸서 포커스된
          입력창으로 자동 스크롤되게 한다(LoginScreen.tsx 등과 동일 패턴). */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>새로운 비밀번호를 입력해주세요.</Text>

          <Text style={styles.inputLabel}>현재 비밀번호</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#BBBBBB"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
          />

          <Text style={styles.inputLabel}>새 비밀번호</Text>
          <TextInput
            style={[styles.input, (isNewPasswordInvalid || isSamePassword) && styles.inputError]}
            placeholder=""
            placeholderTextColor="#BBBBBB"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
          />
          {isNewPasswordInvalid && (
            <Text style={styles.errorText}>공백 없는 영문/숫자/특수문자로 8~64자여야 합니다.</Text>
          )}
          {!isNewPasswordInvalid && isSamePassword && (
            <Text style={styles.errorText}>기존 비밀번호와 다른 비밀번호를 입력해주세요.</Text>
          )}

          <Text style={styles.inputLabel}>새 비밀번호 확인</Text>
          <TextInput
            style={[styles.input, isMismatch && styles.inputError]}
            placeholder=""
            placeholderTextColor="#BBBBBB"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
          {isMismatch && (
            <Text style={styles.errorText}>비밀번호가 일치하지 않습니다.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 저장 버튼 */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.saveButton,
            (!isValid || isMismatch || isSamePassword || loading) && styles.saveButtonDisabled,
          ]}
          onPress={handleSave}
          disabled={!isValid || isMismatch || isSamePassword || loading}
          activeOpacity={0.7}
        >
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={styles.saveButtonText}>저장</Text>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  // space-between이어야 backButton이 왼쪽 끝에 고정되고, 양쪽 폭이 같은 backButton/스페이서
  // 사이에서 title만 진짜 정중앙에 온다 — center로 두면 셋을 한 묶음으로 가운데 몰아버려서
  // backButton까지 화면 중앙 쪽으로 끌려온다(2026-08-25, 앞선 수정에서 놓친 부분).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  // absolute로 빼면 header의 justifyContent:'center' 계산에서 backButton이 빠져서, 제목이
  // 오른쪽 스페이서(width:34) 폭만큼 왼쪽으로 치우쳐 보이는 버그가 있었다(2026-08-25 발견).
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  formContainer: {
    paddingHorizontal: 24,
    marginTop: 32,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1A1A',
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#555555',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: '#1A1A1A',
    marginBottom: 16,
  },
  inputError: {
    borderWidth: 1.5,
    borderColor: '#FF453A',
  },
  errorText: {
    fontSize: 12,
    color: '#FF453A',
    marginTop: -12,
    marginBottom: 12,
  },
  footer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 48 : 32,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: '#FFCE0C',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  saveButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
  },
});