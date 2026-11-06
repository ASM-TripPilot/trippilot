import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';

import { slotDisplayCategory, slotDisplayName } from './slotDisplay';

/**
 * TRIP-1795 · AC-1 — 슬롯의 "화면에 보일 이름·분류"를 고르는 순수 함수.
 *
 * 무엇을 보장하나: 사용자가 이 여행에서만 고친 값(`displayName`·`displayCategory`)이 있으면 그것을, 없으면 장소 원본
 * (`nameKo`·`category`)을 돌려준다. "없음"은 `null`·`undefined`·빈 문자열·공백뿐이다. 입력 슬롯은 건드리지 않는다.
 *
 * > *(개념)* `??` 는 왼쪽이 null/undefined 일 때만 오른쪽을 고른다. 그런데 빈 문자열 `''` 은 null 이 아니라서
 * > `displayName ?? nameKo` 만으로는 `''` 을 "없음"으로 못 본다 — 서버가 null 로 정리해 주지만 방어로 이 함수가 맡는다.
 *
 * 3동작 뼈대: 준비=슬롯 → 실행=slotDisplayName/Category → 단언=고른 문자열(없으면 null).
 */

const base = (
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem => ({
  poiId: 'poi-1',
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  alternatives: [],
  tags: [],
  nameKo: '웨이브온',
  category: '맛집',
  ...over,
});

describe('slotDisplayName — 고친 이름 ?? 원본 이름 (AC-1)', () => {
  it('D1 · 고친 이름이 있으면 그것, null·undefined·빈 문자열·공백뿐이면 원본, 둘 다 비면 null', () => {
    expect(slotDisplayName(base({ displayName: '우리 아지트' }))).toBe(
      '우리 아지트'
    );

    for (const none of [null, undefined, '', '   ']) {
      expect(slotDisplayName(base({ displayName: none }))).toBe('웨이브온');
    }

    expect(
      slotDisplayName(base({ nameKo: null, displayName: '우리 아지트' }))
    ).toBe('우리 아지트');
    expect(
      slotDisplayName(base({ nameKo: null, displayName: '  ' }))
    ).toBeNull();
    expect(slotDisplayName(base({ nameKo: undefined }))).toBeNull();
  });
});

describe('slotDisplayCategory — 고친 분류 ?? 원본 분류 (AC-1)', () => {
  it('D2 · 같은 규칙: 고친 분류가 있으면 그것, 없음(null·undefined·빈 문자열·공백)이면 원본, 둘 다 비면 null', () => {
    expect(slotDisplayCategory(base({ displayCategory: '카페' }))).toBe('카페');

    // 공백·빈 값은 PoiCategory 타입 밖이라 변수로 우회해 방어 갈래를 태운다(서버는 닫힌 10종만 주지만 방어).
    for (const none of [null, undefined, '', '   ']) {
      const slot = { ...base(), displayCategory: none } as unknown;
      expect(slotDisplayCategory(slot as ItineraryDaysItemSlotsItem)).toBe(
        '맛집'
      );
    }

    expect(
      slotDisplayCategory(base({ category: null, displayCategory: '카페' }))
    ).toBe('카페');
    expect(slotDisplayCategory(base({ category: null }))).toBeNull();
  });
});

describe('입력 불변 (AC-1 "원본 필드는 변하지 않는다")', () => {
  it('D3 · 얼린 슬롯을 넣어도 던지지 않고 원본 두 필드가 그대로다', () => {
    const slot = Object.freeze(
      base({ displayName: '우리 아지트', displayCategory: '카페' })
    );

    expect(() => {
      slotDisplayName(slot);
      slotDisplayCategory(slot);
    }).not.toThrow();
    expect(slot.nameKo).toBe('웨이브온');
    expect(slot.category).toBe('맛집');
  });
});
