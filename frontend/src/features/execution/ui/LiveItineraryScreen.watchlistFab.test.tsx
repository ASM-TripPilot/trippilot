import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import type { ProjectedSlot } from '../model/slotProgress';
import { LiveItineraryScreen } from './LiveItineraryScreen';

// 지도 세그먼트가 아니어도 LiveMapScreen import 는 안전하게 관찰 목으로(선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

/**
 * TRIP-562 · AC-4 화면 파트 — 라이브 화면 하단 우측 진입 FAB(`execution-live-watchlist-fab`).
 *
 * 무엇을 보장하나: FAB 를 누르면 additive optional prop `onPressWatchlist?` 콜백이 1회 불린다.
 * 실제 라우팅(감시 목록 화면으로 이동)은 페이지가 배선하고, 그건 별 통합테스트가 잰다(★9 통과형 목).
 *
 * ★ 별 파일로 둔 이유(★4): 프로즌 `LiveItineraryScreen.test.tsx`(S1~S8)를 한 줄도 안 건드려
 *   additive prop 무회귀를 유지한다(그 파일 diff 0 은 재실행으로 검증). `onPressWatchlist` 는
 *   옵셔널이라 기존 테스트가 안 넘겨도 안 깨진다 — 개념 [[후방호환 옵셔널 파라미터 (additive prop)]].
 *
 * 3동작 뼈대: 준비=baseProps + onPressWatchlist 스파이 → 실행=FAB press → 단언=콜백 1회.
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
  toggle: 'plan' as const,
  onToggle: jest.fn(),
  actualRoute: {
    enabled: false,
    reason: '위치 권한을 켜면 기록돼요',
    distanceKm: 0,
  },
  tripTitle: '부산 여행',
  subtitle: '6월 11일 목요일 · 오늘 일정',
  onPressTab: jest.fn(),
};

describe('🔴 LiveItineraryScreen · 감시 목록 진입 FAB (AC-4)', () => {
  it('FAB1 FAB 를 그리고 누르면 onPressWatchlist 가 1회 불린다', () => {
    const onPressWatchlist = jest.fn();
    render(
      <LiveItineraryScreen {...baseProps} onPressWatchlist={onPressWatchlist} />
    );

    expect(screen.getByTestId('execution-live-watchlist-fab')).toBeTruthy();

    fireEvent.press(screen.getByTestId('execution-live-watchlist-fab'));
    expect(onPressWatchlist).toHaveBeenCalledTimes(1);
  });
});
