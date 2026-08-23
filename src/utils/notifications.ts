import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidNotificationSetting,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
  TimestampTrigger,
  TriggerType,
} from '@notifee/react-native';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { KakaoMapTransportMode } from '@/src/utils/kakaoMapDeeplink';
import { dlog } from '@/src/utils/deviceLogger';

export type AlarmStage = 1 | 2 | 3 | 4;
export type AlarmType = 'personal' | 'group' | 'home';

// 도착 예정/완료는 FCM이라 앱이 완전히 꺼진 상태에서도 OS가 직접 채널ID로 표시함 — 그래서
// 로컬 AsyncStorage 토글이 아니라 스프링(MemberSetting.arrivalExpectedSoundMode/
// arrivalCompleteSoundMode, PATCH /api/members/me/arrival-sound)이 선호도를 들고 있다가
// 발송 시점에 알맞은 채널ID를 골라 보낸다. 채널ID 문자열은 스프링 ArrivalChannel.getChannelId()
// 조합 결과와 반드시 일치해야 함 — 절대 임의로 바꾸지 말 것.
export const ARRIVAL_EXPECTED_CHANNEL_IDS: Record<ArrivalCheckSoundMode, string> = {
  sound: 'gonow-arrival-expected-sound',
  vibrate: 'gonow-arrival-expected-vibrate',
  silent: 'gonow-arrival-expected-silent',
};
export const ARRIVAL_COMPLETE_CHANNEL_IDS: Record<ArrivalCheckSoundMode, string> = {
  sound: 'gonow-arrival-complete-sound',
  vibrate: 'gonow-arrival-complete-vibrate',
  silent: 'gonow-arrival-complete-silent',
};
export const CHANNEL_SILENT = 'gonow-silent';
// GPS 호출/FGS 켜짐·꺼짐 등 임시 디버그 알림(sendDebugNotification) 전용 채널 — 도착
// 여부 확인(소리)과 같은 arrived.wav를 쓰면 실기기 테스트 중 둘이 구분이 안 돼서 분리함.
// 완전 무음(소리/진동 없음, 팝업만 뜸) — 실제 도착 알람 테스트 중 방해되지 않게. 사용자에게
// 노출될 일도 없는 개발용 채널(TODO 삭제 예정과 함께 제거될 것). 채널ID를 'gonow-debug'에서
// 바꾼 이유: 기존 채널이 이미 sound:'default'로 생성된 적 있어서(안드로이드 채널 불변
// 특성상) 같은 ID로는 무음으로 못 바꿈 — 새 ID를 발급해야 새 설정이 적용됨.
const DEBUG_CHANNEL_ID = 'gonow-debug-silent';

// 채널 목록을 세션 중 한 번만 실제로 생성하기 위한 플래그. ensureChannels()는 알람을
// 보낼 때마다(하루 여러 번) 호출되는데, notifee.createChannel()이 이미 존재하는
// 채널엔 no-op이라도 매번 네이티브 브리지를 여러 번 왕복하는 건 낭비라 이 플래그로 건너뜀.
let channelsEnsured = false;

// 단계별 알람 trigger ID AsyncStorage 키 — journeyId/appointmentId 기준으로 저장
const TRIGGER_IDS_KEY = 'gonow_trigger_ids'; // Record<'j_N' | 'a_N', string[]>

async function saveTriggerIds(key: string, ids: string[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TRIGGER_IDS_KEY);
    const map: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    map[key] = [...(map[key] ?? []), ...ids];
    await AsyncStorage.setItem(TRIGGER_IDS_KEY, JSON.stringify(map));
    dlog('NEARDEST', `[trigger] 저장 완료 — key:${key} ids:${ids}`);
  } catch {}
}

export async function cancelStagedAlarms(key: string): Promise<void> {
  return cancelAndRemoveTriggerIds(key);
}

async function cancelAndRemoveTriggerIds(key: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TRIGGER_IDS_KEY);
    if (raw) {
      const map: Record<string, string[]> = JSON.parse(raw);
      const ids = map[key] ?? [];
      dlog('NEARDEST', `[trigger] 취소 시도 — key:${key} ids:${ids}`);
      await Promise.all(ids.map(id => notifee.cancelTriggerNotification(id).catch(() => {})));
      delete map[key];
      await AsyncStorage.setItem(TRIGGER_IDS_KEY, JSON.stringify(map));
      dlog('NEARDEST', `[trigger] 취소 완료 — key:${key}`);
    } else {
      dlog('NEARDEST', `[trigger] 취소 시도 — key:${key} AsyncStorage 없음`);
    }
  } catch {}
  // 트리거를 취소하는 시점엔 그 지문(fingerprint)도 항상 무효화 — syncStagedAlarms()가
  // 재등록 직전에 호출하는 경우엔 바로 뒤에서 새 지문을 다시 씀, 완전히 정리하는
  // 경우(MOVING/ARRIVED/stop())엔 다음 등록 때 "기록 없음"으로 자연스럽게 처리됨
  await clearStagingFingerprint(key);
}

// 단계별 알람 "스테이징 지문" — departureAlarmTime+whichStation 조합을 기억해뒀다가 동일하면
// 재등록을 건너뜀. 포그라운드(alarmService.ts)와 백그라운드(backgroundLocationTask.ts)가 각자
// 독립적으로 취소·재등록을 반복하며 중복 발송/메시지 고착을 일으키던 문제의 근본 수정 — 두 경로가
// 이 AsyncStorage 기반 지문 하나를 공유해서 "이미 이 데이터로 등록했는지"를 판단함(syncStagedAlarms 참고).
const STAGING_FINGERPRINT_KEY = 'gonow_staging_fingerprint'; // Record<key, { departureAlarmTime, whichStation }>

