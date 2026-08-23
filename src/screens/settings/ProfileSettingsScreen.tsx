import { createMembersApi } from '@/src/api/members';
import { createAuthApi } from '@/src/api/auth';
import { alarmService } from '@/src/services/alarmService';
import { useAuthStore } from '@/src/store/authStore';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const membersApi = createMembersApi();

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');

  useFocusEffect(
    useCallback(() => {
      membersApi.getMyProfile()
        .then((res) => setNickname(res.data.nickname))
        .catch(() => {});
    }, []),
  );

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          try { await createAuthApi({ getToken: () => useAuthStore.getState().token }).logout(); } catch {}
          await alarmService.stopAll();
          useAuthStore.getState().setToken(null);
          useAuthStore.getState().setRefreshToken(null);
          useAuthStore.getState().setMemberId(null);
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert('회원탈퇴', '정말 탈퇴하시겠습니까?\n탈퇴 시 모든 데이터가 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '탈퇴',
        style: 'destructive',
        onPress: () => {
          // TODO: 회원탈퇴 로직
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 닫기 버튼 */}
      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Feather name="x" size={24} color="#1A1A1A" />
      </TouchableOpacity>

      {/* 닉네임 */}
      <View style={styles.nicknameContainer}>
        <Text style={styles.nickname}>{nickname || '...'}</Text>
      </View>

      {/* 상단 버튼 그룹 */}
      <View style={styles.buttonGroup}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => router.push('/change-nickname')}
          activeOpacity={0.7}
        >
          <Feather name="user" size={17} color="#0A84FF" />
          <Text style={styles.menuButtonText}>닉네임 변경</Text>
          <Feather name="chevron-right" size={16} color="#B0B0B4" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => router.push('/change-password')}
          activeOpacity={0.7}
        >
          <Feather name="lock" size={17} color="#0A84FF" />
          <Text style={styles.menuButtonText}>비밀번호 변경</Text>
          <Feather name="chevron-right" size={16} color="#B0B0B4" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => router.push('/permission-setup')}
          activeOpacity={0.7}
        >
          <Feather name="shield" size={17} color="#0A84FF" />
          <Text style={styles.menuButtonText}>필수 권한 설정 확인</Text>
          <Feather name="chevron-right" size={16} color="#B0B0B4" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => router.push('/alarm-sound-setup')}
          activeOpacity={0.7}
        >
          <Feather name="volume-2" size={17} color="#0A84FF" />
          <Text style={styles.menuButtonText}>알람 소리 설정</Text>
          <Feather name="chevron-right" size={16} color="#B0B0B4" />
        </TouchableOpacity>
      </View>

      {/* 하단 버튼들 */}
      <View style={styles.deleteContainer}>
        <TouchableOpacity
          style={[styles.menuButton, styles.logoutButton]}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={[styles.menuButtonText, styles.logoutButtonText]}>로그아웃</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteButtonText}>회원탈퇴</Text>
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
  closeButton: {
    alignSelf: 'flex-start',
    padding: 16,
  },
  nicknameContainer: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 40,
  },
  nickname: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  buttonGroup: {
    paddingHorizontal: 24,
    marginBottom: 12,
    gap: 10,
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F7F7F8',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  menuButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  logoutButton: { justifyContent: 'center' },
  logoutButtonText: { flex: 0, textAlign: 'center', color: '#8A8A8E', fontWeight: '500' },
  deleteContainer: {
    position: 'absolute',
    bottom: 48,
    left: 24,
    right: 24,
    gap: 12,
  },
  deleteButton: {
    backgroundColor: '#FF453A',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignSelf: 'center',
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});