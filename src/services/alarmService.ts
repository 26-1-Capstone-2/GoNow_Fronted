import * as Location from 'expo-location';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJourneysApi, JourneyStatus } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import {
  syncStagedAlarms,
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

  private currentKey(): string | null {
    const journeyId = this.target?.journeyId;
    const appointmentId = this.target?.appointmentId;
    return journeyId != null ? `j_${journeyId}` : appointmentId != null ? `a_${appointmentId}` : null;
  }

  cancelRemainingStages(): void {
    const key = this.currentKey();
    if (key) cancelStagedAlarms(key).catch(() => {});
  }

  // departureAlarmTime/whichStation을 기준으로 단계별 알람을 동기화(변경 없으면 내부에서 스킵).
  // 포그라운드(이 클래스)와 백그라운드(backgroundLocationTask.ts)가 같은 syncStagedAlarms()를
  // 공유해서, 어느 쪽이 먼저 등록했든 서로 중복·경합 없이 최신 데이터로 수렴함.
  async syncStages(preparationTime: number, whichStation: string | null | undefined, departureAlarmTime: string | null | undefined): Promise<void> {
    const key = this.currentKey();
    if (!key || !this.target) return;
    await syncStagedAlarms(key, this.target.alarmType, this.target.destination, this.target.journeyId, this.target.appointmentId, preparationTime, whichStation, departureAlarmTime);
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.poll(), this.intervalSec * 1000);
  }

  private async poll(): Promise<void> {
    if (!this.target) return;
    if (AppState.currentState !== 'active') {
      // 백그라운드에선 backgroundLocationTask.ts가 폴링을 전담(대칭되는 체크가 그쪽엔 이미
      // 있었는데 여기엔 없었음) — 그냥 두면 둘이 동시에 /location을 호출해서
      // syncStagedAlarms()가 경합하며 단계별 알람이 중복 등록될 수 있음(실사용 중 재현됨).
      // 타이머 체인은 유지해서 포그라운드 복귀 시 다음 tick에 자연스럽게 재개되게 함.
      this.scheduleNextPoll();
      return;
    }
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
        this.poll();
      }
      if (departureAlarmTime) {
        this.lastDepartureAlarmTime = departureAlarmTime;
        await this.syncStages(preparationTime, whichStation, departureAlarmTime);
      }
      return;
    }

    if (newStatus === 'SCHEDULED' && this.status !== 'SCHEDULED') {
      console.log(`[alarmService] 서버 응답 SCHEDULED — journeyId:${this.target?.journeyId} 폴링 중단`);
      this.stop();
      return;
    }

    // DEPARTING/NEARDEST 구간에서는 상태 전이 여부와 무관하게 매 폴링마다 최신 데이터로
    // 동기화 — departureAlarmTime/whichStation이 이 구간 안에서 바뀌어도(예: 경로가 뒤늦게
    // 확정) 자동으로 반영됨. syncStagedAlarms()가 내부적으로 변경 없으면 스킵하므로 안전.
    // lastPreparationTime/lastWhichStation도 같이 갱신 — AlarmManager.setActive()가 이 값을
    // 재사용하는데(그룹과 대칭), 여기서 안 채우면 나중에 개인 알람에도 ON/OFF가 생겼을 때
    // preparationTime=0으로 잘못 호출되는 잠재 버그가 있었음.
    if ((newStatus === 'DEPARTING' || newStatus === 'NEARDEST') && departureAlarmTime) {
      this.lastPreparationTime = preparationTime;
      this.lastWhichStation = whichStation;
      this.lastDepartureAlarmTime = departureAlarmTime;
      await this.syncStages(preparationTime, whichStation, departureAlarmTime);
    }

    if (newStatus !== this.status) {
      console.log(`[alarmService] 상태전이 ${this.status} → ${newStatus} — journeyId:${this.target?.journeyId}`);
      this.status = newStatus;

      if (newStatus === 'MOVING') {
        this.cancelRemainingStages();
        console.log(`[alarmService] MOVING — 단계별 알람 취소 journeyId:${this.target?.journeyId}`);
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        // NEARDEST 진입 시 출발 알람 취소 안 함 — 출발 알람 시각 되면 그대로 울려야 함
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
        this.poll();
      }
      if (departureAlarmTime && this.isActive) {
        this.lastDepartureAlarmTime = departureAlarmTime;
        await this.syncStages(preparationTime, whichStation, departureAlarmTime);
      }
      return;
    }

    if (newStatus === 'SCHEDULED' && this.status !== 'SCHEDULED') {
      console.log(`[alarmService] 서버 응답 SCHEDULED — appointmentId:${this.target?.appointmentId} 폴링 중단`);
      this.stop();
      return;
    }

    // DEPARTING/NEARDEST 구간에서는 상태 전이 여부와 무관하게 매 폴링마다 최신 데이터로
    // 동기화 — departureAlarmTime/whichStation이 이 구간 안에서 바뀌어도(예: 경로가 뒤늦게
    // 확정) 자동으로 반영됨. syncStagedAlarms()가 내부적으로 변경 없으면 스킵하므로 안전.
    // lastPreparationTime/lastWhichStation/lastDepartureAlarmTime은 isActive와 무관하게 항상
    // 최신으로 갱신(AlarmManager.setActive()가 OFF→ON 전환 시 이 값으로 재동기화하기 때문).
    if ((newStatus === 'DEPARTING' || newStatus === 'NEARDEST') && departureAlarmTime) {
      this.lastPreparationTime = preparationTime;
      this.lastWhichStation = whichStation;
      this.lastDepartureAlarmTime = departureAlarmTime;
      if (this.isActive) {
        await this.syncStages(preparationTime, whichStation, departureAlarmTime);
      }
    }

    if (newStatus !== this.status) {
      console.log(`[alarmService] 상태전이 ${this.status} → ${newStatus} — appointmentId:${this.target?.appointmentId}`);
      this.status = newStatus;

      if (newStatus === 'MOVING' && !this.movingSent) {
        this.movingSent = true;
        this.cancelRemainingStages();
        if (this.isActive) {
          const arrivalTime = formatEstimatedArrival(estimatedArrival);
          console.log(`[alarmService] MOVING — 단계별 알람 취소 appointmentId:${this.target?.appointmentId} ETA:${arrivalTime}`);
          // sendArrivalAlarm('나', arrivalTime, this.target!.destination); // FCM으로 대체
        }
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        // NEARDEST 진입 시 출발 알람 취소 안 함 — 출발 알람 시각 되면 그대로 울려야 함
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
          console.log(`[alarmService] ARRIVED — 도착완료 appointmentId:${this.target?.appointmentId} time:${arrivalTime}`);
          // sendArrivalConfirmAlarm('나', arrivalTime, this.target!.destination); // FCM으로 대체
        }
        this.stop();
      }
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
    } else if (runner.status === 'DEPARTING' || runner.status === 'NEARDEST') {
      // OFF였던 동안 last* 필드는 계속 최신으로 갱신돼왔으므로(handlePersonalStatus/handleGroupStatus
      // 둘 다 DEPARTING/NEARDEST 진입 시 isActive와 무관하게 갱신함) 그대로 사용 —
      // syncStagedAlarms()가 내부적으로 지문 비교 후 필요한 경우에만 등록함
      runner.syncStages(
        runner.lastPreparationTime,
        runner.lastWhichStation,
        runner.lastDepartureAlarmTime,
      ).catch(() => {});
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
