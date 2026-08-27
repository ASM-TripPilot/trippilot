import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlanbManualPage } from './PlanbManualPage';
import type { Itinerary } from '@/shared/api/generated/schemas';

/**
 * TRIP-443 · planb-manual 배선 승인 테스트 — 라우트가 넘긴 variant→얼굴, GET→편집 days, [저장]→PUT
 * 을 태우는 심판. `ManualPlanPage.integration.test.tsx`(h19)와 대칭이되 GET+PUT(생성 POST 없음).
 *
 * 무엇을 보장하나:
 *  - 🔴 **I1(★봉합)**: variant 기본(i15)엔 폴백/누락 배너가 없다 — 루트 존재 짝 + 배너 testID 부재.
 *  - 🔴 **I2(param→face)**: variant='error' 를 화면에 흘려 i22 누락 배너가 뜬다(하드코딩/드롭 차단).
 *  - 🔴 **I3(저장 배선)**: [저장] press → PUT 이 {tripId, data:{days:[...]}} 로 나간다.
 *
 * 범위 밖(명시): 저장 onSuccess→머지→배지 재렌더 왕복은 mergeValidationFlags.test(순수)+
 *   ManualEditScreen.test(render 데이터 추종)의 합성으로 커버. 복구 트리거 배선은 Q4 정본 공백 →
 *   심판 밖(후속). [시각 입력] 시트 실제 열림은 6-b 실기(바텀시트 함정).
 *
 * jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 mock 으로 시작하는 변수만 예외.
 */

let mockItinerary: Itinerary | undefined;

const mockMutate = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();

// GET(편집 days 시드) + PUT(저장) 훅 seam — 그 아래 codegen 은 계약 테스트 몫.
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: () => ({
    data: mockItinerary,
    isPending: mockItinerary === undefined,
    isError: false,
  }),
  usePutTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  router: { push: mockPush, back: mockBack },
}));

const TRIP_ID = 't1';

/** 비고정 슬롯 1개짜리 일정 — 저장 봉투·얼굴 판정의 최소 픽스처. */
const ITINERARY: Itinerary = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'MINIMAL',
  generationMode: 'MANUAL',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-11',
      slots: [
        {
          poiId: 'poi-a',
          startAt: '13:00:00',
          endAt: '14:30:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          nameKo: '부산시립미술관',
          tags: [],
        },
      ],
    },
  ],
};

beforeEach(() => {
  mockItinerary = ITINERARY;
  mockMutate.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('🔴 I1 · ★봉합 — variant 기본(i15)엔 폴백/누락 배너가 없다', () => {
  it('루트가 뜨고(짝) 누락 배너 testID 는 없다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} />);

    // 루트 존재 짝 — 화면이 그 픽스처로 실제 렌더됐다(오타 testID 공허통과 차단).
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();

    // MANUAL 은 isFallback=false(선택) — 폴백/누락 배너는 어느 계약으로도 안 뜬다.
    expect(screen.queryByTestId('planb-manual-missing-data')).toBeNull();
  });
});

describe('🔴 I2 · param→face — variant=error 면 i22 누락 배너를 흘린다', () => {
  it('페이지가 variant 를 화면에 전달해 누락 배너가 뜬다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} variant="error" />);

    expect(screen.getByTestId('planb-manual-missing-data')).toBeOnTheScreen();
  });
});

describe('🔴 I3 · 저장 배선 — [저장]이 편집 봉투를 PUT 한다', () => {
  it('save press 시 mutate 가 {tripId, data:{days}} 로 1회 나간다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} variant="error" />);

    fireEvent.press(screen.getByTestId('planb-manual-save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: { days?: unknown };
    };
    expect(vars.tripId).toBe(TRIP_ID);
    expect(Array.isArray(vars.data?.days)).toBe(true);
  });
});
