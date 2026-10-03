import type { EditItineraryRequest } from '@/shared/api/generated/schemas';

import type { EditorDaysItem, EditorSlot } from './itineraryEditStore';

/**
 * 편집 스토어의 `days` 를 PUT 봉투(`EditItineraryRequest`)로 조립한다 — 전체 교체(full-replace)라
 * "바뀐 것"이 아니라 "바뀐 뒤 days 전체"를 보낸다. 배열 순서가 곧 최종 슬롯 순서다(INV-U3-02).
 *
 * 슬롯은 **서버가 받는 5필드만** 픽한다(`poiId·startAt·endAt·isFixed·endsNextDay`) — 조회 응답이
 * 지고 온 읽기전용 필드(hasViolation·distanceRange·nameKo·좌표·tags…)는 서버 소유라 되돌려 보내지
 * 않는다. `startAt`/`endAt` 은 원본 그대로(표시용 절단 금지 — 초까지 보존), `endsNextDay` 도 조회값
 * 그대로 실어 HC4 자정 넘김 플래그가 소실되지 않게 한다.
 *
 * TRIP-797 · 입력을 `EditorDaysItem[]`(startAt: string | null)까지 넓히고 **미지정(startAt === null)
 * 슬롯을 요청에서 제외**한다(서버 non-nullable 계약이라 못 받음 — AC-6). 남은 슬롯 순서는 그대로다
 * (INV-U3-02 — 중간에서 빼도 앞뒤 보존). `ItineraryDaysItem[]`(startAt: string)은 이 상위집합의
 * 부분집합이라 기존 소비처(ItineraryEditPage·PlaceAddPage)는 무변경으로 컴파일된다(후방호환).
 * ⚠️ "제외됨을 사용자에게 안내"(INV-4 침묵 금지)는 순수 함수 밖의 페이지 렌더 책임이다.
 */
export function buildEditItineraryRequest(
  days: EditorDaysItem[]
): EditItineraryRequest {
  return {
    days: days.map((day) => ({
      date: day.date,
      slots: day.slots
        .filter(
          (slot): slot is EditorSlot & { startAt: string } =>
            slot.startAt !== null
        )
        .map((slot) => ({
          poiId: slot.poiId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          isFixed: slot.isFixed,
          endsNextDay: slot.endsNextDay,
        })),
    })),
  };
}
