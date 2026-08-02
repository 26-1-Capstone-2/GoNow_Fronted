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
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AlarmStage = 1 | 2 | 3 | 4;
export type AlarmType = 'personal' | 'group' | 'home';

const CHANNEL_BASE: Record<AlarmStage, string> = {
  1: 'gonow-alarm-1',
  2: 'gonow-alarm-2',
  3: 'gonow-alarm-3',
  4: 'gonow-alarm-4',
};
export const CHANNEL_SILENT = 'gonow-silent';

// 단계별 채널의 "리셋 횟수" — 안드로이드는 같은 채널ID로 삭제 후 재생성해도 이전
// 사용자 설정을 그대로 되살리므로(un-delete), 진짜 초기화하려면 한 번도 안 쓰인
// 새 채널ID가 필요함. 이 값을 늘려서 ID 뒤에 붙이는 방식으로 매번 새 채널을 만듦.
const CHANNEL_VERSIONS_KEY = 'gonow_channel_versions'; // Record<'1'|'2'|'3'|'4', number>

let channelIds: Record<AlarmStage, string> = { ...CHANNEL_BASE };

// 리셋 횟수는 "초기화" 버튼을 누를 때만 바뀌는데, ensureChannels()는 알람을 보낼
// 때마다(하루 여러 번) 호출되므로 매번 AsyncStorage를 다시 읽지 않고 세션 중엔 캐싱함.
// resetAlarmChannel()이 값을 바꾸면 캐시도 그 자리에서 같이 갱신됨.
let channelVersionsCache: Record<AlarmStage, number> | null = null;

function buildChannelId(stage: AlarmStage, version: number): string {
  return version <= 0 ? CHANNEL_BASE[stage] : `${CHANNEL_BASE[stage]}-r${version}`;
}

async function loadChannelVersions(): Promise<Record<AlarmStage, number>> {
  if (channelVersionsCache) return channelVersionsCache;
  try {
    const raw = await AsyncStorage.getItem(CHANNEL_VERSIONS_KEY);
    const map: Partial<Record<string, number>> = raw ? JSON.parse(raw) : {};
    channelVersionsCache = { 1: map['1'] ?? 0, 2: map['2'] ?? 0, 3: map['3'] ?? 0, 4: map['4'] ?? 0 };
  } catch {
    channelVersionsCache = { 1: 0, 2: 0, 3: 0, 4: 0 };
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
    console.log(`[trigger] 저장 완료 — key:${key} ids:${ids}`);
  } catch {}
}

export async function cancelStagedAlarms(key: string): Promise<void> {
  return cancelAndRemoveTriggerIds(key);
}

async function cancelAndRemoveTriggerIds(key: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TRIGGER_IDS_KEY);
    if (!raw) { console.log(`[trigger] 취소 시도 — key:${key} AsyncStorage 없음`); return; }
    const map: Record<string, string[]> = JSON.parse(raw);
    const ids = map[key] ?? [];
    console.log(`[trigger] 취소 시도 — key:${key} ids:${ids}`);
    await Promise.all(ids.map(id => notifee.cancelTriggerNotification(id).catch(() => {})));
    delete map[key];
    await AsyncStorage.setItem(TRIGGER_IDS_KEY, JSON.stringify(map));
    console.log(`[trigger] 취소 완료 — key:${key}`);
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
      if (storageKey) await cancelAndRemoveTriggerIds(storageKey);
      if (data?.journeyId) {
        const { createJourneysApi } = await import('@/src/api/journeys');
        await createJourneysApi().arrive(Number(data.journeyId));
      }
      if (data?.appointmentId) {
        const { createAppointmentsApi } = await import('@/src/api/appointments');
        await createAppointmentsApi().arriveParticipant(Number(data.appointmentId));
      }
    }
  }
});

const STAGE_CONFIG = {
  1: { title: '🟢 여유 구간', vibrate: false },
  2: { title: '🟡 주의 구간', vibrate: true  },
  3: { title: '🟠 위험 구간', vibrate: true  },
  4: { title: '🔴 임계 구간', vibrate: true  },
};

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
    1: '귀가 준비를 시작하세요. 아직 여유가 있어요.',
    2: '귀가 시간이 다가오고 있어요. 준비하세요!',
    3: '지금 출발하지 않으면 막차를 놓칠 수 있어요!',
    4: '즉시 출발! 막차 시간이 얼마 남지 않았어요!',
  },
};

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const versions = await loadChannelVersions();
  channelIds = {
    1: buildChannelId(1, versions[1]),
    2: buildChannelId(2, versions[2]),
    3: buildChannelId(3, versions[3]),
    4: buildChannelId(4, versions[4]),
  };

  await notifee.createChannel({
    id: channelIds[1],
    name: 'GoNow 알람 (1단계)',
    importance: AndroidImportance.HIGH,
    sound: 'stage1',
    vibration: false,
    bypassDnd: true,
  });

  await notifee.createChannel({
    id: channelIds[2],
    name: 'GoNow 알람 (2단계)',
    importance: AndroidImportance.HIGH,
    sound: 'stage2',
    vibration: true,
    vibrationPattern: [100, 250, 250, 250],
    lights: true,
    lightColor: '#4CAF50',
    bypassDnd: true,
  });

  await notifee.createChannel({
    id: channelIds[3],
    name: 'GoNow 알람 (3단계)',
    importance: AndroidImportance.HIGH,
    sound: 'stage3',
    vibration: true,
    vibrationPattern: [100, 500, 200, 500, 200, 500],
    lights: true,
    lightColor: '#E74C3C',
    bypassDnd: true,
  });

  await notifee.createChannel({
    id: channelIds[4],
    name: 'GoNow 알람 (4단계)',
    importance: AndroidImportance.HIGH,
    sound: 'stage4',
    vibration: true,
    vibrationPattern: [100, 500, 200, 500, 200, 500],
    lights: true,
    lightColor: '#E74C3C',
    bypassDnd: true,
  });

  await notifee.createChannel({
    id: CHANNEL_SILENT,
    name: 'GoNow 알람 실행 중 (위치 추적)',
    importance: AndroidImportance.LOW,
    vibration: false,
  });

  await notifee.createChannel({
    id: 'gonow',
    name: 'GoNow 알람 실행 중 (알림)',
    importance: AndroidImportance.LOW,
    vibration: false,
  });
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

