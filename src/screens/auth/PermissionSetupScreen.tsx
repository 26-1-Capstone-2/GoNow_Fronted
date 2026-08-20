import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { useAppNavigation } from '@/src/navigation';
import {
  getBatteryOptimizationIgnored,
  getLocationAlwaysStatus,
  getLocationServicesEnabled,
  getUnusedAppRestrictionsDisabled,
  getWifiScanAlwaysAvailable,
  LocationAlwaysStatus,
  openBatteryOptimizationSettings,
  openExactAlarmSettings,
  openLocationScanningSettings,
  openLocationServiceSettings,
  openUnusedAppRestrictionsSettings,
  requestLocationAlways,
} from '@/src/utils/permissions';
import {
  getExactAlarmGranted,
  getNotificationPermissionGranted,
  openAppNotificationSettings,
  requestNotificationPermission,
} from '@/src/utils/notifications';

export default function PermissionSetupScreen() {
  const { goBack, goToMainTabs } = useAppNavigation();
  const { fromOnboarding } = useLocalSearchParams<{ fromOnboarding?: string }>();
  // 회원가입 직후(goToPermissionSetup이 붙여준 파라미터)면 메인 탭으로, 설정 화면에서
  // 들어온 거면 뒤로가기 — canGoBack()으로는 구별 불가(회원가입 스택도 뒤로 갈 곳이 남아있음)
  const handleDone = () => {
    if (fromOnboarding === '1') goToMainTabs();
    else goBack();
  };
  const [locationStatus, setLocationStatus] = useState<LocationAlwaysStatus | 'checking'>('checking');
  const [requesting, setRequesting] = useState(false);
  const [notificationGranted, setNotificationGranted] = useState<boolean | 'checking'>('checking');
  const [requestingNotification, setRequestingNotification] = useState(false);
  const [alarmGranted, setAlarmGranted] = useState<boolean | 'checking'>('checking');
  const [batteryIgnored, setBatteryIgnored] = useState<boolean | 'checking'>('checking');
  const [locationServicesEnabled, setLocationServicesEnabled] = useState<boolean | 'checking'>('checking');
  const [unusedAppRestrictionsDisabled, setUnusedAppRestrictionsDisabled] = useState<boolean | 'checking'>('checking');
  const [wifiScanAvailable, setWifiScanAvailable] = useState<boolean | 'checking'>('checking');

  const refreshLocationStatus = useCallback(() => {
    getLocationAlwaysStatus().then(setLocationStatus);
  }, []);

  const refreshLocationServicesStatus = useCallback(() => {
    getLocationServicesEnabled().then(setLocationServicesEnabled);
  }, []);

  const refreshNotificationStatus = useCallback(() => {
    getNotificationPermissionGranted().then(setNotificationGranted);
  }, []);

  const refreshAlarmStatus = useCallback(() => {
    getExactAlarmGranted().then(setAlarmGranted);
  }, []);

  const refreshBatteryStatus = useCallback(() => {
    setBatteryIgnored(getBatteryOptimizationIgnored());
  }, []);

  const refreshUnusedAppRestrictionsStatus = useCallback(() => {
    getUnusedAppRestrictionsDisabled().then(setUnusedAppRestrictionsDisabled);
  }, []);

  const refreshWifiScanStatus = useCallback(() => {
    setWifiScanAvailable(getWifiScanAlwaysAvailable());
  }, []);

  useEffect(() => {
    refreshLocationStatus();
    refreshLocationServicesStatus();
    refreshNotificationStatus();
    refreshAlarmStatus();
    refreshBatteryStatus();
    refreshUnusedAppRestrictionsStatus();
    refreshWifiScanStatus();
    // 설정 화면 다녀온 뒤 앱으로 돌아오면 상태 다시 확인
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshLocationStatus();
        refreshLocationServicesStatus();
        refreshNotificationStatus();
        refreshAlarmStatus();
        refreshBatteryStatus();
        refreshUnusedAppRestrictionsStatus();
        refreshWifiScanStatus();
      }
    });
    return () => sub.remove();
  }, [
    refreshLocationStatus,
    refreshLocationServicesStatus,
    refreshNotificationStatus,
    refreshAlarmStatus,
    refreshBatteryStatus,
    refreshUnusedAppRestrictionsStatus,
    refreshWifiScanStatus,
  ]);

  const handleRequestLocation = async () => {
    setRequesting(true);
    try {
      const { status, canAskAgain } = await requestLocationAlways();
      setLocationStatus(status);
      if (status !== 'granted' && !canAskAgain) {
        // 반복 거부로 안드로이드가 팝업 자체를 더 이상 안 띄우는 상태 — 설정으로 안내
        Alert.alert(
          '위치 권한 필요',
          '위치 권한이 반복 거부되어 팝업 대신 설정 화면에서 직접 켜주셔야 해요.\n설정 화면에서 "권한 > 위치"로 들어가 "항상 허용"으로 바꿔주세요.',
          [
            { text: '취소', style: 'cancel' },
            { text: '설정으로 이동', onPress: () => Linking.openSettings() },
          ],
        );
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleRequestNotification = async () => {
    setRequestingNotification(true);
    try {
      const { granted, canAskAgain } = await requestNotificationPermission();
      setNotificationGranted(granted);
      if (!granted && !canAskAgain) {
        // 반복 거부로 안드로이드가 팝업 자체를 더 이상 안 띄우는 상태 — 설정으로 안내
        Alert.alert(
          '알림 권한 필요',
          '알림 권한이 반복 거부되어 팝업 대신 설정 화면에서 직접 켜주셔야 해요.',
          [
            { text: '취소', style: 'cancel' },
            { text: '설정으로 이동', onPress: openAppNotificationSettings },
          ],
        );
      }
    } finally {
      setRequestingNotification(false);
    }
  };

  const locationBadge =
    locationStatus === 'granted' ? '✅ 완료'
    : locationStatus === 'checking' ? '확인 중…'
    : locationStatus === 'foregroundOnly' ? '⚠️ 앱 사용 중에만 허용됨'
    : '❌ 꺼져있음';

  const notificationBadge =
    notificationGranted === 'checking' ? '확인 중…'
    : notificationGranted ? '✅ 완료'
    : '❌ 꺼져있음';

  const alarmBadge =
    alarmGranted === 'checking' ? '확인 중…'
    : alarmGranted ? '✅ 완료'
    : '❌ 꺼져있음';

  const batteryBadge =
    batteryIgnored === 'checking' ? '확인 중…'
    : batteryIgnored ? '✅ 완료'
    : '❌ 꺼져있음';

  const locationServicesBadge =
    locationServicesEnabled === 'checking' ? '확인 중…'
    : locationServicesEnabled ? '✅ 완료'
    : '❌ 꺼져있음';

  const unusedAppRestrictionsBadge =
    unusedAppRestrictionsDisabled === 'checking' ? '확인 중…'
    : unusedAppRestrictionsDisabled ? '✅ 완료'
    : '❌ 켜져있음';

  const wifiScanBadge =
    wifiScanAvailable === 'checking' ? '확인 중…'
    : wifiScanAvailable ? '✅ 완료'
    : '❌ 꺼져있음';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>필수 권한 설정</Text>
        <Text style={styles.subtitle}>
          아래 항목을 켜야 GoNow 알람이 정확한 시각에,{'\n'}백그라운드에서도 정상적으로 울려요.
        </Text>
      </View>

      <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardList} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>앱 권한</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔔 알림</Text>
          <Text style={styles.cardDesc}>
            출발 시각을 알려주는 알람 자체가 이 권한 없이는 아예 안 보여요. GoNow의 가장 기본 기능이에요.
          </Text>
          <Text style={styles.statusText}>{notificationBadge}</Text>
          {notificationGranted !== true && (
            <TouchableOpacity style={styles.actionButton} onPress={handleRequestNotification} disabled={requestingNotification}>
              {requestingNotification
                ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <Text style={styles.actionButtonText}>허용하기</Text>}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>📍 위치 접근 — 항상 허용</Text>
          <Text style={styles.cardDesc}>
            앱을 꺼두거나 다른 화면을 보고 있어도 출발 시각을 계산하려면 위치를 계속 확인해야 해요.
            "앱 사용 중에만 허용"으로는 백그라운드에서 멈춰요.
          </Text>
          <Text style={styles.statusText}>{locationBadge}</Text>
          {locationStatus !== 'granted' && (
            <TouchableOpacity style={styles.actionButton} onPress={handleRequestLocation} disabled={requesting}>
              {requesting
                ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <Text style={styles.actionButtonText}>허용하기</Text>}
            </TouchableOpacity>
          )}
        </View>

        {Platform.OS === 'android' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>⏰ 알람 및 리마인더</Text>
              <Text style={styles.cardDesc}>
                이 설정이 꺼져있으면 출발 알람이 예정 시각보다 늦게 울릴 수 있어요.
                열리는 화면에서 GoNow의 권한 허용을 켜주세요.
              </Text>
              <Text style={styles.statusText}>{alarmBadge}</Text>
              {alarmGranted !== true && (
                <TouchableOpacity style={styles.actionButton} onPress={openExactAlarmSettings}>
                  <Text style={styles.actionButtonText}>설정으로 이동</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>🔋 배터리 사용량 제한 해제</Text>
              <Text style={styles.cardDesc}>
                목록에서 gonow를 찾아 "제한 없음"으로 바꿔주세요. 그래야 오랜 시간 뒤 알람도 끊기지 않아요.
              </Text>
              <Text style={styles.statusText}>{batteryBadge}</Text>
              {batteryIgnored !== true && (
                <TouchableOpacity style={styles.actionButton} onPress={openBatteryOptimizationSettings}>
                  <Text style={styles.actionButtonText}>설정으로 이동</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>🗑️ 사용하지 않는 앱 관리</Text>
              <Text style={styles.cardDesc}>
                이 옵션이 켜져 있으면 몇 달간 앱을 안 열었을 때 안드로이드가 알림·위치 권한을
                자동으로 꺼버려요. 알람이 왜 안 울리는지 모른 채 방치되지 않으려면 꺼두는 게 좋아요.
              </Text>
              <Text style={styles.statusText}>{unusedAppRestrictionsBadge}</Text>
              {unusedAppRestrictionsDisabled !== true && (
                <TouchableOpacity style={styles.actionButton} onPress={openUnusedAppRestrictionsSettings}>
                  <Text style={styles.actionButtonText}>설정으로 이동</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.sectionTitle}>기기 설정</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📡 위치 서비스(GPS)</Text>
              <Text style={styles.cardDesc}>
                기기 자체의 위치(GPS)가 꺼져 있으면 GoNow 권한이 있어도 위치를 가져올 수 없어요.
              </Text>
              <Text style={styles.statusText}>{locationServicesBadge}</Text>
              {locationServicesEnabled !== true && (
                <TouchableOpacity style={styles.actionButton} onPress={openLocationServiceSettings}>
                  <Text style={styles.actionButtonText}>설정으로 이동</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>📶 Wi-Fi 찾기</Text>
              <Text style={styles.cardDesc}>
                Wi-Fi가 꺼져 있어도 위치 정확도를 높이기 위해 스캔하는 기능이에요. 실내(특히
                새벽에 집에서 첫 위치를 잡을 때)에서는 GPS만으로 오차가 클 수 있어, 이 옵션이
                켜져 있으면 더 정확해져요.
              </Text>
              <Text style={styles.statusText}>{wifiScanBadge}</Text>
              {wifiScanAvailable !== true && (
                <TouchableOpacity style={styles.actionButton} onPress={openLocationScanningSettings}>
                  <Text style={styles.actionButtonText}>설정으로 이동</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.completeButton} onPress={handleDone}>
          <Text style={styles.completeButtonText}>완료</Text>
        </TouchableOpacity>
        <Text style={styles.footerNote}>나중에 설정 화면에서 다시 확인할 수 있어요.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888888', lineHeight: 20 },
  cardScroll: { flex: 1 },
  cardList: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 12 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#AAAAAA',
    marginTop: 8,
    marginBottom: 2,
  },
  card: {
    backgroundColor: '#F5F5F5',
    borderRadius: 16,
    padding: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 6 },
  cardDesc: { fontSize: 13, color: '#666666', lineHeight: 19 },
  statusText: { fontSize: 13, fontWeight: '600', color: '#1A1A1A', marginTop: 10 },
  actionButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  actionButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 28, alignItems: 'center' },
  completeButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 24,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  completeButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  footerNote: { fontSize: 12, color: '#AAAAAA', marginTop: 10 },
});
