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

export type AlarmStage = 1 | 2 | 3 | 4;
export type AlarmType = 'personal' | 'group' | 'home';

const CHANNEL_DEFAULT = 'gonow-alarm';
const CHANNEL_URGENT = 'gonow-alarm-urgent';

// 백그라운드 이벤트 핸들러 (모듈 레벨 등록 필수)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;
    const notifId = detail.notification?.id;
    const data = detail.notification?.data;

    if (notifId) await notifee.cancelNotification(notifId);

    if (actionId === 'arrival-yes') {
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
    id: CHANNEL_DEFAULT,
    name: 'GoNow 알람',
    importance: AndroidImportance.HIGH,
    vibration: true,
    vibrationPattern: [100, 250, 250, 250],
    lights: true,
    lightColor: '#4CAF50',
  });

  await notifee.createChannel({
    id: CHANNEL_URGENT,
    name: 'GoNow 긴급 알람',
    importance: AndroidImportance.HIGH,
    vibration: true,
    vibrationPattern: [100, 500, 200, 500, 200, 500],
    lights: true,
    lightColor: '#E74C3C',
    bypassDnd: true,
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
  const message = (whichStation && minutesRemaining != null && minutesRemaining > 0)
    ? `${whichStation} 탑승까지 ${minutesRemaining}분 남았어요.`
    : stageMsg;
  return destination ? `[${destination}] ${message}` : message;
}

export async function sendAlarm(
  type: AlarmType,
  stage: AlarmStage,
  destination?: string,
  whichStation?: string | null,
  minutesRemaining?: number,
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
      android: {
        channelId: stage >= 3 ? CHANNEL_URGENT : CHANNEL_DEFAULT,
        importance: AndroidImportance.HIGH,
        category: AndroidCategory.ALARM,
        visibility: AndroidVisibility.PUBLIC,
        sound: config.sound ? 'default' : undefined,
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
      channelId: CHANNEL_DEFAULT,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default' },
      actions: [
        {
          title: '예',
          pressAction: { id: 'arrival-yes' },
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
      pressAction: { id: 'default' },
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
      pressAction: { id: 'default' },
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
  stage: Exclude<AlarmStage, 1>,
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

  for (let i = 0; i < repeatCount; i++) {
    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: triggerTimestamp + i * 2500,
    };
    const id = await notifee.createTriggerNotification(
      {
        title,
        body: stage === 4 ? `${body} (${i + 1}/${repeatCount})` : body,
        data: {
          ...(journeyId != null && { journeyId: String(journeyId) }),
          ...(appointmentId != null && { appointmentId: String(appointmentId) }),
        },
        android: {
          channelId: stage >= 3 ? CHANNEL_URGENT : CHANNEL_DEFAULT,
          importance: AndroidImportance.HIGH,
          category: AndroidCategory.ALARM,
          visibility: AndroidVisibility.PUBLIC,
          sound: config.sound ? 'default' : undefined,
          vibrationPattern: config.vibrate ? [100, 500, 200, 500, 200, 500] : undefined,
          fullScreenAction: { id: 'default', launchActivity: 'default' },
          pressAction: { id: 'default' },
          ...(stage <= 3 && {
            actions: [{ title: '✕ 닫기', pressAction: { id: 'dismiss' } }],
          }),
        },
      },
      trigger,
    );
    ids.push(id);
  }
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