export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();

  if (settings.authorizationStatus < AuthorizationStatus.AUTHORIZED) {
    Alert.alert(
      '알림 권한 필요',
      'GoNow 알람을 받으려면 알림 권한이 필요해요. 설정에서 허용해주세요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '설정으로 이동', onPress: () => Linking.openSettings() },
      ]
    );
    return false;
  }

  // 채널 생성은 앱 시작 시(setupNotificationCategories) + 각 발송 함수 자체에서
  // 이미 보장되므로, 권한 확인/요청만 하는 이 함수에서 또 호출할 필요 없음
  return true;
}

// 앱 시작 시 채널을 미리 만들어둬야, 사용자가 실제 알람을 한 번도 받기 전에도
// 시스템 설정의 알림 카테고리 화면에서 바로 커스터마이징할 수 있음
export function setupNotificationCategories(): void {
  ensureChannels().catch(() => {});
}

// 특정 단계의 현재 활성 채널ID 조회(설정 화면 등 외부에서 호출). ensureChannels()를
// 먼저 실행해 최신 상태(리셋 여부 포함)를 보장한 뒤 반환함.
export async function getChannelId(stage: AlarmStage): Promise<string> {
  await ensureChannels();
  return channelIds[stage];
}

// 사용자가 시스템 설정에서 소리/진동을 직접 바꾼 채널을 앱 기본값으로 되돌림.
// 안드로이드는 같은 채널ID로 삭제 후 재생성해도 이전 사용자 설정을 그대로
// 되살리므로(un-delete), 한 번도 안 쓰인 새 채널ID를 발급하는 방식으로 리셋함.
// 방금까지 쓰던 예전 채널은 새 채널 생성 후 바로 삭제해서 설정 목록이 안 지저분해지게 함
// (지금 막 새로 만든 채널과는 다른 ID라 un-delete 문제 없이 안전하게 지워짐).
export async function resetAlarmChannel(stage: AlarmStage): Promise<void> {
  if (Platform.OS !== 'android') return;
  const versions = await loadChannelVersions();
  const oldChannelId = buildChannelId(stage, versions[stage] ?? 0);
  // versions는 channelVersionsCache와 같은 객체 참조라, 여기서 바로 캐시도 함께 갱신됨
  versions[stage] = (versions[stage] ?? 0) + 1;
  await AsyncStorage.setItem(CHANNEL_VERSIONS_KEY, JSON.stringify(versions));
  await ensureChannels();
  await notifee.deleteChannel(oldChannelId).catch(() => {});
}

function buildAlarmBody(
  stage: AlarmStage,
  type: AlarmType,
  destination: string | undefined,
  whichStation: string | null | undefined,
  minutesRemaining: number | undefined,
): string {
  const stageMsg = STAGE_MESSAGES[type][stage];
  let message: string;
  if (whichStation && minutesRemaining != null && minutesRemaining > 0) {
    message = `${whichStation} 탑승까지 ${minutesRemaining}분 남았어요.`;
  } else if (whichStation && stage === 4) {
    message = `${whichStation}으로 즉시 출발하세요!`;
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
              title: '✕ 닫기',
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
      channelId: channelIds[3],
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
      channelId: channelIds[2],
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
      channelId: channelIds[2],
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
): Promise<string[]> {
  await ensureChannels();
  const config = STAGE_CONFIG[stage];
  const title = `${config.title} - ${TYPE_NAMES[type]} 알람`;
  const body = buildAlarmBody(stage, type, destination, whichStation, minutesRemaining);
  const repeatCount = stage === 4 ? 3 : 1;
  const ids: string[] = [];
  const isPast = triggerTimestamp <= Date.now();

  for (let i = 0; i < repeatCount; i++) {
    const notifBody = stage === 4 ? `${body} (${i + 1}/${repeatCount})` : body;
    const notifData = {
      ...(journeyId != null && { journeyId: String(journeyId) }),
      ...(appointmentId != null && { appointmentId: String(appointmentId) }),
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
      ...(stage <= 3 && { actions: [{ title: '✕ 닫기', pressAction: { id: 'dismiss' } }] }),
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

// 서버 에러 응답 바디(JSON)에서 사용자에게 보여줄 메시지 추출, 실패 시 fallback
export function extractApiErrorMessage(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message;
  } catch {}
  return fallback;
}

export async function sendAllArrivalAlarms(
  members: { name: string; arrivalTime: string }[],
  destination: string,
): Promise<void> {
  for (let i = 0; i < members.length; i++) {
    if (i > 0) await new Promise<void>((res) => setTimeout(res, 3000));
    await sendArrivalAlarm(members[i].name, members[i].arrivalTime, destination);
  }
}
