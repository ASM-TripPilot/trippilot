import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdQueryKey,
} from '@/shared/api/generated/trips/trips';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { flushNotifications } from '@/test-support/flushNotifications';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-1075 · 결정 2(A) — 삭제된 여행의 일정 알림을 눌러 이 화면에 오면 '일정 만들기'라는 거짓 다음
 * 행동 대신 "삭제된 여행" 안내 얼굴(`itinerary-view-trip-deleted`)과 뒤로가기만 보인다(INV-4).
 *
 * 무엇을 보장하나:
 *  - **AC-5**: `GET /trips/{id}` 404 가 판정 근거다. 실제 삭제처럼 두 조회가 모두 404여도, 캐시에 옛
 *    여행 data 가 남아 있어도, 일정 조회가 200이어도 삭제 얼굴이 이긴다. 얼굴 안엔 버튼이 없다.
 *  - **AC-6**: 삭제 얼굴의 뒤로가기는 기존 탈출구 규칙(히스토리 있으면 back, 없으면 홈 replace)이다.
 *  - **AC-7·8(무회귀)**: 여행은 있고 일정만 404면 기존 빈 얼굴 + '일정 만들기'. 여행 500·네트워크
 *    오류는 삭제가 아니다 — 기존 얼굴 그대로.
 *
 * 얼굴은 훅 목이 아니라 실 HTTP(msw)로 강제한다 — 훅을 목하면 얼굴 판정이 테스트의 가정이 된다.
 * 모든 단언은 두 조회가 끝나고 마지막 화면 갱신까지 커밋된 뒤에 한 번 더 본다(02a ★2).
 */

