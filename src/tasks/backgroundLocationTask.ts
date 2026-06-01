import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY } from '@/src/store/authStore';
import { sendAlarm, scheduleFutureAlarm, AlarmType } from '@/src/utils/notifications';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND-LOCATION-TASK';
export const ACTIVE_JOURNEYS_KEY = 'gonow_active_journeys';
export const ACTIVE_APPOINTMENTS_KEY = 'gonow_active_appointments';
export const STAGING_DONE_KEY = 'gonow_staging_done';

const BASE_URL = 'https://gonow-api.uk';

async function patchLocation(path: string, token: string, lat: number, lng: number) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getStagingDone(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(STAGING_DONE_KEY);
  return new Set(raw ? JSON.parse(raw) : []);
}

async function markStagingDone(key: string): Promise<void> {
  const done = await getStagingDone();
  done.add(key);
  await AsyncStorage.setItem(STAGING_DONE_KEY, JSON.stringify([...done]));
}

async function removeStagingKey(key: string): Promise<void> {
  const done = await getStagingDone();
  done.delete(key);
  await AsyncStorage.setItem(STAGING_DONE_KEY, JSON.stringify([...done]));
}

export async function startBackgroundLocationUpdates(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 30000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: 'GoNow 알람 실행 중',
        notificationBody: '출발 시간을 모니터링하고 있어요.',
        notificationColor: '#4CAF50',
      },
    });
  }
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
  }
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const loc = locations?.[0];
  if (!loc) return;

  const { latitude: lat, longitude: lng } = loc.coords;

  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;

  const [journeysRaw, appointmentsRaw] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY),
    AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY),
  ]);

  const journeyIds: number[] = journeysRaw ? JSON.parse(journeysRaw) : [];
  const appointmentIds: number[] = appointmentsRaw ? JSON.parse(appointmentsRaw) : [];

  if (journeyIds.length === 0 && appointmentIds.length === 0) {
    await stopBackgroundLocationUpdates();
    return;
  }

  const stagingDone = await getStagingDone();
  const remainingJourneys: number[] = [];
  const remainingAppointments: number[] = [];

  await Promise.all([
    ...journeyIds.map(async (id) => {
      const key = `j_${id}`;
      try {
        const res = await patchLocation(`/api/journeys/${id}/location`, token, lat, lng);
        const { journey_status, preparation_time, journey_type, dest_name } = res?.data ?? {};
        const type: AlarmType = journey_type === 'HOME' ? 'home' : 'personal';

        if (journey_status === 'DEPARTING' && !stagingDone.has(key)) {
          stagingDone.add(key);
          await markStagingDone(key);
          const stepMs = (preparation_time ?? 0) * 60 * 1000 * 0.25;
          await sendAlarm(type, 1, dest_name);
          await Promise.all([
            scheduleFutureAlarm(type, 2, dest_name, Date.now() + stepMs, id, undefined),
            scheduleFutureAlarm(type, 3, dest_name, Date.now() + stepMs * 2, id, undefined),
            scheduleFutureAlarm(type, 4, dest_name, Date.now() + stepMs * 3, id, undefined),
          ]);
        }

        if (journey_status === 'ARRIVED') {
          await removeStagingKey(key);
        } else {
          remainingJourneys.push(id);
        }
      } catch {
        remainingJourneys.push(id);
      }
    }),
    ...appointmentIds.map(async (id) => {
      const key = `a_${id}`;
      try {
        const res = await patchLocation(`/api/appointments/${id}/participants/location`, token, lat, lng);
        const { participant_status, preparation_time, dest_name } = res?.data ?? {};

        if (participant_status === 'DEPARTING' && !stagingDone.has(key)) {
          stagingDone.add(key);
          await markStagingDone(key);
          const stepMs = (preparation_time ?? 0) * 60 * 1000 * 0.25;
          await sendAlarm('group', 1, dest_name);
          await Promise.all([
            scheduleFutureAlarm('group', 2, dest_name, Date.now() + stepMs, undefined, id),
            scheduleFutureAlarm('group', 3, dest_name, Date.now() + stepMs * 2, undefined, id),
            scheduleFutureAlarm('group', 4, dest_name, Date.now() + stepMs * 3, undefined, id),
          ]);
        }

        if (participant_status === 'ARRIVED') {
          await removeStagingKey(key);
        } else {
          remainingAppointments.push(id);
        }
      } catch {
        remainingAppointments.push(id);
      }
    }),
  ]);

  await Promise.all([
    AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(remainingJourneys)),
    AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(remainingAppointments)),
  ]);

  if (remainingJourneys.length === 0 && remainingAppointments.length === 0) {
    await stopBackgroundLocationUpdates();
  }
});
