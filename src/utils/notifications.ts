import notifee, {
  AndroidCategory,
  AndroidImportance,
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

const CHANNEL_STAGE1 = 'gonow-alarm-1';
const CHANNEL_DEFAULT = 'gonow-alarm-2';
const CHANNEL_STAGE3 = 'gonow-alarm-3';
const CHANNEL_URGENT = 'gonow-alarm-4';
export const CHANNEL_SILENT = 'gonow-silent';

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
  1: { title: '🟢 여유 구간', sound: false, vibrate: false },
  2: { title: '🟡 주의 구간', sound: true,  vibrate: false },
  3: { title: '🟠 위험 구간', sound: true,  vibrate: true  },
  4: { title: '🔴 임계 구간', sound: true,  vibrate: true  },
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

  await notifee.createChannel({
    id: CHANNEL_STAGE1,
    name: 'GoNow 알람 (1단계)',
    importance: AndroidImportance.HIGH,
    vibration: false,
    bypassDnd: true,
  });

  await notifee.createChannel({
    id: CHANNEL_DEFAULT,
    name: 'GoNow 알람 (2단계)',
    importance: AndroidImportance.HIGH,
    vibration: true,
    vibrationPattern: [100, 250, 250, 250],
    lights: true,
    lightColor: '#4CAF50',
    bypassDnd: true,
  });

  await notifee.createChannel({
    id: CHANNEL_STAGE3,
    name: 'GoNow 알람 (3단계)',
    importance: AndroidImportance.HIGH,
    vibration: true,
    vibrationPattern: [100, 500, 200, 500, 200, 500],
    lights: true,
    lightColor: '#E74C3C',
    bypassDnd: true,
  });

  await notifee.createChannel({
    id: CHANNEL_URGENT,
    name: 'GoNow 알람 (4단계)',
    importance: AndroidImportance.HIGH,
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

  await ensureChannels();
  return true;
}

// _layout.tsx 호환용 no-op
export function setupNotificationCategories(): void {}

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
        channelId: stage === 1 ? CHANNEL_STAGE1 : stage === 2 ? CHANNEL_DEFAULT : stage === 3 ? CHANNEL_STAGE3 : CHANNEL_URGENT,
        importance: AndroidImportance.HIGH,
        category: AndroidCategory.ALARM,
        visibility: AndroidVisibility.PUBLIC,
        sound: 'default',
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
      channelId: CHANNEL_STAGE3,
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
      channelId: CHANNEL_DEFAULT,
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
      channelId: CHANNEL_DEFAULT,
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
      channelId: CHANNEL_URGENT,
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
      channelId: stage === 1 ? CHANNEL_STAGE1 : stage === 2 ? CHANNEL_DEFAULT : stage === 3 ? CHANNEL_STAGE3 : CHANNEL_URGENT,
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.ALARM,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
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

export async function sendAllArrivalAlarms(
  members: { name: string; arrivalTime: string }[],
  destination: string,
): Promise<void> {
  for (let i = 0; i < members.length; i++) {
    if (i > 0) await new Promise<void>((res) => setTimeout(res, 3000));
    await sendArrivalAlarm(members[i].name, members[i].arrivalTime, destination);
  }
}
