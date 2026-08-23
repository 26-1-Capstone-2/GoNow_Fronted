import { createMembersApi } from '@/src/api/members';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
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
  const isValid = currentPassword.trim() && PASSWORD_REGEX.test(newPassword) && confirmPassword.trim();
  const isMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSave = async () => {
    if (!isValid || isMismatch) return;
    setLoading(true);
    try {
      await membersApi.updatePassword(currentPassword, newPassword);
      router.back();
    } catch (e: any) {
      Alert.alert('변경 실패', '현재 비밀번호를 확인해주세요.');
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

      {/* 입력 영역 */}
      <View style={styles.formContainer}>
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
          style={[styles.input, isNewPasswordInvalid && styles.inputError]}
          placeholder=""
          placeholderTextColor="#BBBBBB"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />
        {isNewPasswordInvalid && (
          <Text style={styles.errorText}>공백 없는 영문/숫자/특수문자로 8~64자여야 합니다.</Text>
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
      </View>

      {/* 저장 버튼 */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, (!isValid || isMismatch || loading) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!isValid || isMismatch || loading}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backButton: {
    position: 'absolute',
    left: 16,
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