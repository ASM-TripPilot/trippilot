import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { buildMapPeek } from './mapPeek';
import type { ProjectedSlot, SlotState } from './slotProgress';

/**
 * TRIP-397 · buildMapPeek — 지도(i02·i03) peek 요약 도출의 단위 심판.
 *
 * *(개념)* peek = 지도 아래 미리보기. "남은 N곳"(예정 슬롯 수) + 지금/다음 슬롯 이름 2행.
 * 진행 상태(예정/진행/완료)는 `ProjectedSlot.state`가 이미 붙여 준다(slotProgress) — 이 함수는
 * 시각을 만들지 않고(BR-U4-34 무관) 상태만 읽어 개수·정체를 뽑는다.
 *
 * 규약(테스트가 못박음):
 *  - remainingCount = state==='upcoming' 개수.
 *  - now  = active 슬롯, 없으면 첫 upcoming(첫 non-done). 없으면 null.
 *  - next = now 바로 다음 슬롯. 없으면 null.
 *  - 이름 결측 → '미확인'(BR-U4-40).
 *
 * 3동작 뼈대: 준비=상태별 슬롯 배열 → 실행=buildMapPeek → 단언=개수·now·next.
 */

const slot = (
  poiId: string,
  nameKo: string | null
): ItineraryDaysItemSlotsItem => ({
  poiId,
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo,
  lat: null,
  lng: null,
  tags: [],
});

const projected = (
  state: SlotState,
  poiId: string,
  nameKo: string | null
): ProjectedSlot => ({ state, slot: slot(poiId, nameKo) });

// name 을 poiId·nameKo 로 겸용(가독성). nameKo 결측 케이스만 두 번째 인자로 null 을 넘긴다.
const up = (name: string, nameKo: string | null = name): ProjectedSlot =>
  projected('upcoming', name, nameKo);
const active = (name: string): ProjectedSlot => projected('active', name, name);
const done = (poiId: string): ProjectedSlot =>
  projected('done', poiId, `done-${poiId}`);

describe('buildMapPeek', () => {
  it('P1 전부 예정(i01 "기록 없음") — 남은=전체, 지금=첫째, 다음=둘째', () => {
    const view = buildMapPeek([up('가'), up('나'), up('다')]);
    expect(view.remainingCount).toBe(3);
    expect(view.now?.name).toBe('가');
    expect(view.next?.name).toBe('나');
  });

  it('P2 진행 중 존재 — 지금=진행 슬롯, 다음=그 다음, 남은=예정만', () => {
    const view = buildMapPeek([done('a'), active('나'), up('다'), up('라')]);
    expect(view.remainingCount).toBe(2); // 다·라만 예정
    expect(view.now?.name).toBe('나');
    expect(view.next?.name).toBe('다');
  });

  it('P3 완료 접두 후 예정(진행 없음) — 지금은 완료를 건너뛴 첫 예정', () => {
    const view = buildMapPeek([done('a'), done('b'), up('다'), up('라')]);
    expect(view.remainingCount).toBe(2);
    expect(view.now?.name).toBe('다');
    expect(view.next?.name).toBe('라');
  });

  it('P4 이름 결측 → "미확인"(BR-U4-40, 빈칸 아님)', () => {
    const view = buildMapPeek([up('x', null)]);
    expect(view.now).not.toBeNull();
    expect(view.now?.name).toBe('미확인');
  });

  it('P5 지금이 마지막이면 다음은 null', () => {
    const view = buildMapPeek([done('a'), active('나')]);
    expect(view.remainingCount).toBe(0);
    expect(view.now?.name).toBe('나');
    expect(view.next).toBeNull();
  });

  it('P6 빈 일자 — 개수 0, now·next 없음(경계값)', () => {
    expect(buildMapPeek([])).toEqual({
      remainingCount: 0,
      now: null,
      next: null,
    });
  });
});