type StagingFingerprint = { departureAlarmTime: string; whichStation: string | null };

// DEPARTING/NEARDEST 구간에서는 매 폴링(짧으면 10~30초 간격)마다 syncStagedAlarms()가 이
// 지문을 읽는데, 대부분 "변경 없음, 스킵"으로 끝나면서도 매번 AsyncStorage를 다시 읽는 건
// 낭비라 메모리에 캐싱해둠. 반환된 객체를 직접 수정하고
// 그대로 AsyncStorage에 저장하면(참조 공유) 캐시도 같이 최신 상태로 유지됨.
let stagingFingerprintCache: Record<string, StagingFingerprint> | null = null;

async function loadStagingFingerprints(): Promise<Record<string, StagingFingerprint>> {
  if (stagingFingerprintCache) return stagingFingerprintCache;
  try {
    const raw = await AsyncStorage.getItem(STAGING_FINGERPRINT_KEY);
    stagingFingerprintCache = raw ? JSON.parse(raw) : {};
  } catch {
    stagingFingerprintCache = {};
  }
  return stagingFingerprintCache!;
}

async function clearStagingFingerprint(key: string): Promise<void> {
  try {
    const map = await loadStagingFingerprints();
    if (!(key in map)) return;
    delete map[key];
    await AsyncStorage.setItem(STAGING_FINGERPRINT_KEY, JSON.stringify(map));
  } catch {}
}

// 백그라운드 이벤트 핸들러 (모듈 레벨 등록 필수)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;
    const notifId = detail.notification?.id;
    const data = detail.notification?.data;

    if (notifId) await notifee.cancelNotification(notifId);

    const journeyId = data?.journeyId ? Number(data.journeyId) : undefined;
    const appointmentId = data?.appointmentId ? Number(data.appointmentId) : undefined;
    const storageKey = journeyId != null ? `j_${journeyId}` : appointmentId != null ? `a_${appointmentId}` : null;

    if (actionId === 'dismiss' && storageKey) {
      // X 버튼 — 남은 단계별 알람 취소
      await cancelAndRemoveTriggerIds(storageKey);
    }

    if (actionId === 'arrival-yes') {
      dlog('NEARDEST', `도착확인 YES버튼(백그라운드) — key:${storageKey}`);
      if (storageKey) {
        await cancelAndRemoveTriggerIds(storageKey);
        // 아직 EXIT 콜백이 안 뜬 상태(100m 안)로 도착 확인을 누른 경우, 지오펜스 region이
        // 정리 안 된 채 남을 수 있어 여기서도 명시적으로 정리 — 정상 플로우에서 흔히 일어남
        const { exitNearDestGeofenceMode } = await import('@/src/tasks/nearDestGeofenceTask');
        await exitNearDestGeofenceMode(storageKey).catch(() => {});
      }
      if (data?.journeyId) {
        const { createJourneysApi } = await import('@/src/api/journeys');
        await createJourneysApi().arrive(Number(data.journeyId));
      }
      if (data?.appointmentId) {
        const { createAppointmentsApi } = await import('@/src/api/appointments');
        await createAppointmentsApi().arriveParticipant(Number(data.appointmentId));
      }
      // 포그라운드 경로(alarmService.stop())와 달리 여기는 alarmService의 인메모리 러너 목록에
      // 기대면 안 된다 — 앱이 완전 종료된 헤드리스 컨텍스트에서는 그 목록이 항상 비어있는
      // 새 인스턴스라, "다른 알람 없음"으로 잘못 판단해 FGS를 오판할 위험이 있다. 대신
      // backgroundLocationTask.ts가 이미 쓰는 영속 저장소(ALARM_NAV_INFO_KEY) 기준 판단을
      // 그대로 재사용한다 — 이 알람을 지우고, 남은 알람이 없을 때만 FGS를 끈다.
      if (storageKey) {
        // 프로세스가 살아있는 경우(스와이프만 하고 완전 종료는 아니었던 경우 — 2026-08-17
        // 실기기로 확인된 대로 흔한 케이스) alarmService의 러너가 좀비로 메모리에 남는 것을
        // 방지 — FGS는 위에서 이미 별도로 정리하므로 onFinish(중복 재확인) 없이 순수하게
        // 메모리에서만 지운다. 진짜 헤드리스면 러너가 애초에 없어 조용히 no-op.
        const { alarmService } = await import('@/src/services/alarmService');
        alarmService.forgetIfExists(journeyId, appointmentId);
        const { removeOrParkAlarmNavInfo, hasAnyTrackedAlarm, stopAlarmForegroundService } = await import('@/src/tasks/backgroundLocationTask');
        // 반복 여정이면 nav info를 지우지 않고 다음 회차까지 파킹한다(버그45) — 삭제가 아니라
        // ARRIVED 의미이므로 항상 지우던 기존 동작은 반복 알람의 FGS를 여기서도 꺼뜨렸었다.
        const parked = await removeOrParkAlarmNavInfo(storageKey);
        if (parked) {
          dlog('NEARDEST', `key:${storageKey} 도착 처리 완료 — 반복 여정, 다음 회차까지 nav info 파킹(버그45) → FGS 유지`);
        } else if (await hasAnyTrackedAlarm()) {
          dlog('NEARDEST', `key:${storageKey} 도착 처리 완료 — 남은 알람 있어 FGS 유지`);
        } else {
          await stopAlarmForegroundService();
          dlog('NEARDEST', `key:${storageKey} 도착 처리 완료 — 남은 알람 없어 FGS 종료`);
        }
      }
    }

    if (actionId === 'navigate' && data?.destLat && data?.destLng && data?.transportMode) {
      const { openKakaoMapRoute } = await import('@/src/utils/kakaoMapDeeplink');
      await openKakaoMapRoute(
        { lat: Number(data.destLat), lng: Number(data.destLng) },
        data.transportMode as KakaoMapTransportMode,
      );
    }
  }
});

