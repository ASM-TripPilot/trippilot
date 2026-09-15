import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { reorderKeepingFixed } from './reorderKeepingFixed';

/**
 * TRIP-443 · AC-1(BR-U4-44·BR-U4-18) — 클라 로컬 잠금 순수 근거. 드래그 제스처는 jest 로 못 태우니
 * (reanimated 네이티브) 재정렬 수학을 렌더 없이 직접 잠근다: **비고정만 재정렬, 고정은 원래 절대
 * 인덱스를 지킨다.** `features/itinerary/model/itineraryEditStore.ts`의 동명 함수 S2 와 동형 계약
 * (features 경계로 shared 별도 신설).
 *
 * 3동작: 준비=슬롯 배열 → 실행=`reorderKeepingFixed(original, reordered)` → 단언=poiId 순서.
 */

type Slot = ItineraryDaysItemSlotsItem;

function slot(poiId: string, over: Partial<Slot> = {}): Slot {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

function poiIds(slots: Slot[]): string[] {
  return slots.map((s) => s.poiId);
}

describe('R1 · 고정 없음 → reordered 그대로', () => {
  it('lib 이 준 순서를 그대로 반영한다(배열 순서 = 슬롯 순서)', () => {
    const plain = [slot('a'), slot('b'), slot('c')];
    expect(
      poiIds(reorderKeepingFixed(plain, [plain[2], plain[0], plain[1]]))
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('R2 · 고정 head(index0) → 자리 고수, 비고정만 재배치', () => {
  it('lib 이 F 를 뒤로 민 배열을 줘도 F 는 index0, 비고정은 reordered 순서', () => {
    const withHead = [slot('F', { isFixed: true }), slot('a'), slot('b')];
    // lib 이 [a, b, F] 를 넘김 → F 는 index0 유지, 비고정 [a,b].
    expect(
      poiIds(
        reorderKeepingFixed(withHead, [withHead[1], withHead[2], withHead[0]])
      )
    ).toEqual(['F', 'a', 'b']);
    // lib 이 [b, F, a] 를 넘김 → F index0, 비고정 [b,a].
    expect(
      poiIds(
        reorderKeepingFixed(withHead, [withHead[2], withHead[0], withHead[1]])
      )
    ).toEqual(['F', 'b', 'a']);
  });
});

describe('R3 · 고정 tail(index2) → 맨 끝 앵커 고수', () => {
  it('어떤 reordered 에도 F 는 index2, 비고정만 [b,a]', () => {
    const withTail = [slot('a'), slot('b'), slot('F', { isFixed: true })];
    expect(
      poiIds(
        reorderKeepingFixed(withTail, [withTail[2], withTail[1], withTail[0]])
      )
    ).toEqual(['b', 'a', 'F']);
  });
});
