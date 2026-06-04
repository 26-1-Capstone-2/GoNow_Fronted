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

import { createAuthApi } from '@/src/api/auth';
import { createMembersApi } from '@/src/api/members';
import { createAlarmsApi } from '@/src/api/alarms';
import { alarmService } from '@/src/services/alarmService';
import { STAGING_DONE_KEY } from '@/src/tasks/backgroundLocationTask';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppNavigation } from '@/src/navigation';
import { useAuthStore } from '@/src/store/authStore';
import * as Notifications from 'expo-notifications';

const authApi = createAuthApi();

export default function LoginScreen() {
  const { goToMainTabs, goToSignUp } = useAppNavigation();
  const setToken = useAuthStore((s) => s.setToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await authApi.login({ email, password });
      setToken(res.data.access_token);

      try {
        const tokenData = await Notifications.getDevicePushTokenAsync();
        await createMembersApi().registerFcmToken(tokenData.data);
      } catch (e) {
        console.log('[FCM] 토큰 등록 실패:', e);
      }

      // 로그인 후 READY 알람 즉시 폴링 시작
      // (goToMainTabs() 화면 전환 시 AppState active가 발화하지 않을 수 있으므로 직접 호출)
      try {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const alarmsRes = await createAlarmsApi().getAlarms(todayStr);
        console.log(`[LoginScreen] getAlarms 응답 — 전체:${alarmsRes.data?.length ?? 0}`);

        // 현재 이미 알람이 울린 상태(DEPARTING/MOVING/NEARDEST)인 알람 ID만 STAGING_DONE_KEY에 유지
        // 새 알람은 포함 안 되므로 정상 발송, 이미 울린 알람은 재발송 방지
        const activeKeys = (alarmsRes.data ?? [])
          .filter(a => ['DEPARTING', 'MOVING', 'NEARDEST'].includes(a.my_status))
          .map(a => a.journey_id ? `j_${a.journey_id}` : `a_${a.appointment_id}`);
        await AsyncStorage.setItem(STAGING_DONE_KEY, JSON.stringify(activeKeys));
        console.log(`[LoginScreen] STAGING_DONE 갱신 — ${JSON.stringify(activeKeys)}`);

        (alarmsRes.data ?? []).filter((a) => ['READY', 'DEPARTING', 'MOVING', 'NEARDEST'].includes(a.my_status) && a.is_active).forEach((a) => {
          if (a.alarm_type === 'GROUP' && a.appointment_id != null) {
            if (alarmService.isRunning(undefined, a.appointment_id)) return;
            alarmService.start({ alarmType: 'group', destination: a.dest_name, appointmentId: a.appointment_id });
          } else if (a.alarm_type === 'HOME' && a.journey_id != null) {
            if (alarmService.isRunning(a.journey_id)) return;
            alarmService.start({ alarmType: 'home', destination: a.dest_name, journeyId: a.journey_id });
          } else if (a.alarm_type === 'PERSONAL' && a.journey_id != null) {
            if (alarmService.isRunning(a.journey_id)) return;
            alarmService.start({ alarmType: 'personal', destination: a.dest_name, journeyId: a.journey_id });
          }
        });
      } catch (e) {
        console.log('[LoginScreen] READY 알람 복구 실패:', e);
      }

      goToMainTabs();
    } catch (e: any) {
      Alert.alert('로그인 실패', '이메일 또는 비밀번호를 확인해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        {/* 로고 */}
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>
            <Text style={styles.logoGo}>go</Text>
            <Text style={styles.logoNow}>now</Text>
          </Text>
        </View>

        {/* 인풋 영역 */}
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

          <Text style={[styles.label, { marginTop: 16 }]}>비밀번호</Text>
          <TextInput
            style={styles.input}
            placeholder="비밀번호"
            placeholderTextColor="#BBBBBB"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {/* 로그인 버튼 */}
          <TouchableOpacity
            style={[styles.loginButton, loading && { backgroundColor: '#888888' }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.loginButtonText}>로그인</Text>
            }
          </TouchableOpacity>
        </View>

        {/* 하단 회원가입 링크 */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>계정이 없으신가요? </Text>
          <TouchableOpacity onPress={goToSignUp}>
            <Text style={styles.signUpText}>가입하기</Text>
          </TouchableOpacity>
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
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 32,
    marginBottom: 48,
    alignSelf: 'center',
    minWidth: 200,
  },
  logoText: {
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1.5,
  },
  logoGo: {
    color: '#1A1A1A',
  },
  logoNow: {
    color: '#F5A623',
  },
  formContainer: {
    width: '100%',
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
  loginButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
  },
  footerText: {
    fontSize: 14,
    color: '#888888',
  },
  signUpText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5A623',
  },
});
