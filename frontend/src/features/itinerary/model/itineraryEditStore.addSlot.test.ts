import { addSlot } from './itineraryEditStore';
import { buildEditItineraryRequest } from './buildEditItineraryRequest';
import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-338 · AC-4 (INV-U3-02) — h20 장소 추가의 **판정/조립 층**.
 *
 * 무엇을 보장하나:
 *  - 🔴 **M1** `addSlot` 은 새 슬롯을 **배열 끝에 붙이고**(넣은 순서 = 슬롯 순서) 원본 배열을
 *    건드리지 않는다(비파괴 — `removeSlot`·`reorderKeepingFixed` 와 같은 패턴).
 *  - 🔴 **M2 (★)** 그렇게 늘린 `days` 를 **기존** `buildEditItineraryRequest` 로 조립하면 PUT 봉투의
 *    슬롯이 **정확히 5키**(`poiId·startAt·endAt·isFixed·endsNextDay`)만 담고(읽기전용 필드 제거),
 *    배열 순서가 곧 슬롯 순서다. 조립기를 **재사용**한다 — 새로 만들지 않는다.
 *
 * 왜 model 층인가: "무엇을 PUT 하나"는 순수 계산이라 화면 없이 직접 태우는 게 가장 싸고 정확하다
 * (3층 배치: 판정=model · 조립=page · 그림=screen). 실제 add→PUT 전체 플로우(SlotTimeSheet 시각
 * 입력)는 Figma 공백이라 이 사이클 심판 밖 — 이 파일이 그 조립의 정확성만 잠근다(02a §7-2).
 *
 * 3동작 뼈대: 준비=슬롯/일자 → 실행=`addSlot`/`buildEditItineraryRequest` → 단언=순서·키 집합.
 */

/** 서버 조회가 지고 오는 **읽기전용 필드까지** 채운 슬롯 — PUT 조립이 이걸 걷어내야 한다. */
function slot(poiId: string): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:30:00',
    isFixed: false,
    endsNextDay: false,
    // ↓ 서버 소유 읽기전용(PUT 봉투에 실리면 안 됨)
    hasViolation: false,
    violationReason: null,
    nameKo: '어떤 장소',
    distanceRange: '약 1.2km · 도보 추정',
    tags: ['#바다'],
  };
}

describe('🔴 M1 · AC-4 — addSlot 은 끝에 붙이고 원본을 안 건드린다 (비파괴)', () => {
  it('새 슬롯이 배열 끝으로 가고, 원본 배열은 그대로이며, 새 배열을 돌려준다', () => {
    // 준비
    const before = [slot('a')];
    const added = slot('b');

    // 실행
    const after = addSlot(before, added);

    // 단언 — 끝에 붙었다(넣은 순서 = 슬롯 순서).
    expect(after.map((s) => s.poiId)).toEqual(['a', 'b']);
    // 비파괴 — 원본은 안 바뀐다(시드한 GET 배열을 건드리지 않기 위함).
    expect(before.map((s) => s.poiId)).toEqual(['a']);
    // 항상 새 배열(캐시가 소유한 배열을 제자리 변형하지 않음).
    expect(after).not.toBe(before);
  });
});

describe('🔴 M2 · AC-4 (★) — 늘린 days → buildEditItineraryRequest 가 슬롯당 정확히 5키·순서 보존', () => {
  it('PUT 봉투 슬롯이 5키만 담고(읽기전용 제거) 넣은 순서로 실린다', () => {
    // 준비 — 기존 슬롯 a 옆에 b 를 추가한 하루.
    const days: ItineraryDaysItem[] = [
      { date: '2026-06-10', slots: addSlot([slot('a')], slot('b')) },
    ];

    // 실행 — 신규 조립기가 아니라 **기존** buildEditItineraryRequest 재사용.
    const body = buildEditItineraryRequest(days);

    // 단언(★) — 슬롯 키 집합이 정확히 5개. toEqual = 완전일치라 nameKo·distanceRange·hasViolation·
    // violationReason·tags 가 하나라도 새어 나오면 실패(서버가 받는 필드만, INV-U3 편집 계약).
    expect(Object.keys(body.days[0].slots[1]).sort()).toEqual([
      'endAt',
      'endsNextDay',
      'isFixed',
      'poiId',
      'startAt',
    ]);
    // 배열 순서 = 슬롯 순서(INV-U3-02).
    expect(body.days[0].slots.map((s) => s.poiId)).toEqual(['a', 'b']);
  });
});
