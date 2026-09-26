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
 * TRIP-939 AC-2b(Q2): 공유 카드의 저장·공유가 미장전(`captureShareImage().armed === false`)이면 j06 은
 *   보기만 하는 막다른 화면이 된다 → 페이지가 `onShare` 를 **넘기지 않아** 요약 화면의 [공유]가 사라진다.
 *   armed 는 홀더 목으로 갈아끼운다(기본 false = 오늘의 운영 빌드, 개통 짝만 true).
 *
 * (개념) `jest.fn(() => null)` 화면 목 → `mock.calls[0][0]` 이 전달 props · `toHaveBeenCalledWith(문자열)`
 *   = 인자 완전일치 · `toBeUndefined()` = 그 prop 을 안 넘겼다(또는 undefined 로 넘겼다).
 */

const mockShareArmed = { value: false };
jest.mock('@/features/reflection/model/shareCard', () => ({
  ...jest.requireActual('@/features/reflection/model/shareCard'),
  captureShareImage: () => ({ armed: mockShareArmed.value }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), canGoBack: jest.fn(() => true), back: jest.fn() },
}));

jest.mock('@/features/reflection/model/useTripSummary', () => ({
  useTripSummary: jest.fn(),
}));

// TRIP-987 B: 페이지가 여행 이름·기간을 위해 여행을 조회한다 — 이 파일은 공유 배선만 보므로 무해한
// 기본값(조회 중)으로 막는다(QueryClient 없이 실 훅이 돌면 전 케이스가 죽는다, DailyReflectionPage 선례).
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(() => ({
    data: undefined,
    isPending: true,
    isError: false,
  })),
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
  mockShareArmed.value = false;
});

function readySummary() {
  (useTripSummary as jest.Mock).mockReturnValue({
    envelope: { ready: true, summary: SUMMARY },
    summary: SUMMARY,
    source: 'RULE',
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });
}

describe('🔴 AC-6a · 공유 → j06 라우트 push (TRIP-939: 캡처 개통 시에만)', () => {
  it('TRIP-939 AC-2b: 캡처 미장전(armed:false)이면 요약 화면에 onShare 를 넘기지 않는다', () => {
    // 준비: 요약 준비 완료 + 캡처 미장전(기본).
    readySummary();

    // 실행
    render(<TripSummaryPage tripId="trip-1" />);

    // 단언: 화면은 그려졌고(앵커), 공유 진입 콜백은 없다 → 화면이 [공유]를 안 그린다.
    const calls = (TripSummaryScreen as unknown as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].onShare).toBeUndefined();
  });

  it('armed:true(개통) 에서 onShare 를 부르면 /trips/{tripId}/records/share 로 push 한다(짝)', () => {
    // 준비: 캡처가 장전됐다고 가정.
    mockShareArmed.value = true;
    readySummary();

    render(<TripSummaryPage tripId="trip-1" />);

    // 실행: 화면에 넘긴 공유 콜백을 부른다.
    const props = (TripSummaryScreen as unknown as jest.Mock).mock.calls[0][0];
    props.onShare();

    // 단언: j06 공유 라우트로 정확히.
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
