import { render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import type { TripSummary } from '@/shared/api/generated/schemas';

import { useTripSummary } from '@/features/reflection/model/useTripSummary';
import { TripSummaryScreen } from '@/features/reflection/ui/TripSummaryScreen';
import { TripSummaryPage } from './TripSummaryPage';

/**
 * TRIP-574 · AC-6a·AC-4(j04) — j04 여행 요약 "공유" 배선.
 *
 * j04 진입점(`reflection-summary-share`)은 TRIP-572 에서 이미 존재하나 `onShare` 는 no-op 주석이었다.
 * 이 티켓이 그 콜백을 j06 공유 라우트 push 로 실체화한다. 화면(`TripSummaryScreen`)은 props-캡처 목으로
 * 치환해(null 반환 — NativeWind `_ReactNativeCSSInterop` 함정 회피, MyStaysPage 선례) 페이지 배선만 본다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-6a: 요약 준비 완료(ready:true) → 화면에 넘긴 `onShare` 를 부르면 정확히
 *    `/trips/${tripId}/records/share` 로 push(오타·교차 배선 검출).
 *  - AC-4(j04, 선제 green 회귀 앵커): ready:false → "요약 준비 중" 안내 렌더 + 요약 화면 자체 미렌더
 *    (공유 진입점 부재로 BR-U5-48 흡수).
 *
 * (개념) `jest.fn(() => null)` 화면 목 → `mock.calls[0][0]` 이 전달 props · `toHaveBeenCalledWith(문자열)`
 *   = 인자 완전일치.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), canGoBack: jest.fn(() => true), back: jest.fn() },
}));

jest.mock('@/features/reflection/model/useTripSummary', () => ({
  useTripSummary: jest.fn(),
}));

jest.mock('@/features/reflection/ui/TripSummaryScreen', () => ({
  TripSummaryScreen: jest.fn(() => null),
}));

const SUMMARY: TripSummary = {
  narrative: '좋은 여행이었어요',
  highlights: [
    {
      date: '2026-06-11',
      dayOrder: 1,
      visitCount: 2,
      places: ['광안리 해변', '감천문화마을'],
    },
  ],
  stats: {
    totalVisits: 12,
    totalDistanceKm: 38,
    distanceSource: 'VISIT_LINE',
    totalPhotos: 24,
    hasLocationData: false,
  },
  source: 'RULE',
  generatedAt: '2026-06-12T10:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('🔴 AC-6a · 공유 → j06 라우트 push', () => {
  it('ready:true 에서 onShare 를 부르면 /trips/{tripId}/records/share 로 push 한다', () => {
    (useTripSummary as jest.Mock).mockReturnValue({
      envelope: { ready: true, summary: SUMMARY },
      summary: SUMMARY,
      source: 'RULE',
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<TripSummaryPage tripId="trip-1" />);

    const props = (TripSummaryScreen as unknown as jest.Mock).mock.calls[0][0];
    props.onShare();

    expect(router.push).toHaveBeenCalledWith('/trips/trip-1/records/share');
  });
});

describe('AC-4(j04) · 종료·요약 전이면 진입점 자체가 없다(선제 green 회귀 앵커)', () => {
  it('ready:false → "요약 준비 중" 안내 + 요약 화면 미렌더', () => {
    (useTripSummary as jest.Mock).mockReturnValue({
      envelope: { ready: false },
      summary: undefined,
      source: undefined,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<TripSummaryPage tripId="trip-1" />);

    expect(screen.getByTestId('reflection-summary-pending')).toBeOnTheScreen();
    expect((TripSummaryScreen as unknown as jest.Mock).mock.calls).toHaveLength(
      0
    );
  });
});
