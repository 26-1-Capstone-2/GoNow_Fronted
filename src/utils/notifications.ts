import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidNotificationSetting,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
  TimestampTrigger,
  TriggerType,
} from '@notifee/react-native';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { dlog } from '@/src/utils/deviceLogger';

export type AlarmStage = 1 | 2 | 3 | 4;
// 도착 관련 알림 3종 — 출발 단계별 채널과 완전히 분리(성격이 다른 알림이라 서로 영향 안 주도록).
// 'arrival-expected'/'arrival-complete'의 채널 문자열은 스프링 ParticipantService.java의
// ArrivalChannel enum과 반드시 일치해야 함 — 이 둘은 스프링이 FCM에 실어 보내는 값이라
// resetAlarmChannel()로 버전을 올리면 안 됨(버전 0 고정, UI에서 초기화 버튼 자체를 안 줌).
export type ChannelKey = AlarmStage | 'arrival-check' | 'arrival-expected' | 'arrival-complete';
export type AlarmType = 'personal' | 'group' | 'home';

const CHANNEL_BASE: Record<ChannelKey, string> = {
  1: 'gonow-alarm-1',
  2: 'gonow-alarm-2',
  3: 'gonow-alarm-3',
  4: 'gonow-alarm-4',
  'arrival-check': 'gonow-arrival-check',
  'arrival-expected': 'gonow-arrival-expected',
  'arrival-complete': 'gonow-arrival-complete',
};
export const CHANNEL_SILENT = 'gonow-silent';

// 채널의 "리셋 횟수" — 안드로이드는 같은 채널ID로 삭제 후 재생성해도 이전 사용자 설정을
// 그대로 되살리므로(un-delete), 진짜 초기화하려면 한 번도 안 쓰인 새 채널ID가 필요함.
// 이 값을 늘려서 ID 뒤에 붙이는 방식으로 매번 새 채널을 만듦.
const CHANNEL_VERSIONS_KEY = 'gonow_channel_versions'; // Record<ChannelKey를 문자열로, number>

let channelIds: Record<ChannelKey, string> = { ...CHANNEL_BASE };

// 리셋 횟수는 "초기화" 버튼을 누를 때만 바뀌는데, ensureChannels()는 알람을 보낼
// 때마다(하루 여러 번) 호출되므로 매번 AsyncStorage를 다시 읽지 않고 세션 중엔 캐싱함.
// resetAlarmChannel()이 값을 바꾸면 캐시도 그 자리에서 같이 갱신됨.
let channelVersionsCache: Record<ChannelKey, number> | null = null;

// 채널 9개를 세션 중 한 번만 실제로 생성하기 위한 플래그. ensureChannels()는 알람을
// 보낼 때마다(하루 여러 번) 호출되는데, notifee.createChannel()이 이미 존재하는
// 채널엔 no-op이라도 매번 네이티브 브리지를 9번 왕복하는 건 낭비라 이 플래그로 건너뜀.
// resetAlarmChannel()이 새 버전을 발급할 때만 false로 내려서 재생성을 강제함.
let channelsEnsured = false;

function buildChannelId(key: ChannelKey, version: number): string {
  return version <= 0 ? CHANNEL_BASE[key] : `${CHANNEL_BASE[key]}-r${version}`;
}

async function loadChannelVersions(): Promise<Record<ChannelKey, number>> {
  if (channelVersionsCache) return channelVersionsCache;
  try {
    const raw = await AsyncStorage.getItem(CHANNEL_VERSIONS_KEY);
    const map: Partial<Record<string, number>> = raw ? JSON.parse(raw) : {};
    channelVersionsCache = {
      1: map['1'] ?? 0, 2: map['2'] ?? 0, 3: map['3'] ?? 0, 4: map['4'] ?? 0,
      'arrival-check': map['arrival-check'] ?? 0,
      'arrival-expected': map['arrival-expected'] ?? 0,
      'arrival-complete': map['arrival-complete'] ?? 0,
    };
  } catch {
    channelVersionsCache = {
      1: 0, 2: 0, 3: 0, 4: 0,
      'arrival-check': 0, 'arrival-expected': 0, 'arrival-complete': 0,
    };
  }
  return channelVersionsCache;
}

// 단계별 알람 trigger ID AsyncStorage 키 — journeyId/appointmentId 기준으로 저장
const TRIGGER_IDS_KEY = 'gonow_trigger_ids'; // Record<'j_N' | 'a_N', string[]>

async function saveTriggerIds(key: string, ids: string[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TRIGGER_IDS_KEY);
    const map: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    map[key] = [...(map[key] ?? []), ...ids];
    await AsyncStorage.setItem(TRIGGER_IDS_KEY, JSON.stringify(map));
    dlog('NEARDEST', `[trigger] 저장 완료 — key:${key} ids:${ids}`);
  } catch {}
}

export async function cancelStagedAlarms(key: string): Promise<void> {
  return cancelAndRemoveTriggerIds(key);
}

