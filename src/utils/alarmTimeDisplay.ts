// 백엔드 scheduler.day-boundary-hour 기본값(새벽 4시)과 동일 — 프론트에서 서버 설정을
// 직접 조회할 방법이 없어 CLAUDE.md 문서화된 기본값을 그대로 상수화.
const DAY_BOUNDARY_HOUR = 4;

export type AlarmTimeState =
  | 'confirmed' | 'pending_boundary' | 'pending_gps' | 'future'
  | 'departing' | 'moving' | 'neardest' | 'arrived';

export interface AlarmTimeDisplay {
  state: AlarmTimeState;
  heroText: string;
  subText: string;
}

// 카드 한 줄에 "출발 준비 시각"과 "목표 도착 시각"을 함께 넣으면 오전/오후 표기가
// 폭을 많이 잡아먹고 줄바꿈/말줄임으로 잘려서, 이 카드 안에서만 24시간제로 표기한다
// (그 외 화면은 기존 오전/오후 표기 그대로 유지).
function to24h(ampm: string, hour: string, minute: string): string {
  let h = parseInt(hour, 10) % 12;
  if (ampm === '오후') h += 12;
  return `${String(h).padStart(2, '0')}:${minute}`;
}

function to24hFromIso(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function diffDays(planDate: string, todayStr: string): number {
  const d1 = new Date(planDate + 'T00:00:00');
  const d2 = new Date(todayStr + 'T00:00:00');
  return Math.round((d1.getTime() - d2.getTime()) / 86400000);
}

/**
 * 알람 카드에 "몇 시까지 도착해야 하는지"뿐 아니라 "언제 출발 준비를 시작해야 하는지"를
 * 함께 보여주기 위한 표시 상태 계산. departureAlarmTime은 당일 READY 전환 + 첫 GPS 수신
 * 이후에야 채워지므로(CLAUDE.md "출발지 선택 정책" 참고), 그 전까지는 왜 아직 없는지
 * 구분해서 안내한다.
 */
export function getAlarmTimeDisplay(params: {
  targetAmpm: string;
  targetHour: string;
  targetMinute: string;
  // 막차 모드에서 target_time이 서버 계산 전(null)이면 false로 넘어온다 — 그 외(false를 안 넘기는
  // 모든 경우: 개인/그룹/귀가-데드라인/계산 완료된 귀가-막차)는 기본값 true로 항상 유효한 값.
  hasTargetTime?: boolean;
  departureAlarmTime: string | null;
  planDate: string; // "YYYY-MM-DD"
  isLastMode?: boolean;
  myStatus?: string;
  // 반복 알람 여부(repeat_days 존재 여부). 막차 모드의 target_time은 여정 레코드에 값이
  // 하나뿐이라(발생일별로 안 나뉨) 반복 알람이면 "오늘 계산된 값"이 미래/과거 발생일에도
  // 그대로 새어나간다 — 그래서 막차+반복 조합에서만 hasTargetTime을 오늘 카드 한정으로만
  // 신뢰한다. 비반복(막차 포함 전부)은 발생일이 하나뿐이라 언제나 신뢰해도 안전하다.
  isRepeating?: boolean;
  now?: Date;
}): AlarmTimeDisplay {
  const { targetAmpm, targetHour, targetMinute, hasTargetTime = true, departureAlarmTime, planDate, isLastMode, myStatus, isRepeating, now = new Date() } = params;
  const todayStr = toDateStr(now);
  // 막차 모드는 target_time이 채워지는 순간(=departureAlarmTime과 동시에 서버가 계산) 실제
  // 도착 목표 시각을 알 수 있으므로, 그 전까지만 "막차 기준"이라는 자리표시자를 쓴다.
  const targetTimeTrusted = isLastMode && isRepeating
    ? planDate === todayStr && hasTargetTime
    : hasTargetTime;
  const targetLabel = (isLastMode && !targetTimeTrusted)
    ? '막차 기준'
    : `목표 시각 ${to24h(targetAmpm, targetHour, targetMinute)}`;

  // 이미 지난 날짜는 여정 레코드의 실시간 상태(myStatus)를 더 신뢰할 수 없다(반복 알람이면 그
  // 값이 이후 회차로 덮어써짐) — 하지만 서버의 "지각 정리" 스케줄러가 targetTime+1시간 안에
  // 무조건 ARRIVED로 강제 전환하므로, 하루가 완전히 지난 시점엔 반복 여부와 무관하게 사실상
  // 항상 도착 완료 상태라고 봐도 안전하다. 그래서 반복 여부를 따질 필요 없이 그냥 고정 표시한다.
  if (planDate < todayStr) {
    return { state: 'arrived', heroText: '도착 완료', subText: targetLabel };
  }

  if (planDate === todayStr) {
    // READY 이후(departureAlarmTime 도달~도착)엔 카운트다운이 무의미해지므로
    // 실제 이동 상태(my_status)를 그대로 문구로 보여준다.
    if (myStatus === 'DEPARTING') {
      return { state: 'departing', heroText: '지금 출발하세요', subText: targetLabel };
    }
    if (myStatus === 'MOVING') {
      return { state: 'moving', heroText: '이동 중', subText: targetLabel };
    }
    if (myStatus === 'NEARDEST') {
      return { state: 'neardest', heroText: '곧 도착', subText: targetLabel };
    }
    if (myStatus === 'ARRIVED') {
      return { state: 'arrived', heroText: '도착 완료', subText: targetLabel };
    }

    if (departureAlarmTime) {
      return {
        state: 'confirmed',
        heroText: `준비 시작 ${to24hFromIso(departureAlarmTime)}`,
        subText: targetLabel,
      };
    }
  }

  // 목표 시각(targetLabel)은 항상 sub 자리로 통일 — hero는 "지금 무슨 상태인지"만 담당.
  if (planDate > todayStr) {
    const diff = diffDays(planDate, todayStr);
    return { state: 'future', heroText: `D-${diff}`, subText: targetLabel };
  }

  // "04:00 계산 예정"은 아직 SCHEDULED 상태라 새벽 4시 전환을 기다려야 하는 경우에만 맞는
  // 문구다. plan_date가 오늘이면 서버가 생성 시점에 바로 READY로 만들기 때문에(JourneyService
  // 생성 로직 참고), 오늘 새벽 4시 이전에 만든 알람도 이미 READY 상태일 수 있다 — 이 경우는
  // 새벽 4시를 기다리는 게 아니라 그냥 GPS 신호를 기다리는 것뿐이라 pending_gps로 내려가야 한다.
  if (planDate === todayStr && myStatus !== 'READY' && now.getHours() < DAY_BOUNDARY_HOUR) {
    return { state: 'pending_boundary', heroText: '04:00 계산 예정', subText: targetLabel };
  }

  // 막차 모드는 목적지(귀가지) 700m 이내일 때 서버가 아예 계산을 보류한다(대중교통을
  // 탈 필요가 없는 도보 권역이라 막차 탐색 자체가 무의미 — gps_api/routes/alarm.py의
  // walk_fallback 분기 참고). "출발지 확인 중"은 위치 자체를 못 잡은 것처럼 읽혀서
  // 실제 이유(목적지 근처라 계산이 안 됨)와 어긋나므로 막차 모드에서는 문구를 분리한다.
  const pendingGpsHero = isLastMode ? '이동 시 자동 계산' : '출발지 확인 중';
  return { state: 'pending_gps', heroText: pendingGpsHero, subText: targetLabel };
}