const STAGE_CONFIG = {
  1: { title: '🟢 여유 구간' },
  2: { title: '🟡 주의 구간' },
  3: { title: '🟠 위험 구간' },
  4: { title: '🔴 임계 구간' },
};

// 1~3단계를 건너뛰고 4단계가 바로 발송되는("이미 늦음") 경우 전용 제목.
// "임계 구간"은 1→2→3을 거쳐 마지막 단계에 도달했다는 뉘앙스라 스킵된 경우엔 안 맞음 —
// 색(🔴)은 여전히 가장 급한 상황이라 유지, 문구만 "이미 늦었다"는 사실 위주로 교체.
const LATE_STAGE4_TITLE = '🔴 지각 구간';

const TYPE_NAMES = { personal: '개인', group: '그룹', home: '귀가' };

const STAGE_MESSAGES: Record<AlarmType, Record<AlarmStage, string>> = {
  personal: {
    1: '출발 준비를 시작하세요. 아직 여유가 있어요.',
    2: '슬슬 준비하세요. 출발 시간이 다가오고 있어요!',
    3: '지금 바로 출발하세요! 늦어지고 있어요.',
    4: '즉시 출발! 더 늦으면 목적지 도착이 어렵습니다!',
  },
  group: {
    1: '그룹 약속 출발 준비를 시작하세요.',
    2: '그룹원들이 기다리고 있어요. 슬슬 준비하세요!',
    3: '지금 바로 출발하세요! 그룹 약속에 늦고 있어요.',
    4: '즉시 출발! 그룹원들이 기다리고 있습니다!',
  },
  home: {
    // 3·4단계는 데드라인 모드(자가용 포함) 기준 중립 문구 — 막차 모드는 아래
    // HOME_LAST_TRAIN_MESSAGES로 교체됨(버그30 — isLastMode 무관하게 "막차"로 고정돼 있던 문제 수정)
    1: '귀가 준비를 시작하세요. 아직 여유가 있어요.',
    2: '귀가 시간이 다가오고 있어요. 준비하세요!',
    3: '지금 바로 출발하세요! 귀가가 늦어지고 있어요.',
    4: '즉시 출발! 더 늦으면 귀가가 어렵습니다!',
  },
};

// 귀가 알람이 막차 모드(isLastMode)일 때 3·4단계에 덮어쓸 문구 — 데드라인 모드는 위 STAGE_MESSAGES.home 그대로 사용
const HOME_LAST_TRAIN_MESSAGES: Partial<Record<AlarmStage, string>> = {
  3: '지금 출발하지 않으면 막차를 놓칠 수 있어요!',
  4: '즉시 출발! 막차 시간이 얼마 남지 않았어요!',
};

// 1~3단계를 건너뛰고 4단계가 바로 발송되는("이미 출발 시각이 지남") 경우 전용 문구.
// 정상적으로 3단계까지 거쳐 4단계에 도달한 경우와 달리, 사용자가 지금까지의 경고를 하나도
// 못 봤을 가능성이 높아 "더 늦으면"이 아니라 "이미 지났다"는 사실을 명확히 알려야 함.
const LATE_STAGE4_MESSAGES: Record<AlarmType, string> = {
  personal: '이미 출발 시각이 지났어요! 지금 바로 출발하세요.',
  group: '이미 출발 시각이 지났어요! 그룹원들이 기다리고 있어요, 지금 바로 출발하세요.',
  home: '이미 출발 시각이 지났어요! 지금 바로 출발하세요.',
};
const LATE_HOME_LAST_TRAIN_MESSAGE = '이미 출발 시각이 지났어요! 막차를 놓쳤을 수 있어요, 지금 바로 출발하세요.';

const ARRIVAL_SOUND_RAW_NAME = 'arrived';

// 도착 여부 확인은 100% 로컬 트리거(지오펜싱 태스크가 직접 호출)라 OS 채널 설정 화면 대신
// 앱 자체 소리/진동/무음 3-way 토글로 대체함 — MediaStore 등록(버그27) 없이 번들 raw
// 사운드만으로 충분함(어차피 OS "직접 설정" 화면으로 안 보낼 거라 시스템 사운드 목록에
// 노출시킬 필요가 없고, 그만큼 사용자가 실수로 지울 위험도 없음). 채널 3개를 미리 다 만들어
// 두고 실제 발송 시점에 저장된 모드에 맞는 채널ID만 골라 쓰는 방식 — 안드로이드 채널은
// 한 번 만들면 sound/vibration을 다시 못 바꾸므로, "바뀔 필요 없는" 채널 3개를 준비해두는 것.
export type ArrivalCheckSoundMode = 'sound' | 'vibrate' | 'silent';
const ARRIVAL_CHECK_CHANNEL_IDS: Record<ArrivalCheckSoundMode, string> = {
  sound: 'gonow-arrival-check-sound',
  vibrate: 'gonow-arrival-check-vibrate',
  silent: 'gonow-arrival-check-silent',
};
const ARRIVAL_CHECK_MODE_KEY = 'gonow_arrival_check_sound_mode';
const DEFAULT_ARRIVAL_CHECK_MODE: ArrivalCheckSoundMode = 'sound';

export async function getArrivalCheckSoundMode(): Promise<ArrivalCheckSoundMode> {
  try {
    const raw = await AsyncStorage.getItem(ARRIVAL_CHECK_MODE_KEY);
    if (raw === 'sound' || raw === 'vibrate' || raw === 'silent') return raw;
    dlog('NEARDEST', `[도착여부확인 소리] getArrivalCheckSoundMode — 저장된 값 없음/비정상값(raw:${raw}) → 기본값(${DEFAULT_ARRIVAL_CHECK_MODE}) 사용`);
  } catch (e) {
    dlog('NEARDEST', `[도착여부확인 소리] getArrivalCheckSoundMode 읽기 실패 ${e} → 기본값(${DEFAULT_ARRIVAL_CHECK_MODE}) 사용`);
  }
  return DEFAULT_ARRIVAL_CHECK_MODE;
}