async function cancelAndRemoveTriggerIds(key: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TRIGGER_IDS_KEY);
    if (raw) {
      const map: Record<string, string[]> = JSON.parse(raw);
      const ids = map[key] ?? [];
      dlog('NEARDEST', `[trigger] 취소 시도 — key:${key} ids:${ids}`);
      await Promise.all(ids.map(id => notifee.cancelTriggerNotification(id).catch(() => {})));
      delete map[key];
      await AsyncStorage.setItem(TRIGGER_IDS_KEY, JSON.stringify(map));
      dlog('NEARDEST', `[trigger] 취소 완료 — key:${key}`);
    } else {
      dlog('NEARDEST', `[trigger] 취소 시도 — key:${key} AsyncStorage 없음`);
    }
  } catch {}
  // 트리거를 취소하는 시점엔 그 지문(fingerprint)도 항상 무효화 — syncStagedAlarms()가
  // 재등록 직전에 호출하는 경우엔 바로 뒤에서 새 지문을 다시 씀, 완전히 정리하는
  // 경우(MOVING/ARRIVED/stop())엔 다음 등록 때 "기록 없음"으로 자연스럽게 처리됨
  await clearStagingFingerprint(key);
}

// 단계별 알람 "스테이징 지문" — departureAlarmTime+whichStation 조합을 기억해뒀다가 동일하면
// 재등록을 건너뜀. 포그라운드(alarmService.ts)와 백그라운드(backgroundLocationTask.ts)가 각자
// 독립적으로 취소·재등록을 반복하며 중복 발송/메시지 고착을 일으키던 문제의 근본 수정 — 두 경로가
// 이 AsyncStorage 기반 지문 하나를 공유해서 "이미 이 데이터로 등록했는지"를 판단함(syncStagedAlarms 참고).
const STAGING_FINGERPRINT_KEY = 'gonow_staging_fingerprint'; // Record<key, { departureAlarmTime, whichStation }>

type StagingFingerprint = { departureAlarmTime: string; whichStation: string | null };

// DEPARTING/NEARDEST 구간에서는 매 폴링(짧으면 10~30초 간격)마다 syncStagedAlarms()가 이
// 지문을 읽는데, 대부분 "변경 없음, 스킵"으로 끝나면서도 매번 AsyncStorage를 다시 읽는 건
// 낭비라 channelVersionsCache와 동일한 패턴으로 메모리 캐싱. 반환된 객체를 직접 수정하고
// 그대로 AsyncStorage에 저장하면(참조 공유) 캐시도 같이 최신 상태로 유지됨.
let stagingFingerprintCache: Record<string, StagingFingerprint> | null = null;

async function loadStagingFingerprints(): Promise<Record<string, StagingFingerprint>> {
  if (stagingFingerprintCache) return stagingFingerprintCache;
  try {
    const raw = await AsyncStorage.getItem(STAGING_FINGERPRINT_KEY);
    stagingFingerprintCache = raw ? JSON.parse(raw) : {};
  } catch {
    stagingFingerprintCache = {};
  }
  return stagingFingerprintCache!;
}

async function clearStagingFingerprint(key: string): Promise<void> {
  try {
    const map = await loadStagingFingerprints();
    if (!(key in map)) return;
    delete map[key];
    await AsyncStorage.setItem(STAGING_FINGERPRINT_KEY, JSON.stringify(map));
  } catch {}
}

