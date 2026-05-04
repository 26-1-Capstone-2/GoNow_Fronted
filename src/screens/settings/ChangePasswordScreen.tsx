import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const isValid = currentPassword.trim() && newPassword.trim() && confirmPassword.trim();
  const isMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSave = () => {
    if (!isValid || isMismatch) return;
    // TODO: 비밀번호 변경 API 연결
    router.back();
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
          style={styles.input}
          placeholder=""
          placeholderTextColor="#BBBBBB"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />

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
          style={[styles.saveButton, (!isValid || isMismatch) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!isValid || isMismatch}
          activeOpacity={0.7}
        >
          <Text style={styles.saveButtonText}>저장</Text>
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
    borderColor: '#FF3B30',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
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
    backgroundColor: '#4CAF50',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  saveButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});