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
import { reconcileNearDestGeofences } from '@/src/tasks/nearDestGeofenceTask';
import { saveAlarmNavInfo, startAlarmForegroundService, isRepeatingJourney } from '@/src/tasks/backgroundLocationTask';
import { toTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { useAppNavigation } from '@/src/navigation';
import { useAuthStore } from '@/src/store/authStore';
import { dlog } from '@/src/utils/deviceLogger';
import * as Notifications from 'expo-notifications';

const authApi = createAuthApi();

export default function LoginScreen() {
  const { goToMainTabs, goToSignUp } = useAppNavigation();
  const setToken = useAuthStore((s) => s.setToken);
  const setNickname = useAuthStore((s) => s.setNickname);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await authApi.login({ email, password });
      setToken(res.data.access_token);

      // 닉네임 저장
      try {
        const profileRes = await createMembersApi().getMyProfile();
        if (profileRes.data?.nickname) setNickname(profileRes.data.nickname);
      } catch (e) {
        console.log('[LoginScreen] 닉네임 조회 실패:', e);
      }

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
        const readyItems = (alarmsRes.data ?? []).filter((a) => ['READY', 'DEPARTING', 'MOVING', 'NEARDEST'].includes(a.my_status) && a.is_active);
        // 서버 기준 최신 활성 목록과 등록된 NEARDEST 지오펜스를 대조해 orphan 정리(저비용 안전망)
        const activeKeys = readyItems.map((a) =>
          a.alarm_type === 'GROUP' ? `a_${a.appointment_id}` : `j_${a.journey_id}`
        );
        reconcileNearDestGeofences(activeKeys).catch(() => {});
        readyItems.forEach((a) => {
          if (a.alarm_type === 'GROUP' && a.appointment_id != null) {
            if (alarmService.isRunning(undefined, a.appointment_id)) return;
            alarmService.start({ alarmType: 'group', destination: a.dest_name, appointmentId: a.appointment_id, isActive: a.is_active, destLat: a.dest_lat, destLng: a.dest_lng, transportMode: toTransportMode(a.transport_type === 'DRIVING') });
          } else if (a.alarm_type === 'HOME' && a.journey_id != null) {
            if (alarmService.isRunning(a.journey_id)) return;
            alarmService.start({ alarmType: 'home', destination: a.dest_name, journeyId: a.journey_id, destLat: a.dest_lat, destLng: a.dest_lng, transportMode: toTransportMode(a.transport_type === 'DRIVING'), isLastMode: a.is_last_mode, repeatDays: a.repeat_days ?? undefined });
          } else if (a.alarm_type === 'PERSONAL' && a.journey_id != null) {
            if (alarmService.isRunning(a.journey_id)) return;
            alarmService.start({ alarmType: 'personal', destination: a.dest_name, journeyId: a.journey_id, destLat: a.dest_lat, destLng: a.dest_lng, transportMode: toTransportMode(a.transport_type === 'DRIVING'), repeatDays: a.repeat_days ?? undefined });
          }
        });
        // 반복 여정 중 ARRIVED(=파킹 대상)인 것들 — 위 readyItems 필터에는 안 걸리지만, 이 계정에
        // "다음 회차를 기다리는 알람"이 있다는 뜻이므로 nav info를 다시 채워 파킹 상태로 복원해야
        // 한다. 로그아웃(AlarmManager.stopAll())이 파킹 엔트리를 포함해 전부 지우기 때문에,
        // 로그아웃→재로그인을 거치면 이 정보가 통째로 사라진다 — 복원 안 하면 다음 회차가
        // 백그라운드/종료 상태로 도래할 때 FGS를 새로 못 켜는 문제가 재발한다(버그45 재발 경로,
        // 2026-08-18 실기기 테스트 중 발견).
        const parkedRepeatItems = (alarmsRes.data ?? []).filter((a) => a.my_status === 'ARRIVED' && a.is_active && isRepeatingJourney(a.repeat_days));
        for (const a of parkedRepeatItems) {
          const key = a.alarm_type === 'GROUP' ? `a_${a.appointment_id}` : `j_${a.journey_id}`;
          await saveAlarmNavInfo(key, {
            destLat: a.dest_lat,
            destLng: a.dest_lng,
            destination: a.dest_name,
            transportMode: toTransportMode(a.transport_type === 'DRIVING'),
            isLastMode: a.is_last_mode,
            repeatDays: a.repeat_days ?? undefined,
          });
          dlog('FOREGROUND', `[LoginScreen] 반복 여정 파킹 복원 — key:${key} repeatDays:${a.repeat_days}`);
        }
        // alarmService.start()는 runner를 map에 동기적으로 등록하므로, 위 forEach 직후 시점에
        // 이미 반영돼있음 — 로그인 직후 FGS가 필요한 알람이 있으면 여기서 바로 켜줘야 함
        // (다음 AppState active 전환까지 기다리면 그 사이 백그라운드 전환 시 추적이 아예 안 됨).
        // 파킹만 복원되고(runner는 없음) 다른 활성 알람도 없는 경우 syncForegroundService()의
        // "runners:0이지만 파킹된 알람 존재" 분기는 GPS만 정리할 뿐 FGS를 새로 켜지는 않으므로
        // (그 분기는 "이미 켜진 FGS를 유지"하는 용도라 이미 꺼진 FGS를 새로 켜주진 않음), 파킹
        // 복원이 하나라도 있었다면 여기서 직접 켜준다.
        if (parkedRepeatItems.length > 0) {
          await startAlarmForegroundService().catch(() => {});
        }
        alarmService.syncForegroundService().catch(() => {});
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