// 백그라운드 이벤트 핸들러 (모듈 레벨 등록 필수)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;
    const notifId = detail.notification?.id;
    const data = detail.notification?.data;

    if (notifId) await notifee.cancelNotification(notifId);

    const journeyId = data?.journeyId ? Number(data.journeyId) : undefined;
    const appointmentId = data?.appointmentId ? Number(data.appointmentId) : undefined;
    const storageKey = journeyId != null ? `j_${journeyId}` : appointmentId != null ? `a_${appointmentId}` : null;

    if (actionId === 'dismiss' && storageKey) {
      // X 버튼 — 남은 단계별 알람 취소
      await cancelAndRemoveTriggerIds(storageKey);
    }

    if (actionId === 'arrival-yes') {
      dlog('NEARDEST', `도착확인 YES버튼(백그라운드) — key:${storageKey}`);
      if (storageKey) {
        await cancelAndRemoveTriggerIds(storageKey);
        // 아직 EXIT 콜백이 안 뜬 상태(100m 안)로 도착 확인을 누른 경우, 지오펜스 region이
        // 정리 안 된 채 남을 수 있어 여기서도 명시적으로 정리 — 정상 플로우에서 흔히 일어남
        const { exitNearDestGeofenceMode } = await import('@/src/tasks/nearDestGeofenceTask');
        await exitNearDestGeofenceMode(storageKey).catch(() => {});
      }
      if (data?.journeyId) {
        const { createJourneysApi } = await import('@/src/api/journeys');
        await createJourneysApi().arrive(Number(data.journeyId));
      }
      if (data?.appointmentId) {
        const { createAppointmentsApi } = await import('@/src/api/appointments');
        await createAppointmentsApi().arriveParticipant(Number(data.appointmentId));
      }
      // 포그라운드 경로(alarmService.stop())와 달리 여기는 alarmService의 인메모리 러너 목록에
      // 기대면 안 된다 — 앱이 완전 종료된 헤드리스 컨텍스트에서는 그 목록이 항상 비어있는
      // 새 인스턴스라, "다른 알람 없음"으로 잘못 판단해 FGS를 오판할 위험이 있다. 대신
      // backgroundLocationTask.ts가 이미 쓰는 영속 저장소(ALARM_NAV_INFO_KEY) 기준 판단을
      // 그대로 재사용한다 — 이 알람을 지우고, 남은 알람이 없을 때만 FGS를 끈다.
      if (storageKey) {
        // 프로세스가 살아있는 경우(스와이프만 하고 완전 종료는 아니었던 경우 — 2026-08-17
        // 실기기로 확인된 대로 흔한 케이스) alarmService의 러너가 좀비로 메모리에 남는 것을
        // 방지 — FGS는 위에서 이미 별도로 정리하므로 onFinish(중복 재확인) 없이 순수하게
        // 메모리에서만 지운다. 진짜 헤드리스면 러너가 애초에 없어 조용히 no-op.
        const { alarmService } = await import('@/src/services/alarmService');
        alarmService.forgetIfExists(journeyId, appointmentId);
        const { removeOrParkAlarmNavInfo, hasAnyTrackedAlarm, stopAlarmForegroundService } = await import('@/src/tasks/backgroundLocationTask');
        // 반복 여정이면 nav info를 지우지 않고 다음 회차까지 파킹한다(버그45) — 삭제가 아니라
        // ARRIVED 의미이므로 항상 지우던 기존 동작은 반복 알람의 FGS를 여기서도 꺼뜨렸었다.
        const parked = await removeOrParkAlarmNavInfo(storageKey);
        if (parked) {
          dlog('NEARDEST', `key:${storageKey} 도착 처리 완료 — 반복 여정, 다음 회차까지 nav info 파킹(버그45) → FGS 유지`);
        } else if (await hasAnyTrackedAlarm()) {
          dlog('NEARDEST', `key:${storageKey} 도착 처리 완료 — 남은 알람 있어 FGS 유지`);
        } else {
          await stopAlarmForegroundService();
          dlog('NEARDEST', `key:${storageKey} 도착 처리 완료 — 남은 알람 없어 FGS 종료`);
        }
      }
    }

    if (actionId === 'navigate' && data?.destLat && data?.destLng && data?.transportMode) {
      // 단계별 출발 알람(1~4단계)은 전부 DEPARTING 구간에서만 발생 — 캐시 유효기간도 그에 맞춤
      const { openKakaoMapRoute, NAVIGATE_CACHE_MAX_AGE_MS } = await import('@/src/utils/kakaoMapDeeplink');
      await openKakaoMapRoute(
        { lat: Number(data.destLat), lng: Number(data.destLng) },
        data.transportMode as KakaoMapTransportMode,
        NAVIGATE_CACHE_MAX_AGE_MS.DEPARTING,
      );
    }
  }
});

const STAGE_CONFIG = {
  1: { title: '🟢 여유 구간', vibrate: false },
  2: { title: '🟡 주의 구간', vibrate: true  },
  3: { title: '🟠 위험 구간', vibrate: true  },
  4: { title: '🔴 임계 구간', vibrate: true  },
};

// 1~3단계를 건너뛰고 4단계가 바로 발송되는("이미 늦음") 경우 전용 제목.
// "임계 구간"은 1→2→3을 거쳐 마지막 단계에 도달했다는 뉘앙스라 스킵된 경우엔 안 맞음 —
// 색(🔴)은 여전히 가장 급한 상황이라 유지, 문구만 "이미 늦었다"는 사실 위주로 교체.
const LATE_STAGE4_TITLE = '🔴 지각 구간';

const TYPE_NAMES = { personal: '개인', group: '그룹', home: '귀가' };

const STAGE_MESSAGES: Record<AlarmType, Record<AlarmStage, string>> = {
  personal: {
    1: '출발 준비를 시작하세요. 아직 여유가 있어요.',
    2: '슬슬 준비하세요. 출발 시간이 다가오고 있어요!',
    3: '지금 바로 출발하세요! 늦어지고 있어요.',
    4: '즉시 출발! 더 늦으면 목적지 도착이 어렵습니다!',
  },
  group: {
    1: '그룹 약속 출발 준비를 시작하세요.',
    2: '그룹원들이 기다리고 있어요. 슬슬 준비하세요!',
    3: '지금 바로 출발하세요! 그룹 약속에 늦고 있어요.',
    4: '즉시 출발! 그룹원들이 기다리고 있습니다!',
  },
  home: {
    // 3·4단계는 데드라인 모드(자가용 포함) 기준 중립 문구 — 막차 모드는 아래
    // HOME_LAST_TRAIN_MESSAGES로 교체됨(버그30 — isLastMode 무관하게 "막차"로 고정돼 있던 문제 수정)
    1: '귀가 준비를 시작하세요. 아직 여유가 있어요.',
    2: '귀가 시간이 다가오고 있어요. 준비하세요!',
    3: '지금 바로 출발하세요! 귀가가 늦어지고 있어요.',
    4: '즉시 출발! 더 늦으면 귀가가 어렵습니다!',
  },
};

// 귀가 알람이 막차 모드(isLastMode)일 때 3·4단계에 덮어쓸 문구 — 데드라인 모드는 위 STAGE_MESSAGES.home 그대로 사용
const HOME_LAST_TRAIN_MESSAGES: Partial<Record<AlarmStage, string>> = {
  3: '지금 출발하지 않으면 막차를 놓칠 수 있어요!',
  4: '즉시 출발! 막차 시간이 얼마 남지 않았어요!',
};

