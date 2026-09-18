import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LivePlacePage } from './LivePlacePage';

/**
 * TRIP-398 · LivePlacePage(i05) 배선을 실 HTTP로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - GET /trips/{id}/itinerary 슬롯에서 poiId 를 찾아 상세 화면을 그린다(I1, AC-1).
 *  - poiId 가 어느 슬롯에도 없으면 "장소를 찾을 수 없어요" 얼굴(I2, AC-7·D8) — 상세 화면 아님.
 *  - [일정에서 보기]는 router.back, [길찾기]는 무동작(I3, D7).
 *  - 익일 고정 슬롯이 오늘의 slack 을 오염시키지 않는다(I4, 5-b 경고-1 봉합, red-first).
 *  - 조회 로딩 창에서 notFound 가 깜빡이지 않고 loading 얼굴이 선다(I5, 5-b 경고-3 봉합).
 *
 * 왜 통합 버킷인가: buildPlaceDetailView 의 poiId 탐색·slack 조립이 실 조회 데이터에서 갈리므로,
 * 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// [일정에서 보기] → page 가 정적 `router.back()` 으로 라이브 일정으로 돌아간다(D7,
// LiveItineraryPage 정적 싱글턴 선례). 목이 `router` 객체를 제공해야 한다(useRouter 훅 아님).
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';

const itinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: '2026-08-20',
        slots: [
          {
            poiId: 'p1',
            startAt: '14:20:00',
            endAt: '15:30:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '광안리 해수욕장',
            openingHours: '09:00~22:00 (상시 개방)',
            openingHoursKnown: true,
            tags: ['해변', '포토스팟'],
          },
          {
            poiId: 'p2',
            startAt: '17:00:00',
            endAt: '18:30:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '부산시립미술관',
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

// I4 전용 — 여행이 **2일**이고 익일(day2)에만 고정 슬롯이 있다. day1 의 p1 을 딥링크로 열면,
// "여행 전체 슬롯 평탄화"는 익일 p2 를 다음 고정으로 잘못 골라 slack 부호가 뒤집힌다(경고-1).
// 당일 슬롯만 보면 day1 에 다음 고정이 없어 slack 은 '미확인'(V-4 균일)이어야 한다.
const crossdayItinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: '2026-08-20',
        slots: [
          {
            poiId: 'p1',
            startAt: '14:20:00',
            endAt: '15:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '광안리 해수욕장',
            openingHours: '09:00~22:00',
            openingHoursKnown: true,
            tags: ['해변'],
            lat: 35.1,
            lng: 129.1,
            imageUrl: null,
          },
        ],
      },
      {
        date: '2026-08-21',
        slots: [
          {
            poiId: 'p2',
            startAt: '09:00:00',
            endAt: '10:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '부산시립미술관',
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => setAccessToken('a'));
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockBack.mockClear();
});
afterAll(() => server.close());

describe('LivePlacePage', () => {
  it('I1 poiId 가 슬롯에 있으면 상세 화면(영업시간·slack)을 그린다 (AC-1)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );
    expect(screen.getByTestId('execution-place-openhours')).toHaveTextContent(
      '09:00~22:00 (상시 개방)'
    );
    expect(screen.getByTestId('execution-place-slack')).toHaveTextContent(
      '여유 있음 · 다음 부산시립미술관'
    );
  });

  it('I2 poiId 가 어느 슬롯에도 없으면 "장소를 찾을 수 없어요" 얼굴 (AC-7·D8)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    render(<LivePlacePage tripId={TRIP_ID} poiId="ghost" />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-place-notfound')).toHaveTextContent(
        /장소를 찾을 수 없어요/
      )
    );
    // 상세 화면으로 새지 않는다.
    expect(screen.queryByTestId('execution-place-detail')).toBeNull();
  });

  it('I3 [일정에서 보기]는 router.back, [길찾기]는 무동작 (D7)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('execution-place-cta-itinerary'));
    expect(mockBack).toHaveBeenCalledTimes(1);

    // 길찾기는 라우팅하지 않는다(US-ONTRIP-03 소관, 이번엔 자리만).
    fireEvent.press(screen.getByTestId('execution-place-cta-directions'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('I4 익일 고정 슬롯이 오늘의 slack 을 오염시키지 않는다 — 다음 고정 없음이면 "미확인" (경고-1)', async () => {
    // Arrange — 여행이 2일. day1 의 p1(딥링크 대상)은 오늘 슬롯, 다음 고정은 **익일** day2 의 p2 뿐.
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(crossdayItinerary())
      )
    );

    // Act — 오늘(day1)의 p1 상세를 연다.
    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );

    // Assert — 당일 슬롯만 보면 다음 고정이 없으므로 slack 은 '미확인'(V-slack-4 균일).
    // *(현재 코드는 전체 일자 평탄화로 익일 p2 를 다음 고정으로 잘못 골라 부호가 뒤집힌
    //   '여유 없음 · 다음 부산시립미술관'을 내므로 red — 당일 슬롯만 넘기는 5-c 수정 후 green.)*
    expect(screen.getByTestId('execution-place-slack')).toHaveTextContent(
      '미확인'
    );
  });

  it('I5 조회 로딩 창에서는 loading 얼굴만 서고 notFound·detail 은 아직 없다 (경고-3)', async () => {
    // Arrange — 정상(200) 핸들러지만 초기 렌더는 아직 pending 이다. 영영 pending(무한 지연)은
    // jest 프로세스를 붙잡아 leak 을 내므로, settle 되는 핸들러로 **로딩 창만** 쓴다
    // (ItineraryPlanPage.escape AC-7 선례).
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    // Act — 렌더 직후, msw 가 settle 하기 전의 **동기 초기 렌더**를 그대로 잰다(waitFor 없음).
    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    // Assert — 로딩 가드가 선행하므로 loading 만 있고, notFound·detail 은 아직 없다.
    // *(isPending 블록을 지우면 data 미도착 중 slots=[]→null→notFound 로 접혀 이 셋이 뒤집힌다.)*
    expect(screen.getByTestId('execution-place-loading')).toBeTruthy();
    expect(screen.queryByTestId('execution-place-notfound')).toBeNull();
    expect(screen.queryByTestId('execution-place-detail')).toBeNull();

    // 정리 — 쿼리를 settle 시켜 teardown 의 dangling promise·act 경고를 없앤다(단언 아님).
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );
  });
});