export async function setArrivalCheckSoundMode(mode: ArrivalCheckSoundMode): Promise<void> {
  dlog('NEARDEST', `[도착여부확인 소리] setArrivalCheckSoundMode — mode:${mode}`);
  await AsyncStorage.setItem(ARRIVAL_CHECK_MODE_KEY, mode);
}

// 출발 알람(1~4단계)도 도착 여부 확인과 동일한 이유(100% 로컬 트리거)로 OS 채널 설정 화면
// 대신 앱 자체 소리/진동/무음 토글로 대체 — 단계마다 독립된 값을 저장해서 예를 들어
// 4단계만 소리 켜두고 나머지는 무음으로 두는 것도 가능함.
export type DepartureSoundMode = 'sound' | 'vibrate' | 'silent';
const DEPARTURE_MODE_KEY_PREFIX = 'gonow_departure_sound_mode_';
const DEFAULT_DEPARTURE_MODE: DepartureSoundMode = 'sound';

const DEPARTURE_CHANNEL_IDS: Record<AlarmStage, Record<DepartureSoundMode, string>> = {
  1: { sound: 'gonow-alarm-1-sound', vibrate: 'gonow-alarm-1-vibrate', silent: 'gonow-alarm-1-silent' },
  2: { sound: 'gonow-alarm-2-sound', vibrate: 'gonow-alarm-2-vibrate', silent: 'gonow-alarm-2-silent' },
  3: { sound: 'gonow-alarm-3-sound', vibrate: 'gonow-alarm-3-vibrate', silent: 'gonow-alarm-3-silent' },
  4: { sound: 'gonow-alarm-4-sound', vibrate: 'gonow-alarm-4-vibrate', silent: 'gonow-alarm-4-silent' },
};

// "소리" 모드 채널의 진동 패턴/LED 색 — "진동" 모드도 소리만 빼고 같은 패턴을 재사용함
// (1단계는 원래 무진동이라 패턴이 없어서, 진동 모드 전용으로 부드러운 패턴을 하나 지정)
const DEPARTURE_STAGE_CONFIG: Record<AlarmStage, { vibrationPattern?: number[]; lightColor?: string }> = {
  1: {},
  2: { vibrationPattern: [100, 250, 250, 250], lightColor: '#30D158' },
  3: { vibrationPattern: [100, 500, 200, 500, 200, 500], lightColor: '#E74C3C' },
  4: { vibrationPattern: [100, 500, 200, 500, 200, 500], lightColor: '#E74C3C' },
};
const DEPARTURE_STAGE1_VIBRATE_PATTERN = [100, 250, 250, 250];

export async function getDepartureSoundMode(stage: AlarmStage): Promise<DepartureSoundMode> {
  try {
    const raw = await AsyncStorage.getItem(`${DEPARTURE_MODE_KEY_PREFIX}${stage}`);
    if (raw === 'sound' || raw === 'vibrate' || raw === 'silent') return raw;
  } catch {}
  return DEFAULT_DEPARTURE_MODE;
}