// 1~3단계를 건너뛰고 4단계가 바로 발송되는("이미 출발 시각이 지남") 경우 전용 문구.
// 정상적으로 3단계까지 거쳐 4단계에 도달한 경우와 달리, 사용자가 지금까지의 경고를 하나도
// 못 봤을 가능성이 높아 "더 늦으면"이 아니라 "이미 지났다"는 사실을 명확히 알려야 함.
const LATE_STAGE4_MESSAGES: Record<AlarmType, string> = {
  personal: '이미 출발 시각이 지났어요! 지금 바로 출발하세요.',
  group: '이미 출발 시각이 지났어요! 그룹원들이 기다리고 있어요, 지금 바로 출발하세요.',
  home: '이미 출발 시각이 지났어요! 지금 바로 출발하세요.',
};
const LATE_HOME_LAST_TRAIN_MESSAGE = '이미 출발 시각이 지났어요! 막차를 놓쳤을 수 있어요, 지금 바로 출발하세요.';

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const versions = await loadChannelVersions();
  channelIds = {
    1: buildChannelId(1, versions[1]),
    2: buildChannelId(2, versions[2]),
    3: buildChannelId(3, versions[3]),
    4: buildChannelId(4, versions[4]),
    'arrival-check': buildChannelId('arrival-check', versions['arrival-check']),
    'arrival-expected': buildChannelId('arrival-expected', versions['arrival-expected']),
    'arrival-complete': buildChannelId('arrival-complete', versions['arrival-complete']),
  };

  if (channelsEnsured) return;

  await Promise.all([
    notifee.createChannel({
      id: channelIds[1],
      name: 'GoNow 알람 (1단계)',
      importance: AndroidImportance.HIGH,
      sound: 'stage1',
      vibration: false,
    }),

    notifee.createChannel({
      id: channelIds[2],
      name: 'GoNow 알람 (2단계)',
      importance: AndroidImportance.HIGH,
      sound: 'stage2',
      vibration: true,
      vibrationPattern: [100, 250, 250, 250],
      lights: true,
      lightColor: '#4CAF50',
    }),

    notifee.createChannel({
      id: channelIds[3],
      name: 'GoNow 알람 (3단계)',
      importance: AndroidImportance.HIGH,
      sound: 'stage3',
      vibration: true,
      vibrationPattern: [100, 500, 200, 500, 200, 500],
      lights: true,
      lightColor: '#E74C3C',
    }),

    notifee.createChannel({
      id: channelIds[4],
      name: 'GoNow 알람 (4단계)',
      importance: AndroidImportance.HIGH,
      sound: 'stage4',
      vibration: true,
      vibrationPattern: [100, 500, 200, 500, 200, 500],
      lights: true,
      lightColor: '#E74C3C',
    }),

    notifee.createChannel({
      id: channelIds['arrival-check'],
      name: 'GoNow 도착 여부 확인',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
    }),

    notifee.createChannel({
      id: channelIds['arrival-expected'],
      name: 'GoNow 도착 예정 알림',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
    }),

    notifee.createChannel({
      id: channelIds['arrival-complete'],
      name: 'GoNow 도착 완료 알림',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
    }),

    notifee.createChannel({
      id: CHANNEL_SILENT,
      name: 'GoNow 알람 실행 중 (위치 추적)',
      importance: AndroidImportance.LOW,
      vibration: false,
    }),

    notifee.createChannel({
      id: 'gonow',
      name: 'GoNow 알람 실행 중 (알림)',
      importance: AndroidImportance.LOW,
      vibration: false,
    }),
  ]);

  channelsEnsured = true;
}

// 팝업 없이 현재 알림 권한 상태만 확인 (PermissionSetupScreen 상태 표시용)
export async function getNotificationPermissionGranted(): Promise<boolean> {
  const settings = await notifee.getNotificationSettings();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

// 팝업 없이 현재 "정확한 알람"(Exact Alarm) 권한 상태만 확인 (PermissionSetupScreen 상태 표시용)
// Android 12 미만이면 항상 true(제약 자체가 없음)
export async function getExactAlarmGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const settings = await notifee.getNotificationSettings();
  return settings.android.alarm !== AndroidNotificationSetting.DISABLED;
}

// "앱 정보"보다 한 단계 더 들어간 "앱 알림" 설정 화면(마스터 토글 + 채널 목록)으로 바로
// 이동 — openChannelSettings()와 같은 인텐트 계열이지만 특정 채널이 아니라 앱 전체
// 알림 화면으로 감. OS 팝업이 막힌 경우, 사용자가 앱 정보에서 한 번 더 "알림" 항목을
// 찾아 들어가야 하는 수고를 덜어줌. PermissionSetupScreen.tsx의 "설정으로 이동" 버튼
// 액션으로 쓰이므로 export.
export function openAppNotificationSettings(): void {
  if (Platform.OS !== 'android') {
    Linking.openSettings().catch(() => {});
    return;
  }
  const packageName = Constants.expoConfig?.android?.package ?? 'com.hyeongwon.gonow';
  Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
    { key: 'android.provider.extra.APP_PACKAGE', value: packageName },
  ]).catch(() => {
    // 일부 기기/OS 버전에는 해당 화면이 없을 수 있음 — 앱 정보로라도 보냄
    Linking.openSettings().catch(() => {});
  });
}

