import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
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
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from '@/src/tasks/backgroundLocationTask';

async function clearStagingKey(key: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STAGING_DONE_KEY);
    const done: string[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(STAGING_DONE_KEY, JSON.stringify(done.filter(k => k !== key)));
  } catch {}
}

const journeysApi = createJourneysApi();
const appointmentsApi = createAppointmentsApi();
const DEFAULT_INTERVAL = 30;

interface AlarmTarget {
  alarmType: AlarmType;
  destination: string;
  journeyId?: number;
  appointmentId?: number;
  isActive?: boolean; // false면 단계별 출발 알람 억제 (그룹 스위치 OFF)
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
  private isActive = true; // false면 단계별 출발 알람 억제
  private polling = false; // poll() 진행 중 여부 — 중복 poll 방지
  private onFinish?: () => void;

  setOnFinish(cb: () => void): void {
    this.onFinish = cb;
  }

  async start(target: AlarmTarget): Promise<void> {
    const id = target.journeyId ?? `apt${target.appointmentId}`;
    console.log(`[alarmService.start] 시작 — type:${target.alarmType} id:${id} dest:${target.destination}`);
    // this.stop() 제거 — AlarmManager.start()에서 이미 기존 runner를 정리함
    // 여기서 stop()을 호출하면 onFinish → runners.delete(k)가 트리거되어
    // starting 가드가 있어도 중복 진입이 가능해지는 race condition 발생
    this.target = target;
    this.status = 'SCHEDULED';
    this.stagingStarted = false;
    this.movingSent = false;
    this.arrivedSent = false;
    this.nearDestSent = false;
    this.intervalSec = DEFAULT_INTERVAL;
    this.isActive = target.isActive !== false;
    this.polling = false;

    await this.handOffFromBackground();

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.log(`[alarmService.start] GPS 권한 없음 — id:${id} 폴링 시작 불가`);
      return;
    }

    // startBackgroundLocationUpdates는 _layout.tsx AppState active 핸들러에서 일괄 호출
    // 여기서 호출하면 동시 start() 실행 시 race condition으로 중복 완료됨

    // AsyncStorage ID 등록은 백그라운드 진입 시 _layout.tsx background 핸들러에서 처리
    // (포그라운드 폴링 중에는 불필요, 타이밍 문제로 backgroundLocationTask가 ID 없음 오류 방지)
    console.log(`[alarmService.start] 완료 — id:${id} 폴링 시작`);

