import type {
  EditItineraryRequest,
  ItineraryDaysItem,
} from '@/shared/api/generated/schemas';

/**
 * 편집 스토어의 `days` 를 PUT 봉투(`EditItineraryRequest`)로 조립한다 — 전체 교체(full-replace)라
 * "바뀐 것"이 아니라 "바뀐 뒤 days 전체"를 보낸다. 배열 순서가 곧 최종 슬롯 순서다(INV-U3-02).
 *
 * 슬롯은 **서버가 받는 5필드만** 픽한다(`poiId·startAt·endAt·isFixed·endsNextDay`) — 조회 응답이
 * 지고 온 읽기전용 필드(hasViolation·distanceRange·nameKo·좌표·tags…)는 서버 소유라 되돌려 보내지
 * 않는다. `startAt`/`endAt` 은 원본 그대로(표시용 절단 금지 — 초까지 보존), `endsNextDay` 도 조회값
 * 그대로 실어 HC4 자정 넘김 플래그가 소실되지 않게 한다.
 */
export function buildEditItineraryRequest(
  days: ItineraryDaysItem[]
): EditItineraryRequest {
  return {
    days: days.map((day) => ({
      date: day.date,
      slots: day.slots.map((slot) => ({
        poiId: slot.poiId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        isFixed: slot.isFixed,
        endsNextDay: slot.endsNextDay,
      })),
    })),
  };
}
