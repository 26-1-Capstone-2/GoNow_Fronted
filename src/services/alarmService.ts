import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJourneysApi, JourneyStatus } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import {
  scheduleFutureAlarm,
  sendArrivalCheckAlarm,
  sendArrivalAlarm,
  sendArrivalConfirmAlarm,
  cancelStagedAlarms,
  AlarmType,
} from '@/src/utils/notifications';
import {
  DESIRED_INTERVALS_KEY,
  stopBackgroundLocationUpdates,
} from '@/src/tasks/backgroundLocationTask';
import { getNickname } from '@/src/store/authStore';

const journeysApi = createJourneysApi();
const appointmentsApi = createAppointmentsApi();
const DEFAULT_INTERVAL = 30;

interface AlarmTarget {
  alarmType: AlarmType;
  destination: string;
  journeyId?: number;
  appointmentId?: number;
  isActive?: boolean;
}

class AlarmRunner {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private target: AlarmTarget | null = null;
  private intervalSec = DEFAULT_INTERVAL;
  stagingStarted = false;
  private movingSent = false;
  private arrivedSent = false;
  private nearDestSent = false;
  isActive = true;
  lastPreparationTime = 0;
  lastWhichStation: string | null | undefined = undefined;
  lastDepartureAlarmTime: string | null | undefined = undefined;
  status: JourneyStatus = 'SCHEDULED';
  private polling = false;
  private onFinish?: () => void;

  setOnFinish(cb: () => void): void {
    this.onFinish = cb;
  }

