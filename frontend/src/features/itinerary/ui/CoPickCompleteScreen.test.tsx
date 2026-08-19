import { render, screen, within } from '@testing-library/react-native';

import { CoPickCompleteScreen } from './CoPickCompleteScreen';

/**
 * h17 내가 고른 완성 — 순수. BR-U3-07(초안=시간대 라벨만) · INV-3(소요시간 비표시).
 *
 * 무엇을 보장하나:
 *  - AC-7: 각 슬롯을 시간대 라벨(오후·전시/문화)로만 그리고 검증 시각(09:30 등)을 렌더하지 않는다.
 *          유일한 예외는 고정 블록(숙소 "21:00 도착").
 *  - 총 거리는 legDistance 산출 라벨("이동 X")을 그대로 표시.
 *  - 소요시간 문자열(분·시간) 0.
 *
 * 시계 정규식 /\d{1,2}:\d{2}/ 은 "09:30"·"21:00"엔 매치하고 밴드/거리/총거리엔 오탐 0(02a §5 실검증).
 */

const CLOCK = /\d{1,2}:\d{2}/;

const SLOTS = [
  {
    slotKey: '2026-06-10#p1',
    bandLabel: '오전 · 활동',
    name: '광안리 해변',
    isFixed: false,
    tagsLabel: '#바다 · 숙소서 840m',
  },
  {
    slotKey: '2026-06-10#p3',
    bandLabel: '오후 · 전시/문화',
    name: '부산시립미술관',
    isFixed: false,
    tagsLabel: '#미술 · 560m',
  },
  {
    slotKey: '2026-06-10#hotel',
    bandLabel: '저녁 · 숙소',
    name: '해운대 OO호텔',
    isFixed: true,
    fixedTimeLabel: '21:00 도착 · 변경 불가',
  },
];

function renderScreen(overrides: Record<string, unknown> = {}) {
  render(
    <CoPickCompleteScreen
      slots={SLOTS}
      totalDistanceLabel="이동 1.4km"
      headerLabel="부산 여행 · Day 1 · 6월 10일 · 화"
      onConfirm={jest.fn()}
      onBack={jest.fn()}
      {...overrides}
    />
  );
}

describe('🔴 CoPickCompleteScreen (h17 · BR-U3-07 · INV-3)', () => {
  it('C1 · AC-7 비고정 슬롯은 시간대 라벨만 — 검증 시각 렌더 0', () => {
    renderScreen();

    // 단언: 비고정 카드 서브트리에 시계 시각(HH:mm)이 하나도 없다.
    for (const slotKey of ['2026-06-10#p1', '2026-06-10#p3']) {
      const card = within(
        screen.getByTestId(`itinerary-copick-complete-slot-${slotKey}`)
      );
      expect(card.queryByText(CLOCK)).toBeNull();
      // 밴드 라벨은 살아 있다.
      expect(card.getByText(/오전|오후/)).toBeTruthy();
    }
  });

  it('C2 · AC-7 예외 — 고정 블록만 시각(21:00 도착)', () => {
    renderScreen();

    const fixed = within(
      screen.getByTestId('itinerary-copick-complete-slot-2026-06-10#hotel')
    );
    expect(fixed.getByText(/21:00/)).toBeTruthy();
  });

  it('C3 · AC-7 총 거리 = legDistance 라벨 그대로', () => {
    renderScreen();

    expect(
      screen.getByTestId('itinerary-copick-complete-total')
    ).toHaveTextContent('이동 1.4km');
  });

  it('C4 · INV-3 소요시간 문자열(분·시간) 0', () => {
    renderScreen();

    // 숫자 앵커 정규식 — rationale/태그 산문의 "시간"은 오탐 없이, "3분"·"2시간"만 잡는다.
    expect(screen.queryByText(/\d+\s*(분|시간)/)).toBeNull();
  });
});
