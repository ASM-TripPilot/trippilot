import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

/**
 * AC1 (BR-U3-23 · BR-U2-04) 코어 — 일정 `days` 전체에서 대상 슬롯의 poiId 하나만 갈아 끼운다.
 *
 * `(date, poiId)` 로 대상 슬롯을 찾아 **그 슬롯의 poiId 만** 고른 후보 poiId 로 바꾸고, 시각·고정
 * 여부·이웃 슬롯·다른 일자는 한 톨도 건드리지 않은 **새** `days` 를 돌려준다(비파괴 — 시드한 GET
 * 배열을 안 바꾼다, `removeSlot`·`adjustSlotTime` 와 같은 계약). 이 결과를 `buildEditItineraryRequest`
 * 로 조립한 것이 곧 PUT 전체 교체 바디다. h12 시트·h18 화면 두 진입이 같은 이 함수를 태우므로
 * "한 오퍼레이션"이 성립한다(BR-U3-23).
 *
 * 같은 날 같은 poiId 가 둘이면 **첫 일치만** 바꾼다(`findIndex` — `removeSlot` 선례). 슬롯을 특정
 * 못 하는 경우(같은 장소 둘)의 방어는 서버 409 몫이고, 클라는 결정론적으로 첫 자리만 바꾼다.
 */
export function swapSlotPoi(
  days: ItineraryDaysItem[],
  target: { date: string; poiId: string },
  nextPoiId: string
): ItineraryDaysItem[] {
  return days.map((day) => {
    if (day.date !== target.date) return day;
    const index = day.slots.findIndex((slot) => slot.poiId === target.poiId);
    if (index === -1) return day;
    return {
      ...day,
      slots: day.slots.map((slot, i) =>
        i === index ? { ...slot, poiId: nextPoiId } : slot
      ),
    };
  });
}
