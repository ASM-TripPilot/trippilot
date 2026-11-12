/**
 * TRIP-1793 · 「다른 날로 옮기기」 장소 시트의 일차 칩 입력 — 일차마다 막힘 사유와 처음 선택할 날을 정한다(순수 함수, 입력 불변).
 *  - `current`: 지금 있는 날, `duplicate`: 이미 같은 장소(poiId)가 있는 날(한 날에 같은 poiId 가 둘이면 슬롯 키가 겹친다).
 *  - 처음 선택: 현재 날 **뒤쪽에서 막히지 않은 가장 가까운 날** → 없으면 **앞쪽에서 가장 가까운 날** → 없으면 null.
 */
type MoveDayBlocked = 'current' | 'duplicate' | null;

export interface MoveDayOption {
  /** 1부터 — 칩 라벨 `N일차`. */
  dayIndex: number;
  date: string;
  blocked: MoveDayBlocked;
}

export function buildMoveDayOptions(
  days: readonly { date: string; slots: readonly { poiId: string }[] }[],
  fromDate: string,
  poiId: string
): { options: MoveDayOption[]; initialDate: string | null } {
  const options = days.map((day, index): MoveDayOption => ({
    dayIndex: index + 1,
    date: day.date,
    blocked:
      day.date === fromDate
        ? 'current'
        : day.slots.some((slot) => slot.poiId === poiId)
          ? 'duplicate'
          : null,
  }));
  const from = options.findIndex((option) => option.date === fromDate);
  const open = (option: MoveDayOption): boolean => option.blocked === null;
  const after = options.slice(from + 1).find(open);
  const before = options.slice(0, Math.max(from, 0)).reverse().find(open);
  return { options, initialDate: (after ?? before)?.date ?? null };
}
