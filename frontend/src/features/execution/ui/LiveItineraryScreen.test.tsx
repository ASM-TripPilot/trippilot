import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import type { ProjectedSlot } from '../model/slotProgress';
import { LiveItineraryScreen } from './LiveItineraryScreen';

/**
 * TRIP-395 · LiveItineraryScreen(i01) — 여행 중 일정의 default 렌더 = "기록 없음" 변형.
 * 일자 칩 · 세그먼트(일정｜지도) · 타임라인. 기록이 없으면 전 슬롯이 예정으로 그려진다.
 *
 * 3동작 뼈대: 준비=days·오늘 슬롯·세그먼트 → 실행=render/press → 단언=구조·콜백.
 */

const DAYS: ItineraryDaysItem[] = [
  { date: '2026-08-20', slots: [] },
  { date: '2026-08-21', slots: [] },
];

const slotOf = (poiId: string): ProjectedSlot => ({
  state: 'upcoming',
  slot: {
    poiId,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: `장소 ${poiId}`,
    distanceRange: null,
    openingHours: null,
    tags: [],
  },
});

const baseProps = {
  days: DAYS,
  activeDayIndex: 0,
  slots: [slotOf('a'), slotOf('b')],
  segment: 'itinerary' as const,
  onSelectDay: jest.fn(),
  onSelectSegment: jest.fn(),
};

describe('LiveItineraryScreen', () => {
  it('S1 루트·일자 칩·세그먼트 토글을 그린다', () => {
    render(<LiveItineraryScreen {...baseProps} />);
    expect(screen.getByTestId('execution-live-screen')).toBeTruthy();
    expect(screen.getByTestId('execution-live-daychip-0')).toBeTruthy();
    expect(screen.getByTestId('execution-live-daychip-1')).toBeTruthy();
    expect(screen.getByTestId('execution-live-segment-itinerary')).toBeTruthy();
    expect(screen.getByTestId('execution-live-segment-map')).toBeTruthy();
  });

  it('S2 일정 세그먼트면 오늘 슬롯을 타임라인 카드로 그린다', () => {
    render(<LiveItineraryScreen {...baseProps} />);
    expect(screen.getByTestId('execution-live-slot-2026-08-20#a')).toBeTruthy();
    expect(screen.getByTestId('execution-live-slot-2026-08-20#b')).toBeTruthy();
  });

  it('S3 지도 세그먼트면 타임라인 카드 대신 준비 중 자리를 그린다 (지도는 i02/i03·TRIP-397)', () => {
    render(<LiveItineraryScreen {...baseProps} segment="map" />);
    expect(screen.getByTestId('execution-live-map-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('execution-live-slot-2026-08-20#a')).toBeNull();
  });

  it('S4 일자 칩·세그먼트를 누르면 콜백이 그 값으로 불린다', () => {
    const onSelectDay = jest.fn();
    const onSelectSegment = jest.fn();
    render(
      <LiveItineraryScreen
        {...baseProps}
        onSelectDay={onSelectDay}
        onSelectSegment={onSelectSegment}
      />
    );

    fireEvent.press(screen.getByTestId('execution-live-daychip-1'));
    expect(onSelectDay).toHaveBeenCalledWith(1);

    fireEvent.press(screen.getByTestId('execution-live-segment-map'));
    expect(onSelectSegment).toHaveBeenCalledWith('map');
  });
});
