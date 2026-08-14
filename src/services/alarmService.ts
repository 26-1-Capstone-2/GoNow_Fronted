import * as Location from 'expo-location';
import { AppState } from 'react-native';
import type { JourneyStatus } from '@/src/api/journeys';
import { useAppointmentStatusStore } from '@/src/store/appointmentStatusStore';
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
  saveAlarmNavInfo,
  removeAlarmNavInfo,
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
    // 2026-08-14: 이 최초 호출은 스테일 타이머가 만들어낼 수 없다(막 생성된 러너라 애초에
    // pollTimer 자체가 없음) — 아래 poll()의 isKeyActivelyTracked() 방어 체크는 오히려
    // addActiveId()가 아직 저장을 못 끝냈을 때 이 최초 poll을 막아버리는 부작용만 있으므로
    // 이 호출에서만 건너뛴다(skipActiveCheck=true).
    await this.poll(true);
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
    console.log(`[alarmService] 지오펜스로부터 폴링 재개 — status:${this.status}`);
    this.poll();
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
    // 2026-08-14(재검토, 실기기로 발견): NEARDEST에 진입한 러너는 stop()이 안 불려서(ARRIVED/삭제
    // 때만 stop) AlarmManager.runners에 계속 남아있다 — 그래서 이 러너도 resumeAll()에 계속
    // 휩쓸리는데, 그대로 두면 시간이 충분히 지난 뒤 포그라운드 복귀 시 여기서 또 실제 poll()을
    // 만들어버린다("NEARDEST니까 더 이상 폴링 안 한다"는 설계 의도와 어긋남 — 사용자가 NEARDEST
    // 상태에서 포그라운드 복귀 직후 실제 호출이 나가는 걸 실기기로 확인). NEARDEST 진입/복귀는
    // 전적으로 지오펜스 이벤트(nearDestGeofenceTask.ts)가 담당하므로 여기서는 조용히 스킵한다.
    // this.status는 값싼 사전 필터일 뿐 — NEARDEST를 백그라운드 헤드리스 틱이 먼저 감지한
    // 경우(걸어서 이동 중이면 흔함) 포그라운드 러너 인스턴스엔 전혀 반영이 안 돼 이 체크만으론
    // 못 걸러진다는 게 재검토 중 드러났다. 최종 판단은 어디서나 이미 쓰는 단일 진실 공급원인
    // ACTIVE_JOURNEYS_KEY/ACTIVE_APPOINTMENTS_KEY 멤버십으로 한다 — NEARDEST 진입 시
    // removeActiveId()가 감지 주체와 무관하게 항상 일관되게 이 목록에서 빼주기 때문이다.
    if (this.status === 'NEARDEST') return;
    const key = this.currentKey();
    if (key && !(await isKeyActivelyTracked(key))) {
      console.log(`[alarmService] 포그라운드 복귀 — key:${key} 활성 추적 대상 아님(NEARDEST 등) — 재폴링 스킵`);
      return;
    }
    const lastCall = key ? await getLastCallTime(key) : 0;
    // lastCall이 0이면(호출 기록 없음 — 방금 생성된 알람) elapsed가 Date.now() 자체가 되어
    // "경과 17억초" 같은 의미 없는 로그가 찍힌다. 판단(즉시 poll)은 원래도 맞았으니 로그만 구분.
    if (lastCall === 0) {
      console.log(`[alarmService] 포그라운드 복귀 — 호출 기록 없음, 즉시 재폴링`);
      this.poll();
      return;
    }
    const elapsed = Date.now() - lastCall;
    const intervalMs = this.intervalSec * 1000;
    if (elapsed >= intervalMs) {
      console.log(`[alarmService] 포그라운드 복귀 — 경과 ${Math.round(elapsed / 1000)}s ≥ ${this.intervalSec}s, 즉시 재폴링`);
      this.poll();
    } else {
      const remainingMs = intervalMs - elapsed;
      console.log(`[alarmService] 포그라운드 복귀 — interval 미달(경과 ${Math.round(elapsed / 1000)}s/${this.intervalSec}s), ${Math.round(remainingMs / 1000)}s 후 재시도로 예약`);
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
    console.log(`[포그라운드] poll() 진입 — id:${idForLog} skipActiveCheck:${skipActiveCheck} AppState:${AppState.currentState} polling:${this.polling} status:${this.status}`);
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
      console.log(`[포그라운드] poll 이미 진행 중 — skip`);
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
      console.log(`[포그라운드] poll() 방어선 — key:${activeKey} 활성 추적 대상 아님(NEARDEST 등) — 낡은 타이머로 인한 호출 차단`);
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
      console.log(`[포그라운드] GPS 위치 획득 실패 — id:${id}`, e);
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
      console.log(`[포그라운드] 최근 ${DUPLICATE_CALL_GUARD_MS / 1000}초 내 이미 호출됨(다른 드라이버) — 중복 스킵 journeyId:${this.target.journeyId} (다음 interval:${this.intervalSec}s)`);
      this.scheduleNextPoll();
      return;
    }
    console.log(`[포그라운드] /location 호출 — journeyId:${this.target.journeyId} (${lat.toFixed(5)}, ${lng.toFixed(5)}) interval:${this.intervalSec}s`);
    // 2026-08-14(버그3/8): 백그라운드 헤드리스 틱과 동일하게, 호출 시도 시점에 바로 기록한다(성공
    // 여부와 무관 — 실패해도 다음 tick에서 바로 재시도하지 않도록). AlarmManager.resumeAll()이
    // 포그라운드 복귀 시 이 값 기준으로 "경과 시간"을 계산해 불필요한 중복 호출을 막는다.
    setLastCallTime(key, Date.now()).catch(() => {});
    const token = getToken();
    if (!token) { console.log(`[포그라운드] 토큰 없음 — journeyId:${this.target.journeyId} 호출 스킵`); this.scheduleNextPoll(); return; }
    try {
      // 2026-08-14(재검토 발견): 예전엔 fetch 기반 journeysApi.updateLocation()을 썼는데, 이 poll()
      // 타이머가 하필 백그라운드 전환 직전에 발동하면(실기기로 재현 — 그룹 알람 테스트 중 응답이
      // 4분 뒤 포그라운드 복귀 시점에야 도착) 응답이 무한 대기했다. patchLocation()은 이미 같은
      // 문제(JS setTimeout 기반 타임아웃이 백그라운드에서 제때 안 먹힘, docs/history/
      // resolved-bugs.md 2026-08-13 참고)를 XMLHttpRequest.timeout(네이티브 레벨 타임아웃)으로
      // 해결한 검증된 경로라 — 포그라운드 경로도 여기에 통일해서 같은 보호를 받게 한다.
      const res = await patchLocation(`/api/journeys/${this.target.journeyId}/location`, token, lat, lng);
      if (!res.data) { console.log(`[포그라운드] /location 응답 data 없음 — journeyId:${this.target.journeyId}`); return; }
      const { journey_status, preparation_time, interval, which_station, departure_alarm_time } = res.data;
      console.log(`[포그라운드] /location 응답 — journeyId:${this.target.journeyId} status:${journey_status} interval:${interval} which_station:${which_station} departure_alarm_time:${departure_alarm_time}`);
      if (interval !== null) {
        const effectiveInterval = DEBUG_FORCE_INTERVAL_SEC ?? interval;
        console.log(`[포그라운드] interval 갱신 — journeyId:${this.target!.journeyId} ${this.intervalSec}s → ${effectiveInterval}s${DEBUG_FORCE_INTERVAL_SEC != null ? `(서버값 ${interval}s 무시, 테스트 강제)` : ''}`);
        this.intervalSec = effectiveInterval;
        const key = `j_${this.target!.journeyId}`;
        setDesiredInterval(key, effectiveInterval).catch(() => {});
      }
      // 2026-08-14: 등록 시점 대신 실제 호출 성공 시점에 "다음 호출까지 약 N초"를 알려준다
      // (backgroundLocationTask.ts와 동일한 원칙 — 사용자 피드백으로 등록 이벤트 알림 제거).
      // 2026-08-14(사용자 요청): 서버가 실제로 준 값도 함께 보여준다(interval: 서버값 →
      // 적용값초) — DEBUG_FORCE_INTERVAL_SEC로 강제 중일 때 서버 원본값을 가리지 않기 위함.
      sendDebugNotification('GPS 호출 완료(포그라운드)', `journeyId:${this.target!.journeyId} status:${journey_status} interval: ${interval != null ? interval : '유지'} → ${this.intervalSec}초`).catch(() => {});
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
    const key = `a_${this.target.appointmentId}`;
    // 2026-08-14(버그3/8, 재발 수정): pollPersonal과 동일한 중복 호출 가드 — 위 주석 참고.
    const recentCall = await getLastCallTime(key);
    if (recentCall > 0 && Date.now() - recentCall < DUPLICATE_CALL_GUARD_MS) {
      const desired = await getDesiredInterval(key);
      if (desired != null) this.intervalSec = desired;
      console.log(`[포그라운드] 최근 ${DUPLICATE_CALL_GUARD_MS / 1000}초 내 이미 호출됨(다른 드라이버) — 중복 스킵 appointmentId:${this.target.appointmentId} (다음 interval:${this.intervalSec}s)`);
      this.scheduleNextPoll();
      return;
    }
    console.log(`[포그라운드] /location 호출 — appointmentId:${this.target.appointmentId} (${lat.toFixed(5)}, ${lng.toFixed(5)}) interval:${this.intervalSec}s`);
    // 2026-08-14(버그3/8): pollPersonal과 동일 — 호출 시도 시점에 바로 기록(성공 여부 무관).
    setLastCallTime(key, Date.now()).catch(() => {});
    const token = getToken();
    if (!token) { console.log(`[포그라운드] 토큰 없음 — appointmentId:${this.target.appointmentId} 호출 스킵`); this.scheduleNextPoll(); return; }
    try {
      // 2026-08-14(재검토 발견): pollPersonal과 동일 — fetch 기반 대신 네이티브 레벨 타임아웃을
      // 쓰는 patchLocation()으로 통일(위 pollPersonal의 상세 주석 참고).
      const res = await patchLocation(`/api/appointments/${this.target.appointmentId}/participants/location`, token, lat, lng);
      if (!res.data) { console.log(`[포그라운드] /location 응답 data 없음 — appointmentId:${this.target.appointmentId}`); return; }
      const { participant_status, appointment_status, estimated_arrival, preparation_time, interval, which_station, departure_alarm_time } = res.data;
      console.log(`[포그라운드] /location 응답 — appointmentId:${this.target.appointmentId} participantStatus:${participant_status} appointmentStatus:${appointment_status} interval:${interval} which_station:${which_station} departure_alarm_time:${departure_alarm_time}`);
      useAppointmentStatusStore.getState().setStatus(this.target.appointmentId, appointment_status);
      if (interval !== null) {
        const effectiveInterval = DEBUG_FORCE_INTERVAL_SEC ?? interval;
        console.log(`[포그라운드] interval 갱신 — appointmentId:${this.target!.appointmentId} ${this.intervalSec}s → ${effectiveInterval}s${DEBUG_FORCE_INTERVAL_SEC != null ? `(서버값 ${interval}s 무시, 테스트 강제)` : ''}`);
        this.intervalSec = effectiveInterval;
        const key = `a_${this.target!.appointmentId}`;
        setDesiredInterval(key, effectiveInterval).catch(() => {});
      }
      sendDebugNotification('GPS 호출 완료(포그라운드)', `appointmentId:${this.target!.appointmentId} status:${participant_status} interval: ${interval != null ? interval : '유지'} → ${this.intervalSec}초`).catch(() => {});
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
    console.log(`[AlarmManager.start] 진입 — key:${k} type:${target.alarmType}`);
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
        .then(() => console.log(`[AlarmManager.start] addActiveId 완료 — key:${k}`))
        .catch((e) => console.log(`[AlarmManager.start] addActiveId 실패 — key:${k}`, e));
      console.log(`[AlarmManager.start] runners 등록 — key:${k} 총:${this.runners.size}개`);
      await runner.start(effectiveTarget);
      console.log(`[AlarmManager.start] runner.start() 완료 — key:${k}`);
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

  // 백그라운드에서 서버가 새 interval을 줘도 AlarmRunner.intervalSec는 메모리 값이라(마지막
  // 자기가 직접 poll했을 때 값에 머묾) 자동으로 안 따라온다 — 방치하면 포그라운드 복귀 후에도
  // 낡은 페이스로 다음 poll까지 기다리는 gap이 생긴다(2026-08-14, 버그3/8 — 포그라운드/
  // 백그라운드가 하나의 연속된 interval을 공유해야 한다는 요구사항). 포그라운드 복귀 시 모든
  // runner에 resumeIfDue()(경과 시간 기준 재확인 — 무조건 즉시 poll하는 resumePolling()과
  // 다름, 위 AlarmRunner.resumeIfDue() 주석 참고)를 호출해 최신 상태/interval을 이어받는다.
  resumeAll(): void {
    console.log(`[AlarmManager.resumeAll] 포그라운드 복귀 — runners:${this.runners.size}개 재확인`);
    this.runners.forEach((r) => r.resumeIfDue().catch(() => {}));
  }

  // 2026-08-14(버그3/8, 재발 수정): 백그라운드 전환 시점에 _layout.tsx가 호출 — 모든 runner의
  // pollTimer를 능동적으로 정리한다(AlarmRunner.pauseTimer() 주석 참고). resumeAll()과 대칭.
  pauseAll(): void {
    console.log(`[AlarmManager.pauseAll] 백그라운드 전환 — runners:${this.runners.size}개 타이머 정리`);
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
