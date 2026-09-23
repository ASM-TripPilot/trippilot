import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-754 · AC-6·7·8 · Q5 — i08 변경 반영 시트의 **허브 페이지 배선**을 실 HTTP 로 태운다.
 *
 * 무엇을 보장하나:
 *  - `appliedSessionId` 가 있고 일정이 active 일 때만 시트가 **허브 밖 형제로** 뜬다. 로딩 중에는 기다렸다가
 *    뜨고, 오류·404·여행 밖이면 뜨지 않는다. 라이브에는 부제·배지·내역이 없다(E4).
 *  - applied 로 들어오면 허브는 펼침(index 2)으로 시작한다(Q5). 대조군은 기본 1.
 *  - [확인]·스크림 → `router.setParams({ applied: undefined })` 1회, 화면 이동 0(쿼리 신호를 지운다).
 *  - [되돌리기] → 시트 안에 "이미 반영돼 되돌릴 수 없어요". 서버 쓰기(POST) 0, 시트는 그대로(E2 · Q3 멱등).
 *
 * 왜 통합 버킷인가: 열림 조건이 실 조회 상태(loading→active)와 prop 의 조합에서 갈린다(riskSheet 선례).
 *
 * ⚠️ 통과형 시트 목 사각: 열림은 마운트 여부로만 잰다. 목 setParams 는 URL 을 안 바꾸므로 닫힌 뒤 시트가
 * 사라지는지는 여기서 보지 않는다(02a ★17 — 6-b 실기).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 정적 싱글턴 router 목 — 이동 4종 + setParams. 렌더 중엔 부르지 않는다.
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: (...args: unknown[]) => mockBack(...args),
    setParams: (...args: unknown[]) => mockSetParams(...args),
    canGoBack: () => true,
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const SESSION_ID = 's1';

const baseSlot = {
  endAt: '18:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  distanceRange: null,
  tags: [],
  category: null,
  openingHours: null,
};

const itinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: TODAY,
        slots: [
          {
            ...baseSlot,
            poiId: 'p0',
            startAt: '09:30:00',
            nameKo: '감천문화마을',
          },
          {
            ...baseSlot,
            poiId: 'p1',
            startAt: '17:00:00',
            nameKo: 'F1963 복합문화공간',
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

const trip = () => ({
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: TODAY,
  endDate: TODAY,
  party: 2,
  destinations: [{ seq: 1, region: '부산', nights: 0 }],
  status: 'PLANNED',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

const itineraryHandler = () =>
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(itinerary())
  );
const restHandlers = () => [
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
  http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
    HttpResponse.json({ visits: [] })
  ),
  http.get(`${BASE}/trips/:tripId/triggers`, () =>
    HttpResponse.json({ triggers: [] })
  ),
];

let observedHits: string[] = [];
const postHits = () => observedHits.filter((hit) => hit.startsWith('POST '));

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  observedHits = [];
  setAccessToken('a');
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  [mockPush, mockReplace, mockNavigate, mockBack, mockSetParams].forEach((fn) =>
    fn.mockClear()
  );
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const HUB = 'execution-live-screen';
const SHEET = 'planb-applied-sheet';
const NOTICE = 'planb-applied-revert-notice';

/** 음성 단언("안 나갔다") 전에 요청이 나갈 틈을 준다(748 02a ★10). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/** 준비 공통 — 성공 조회 핸들러로 페이지를 띄우고 허브가 뜰 때까지 기다린다. */
async function renderHub(appliedSessionId?: string): Promise<void> {
  server.use(itineraryHandler(), ...restHandlers());
  render(
    <LiveItineraryPage
      tripId={TRIP_ID}
      today={TODAY}
      appliedSessionId={appliedSessionId}
    />,
    { wrapper }
  );
  await waitFor(() => expect(screen.getByTestId(HUB)).toBeTruthy());
}

/** 허브(셸) 시트가 받은 초기 스냅 index — 허브 서브트리 안에서만 센다(02a ★15). */
function hubSnapIndices(): number[] {
  return screen
    .getByTestId(HUB)
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map((node) => node.props.index as number);
}

/** 화면 이동 4종이 한 번도 불리지 않았다. */
function expectNoNavigation(): void {
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
}

describe('🔴 A1·A2 · AC-6 — applied 신호가 있으면 허브 밖 형제로 시트가 뜬다', () => {
  it('A1 라벨·제목·두 버튼만 있고 부제·배지·내역은 없다 (E4)', async () => {
    await renderHub(SESSION_ID);

    const sheet = screen.getByTestId(SHEET);
    expect(sheet).toBeTruthy();
    expect(within(screen.getByTestId(HUB)).queryByTestId(SHEET)).toBeNull();
    expect(screen.getByTestId('planb-applied-eyebrow')).toHaveTextContent(
      '변경 반영됨'
    );
    expect(screen.getByTestId('planb-applied-title')).toHaveTextContent(
      '새 일정이 반영됐어요'
    );
    expect(screen.getByTestId('planb-applied-revert')).toBeTruthy();
    expect(screen.getByTestId('planb-applied-confirm')).toBeTruthy();

    expect(screen.queryByTestId('planb-applied-subtitle')).toBeNull();
    expect(screen.queryByTestId('planb-applied-summary')).toBeNull();
    expect(screen.queryByTestId('planb-applied-diff')).toBeNull();
    expect(screen.queryByTestId(NOTICE)).toBeNull();
    // 뜨는 것만으로 아무 데도 가지 않고 쿼리도 건드리지 않는다.
    expectNoNavigation();
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('A2 신호가 없으면 시트도 없다 (허브는 그대로)', async () => {
    await renderHub();

    expect(screen.getByTestId(HUB)).toBeTruthy();
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});

describe('🔴 A3·A4 · AC-6 — active 일정에서만 뜬다', () => {
  it('A3 로딩 중에는 없고, 허브가 뜬 뒤에 나타난다', async () => {
    server.use(itineraryHandler(), ...restHandlers());

    render(
      <LiveItineraryPage
        tripId={TRIP_ID}
        today={TODAY}
        appliedSessionId={SESSION_ID}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('execution-live-loading')).toBeTruthy();
    expect(screen.queryByTestId(SHEET)).toBeNull();

    await waitFor(() => expect(screen.getByTestId(HUB)).toBeTruthy());
    expect(screen.getByTestId(SHEET)).toBeTruthy();
  });

  it.each([
    [
      '일정 조회 오류',
      () =>
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json({ message: 'boom' }, { status: 500 })
        ),
      TODAY,
      'execution-live-error',
    ],
    [
      '일정 없음(404)',
      () =>
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json({ message: 'none' }, { status: 404 })
        ),
      TODAY,
      'execution-live-notfound',
    ],
    [
      '오늘이 여행 밖',
      itineraryHandler,
      '2026-09-01',
      'execution-live-outside',
    ],
  ])(
    'A4 %s 이면 그 얼굴만 있고 시트는 없다',
    async (_label, handler, today, face) => {
      server.use(handler(), ...restHandlers());

      render(
        <LiveItineraryPage
          tripId={TRIP_ID}
          today={today}
          appliedSessionId={SESSION_ID}
        />,
        { wrapper }
      );

      await waitFor(() => expect(screen.getByTestId(face)).toBeTruthy());
      expect(screen.queryByTestId(SHEET)).toBeNull();
    }
  );
});

describe('🔴 A5·A6 · AC-7 — 닫기 = applied 쿼리 제거, 이동 없음', () => {
  it('A5 [확인] → setParams({ applied: undefined }) 1회 · 이동 0', async () => {
    await renderHub(SESSION_ID);

    fireEvent.press(screen.getByTestId('planb-applied-confirm'));

    expect(mockSetParams).toHaveBeenCalledTimes(1);
    // 키가 있고 값이 undefined 여야 쿼리가 지워진다 — `{}` 는 병합이라 무동작(02a ★2).
    expect(mockSetParams.mock.calls[0][0]).toStrictEqual({
      applied: undefined,
    });
    expectNoNavigation();
  });

  it('A6 스크림 → [확인]과 같다 (Q1)', async () => {
    await renderHub(SESSION_ID);

    fireEvent.press(screen.getByTestId('planb-applied-scrim'));

    expect(mockSetParams).toHaveBeenCalledTimes(1);
    expect(mockSetParams.mock.calls[0][0]).toStrictEqual({
      applied: undefined,
    });
    expectNoNavigation();
  });
});

describe('🔴 A7 · AC-8 — [되돌리기]는 정직 안내만, 서버 쓰기 0 (E2 · Q3)', () => {
  it('안내가 시트 안에 뜨고 시트는 그대로 · setParams 0 · 이동 0 · POST 0 · 다시 눌러도 같다', async () => {
    await renderHub(SESSION_ID);
    // 짝 앵커 — 요청 관측 배선이 살아 있다.
    expect(
      observedHits.filter(
        (hit) => hit === `GET /api/v1/trips/${TRIP_ID}/itinerary`
      ).length
    ).toBeGreaterThanOrEqual(1);

    fireEvent.press(screen.getByTestId('planb-applied-revert'));
    await settle();

    const sheet = screen.getByTestId(SHEET);
    expect(within(sheet).getByTestId(NOTICE)).toHaveTextContent(
      '이미 반영돼 되돌릴 수 없어요'
    );
    expect(mockSetParams).not.toHaveBeenCalled();
    expectNoNavigation();
    expect(postHits()).toEqual([]);

    // Q3 멱등 — 다시 눌러도 안내 한 줄, 버튼 그대로.
    fireEvent.press(screen.getByTestId('planb-applied-revert'));
    await settle();

    expect(screen.getAllByTestId(NOTICE)).toHaveLength(1);
    expect(screen.getByTestId('planb-applied-revert')).toBeTruthy();
    expect(screen.getByTestId('planb-applied-confirm')).toBeTruthy();
    expect(postHits()).toEqual([]);
  });
});

describe('🔴 A8 · Q5 — applied 로 들어오면 허브는 펼침으로 시작한다', () => {
  it('applied 면 허브 스냅 index 가 전부 2', async () => {
    await renderHub(SESSION_ID);

    const indices = hubSnapIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(2));
  });

  it('A8b 닫혀서 applied 가 사라져도(rerender) 시트는 없어지고 허브는 펼침 2 를 유지한다', async () => {
    await renderHub(SESSION_ID);
    expect(screen.getByTestId(SHEET)).toBeTruthy();

    // URL 에서 applied 가 지워진 뒤를 prop 으로 직접 만든다(목 setParams 는 URL 을 안 바꾼다).
    screen.rerender(
      <LiveItineraryPage
        tripId={TRIP_ID}
        today={TODAY}
        appliedSessionId={undefined}
      />
    );

    expect(screen.getByTestId(HUB)).toBeTruthy();
    expect(screen.queryByTestId(SHEET)).toBeNull();
    const indices = hubSnapIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(2));
  });

  it('대조군 — 신호가 없으면 기본 중간 스냅 1', async () => {
    await renderHub();

    const indices = hubSnapIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(1));
  });
});