// 캐시 선적재 케이스(D2)가 첫 화면에서 지도+시트 셸을 그리므로 지도를 얇은 가짜로 바꾼다.
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 생성 클라이언트의 인증 계층이 expo-secure-store 를 정적으로 문다 — 목킹(동결 통합테스트와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외다.
// `canGoBack` 이 없으면 옳은 구현도 거짓 red(02a ★6).
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const DAY1 = '2026-06-10';

const DELETED = 'itinerary-view-trip-deleted';
const NOT_FOUND = 'itinerary-view-notfound';
const FAILED = 'itinerary-view-failed';
const CREATE_CTA = 'itinerary-plan-create-cta';
const BACK = 'itinerary-view-back';
const SHELL = 'map-sheet-shell-root';

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: DAY1,
    endDate: '2026-06-11',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function plannedItinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'poi-a',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          alternatives: [],
          tags: [],
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

type Reply = () => Response;
const notFound: Reply = () => new HttpResponse(null, { status: 404 });
const serverError: Reply = () => new HttpResponse(null, { status: 500 });
const networkError: Reply = () => HttpResponse.error();
const tripOk: Reply = () => HttpResponse.json(trip());
const itineraryOk: Reply = () => HttpResponse.json(plannedItinerary());

/** 두 조회의 응답을 케이스마다 정한다. */
function reply(tripReply: Reply, itineraryReply: Reply): void {
  server.use(
    http.get(`${BASE}/trips/:tripId`, tripReply),
    http.get(`${BASE}/trips/:tripId/itinerary`, itineraryReply)
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
});

afterEach(async () => {
  // 테스트 격리 — 인플라이트 조회 취소 + 캐시 비우기(늦게 도착한 응답이 다음 테스트로 새지 않게).
  await activeClient?.cancelQueries();
  activeClient?.clear();
  activeClient = null;
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

let activeClient: QueryClient | null = null;

/**
 * `retry:false` — 실패를 즉시 실패로(앱 전역 `retryUnlessNotFound` 도 404 는 재시도 안 한다, 02a ★5).
 * `gcTime:0` — 기본 타이머가 프로세스를 붙잡지 않게.
 * `seed` — 렌더 **직전 같은 틱**에 캐시를 채운다(gcTime:0 이라 틱을 넘기면 지워진다, 02a ★3).
 */
function renderPage(seed?: (client: QueryClient) => void): QueryClient {
  activeClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const client = activeClient;
  seed?.(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  return client;
}

/** 두 조회가 다 끝나고 마지막 화면 갱신까지 커밋될 때까지 기다린다 — 그 뒤 단언이 최종 얼굴이다. */
async function settle(client: QueryClient): Promise<void> {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await flushNotifications();
}

/** 삭제 얼굴의 최종 모습 — 버튼 0개 · 비공백 글자 2줄 이상 · 다른 얼굴·CTA 없음 · 앱바 뒤로가기 있음. */
function expectDeletedFace(): void {
  const face = screen.getByTestId(DELETED);
  expect(screen.getByTestId(BACK)).toBeOnTheScreen();
  // 어떤 액션 버튼도 없다(testID 하나가 아니라 역할로 — 02a ★7).
  expect(within(face).queryAllByRole('button')).toEqual([]);
  // 문구는 정본이 없어 비공백만 잠근다(Seed Q3).
  const lines = face
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join('').trim())
    .filter((text) => text.length > 0);
  expect(lines.length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByTestId(CREATE_CTA)).toBeNull();
  expect(screen.queryByTestId(NOT_FOUND)).toBeNull();
  expect(screen.queryByTestId(FAILED)).toBeNull();
  expect(screen.queryByTestId(SHELL)).toBeNull();
}

describe('🔴 D1 · AC-5 — 여행·일정 둘 다 404(실제 삭제)면 삭제 얼굴이다', () => {
  it('일정 404 가 이기던 빈 얼굴·일정 만들기 대신 삭제 얼굴과 뒤로가기만 보인다', async () => {
    // 준비 — 소프트 삭제된 여행: 두 조회 모두 404(02a ★1).
    reply(notFound, notFound);

    // 실행.
    const client = renderPage();
    await screen.findByTestId(DELETED);
    await settle(client);

    // 단언 — 두 조회가 끝난 뒤에도 삭제 얼굴이다(깜빡임 뒤 notFound 로 뒤집히지 않음, 02a ★2).
    expectDeletedFace();
  });
});

describe('🔴 D2 · AC-5 — 캐시에 옛 여행 data 가 남아 있어도 조회 오류 404 가 근거다', () => {
  it('선적재된 셸이 먼저 뜨고, 재조회가 둘 다 404 로 끝나면 data 가 남은 채로도 삭제 얼굴이다', async () => {
    // 준비 — 같은 세션에서 전에 연 여행·일정 캐시(삭제는 목록만 무효화한다) + 재조회는 둘 다 404.
    reply(notFound, notFound);

    // 실행 — 캐시를 채운 채 렌더.
    const client = renderPage((c) => {
      c.setQueryData(getGetTripsTripIdQueryKey(TRIP_ID), trip());
      c.setQueryData(
        getGetTripsTripIdItineraryQueryKey(TRIP_ID),
        plannedItinerary()
      );
    });

    // 앵커 — 선적재가 실제로 먹혀 첫 화면은 옛 data 의 셸이다(시나리오 성립 증거).
    expect(screen.getByTestId(SHELL)).toBeOnTheScreen();

    await screen.findByTestId(DELETED);
    await settle(client);

    // 단언 — 최종 얼굴은 삭제 얼굴.
    expectDeletedFace();
    // 자가증명 — 여행 data 는 여전히 캐시에 있다(= "data 없으면 삭제" 판정은 이 경로를 놓친다, 02a ★3).
    expect(client.getQueryData(getGetTripsTripIdQueryKey(TRIP_ID))).toEqual(
      trip()
    );
  });
});

describe('🔴 D3 · AC-5 — 판정 근거는 여행 404 하나다(일정 조회가 200 이어도)', () => {
  it('여행 404 · 일정 200 이면 실패 얼굴이 아니라 삭제 얼굴이다', async () => {
    // 준비 — 여행만 404(D1 과 짝, 02a ★1).
    reply(notFound, itineraryOk);

    // 실행.
    const client = renderPage();
    await screen.findByTestId(DELETED);
    await settle(client);

    // 단언.
    expectDeletedFace();
  });
});

describe('🔴 D4 · AC-6 — 삭제 얼굴 뒤로가기는 기존 탈출구 규칙이다', () => {
  it('히스토리가 있으면 router.back() 한 번(홈 replace 아님)', async () => {
    // 준비 — 삭제 얼굴 + 히스토리 있음.
    reply(notFound, notFound);
    const client = renderPage();
    await screen.findByTestId(DELETED);
    await settle(client);

    // 실행.
    fireEvent.press(screen.getByTestId(BACK));

    // 단언.
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('히스토리가 없으면(딥링크·알림 진입) 홈(/(tabs))으로 replace 한다', async () => {
    // 준비 — 삭제 얼굴 + 히스토리 없음.
    reply(notFound, notFound);
    mockCanGoBack.mockReturnValue(false);
    const client = renderPage();
    await screen.findByTestId(DELETED);
    await settle(client);

    // 실행.
    fireEvent.press(screen.getByTestId(BACK));

    // 단언 — 침묵 무동작도, back+replace 이중 호출도 아니다.
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🟢 D5 · AC-7 무회귀 — 여행은 있고 일정만 404 면 기존 빈 얼굴 + 일정 만들기', () => {
  it('여행 200 · 일정 404 면 notFound 얼굴과 create-cta 가 있고 삭제 얼굴은 없다', async () => {
    // 준비.
    reply(tripOk, notFound);

    // 실행.
    const client = renderPage();
    await screen.findByTestId(NOT_FOUND);
    await settle(client);

    // 단언.
    expect(screen.getByTestId(NOT_FOUND)).toBeOnTheScreen();
    expect(screen.getByTestId(CREATE_CTA)).toBeOnTheScreen();
    expect(screen.queryByTestId(DELETED)).toBeNull();
  });
});

describe('🟢 D6 · AC-8 무회귀 — 404 만 삭제다(여행 500·네트워크 오류는 삭제가 아니다)', () => {
  it.each([
    ['여행 500 · 일정 200', serverError, itineraryOk, FAILED],
    ['여행 500 · 일정 500', serverError, serverError, FAILED],
    ['여행 네트워크 오류 · 일정 200', networkError, itineraryOk, FAILED],
    ['여행 500 · 일정 404', serverError, notFound, NOT_FOUND],
  ])(
    '%s → 기존 얼굴 그대로, 삭제 얼굴 없음',
    async (_label, tripReply, itineraryReply, expectedFace) => {
      // 준비.
      reply(tripReply, itineraryReply);

      // 실행.
      const client = renderPage();
      await screen.findByTestId(expectedFace);
      await settle(client);

      // 단언 — 기존 우선순위(notFound > failed) 그대로이고 삭제로 단정하지 않는다(02a ★4).
      expect(screen.getByTestId(expectedFace)).toBeOnTheScreen();
      expect(screen.queryByTestId(DELETED)).toBeNull();
    }
  );
});