export async function setDepartureSoundMode(stage: AlarmStage, mode: DepartureSoundMode): Promise<void> {
  await AsyncStorage.setItem(`${DEPARTURE_MODE_KEY_PREFIX}${stage}`, mode);
}

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (channelsEnsured) return;

  const STAGE_NAMES: Record<AlarmStage, string> = { 1: '1단계', 2: '2단계', 3: '3단계', 4: '4단계' };
  const departureChannelPromises = ([1, 2, 3, 4] as AlarmStage[]).flatMap((stage) => {
    const cfg = DEPARTURE_STAGE_CONFIG[stage];
    return [
      // 앱 내 토글로만 고르므로(OS 설정 화면 노출 없음) MediaStore 등록(ensureChannelWithCustomSound)
      // 불필요 — 번들 raw 사운드만으로 충분(파일관리자 노출/실수 삭제 위험도 없앰)
      notifee.createChannel({
        id: DEPARTURE_CHANNEL_IDS[stage].sound,
        name: `GoNow 알람 (${STAGE_NAMES[stage]}·소리)`,
        importance: AndroidImportance.HIGH,
        sound: `stage${stage}`,
        vibration: !!cfg.vibrationPattern,
        ...(cfg.vibrationPattern && { vibrationPattern: cfg.vibrationPattern }),
        ...(cfg.lightColor && { lights: true, lightColor: cfg.lightColor }),
      }),
      notifee.createChannel({
        id: DEPARTURE_CHANNEL_IDS[stage].vibrate,
        name: `GoNow 알람 (${STAGE_NAMES[stage]}·진동)`,
        importance: AndroidImportance.HIGH,
        vibration: true,
        vibrationPattern: cfg.vibrationPattern ?? DEPARTURE_STAGE1_VIBRATE_PATTERN,
      }),
      notifee.createChannel({
        id: DEPARTURE_CHANNEL_IDS[stage].silent,
        name: `GoNow 알람 (${STAGE_NAMES[stage]}·무음)`,
        importance: AndroidImportance.HIGH,
        vibration: false,
      }),
    ];
  });

  await Promise.all([
    ...departureChannelPromises,

    notifee.createChannel({
      id: ARRIVAL_CHECK_CHANNEL_IDS.sound,
      name: 'GoNow 도착 여부 확인 (소리)',
      importance: AndroidImportance.HIGH,
      sound: ARRIVAL_SOUND_RAW_NAME,
      vibration: true,
    }),
    notifee.createChannel({
      id: ARRIVAL_CHECK_CHANNEL_IDS.vibrate,
      name: 'GoNow 도착 여부 확인 (진동)',
      importance: AndroidImportance.HIGH,
      vibration: true,
    }),
    notifee.createChannel({
      id: ARRIVAL_CHECK_CHANNEL_IDS.silent,
      name: 'GoNow 도착 여부 확인 (무음)',
      importance: AndroidImportance.HIGH,
      vibration: false,
    }),

    notifee.createChannel({
      id: ARRIVAL_EXPECTED_CHANNEL_IDS.sound,
      name: 'GoNow 도착 예정 알림 (소리)',
      importance: AndroidImportance.HIGH,
      sound: ARRIVAL_SOUND_RAW_NAME,
      vibration: true,
    }),
    notifee.createChannel({
      id: ARRIVAL_EXPECTED_CHANNEL_IDS.vibrate,
      name: 'GoNow 도착 예정 알림 (진동)',
      importance: AndroidImportance.HIGH,
      vibration: true,
    }),
    notifee.createChannel({
      id: ARRIVAL_EXPECTED_CHANNEL_IDS.silent,
      name: 'GoNow 도착 예정 알림 (무음)',
      importance: AndroidImportance.HIGH,
      vibration: false,
    }),

    notifee.createChannel({
      id: ARRIVAL_COMPLETE_CHANNEL_IDS.sound,
      name: 'GoNow 도착 완료 알림 (소리)',
      importance: AndroidImportance.HIGH,
      sound: ARRIVAL_SOUND_RAW_NAME,
      vibration: true,
    }),
    notifee.createChannel({
      id: ARRIVAL_COMPLETE_CHANNEL_IDS.vibrate,
      name: 'GoNow 도착 완료 알림 (진동)',
      importance: AndroidImportance.HIGH,
      vibration: true,
    }),
    notifee.createChannel({
      id: ARRIVAL_COMPLETE_CHANNEL_IDS.silent,
      name: 'GoNow 도착 완료 알림 (무음)',
      importance: AndroidImportance.HIGH,
      vibration: false,
    }),

    notifee.createChannel({
      id: CHANNEL_SILENT,
      name: 'GoNow 알람 실행 중 (위치 추적)',
      importance: AndroidImportance.LOW,
      vibration: false,
    }),

    notifee.createChannel({
      id: 'gonow',
      name: 'GoNow 알람 실행 중 (알림)',
      importance: AndroidImportance.LOW,
      vibration: false,
    }),

    notifee.createChannel({
      id: DEBUG_CHANNEL_ID,
      name: 'GoNow 디버그(GPS/FGS)',
      importance: AndroidImportance.HIGH,
      vibration: false,
    }),
  ]);

  channelsEnsured = true;
}

// 팝업 없이 현재 알림 권한 상태만 확인 (PermissionSetupScreen 상태 표시용)
export async function getNotificationPermissionGranted(): Promise<boolean> {
  const settings = await notifee.getNotificationSettings();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

// 팝업 없이 현재 "정확한 알람"(Exact Alarm) 권한 상태만 확인 (PermissionSetupScreen 상태 표시용)
// Android 12 미만이면 항상 true(제약 자체가 없음)
export async function getExactAlarmGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const settings = await notifee.getNotificationSettings();
  return settings.android.alarm !== AndroidNotificationSetting.DISABLED;
}

// "앱 정보"보다 한 단계 더 들어간 "앱 알림" 설정 화면(마스터 토글 + 채널 목록)으로 바로
// 이동 — openChannelSettings()와 같은 인텐트 계열이지만 특정 채널이 아니라 앱 전체
// 알림 화면으로 감. OS 팝업이 막힌 경우, 사용자가 앱 정보에서 한 번 더 "알림" 항목을
// 찾아 들어가야 하는 수고를 덜어줌. PermissionSetupScreen.tsx의 "설정으로 이동" 버튼
// 액션으로 쓰이므로 export.
export function openAppNotificationSettings(): void {
  if (Platform.OS !== 'android') {
    Linking.openSettings().catch(() => {});
    return;
  }
  const packageName = Constants.expoConfig?.android?.package ?? 'com.hyeongwon.gonow';
  Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
    { key: 'android.provider.extra.APP_PACKAGE', value: packageName },
  ]).catch(() => {
    // 일부 기기/OS 버전에는 해당 화면이 없을 수 있음 — 앱 정보로라도 보냄
    Linking.openSettings().catch(() => {});
  });
}

const NOTIFICATION_DENIAL_COUNT_KEY = 'gonow_notification_denial_count'; // number(문자열로 저장)

export interface RequestNotificationResult {
  granted: boolean;
  // false면 안드로이드가 반복 거부로 OS 팝업 자체를 더 이상 안 띄우는 상태 — 이때는 우리가
  // 직접 안내해야 함(requestLocationAlways()의 canAskAgain과 동일한 의미로 이름을 맞춤).
  canAskAgain: boolean;
}

