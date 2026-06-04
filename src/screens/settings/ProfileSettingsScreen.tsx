import { createMembersApi } from '@/src/api/members';
import { createAuthApi } from '@/src/api/auth';
import { alarmService } from '@/src/services/alarmService';
import { stopBackgroundLocationUpdates, ACTIVE_JOURNEYS_KEY, ACTIVE_APPOINTMENTS_KEY, STAGING_DONE_KEY } from '@/src/tasks/backgroundLocationTask';
import { useAuthStore } from '@/src/store/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
          alarmService.stopAll();
          await stopBackgroundLocationUpdates().catch(() => {});
          await AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify([]));
          await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify([]));
          await AsyncStorage.setItem(STAGING_DONE_KEY, JSON.stringify([]));
          useAuthStore.getState().setToken(null);
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
          <Text style={styles.menuButtonText}>닉네임 변경</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => router.push('/change-password')}
          activeOpacity={0.7}
        >
          <Text style={styles.menuButtonText}>비밀번호 변경</Text>
        </TouchableOpacity>
      </View>

      {/* 하단 버튼들 */}
      <View style={styles.deleteContainer}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.menuButtonText}>로그아웃</Text>
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
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  menuButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  deleteContainer: {
    position: 'absolute',
    bottom: 48,
    left: 24,
    right: 24,
    gap: 12,
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
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