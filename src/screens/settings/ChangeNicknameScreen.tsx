import { createMembersApi } from '@/src/api/members';
import { useAuthStore } from '@/src/store/authStore';
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

export default function ChangeNicknameScreen() {
  const router = useRouter();
  const setStoredNickname = useAuthStore((s) => s.setNickname);
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!nickname.trim()) return;
    setLoading(true);
    try {
      await membersApi.updateNickname(nickname.trim());
      setStoredNickname(nickname.trim());
      router.back();
    } catch (e: any) {
      Alert.alert('변경 실패', e?.message ?? '다시 시도해주세요.');
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
        <Text style={styles.title}>닉네임 변경</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* 입력 영역 */}
      <View style={styles.formContainer}>
        <Text style={styles.label}>새로운 닉네임을 입력해주세요.</Text>
        <TextInput
          style={styles.input}
          placeholder="전 닉네임"
          placeholderTextColor="#BBBBBB"
          value={nickname}
          onChangeText={(t) => t.length <= 12 && setNickname(t)}
          maxLength={12}
          autoFocus
        />
      </View>

      {/* 저장 버튼 */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, (!nickname.trim() || loading) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!nickname.trim() || loading}
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
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: '#1A1A1A',
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