const NOTIFICATION_DENIAL_COUNT_KEY = 'gonow_notification_denial_count'; // number(문자열로 저장)

export interface RequestNotificationResult {
  granted: boolean;
  // false면 안드로이드가 반복 거부로 OS 팝업 자체를 더 이상 안 띄우는 상태 — 이때는 우리가
  // 직접 안내해야 함(requestLocationAlways()의 canAskAgain과 동일한 의미로 이름을 맞춤).
  canAskAgain: boolean;
}

// OS 네이티브 권한 팝업을 요청한다. expo-location의 requestForegroundPermissionsAsync()와
// 달리 notifee.requestPermission()은 canAskAgain을 안 줘서, 팝업이 실제로 떴다가 거부된
// 것인지(자연스러운 흐름 — 뒤로가기와 다를 바 없음, 우리가 또 안내할 필요 없음) 아니면
// 반복 거부로 팝업 자체가 막혀서 조용히 거부로 돌아온 것인지(이땐 우리가 안내하지 않으면
// 사용자는 "허용하기"를 눌러도 아무 일도 안 일어나는 것처럼 보임) 결과만으로는 구분이
// 안 된다. 안드로이드는 2번 거부 후부터 팝업을 막으므로(실기기로 확인), 거부 횟수를
// AsyncStorage에 직접 세어서 같은 방식으로 판단한다 — 승인되면 리셋.
export async function requestNotificationPermission(): Promise<RequestNotificationResult> {
  const raw = await AsyncStorage.getItem(NOTIFICATION_DENIAL_COUNT_KEY);
  const priorDenials = raw ? Number(raw) : 0;
  const isAlreadyBlocked = priorDenials >= 2;

  const settings = await notifee.requestPermission();
  const granted = settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;

  if (granted) {
    await AsyncStorage.setItem(NOTIFICATION_DENIAL_COUNT_KEY, '0');
    return { granted: true, canAskAgain: true };
  }

  // 이미 막혀있던 상태였다면(반복 거부) 카운트를 더 올릴 필요 없음 — 계속 막힌 채로 유지
  if (!isAlreadyBlocked) {
    await AsyncStorage.setItem(NOTIFICATION_DENIAL_COUNT_KEY, String(priorDenials + 1));
  }

  // 채널 생성은 앱 시작 시(setupNotificationCategories) + 각 발송 함수 자체에서
  // 이미 보장되므로, 권한 확인/요청만 하는 이 함수에서 또 호출할 필요 없음
  return { granted: false, canAskAgain: !isAlreadyBlocked };
}

// 앱 시작 시 채널을 미리 만들어둬야, 사용자가 실제 알람을 한 번도 받기 전에도
// 시스템 설정의 알림 카테고리 화면에서 바로 커스터마이징할 수 있음
export function setupNotificationCategories(): void {
  ensureChannels().catch(() => {});
}

// 특정 채널의 현재 활성 채널ID 조회(설정 화면 등 외부에서 호출). ensureChannels()를
// 먼저 실행해 최신 상태(리셋 여부 포함)를 보장한 뒤 반환함.
export async function getChannelId(key: ChannelKey): Promise<string> {
  await ensureChannels();
  return channelIds[key];
}

// TODO: 실기기 지오펜싱 실측 테스트 완료 후 이 함수와 모든 호출부를 삭제할 것(임시 디버그용).
// EXIT 콜백/FGS 온오프 등 백그라운드 동작을 로그 없이(폰 들고 밖에 나가서) 눈으로 확인하기 위한
// 용도. 기존 "도착확인" 알림 채널을 그대로 재사용 — 새 채널 불필요.
export async function sendDebugNotification(title: string, body: string): Promise<void> {
  try {
    const channelId = await getChannelId('arrival-check');
    await notifee.displayNotification({
      title: `🧪 ${title}`,
      body,
      android: { channelId, importance: AndroidImportance.HIGH, pressAction: { id: 'default' } },
    });
  } catch {}
}

// 사용자가 시스템 설정에서 소리/진동을 직접 바꾼 채널을 앱 기본값으로 되돌림.
// 안드로이드는 같은 채널ID로 삭제 후 재생성해도 이전 사용자 설정을 그대로
// 되살리므로(un-delete), 한 번도 안 쓰인 새 채널ID를 발급하는 방식으로 리셋함.
// 방금까지 쓰던 예전 채널은 새 채널 생성 후 바로 삭제해서 설정 목록이 안 지저분해지게 함
// (지금 막 새로 만든 채널과는 다른 ID라 un-delete 문제 없이 안전하게 지워짐).
// 주의: 'arrival-expected'/'arrival-complete'는 스프링이 채널ID를 고정값으로 알고 있어서
// 호출 금지(UI에서 이 두 개는 초기화 버튼 자체를 안 보여줘야 함) — 호출하면 프론트-백엔드
// 채널ID가 어긋나 그 순간부터 해당 FCM 알림이 깨짐.
export async function resetAlarmChannel(key: ChannelKey): Promise<void> {
  if (Platform.OS !== 'android') return;
  const versions = await loadChannelVersions();
  const oldChannelId = buildChannelId(key, versions[key] ?? 0);
  // versions는 channelVersionsCache와 같은 객체 참조라, 여기서 바로 캐시도 함께 갱신됨
  versions[key] = (versions[key] ?? 0) + 1;
  await AsyncStorage.setItem(CHANNEL_VERSIONS_KEY, JSON.stringify(versions));
  channelsEnsured = false; // 새 채널ID가 생겼으니 ensureChannels()가 다시 생성하도록 강제
  await ensureChannels();
  await notifee.deleteChannel(oldChannelId).catch(() => {});
}

