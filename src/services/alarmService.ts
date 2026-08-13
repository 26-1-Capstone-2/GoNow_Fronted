import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { createJourneysApi, JourneyStatus } from '@/src/api/journeys';
import { createAppointmentsApi } from '@/src/api/appointments';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import {
  syncStagedAlarms,
  sendArrivalAlarm,
  sendArrivalConfirmAlarm,
  cancelStagedAlarms,
  AlarmType,
} from '@/src/utils/notifications';
import {
  startAlarmForegroundService,
  stopBackgroundLocationUpdates,
  saveAlarmNavInfo,
  removeAlarmNavInfo,
  addActiveId,
  removeActiveId,
  clearActiveIds,
  maybeSyncGpsPolling,
  setDesiredInterval,
} from '@/src/tasks/backgroundLocationTask';
import { enterNearDestGeofenceMode, exitNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';
import type { KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';

const journeysApi = createJourneysApi();
const appointmentsApi = createAppointmentsApi();
const DEFAULT_INTERVAL = 30;

interface AlarmTarget {
  alarmType: AlarmType;
  destination: string;
  journeyId?: number;
  appointmentId?: number;
  isActive?: boolean;
  destLat?: number;
  destLng?: number;
  // 카카오맵 딥링크 by= 값 — DRIVING/TRANSIT 공통 지원(단일 딥링크 설계,
  // docs/reference/kakao-map-deeplink-spec.md §2.2~2.4 참고)
  transportMode?: KakaoMapTransportMode;
  // home 타입 전용 — 막차 모드 여부(3·4단계 알람 문구 분기용, 버그30)
  isLastMode?: boolean;
}

class AlarmRunner {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private target: AlarmTarget | null = null;
  private intervalSec = DEFAULT_INTERVAL;
  private movingSent = false;
  private arrivedSent = false;
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
    // 헤드리스(백그라운드) 경로는 /location 응답만으론 목적지 좌표를 알 수 없어서(응답에 안 실림),
    // 카카오맵 딥링크 버튼을 계속 붙이려면 여기서 미리 캐싱해둬야 함 (backgroundLocationTask.ts가 읽어감)
    const navKey = this.currentKey();
    if (navKey) {
      // await로 확실히 기록 완료 후 폴링 시작 — 백그라운드 태스크가 이 값을 못 읽는 race 방지
      await saveAlarmNavInfo(navKey, {
        destLat: target.destLat,
        destLng: target.destLng,
        destination: target.destination,
        transportMode: target.transportMode,
        isLastMode: target.isLastMode,
      });
      // 같은 key로 여정이 재시작될 때 이전 세션의 미처리 NEARDEST 지오펜스가 남아있을 수 있어 방어적으로 정리
      await exitNearDestGeofenceMode(navKey).catch(() => {});
    }
    this.status = 'SCHEDULED';
    this.movingSent = false;
    this.arrivedSent = false;
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
    const navKey = this.currentKey();
    if (navKey) {
      removeAlarmNavInfo(navKey).catch(() => {});
      // stop()이 불리는 모든 경로(도착확인 버튼, ARRIVED 감지, FCM auto_arrived 등)에서
      // 공통으로 지오펜스까지 정리 — 호출부마다 따로 기억할 필요 없게 여기로 통합
      exitNearDestGeofenceMode(navKey).catch(() => {});
    }
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
    await syncStagedAlarms(key, this.target.alarmType, this.target.destination, this.target.journeyId, this.target.appointmentId, preparationTime, whichStation, departureAlarmTime, this.target.destLat, this.target.destLng, this.target.transportMode, this.target.isLastMode);
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.poll(), this.intervalSec * 1000);
  }

  // NEARDEST 지오펜스 EXIT 처리 후(READY 복귀) nearDestGeofenceTask.ts가 호출 — 폴링 타이머
  // 체인을 다시 가동한다. 전체 start()를 다시 부르지 않는 이유: movingSent/arrivedSent 등
  // 기존 상태 플래그를 불필요하게 리셋하지 않기 위함.
  resumePolling(): void {
    if (!this.target) return;
    console.log(`[alarmService] 지오펜스로부터 폴링 재개 — status:${this.status}`);
    this.poll();
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
        setDesiredInterval(key, interval).catch(() => {});
      }
      if (!this.target) return;
      if (journey_status === 'NEARDEST') {
        // NEARDEST 진입 — 폴링 타이머를 재예약하지 않고 지오펜스로 감시를 넘긴다(개인/귀가는 isActive 무관하게 항상 알림)
        await enterNearDestGeofenceMode(this.currentKey()!, this.target.destLat, this.target.destLng, this.target.destination);
        // 더 이상 /location 폴링이 필요 없으므로 배경 위치추적 태스크의 추적 목록에서도 제거
        // (안 빼면 나중에 백그라운드 전환 시 이 알람 때문에 불필요한 호출/FGS 지연 종료가 생김)
        // await로 순서 보장 후 maybeSyncGpsPolling() 호출 — 앱이 계속 포그라운드에 머물면
        // 헤드리스 배경 틱이 안 돌아서 GPS 폴링 구독이 안 멈추는 구멍을 여기서 메운다.
        await removeActiveId(this.target.journeyId, undefined);
        await maybeSyncGpsPolling();
      } else {
        this.scheduleNextPoll();
      }
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
        setDesiredInterval(key, interval).catch(() => {});
      }
      if (!this.target) return;
      if (participant_status === 'NEARDEST') {
        // NEARDEST 진입 — 폴링 타이머를 재예약하지 않고 지오펜스로 감시를 넘긴다.
        // 추적 자체는 isActive와 무관하게 계속하되(그룹 전체 상태 계산에 필요), 알림만 isActive를 따름
        await enterNearDestGeofenceMode(this.currentKey()!, this.target.destLat, this.target.destLng, this.target.destination, this.isActive);
        // 더 이상 /location 폴링이 필요 없으므로 배경 위치추적 태스크의 추적 목록에서도 제거
        // await로 순서 보장 후 maybeSyncGpsPolling() 호출 — 앱이 계속 포그라운드에 머물면
        // 헤드리스 배경 틱이 안 돌아서 GPS 폴링 구독이 안 멈추는 구멍을 여기서 메운다.
        await removeActiveId(undefined, this.target.appointmentId);
        await maybeSyncGpsPolling();
      } else {
        this.scheduleNextPoll();
      }
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

      // NEARDEST 도착 확인 알림은 이제 enterNearDestGeofenceMode()(nearDestGeofenceTask.ts)가
      // 발송 — 포그라운드/백그라운드 공통 경로로 통합돼서 여기 별도 처리 불필요

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

      // NEARDEST 도착 확인 알림은 이제 enterNearDestGeofenceMode()(nearDestGeofenceTask.ts)가
      // 발송 — 포그라운드/백그라운드 공통 경로로 통합돼서 여기 별도 처리 불필요

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
      let effectiveTarget = target;
      if (this.runners.has(k)) {
        console.log(`[AlarmManager.start] 기존 runner 교체 — key:${k}`);
        const old = this.runners.get(k)!;
        // isActive를 명시하지 않은 호출(방장 수정 FCM 등)이 이미 돌고 있는 runner를 갈아치울 땐
        // 기존 isActive(참가자 개인 알람 스위치)를 그대로 이어받음 — 안 그러면 꺼둔 알람이 재시작 때마다 강제로 켜짐
        if (target.isActive === undefined) {
          effectiveTarget = { ...target, isActive: old.isActive };
        }
        old.setOnFinish(() => {});
        old.stop();
        this.runners.delete(k);
      }
      const runner = new AlarmRunner();
      runner.setOnFinish(() => {
        this.runners.delete(k);
        console.log(`[AlarmManager] runner 제거 — key:${k} 남은 runners:${this.runners.size}`);
        // removeActiveId()가 AsyncStorage에 반영된 뒤에 폴링 필요 여부를 재판단해야 하므로
        // await로 순서를 보장한다(2026-08-13 발견 — 예전엔 fire-and-forget이라, 남은 runner가
        // 있어도 그게 전부 NEARDEST(지오펜스 감시)뿐이면 GPS 폴링은 필요 없는 경우를 놓쳐서
        // 알람 삭제 후에도 GPS 폴링이 계속 도는 버그가 있었음. 실기기 실측으로 확인됨).
        (async () => {
          await removeActiveId(target.journeyId, target.appointmentId);
          if (!this.hasActivePolling()) {
            // 남은 알람이 하나도 없을 때만 FGS까지 끈다(hasActivePolling()이 지금은
            // runners.size > 0과 동일하지만, 판단 기준을 한 곳에 모아두기 위해 그대로 재사용)
            console.log('[AlarmManager] 남은 알람 없음 → stopBackgroundLocationUpdates');
            await stopBackgroundLocationUpdates();
          } else {
            // 남은 runner가 있어도 전부 NEARDEST뿐이면 GPS 폴링은 이제 필요 없을 수 있음 —
            // ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY 기준으로 다시 확인(FGS는 안 건드림)
            await maybeSyncGpsPolling();
          }
        })().catch(() => {});
      });
      this.runners.set(k, runner);
      // 백그라운드 위치추적 태스크가 "추적할 게 있는지" 판단하는 유일한 근거라, runner를
      // map에 등록하는 이 시점에 바로 같이 기록해둔다 — 백그라운드 전환 시점까지 미루면
      // 그 사이 배경 틱이 먼저 발화해 빈 목록으로 잘못 읽는 경쟁 조건이 있었음.
      addActiveId(effectiveTarget.journeyId, effectiveTarget.appointmentId).catch(() => {});
      console.log(`[AlarmManager.start] runners 등록 — key:${k} 총:${this.runners.size}개`);
      await runner.start(effectiveTarget);
    } finally {
      this.starting.delete(k);
    }
  }

  stop(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    console.log(`[AlarmManager.stop] 요청 — key:${k} 현재runners:${this.runners.size}`);
    // runner.stop()이 내부적으로 onFinish를 호출하고, 거기서 이미 hasActivePolling() 기준으로
    // FGS 필요 여부를 재점검한다 — 여기서 같은 체크를 또 하면 stopBackgroundLocationUpdates가
    // 중복 호출된다(실기기에서 실제로 관측됨). runner가 없는 키면 onFinish 자체가 안 불리니
    // 애초에 재점검할 것도 없다.
    this.runners.get(k)?.stop();
    this.runners.delete(k);
  }

  // NEARDEST 지오펜스 EXIT 처리(nearDestGeofenceTask.ts) 후 READY로 복귀했을 때, 살아있는
  // runner를 찾아 폴링을 재개시킨다. 앱이 포그라운드일 때만 의미 있음(백그라운드/종료 상태면
  // runner 인스턴스 자체가 없거나 무의미 — 호출부가 그 경우 별도로 폴링 목록에 재등록함).
  resumeFromGeofence(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    const runner = this.runners.get(k);
    if (!runner) {
      console.log(`[AlarmManager.resumeFromGeofence] runner 없음 — key:${k}`);
      return;
    }
    runner.resumePolling();
  }

  // 로그아웃 등 "전부 한 번에" 종료하는 지점 전용. runner.stop()을 그냥 forEach로 돌리면 각
  // runner의 onFinish가 개별적으로 hasActivePolling()을 재확인해서 stopBackgroundLocationUpdates가
  // 최대 N번 중복 호출된다(stop() 단건의 comment에 적힌 것과 같은 문제가 N배로 커짐) — 전체
  // 종료 상황에선 "남은 알람이 있는지" 재확인 자체가 무의미하므로, onFinish를 개별적으로 태우지
  // 않고 여기서 한 번만 정리한다.
  async stopAll(): Promise<void> {
    console.log(`[AlarmManager.stopAll] 전체 종료 — runners:${this.runners.size}개`);
    this.runners.forEach((r) => {
      r.setOnFinish(() => {});
      r.stop();
    });
    this.runners.clear();
    await clearActiveIds();
    await stopBackgroundLocationUpdates();
  }

  isRunning(journeyId?: number, appointmentId?: number): boolean {
    return this.runners.has(this.key(journeyId, appointmentId));
  }

  // 2026-08-12 정책 변경: FGS는 "알람이 하나라도 있으면 상시 유지"로 단순화함(NEARDEST라고
  // 꺼지지 않음) — 백그라운드에서 FGS를 새로 켜는 게 안드로이드 정책상 원천 불가능하다는 게
  // 실기기로 확정됐기 때문에(docs/planning/geofencing-migration-plan.md "FGS 생명주기 정책"
  // 참고), NEARDEST 진입 시 잠깐 끄는 배터리 이득보다 "다음 상태 전환 때 다시 못 켤 위험"이
  // 훨씬 크다고 판단. 그래서 runner 상태와 무관하게 하나라도 있으면 true.
  hasActivePolling(): boolean {
    return this.runners.size > 0;
  }

  // FGS 필요 여부가 바뀔 수 있는 모든 지점(포그라운드 재진입, 알람 복원 완료, NEARDEST 진입,
  // 지오펜스 EXIT로 READY 복귀)에서 공통으로 호출 — start/stopAlarmForegroundService 둘 다
  // 내부적으로 "이미 그 상태면 skip"하므로, 실제로 상태가 바뀔 때만 FGS가 토글된다.
  // GPS 폴링은 FGS와 별개로 maybeSyncGpsPolling()이 ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY
  // 기준으로 판단한다 — 예전엔 여기서 무조건 startBackgroundLocationUpdates()(FGS+GPS 묶음)를
  // 불러서, 추적 중인 알람이 전부 NEARDEST(지오펜스 전용)뿐이어도 포그라운드 복귀할 때마다
  // GPS 폴링이 불필요하게 다시 켜지는 버그가 있었음(2026-08-13 실기기 실측으로 발견).
  async syncForegroundService(): Promise<void> {
    if (this.hasActivePolling()) {
      await startAlarmForegroundService().catch(() => {});
      await maybeSyncGpsPolling().catch(() => {});
    } else {
      await stopBackgroundLocationUpdates().catch(() => {});
    }
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
