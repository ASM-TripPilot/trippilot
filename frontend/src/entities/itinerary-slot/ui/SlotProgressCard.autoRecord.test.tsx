import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';

import { SlotProgressCard } from './SlotProgressCard';

/** TRIP-1340 · '자동 기록' 칩 + `⋯` 되돌리기 진입(Figma u10b 4860:2849). 수동 기록엔 둘 다 없다. */
const slot: ItineraryDaysItemSlotsItem = {
  poiId: 'gamcheon',
  startAt: '09:30:00',
  endAt: '10:30:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  alternatives: [],
  nameKo: '감천문화마을',
  distanceRange: null,
  openingHours: null,
  lat: 35.09,
  lng: 129.01,
  tags: [],
};
const KEY = '2026-06-11#gamcheon';

describe('SlotProgressCard auto record', () => {
  it('SA1 자동 출처면 칩과 되돌리기 진입이 있고 누르면 콜백 1회', () => {
    const onPressRevertAuto = jest.fn();
    render(
      <SlotProgressCard
        slot={slot}
        date="2026-06-11"
        state="done"
        visitedLabel="09:30"
        autoRecorded
        onPressRevertAuto={onPressRevertAuto}
      />
    );
    expect(
      screen.getByTestId(`execution-live-slot-auto-badge-${KEY}`)
    ).toHaveTextContent('자동 기록');
    fireEvent.press(
      screen.getByTestId(`execution-live-slot-auto-revert-${KEY}`)
    );
    expect(onPressRevertAuto).toHaveBeenCalledTimes(1);
  });

  it('SA2 수동 기록(미전달)이면 칩·되돌리기 없음', () => {
    render(
      <SlotProgressCard
        slot={slot}
        date="2026-06-11"
        state="done"
        visitedLabel="09:30"
      />
    );
    expect(
      screen.queryByTestId(`execution-live-slot-auto-badge-${KEY}`)
    ).toBeNull();
    expect(
      screen.queryByTestId(`execution-live-slot-auto-revert-${KEY}`)
    ).toBeNull();
  });

  it('SA3 체류 시간·소요시간 문구가 없다(INV-3)', () => {
    render(
      <SlotProgressCard
        slot={slot}
        date="2026-06-11"
        state="done"
        visitedLabel="09:30"
        autoRecorded
      />
    );
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/체류|소요|분 머묾/);
  });
});