    await this.poll();
  }

  private async handOffFromBackground(): Promise<void> {
    const { journeyId, appointmentId } = this.target!;
    const key = journeyId != null ? `j_${journeyId}` : `a_${appointmentId}`;
    console.log(`[alarmService.handOff] 백그라운드 인계 — key:${key}`);

    // STAGING_DONE에 key 추가 → 백그라운드 태스크가 이중으로 알람 울리지 않도록
    // ACTIVE_JOURNEYS/APPOINTMENTS ID 조작은 background 핸들러(_layout.tsx)에서 처리
    await AsyncStorage.getItem(STAGING_DONE_KEY).then(async (raw) => {
      const done: string[] = raw ? JSON.parse(raw) : [];
      if (!done.includes(key)) {
        await AsyncStorage.setItem(STAGING_DONE_KEY, JSON.stringify([...done, key]));
      }
    });
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
    this.stageTriggerIds.forEach(id => notifee.cancelTriggerNotification(id).catch(() => {}));
    this.stageTriggerIds = [];
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
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      if (this.target.alarmType === 'group') {
        await this.pollGroup(loc.coords.latitude, loc.coords.longitude);
      } else {
        await this.pollPersonal(loc.coords.latitude, loc.coords.longitude);
      }
    } catch (e) {
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
      if (!res.data) {
        console.log(`[포그라운드] /location 응답 data 없음 — journeyId:${this.target.journeyId}`);
        return;
      }

      const { journey_status, preparation_time, interval, which_station } = res.data;
      console.log(`[포그라운드] /location 응답 — journeyId:${this.target.journeyId} status:${journey_status} interval:${interval}`);

      if (interval !== null) {
        // TODO: 테스트 완료 후 아래 두 줄 원복 (interval 갱신 + AsyncStorage 저장)
        // console.log(`[포그라운드] interval 갱신 — journeyId:${this.target.journeyId} ${this.intervalSec}s → ${interval}s`);
        // this.intervalSec = interval;
        this.intervalSec = 30; // 테스트용 30초 고정
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
    } catch (e) {
      console.log(`[포그라운드] /location 호출 실패 — journeyId:${this.target?.journeyId}`, e);
      this.scheduleNextPoll();
    }
  }

  private async pollGroup(lat: number, lng: number): Promise<void> {
    if (!this.target?.appointmentId) return;

    console.log(`[포그라운드] /location 호출 — appointmentId:${this.target.appointmentId} (${lat.toFixed(5)}, ${lng.toFixed(5)}) interval:${this.intervalSec}s`);
    try {
      const res = await appointmentsApi.updateParticipantLocation(this.target.appointmentId, lat, lng);
      if (!res.data) {
        console.log(`[포그라운드] /location 응답 data 없음 — appointmentId:${this.target.appointmentId}`);
        return;
      }

      const { participant_status, appointment_status, estimated_arrival, preparation_time, interval, which_station } = res.data;
      console.log(`[포그라운드] /location 응답 — appointmentId:${this.target.appointmentId} participantStatus:${participant_status} appointmentStatus:${appointment_status} interval:${interval}`);

      useAppointmentStatusStore.getState().setStatus(this.target.appointmentId, appointment_status);

      if (interval !== null) {
        // TODO: 테스트 완료 후 아래 두 줄 원복
        // console.log(`[포그라운드] interval 갱신 — appointmentId:${this.target.appointmentId} ${this.intervalSec}s → ${interval}s`);
        // this.intervalSec = interval;
        this.intervalSec = 30; // 테스트용 30초 고정
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
    } catch (e) {
      console.log(`[포그라운드] /location 호출 실패 — appointmentId:${this.target?.appointmentId}`, e);
      this.scheduleNextPoll();
    }
  }

  private handlePersonalStatus(newStatus: JourneyStatus, preparationTime: number, whichStation?: string | null): void {
    if (newStatus === 'READY' && this.status === 'SCHEDULED') {
      console.log(`[alarmService] 상태전이 SCHEDULED → READY — journeyId:${this.target?.journeyId}`);
      this.status = newStatus;
      this.poll();
      return;
    }

    // DB가 SCHEDULED로 리셋됐거나 날짜가 미래로 변경된 경우 폴링 중단
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
        console.log(`[alarmService] 단계별 알람 스케줄 시작 — journeyId:${this.target?.journeyId} preparationTime:${preparationTime}분`);
        this.scheduleAlarmStages(preparationTime, whichStation);
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        console.log(`[alarmService] NEARDEST 도착 확인 알람 발송 — journeyId:${this.target?.journeyId}`);
        sendArrivalCheckAlarm('나', this.target!.destination, this.target?.journeyId);
      }

      if (newStatus === 'ARRIVED') {
        const key = `j_${this.target?.journeyId}`;
        console.log(`[alarmService] ARRIVED → 폴링 종료 — journeyId:${this.target?.journeyId}`);
        clearStagingKey(key);
        this.stop();
      }
    }
  }

  private handleGroupStatus(newStatus: JourneyStatus, preparationTime: number, estimatedArrival: string, whichStation?: string | null): void {
    if (newStatus === 'READY' && this.status === 'SCHEDULED') {
      console.log(`[alarmService] 상태전이 SCHEDULED → READY — appointmentId:${this.target?.appointmentId}`);
      this.status = newStatus;
      this.poll();
      return;
    }

    // DB가 SCHEDULED로 리셋됐거나 날짜가 미래로 변경된 경우 폴링 중단
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
        if (this.isActive) {
          console.log(`[alarmService] 단계별 알람 스케줄 시작 — appointmentId:${this.target?.appointmentId} preparationTime:${preparationTime}분`);
          this.scheduleAlarmStages(preparationTime, whichStation);
        } else {
          console.log(`[alarmService] DEPARTING 진입 — appointmentId:${this.target?.appointmentId} 알람 스위치 OFF → 알람 억제`);
        }
      }

      if (newStatus === 'MOVING' && !this.movingSent) {
        this.movingSent = true;
        if (this.isActive) {
          const arrivalTime = formatEstimatedArrival(estimatedArrival);
          console.log(`[alarmService] MOVING — 도착예정 알람 발송 appointmentId:${this.target?.appointmentId} ETA:${arrivalTime}`);
          sendArrivalAlarm('나', arrivalTime, this.target!.destination);
        }
      }

      if (newStatus === 'ARRIVED' && !this.arrivedSent) {
        this.arrivedSent = true;
        const key = `a_${this.target?.appointmentId}`;
        if (this.isActive) {
          const arrivalTime = formatEstimatedArrival(estimatedArrival);
          console.log(`[alarmService] ARRIVED — 도착완료 알람 발송 appointmentId:${this.target?.appointmentId} time:${arrivalTime}`);
          sendArrivalConfirmAlarm('나', arrivalTime, this.target!.destination);
        }
        clearStagingKey(key);
        this.stop();
      }

      if (newStatus === 'NEARDEST' && !this.nearDestSent) {
        this.nearDestSent = true;
        if (this.isActive) {
          console.log(`[alarmService] NEARDEST 도착 확인 알람 발송 — appointmentId:${this.target?.appointmentId}`);
          sendArrivalCheckAlarm('나', this.target!.destination, undefined, this.target?.appointmentId);
        }
      }
    }
  }

  private scheduleAlarmStages(preparationTime: number, whichStation?: string | null): void {
    const stepMs = preparationTime * 60 * 1000 * 0.25;
    const type = this.target!.alarmType;
    const dest = this.target!.destination;
    const journeyId = this.target!.journeyId;
    const appointmentId = this.target!.appointmentId;

    const mins = whichStation
      ? (f: number) => Math.round(preparationTime * f)
      : () => undefined;

    // notifee 네이티브 메모리 충돌 방지 — 순차 실행 (Promise.all 동시 호출 시 SIGABRT 크래시)
    (async () => {
      try {
        await sendAlarm(type, 1, dest, whichStation, mins(1.0));
        const id2 = await scheduleFutureAlarm(type, 2, dest, Date.now() + stepMs, journeyId, appointmentId, whichStation, mins(0.75));
        const id3 = await scheduleFutureAlarm(type, 3, dest, Date.now() + stepMs * 2, journeyId, appointmentId, whichStation, mins(0.5));
        const id4 = await scheduleFutureAlarm(type, 4, dest, Date.now() + stepMs * 3, journeyId, appointmentId, whichStation, mins(0.25));
        this.stageTriggerIds = [...id2, ...id3, ...id4];
        console.log(`[alarmService] 단계별 알람 2~4단계 등록 완료 — ids:${this.stageTriggerIds}`);
      } catch (e) {
        console.log('[alarmService] 단계별 알람 등록 실패', e);
      }
    })();
  }
}

class AlarmManager {
  private runners = new Map<string, AlarmRunner>();
  private starting = new Set<string>(); // start() 진행 중인 key — 중복 진입 방지

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
        // onFinish 제거 후 stop — runners.delete가 트리거되지 않도록
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