  async start(target: AlarmTarget): Promise<void> {
    const id = target.journeyId ?? `apt${target.appointmentId}`;
    console.log(`[alarmService.start] 시작 — type:${target.alarmType} id:${id} dest:${target.destination}`);
    this.target = target;
    this.status = 'SCHEDULED';
    this.stagingStarted = false;
    this.movingSent = false;
    this.arrivedSent = false;
    this.nearDestSent = false;
    this.intervalSec = DEFAULT_INTERVAL;
    this.isActive = target.isActive !== false;
    this.polling = false;
    this.lastPreparationTime = 0;
    this.lastWhichStation = undefined;
    this.lastDepartureAlarmTime = undefined;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.log(`[alarmService.start] GPS 권한 없음 — id:${id} 폴링 시작 불가`);
      return;
    }
    console.log(`[alarmService.start] 완료 — id:${id} 폴링 시작`);
    await this.poll();
  }

  stop(): void {
    if (this.target) {
      const id = this.target.journeyId ?? `apt${this.target.appointmentId}`;
      console.log(`[alarmService.stop] 종료 — type:${this.target.alarmType} id:${id} 마지막상태:${this.status}`);
    }
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
    const journeyId = this.target?.journeyId;
    const appointmentId = this.target?.appointmentId;
    const key = journeyId != null ? `j_${journeyId}` : appointmentId != null ? `a_${appointmentId}` : null;
    if (key) cancelStagedAlarms(key).catch(() => {});
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.poll(), this.intervalSec * 1000);
  }

  private async poll(): Promise<void> {
    if (!this.target) return;
    if (this.polling) {
      console.log(`[포그라운드] poll 이미 진행 중 — skip`);
      return;
    }
    this.polling = true;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (this.target.alarmType === 'group') {
        await this.pollGroup(loc.coords.latitude, loc.coords.longitude);
      } else {
        await this.pollPersonal(loc.coords.latitude, loc.coords.longitude);
      }
    } catch (e: any) {
      const id = this.target?.journeyId ?? `apt${this.target?.appointmentId}`;
      console.log(`[포그라운드] GPS 위치 획득 실패 — id:${id}`, e);
      this.scheduleNextPoll();
    } finally {
      this.polling = false;
    }
  }

  private async pollPersonal(lat: number, lng: number): Promise<void> {
    if (!this.target?.journeyId) return;
    console.log(`[포그라운드] /location 호출 — journeyId:${this.target.journeyId} (${lat.toFixed(5)}, ${lng.toFixed(5)}) interval:${this.intervalSec}s`);
    try {
      const res = await journeysApi.updateLocation(this.target.journeyId, lat, lng);
      if (!res.data) { console.log(`[포그라운드] /location 응답 data 없음 — journeyId:${this.target.journeyId}`); return; }
      const { journey_status, preparation_time, interval, which_station, departure_alarm_time } = res.data;
      console.log(`[포그라운드] /location 응답 — journeyId:${this.target.journeyId} status:${journey_status} interval:${interval} which_station:${which_station} departure_alarm_time:${departure_alarm_time}`);
      if (interval !== null) {
        console.log(`[포그라운드] interval 갱신 — journeyId:${this.target!.journeyId} ${this.intervalSec}s → ${interval}s`);
        this.intervalSec = interval;
        const key = `j_${this.target!.journeyId}`;
        AsyncStorage.getItem(DESIRED_INTERVALS_KEY).then(raw => {
          const intervals = raw ? JSON.parse(raw) : {};
          intervals[key] = interval;
          AsyncStorage.setItem(DESIRED_INTERVALS_KEY, JSON.stringify(intervals));
        }).catch(() => {});
      }
      if (!this.target) return;
      this.scheduleNextPoll();
      await this.handlePersonalStatus(journey_status, preparation_time, interval, which_station, departure_alarm_time);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('"success":false') || msg.startsWith('HTTP 4')) {
        console.log(`[포그라운드] /location 서버 오류 — journeyId:${this.target?.journeyId} 폴링 중단`);
        this.stop();
      } else {
        console.log(`[포그라운드] /location 호출 실패 — journeyId:${this.target?.journeyId}`, e);
        this.scheduleNextPoll();
      }
    }
  }

  private async pollGroup(lat: number, lng: number): Promise<void> {
    if (!this.target?.appointmentId) return;
    console.log(`[포그라운드] /location 호출 — appointmentId:${this.target.appointmentId} (${lat.toFixed(5)}, ${lng.toFixed(5)}) interval:${this.intervalSec}s`);
    try {
      const res = await appointmentsApi.updateParticipantLocation(this.target.appointmentId, lat, lng);
      if (!res.data) { console.log(`[포그라운드] /location 응답 data 없음 — appointmentId:${this.target.appointmentId}`); return; }
      const { participant_status, appointment_status, estimated_arrival, preparation_time, interval, which_station, departure_alarm_time } = res.data;
      console.log(`[포그라운드] /location 응답 — appointmentId:${this.target.appointmentId} participantStatus:${participant_status} appointmentStatus:${appointment_status} interval:${interval} which_station:${which_station} departure_alarm_time:${departure_alarm_time}`);
      useAppointmentStatusStore.getState().setStatus(this.target.appointmentId, appointment_status);
      if (interval !== null) {
        console.log(`[포그라운드] interval 갱신 — appointmentId:${this.target!.appointmentId} ${this.intervalSec}s → ${interval}s`);
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
      await this.handleGroupStatus(participant_status, preparation_time, estimated_arrival, interval, which_station, departure_alarm_time);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('"success":false') || msg.startsWith('HTTP 4')) {
        console.log(`[포그라운드] /location 서버 오류 — appointmentId:${this.target?.appointmentId} 폴링 중단`);
        this.stop();
      } else {
        console.log(`[포그라운드] /location 호출 실패 — appointmentId:${this.target?.appointmentId}`, e);
        this.scheduleNextPoll();
      }
    }
  }

  private async handlePersonalStatus(newStatus: JourneyStatus, preparationTime: number, interval: number | null, whichStation?: string | null, departureAlarmTime?: string | null): Promise<void> {
    if (newStatus === 'READY') {
      if (this.status !== 'READY') {
        console.log(`[alarmService] 상태전이 ${this.status} → READY — journeyId:${this.target?.journeyId}`);
        this.status = newStatus;
        if (this.stagingStarted) {
          this.stagingStarted = false;
          console.log(`[alarmService] READY 복귀 — stagingStarted 리셋 journeyId:${this.target?.journeyId}`);
        }
        this.poll();
      }
      // departure_alarm_time 변경 시 알람 재등록
      if (departureAlarmTime && departureAlarmTime !== this.lastDepartureAlarmTime) {
        this.lastDepartureAlarmTime = departureAlarmTime;
        this.cancelRemainingStages();
        await this.scheduleAlarmStages(preparationTime, whichStation, departureAlarmTime);
      }
      return;
    }

    if (newStatus === 'SCHEDULED' && this.status !== 'SCHEDULED') {
      console.log(`[alarmService] 서버 응답 SCHEDULED — journeyId:${this.target?.journeyId} 폴링 중단`);
      this.stop();
      return;
    }

    if (newStatus !== this.status) {
      console.log(`[alarmService] 상태전이 ${this.status} → ${newStatus} — journeyId:${this.target?.journeyId}`);
      this.status = newStatus;

      if (newStatus === 'DEPARTING' && !this.stagingStarted) {
        this.stagingStarted = true;
        if (departureAlarmTime) {
          this.cancelRemainingStages(); // 기존 알람 취소 후 재등록 (READY 등록분 포함)
          console.log(`[alarmService] DEPARTING 진입 — journeyId:${this.target?.journeyId} scheduleAlarmStages 호출`);
          await this.scheduleAlarmStages(preparationTime, whichStation, departureAlarmTime);
        }
      }

      if (newStatus === 'MOVING') {
        this.cancelRemainingStages();
        console.log(`[alarmService] MOVING — 단계별 알람 취소 journeyId:${this.target?.journeyId}`);
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        // NEARDEST 진입 시 출발 알람 취소 안 함 — 출발 알람 시각 되면 그대로 울려야 함
        if (!this.stagingStarted && departureAlarmTime && new Date() >= new Date(departureAlarmTime)) {
          this.stagingStarted = true;
          console.log(`[alarmService] NEARDEST P>=Q — 단계별 알람 발송 journeyId:${this.target?.journeyId}`);
          await this.scheduleAlarmStages(preparationTime, whichStation, departureAlarmTime);
        }
        console.log(`[alarmService] NEARDEST 도착 확인 알람 발송 — journeyId:${this.target?.journeyId}`);
        sendArrivalCheckAlarm(getNickname()!, this.target!.destination, this.target?.journeyId);
      }

      if (newStatus === 'ARRIVED') {
        this.cancelRemainingStages();
        console.log(`[alarmService] ARRIVED → 폴링 종료 — journeyId:${this.target?.journeyId}`);
        this.stop();
      }
    }
  }

  private async handleGroupStatus(newStatus: JourneyStatus, preparationTime: number, estimatedArrival: string, interval: number | null, whichStation?: string | null, departureAlarmTime?: string | null): Promise<void> {
    if (newStatus === 'READY') {
      if (this.status !== 'READY') {
        console.log(`[alarmService] 상태전이 ${this.status} → READY — appointmentId:${this.target?.appointmentId}`);
        this.status = newStatus;
        if (this.stagingStarted) {
          this.stagingStarted = false;
          console.log(`[alarmService] READY 복귀 — stagingStarted 리셋 appointmentId:${this.target?.appointmentId}`);
        }
        this.poll();
      }
      // departure_alarm_time 변경 시 알람 재등록
      if (departureAlarmTime && departureAlarmTime !== this.lastDepartureAlarmTime && this.isActive) {
        this.lastDepartureAlarmTime = departureAlarmTime;
        this.cancelRemainingStages();
        await this.scheduleAlarmStages(preparationTime, whichStation, departureAlarmTime);
      }
      return;
    }

    if (newStatus === 'SCHEDULED' && this.status !== 'SCHEDULED') {
      console.log(`[alarmService] 서버 응답 SCHEDULED — appointmentId:${this.target?.appointmentId} 폴링 중단`);
      this.stop();
      return;
    }

    if (newStatus !== this.status) {
      console.log(`[alarmService] 상태전이 ${this.status} → ${newStatus} — appointmentId:${this.target?.appointmentId}`);
      this.status = newStatus;

      if (newStatus === 'DEPARTING' && !this.stagingStarted) {
        this.stagingStarted = true;
        this.lastPreparationTime = preparationTime;
        this.lastWhichStation = whichStation;
        this.lastDepartureAlarmTime = departureAlarmTime;
        if (departureAlarmTime && this.isActive) {
          this.cancelRemainingStages(); // 기존 알람 취소 후 재등록 (READY 등록분 포함)
          console.log(`[alarmService] DEPARTING 진입 — appointmentId:${this.target?.appointmentId} scheduleAlarmStages 호출`);
          await this.scheduleAlarmStages(preparationTime, whichStation, departureAlarmTime);
        }
      }

      if (newStatus === 'MOVING' && !this.movingSent) {
        this.movingSent = true;
        this.cancelRemainingStages();
        if (this.isActive) {
          const arrivalTime = formatEstimatedArrival(estimatedArrival);
          console.log(`[alarmService] MOVING — 단계별 알람 취소 + 도착예정 알람 발송 appointmentId:${this.target?.appointmentId} ETA:${arrivalTime}`);
          sendArrivalAlarm('나', arrivalTime, this.target!.destination);
        }
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        // NEARDEST 진입 시 출발 알람 취소 안 함 — 출발 알람 시각 되면 그대로 울려야 함
        if (!this.stagingStarted && this.isActive && departureAlarmTime && new Date() >= new Date(departureAlarmTime)) {
          this.stagingStarted = true;
          console.log(`[alarmService] NEARDEST P>=Q — 단계별 알람 발송 appointmentId:${this.target?.appointmentId}`);
          await this.scheduleAlarmStages(preparationTime, whichStation, departureAlarmTime);
        }
        if (this.isActive) {
          console.log(`[alarmService] NEARDEST 도착 확인 알람 발송 — appointmentId:${this.target?.appointmentId}`);
          sendArrivalCheckAlarm(getNickname()!, this.target!.destination, undefined, this.target?.appointmentId);
        }
      }

      if (newStatus === 'ARRIVED' && !this.arrivedSent) {
        this.arrivedSent = true;
        this.cancelRemainingStages();
        if (this.isActive) {
          const arrivalTime = formatEstimatedArrival(estimatedArrival);
          console.log(`[alarmService] ARRIVED — 도착완료 알람 발송 appointmentId:${this.target?.appointmentId} time:${arrivalTime}`);
          sendArrivalConfirmAlarm('나', arrivalTime, this.target!.destination);
        }
        this.stop();
      }
    }
  }

  async scheduleAlarmStages(preparationTime: number, whichStation?: string | null, departureAlarmTime?: string | null): Promise<void> {
    const stepMs = preparationTime * 60 * 1000 * 0.25;
    const type = this.target!.alarmType;
    const dest = this.target!.destination;
    const journeyId = this.target!.journeyId;
    const appointmentId = this.target!.appointmentId;

    const alarmBase = new Date(departureAlarmTime!).getTime();
    const stepTimes = [
      alarmBase,
      alarmBase + stepMs,
      alarmBase + stepMs * 2,
      alarmBase + stepMs * 3,
    ];
    const now = Date.now();

    // 각 단계에서 표시할 분: 1단계=100%, 2단계=75%, 3단계=50%, 4단계=25%
    const ratios = [1.0, 0.75, 0.5, 0.25];
    const mins = (idx: number) =>
      whichStation ? Math.max(0, Math.round(preparationTime * ratios[idx])) : undefined;

    // 현재 시각 기준으로 시작 단계 결정 — 아직 안 지난 첫 번째 단계부터 시작
    // 모든 단계가 지났으면 4단계(idx=3) 즉시 발송
    const foundIdx = stepTimes.findIndex((t) => now < t);
    const startIdx = foundIdx === -1 ? 3 : foundIdx;

    console.log(`[알람] ${startIdx + 1}단계부터 예약 — 1단계:${new Date(stepTimes[0]).toLocaleTimeString('ko-KR', { hour12: false })} 2단계:${new Date(stepTimes[1]).toLocaleTimeString('ko-KR', { hour12: false })} 3단계:${new Date(stepTimes[2]).toLocaleTimeString('ko-KR', { hour12: false })} 4단계:${new Date(stepTimes[3]).toLocaleTimeString('ko-KR', { hour12: false })}`);

    try {
      const allIds: string[] = [];
      for (let i = startIdx; i < 4; i++) {
        const stage = (i + 1) as 1 | 2 | 3 | 4;
        // 4단계(i=3)이고 시각이 이미 지났으면 minutesRemaining=0 → 긴급 문구 표시
        const minutesRemaining = (i === 3 && now >= stepTimes[3]) ? 0 : mins(i);
        const ids = await scheduleFutureAlarm(type, stage, dest, stepTimes[i], journeyId, appointmentId, whichStation, minutesRemaining);
        allIds.push(...ids);
      }
      console.log(`[알람] 단계별 알람 등록 완료 — ids:${allIds}`);
    } catch (e) {
      console.log('[알람] 단계별 알람 등록 실패', e);
    }
  }
}

