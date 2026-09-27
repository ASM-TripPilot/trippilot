import type { ReactElement, ReactNode } from 'react';
import { Text } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { resolveItineraryDestination } from '@/features/itinerary/model/planState';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-1015 A · 생성이 끝났는데 홈 히어로가 "일정 만들기"로 남던 결함(QA #046 · US-SHELL-02).
 *
 * 원인: 생성 성공 처리가 `mutate(vars, { onSuccess })` 자리에만 있었다. 그 콜백은 **화면이 붙어 있을
 * 때만** 불린다(TanStack `mutationObserver` — 구독자가 없으면 건너뛴다). 생성 화면 뒤로(=홈으로 이탈)
 * 한 뒤 POST 가 끝나면 아무도 일정 캐시를 고치지 않아, 홈이 들고 있던 404("아직 일정 없음")가 남는다.
 *
 * 무엇을 보장하나:
 *  - 🔴 H1 생성 화면을 **떠난 뒤** POST 가 성공해도, 같은 QueryClient 에서 그 여행 일정을 구독하던
 *    쪽(홈 대역)이 새 일정을 본다 → 목적지가 'method'(방식 선택)가 아니라 'generating' 이다.
 *    화면이 떠났으니 이동(replace)은 0회다 — 이 0회가 "이탈 경로를 정말 재현했다"는 앵커다.
 *  - 🔴 H2 화면에 **머문 채** 성공해도 같은 캐시가 갱신되고, 이동은 지금처럼 draft 로 1회다(무회귀).
 *
 * 왜 이렇게 테스트하나:
 *  - 홈 화면 전체를 렌더하지 않고 **홈과 같은 훅(`useGetTripsTripIdItinerary`) + 같은 판정
 *    (`resolveItineraryDestination`)** 을 쓰는 작은 대역(HomeProbe)을 둔다. 홈이 보는 것은 결국
 *    "그 키의 캐시 → 목적지" 하나라서, 대역이 같은 키를 구독하면 홈이 볼 값을 그대로 본다.
 *  - 캐시를 직접 써 넣든(setQueryData) 무효화해 다시 묻든(invalidateQueries) 둘 다 통과하게 짰다 —
 *    가짜 서버의 GET 도 생성이 끝난 뒤엔 새 일정을 돌려준다. 단 **수정이 뮤테이션 쪽에 있어야** 한다:
 *    이 파일은 자체 QueryClient 를 쓰므로 앱 전역 QueryClient 설정에 넣은 수정은 여기서 안 보인다
 *    (02a §2-A 판정).
 *  - MSW(가짜 서버)를 쓰는 이유: 훅을 목하면 "화면이 떠나면 콜백이 안 불린다"는 라이브러리 동작 자체가
 *    사라진다 — 진짜 react-query 와 진짜 네트워크 경로를 태워야 이 결함이 재현된다.
 *
 * 3동작: 준비 = 느린 생성 POST + 404 인 일정 GET → 실행 = 생성 화면을 열고(떠나고) POST 를 풀어 준다 →
 * 단언 = 홈 대역이 본 목적지·이동 횟수.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: jest.fn(),
    navigate: jest.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '55555555-5555-5555-5555-555555555555';

/** 생성 응답(201) = 1일차가 도착한 일정(PARTIAL). openapi `Itinerary` 필수 필드를 채운다. */
function generatedItinerary(): Itinerary {
  return {
    itineraryId: 'itin-home-cache',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'PARTIAL',
    isFallback: false,
    days: [
      {
        date: '2026-06-10',
        slots: [
          {
            poiId: 'a',
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
    ],
  };
}

/** 케이스가 손으로 풀어 주는 생성 POST — 풀기 전까지 응답이 오지 않는다("수 분 걸리는 생성"). */
let releasePost: () => void = () => {};
let generated = false;
let postCalls = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  generated = false;
  postCalls = 0;
  mockPush.mockClear();
  mockReplace.mockClear();
  setAccessToken('valid-access');

  server.use(
    // 일정 GET — 생성이 끝나기 전엔 404(아직 일정 없음), 끝난 뒤엔 새 일정. 수정이 무효화(재조회)
    // 방식이어도 이 핸들러가 새 일정을 돌려주므로 통과한다.
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      generated
        ? HttpResponse.json(generatedItinerary())
        : HttpResponse.json({}, { status: 404 })
    ),
    http.post(`${BASE}/trips/:tripId/itinerary`, async () => {
      postCalls += 1;
      await new Promise<void>((resolve) => {
        releasePost = resolve;
      });
      generated = true;
      return HttpResponse.json(generatedItinerary(), { status: 201 });
    }),
    http.get(`${BASE}/trips/:tripId/must-visits`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
  );
});

afterEach(() => {
  // 매달린 POST 를 풀어 다음 케이스로 새지 않게 한다.
  releasePost();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/**
 * 홈 대역 — 홈 `PlanningHome` 과 같은 훅·같은 판정으로 "지금 캐시라면 히어로가 어디로 보낼까"를 글자로
 * 내보인다. 정착 전(로딩·404 아닌 오류)은 'unsettled'.
 */
function HomeProbe(): ReactElement {
  const itinerary = useGetTripsTripIdItinerary(TRIP_ID);
  const notFound = isNotFound(itinerary.error);
  const settled = !itinerary.isPending && (!itinerary.isError || notFound);
  const destination = settled
    ? resolveItineraryDestination({
        notFound,
        generationState: itinerary.data?.generationState,
        status: itinerary.data?.status,
        generationMode: itinerary.data?.generationMode,
      })
    : 'unsettled';
  return <Text testID="home-probe-destination">{destination}</Text>;
}

/** 생성 화면과 홈 대역을 한 QueryClient 아래 나란히 둔다. `showGenerating=false` = 생성 화면을 떠남. */
function Host({ showGenerating }: { showGenerating: boolean }): ReactElement {
  return (
    <>
      {showGenerating ? (
        <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />
      ) : null}
      <HomeProbe />
    </>
  );
}

function renderHost() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<Host showGenerating />, { wrapper: Wrapper });
}

/** 준비 공통 — 홈 대역이 404 로 정착('method')하고 생성 POST 가 서버에 닿을 때까지 기다린다. */
async function waitUntilGeneratingWithHomeOnMethod(): Promise<void> {
  // 앵커 — 수정 전 상태 그대로 "아직 일정 없음"을 본다(이게 없으면 아래 'generating' 이 공짜일 수 있다).
  await waitFor(() =>
    expect(screen.getByTestId('home-probe-destination')).toHaveTextContent(
      'method'
    )
  );
  await waitFor(() => expect(postCalls).toBe(1));
}

describe('🔴 1015-A · 생성 성공이 홈이 보는 일정 캐시에 닿는다 (QA #046 · US-SHELL-02)', () => {
  it('H1 생성 화면을 떠난 뒤 POST 가 성공해도 홈 대역의 목적지가 method 가 아니라 generating 이다 — 이동은 0회', async () => {
    // 준비
    const view = renderHost();
    await waitUntilGeneratingWithHomeOnMethod();

    // 실행 ① — 생성 화면을 떠난다(앱바 뒤로 = 홈으로 이탈). POST 는 아직 매달려 있다.
    view.rerender(<Host showGenerating={false} />);
    expect(screen.queryByTestId('itinerary-generating-progress')).toBeNull();

    // 실행 ② — 서버가 생성을 끝낸다.
    releasePost();

    // 단언 ① — 홈이 보는 캐시가 새 일정으로 바뀌었다(1일차 도착 = 생성 중 목적지).
    await waitFor(() =>
      expect(screen.getByTestId('home-probe-destination')).toHaveTextContent(
        'generating'
      )
    );
    // 단언 ② — 떠난 화면은 이동을 일으키지 않는다(=이탈 경로를 정말 재현했다는 앵커).
    expect(mockReplace).not.toHaveBeenCalled();
    expect(postCalls).toBe(1);
  });

  it('H2 화면에 머문 채 성공하면 draft 로 replace 1회(무회귀)이고, 홈 대역도 같은 새 일정을 본다', async () => {
    // 준비
    renderHost();
    await waitUntilGeneratingWithHomeOnMethod();

    // 실행
    releasePost();

    // 단언 ① — 지금처럼 초안으로 1회 넘어간다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mockReplace.mock.calls[0][0])).toContain(
      '/itinerary/draft'
    );
    // 단언 ② — 이동은 목(mock)이라 초안 화면이 뜨지 않는다. 그래도 홈이 보는 캐시는 갱신돼 있어야 한다.
    await waitFor(() =>
      expect(screen.getByTestId('home-probe-destination')).toHaveTextContent(
        'generating'
      )
    );
    expect(postCalls).toBe(1);
  });
});
