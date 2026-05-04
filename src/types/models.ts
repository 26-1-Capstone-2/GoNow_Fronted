/** API·화면에서 공통으로 쓰는 도메인 타입 (필요 시 확장) */

export type BookingDraft = {
  serviceId?: string;
  date?: string;
  slotId?: string;
  note?: string;
};
