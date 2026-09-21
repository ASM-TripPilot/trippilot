import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { buildSlotKey } from '../lib/slotKey';
import { SlotStopCard } from './SlotStopCard';

/**
 * TRIP-797 · AC-2·AC-5·AC-6·AC-11 (OQ-2) — h12 편집기가 쓰는 `SlotStopCard` **가산(opt-in) 확장**.
 *
 * `SlotStopCard` 는 결과화면 6종(h07·h08·h11·h14·h16)이 이미 쓰는 공용 카드다. 편집기는 이 카드에
 * **옵셔널 prop 만 얹어** 통일한다 — prop 미전달이면 현행 그대로여야 한다(회귀 0, OQ-2). 이 파일은
 * 편집 어포던스(⌄ 시각칩 press·"시간대 설정" 칩·완료 잠금)와 **회귀 0**을 카드 원자 층에서 잠근다.
 * (기존 `SlotStopCard.test.tsx` 는 손대지 않는다 — 결과화면 무회귀 그물, 02a ★2.)
 *
 * 신규 옵셔널 prop(02a §1-C):
 *  - `onPressTimeChip?` — 주면 시각 칩을 누를 수 있게(⌄) 만든다(Pressable `slot-stopcard-timechip-*`).
 *    미주입이면 Pressable 자체를 안 그린다(결과화면: plain `slot-stopcard-time-*` leaf 그대로).
 *  - `unspecified?` — true면 시각 칩 대신 "시간대 설정" 칩(`slot-stopcard-unspecified-*`).
 *  - `locked?` — 방문 완료 잠금(AC-11): 시각칩 press 를 안 붙인다(INV-U3-03/i07).
 *
 * 3동작 뼈대: 준비=슬롯+편집 prop → 실행=렌더/press → 단언=새 testID 존재·부재·콜백 횟수.
 * ⚠️ 실개폐·픽셀(⌄ 모양)은 이 카드 밖 — press 콜백 발화까지만(시트 실개폐는 페이지·6-b, ★7).
 */

const DATE = '2026-06-10';

function makeSlot(
  overrides: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId: 'poi-gwangalli',
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: ['바다', '산책'],
    nameKo: '광안리 해변',
    category: '자연',
    imageUrl: 'https://cdn.example.com/gwangalli.jpg',
    ...overrides,
  };
}

const id =
  (slotKey: string) =>
  (part: string): string =>
    `slot-stopcard-${part}-${slotKey}`;

const KEY = buildSlotKey(DATE, 'poi-gwangalli');
const at = id(KEY);

describe('🔴 SlotStopCard 편집 · B1-1 — onPressTimeChip 주입 → 시각칩이 눌린다(AC-5)', () => {
  it('비고정 슬롯 시각칩 press 가 onPressTimeChip 을 부른다', () => {
    const onPressTimeChip = jest.fn();
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        onPressTimeChip={onPressTimeChip}
      />
    );

    expect(screen.getByTestId(at('timechip'))).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId(at('timechip')));
    expect(onPressTimeChip).toHaveBeenCalledTimes(1);
  });
});

describe('SlotStopCard 편집 · B1-2 (회귀앵커) — onPressTimeChip 미주입 = 결과화면 그대로', () => {
  it('편집 콜백이 없으면 누름 칩(timechip)이 없고 기존 시각 leaf 만 그린다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
      />
    );

    // 편집 어포던스 부재(결과화면 무회귀).
    expect(screen.queryByTestId(at('timechip'))).toBeNull();
    // 기존 시각 leaf 는 그대로(완전일치).
    expect(screen.getByTestId(at('time'))).toHaveTextContent('10:00–11:00');
  });
});

describe('🔴 SlotStopCard 편집 · B1-3 — 미지정 칩(AC-6)', () => {
  it('unspecified 면 시각칩 대신 "시간대 설정" 칩을 그리고 press 로 시트를 연다', () => {
    const onPressTimeChip = jest.fn();
    render(
      <SlotStopCard
        slot={makeSlot({ startAt: '00:00:00' })}
        date={DATE}
        index={0}
        timeLabel={null}
        unspecified
        onPressTimeChip={onPressTimeChip}
      />
    );

    expect(screen.getByTestId(at('unspecified'))).toBeOnTheScreen();
    expect(screen.getByText('시간대 설정')).toBeOnTheScreen();
    // 미지정이면 일반 시각칩·시각 leaf 는 없다.
    expect(screen.queryByTestId(at('time'))).toBeNull();

    fireEvent.press(screen.getByTestId(at('unspecified')));
    expect(onPressTimeChip).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 SlotStopCard 편집 · B1-4 — 완료 잠금(AC-11 · INV-U3-03)', () => {
  it('locked 면 잠금 표식을 그리고 시각칩 편집 어포던스를 안 붙인다', () => {
    const onPressTimeChip = jest.fn();
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        onPressTimeChip={onPressTimeChip}
        locked
      />
    );

    // 잠금 표식 present.
    expect(screen.getByTestId(at('locked'))).toBeOnTheScreen();
    // onPressTimeChip 을 줬어도 잠금이라 누름 칩이 없다(편집 불가).
    expect(screen.queryByTestId(at('timechip'))).toBeNull();
  });
});

describe('SlotStopCard 편집 · B1-6 (★회귀0) — 편집 prop 전무 = 새 testID 0', () => {
  it('세 편집 prop 미전달이면 timechip·unspecified·locked 가 없고 기존 leaf 는 그대로다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
      />
    );

    // OQ-2 회귀 0 — 새 어포던스 testID 가 하나도 안 붙는다(6종 결과화면 무영향의 카드 원자 그물).
    expect(screen.queryByTestId(at('timechip'))).toBeNull();
    expect(screen.queryByTestId(at('unspecified'))).toBeNull();
    expect(screen.queryByTestId(at('locked'))).toBeNull();
    // 기존 표면은 그대로.
    expect(screen.getByTestId(at('time'))).toHaveTextContent('10:00–11:00');
    expect(screen.getByTestId(at('name'))).toHaveTextContent('광안리 해변');
    expect(screen.getByTestId(at('tags'))).toHaveTextContent('바다 · 산책');
  });
});