function buildAlarmBody(
  stage: AlarmStage,
  type: AlarmType,
  destination: string | undefined,
  whichStation: string | null | undefined,
  minutesRemaining: number | undefined,
  isLastMode?: boolean,
  isLate?: boolean,
): string {
  const isHomeLastTrain = type === 'home' && isLastMode;
  const stageMsg = isHomeLastTrain && HOME_LAST_TRAIN_MESSAGES[stage]
    ? HOME_LAST_TRAIN_MESSAGES[stage]!
    : STAGE_MESSAGES[type][stage];

  let message: string;
  if (whichStation && minutesRemaining != null && minutesRemaining > 0) {
    message = `${whichStation} 탑승까지 ${minutesRemaining}분 남았어요.`;
  } else if (whichStation && stage === 4) {
    message = isLate ? `이미 늦었어요! ${whichStation}으로 즉시 출발하세요!` : `${whichStation}으로 즉시 출발하세요!`;
  } else if (stage === 4 && isLate) {
    message = isHomeLastTrain ? LATE_HOME_LAST_TRAIN_MESSAGE : LATE_STAGE4_MESSAGES[type];
  } else {
    message = stageMsg;
  }
  return destination ? `[${destination}] ${message}` : message;
}

export async function sendAlarm(
  type: AlarmType,
  stage: AlarmStage,
  destination?: string,
  whichStation?: string | null,
  minutesRemaining?: number,
  journeyId?: number,
  appointmentId?: number,
): Promise<string[]> {
  await ensureChannels();

  const config = STAGE_CONFIG[stage];
  const title = `${config.title} - ${TYPE_NAMES[type]} 알람`;
  const body = buildAlarmBody(stage, type, destination, whichStation, minutesRemaining);

  const repeatCount = stage === 4 ? 3 : 1;
  const ids: string[] = [];

  for (let i = 0; i < repeatCount; i++) {
    const id = await notifee.displayNotification({
      title,
      body: stage === 4 ? `${body} (${i + 1}/${repeatCount})` : body,
      data: {
        ...(journeyId != null && { journeyId: String(journeyId) }),
        ...(appointmentId != null && { appointmentId: String(appointmentId) }),
      },
      android: {
        channelId: channelIds[stage],
        importance: AndroidImportance.HIGH,
        category: AndroidCategory.ALARM,
        visibility: AndroidVisibility.PUBLIC,
        // 채널이 없는 Android 8.0 미만에서는 이 값이 실제로 소리를 결정함(8.0 이상에선 채널이
        // 우선이라 무시되지만, 같은 리소스를 가리키므로 지정해둬도 무해함)
        sound: `stage${stage}`,
        vibrationPattern: config.vibrate ? [100, 500, 200, 500, 200, 500] : undefined,
        // 타이머 알람 스타일: 잠금화면에서 전체화면으로 표시
        fullScreenAction: {
          id: 'default',
          launchActivity: 'default',
        },
        pressAction: { id: 'default' },
        // 1~3단계만 X 닫기 버튼
        ...(stage <= 3 && {
          actions: [
            {
              title: '✕ 이후 알림 끄기',
              pressAction: { id: 'dismiss' },
            },
          ],
        }),
      },
    });

    ids.push(id);

    if (stage === 4 && i < repeatCount - 1) {
      await new Promise<void>((res) => setTimeout(res, 2000));
    }
  }

  return ids;
}

export async function sendArrivalCheckAlarm(
  nickname: string,
  destination: string,
  journeyId?: number,
  appointmentId?: number,
): Promise<string> {
  await ensureChannels();
  return notifee.displayNotification({
    title: '📍 도착 확인',
    body: `${nickname}님 ${destination}에 도착하신건가요?`,
    data: {
      ...(journeyId != null && { journeyId: String(journeyId) }),
      ...(appointmentId != null && { appointmentId: String(appointmentId) }),
    },
    android: {
      channelId: channelIds['arrival-check'],
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        {
          title: '예',
          pressAction: { id: 'arrival-yes', launchActivity: 'default' },
        },
        {
          title: '아니오',
          pressAction: { id: 'arrival-no' },
        },
      ],
    },
  });
}