// OS 네이티브 권한 팝업을 요청한다. expo-location의 requestForegroundPermissionsAsync()와
// 달리 notifee.requestPermission()은 canAskAgain을 안 줘서, 팝업이 실제로 떴다가 거부된
// 것인지(자연스러운 흐름 — 뒤로가기와 다를 바 없음, 우리가 또 안내할 필요 없음) 아니면
// 반복 거부로 팝업 자체가 막혀서 조용히 거부로 돌아온 것인지(이땐 우리가 안내하지 않으면
// 사용자는 "허용하기"를 눌러도 아무 일도 안 일어나는 것처럼 보임) 결과만으로는 구분이
// 안 된다. 안드로이드는 2번 거부 후부터 팝업을 막으므로(실기기로 확인), 거부 횟수를
// AsyncStorage에 직접 세어서 같은 방식으로 판단한다 — 승인되면 리셋.
export async function requestNotificationPermission(): Promise<RequestNotificationResult> {
  const raw = await AsyncStorage.getItem(NOTIFICATION_DENIAL_COUNT_KEY);
  const priorDenials = raw ? Number(raw) : 0;
  const isAlreadyBlocked = priorDenials >= 2;

  const settings = await notifee.requestPermission();
  const granted = settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;

  if (granted) {
    await AsyncStorage.setItem(NOTIFICATION_DENIAL_COUNT_KEY, '0');
    return { granted: true, canAskAgain: true };
  }

  // 이미 막혀있던 상태였다면(반복 거부) 카운트를 더 올릴 필요 없음 — 계속 막힌 채로 유지
  if (!isAlreadyBlocked) {
    await AsyncStorage.setItem(NOTIFICATION_DENIAL_COUNT_KEY, String(priorDenials + 1));
  }

  // 채널 생성은 앱 시작 시(setupNotificationCategories) + 각 발송 함수 자체에서
  // 이미 보장되므로, 권한 확인/요청만 하는 이 함수에서 또 호출할 필요 없음
  return { granted: false, canAskAgain: !isAlreadyBlocked };
}

// 앱 시작 시 채널을 미리 만들어둬야, 사용자가 실제 알람을 한 번도 받기 전에도
// 시스템 설정의 알림 카테고리 화면에서 바로 커스터마이징할 수 있음
export function setupNotificationCategories(): void {
  ensureChannels().catch(() => {});
}

// TODO: 실기기 지오펜싱 실측 테스트 완료 후 이 함수와 모든 호출부를 삭제할 것(임시 디버그용).
// EXIT 콜백/FGS 온오프 등 백그라운드 동작을 로그 없이(폰 들고 밖에 나가서) 눈으로 확인하기 위한
// 용도. 전용 디버그 채널(DEBUG_CHANNEL_ID, 완전 무음) 사용 — 원래 시스템 기본음이었으나
// 실제 도착 알람 테스트 중 계속 같이 울려서 방해된다는 피드백으로 무음으로 변경.
export async function sendDebugNotification(title: string, body: string): Promise<void> {
  try {
    await ensureChannels();
    await notifee.displayNotification({
      title: `🧪 ${title}`,
      body,
      android: { channelId: DEBUG_CHANNEL_ID, importance: AndroidImportance.HIGH, pressAction: { id: 'default' } },
    });
  } catch {}
}

function buildAlarmBody(
  stage: AlarmStage,
  type: AlarmType,
  destination: string | undefined,
  whichStation: string | null | undefined,
  minutesRemaining: number | undefined,
  isLastMode?: boolean,
  isLate?: boolean,
): string {
  const isHomeLastTrain = type === 'home' && isLastMode;
  const stageMsg = isHomeLastTrain && HOME_LAST_TRAIN_MESSAGES[stage]
    ? HOME_LAST_TRAIN_MESSAGES[stage]!
    : STAGE_MESSAGES[type][stage];

  let message: string;
  if (whichStation && minutesRemaining != null && minutesRemaining > 0) {
    message = `${whichStation} 탑승까지 ${minutesRemaining}분 남았어요.`;
  } else if (whichStation && stage === 4) {
    message = isLate ? `이미 늦었어요! ${whichStation}으로 즉시 출발하세요!` : `${whichStation}으로 즉시 출발하세요!`;
  } else if (stage === 4 && isLate) {
    message = isHomeLastTrain ? LATE_HOME_LAST_TRAIN_MESSAGE : LATE_STAGE4_MESSAGES[type];
  } else {
    message = stageMsg;
  }
  return destination ? `[${destination}] ${message}` : message;
}

export async function sendAlarm(
  type: AlarmType,
  stage: AlarmStage,
  destination?: string,
  whichStation?: string | null,
  minutesRemaining?: number,
  journeyId?: number,
  appointmentId?: number,
): Promise<string[]> {
  await ensureChannels();
  const mode = await getDepartureSoundMode(stage);

  const config = STAGE_CONFIG[stage];
  const title = `${config.title} - ${TYPE_NAMES[type]} 알람`;
  const body = buildAlarmBody(stage, type, destination, whichStation, minutesRemaining);

  const repeatCount = stage === 4 ? 3 : 1;
  const ids: string[] = [];

  for (let i = 0; i < repeatCount; i++) {
    const id = await notifee.displayNotification({
      title,
      body: stage === 4 ? `${body} (${i + 1}/${repeatCount})` : body,
      data: {
        ...(journeyId != null && { journeyId: String(journeyId) }),
        ...(appointmentId != null && { appointmentId: String(appointmentId) }),
      },
      android: {
        channelId: DEPARTURE_CHANNEL_IDS[stage][mode],
        importance: AndroidImportance.HIGH,
        category: AndroidCategory.ALARM,
        visibility: AndroidVisibility.PUBLIC,
        // 타이머 알람 스타일: 잠금화면에서 전체화면으로 표시
        fullScreenAction: {
          id: 'default',
          launchActivity: 'default',
        },
        pressAction: { id: 'default' },
        // 1~3단계만 X 닫기 버튼
        ...(stage <= 3 && {
          actions: [
            {
              title: '✕ 이후 알림 끄기',
              pressAction: { id: 'dismiss' },
            },
          ],
        }),
      },
    });

    ids.push(id);

    if (stage === 4 && i < repeatCount - 1) {
      await new Promise<void>((res) => setTimeout(res, 2000));
    }
  }

  return ids;
}

