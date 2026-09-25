import { render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { buildSlotKey } from '../lib/slotKey';
import { SlotStopCard } from './SlotStopCard';

/**
 * TRIP-921 · AC-14(구조 절반) — h12 편집기에서 **끌리는 카드의 떠 있는 얼굴**(Figma `4195:2506`:
 * 테두리 1px #ff385c, 평소 hairline). 카드에 가산(opt-in) prop `dragging` 을 얹는다 — 결과 화면 5종이
 * 같은 카드를 쓰므로 **미전달이면 현행 그대로**여야 한다(K2 무회귀 그물).
 *
 * 무엇을 보장하나: `dragging` 이 카드 루트 테두리 토큰을 `border-hairline` → `border-primary` 로
 * 바꾼다. 색 자체·그림자·"오른쪽 아래로 떠 있음"은 jest 원리적 사각(6-b `h12-editor-dragging`).
 * 편집 뷰가 이 prop 을 리스트의 `isActive` 로 채우는지는 위젯 `EditorView.test.tsx` D8 이 잰다.
 *
 * 3동작 뼈대: 준비=슬롯 하나 → 실행=dragging 유무로 렌더 → 단언=루트 className 토큰.
 */

const DATE = '2026-06-10';
const KEY = buildSlotKey(DATE, 'poi-a');

function makeSlot(): ItineraryDaysItemSlotsItem {
  return {
    poiId: 'poi-a',
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: ['바다'],
    nameKo: '광안리 해변',
  };
}

/** 루트 className 을 공백으로 쪼갠 토큰 — `border-primary` 가 다른 토큰의 일부에 걸리지 않게 원소로 본다. */
function rootTokens(): string[] {
  return String(
    screen.getByTestId(`slot-stopcard-${KEY}`).props.className ?? ''
  ).split(/\s+/);
}

describe('🔴 SlotStopCard · K1 — dragging 이면 카드 루트가 빨강 테두리 (TRIP-921 AC-14)', () => {
  it('dragging 을 주면 border-primary 가 있고 평소 border-hairline 은 없다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        numberOutside
        dragging
      />
    );

    expect(rootTokens()).toContain('border-primary');
    expect(rootTokens()).not.toContain('border-hairline');
  });
});

describe('SlotStopCard · K2 — dragging 미전달은 현행 그대로 (TRIP-921 AC-14 후방호환)', () => {
  it('prop 이 없으면 border-hairline 이고 border-primary 는 없다', () => {
    render(
      <SlotStopCard slot={makeSlot()} date={DATE} index={0} numberOutside />
    );

    expect(rootTokens()).toContain('border-hairline');
    expect(rootTokens()).not.toContain('border-primary');
  });
});
