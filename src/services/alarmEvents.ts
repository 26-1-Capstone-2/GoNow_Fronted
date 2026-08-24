// alarmService가 포그라운드 GPS 폴링 응답으로 departureAlarmTime/상태를 받을 때마다, 지금
// 떠 있는 알람 목록 화면에 네트워크 재조회 없이 그 값을 바로 알려주기 위한 초경량 로컬 이벤트
// 버스. (알람 생성 직후 "출발지 확인 중"/"이동 시 자동 계산" 문구가 실제 GPS 응답이 도착할
// 때까지 안 바뀌던 문제 — 화면은 최초 마운트 때만 조회하고 이후엔 아무도 다시 안 불러왔음.)
export type AlarmLocationUpdate = {
  journeyId?: number;
  appointmentId?: number;
  status: string;
  departureAlarmTime: string | null;
};

type Listener = (update: AlarmLocationUpdate) => void;

const listeners = new Set<Listener>();

export function emitAlarmLocationUpdate(update: AlarmLocationUpdate): void {
  listeners.forEach((listener) => listener(update));
}

export function subscribeAlarmLocationUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
