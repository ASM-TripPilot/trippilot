import { render, screen } from '@testing-library/react-native';

import { ManualPlanPage } from './ManualPlanPage';
import type { Itinerary } from '@/shared/api/generated/schemas';

/**
 * TRIP-338 · h19 배선 — 페이지→화면을 실제로 태우는 심판. `GeneratingPage.integration.test.tsx`
 * (FULLY_AI) 와 **대칭**이다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **I1 (AC-1)** 마운트 시 생성 POST 를 **1회**, `{ generationMode:'MANUAL' }` 하나만 담아 쏜다
 *    (여분 키 0 · firedRef). ★ 나간 mutate 의 `data` 를 `toEqual` 완전일치로 잠근다.
 *  - 🔴 **I2 (AC-2)** `(MANUAL, MINIMAL, isFallback=false)` 일정이 와도 **폴백·실패 배너를 안 띄운다**.
 *    ★ 폴백 배너 testID 부재 **+ 루트 존재 짝**(오타 testID 로도 통과하는 queryBy-null 을 루트로 봉합).
 *
 * 판정 정본은 `draftView.fallback.test.ts` F-7(`resolveFallbackNotice(MINIMAL,false)=null`, 이미 green)
 * 이 잠근다 — I2 는 그 판정이 표면으로 새지 않는다는 **회귀 가드**다(재구현 아님).
 *
 * 3동작 뼈대: 준비=목(mutate·itinerary·router) → 실행=페이지 렌더 → 단언=나간 POST·보이는 표면.
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙, GeneratingPage 선례).
let mockItinerary: Itinerary | undefined;

const mockMutate = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
  useGetTripsTripIdItinerary: () => ({
    data: mockItinerary,
    isPending: mockItinerary === undefined,
    isError: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
  }),
  router: { push: mockPush, replace: mockReplace, back: mockBack },
}));

const TRIP_ID = 't1';

/** 정확한 `(MANUAL, MINIMAL, false)` 빈 일정 — 폴백 함정(§8①)의 급소 픽스처. */
const MANUAL_EMPTY: Itinerary = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'MINIMAL',
  generationMode: 'MANUAL',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [{ date: '2026-06-10', slots: [] }],
};

beforeEach(() => {
  mockItinerary = undefined;
  mockMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
});

describe('🔴 I1 · AC-1 — 마운트 POST 가 generationMode:MANUAL 하나로 1회 나간다', () => {
  it('POST 가 정확히 1회, tripId 와 { generationMode:"MANUAL" } 만 담아 나간다', () => {
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 마운트 시 정확히 1회(firedRef — 재렌더로 두 번 쏘지 않는다).
    expect(mockMutate).toHaveBeenCalledTimes(1);

    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: unknown;
    };
    expect(vars.tripId).toBe(TRIP_ID);
    // ★ toEqual = 정확 일치 — deadlineMs 등 여분 키 0(BR-U3-03, FULLY_AI 심판 대칭).
    expect(vars.data).toEqual({ generationMode: 'MANUAL' });
  });
});

describe('🔴 I2 · AC-2 — (MANUAL, MINIMAL, false) 에 폴백·실패 배너가 없다 (INV-4)', () => {
  it('루트가 뜨고(짝) 폴백 배너 testID 는 어느 것도 없다', () => {
    mockItinerary = MANUAL_EMPTY;
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 루트 존재 짝(★) — 화면이 그 픽스처로 실제 렌더됐다(오타 testID 로 공허 통과 방지).
    expect(screen.getByTestId('itinerary-manual-root')).toBeOnTheScreen();

    // 폴백/실패 배너는 어느 계약으로도 안 뜬다 — MANUAL 은 실패가 아니라 선택이다(§8①).
    [
      'itinerary-manual-fallback-banner',
      'itinerary-draft-fallback-banner',
    ].forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
  });
});