export async function sendArrivalConfirmAlarm(
  nickname: string,
  arrivalTime: string,
  destination: string,
): Promise<string> {
  await ensureChannels();
  return notifee.displayNotification({
    title: '✅ 도착 완료',
    body: `${nickname}님이 ${arrivalTime}에 ${destination}에 도착하였습니다.`,
    android: {
      channelId: channelIds['arrival-complete'],
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  });
}

export async function sendArrivalAlarm(
  memberName: string,
  arrivalTime: string,
  destination: string,
): Promise<void> {
  await ensureChannels();
  await notifee.displayNotification({
    title: '🏃 도착예정 알림',
    body: `${memberName}님이 ${arrivalTime}에 ${destination}에 도착 예정이에요!`,
    android: {
      channelId: channelIds['arrival-expected'],
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  });
}

export async function sendLastTransitAlarm(
  transitType: '지하철' | '버스',
  stopName: string,
  time: string,
): Promise<string> {
  await ensureChannels();
  return notifee.displayNotification({
    title: `${transitType}: 지금 출발하세요!`,
    body: `${stopName} ${time} 탑승`,
    android: {
      channelId: channelIds[4],
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.ALARM,
      visibility: AndroidVisibility.PUBLIC,
      vibrationPattern: [100, 500, 200, 500, 200, 500],
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default' },
      actions: [{ title: '✕ 닫기', pressAction: { id: 'dismiss' } }],
    },
  });
}

export async function scheduleFutureAlarm(
  type: AlarmType,
  stage: AlarmStage,
  destination: string | undefined,
  triggerTimestamp: number,
  journeyId?: number,
  appointmentId?: number,
  whichStation?: string | null,
  minutesRemaining?: number,
  destLat?: number,
  destLng?: number,
  transportMode?: KakaoMapTransportMode,
  isLastMode?: boolean,
): Promise<string[]> {
  await ensureChannels();
  const config = STAGE_CONFIG[stage];
  const repeatCount = stage === 4 ? 3 : 1;
  const ids: string[] = [];
  const isPast = triggerTimestamp <= Date.now();
  const titleStage = stage === 4 && isPast ? LATE_STAGE4_TITLE : config.title;
  const title = `${titleStage} - ${TYPE_NAMES[type]} 알람`;
  const body = buildAlarmBody(stage, type, destination, whichStation, minutesRemaining, isLastMode, isPast);
  // DRIVING/TRANSIT 공통 길찾기 딥링크 — 단일 딥링크 설계
  // (docs/reference/kakao-map-deeplink-spec.md §2.2~2.4 참고)
  const canNavigate = !!transportMode && destLat != null && destLng != null;
  const navigateAction = { title: '🗺️ 길찾기', pressAction: { id: 'navigate' } };

  for (let i = 0; i < repeatCount; i++) {
    const notifBody = stage === 4 ? `${body} (${i + 1}/${repeatCount})` : body;
    const notifData = {
      ...(journeyId != null && { journeyId: String(journeyId) }),
      ...(appointmentId != null && { appointmentId: String(appointmentId) }),
      ...(canNavigate && { destLat: String(destLat), destLng: String(destLng), transportMode: transportMode as string }),
    };
    const androidConfig = {
      channelId: channelIds[stage],
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.ALARM,
      visibility: AndroidVisibility.PUBLIC,
      // 채널이 없는 Android 8.0 미만에서는 이 값이 실제로 소리를 결정함(8.0 이상에선 채널이
      // 우선이라 무시되지만, 같은 리소스를 가리키므로 지정해둬도 무해함)
      sound: `stage${stage}`,
      vibrationPattern: config.vibrate ? [100, 500, 200, 500, 200, 500] : undefined,
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default' },
      ...(stage <= 3 && {
        actions: canNavigate
          ? [{ title: '✕ 이후 알림 끄기', pressAction: { id: 'dismiss' } }, navigateAction]
          : [{ title: '✕ 이후 알림 끄기', pressAction: { id: 'dismiss' } }],
      }),
      // 4단계는 원래 액션이 없었음(닫기 버튼도 없음 — 범위 밖) — 길찾기만 조건부로 추가
      ...(stage === 4 && canNavigate && { actions: [navigateAction] }),
    };

    let id: string;
    if (isPast) {
      // 과거 시각 → 즉시 발송
      if (i > 0) await new Promise<void>((res) => setTimeout(res, 2000));
      id = await notifee.displayNotification({ title, body: notifBody, data: notifData, android: androidConfig });
    } else {
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: triggerTimestamp + i * 2500 };
      id = await notifee.createTriggerNotification({ title, body: notifBody, data: notifData, android: androidConfig }, trigger);
    }
    ids.push(id);
  }

  const storageKey = journeyId != null ? `j_${journeyId}` : appointmentId != null ? `a_${appointmentId}` : null;
  if (storageKey && !isPast) await saveTriggerIds(storageKey, ids);
  return ids;
}

// 단계별 출발 알람(1~4단계)을 서버 응답 기준으로 등록/재등록. 포그라운드(alarmService.ts)와
// 백그라운드(backgroundLocationTask.ts) 양쪽에서 상태를 폴링할 때마다 호출해도 안전 —
// departureAlarmTime+whichStation이 지난번 등록과 동일하면 즉시 return하므로, 매 폴링마다
// 취소·재등록을 반복하지 않음(이게 예전 중복 발송/메시지 고착 버그의 근본 원인이었음).
const stagingLocks = new Map<string, Promise<void>>();

// 같은 key로 거의 동시에 여러 번 호출돼도(포그라운드 alarmService.ts와 백그라운드
// backgroundLocationTask.ts가 겹쳐 돌 때 실제로 발생함) 순서대로 하나씩만 처리되도록 직렬화.
// 이게 없으면 두 호출 다 "아직 안 바뀐" 예전 지문을 읽고 둘 다 재등록을 진행해 중복이 생김.
async function withStagingLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = stagingLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // 이전 호출이 실패했어도 다음 호출은 정상 진행
  stagingLocks.set(key, run.catch(() => {}));
  return run;
}

