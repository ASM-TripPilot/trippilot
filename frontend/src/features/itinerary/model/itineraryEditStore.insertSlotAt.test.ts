import { insertSlotAt } from './itineraryEditStore';
import { buildEditItineraryRequest } from './buildEditItineraryRequest';
import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-797 · AC-7 (INV-U3-02) — h12 편집기 "카드 사이 +"의 **판정/조립 층**.
 *
 * 무엇을 보장하나:
 *  - 🔴 **A1-1~4** `insertSlotAt(slots, slot, index)` 가 **지정 index 자리**에 새 슬롯을 꽂은 새 배열을
 *    돌려준다(말미 append 인 `addSlot` 과 다르다). 경계는 splice 준용 — index≥len 말미, index≤0 앞.
 *  - 🔴 **A1-5** 비파괴(원본 배열 불변 + 반환은 새 배열) — `addSlot`·`removeSlot` 과 같은 스프레드 패턴.
 *  - 🔴 **A1-6 (★완료조건)** 그렇게 넣은 `days` 를 **기존** `buildEditItineraryRequest` 로 조립하면 PUT
 *    봉투의 슬롯 배열이 **넣은 그 순서 그대로**(INV-U3-02)고, 슬롯당 정확히 5키(읽기전용 필드 제거)다.
 *    → "카드 사이 + 로 넣은 슬롯이 저장 배열에서 그 자리 그대로"를 순수 층에서 잠근다.
 *
 * 왜 model 층인가: "어느 자리에 넣고 무엇을 PUT 하나"는 순수 계산이라 화면 없이 직접 태우는 게 가장
 * 싸고 정확하다(3층 배치: 판정=model · 조립=page · 그림=screen, addSlot 선례). h13(TRIP-798) 복귀 후
 * index 가 실제로 전달·소비되는지는 이 티켓 밖(h13 미구축) — 브리프 맹점4 그대로.
 *
 * 3동작 뼈대: 준비=슬롯 배열 → 실행=`insertSlotAt`/`buildEditItineraryRequest` → 단언=순서·불변·키.
 */

/** 서버 조회가 지고 오는 읽기전용 필드까지 채운 슬롯 — PUT 조립이 이걸 걷어내야 한다(addSlot 선례). */
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

const ids = (slots: ItineraryDaysItemSlotsItem[]): string[] =>
  slots.map((s) => s.poiId);

describe('🔴 insertSlotAt · A1-1~4 — 지정 index 자리에 삽입(말미 append 아님)', () => {
  it('index 0 → 맨 앞에 꽂는다', () => {
    const base = [slot('a'), slot('b'), slot('c')];
    expect(ids(insertSlotAt(base, slot('x'), 0))).toEqual(['x', 'a', 'b', 'c']);
  });

  it('index 2 → 그 자리에 꽂아 뒤를 민다', () => {
    const base = [slot('a'), slot('b'), slot('c')];
    expect(ids(insertSlotAt(base, slot('x'), 2))).toEqual(['a', 'b', 'x', 'c']);
  });

  it('index === 길이 → 말미(append)', () => {
    const base = [slot('a'), slot('b'), slot('c')];
    expect(ids(insertSlotAt(base, slot('x'), 3))).toEqual(['a', 'b', 'c', 'x']);
  });

  it('길이 초과·음수는 클램프(초과=말미, 음수=앞)', () => {
    const base = [slot('a'), slot('b'), slot('c')];
    expect(ids(insertSlotAt(base, slot('x'), 99))).toEqual([
      'a',
      'b',
      'c',
      'x',
    ]);
    expect(ids(insertSlotAt(base, slot('x'), -1))).toEqual([
      'x',
      'a',
      'b',
      'c',
    ]);
  });
});

describe('🔴 insertSlotAt · A1-5 — 비파괴(원본 불변 + 새 배열)', () => {
  it('원본 배열은 길이·내용이 안 바뀌고, 반환은 다른 배열 참조다', () => {
    const base = [slot('a'), slot('b')];
    const result = insertSlotAt(base, slot('x'), 1);

    // 원본 불변 — 시드한 GET 배열을 건드리지 않는다(removeSlot·addSlot 패턴).
    expect(ids(base)).toEqual(['a', 'b']);
    expect(base).toHaveLength(2);
    // 반환은 새 배열.
    expect(result).not.toBe(base);
    expect(ids(result)).toEqual(['a', 'x', 'b']);
  });
});

describe('🔴 insertSlotAt · A1-6 (★완료조건) — insert 후 buildEditItineraryRequest 순서·키', () => {
  it('index 1 삽입 → PUT 슬롯 배열이 그 순서 그대로고 슬롯당 5키만 담긴다(INV-U3-02)', () => {
    const date = '2026-06-10';
    const inserted = insertSlotAt([slot('a'), slot('c')], slot('b'), 1);

    const days: ItineraryDaysItem[] = [{ date, slots: inserted }];
    const request = buildEditItineraryRequest(days);

    // 배열 순서 = 슬롯 순서(INV-U3-02) — 넣은 index 자리 유지.
    expect(request.days[0].slots.map((s) => s.poiId)).toEqual(['a', 'b', 'c']);

    // 슬롯당 정확히 5키(읽기전용 필드 제거, addSlot M2 선례).
    request.days[0].slots.forEach((s) => {
      expect(Object.keys(s).sort()).toEqual(
        ['endAt', 'endsNextDay', 'isFixed', 'poiId', 'startAt'].sort()
      );
    });
  });
});
