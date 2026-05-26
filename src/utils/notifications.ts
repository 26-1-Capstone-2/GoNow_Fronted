import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';

// 알림 표시 방식 설정
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// 알람 단계 타입
export type AlarmStage = 1 | 2 | 3 | 4;
export type AlarmType = 'personal' | 'group' | 'home';

// 단계별 알람 설정
const STAGE_CONFIG = {
  1: {
    title: '🟢 여유 구간',
    sound: false,
    vibrate: false,
  },
  2: {
    title: '🟡 주의 구간',
    sound: true,
    vibrate: false,
  },
  3: {
    title: '🟠 위험 구간',
    sound: true,
    vibrate: true,
  },
  4: {
    title: '🔴 임계 구간',
    sound: true,
    vibrate: true,
  },
};

// 알람 타입별 이름
const TYPE_NAMES = {
  personal: '개인',
  group: '그룹',
  home: '귀가',
};

// 알람 단계별 메시지
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

// 알림 권한 요청
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    console.warn('실제 기기에서만 알림이 작동합니다.');
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
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

  // Android 채널 설정
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('gonow-alarm', {
      name: 'GoNow 알람',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAF50',
      sound: 'default',
    });
  }

  return true;
}

// 도착 여부 확인 알람 (닉네임님 목적지에 도착하신건가요?)
export async function sendArrivalCheckAlarm(
  nickname: string,
  destination: string,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: '📍 도착 확인',
      body: `${nickname}님 ${destination}에 도착하신건가요?`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: null,
  });
}

// 도착 완료 알람 (닉네임님이 00시 00분에 목적지에 도착하였습니다)
export async function sendArrivalConfirmAlarm(
  nickname: string,
  arrivalTime: string,
  destination: string,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: '✅ 도착 완료',
      body: `${nickname}님이 ${arrivalTime}에 ${destination}에 도착하였습니다.`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: null,
  });
}

// 도착예정 알람 발송
export async function sendArrivalAlarm(
  memberName: string,
  arrivalTime: string,
  destination: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🏃 도착예정 알림',
      body: `${memberName}님이 ${arrivalTime}에 ${destination}에 도착 예정이에요!`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: null,
  });
}

// 전체 멤버 도착예정 알람
export async function sendAllArrivalAlarms(
  members: { name: string; arrivalTime: string }[],
  destination: string,
): Promise<void> {
  for (let i = 0; i < members.length; i++) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🏃 도착예정 알림',
        body: `${members[i].name}님이 ${members[i].arrivalTime}에 ${destination}에 도착 예정이에요!`,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: i === 0
        ? null
        : { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: i * 3, repeats: false },
    });
  }
}

// 알람 발송
export async function sendAlarm(
  type: AlarmType,
  stage: AlarmStage,
  destination?: string,
): Promise<string[]> {
  const config = STAGE_CONFIG[stage];
  const typeName = TYPE_NAMES[type];
  const message = STAGE_MESSAGES[type][stage];

  const title = `${config.title} - ${typeName} 알람`;
  const body = destination ? `[${destination}] ${message}` : message;

  // 4단계: 3번 반복 발송 (2초 간격)
  const repeatCount = stage === 4 ? 3 : 1;
  const ids: string[] = [];

  for (let i = 0; i < repeatCount; i++) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: stage === 4 ? `${body} (${i + 1}/${repeatCount})` : body,
        sound: config.sound ? 'default' : false,
        vibrate: config.vibrate ? [0, 500, 200, 500, 200, 500] : undefined,
        priority: stage >= 3
          ? Notifications.AndroidNotificationPriority.MAX
          : stage === 2
            ? Notifications.AndroidNotificationPriority.HIGH
            : Notifications.AndroidNotificationPriority.DEFAULT,
      },
      trigger: stage === 4 && i > 0
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: i * 2, repeats: false }
        : null,
    });
    ids.push(id);
  }
  return ids;
}