class AlarmManager {
  private runners = new Map<string, AlarmRunner>();
  private starting = new Set<string>();

  private key(journeyId?: number, appointmentId?: number): string {
    return journeyId != null ? `j_${journeyId}` : `a_${appointmentId}`;
  }

  async start(target: AlarmTarget): Promise<void> {
    const k = this.key(target.journeyId, target.appointmentId);
    if (this.starting.has(k)) {
      console.log(`[AlarmManager.start] 이미 시작 중 — key:${k} skip`);
      return;
    }
    this.starting.add(k);
    try {
      if (this.runners.has(k)) {
        console.log(`[AlarmManager.start] 기존 runner 교체 — key:${k}`);
        const old = this.runners.get(k)!;
        old.setOnFinish(() => {});
        old.stop();
        this.runners.delete(k);
      }
      const runner = new AlarmRunner();
      runner.setOnFinish(() => {
        this.runners.delete(k);
        console.log(`[AlarmManager] runner 제거 — key:${k} 남은 runners:${this.runners.size}`);
        if (this.runners.size === 0) {
          console.log('[AlarmManager] 모든 알람 종료 → stopBackgroundLocationUpdates');
          stopBackgroundLocationUpdates().catch(() => {});
        }
      });
      this.runners.set(k, runner);
      console.log(`[AlarmManager.start] runners 등록 — key:${k} 총:${this.runners.size}개`);
      await runner.start(target);
    } finally {
      this.starting.delete(k);
    }
  }