export async function sendArrivalCheckAlarm(
  nickname: string,
  destination: string,
  journeyId?: number,
  appointmentId?: number,
): Promise<string> {
  await ensureChannels();
  const mode = await getArrivalCheckSoundMode();
  dlog('NEARDEST', `[도착여부확인 소리] sendArrivalCheckAlarm — mode:${mode} channelId:${ARRIVAL_CHECK_CHANNEL_IDS[mode]} journeyId:${journeyId} appointmentId:${appointmentId}`);
  return notifee.displayNotification({
    title: '📍 도착 확인',
    body: `${nickname}님 ${destination}에 도착하신건가요?`,
    data: {
      ...(journeyId != null && { journeyId: String(journeyId) }),
      ...(appointmentId != null && { appointmentId: String(appointmentId) }),
    },
    android: {
      channelId: ARRIVAL_CHECK_CHANNEL_IDS[mode],
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        {
          title: '예',
          pressAction: { id: 'arrival-yes', launchActivity: 'default' },
        },
        {
          title: '아니오',
          pressAction: { id: 'arrival-no' },
        },
      ],
    },
  });
}

// 실제 FCM 표시는 스프링이 보낸 채널ID(_layout.tsx의 포그라운드 핸들러)를 그대로 쓰고, 이
// 함수는 설정 화면/디버그 화면의 로컬 미리듣기 전용이라 mode를 인자로 받음(서버 동기화 X).
export async function sendArrivalConfirmAlarm(
  nickname: string,
  arrivalTime: string,
  destination: string,
  mode: ArrivalCheckSoundMode = 'sound',
): Promise<string> {
  await ensureChannels();
  return notifee.displayNotification({
    title: '✅ 도착 완료',
    body: `${nickname}님이 ${arrivalTime}에 ${destination}에 도착하였습니다.`,
    android: {
      channelId: ARRIVAL_COMPLETE_CHANNEL_IDS[mode],
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  });
}

export async function sendArrivalAlarm(
  memberName: string,
  arrivalTime: string,
  destination: string,
  mode: ArrivalCheckSoundMode = 'sound',
): Promise<void> {
  await ensureChannels();
  await notifee.displayNotification({
    title: '🏃 도착예정 알림',
    body: `${memberName}님이 ${arrivalTime}에 ${destination}에 도착 예정이에요!`,
    android: {
      channelId: ARRIVAL_EXPECTED_CHANNEL_IDS[mode],
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  });
}

export async function scheduleFutureAlarm(
  type: AlarmType,
  stage: AlarmStage,
  destination: string | undefined,
  triggerTimestamp: number,
  journeyId?: number,
  appointmentId?: number,
  whichStation?: string | null,
  minutesRemaining?: number,
  destLat?: number,
  destLng?: number,
  transportMode?: KakaoMapTransportMode,
  isLastMode?: boolean,
): Promise<string[]> {
  await ensureChannels();
  const mode = await getDepartureSoundMode(stage);
  const config = STAGE_CONFIG[stage];
  const repeatCount = stage === 4 ? 3 : 1;
  const ids: string[] = [];
  const isPast = triggerTimestamp <= Date.now();
  const titleStage = stage === 4 && isPast ? LATE_STAGE4_TITLE : config.title;
  const title = `${titleStage} - ${TYPE_NAMES[type]} 알람`;
  const body = buildAlarmBody(stage, type, destination, whichStation, minutesRemaining, isLastMode, isPast);
  // DRIVING/TRANSIT 공통 길찾기 딥링크 — 단일 딥링크 설계
  // (docs/reference/kakao-map-deeplink-spec.md §2.2~2.4 참고)
  const canNavigate = !!transportMode && destLat != null && destLng != null;
  const navigateAction = { title: '🗺️ 길찾기', pressAction: { id: 'navigate' } };

  for (let i = 0; i < repeatCount; i++) {
    const notifBody = stage === 4 ? `${body} (${i + 1}/${repeatCount})` : body;
    const notifData = {
      ...(journeyId != null && { journeyId: String(journeyId) }),
      ...(appointmentId != null && { appointmentId: String(appointmentId) }),
      ...(canNavigate && { destLat: String(destLat), destLng: String(destLng), transportMode: transportMode as string }),
    };
    const androidConfig = {
      channelId: DEPARTURE_CHANNEL_IDS[stage][mode],
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.ALARM,
      visibility: AndroidVisibility.PUBLIC,
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default' },
      ...(stage <= 3 && {
        actions: canNavigate
          ? [{ title: '✕ 이후 알림 끄기', pressAction: { id: 'dismiss' } }, navigateAction]
          : [{ title: '✕ 이후 알림 끄기', pressAction: { id: 'dismiss' } }],
      }),
      // 4단계는 원래 액션이 없었음(닫기 버튼도 없음 — 범위 밖) — 길찾기만 조건부로 추가
      ...(stage === 4 && canNavigate && { actions: [navigateAction] }),
    };

    let id: string;
    if (isPast) {
      // 과거 시각 → 즉시 발송
      if (i > 0) await new Promise<void>((res) => setTimeout(res, 2000));
      id = await notifee.displayNotification({ title, body: notifBody, data: notifData, android: androidConfig });
    } else {
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: triggerTimestamp + i * 2500 };
      id = await notifee.createTriggerNotification({ title, body: notifBody, data: notifData, android: androidConfig }, trigger);
    }
    ids.push(id);
  }

  const storageKey = journeyId != null ? `j_${journeyId}` : appointmentId != null ? `a_${appointmentId}` : null;
  if (storageKey && !isPast) await saveTriggerIds(storageKey, ids);
  return ids;
}

// 단계별 출발 알람(1~4단계)을 서버 응답 기준으로 등록/재등록. 포그라운드(alarmService.ts)와
// 백그라운드(backgroundLocationTask.ts) 양쪽에서 상태를 폴링할 때마다 호출해도 안전 —
// departureAlarmTime+whichStation이 지난번 등록과 동일하면 즉시 return하므로, 매 폴링마다
// 취소·재등록을 반복하지 않음(이게 예전 중복 발송/메시지 고착 버그의 근본 원인이었음).
const stagingLocks = new Map<string, Promise<void>>();

// 같은 key로 거의 동시에 여러 번 호출돼도(포그라운드 alarmService.ts와 백그라운드
// backgroundLocationTask.ts가 겹쳐 돌 때 실제로 발생함) 순서대로 하나씩만 처리되도록 직렬화.
// 이게 없으면 두 호출 다 "아직 안 바뀐" 예전 지문을 읽고 둘 다 재등록을 진행해 중복이 생김.
async function withStagingLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = stagingLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // 이전 호출이 실패했어도 다음 호출은 정상 진행
  stagingLocks.set(key, run.catch(() => {}));
  return run;
}