export async function syncStagedAlarms(
  key: string, // 'j_<journeyId>' | 'a_<appointmentId>'
  type: AlarmType,
  destination: string | undefined,
  journeyId: number | undefined,
  appointmentId: number | undefined,
  preparationTime: number,
  whichStation: string | null | undefined,
  departureAlarmTime: string | null | undefined,
  destLat?: number,
  destLng?: number,
  transportMode?: KakaoMapTransportMode,
  isLastMode?: boolean,
): Promise<void> {
  if (!departureAlarmTime) return;

  return withStagingLock(key, async () => {
    const map = await loadStagingFingerprints();
    const prev = map[key];
    // 서버는 이번 폴링에서 플라스크를 실제로 재호출했을 때만 whichStation을 채워서
    // 내려주고, DEPARTING 유지처럼 재계산이 필요 없는 폴링에서는 무조건 null을 돌려줌
    // (JourneyService.updateLocation()의 DEPARTING-유지 분기, ParticipantService도 동일) —
    // 즉 null은 "역 정보가 사라졌다"가 아니라 "이번엔 새로 알려줄 게 없다"는 뜻. 이전에
    // 알던 값을 그대로 유지해야 이 null↔값 흔들림을 진짜 변경으로 오판해서 재등록(및
    // 재발송)을 반복하지 않음 — 이게 "한참 지난 후 4단계가 다시 울리는" 버그의 진짜 원인이었음.
    const normalizedStation = whichStation ?? prev?.whichStation ?? null;
    if (prev && prev.departureAlarmTime === departureAlarmTime && prev.whichStation === normalizedStation) {
      dlog('NEARDEST', `[알람] syncStagedAlarms — key:${key} 지문 동일, 재등록 스킵`);
      return;
    }

    // 기존 등록분 취소를 끝까지 기다린 뒤(같은 TRIGGER_IDS_KEY에 대한 경합 방지) 새 지문을 씀
    await cancelStagedAlarms(key);
    map[key] = { departureAlarmTime, whichStation: normalizedStation };
    await AsyncStorage.setItem(STAGING_FINGERPRINT_KEY, JSON.stringify(map));

    const stepMs = preparationTime * 60 * 1000 * 0.25;
    const alarmBase = new Date(departureAlarmTime).getTime();
    const stepTimes = [alarmBase, alarmBase + stepMs, alarmBase + stepMs * 2, alarmBase + stepMs * 3];
    const now = Date.now();

    // 각 단계에서 표시할 분: 1단계=100%, 2단계=75%, 3단계=50%, 4단계=25%
    const ratios = [1.0, 0.75, 0.5, 0.25];
    const mins = (idx: number) =>
      normalizedStation ? Math.max(0, Math.round(preparationTime * ratios[idx])) : undefined;

    // 현재 시각 기준으로 시작 단계 결정 — 아직 안 지난 첫 번째 단계부터 시작
    // 모든 단계가 지났으면 4단계(idx=3) 즉시 발송
    const foundIdx = stepTimes.findIndex((t) => now < t);
    const startIdx = foundIdx === -1 ? 3 : foundIdx;

    dlog('NEARDEST', `[알람] key:${key} ${startIdx + 1}단계부터 예약 — 1단계:${new Date(stepTimes[0]).toLocaleTimeString('ko-KR', { hour12: false })} 2단계:${new Date(stepTimes[1]).toLocaleTimeString('ko-KR', { hour12: false })} 3단계:${new Date(stepTimes[2]).toLocaleTimeString('ko-KR', { hour12: false })} 4단계:${new Date(stepTimes[3]).toLocaleTimeString('ko-KR', { hour12: false })} whichStation:${normalizedStation}`);

    try {
      const allIds: string[] = [];
      for (let i = startIdx; i < 4; i++) {
        const stage = (i + 1) as 1 | 2 | 3 | 4;
        // 4단계(i=3)이고 시각이 이미 지났으면 minutesRemaining=0 → 긴급 문구 표시
        const minutesRemaining = (i === 3 && now >= stepTimes[3]) ? 0 : mins(i);
        const ids = await scheduleFutureAlarm(type, stage, destination, stepTimes[i], journeyId, appointmentId, normalizedStation, minutesRemaining, destLat, destLng, transportMode, isLastMode);
        allIds.push(...ids);
      }
      dlog('NEARDEST', `[알람] syncStagedAlarms 등록 완료 — key:${key} ids:${allIds}`);
    } catch (e) {
      dlog('NEARDEST', `[알람] syncStagedAlarms 등록 실패 ${e}`);
    }
  });
}

// 서버 에러 응답 바디(JSON)에서 사용자에게 보여줄 메시지 추출, 실패 시 fallback
export function extractApiErrorMessage(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message;
  } catch {}
  return fallback;
}
