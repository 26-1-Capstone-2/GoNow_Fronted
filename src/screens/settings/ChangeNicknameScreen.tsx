import { createMembersApi } from '@/src/api/members';
import { useAuthStore } from '@/src/store/authStore';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
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

      {/* 입력 영역 — autoFocus로 화면 진입 즉시 키보드가 뜨는데, KeyboardAvoidingView가
          없으면 작은 화면 기기에서 입력창이 키보드에 가려질 수 있었다(2026-08-25 발견). */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.formContainer}>
          <Text style={styles.label}>새로운 닉네임을 입력해주세요.</Text>
          <TextInput
            style={styles.input}
            placeholder="새 닉네임"
            placeholderTextColor="#BBBBBB"
            value={nickname}
            onChangeText={(t) => t.length <= 12 && setNickname(t)}
            maxLength={12}
            autoFocus
          />
        </View>
      </KeyboardAvoidingView>

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
  // flex 흐름에 그대로 두고 폭을 스페이서와 맞춰야(둘 다 34px 안팎) 제목이 진짜 화면 중앙에 온다.
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