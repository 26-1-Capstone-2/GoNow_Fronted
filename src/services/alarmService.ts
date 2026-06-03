import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import { createJourneysApi, JourneyStatus } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import {
  sendAlarm,
  scheduleFutureAlarm,
  sendArrivalCheckAlarm,
  sendArrivalAlarm,
  sendArrivalConfirmAlarm,
  AlarmType,
} from '@/src/utils/notifications';
import {
  ACTIVE_JOURNEYS_KEY,
  ACTIVE_APPOINTMENTS_KEY,
  STAGING_DONE_KEY,
  DESIRED_INTERVALS_KEY,
} from '@/src/tasks/backgroundLocationTask';

const journeysApi = createJourneysApi();
const appointmentsApi = createAppointmentsApi();
const DEFAULT_INTERVAL = 30;

interface AlarmTarget {
  alarmType: AlarmType;
  destination: string;
  journeyId?: number;
  appointmentId?: number;
}

class AlarmRunner {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stageTriggerIds: string[] = [];
  private target: AlarmTarget | null = null;
  private status: JourneyStatus = 'SCHEDULED';
  private intervalSec = DEFAULT_INTERVAL;
  private stagingStarted = false;
  private movingSent = false;
  private arrivedSent = false;
  private nearDestSent = false;
  private onFinish?: () => void;

  setOnFinish(cb: () => void): void {
    this.onFinish = cb;
  }

  async start(target: AlarmTarget): Promise<void> {
    this.stop();
    this.target = target;
    this.status = 'SCHEDULED';
    this.stagingStarted = false;
    this.movingSent = false;
    this.arrivedSent = false;
    this.nearDestSent = false;
    this.intervalSec = DEFAULT_INTERVAL;

    // 백그라운드 태스크가 이 알람을 처리하지 않도록 AsyncStorage에서 제거
    await this.handOffFromBackground();

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    await this.poll();
  }

  private async handOffFromBackground(): Promise<void> {
    const { journeyId, appointmentId } = this.target!;
    const key = journeyId != null ? `j_${journeyId}` : `a_${appointmentId}`;

    // 백그라운드 태스크의 active 목록에서 제거
    await Promise.all([
      journeyId != null && AsyncStorage.getItem(ACTIVE_JOURNEYS_KEY).then(async (raw) => {
        const ids: number[] = raw ? JSON.parse(raw) : [];
        await AsyncStorage.setItem(ACTIVE_JOURNEYS_KEY, JSON.stringify(ids.filter(id => id !== journeyId)));
      }),
      appointmentId != null && AsyncStorage.getItem(ACTIVE_APPOINTMENTS_KEY).then(async (raw) => {
        const ids: number[] = raw ? JSON.parse(raw) : [];
        await AsyncStorage.setItem(ACTIVE_APPOINTMENTS_KEY, JSON.stringify(ids.filter(id => id !== appointmentId)));
      }),
      // staging done 마킹 → 백그라운드 태스크가 이중으로 알람 울리지 않도록
      AsyncStorage.getItem(STAGING_DONE_KEY).then(async (raw) => {
        const done: string[] = raw ? JSON.parse(raw) : [];
        if (!done.includes(key)) {
          await AsyncStorage.setItem(STAGING_DONE_KEY, JSON.stringify([...done, key]));
        }
      }),
    ].filter(Boolean));
  }

  stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.cancelRemainingStages();
    this.target = null;
    const cb = this.onFinish;
    this.onFinish = undefined;
    cb?.();
  }

  cancelRemainingStages(): void {
    this.stageTriggerIds.forEach(id => notifee.cancelTriggerNotification(id).catch(() => {}));
    this.stageTriggerIds = [];
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.poll(), this.intervalSec * 1000);
  }

  private async poll(): Promise<void> {
    if (!this.target) return;

    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      if (this.target.alarmType === 'group') {
        await this.pollGroup(loc.coords.latitude, loc.coords.longitude);
      } else {
        await this.pollPersonal(loc.coords.latitude, loc.coords.longitude);
      }
    } catch {
      this.scheduleNextPoll();
    }
  }

  private async pollPersonal(lat: number, lng: number): Promise<void> {
    if (!this.target?.journeyId) return;

    const res = await journeysApi.updateLocation(this.target.journeyId, lat, lng);
    if (!res.data) return;

    const { journey_status, preparation_time, interval, which_station } = res.data;
    if (interval !== null) {
      this.intervalSec = interval;
      // 백그라운드 전환 시 태스크가 이어받을 수 있도록 저장
      const key = `j_${this.target!.journeyId}`;
      AsyncStorage.getItem(DESIRED_INTERVALS_KEY).then(raw => {
        const intervals = raw ? JSON.parse(raw) : {};
        intervals[key] = interval;
        AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(intervals));
      }).catch(() => {});
    }
    if (!this.target) return;
    this.scheduleNextPoll();
    this.handlePersonalStatus(journey_status, preparation_time, which_station);
  }

  private async pollGroup(lat: number, lng: number): Promise<void> {
    if (!this.target?.appointmentId) return;

    const res = await appointmentsApi.updateParticipantLocation(this.target.appointmentId, lat, lng);
    if (!res.data) return;

    const { participant_status, appointment_status, estimated_arrival, preparation_time, interval, which_station } = res.data;

    useAppointmentStatusStore.getState().setStatus(this.target.appointmentId, appointment_status);

    if (interval !== null) {
      this.intervalSec = interval;
      const key = `a_${this.target!.appointmentId}`;
      AsyncStorage.getItem(DESIRED_INTERVALS_KEY).then(raw => {
        const intervals = raw ? JSON.parse(raw) : {};
        intervals[key] = interval;
        AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(intervals));
      }).catch(() => {});
    }
    if (!this.target) return;
    this.scheduleNextPoll();
    this.handleGroupStatus(participant_status, preparation_time, estimated_arrival, which_station);
  }

  private handlePersonalStatus(newStatus: JourneyStatus, preparationTime: number, whichStation?: string | null): void {
    if (newStatus === 'READY' && this.status === 'SCHEDULED') {
      this.status = newStatus;
      this.poll();
      return;
    }

    if (newStatus !== this.status) {
      this.status = newStatus;

      if (newStatus === 'DEPARTING' && !this.stagingStarted) {
        this.stagingStarted = true;
        this.scheduleAlarmStages(preparationTime, whichStation);
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        sendArrivalCheckAlarm('나', this.target!.destination, this.target?.journeyId);
      }

      if (newStatus === 'ARRIVED') this.stop();
    }
  }

  private handleGroupStatus(newStatus: JourneyStatus, preparationTime: number, estimatedArrival: string, whichStation?: string | null): void {
    if (newStatus === 'READY' && this.status === 'SCHEDULED') {
      this.status = newStatus;
      this.poll();
      return;
    }

    if (newStatus !== this.status) {
      this.status = newStatus;

      if (newStatus === 'DEPARTING' && !this.stagingStarted) {
        this.stagingStarted = true;
        this.scheduleAlarmStages(preparationTime, whichStation);
      }

      if (newStatus === 'MOVING' && !this.movingSent) {
        this.movingSent = true;
        const arrivalTime = formatEstimatedArrival(estimatedArrival);
        sendArrivalAlarm('나', arrivalTime, this.target!.destination);
      }

      if (newStatus === 'ARRIVED' && !this.arrivedSent) {
        this.arrivedSent = true;
        const arrivalTime = formatEstimatedArrival(estimatedArrival);
        sendArrivalConfirmAlarm('나', arrivalTime, this.target!.destination);
        this.stop();
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        sendArrivalCheckAlarm('나', this.target!.destination, undefined, this.target?.appointmentId);
      }
    }
  }

  private scheduleAlarmStages(preparationTime: number, whichStation?: string | null): void {
    const stepMs = preparationTime * 60 * 1000 * 0.25;
    const type = this.target!.alarmType;
    const dest = this.target!.destination;
    const journeyId = this.target!.journeyId;
    const appointmentId = this.target!.appointmentId;

    // 각 단계 발송 시점의 탑승까지 남은 분 (which_station 있을 때만 사용)
    const mins = whichStation
      ? (f: number) => Math.round(preparationTime * f)
      : () => undefined;

    sendAlarm(type, 1, dest, whichStation, mins(1.0));

    // 앱이 꺼져도 OS가 울릴 수 있도록 createTriggerNotification으로 스케줄
    Promise.all([
      scheduleFutureAlarm(type, 2, dest, Date.now() + stepMs, journeyId, appointmentId, whichStation, mins(0.75)),
      scheduleFutureAlarm(type, 3, dest, Date.now() + stepMs * 2, journeyId, appointmentId, whichStation, mins(0.5)),
      scheduleFutureAlarm(type, 4, dest, Date.now() + stepMs * 3, journeyId, appointmentId, whichStation, mins(0.25)),
    ]).then((results) => {
      this.stageTriggerIds = results.flat();
    }).catch(() => {});
  }
}

class AlarmManager {
  private runners = new Map<string, AlarmRunner>();

  private key(journeyId?: number, appointmentId?: number): string {
    return journeyId != null ? `j_${journeyId}` : `a_${appointmentId}`;
  }

  async start(target: AlarmTarget): Promise<void> {
    const k = this.key(target.journeyId, target.appointmentId);
    this.runners.get(k)?.stop();
    const runner = new AlarmRunner();
    runner.setOnFinish(() => this.runners.delete(k));
    this.runners.set(k, runner);
    await runner.start(target);
  }

  stop(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    this.runners.get(k)?.stop();
    this.runners.delete(k);
  }

  stopAll(): void {
    this.runners.forEach(r => r.stop());
    this.runners.clear();
  }

  isRunning(journeyId?: number, appointmentId?: number): boolean {
    return this.runners.has(this.key(journeyId, appointmentId));
  }

  cancelRemainingStages(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    this.runners.get(k)?.cancelRemainingStages();
  }
}

function formatEstimatedArrival(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? '오후' : '오전';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${ampm} ${displayH}시` : `${ampm} ${displayH}시 ${m}분`;
}

export const alarmService = new AlarmManager();
