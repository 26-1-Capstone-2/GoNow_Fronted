import * as Location from 'expo-location';
import { createJourneysApi, JourneyStatus } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import {
  sendAlarm,
  sendArrivalCheckAlarm,
  sendArrivalAlarm,
  sendArrivalConfirmAlarm,
  AlarmType,
} from '@/src/utils/notifications';

const journeysApi = createJourneysApi();
const appointmentsApi = createAppointmentsApi();
const DEFAULT_INTERVAL = 30;

interface AlarmTarget {
  alarmType: AlarmType;
  destination: string;
  journeyId?: number;
  appointmentId?: number;
}

class AlarmService {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stageTimers: ReturnType<typeof setTimeout>[] = [];
  private target: AlarmTarget | null = null;
  private status: JourneyStatus = 'SCHEDULED';
  private intervalSec = DEFAULT_INTERVAL;
  private stagingStarted = false;
  private movingSent = false;
  private arrivedSent = false;
  private nearDestSent = false;
  private stagesCancelled = false;

  async start(target: AlarmTarget): Promise<void> {
    this.stop();
    this.target = target;
    this.status = 'SCHEDULED';
    this.stagingStarted = false;
    this.movingSent = false;
    this.arrivedSent = false;
    this.nearDestSent = false;
    this.stagesCancelled = false;
    this.intervalSec = DEFAULT_INTERVAL;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    await this.poll();
  }

  stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.cancelRemainingStages();
    this.target = null;
  }

  cancelRemainingStages(): void {
    this.stageTimers.forEach(clearTimeout);
    this.stageTimers = [];
    this.stagesCancelled = true;
  }

  get activeJourneyId(): number | null {
    return this.target?.journeyId ?? null;
  }

  get activeAppointmentId(): number | null {
    return this.target?.appointmentId ?? null;
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.poll(), this.intervalSec * 1000);
  }

  private async poll(): Promise<void> {
    if (!this.target) return;
    if (this.status === 'SCHEDULED') return;

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

    const { journey_status, preparation_time, interval } = res.data;
    if (interval !== null) this.intervalSec = interval;
    this.scheduleNextPoll();
    this.handlePersonalStatus(journey_status, preparation_time);
  }

  private async pollGroup(lat: number, lng: number): Promise<void> {
    if (!this.target?.appointmentId) return;

    const res = await appointmentsApi.updateParticipantLocation(this.target.appointmentId, lat, lng);
    if (!res.data) return;

    const { participant_status, appointment_status, estimated_arrival, preparation_time, interval } = res.data;

    // appointment_status → 대시보드 버튼 활성/비활성
    useAppointmentStatusStore.getState().setStatus(this.target.appointmentId, appointment_status);

    if (interval !== null) this.intervalSec = interval;
    this.scheduleNextPoll();
    this.handleGroupStatus(participant_status, preparation_time, estimated_arrival);
  }

  private handlePersonalStatus(newStatus: JourneyStatus, preparationTime: number): void {
    if (newStatus === 'READY' && this.status === 'SCHEDULED') {
      this.status = newStatus;
      this.poll();
      return;
    }

    if (newStatus !== this.status) {
      const prev = this.status;
      this.status = newStatus;

      if (newStatus === 'DEPARTING' && !this.stagingStarted) {
        this.stagingStarted = true;
        this.stagesCancelled = false;
        this.scheduleAlarmStages(preparationTime);
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        sendArrivalCheckAlarm('나', this.target!.destination, this.target?.journeyId);
      }

      if (newStatus === 'ARRIVED') this.stop();
    }
  }

  private handleGroupStatus(newStatus: JourneyStatus, preparationTime: number, estimatedArrival: string): void {
    if (newStatus === 'READY' && this.status === 'SCHEDULED') {
      this.status = newStatus;
      this.poll();
      return;
    }

    if (newStatus !== this.status) {
      this.status = newStatus;

      if (newStatus === 'DEPARTING' && !this.stagingStarted) {
        this.stagingStarted = true;
        this.stagesCancelled = false;
        this.scheduleAlarmStages(preparationTime);
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

  private scheduleAlarmStages(preparationTime: number): void {
    const stepMs = preparationTime * 60 * 1000 * 0.25;
    const type = this.target!.alarmType;
    const dest = this.target!.destination;

    sendAlarm(type, 1, dest);

    for (let i = 1; i <= 3; i++) {
      const stage = (i + 1) as 2 | 3 | 4;
      const timer = setTimeout(() => {
        if (!this.stagesCancelled) sendAlarm(type, stage, dest);
      }, stepMs * i);
      this.stageTimers.push(timer);
    }
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

export const alarmService = new AlarmService();
