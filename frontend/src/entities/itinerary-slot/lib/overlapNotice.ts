import { VIOLATION_NOTICE, violationNotice } from './violationLabel';

type TimedSlot = {
  startAt: string | null;
  endAt: string;
  endsNextDay?: boolean;
  nameKo?: string | null;
  hasViolation: boolean;
  violationReason?: string | null;
  distanceRange?: string | null;
};

/**
 * TRIP-1505 · 편집기 카드 위반 문구 — 서버 문구가 있으면 그대로, 없어서 고정 라벨(`일정 확인이 필요해요`)로 떨어질
 * 때만 **앞 카드와 시각이 겹치는지**를 화면에 보이는 시각으로 비교해 어느 곳과 겹쳤는지 가리킨다.
 *
 * 시각은 서버 값 그대로 비교만 한다(INV-2 — 바꿔 보이지 않는다). 겹침을 막지는 않는다(저장 허용 여부는 서버 권위).
 * 앞 카드 이름이 없으면 "앞 장소"로 말한다. `HH:mm[:ss]` 앞 5자리끼리 문자열 비교(같은 날 안이라 사전순 = 시각순).
 */
export function overlapAwareNotice(
  slot: TimedSlot,
  prev: TimedSlot | undefined
): string | null {
  const notice = violationNotice(slot);
  if (notice !== null && notice !== VIOLATION_NOTICE) return notice;
  if (prev === undefined || slot.startAt === null || prev.startAt === null) {
    return notice;
  }
  // 두 구간이 겹치려면 서로의 시작이 상대 끝보다 앞이어야 한다(한쪽만 보면 순서만 바꿔도 거짓 "겹쳐요"가 뜬다).
  // 다음 날로 넘어가는 끝은 하루 끝(24:00) 너머라 어떤 시작보다 뒤로 본다.
  const prevEnd = prev.endsNextDay ? '99:99' : prev.endAt.slice(0, 5);
  const slotEnd = slot.endsNextDay ? '99:99' : slot.endAt.slice(0, 5);
  const overlaps =
    slot.startAt.slice(0, 5) < prevEnd && prev.startAt.slice(0, 5) < slotEnd;
  if (!overlaps) return notice;
  const name = prev.nameKo?.trim();
  // '시각과' — 앞말이 받침 없는 이름이어도 조사가 안 틀리게 이름을 수식어로 둔다.
  return `${name ? `‘${name}’` : '앞 장소'} 시각과 겹쳐요`;
}