export async function syncStagedAlarms(
  key: string, // 'j_<journeyId>' | 'a_<appointmentId>'
  type: AlarmType,
  destination: string | undefined,
  journeyId: number | undefined,
  appointmentId: number | undefined,
  preparationTime: number,
  whichStation: string | null | undefined,
  departureAlarmTime: string | null | undefined,
  destLat?: number,
  destLng?: number,
  transportMode?: KakaoMapTransportMode,
  isLastMode?: boolean,
): Promise<void> {
  if (!departureAlarmTime) return;

  return withStagingLock(key, async () => {
    const map = await loadStagingFingerprints();
    const prev = map[key];
    // 서버는 이번 폴링에서 플라스크를 실제로 재호출했을 때만 whichStation을 채워서
    // 내려주고, DEPARTING 유지처럼 재계산이 필요 없는 폴링에서는 무조건 null을 돌려줌
    // (JourneyService.updateLocation()의 DEPARTING-유지 분기, ParticipantService도 동일) —
    // 즉 null은 "역 정보가 사라졌다"가 아니라 "이번엔 새로 알려줄 게 없다"는 뜻. 이전에
    // 알던 값을 그대로 유지해야 이 null↔값 흔들림을 진짜 변경으로 오판해서 재등록(및
    // 재발송)을 반복하지 않음 — 이게 "한참 지난 후 4단계가 다시 울리는" 버그의 진짜 원인이었음.
    const normalizedStation = whichStation ?? prev?.whichStation ?? null;
    if (prev && prev.departureAlarmTime === departureAlarmTime && prev.whichStation === normalizedStation) {
      dlog('NEARDEST', `[알람] syncStagedAlarms — key:${key} 지문 동일, 재등록 스킵`);
      return;
    }

    // 기존 등록분 취소를 끝까지 기다린 뒤(같은 TRIGGER_IDS_KEY에 대한 경합 방지) 새 지문을 씀
    await cancelStagedAlarms(key);
    map[key] = { departureAlarmTime, whichStation: normalizedStation };
    await AsyncStorage.setItem(STAGING_FINGERPRINT_KEY, JSON.stringify(map));

    const stepMs = preparationTime * 60 * 1000 * 0.25;
    const alarmBase = new Date(departureAlarmTime).getTime();
    const stepTimes = [alarmBase, alarmBase + stepMs, alarmBase + stepMs * 2, alarmBase + stepMs * 3];
    const now = Date.now();

    // 각 단계에서 표시할 분: 1단계=100%, 2단계=75%, 3단계=50%, 4단계=25%
    const ratios = [1.0, 0.75, 0.5, 0.25];
    const mins = (idx: number) =>
      normalizedStation ? Math.max(0, Math.round(preparationTime * ratios[idx])) : undefined;

    // 현재 시각 기준으로 시작 단계 결정 — 아직 안 지난 첫 번째 단계부터 시작
    // 모든 단계가 지났으면 4단계(idx=3) 즉시 발송
    const foundIdx = stepTimes.findIndex((t) => now < t);
    const startIdx = foundIdx === -1 ? 3 : foundIdx;

    dlog('NEARDEST', `[알람] key:${key} ${startIdx + 1}단계부터 예약 — 1단계:${new Date(stepTimes[0]).toLocaleTimeString('ko-KR', { hour12: false })} 2단계:${new Date(stepTimes[1]).toLocaleTimeString('ko-KR', { hour12: false })} 3단계:${new Date(stepTimes[2]).toLocaleTimeString('ko-KR', { hour12: false })} 4단계:${new Date(stepTimes[3]).toLocaleTimeString('ko-KR', { hour12: false })} whichStation:${normalizedStation}`);

    try {
      const allIds: string[] = [];
      for (let i = startIdx; i < 4; i++) {
        const stage = (i + 1) as 1 | 2 | 3 | 4;
        // 4단계(i=3)이고 시각이 이미 지났으면 minutesRemaining=0 → 긴급 문구 표시
        const minutesRemaining = (i === 3 && now >= stepTimes[3]) ? 0 : mins(i);
        const ids = await scheduleFutureAlarm(type, stage, destination, stepTimes[i], journeyId, appointmentId, normalizedStation, minutesRemaining, destLat, destLng, transportMode, isLastMode);
        allIds.push(...ids);
      }
      dlog('NEARDEST', `[알람] syncStagedAlarms 등록 완료 — key:${key} ids:${allIds}`);
    } catch (e) {
      dlog('NEARDEST', `[알람] syncStagedAlarms 등록 실패 ${e}`);
    }
  });
}

// 서버 에러 응답 바디(JSON)에서 사용자에게 보여줄 메시지 추출, 실패 시 fallback
export function extractApiErrorMessage(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message;
  } catch {}
  return fallback;
}
