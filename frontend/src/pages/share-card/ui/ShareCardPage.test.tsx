import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { router } from 'expo-router';

import type { Trip, TripSummary } from '@/shared/api/generated/schemas';

import { useTripSummary } from '@/features/reflection/model/useTripSummary';
import { ShareCardScreen } from '@/features/reflection/ui/ShareCardScreen';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import { ShareCardPage } from './ShareCardPage';

/**
 * TRIP-1071 결정 4(c) · j06 공유 카드 페이지 — 요약 미준비면 카드 대신 안내.
 *
 * h16(확정 일정, 여행 전)에서도 [공유하기]로 j06 에 들어올 수 있게 됐다(결정 4c). 여행이 끝나 요약이
 * 준비되기 전(`envelope.ready === false`)에는 방문 0·사진 0 의 빈 카드를 그리지 않고, '여행이 끝나면
 * 만들 수 있어요' 안내와 [돌아가기]만 보인다 — 저장·공유·편집할 것이 없다(BR-U5-48 의 뜻을 j06 이 진다).
 *
 * 화면(`ShareCardScreen`)은 props 캡처 목(null 반환)으로 치환해 페이지 판정만 본다(TripSummaryPage.share
 * 선례 — NativeWind interop 함정 회피). 안내(`StateNotice`)는 진짜로 그린다. 판정은 `shareEnabled`
 * 재사용이 권고지만 여기선 결과(무엇이 그려지나)만 본다.
 *
 * 3동작: 준비(요약·여행 조회 결과 주입) → 실행(페이지 렌더·버튼 press) → 단언(안내/화면·라우터 호출).
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), canGoBack: jest.fn(() => true), back: jest.fn() },
}));

jest.mock('@/features/reflection/model/useTripSummary', () => ({
  useTripSummary: jest.fn(),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(),
}));

jest.mock('@/features/reflection/ui/ShareCardScreen', () => ({
  ShareCardScreen: jest.fn(() => null),
}));

const NOT_READY_TITLE = '여행이 끝나면 만들 수 있어요';

const TRIP: Trip = {
  tripId: 'trip-1',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  party: 2,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-01T10:00:00Z',
} as Trip;

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

function givenTrip() {
  (useGetTripsTripId as jest.Mock).mockReturnValue({
    data: TRIP,
    isPending: false,
    isError: false,
  });
}

function givenSummary(ready: boolean) {
  (useTripSummary as jest.Mock).mockReturnValue({
    envelope: ready ? { ready: true, summary: SUMMARY } : { ready: false },
    summary: ready ? SUMMARY : undefined,
    source: ready ? 'RULE' : undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });
}

const screenMock = ShareCardScreen as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('🔴 TRIP-1071 AC-12 · 요약 미준비(ready:false) → 카드 대신 안내 (결정 4c)', () => {
  it('안내 제목이 뜨고, 카드 화면은 그리지 않는다(저장·공유·편집 어포던스 0)', () => {
    // 준비: 여행은 있고 요약은 아직(여행 전·진행 중).
    givenTrip();
    givenSummary(false);

    // 실행
    render(<ShareCardPage tripId="trip-1" />);

    // 단언
    const notice = screen.getByTestId('reflection-share-not-ready');
    expect(within(notice).getByText(NOT_READY_TITLE)).toBeOnTheScreen();
    expect(screenMock).not.toHaveBeenCalled();
  });

  it('[돌아가기] press → router.back 1회(막다른 화면이 아니다, Q4)', () => {
    givenTrip();
    givenSummary(false);
    render(<ShareCardPage tripId="trip-1" />);

    const back = screen.getByTestId('reflection-share-not-ready-back');
    expect(within(back).getByText('돌아가기')).toBeOnTheScreen();
    fireEvent.press(back);

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('ready:true → 카드 화면을 그리고 안내는 없다(짝 앵커)', () => {
    givenTrip();
    givenSummary(true);

    render(<ShareCardPage tripId="trip-1" />);

    expect(screenMock).toHaveBeenCalled();
    expect(screenMock.mock.calls[0][0].hashtagText).toBe('#부산여행');
    expect(screen.queryByTestId('reflection-share-not-ready')).toBeNull();
  });

  it('조회 중이면 기존 준비 중 안내 그대로 — 미준비 안내와 섞이지 않는다(회귀 앵커)', () => {
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    (useTripSummary as jest.Mock).mockReturnValue({
      envelope: undefined,
      summary: undefined,
      source: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    });

    render(<ShareCardPage tripId="trip-1" />);

    expect(screen.getByTestId('reflection-share-pending')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-share-not-ready')).toBeNull();
    expect(screenMock).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1071 5-b 경고-1 · 요약 조회 오류는 "미준비"로 접지 않는다 (INV-4 · Seed Q4)', () => {
  it('오류 → reflection-share-error + [다시 시도](재조회 1회), 미준비 안내·카드 화면은 없다', () => {
    // 준비: 여행은 있고 요약 조회가 실패했다(봉투 없음 — 분기가 없으면 미준비 안내로 새는 모양).
    givenTrip();
    const refetch = jest.fn();
    (useTripSummary as jest.Mock).mockReturnValue({
      envelope: undefined,
      summary: undefined,
      source: undefined,
      isPending: false,
      isError: true,
      refetch,
    });

    // 실행: 렌더 후 [다시 시도]를 누른다.
    render(<ShareCardPage tripId="trip-1" />);
    const retry = screen.getByTestId('reflection-share-retry');
    fireEvent.press(retry);

    // 단언: 오류 안내가 뜨고, 재조회가 1회 불린다.
    expect(screen.getByTestId('reflection-share-error')).toBeOnTheScreen();
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();
    expect(refetch).toHaveBeenCalledTimes(1);
    // 오류를 '여행이 끝나면…'(미준비)으로 둔갑시키지 않는다 + 카드·저장/공유 어포던스 0.
    expect(screen.queryByTestId('reflection-share-not-ready')).toBeNull();
    expect(screen.queryByText(NOT_READY_TITLE)).toBeNull();
    expect(screenMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
  });
});
