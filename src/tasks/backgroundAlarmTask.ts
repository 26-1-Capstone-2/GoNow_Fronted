import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY } from '@/src/store/authStore';

export const BACKGROUND_ALARM_TASK = 'BACKGROUND-ALARM-TASK';

const BASE_URL = 'https://gonow-api.uk';
const CHANNEL_DEFAULT = 'gonow-alarm';
const CHANNEL_URGENT = 'gonow-alarm-urgent';

async function ensureChannels(): Promise<void> {
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

async function fetchJson(path: string, token: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function showAlarm(
  title: string,
  body: string,
  journeyId?: number,
  appointmentId?: number,
): Promise<void> {
  await notifee.displayNotification({
    title,
    body,
    data: {
      ...(journeyId != null && { journeyId: String(journeyId) }),
      ...(appointmentId != null && { appointmentId: String(appointmentId) }),
    },
    android: {
      channelId: CHANNEL_URGENT,
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.ALARM,
      visibility: AndroidVisibility.PUBLIC,
      vibrationPattern: [100, 500, 200, 500, 200, 500],
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default' },
      actions: [
        { title: '✕ 닫기', pressAction: { id: 'dismiss' } },
      ],
    },
  });
}

// 모듈 로드 시 태스크 정의 (registerTaskAsync 전에 반드시 실행돼야 함)
TaskManager.defineTask(BACKGROUND_ALARM_TASK, async ({ data, error }) => {
  if (error) return;

  const notification = (data as any)?.notification as Notifications.Notification | undefined;
  if (!notification) return;

  const fcmData = notification.request.content.data as Record<string, unknown>;

  const journeyIds: number[] = fcmData?.journey_ids
    ? String(fcmData.journey_ids).split(',').map(Number).filter(n => !isNaN(n))
    : [];
  const appointmentIds: number[] = fcmData?.appointment_ids
    ? String(fcmData.appointment_ids).split(',').map(Number).filter(n => !isNaN(n))
    : [];

  if (journeyIds.length === 0 && appointmentIds.length === 0) return;

  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;

  await ensureChannels();

  await Promise.all([
    ...journeyIds.map(async (id) => {
      try {
        const res = await fetchJson(`/api/journeys/${id}`, token);
        const dest: string = res?.data?.dest_name ?? '목적지';
        const type: string = res?.data?.journey_type ?? 'PERSONAL';
        const label = type === 'HOME' ? '귀가' : '개인';
        await showAlarm(
          `🔴 ${label} 알람`,
          `지금 바로 출발하세요! [${dest}]`,
          id,
          undefined,
        );
      } catch {}
    }),
    ...appointmentIds.map(async (id) => {
      try {
        const res = await fetchJson(`/api/appointments/${id}`, token);
        const dest: string = res?.data?.dest_name ?? '목적지';
        await showAlarm(
          '🔴 그룹 알람',
          `지금 바로 출발하세요! [${dest}]`,
          undefined,
          id,
        );
      } catch {}
    }),
  ]);
});
