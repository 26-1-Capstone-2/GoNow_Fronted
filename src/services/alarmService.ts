import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import type { JourneyStatus } from '@/src/api/journeys';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
import { useCalendarStore } from '@/src/store/calendarStore';
import { getToken } from '@/src/store/authStore';
import {
  syncStagedAlarms,
  sendArrivalAlarm,
  sendArrivalConfirmAlarm,
  cancelStagedAlarms,
  AlarmType,
  sendDebugNotification,
} from '@/src/utils/notifications';
import {
  startAlarmForegroundService,
  stopBackgroundLocationUpdates,
  stopGpsPolling,
  saveAlarmNavInfo,
  removeAlarmNavInfo,
  clearAlarmNavInfo,
  hasAnyTrackedAlarm,
  hasAlarmNavInfo,
  isRepeatingJourney,
  addActiveId,
  removeActiveId,
  clearActiveIds,
  maybeSyncGpsPolling,
  setDesiredInterval,
  getDesiredInterval,
  getLastCallTime,
  setLastCallTime,
  patchLocation,
  isKeyActivelyTracked,
} from '@/src/tasks/backgroundLocationTask';
import { enterNearDestGeofenceMode, exitNearDestGeofenceMode } from '@/src/tasks/nearDestGeofenceTask';
import { enterDepartingGeofenceMode, exitDepartingGeofenceMode } from '@/src/tasks/departingGeofenceTask';
import { enterMovingGeofenceMode, exitMovingGeofenceMode } from '@/src/tasks/movingGeofenceTask';
import { enterReadyGeofenceMode, exitReadyGeofenceMode } from '@/src/tasks/readyGeofenceTask';
import { dlog } from '@/src/utils/deviceLogger';
import { emitAlarmLocationUpdate } from '@/src/services/alarmEvents';
import type { KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';

const DEFAULT_INTERVAL = 30;
// ⚠️ 2026-08-14 임시 테스트 코드 — 검증 끝나면 반드시 제거할 것. 플라스크가 주는 interval(최대
// 300초)을 기다리면 테스트 한 사이클에 5분씩 걸려서, 서버 값을 무시하고 이 값으로 강제 고정한다.
// null로 두면 원래대로(서버 값 사용) 동작 — 원복 시 이 줄과 아래 사용처의 `?? interval`을
// `interval` 하나로 되돌리면 된다.
const DEBUG_FORCE_INTERVAL_SEC: number | null = 15;
// 알람 생성 직후 짧은 AppState 블립 동안 포그라운드/백그라운드 두 드라이버가 동시에 첫 호출을
// 시도할 수 있다 — 한쪽이 방금(이 시간 내에) 이미 호출했으면 다른 쪽은 중복으로 보고 스킵한다.
// 정상적인 주기적 폴링 간격(최소 30초)보다 훨씬 짧게 잡아서 정상 동작과는 절대 안 겹치게 한다.
const DUPLICATE_CALL_GUARD_MS = 5000;

// stop() 직후 이 시간 안에는 startReadyAlarms()의 재조정 로직이 재시작을 시도해도 건너뛴다 —
// 서버가 /arrive 등을 반영하는 데 걸리는 시간보다 넉넉하게 잡음(AlarmManager.wasRecentlyStopped() 참고).
const RECENTLY_STOPPED_WINDOW_MS = 15000;

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
  // 개인/귀가(Journey) 전용 — 반복 요일 비트마스크(0/undefined면 반복 없음). 그룹은 항상
  // undefined. ARRIVED 도달 시 nav info를 파킹할지 판단하는 근거(버그45).
  repeatDays?: number;
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
    dlog('FOREGROUND', `[alarmService.start] 시작 — type:${target.alarmType} id:${id} dest:${target.destination} repeatDays:${target.repeatDays ?? 0}`);
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
        repeatDays: target.repeatDays,
      });
      // 같은 key로 여정이 재시작될 때 이전 세션의 미처리 NEARDEST/DEPARTING 지오펜스가 남아있을 수 있어 방어적으로 정리
      await exitNearDestGeofenceMode(navKey).catch(() => {});
      await exitDepartingGeofenceMode(navKey).catch(() => {});
      await exitMovingGeofenceMode(navKey).catch(() => {});
      await exitReadyGeofenceMode(navKey).catch(() => {});
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
      dlog('FOREGROUND', `[alarmService.start] GPS 권한 없음 — id:${id} 폴링 시작 불가`);
      return;
    }
    dlog('FOREGROUND', `[alarmService.start] 완료 — id:${id} 폴링 시작`);
    // 2026-08-14: 이 최초 호출은 스테일 타이머가 만들어낼 수 없다(막 생성된 러너라 애초에
    // pollTimer 자체가 없음) — 아래 poll()의 isKeyActivelyTracked() 방어 체크는 오히려
    // addActiveId()가 아직 저장을 못 끝냈을 때 이 최초 poll을 막아버리는 부작용만 있으므로
    // 이 호출에서만 건너뛴다(skipActiveCheck=true).
    await this.poll(true);
  }

  // preserveNavInfo=true면 ALARM_NAV_INFO_KEY 엔트리를 지우지 않는다 — 반복 여정이 ARRIVED에
  // 도달했을 때 "이번 회차 정리"는 그대로 하되 "존재 자체"의 흔적만 다음 회차까지 남겨서
  // FGS가 계속 켜져 있게 하는 용도(파킹, 버그45). 나머지 정리(타이머/단계별 알람/지오펜스)는
  // 파킹 여부와 무관하게 항상 수행한다.
  stop(preserveNavInfo = false): void {
    if (this.target) {
      const id = this.target.journeyId ?? `apt${this.target.appointmentId}`;
      dlog('FOREGROUND', `[alarmService.stop] 종료 — type:${this.target.alarmType} id:${id} 마지막상태:${this.status} preserveNavInfo:${preserveNavInfo}`);
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.cancelRemainingStages();
    const navKey = this.currentKey();
    if (navKey) {
      if (preserveNavInfo) {
        // preserveNavInfo=true는 "실제로 반복 여정이라 파킹함"(AlarmManager.stop()의 계산 결과)과
        // "forgetIfExists()가 무조건 안 건드림"(호출부가 별도로 판단) 두 경우 모두에서 온다 —
        // 이 지점만 봐서는 어느 쪽인지 단정할 수 없으므로 "반복 여정" 대신 중립적으로 표현한다
        // (실기기 테스트 중 이 로그가 비반복 알람에도 찍혀서 혼란을 준 적이 있음, 2026-08-18).
        dlog('FOREGROUND', `[alarmService.stop] nav info 유지(preserveNavInfo=true) key:${navKey}`);
      } else {
        removeAlarmNavInfo(navKey).catch(() => {});
      }
      // stop()이 불리는 모든 경로(도착확인 버튼, ARRIVED 감지, FCM auto_arrived 등)에서
      // 공통으로 지오펜스까지 정리 — 호출부마다 따로 기억할 필요 없게 여기로 통합. 파킹
      // 여부와 무관하게 "이번 회차" 지오펜스는 항상 해제한다.
      exitNearDestGeofenceMode(navKey).catch(() => {});
      exitDepartingGeofenceMode(navKey).catch(() => {});
      exitMovingGeofenceMode(navKey).catch(() => {});
      exitReadyGeofenceMode(navKey).catch(() => {});
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

  // AlarmManager.stop()이 "도착확인/자동 ARRIVED" 의도로 불렸을 때 이 runner가 반복 여정인지
  // 판단하기 위한 조회용(버그45) — target이 private이라 외부에서 직접 못 읽는다.
  getRepeatDays(): number | undefined {
    return this.target?.repeatDays;
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
    // 2026-08-14(버그3/8, 재발 수정): pollPersonal/pollGroup의 성공 콜백은 poll()의 AppState
    // 체크를 거치지 않고 바로 이 함수를 부른다 — 포그라운드에서 시작한 호출의 응답이 그 사이
    // 백그라운드 전환된 뒤에 도착하면, 여기서 무조건 새 타이머를 걸었었다. 그 타이머가 다음
    // 포그라운드 복귀 시점과 겹치면 pauseAll()이 미처 못 잡은 채로 낡은 페이스 그대로 실제
    // 호출을 만드는 동일 계열 버그가 실기기로 재현됨 — 애초에 배경 상태면 타이머를 안 만든다.
    if (AppState.currentState !== 'active') {
      this.pollTimer = null;
      return;
    }
    this.pollTimer = setTimeout(() => this.poll(), this.intervalSec * 1000);
  }

  // NEARDEST 지오펜스 EXIT 처리 후(READY 복귀) nearDestGeofenceTask.ts가 호출 — 폴링 타이머
  // 체인을 다시 가동한다. 전체 start()를 다시 부르지 않는 이유: movingSent/arrivedSent 등
  // 기존 상태 플래그를 불필요하게 리셋하지 않기 위함. 지오펜스 EXIT 자체가 실제 경계 이동
  // 이벤트라 경과 시간과 무관하게 항상 즉시 재확인해야 한다 — 아래 resumeIfDue()와 이 점이
  // 다르다(단순 포그라운드 복귀는 실제 상태 변화의 증거가 아니므로 경과 시간을 따짐).
  resumePolling(): void {
    if (!this.target) return;
    dlog('FOREGROUND', `[alarmService] 지오펜스로부터 폴링 재개 — status:${this.status}`);
    dlog('FOREGROUND', `resumePolling — key:${this.currentKey()} status:${this.status} → poll() 즉시 실행`);
    // skipActiveCheck=true 필수 — 이 key는 지오펜스로 넘어갈 때 이미 활성 추적 목록에서
    // 빠져있는 상태라(removeActiveId), 기본값(false)이면 poll() 내부의 "활성 추적 대상
    // 아님 — 낡은 타이머로 인한 호출 차단" 가드에 걸려 실제 호출이 안 나간다. start()의
    // 최초 호출과 동일한 이유로 이 체크를 건너뛰어야 함.
    this.poll(true);
  }

  // 2026-08-14(버그3/8, 재발 수정): 백그라운드 전환 시점에 AlarmManager.pauseAll()이 호출한다 —
  // 포그라운드에서 마지막으로 걸어둔 pollTimer(scheduleNextPoll())를 그대로 두면, 백그라운드 중
  // 안드로이드가 이 JS 타이머 발동을 지연시켰다가 다음 포그라운드 복귀와 거의 동시에 몰아서
  // 발동시킬 수 있다 — 그 순간엔 poll()의 AppState 체크가 이미 'active'를 보고 통과해버려서,
  // resumeIfDue()가 방금 정확히 예약한 타이머를 무시하고 낡은 페이스로 실제 호출을 만드는 버그가
  // 실기기로 재현됐다(반응적 방어인 poll() 내부 체크만으론 못 막는 타이밍). 배경 전환 시점에
  // 능동적으로 미리 지워서 애초에 이 경쟁 자체가 생기지 않게 한다.
  pauseTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // 2026-08-14(버그3/8): 단순 포그라운드 복귀(AlarmManager.resumeAll())에서만 쓴다. 예전엔
  // resumePolling()을 그대로 재사용해서 경과 시간과 무관하게 항상 즉시 poll했는데, 포그라운드/
  // 백그라운드를 빠르게 반복하면 매번 실제로 서버를 호출하게 되어 서버가 지시한 interval보다
  // 오히려 더 자주 호출하는 방향으로 새는 문제가 있었다(사용자 지적으로 발견). 마지막 실제
  // 호출(포그라운드/백그라운드 공통 — getLastCallTime()) 이후 interval만큼 지났을 때만 즉시
  // poll하고, 안 지났으면 남은 시간만큼만 다시 예약한다.
  async resumeIfDue(): Promise<void> {
    if (!this.target) return;
    // NEARDEST/READY/DEPARTING(지오펜스 전담 구간)로 넘어간 러너는 stop()이 안 불려서
    // AlarmManager.runners에 계속 남아있다 — resumeAll()에 계속 휩쓸리므로, 포그라운드
    // 복귀 시 여기서 불필요한 재폴링을 만들지 않도록 걸러야 한다.
    //
    // 2026-08-18(실기기로 발견, 사용자 제보): 예전엔 이 판단을 this.status(러너가 마지막으로
    // "스스로" 관찰한 상태) 기준의 값싼 사전 필터로 먼저 걸렀었다 — `if (['NEARDEST','READY',
    // 'DEPARTING'].includes(this.status)) return;`. 근데 READY→DEPARTING→MOVING 전환은
    // 전부 지오펜스(백그라운드/헤드리스)가 감지하므로, 포그라운드 러너 인스턴스는 이 전환들을
    // 하나도 못 보고 this.status가 옛 값(예: "READY")에 계속 묶여있을 수 있다. 그 상태로
    // 실제로는 MOVING(폴링이 꼭 필요)인데도 이 필터가 "지오펜스 전담 구간"으로 오판해 조용히
    // (로그도 없이) 재폴링을 스킵해버렸다 — READY 진입 이후 한 번도 포그라운드에서 직접 poll()
    // 안 한 러너가, 그 뒤로 앱을 아무리 포그라운드로 돌려도 계속 재폴링이 안 되는 걸 실기기
    // 테스트로 확인. this.status는 신뢰할 수 없으므로 완전히 제거하고, 바로 아래
    // isKeyActivelyTracked()(ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY 멤버십 — 감지
    // 주체와 무관하게 NEARDEST/READY/DEPARTING 진입 시 removeActiveId()가 항상 일관되게
    // 이 목록에서 빼주므로 신뢰 가능한 단일 진실 공급원)만으로 판단한다.
    const key = this.currentKey();
    if (key && !(await isKeyActivelyTracked(key))) {
      dlog('FOREGROUND', `[alarmService] 포그라운드 복귀 — key:${key} 활성 추적 대상 아님(NEARDEST 등) — 재폴링 스킵`);
      return;
    }
    const lastCall = key ? await getLastCallTime(key) : 0;
    // lastCall이 0이면(호출 기록 없음 — 방금 생성된 알람) elapsed가 Date.now() 자체가 되어
    // "경과 17억초" 같은 의미 없는 로그가 찍힌다. 판단(즉시 poll)은 원래도 맞았으니 로그만 구분.
    if (lastCall === 0) {
      dlog('FOREGROUND', `[alarmService] 포그라운드 복귀 — 호출 기록 없음, 즉시 재폴링`);
      this.poll();
      return;
    }
    const elapsed = Date.now() - lastCall;
    const intervalMs = this.intervalSec * 1000;
    if (elapsed >= intervalMs) {
      dlog('FOREGROUND', `[alarmService] 포그라운드 복귀 — 경과 ${Math.round(elapsed / 1000)}s ≥ ${this.intervalSec}s, 즉시 재폴링`);
      this.poll();
    } else {
      const remainingMs = intervalMs - elapsed;
      dlog('FOREGROUND', `[alarmService] 포그라운드 복귀 — interval 미달(경과 ${Math.round(elapsed / 1000)}s/${this.intervalSec}s), ${Math.round(remainingMs / 1000)}s 후 재시도로 예약`);
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = setTimeout(() => this.poll(), remainingMs);
    }
  }

  // skipActiveCheck: start()가 이 러너를 막 생성하고 거는 최초 1회 호출 전용 — 이 시점엔
  // ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY 기록이 아직 안 끝났을 수 있어(addActiveId는
  // fire-and-forget) 아래 isKeyActivelyTracked() 체크를 그대로 적용하면 정상적인 최초 폴링을
  // 막아버린다(실기기로 재현됨 — 콜드 스타트 후 포그라운드 폴링이 아예 시작을 못 함). 최초
  // 호출은 애초에 낡은 타이머가 만들어낼 수 없으므로(막 생성된 러너라 pollTimer 자체가 없음)
  // 건너뛰어도 이 체크가 막으려는 시나리오와 무관해 안전하다.
  private async poll(skipActiveCheck = false): Promise<void> {
    const idForLog = this.target?.journeyId ?? `apt${this.target?.appointmentId}`;
    dlog('FOREGROUND', `[포그라운드] poll() 진입 — id:${idForLog} skipActiveCheck:${skipActiveCheck} AppState:${AppState.currentState} polling:${this.polling} status:${this.status}`);
    dlog('FOREGROUND', `poll() 진입 — id:${idForLog} skipActiveCheck:${skipActiveCheck} AppState:${AppState.currentState} polling:${this.polling} status:${this.status}`);
    if (!this.target) return;
    if (AppState.currentState !== 'active') {
      // 백그라운드에선 backgroundLocationTask.ts의 네이티브 GPS 구독이 폴링을 전담한다(버그3/8,
      // 2026-08-14) — 그냥 두면 둘이 동시에 /location을 호출해서 syncStagedAlarms()가 경합하며
      // 단계별 알람이 중복 등록될 수 있음(실사용 중 재현됨).
      // 2026-08-14(버그3/8, 추가 발견): 예전엔 여기서도 scheduleNextPoll()로 JS 타이머 체인을
      // 계속 이어갔는데, JS 타이머는 백그라운드에서 지연됐다가 포그라운드 복귀 직후 몰아서
      // 발동할 수 있어서(오늘 다른 곳에서도 확인된 문제) — 이 낡은 타이머가 resumeIfDue()가
      // 방금 경과 시간 기준으로 정확히 예약해둔 새 타이머를 무시하고 즉시 실제 호출을
      // 만들어버리는 버그가 실기기로 확인됐다. 백그라운드에서는 이 타이머 체인 자체를 아예
      // 안 만들고(기존 것도 확실히 취소), 포그라운드 복귀 시 resumeIfDue()가 공유된
      // lastCallTimes 기준으로 새로 정확하게 예약하도록 전적으로 맡긴다.
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      return;
    }
    if (this.polling) {
      dlog('FOREGROUND', `[포그라운드] poll 이미 진행 중 — skip`);
      dlog('FOREGROUND', `poll() 차단 — id:${idForLog} 이미 진행 중`);
      return;
    }
    // 2026-08-14(버그3/8, 재검토 중 실기기로 발견): resumeIfDue()가 예약한 타이머가
    // _layout.tsx의 AppState 디바운스 결함(같은 방향 이벤트만 보고 판단해서, background→
    // active→background처럼 짧은 시간에 방향이 왕복되면 두 번째 background에서
    // pauseAll()이 스킵될 수 있음)으로 인해 안 지워진 채 남았다가, 이 runner가 이미
    // NEARDEST로 넘어가 지오펜스 전담 구간이 된 뒤에도 뒤늦게 발동하는 경우가 실기기로
    // 재현됐다. resumeIfDue() 쪽 사전 체크만으론 "낡은 타이머가 poll()을 직접 호출하는"
    // 경로를 못 막으므로, poll() 자체에도 마지막 방어선을 둔다. this.status는 백그라운드
    // 헤드리스 틱이 먼저 NEARDEST를 감지한 경우 영영 갱신되지 않을 수 있어(그 경우 이
    // 러너의 poll() 응답 처리 자체가 중복 호출 가드에 걸려 스킵되기 때문) 신뢰하지 않고,
    // 단일 진실 공급원인 ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY 기준으로 판단한다.
    const activeKey = this.currentKey();
    if (!skipActiveCheck && activeKey && !(await isKeyActivelyTracked(activeKey))) {
      dlog('FOREGROUND', `[포그라운드] poll() 방어선 — key:${activeKey} 활성 추적 대상 아님(NEARDEST 등) — 낡은 타이머로 인한 호출 차단`);
      dlog('FOREGROUND', `poll() 차단 — key:${activeKey} 활성 추적 대상 아님(지오펜스 전담 구간) — 낡은 타이머로 인한 호출 차단`);
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      return;
    }
    this.polling = true;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      // GPS 조회 도중(await 대기 중) stop()이 불려서 this.target이 null이 될 수 있다(예: 이
      // poll()이 진행 중인 채로 사용자가 알람을 삭제) — 재검토 중 실기기 로그로 발견됨.
      // scheduleNextPoll() 등 아래 로직도 target 없이 의미가 없으므로 조용히 종료한다.
      if (!this.target) return;
      if (this.target.alarmType === 'group') {
        await this.pollGroup(loc.coords.latitude, loc.coords.longitude);
      } else {
        await this.pollPersonal(loc.coords.latitude, loc.coords.longitude);
      }
    } catch (e: any) {
      const id = this.target?.journeyId ?? `apt${this.target?.appointmentId}`;
      dlog('FOREGROUND', `[포그라운드] GPS 위치 획득 실패 — id:${id} error:${e}`);
      this.scheduleNextPoll();
    } finally {
      this.polling = false;
    }
  }

  private async pollPersonal(lat: number, lng: number): Promise<void> {
    if (!this.target?.journeyId) return;
    const key = `j_${this.target.journeyId}`;
    // 2026-08-14(버그3/8, 재발 수정): 알람 생성 직후 짧은 AppState 블립(시트 닫힘 등으로
    // background→active가 순간적으로 찍히는 것) 동안 백그라운드 네이티브 구독이 잠깐 켜져서,
    // 이 foreground poll()(GPS 콜드 픽스라 몇 초 걸릴 수 있음)과 경쟁해 같은 alarm에 실제
    // /location 호출이 중복으로 나가는 문제가 실기기로 재현됐다. AppState 전환 자체를 디바운스
    // 하는 방식은 백그라운드 중 JS 타이머가 지연되는 문제와 충돌해서 되돌렸다(_layout.tsx 주석
    // 참고) — 대신 호출 직전에 "방금 다른 드라이버가 이미 불렀는지"를 확인해서 스킵한다.
    const recentCall = await getLastCallTime(key);
    if (recentCall > 0 && Date.now() - recentCall < DUPLICATE_CALL_GUARD_MS) {
      // 상대방(백그라운드 드라이버)이 방금 받았을 실제 interval을 반영 — 안 하면 이 runner는
      // 기본값(30초)으로 재예약해서 얼마 뒤 또 조기 호출을 만든다.
      const desired = await getDesiredInterval(key);
      if (desired != null) this.intervalSec = desired;
      dlog('FOREGROUND', `[포그라운드] 최근 ${DUPLICATE_CALL_GUARD_MS / 1000}초 내 이미 호출됨(다른 드라이버) — 중복 스킵 journeyId:${this.target.journeyId} (다음 interval:${this.intervalSec}s)`);
      this.scheduleNextPoll();
      return;
    }
    dlog('FOREGROUND', `[포그라운드] /location 호출 — journeyId:${this.target.journeyId} (${lat.toFixed(5)}, ${lng.toFixed(5)}) interval:${this.intervalSec}s`);
    // 2026-08-14(버그3/8): 백그라운드 헤드리스 틱과 동일하게, 호출 시도 시점에 바로 기록한다(성공
    // 여부와 무관 — 실패해도 다음 tick에서 바로 재시도하지 않도록). AlarmManager.resumeAll()이
    // 포그라운드 복귀 시 이 값 기준으로 "경과 시간"을 계산해 불필요한 중복 호출을 막는다.
    setLastCallTime(key, Date.now()).catch(() => {});
    const token = getToken();
    if (!token) { dlog('FOREGROUND', `[포그라운드] 토큰 없음 — journeyId:${this.target.journeyId} 호출 스킵`); this.scheduleNextPoll(); return; }
    try {
      // 2026-08-14(재검토 발견): 예전엔 fetch 기반 journeysApi.updateLocation()을 썼는데, 이 poll()
      // 타이머가 하필 백그라운드 전환 직전에 발동하면(실기기로 재현 — 그룹 알람 테스트 중 응답이
      // 4분 뒤 포그라운드 복귀 시점에야 도착) 응답이 무한 대기했다. patchLocation()은 이미 같은
      // 문제(JS setTimeout 기반 타임아웃이 백그라운드에서 제때 안 먹힘, docs/history/
      // resolved-bugs.md 2026-08-13 참고)를 XMLHttpRequest.timeout(네이티브 레벨 타임아웃)으로
      // 해결한 검증된 경로라 — 포그라운드 경로도 여기에 통일해서 같은 보호를 받게 한다.
      const res = await patchLocation(`/api/journeys/${this.target.journeyId}/location`, token, lat, lng);
      if (!res.data) { dlog('FOREGROUND', `[포그라운드] /location 응답 data 없음 — journeyId:${this.target.journeyId}`); return; }
      const { journey_status, preparation_time, interval, which_station, departure_alarm_time } = res.data;
      dlog('FOREGROUND', `[포그라운드] /location 응답 — journeyId:${this.target.journeyId} status:${journey_status} interval:${interval} which_station:${which_station} departure_alarm_time:${departure_alarm_time}`);
      // 지금 떠 있는 알람 목록 화면이 있으면(생성 직후 화면 등) 재조회 없이 즉시 반영하게 알림
      emitAlarmLocationUpdate({ journeyId: this.target.journeyId, status: journey_status, departureAlarmTime: departure_alarm_time });
      if (interval !== null) {
        // interval은 서버가 플라스크를 실제로 호출했을 때만 non-null이다(JourneyService.updateLocation
        // 참고 — 앵커 500m 이탈/최초 수신/MOVING 등). target_time이 바뀔 수 있는 경우도 정확히
        // 이때뿐이라(막차 모드 재계산), 이 신호에 맞춰서만 재조회한다 — 위 로컬 알림만으론 "목표
        // 시각" 라벨까지는 못 따라잡으므로(DailyAlarmScreen/MainCalendarScreen 등이 alarmVersion을
        // 구독해 서버 값으로 완전히 최신화됨), 매 GPS 핑마다가 아니라 실제로 바뀔 수 있는 순간에만.
        useCalendarStore.getState().bumpAlarmVersion();
        const effectiveInterval = DEBUG_FORCE_INTERVAL_SEC ?? interval;
        dlog('FOREGROUND', `[포그라운드] interval 갱신 — journeyId:${this.target!.journeyId} ${this.intervalSec}s → ${effectiveInterval}s${DEBUG_FORCE_INTERVAL_SEC != null ? `(서버값 ${interval}s 무시, 테스트 강제)` : ''}`);
        this.intervalSec = effectiveInterval;
        const key = `j_${this.target!.journeyId}`;
        setDesiredInterval(key, effectiveInterval).catch(() => {});
      }
      // 2026-08-14: 등록 시점 대신 실제 호출 성공 시점에 "다음 호출까지 약 N초"를 알려준다
      // (backgroundLocationTask.ts와 동일한 원칙 — 사용자 피드백으로 등록 이벤트 알림 제거).
      // 2026-08-14(사용자 요청): 서버가 실제로 준 값도 함께 보여준다(interval: 서버값 →
      // 적용값초) — DEBUG_FORCE_INTERVAL_SEC로 강제 중일 때 서버 원본값을 가리지 않기 위함.
      sendDebugNotification('GPS 호출 완료(포그라운드)', `journeyId:${this.target!.journeyId} status:${journey_status} interval: ${interval != null ? interval : '유지'} → ${this.intervalSec}초`).catch(() => {});
      dlog('FOREGROUND', `journeyId:${this.target!.journeyId} /location 응답 status:${journey_status}`);
      if (!this.target) return;
      if (journey_status === 'NEARDEST' && Platform.OS === 'android') {
        // NEARDEST 진입 — 폴링 타이머를 재예약하지 않고 지오펜스로 감시를 넘긴다(개인/귀가는 isActive 무관하게 항상 알림)
        // 안드로이드 전용(iOS는 지오펜싱 불가라 기존 폴링 유지 — READY 분기와 동일 이유)
        // READY 지오펜스가 등록돼 있었을 수 있다(예: departing_transition FCM으로 러너를 재개시켰는데
        // 그 사이 목적지 100m 이내까지 들어온 경우) — 방치하면 READY/NEARDEST 지오펜스가 동시에 남는다.
        await exitReadyGeofenceMode(this.currentKey()!).catch(() => {});
        await enterNearDestGeofenceMode(this.currentKey()!, this.target.destLat, this.target.destLng, this.target.destination);
        // 더 이상 /location 폴링이 필요 없으므로 배경 위치추적 태스크의 추적 목록에서도 제거
        // (안 빼면 나중에 백그라운드 전환 시 이 알람 때문에 불필요한 호출/FGS 지연 종료가 생김)
        // await로 순서 보장 후 maybeSyncGpsPolling() 호출 — 앱이 계속 포그라운드에 머물면
        // 헤드리스 배경 틱이 안 돌아서 GPS 폴링 구독이 안 멈추는 구멍을 여기서 메운다.
        await removeActiveId(this.target.journeyId, undefined);
        await maybeSyncGpsPolling();
        dlog('NEARDEST', `key:${this.currentKey()} 포그라운드 폴링에서 지오펜스로 전환 완료`);
      } else if (journey_status === 'DEPARTING' && Platform.OS === 'android') {
        // DEPARTING 진입 — 폴링 타이머를 재예약하지 않고 지오펜스로 감시를 넘긴다. 앵커 근사치
        // 근거는 departingGeofenceTask.ts의 enterDepartingGeofenceMode() 주석 참고.
        // 안드로이드 전용(iOS는 지오펜싱 불가라 기존 폴링 유지 — READY 분기와 동일 이유)
        // READY 지오펜스 정리 이유는 위 NEARDEST 분기와 동일 — departing_transition FCM으로
        // 재개된 러너가 여기로 올 수 있는데, 그때 READY 지오펜스가 아직 안 지워져 있음.
        await exitReadyGeofenceMode(this.currentKey()!).catch(() => {});
        await enterDepartingGeofenceMode(this.currentKey()!, lat, lng, this.target.destLat, this.target.destLng);
        await removeActiveId(this.target.journeyId, undefined);
        await maybeSyncGpsPolling();
        dlog('DEPARTING', `key:${this.currentKey()} 포그라운드 폴링에서 지오펜스로 전환 완료 — 앵커(${lat.toFixed(6)}, ${lng.toFixed(6)})`);
      } else if (journey_status === 'READY' && Platform.OS === 'android') {
        // READY — 지오펜싱으로 감시 이관(Phase 3, 안드로이드 전용 — iOS는 지오펜싱 불가라
        // 기존 폴링 유지). 방금 실제로 GPS를 찍은 좌표라 근사치 오차 없이 정확한 앵커로 등록됨.
        await enterReadyGeofenceMode(this.currentKey()!, lat, lng, this.target.destLat, this.target.destLng, departure_alarm_time != null);
        await removeActiveId(this.target.journeyId, undefined);
        await maybeSyncGpsPolling();
        dlog('READY', `key:${this.currentKey()} 포그라운드 폴링에서 지오펜스로 전환 완료 — 앵커(${lat.toFixed(6)}, ${lng.toFixed(6)})`);
        // handlePersonalStatus()의 READY 분기는 "이전 상태가 READY가 아니었으면 즉시 재poll"하는
        // 로직이 있다(iOS의 연속 폴링 체인을 잇기 위한 것) — 방금 지오펜스로 넘겼는데 이게 또
        // 실제 GPS+서버 호출을 한 번 더 만들면 지오펜싱 전환의 의미가 없어진다. this.status를
        // 미리 맞춰서 그 트리거만 건너뛰게 한다(departureAlarmTime 있으면 여전히 syncStages는 됨).
        this.status = 'READY';
      } else {
        this.scheduleNextPoll();
      }
      await this.handlePersonalStatus(journey_status, preparation_time, interval, which_station, departure_alarm_time);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('"success":false') || msg.startsWith('HTTP 4')) {
        dlog('FOREGROUND', `[포그라운드] /location 서버 오류 — journeyId:${this.target?.journeyId} 폴링 중단`);
        this.stop();
      } else {
        dlog('FOREGROUND', `[포그라운드] /location 호출 실패 — journeyId:${this.target?.journeyId} error:${e}`);
        this.scheduleNextPoll();
      }
    }
  }

  private async pollGroup(lat: number, lng: number): Promise<void> {
    if (!this.target?.appointmentId) return;
    const key = `a_${this.target.appointmentId}`;
    // 2026-08-14(버그3/8, 재발 수정): pollPersonal과 동일한 중복 호출 가드 — 위 주석 참고.
    const recentCall = await getLastCallTime(key);
    if (recentCall > 0 && Date.now() - recentCall < DUPLICATE_CALL_GUARD_MS) {
      const desired = await getDesiredInterval(key);
      if (desired != null) this.intervalSec = desired;
      dlog('FOREGROUND', `[포그라운드] 최근 ${DUPLICATE_CALL_GUARD_MS / 1000}초 내 이미 호출됨(다른 드라이버) — 중복 스킵 appointmentId:${this.target.appointmentId} (다음 interval:${this.intervalSec}s)`);
      this.scheduleNextPoll();
      return;
    }
    dlog('FOREGROUND', `[포그라운드] /location 호출 — appointmentId:${this.target.appointmentId} (${lat.toFixed(5)}, ${lng.toFixed(5)}) interval:${this.intervalSec}s`);
    // 2026-08-14(버그3/8): pollPersonal과 동일 — 호출 시도 시점에 바로 기록(성공 여부 무관).
    setLastCallTime(key, Date.now()).catch(() => {});
    const token = getToken();
    if (!token) { dlog('FOREGROUND', `[포그라운드] 토큰 없음 — appointmentId:${this.target.appointmentId} 호출 스킵`); this.scheduleNextPoll(); return; }
    try {
      // 2026-08-14(재검토 발견): pollPersonal과 동일 — fetch 기반 대신 네이티브 레벨 타임아웃을
      // 쓰는 patchLocation()으로 통일(위 pollPersonal의 상세 주석 참고).
      const res = await patchLocation(`/api/appointments/${this.target.appointmentId}/participants/location`, token, lat, lng);
      if (!res.data) { dlog('FOREGROUND', `[포그라운드] /location 응답 data 없음 — appointmentId:${this.target.appointmentId}`); return; }
      const { participant_status, appointment_status, estimated_arrival, preparation_time, interval, which_station, departure_alarm_time } = res.data;
      dlog('FOREGROUND', `[포그라운드] /location 응답 — appointmentId:${this.target.appointmentId} participantStatus:${participant_status} appointmentStatus:${appointment_status} interval:${interval} which_station:${which_station} departure_alarm_time:${departure_alarm_time}`);
      useAppointmentStatusStore.getState().setStatus(this.target.appointmentId, appointment_status);
      // 지금 떠 있는 알람 목록 화면이 있으면(생성 직후 화면 등) 재조회 없이 즉시 반영하게 알림
      emitAlarmLocationUpdate({ appointmentId: this.target.appointmentId, status: participant_status, departureAlarmTime: departure_alarm_time });
      if (interval !== null) {
        // pollPersonal과 동일 이유(위 주석 참고) — interval은 서버가 실제로 재계산했을 때만
        // non-null이므로 이때만 재조회한다. (그룹은 target_time이 방장 고정값이라 GPS로 안
        // 바뀌지만, 개인/귀가와 동일한 신호에 맞춰 일관되게 유지)
        useCalendarStore.getState().bumpAlarmVersion();
        const effectiveInterval = DEBUG_FORCE_INTERVAL_SEC ?? interval;
        dlog('FOREGROUND', `[포그라운드] interval 갱신 — appointmentId:${this.target!.appointmentId} ${this.intervalSec}s → ${effectiveInterval}s${DEBUG_FORCE_INTERVAL_SEC != null ? `(서버값 ${interval}s 무시, 테스트 강제)` : ''}`);
        this.intervalSec = effectiveInterval;
        const key = `a_${this.target!.appointmentId}`;
        setDesiredInterval(key, effectiveInterval).catch(() => {});
      }
      sendDebugNotification('GPS 호출 완료(포그라운드)', `appointmentId:${this.target!.appointmentId} status:${participant_status} interval: ${interval != null ? interval : '유지'} → ${this.intervalSec}초`).catch(() => {});
      dlog('FOREGROUND', `appointmentId:${this.target!.appointmentId} /location 응답 status:${participant_status}`);
      if (!this.target) return;
      if (participant_status === 'NEARDEST' && Platform.OS === 'android') {
        // NEARDEST 진입 — 폴링 타이머를 재예약하지 않고 지오펜스로 감시를 넘긴다.
        // 추적 자체는 isActive와 무관하게 계속하되(그룹 전체 상태 계산에 필요), 알림만 isActive를 따름
        // 안드로이드 전용(iOS는 지오펜싱 불가라 기존 폴링 유지 — READY 분기와 동일 이유)
        // READY 지오펜스 정리 이유는 pollPersonal의 동일 분기 주석 참고(departing_transition FCM으로
        // 재개된 러너가 여기로 올 수 있음).
        await exitReadyGeofenceMode(this.currentKey()!).catch(() => {});
        await enterNearDestGeofenceMode(this.currentKey()!, this.target.destLat, this.target.destLng, this.target.destination, this.isActive);
        // 더 이상 /location 폴링이 필요 없으므로 배경 위치추적 태스크의 추적 목록에서도 제거
        // await로 순서 보장 후 maybeSyncGpsPolling() 호출 — 앱이 계속 포그라운드에 머물면
        // 헤드리스 배경 틱이 안 돌아서 GPS 폴링 구독이 안 멈추는 구멍을 여기서 메운다.
        await removeActiveId(undefined, this.target.appointmentId);
        await maybeSyncGpsPolling();
        dlog('NEARDEST', `key:${this.currentKey()} 포그라운드 폴링에서 지오펜스로 전환 완료`);
      } else if (participant_status === 'DEPARTING' && Platform.OS === 'android') {
        // DEPARTING 진입 — 폴링 타이머를 재예약하지 않고 지오펜스로 감시를 넘긴다.
        // 추적 자체는 isActive와 무관하게 계속(그룹 전체 상태 계산에 필요).
        // 안드로이드 전용(iOS는 지오펜싱 불가라 기존 폴링 유지 — READY 분기와 동일 이유)
        await exitReadyGeofenceMode(this.currentKey()!).catch(() => {});
        await enterDepartingGeofenceMode(this.currentKey()!, lat, lng, this.target.destLat, this.target.destLng);
        await removeActiveId(undefined, this.target.appointmentId);
        await maybeSyncGpsPolling();
        dlog('DEPARTING', `key:${this.currentKey()} 포그라운드 폴링에서 지오펜스로 전환 완료 — 앵커(${lat.toFixed(6)}, ${lng.toFixed(6)})`);
      } else if (participant_status === 'READY' && Platform.OS === 'android') {
        // READY — 지오펜싱으로 감시 이관(Phase 3, 안드로이드 전용). 추적 자체는 isActive와
        // 무관하게 계속(그룹 전체 상태 계산에 필요).
        await enterReadyGeofenceMode(this.currentKey()!, lat, lng, this.target.destLat, this.target.destLng, departure_alarm_time != null);
        await removeActiveId(undefined, this.target.appointmentId);
        await maybeSyncGpsPolling();
        dlog('READY', `key:${this.currentKey()} 포그라운드 폴링에서 지오펜스로 전환 완료 — 앵커(${lat.toFixed(6)}, ${lng.toFixed(6)})`);
        // handleGroupStatus()의 READY 재poll 트리거를 건너뛰기 위함 — 위 handlePersonalStatus
        // 분기의 동일한 주석 참고.
        this.status = 'READY';
      } else {
        this.scheduleNextPoll();
      }
      await this.handleGroupStatus(participant_status, preparation_time, estimated_arrival, interval, which_station, departure_alarm_time);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('"success":false') || msg.startsWith('HTTP 4')) {
        dlog('FOREGROUND', `[포그라운드] /location 서버 오류 — appointmentId:${this.target?.appointmentId} 폴링 중단`);
        this.stop();
      } else {
        dlog('FOREGROUND', `[포그라운드] /location 호출 실패 — appointmentId:${this.target?.appointmentId} error:${e}`);
        this.scheduleNextPoll();
      }
    }
  }

  private async handlePersonalStatus(newStatus: JourneyStatus, preparationTime: number, interval: number | null, whichStation?: string | null, departureAlarmTime?: string | null): Promise<void> {
    if (newStatus === 'READY') {
      if (this.status !== 'READY') {
        dlog('FOREGROUND', `[alarmService] 상태전이 ${this.status} → READY — journeyId:${this.target?.journeyId}`);
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
      dlog('FOREGROUND', `[alarmService] 서버 응답 SCHEDULED — journeyId:${this.target?.journeyId} 폴링 중단`);
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
      dlog('FOREGROUND', `[alarmService] 상태전이 ${this.status} → ${newStatus} — journeyId:${this.target?.journeyId}`);
      this.status = newStatus;

      if (newStatus === 'MOVING') {
        this.cancelRemainingStages();
        dlog('FOREGROUND', `[alarmService] MOVING — 단계별 알람 취소 journeyId:${this.target?.journeyId}`);
        // 목적지 100m ENTER 보조 지오펜스 등록(Phase 2) — 폴링(실시간 ETA용)은 그대로 유지.
        const key = this.currentKey();
        if (key) enterMovingGeofenceMode(key, this.target?.destLat, this.target?.destLng).catch(() => {});
      }

      // NEARDEST 도착 확인 알림은 이제 enterNearDestGeofenceMode()(nearDestGeofenceTask.ts)가
      // 발송 — 포그라운드/백그라운드 공통 경로로 통합돼서 여기 별도 처리 불필요

      if (newStatus === 'ARRIVED') {
        this.cancelRemainingStages();
        const preserve = isRepeatingJourney(this.target?.repeatDays);
        dlog('FOREGROUND', `[alarmService] ARRIVED → 폴링 종료 — journeyId:${this.target?.journeyId} repeatDays:${this.target?.repeatDays ?? 0} 파킹:${preserve}`);
        this.stop(preserve);
      }
    }
  }

  private async handleGroupStatus(newStatus: JourneyStatus, preparationTime: number, estimatedArrival: string, interval: number | null, whichStation?: string | null, departureAlarmTime?: string | null): Promise<void> {
    if (newStatus === 'READY') {
      if (this.status !== 'READY') {
        dlog('FOREGROUND', `[alarmService] 상태전이 ${this.status} → READY — appointmentId:${this.target?.appointmentId}`);
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
      dlog('FOREGROUND', `[alarmService] 서버 응답 SCHEDULED — appointmentId:${this.target?.appointmentId} 폴링 중단`);
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
      dlog('FOREGROUND', `[alarmService] 상태전이 ${this.status} → ${newStatus} — appointmentId:${this.target?.appointmentId}`);
      this.status = newStatus;

      if (newStatus === 'MOVING' && !this.movingSent) {
        this.movingSent = true;
        this.cancelRemainingStages();
        if (this.isActive) {
          const arrivalTime = formatEstimatedArrival(estimatedArrival);
          dlog('FOREGROUND', `[alarmService] MOVING — 단계별 알람 취소 appointmentId:${this.target?.appointmentId} ETA:${arrivalTime}`);
          // sendArrivalAlarm('나', arrivalTime, this.target!.destination); // FCM으로 대체
        }
        // 목적지 100m ENTER 보조 지오펜스 등록(Phase 2) — isActive와 무관하게 추적은 계속(그룹 전체
        // 상태 계산에 필요, NEARDEST/DEPARTING과 동일 원칙). 폴링(실시간 ETA용)은 그대로 유지.
        const key = this.currentKey();
        if (key) enterMovingGeofenceMode(key, this.target?.destLat, this.target?.destLng).catch(() => {});
      }

      // NEARDEST 도착 확인 알림은 이제 enterNearDestGeofenceMode()(nearDestGeofenceTask.ts)가
      // 발송 — 포그라운드/백그라운드 공통 경로로 통합돼서 여기 별도 처리 불필요

      if (newStatus === 'ARRIVED' && !this.arrivedSent) {
        this.arrivedSent = true;
        this.cancelRemainingStages();
        if (this.isActive) {
          const arrivalTime = formatEstimatedArrival(estimatedArrival);
          dlog('FOREGROUND', `[alarmService] ARRIVED — 도착완료 appointmentId:${this.target?.appointmentId} time:${arrivalTime}`);
          // sendArrivalConfirmAlarm('나', arrivalTime, this.target!.destination); // FCM으로 대체
        }
        // 그룹(Appointment)은 repeatDays 개념이 없어 target.repeatDays가 항상 undefined다 —
        // isRepeatingJourney()가 false를 반환해 실질적으로 기존과 동일하게 동작(no-op 통일,
        // 버그45는 개인/귀가 전용).
        this.stop(isRepeatingJourney(this.target?.repeatDays));
      }
    }
  }

}

class AlarmManager {
  private runners = new Map<string, AlarmRunner>();
  private starting = new Set<string>();
  // stop() 직후 짧은 시간 안에 _layout.tsx의 startReadyAlarms()(포그라운드 복귀 시 서버 재조회 →
  // "안 돌고 있는데 아직 활성 상태면 재시작") 재조정 로직과 경쟁하는 문제 방지용(2026-08-17
  // 실기기로 발견 — 도착확인 시 /arrive가 서버에 반영되기 전에 getAlarms()가 옛 상태(NEARDEST)를
  // 그대로 읽어와서 방금 끝낸 알람을 도로 살려버림). key별 마지막 stop() 시각만 기록.
  private recentlyStoppedAt = new Map<string, number>();

  private key(journeyId?: number, appointmentId?: number): string {
    return journeyId != null ? `j_${journeyId}` : `a_${appointmentId}`;
  }

  async start(target: AlarmTarget): Promise<void> {
    const k = this.key(target.journeyId, target.appointmentId);
    dlog('FOREGROUND', `[AlarmManager.start] 진입 — key:${k} type:${target.alarmType}`);
    if (this.starting.has(k)) {
      dlog('FOREGROUND', `[AlarmManager.start] 이미 시작 중 — key:${k} skip`);
      return;
    }
    this.starting.add(k);
    try {
      let effectiveTarget = target;
      if (this.runners.has(k)) {
        dlog('FOREGROUND', `[AlarmManager.start] 기존 runner 교체 — key:${k}`);
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
        dlog('FOREGROUND', `[AlarmManager] runner 제거 — key:${k} 남은 runners:${this.runners.size}`);
        // removeActiveId()가 AsyncStorage에 반영된 뒤에 폴링 필요 여부를 재판단해야 하므로
        // await로 순서를 보장한다(2026-08-13 발견 — 예전엔 fire-and-forget이라, 남은 runner가
        // 있어도 그게 전부 NEARDEST(지오펜스 감시)뿐이면 GPS 폴링은 필요 없는 경우를 놓쳐서
        // 알람 삭제 후에도 GPS 폴링이 계속 도는 버그가 있었음. 실기기 실측으로 확인됨).
        (async () => {
          await removeActiveId(target.journeyId, target.appointmentId);
          await this.reconcileGpsAfterRunnerGone(`key:${k} onFinish`);
        })().catch(() => {});
      });
      this.runners.set(k, runner);
      // 백그라운드 위치추적 태스크가 "추적할 게 있는지" 판단하는 유일한 근거라, runner를
      // map에 등록하는 이 시점에 바로 같이 기록해둔다 — 백그라운드 전환 시점까지 미루면
      // 그 사이 배경 틱이 먼저 발화해 빈 목록으로 잘못 읽는 경쟁 조건이 있었음.
      // 2026-08-14(재검토, 실기기로 발견 — 시도했다가 되돌림): 한때 이 저장을 await로 바꿔서
      // runner.start()보다 먼저 끝나도록 시도했었다(poll()의 isKeyActivelyTracked() 방어
      // 체크가 이 저장이 끝나기 전에 실행되면 "활성 추적 대상 아님"으로 오판하는 경쟁을
      // 막으려는 의도). 그런데 실기기 재검증 결과, 그 await 자체가 콜드 스타트 직후(특히
      // expo-updates의 JS 레벨 리로드 직후) 영영 안 풀리는 것으로 보이는 정지 현상을
      // 새로 만들어서 포그라운드 폴링이 아예 시작을 못 하는 더 심각한 회귀로 이어졌다
      // (getAlarms 응답 로그 이후 어떤 JS 로그도 안 찍히는 것으로 실기기 로그에서 확인).
      // 그래서 fire-and-forget으로 되돌리고, 원래 경쟁은 poll() 쪽(아래 AlarmRunner.poll()의
      // skipActiveCheck 인자 참고)에서 다른 방식으로 막는다 — 최초 poll() 호출 자체가 이
      // 체크를 건너뛰므로 addActiveId()가 끝나길 기다릴 필요가 없어졌다.
      addActiveId(effectiveTarget.journeyId, effectiveTarget.appointmentId)
        .then(() => dlog('FOREGROUND', `[AlarmManager.start] addActiveId 완료 — key:${k}`))
        .catch((e) => dlog('FOREGROUND', `[AlarmManager.start] addActiveId 실패 — key:${k} error:${e}`));
      dlog('FOREGROUND', `[AlarmManager.start] runners 등록 — key:${k} 총:${this.runners.size}개`);
      await runner.start(effectiveTarget);
      dlog('FOREGROUND', `[AlarmManager.start] runner.start() 완료 — key:${k}`);
      // 2026-08-14(버그3/8, 재발 수정): PersonalAlarmSheet 등 대부분의 호출부가 start() 이후
      // syncForegroundService()를 따로 부르지 않는다 — 그래서 이전 세션에서 남아있던 네이티브
      // 백그라운드 GPS 구독(기본 30초)이 있으면, 방금 포그라운드에서 새로 생성한 알람의
      // AlarmRunner(서버가 준 실제 interval, 예: 300초)와 함께 그대로 병존해서 포/백 알람이
      // 동시에 오고 interval도 서로 다른 버그가 실기기로 재현됐다. start() 자체에서 무조건
      // 동기화해서 호출부가 잊어도 항상 하나의 드라이버만 남게 한다(FGS 시작도 겸함).
      await this.syncForegroundService();
    } finally {
      this.starting.delete(k);
    }
  }

  // preserveIfRepeating: "도착확인 버튼"/"auto_arrived FCM"처럼 ARRIVED 의미로 stop()이 불릴 때만
  // true로 넘긴다 — 삭제/비활성화/SCHEDULED 복귀 등 "진짜 중단" 의도의 기존 호출부는 전부 기본값
  // (false)이라 동작이 그대로다. true여도 반복 여정이 아니면(repeatDays 없음) 그냥 평소처럼
  // 완전히 정리된다 — 실제로 파킹되는 건 "반복 여정 + ARRIVED 의미" 교집합일 때뿐이다(버그45).
  stop(journeyId?: number, appointmentId?: number, preserveIfRepeating = false): void {
    const k = this.key(journeyId, appointmentId);
    dlog('FOREGROUND', `[AlarmManager.stop] 요청 — key:${k} 현재runners:${this.runners.size} preserveIfRepeating:${preserveIfRepeating}`);
    const runner = this.runners.get(k);
    if (runner) {
      // runner.stop()이 내부적으로 onFinish를 호출하고, 거기서 이미 hasActivePolling() 기준으로
      // FGS 필요 여부를 재점검한다 — 여기서 같은 체크를 또 하면 stopBackgroundLocationUpdates가
      // 중복 호출된다(실기기에서 실제로 관측됨).
      const preserve = preserveIfRepeating && isRepeatingJourney(runner.getRepeatDays());
      dlog('FOREGROUND', `[AlarmManager.stop] key:${k} repeatDays:${runner.getRepeatDays() ?? 0} 파킹:${preserve}`);
      runner.stop(preserve);
      this.runners.delete(k);
    } else if (preserveIfRepeating) {
      // 러너가 이미 없는데 ARRIVED 의미로 stop()이 불림 — 이미 파킹돼 있거나(중복 이벤트) 애초에
      // 추적 대상이 아니었던 key다. "삭제/비활성화" 의도가 아니므로 nav info를 건드리지 않는다 —
      // 잘못 지우면 방금 파킹된 엔트리를 다른 경로(예: 폴링 ARRIVED)가 막 파킹해둔 걸 여기서
      // 도로 지워버리는 경쟁이 생길 수 있다.
      dlog('FOREGROUND', `[AlarmManager.stop] 러너 없음, preserveIfRepeating 요청 — key:${k} nav info 그대로 둠(이미 파킹됐거나 대상 아님)`);
    } else {
      // 러너가 이미 없는 key — 반복 여정이 ARRIVED로 파킹돼 다음 회차를 기다리는 중일 수
      // 있다(버그45). 이 상태에서 명시적으로(삭제/비활성화 의도로) stop()이 호출됐다는 건
      // "파킹 취소" 의도이므로, onFinish가 못 하는 nav info/지오펜스 정리를 여기서 직접 해준다 —
      // 안 하면 nav info가 영구히 안 지워져 FGS가 계속 켜진 채 남는다.
      (async () => {
        // 애초에 이 key가 한 번도 시작된 적 없으면(예: SCHEDULED 상태에서 토글 OFF) 지울 것도
        // 없다 — 지오펜스 해제 4종/cancelStagedAlarms/FGS·GPS 재확인을 매번 도는 낭비를 막는다.
        if (!(await hasAlarmNavInfo(k))) {
          dlog('FOREGROUND', `[AlarmManager.stop] 러너 없음, 추적된 적도 없는 key — key:${k} 정리 생략`);
          return;
        }
        dlog('FOREGROUND', `[AlarmManager.stop] 러너 없음(파킹 상태로 추정) — key:${k} nav info/지오펜스 방어적 정리`);
        removeAlarmNavInfo(k).catch(() => {});
        exitNearDestGeofenceMode(k).catch(() => {});
        exitDepartingGeofenceMode(k).catch(() => {});
        exitMovingGeofenceMode(k).catch(() => {});
        exitReadyGeofenceMode(k).catch(() => {});
        cancelStagedAlarms(k).catch(() => {});
        await removeActiveId(journeyId, appointmentId);
        await this.reconcileGpsAfterRunnerGone(`[AlarmManager.stop] 파킹 정리 후 — key:${k}`);
      })().catch(() => {});
    }
    this.recentlyStoppedAt.set(k, Date.now());
    setTimeout(() => this.recentlyStoppedAt.delete(k), RECENTLY_STOPPED_WINDOW_MS);
  }

  // runner가 방금 사라진(onFinish) 또는 애초에 없었던(stop()의 파킹 방어 분기) 시점에 공통으로
  // 쓰는 GPS/FGS 재확인 로직 — 두 호출부가 독립적으로 이 3단계 판단을 복제해 관리하면 정책이
  // 바뀔 때(버그45가 정확히 이 케이스였다) 한쪽만 고치고 다른 쪽을 놓칠 위험이 있어 한 곳으로
  // 모았다.
  private async reconcileGpsAfterRunnerGone(logPrefix: string): Promise<void> {
    if (this.hasActivePolling()) {
      // 남은 runner가 있어도 전부 NEARDEST뿐이면 GPS 폴링은 이제 필요 없을 수 있음 —
      // ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY 기준으로 다시 확인(FGS는 안 건드림)
      dlog('FOREGROUND', `${logPrefix} — runners:${this.runners.size}(남은 알람 있음) → FGS 유지, GPS 폴링만 재확인`);
      await maybeSyncGpsPolling();
    } else if (await hasAnyTrackedAlarm()) {
      // runners는 0이지만 ALARM_NAV_INFO_KEY엔 엔트리가 남아있음 — 반복 여정이 ARRIVED로
      // 파킹돼 다음 회차를 기다리는 중(버그45). GPS만 끄고 FGS는 유지 — 백그라운드 상태로
      // 다음 회차 진입 시점을 맞으면 FGS를 다시 못 켜기 때문에 여기서 미리 지켜야 한다.
      dlog('FOREGROUND', `${logPrefix} — runners:0이지만 파킹된 알람 존재(버그45) → FGS 유지, GPS만 중단`);
      await stopGpsPolling();
    } else {
      dlog('FOREGROUND', `${logPrefix} — runners:0(남은 알람 없음) → FGS 종료 시도`);
      await stopBackgroundLocationUpdates();
    }
  }

  // _layout.tsx의 startReadyAlarms()가 재시작 여부를 판단하기 직전에 호출 — 방금(수 초 이내)
  // stop()된 key라면, 서버가 아직 옛 상태(NEARDEST 등)를 돌려주고 있을 뿐이라고 보고 재시작을
  // 건너뛰게 한다.
  wasRecentlyStopped(journeyId?: number, appointmentId?: number): boolean {
    const k = this.key(journeyId, appointmentId);
    return this.recentlyStoppedAt.has(k);
  }

  // 백그라운드 도착확인(notifications.ts)이 alarmService.stop()을 안 부르는 대신(헤드리스
  // 컨텍스트 안전성 때문, 해당 파일 주석 참고) — 프로세스가 살아있어서(스와이프만 한 경우 등)
  // 러너가 메모리에 좀비로 남을 수 있다. FGS/서버 상태는 이미 그쪽에서 별도로 정리했으므로,
  // 여기서는 onFinish(FGS 재확인 등) 콜백을 억제하고 순수하게 메모리에서만 지운다 — 진짜
  // 헤드리스(프로세스 자체가 없음)에서 호출되면 runners가 애초에 비어있어 조용히 no-op.
  forgetIfExists(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    const runner = this.runners.get(k);
    if (!runner) return;
    runner.setOnFinish(() => {});
    // preserveNavInfo=true — 이 함수의 설계 의도는 "메모리에서만 지운다"이지만, runner.stop()을
    // 인자 없이(기본값 false) 부르면 nav info를 여기서 먼저 지워버려서, 뒤이어 호출부
    // (notifications.ts)가 removeOrParkAlarmNavInfo()로 반복 여부를 판단하려 할 때 이미 지워진
    // 뒤라 항상 "반복 아님"으로 오판하는 경쟁이 있었다(버그45 실기기 테스트로 발견, 2026-08-18 —
    // 귀가 알람을 백그라운드에서 도착확인했을 때 파킹이 무산됨). true로 넘겨 nav info는 절대
    // 건드리지 않고 호출부의 판단에 완전히 맡긴다.
    runner.stop(true);
    this.runners.delete(k);
    dlog('FOREGROUND', `[AlarmManager.forgetIfExists] 좀비 러너 정리(nav info는 호출부가 처리) — key:${k}`);
  }

  // NEARDEST 지오펜스 EXIT 처리(nearDestGeofenceTask.ts) 후 READY로 복귀했을 때, 살아있는
  // runner를 찾아 폴링을 재개시킨다. 앱이 포그라운드일 때만 의미 있음(백그라운드/종료 상태면
  // runner 인스턴스 자체가 없거나 무의미 — 호출부가 그 경우 별도로 폴링 목록에 재등록함).
  resumeFromGeofence(journeyId?: number, appointmentId?: number): void {
    const k = this.key(journeyId, appointmentId);
    const runner = this.runners.get(k);
    dlog('FOREGROUND', `resumeFromGeofence 호출 — key:${k} runner:${runner ? '있음' : '없음(polling 재개 불가)'}`);
    if (!runner) {
      dlog('FOREGROUND', `[AlarmManager.resumeFromGeofence] runner 없음 — key:${k}`);
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
    dlog('FOREGROUND', `[AlarmManager.stopAll] 전체 종료 — runners:${this.runners.size}개`);
    this.runners.forEach((r) => {
      r.setOnFinish(() => {});
      r.stop();
    });
    this.runners.clear();
    await clearActiveIds();
    // runners.forEach는 "지금 실행 중인" 러너만 정리한다 — 반복 여정이 ARRIVED로 파킹돼
    // runners에서 이미 빠진 상태였다면(버그45) 위 루프로는 안 닦인다. 로그아웃은 "전부 한 번에"
    // 정리하는 지점이라 파킹 엔트리까지 통째로 비워야, 다른 계정으로 로그인해도 이전 계정의
    // 파킹 엔트리가 새 FGS 판단에 섞여 들어가지 않는다.
    dlog('FOREGROUND', '[AlarmManager.stopAll] 파킹된 nav info까지 포함해 전체 초기화(버그45)');
    await clearAlarmNavInfo();
    await stopBackgroundLocationUpdates();
  }

  // 백그라운드에서 서버가 새 interval을 줘도 AlarmRunner.intervalSec는 메모리 값이라(마지막
  // 자기가 직접 poll했을 때 값에 머묾) 자동으로 안 따라온다 — 방치하면 포그라운드 복귀 후에도
  // 낡은 페이스로 다음 poll까지 기다리는 gap이 생긴다(2026-08-14, 버그3/8 — 포그라운드/
  // 백그라운드가 하나의 연속된 interval을 공유해야 한다는 요구사항). 포그라운드 복귀 시 모든
  // runner에 resumeIfDue()(경과 시간 기준 재확인 — 무조건 즉시 poll하는 resumePolling()과
  // 다름, 위 AlarmRunner.resumeIfDue() 주석 참고)를 호출해 최신 상태/interval을 이어받는다.
  resumeAll(): void {
    dlog('FOREGROUND', `[AlarmManager.resumeAll] 포그라운드 복귀 — runners:${this.runners.size}개 재확인`);
    this.runners.forEach((r) => r.resumeIfDue().catch(() => {}));
  }

  // 2026-08-14(버그3/8, 재발 수정): 백그라운드 전환 시점에 _layout.tsx가 호출 — 모든 runner의
  // pollTimer를 능동적으로 정리한다(AlarmRunner.pauseTimer() 주석 참고). resumeAll()과 대칭.
  pauseAll(): void {
    dlog('FOREGROUND', `[AlarmManager.pauseAll] 백그라운드 전환 — runners:${this.runners.size}개 타이머 정리`);
    this.runners.forEach((r) => r.pauseTimer());
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
    } else if (await hasAnyTrackedAlarm()) {
      // 실행 중인 runner는 없지만 파킹된 반복 알람이 남아있음(버그45) — FGS는 유지, GPS만 정리.
      dlog('FOREGROUND', '[AlarmManager.syncForegroundService] runners:0이지만 파킹된 알람 존재(버그45) → FGS 유지, GPS만 중단');
      await stopGpsPolling().catch(() => {});
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
