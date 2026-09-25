import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { Share } from 'react-native';
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
 *  - TRIP-755(i10 재작성): 하단 [일정에서 보기]/[길찾기]·"지금 여기"는 없고, 원형 뒤로는 히스토리가
 *    있으면 back·없으면(콜드 딥링크) 여행 중 허브로 replace(I3 — TRIP-939 I3 반전). 운영 조립은 주소·
 *    입장료를 "미확인"으로, 카피·사진 섹션은 안 그린다(I6). 공유는 OS 공유 시트에 장소명(I7). 하트는
 *    저장 요청 없이 "준비 중" 한 줄만(I8).
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

// 원형 뒤로 → 히스토리 있으면 back, 없으면 허브로 replace(TRIP-755 Q7). 구현이 정적 `router`
// 싱글턴을 쓰든 `useRouter()` 훅을 쓰든 같은 목 함수에 닿게 둘 다 제공한다(02a D-e · ★10).
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => {
  const routerMock = {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: (...args: unknown[]) => mockCanGoBack(...args),
    push: jest.fn(),
  };
  return { router: routerMock, useRouter: () => routerMock };
});

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

// 요청 로그(I8 — 하트가 저장 요청을 보내지 않는지). 리스너는 한 번만 걸고 매 테스트 비운다(savedStays 선례).
let requestLog: string[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    requestLog.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  requestLog = [];
  setAccessToken('a');
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockBack.mockClear();
  mockReplace.mockClear();
});
afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

// 정상 조회 핸들러를 걸고 p1 상세가 설 때까지 기다린다(I3·I6~I8 공통 준비).
async function renderP1(): Promise<void> {
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    )
  );
  render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });
  await waitFor(() =>
    expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
  );
}

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

  it('I3 (TRIP-939 반전) 하단 CTA·"지금 여기"는 없고, 원형 뒤로는 히스토리가 있으면 back · 없으면 허브로 replace (TRIP-755 AC-1·AC-6)', async () => {
    // 준비 ① — 앱 안에서 들어온 경우(히스토리 있음, beforeEach 기본값 true).
    await renderP1();

    // 단언(부재) — 옛 하단 바·"지금 여기".
    expect(screen.queryByTestId('execution-place-cta-itinerary')).toBeNull();
    expect(screen.queryByTestId('execution-place-cta-directions')).toBeNull();
    expect(screen.queryByTestId('execution-place-here')).toBeNull();

    // 실행·단언 ① — back 1회, replace 0회.
    fireEvent.press(screen.getByTestId('execution-place-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    // 준비 ② — 콜드 딥링크(히스토리 없음).
    mockBack.mockClear();
    mockCanGoBack.mockReturnValue(false);

    // 실행·단언 ② — 갇히지 않게 여행 중 허브로 replace, back 은 안 부른다.
    fireEvent.press(screen.getByTestId('execution-place-back'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/trips/trip-1/live');
    expect(mockBack).not.toHaveBeenCalled();
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

  it('I6 운영 조립 — 주소·입장료는 "미확인", 추천 카피·사진 섹션·사진 수 칩은 그리지 않는다 (TRIP-755 AC-7·AC-8 · INV-1)', async () => {
    // 준비·실행 — 실 조회 데이터(슬롯 계약엔 주소·입장료·카피·사진 수가 없다).
    await renderP1();

    // 단언 ① — 결측은 빈칸이 아니라 "미확인"(BR-U4-40).
    expect(
      screen.getByTestId('execution-place-unknown-address')
    ).toHaveTextContent('미확인');
    expect(screen.getByTestId('execution-place-unknown-fee')).toHaveTextContent(
      '미확인'
    );
    // 단언 ② — 없는 값은 지어내지 않는다.
    expect(screen.queryByTestId('execution-place-pitch')).toBeNull();
    expect(screen.queryByTestId('execution-place-photos')).toBeNull();
    expect(screen.queryByTestId('execution-place-photo-count')).toBeNull();
    // 짝 앵커 — 장소명은 그려졌다.
    expect(screen.getByTestId('execution-place-title')).toHaveTextContent(
      '광안리 해수욕장'
    );
  });

  it('I7 공유 — OS 공유 시트(Share.share)를 { message: 장소명 } 으로 1회 연다 (TRIP-755 AC-5)', async () => {
    // 준비 — RN 내장 공유 함수를 가로챈다(실제 시트는 안 뜬다).
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    await renderP1();

    // 실행
    fireEvent.press(screen.getByTestId('execution-place-share'));

    // 단언 — 운영 주소는 null 이라 장소명만. 인자 객체 완전 일치(다른 키를 덧붙이면 red).
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({ message: '광안리 해수욕장' });
    shareSpy.mockRestore();
  });

  it('I8 하트 — 저장 요청을 보내지 않고 "준비 중" 한 줄만 띄운다 (TRIP-755 AC-4)', async () => {
    // 준비
    await renderP1();

    // 실행
    fireEvent.press(screen.getByTestId('execution-place-save'));

    // 단언 ① — 안내(완전일치) + 선택됨이 아니다.
    expect(screen.getByTestId('execution-place-save-notice')).toHaveTextContent(
      '저장 기능은 준비 중이에요'
    );
    expect(screen.getByTestId('execution-place-save')).not.toBeSelected();

    // 단언 ② — 조회(GET) 외 요청 0건. 도달 앵커: 로그가 실제로 기록되고 있었다(02a ★12).
    await waitFor(() =>
      expect(requestLog).toContain(`GET /api/v1/trips/${TRIP_ID}/itinerary`)
    );
    expect(requestLog.filter((hit) => !hit.startsWith('GET '))).toEqual([]);
  });
});