  stop(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    console.log(`[AlarmManager.stop] 요청 — key:${k} 현재runners:${this.runners.size}`);
    this.runners.get(k)?.stop();
    this.runners.delete(k);
    if (this.runners.size === 0) {
      console.log('[AlarmManager.stop] 모든 알람 종료 → stopBackgroundLocationUpdates');
      stopBackgroundLocationUpdates().catch(() => {});
    }
  }

  stopAll(): void {
    console.log(`[AlarmManager.stopAll] 전체 종료 — runners:${this.runners.size}개`);
    this.runners.forEach(r => r.stop());
    this.runners.clear();
    stopBackgroundLocationUpdates().catch(() => {});
  }

  isRunning(journeyId?: number, appointmentId?: number): boolean {
    return this.runners.has(this.key(journeyId, appointmentId));
  }

  hasRunning(): boolean {
    return this.runners.size > 0;
  }

  getRunningIds(): { journeyIds: number[], appointmentIds: number[] } {
    const journeyIds: number[] = [];
    const appointmentIds: number[] = [];
    this.runners.forEach((_, key) => {
      if (key.startsWith('j_')) journeyIds.push(Number(key.slice(2)));
      else if (key.startsWith('a_')) appointmentIds.push(Number(key.slice(2)));
    });
    return { journeyIds, appointmentIds };
  }

  cancelRemainingStages(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    this.runners.get(k)?.cancelRemainingStages();
  }

  setActive(isActive: boolean, journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    const runner = this.runners.get(k);
    if (!runner) return;
    runner.isActive = isActive;
    if (!isActive) {
      runner.cancelRemainingStages();
    } else if (runner.status === 'DEPARTING') {
      runner.cancelRemainingStages();
      runner.stagingStarted = false;
      runner.scheduleAlarmStages(
        runner.lastPreparationTime,
        runner.lastWhichStation,
        runner.lastDepartureAlarmTime,
      ).then(() => { runner.stagingStarted = true; }).catch(() => {});
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

export const alarmService = new AlarmManager();
