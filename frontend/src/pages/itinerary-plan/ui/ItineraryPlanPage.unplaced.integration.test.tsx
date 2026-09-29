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
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
  ItineraryUnplacedMustVisitsItem,
  SavedPlace,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/press/pressGuard';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-1094 · h14 완성(PLANNED)·h16 확정(CONFIRMED) 셸이 "넣지 못한 꼭 갈 곳"을 시트 맨 위 블록으로
 * 말하는지 실 HTTP 로 태운다. 두 얼굴은 같은 listed 셸 하나라 이 파일이 둘 다 잰다.
 *
 * 무엇을 보장하나:
 *  - 🔴 블록이 헤더 뒤·첫 카드 앞에 서고(확정 실패 안내가 있으면 그 뒤), 항목마다 담은 장소 이름 + 서버
 *    문구, 이름을 못 찾으면 문구만 보인다(AC-1·2·3 · Q5).
 *  - 🔴 미배치는 여행 전체 단위라 일차 탭을 바꿔도 같은 블록이 남는다(AC-1).
 *  - 🔴 담은 장소 조회가 실패해도 문구는 남는다(AC-3 · INV-4). 미배치 0건이면 조회 0회(AC-13).
 *
 * 기존 ItineraryPlanPage.* 11파일은 건드리지 않으려고 새 파일로 뒀다(다른 레인이 같은 페이지를 만진다).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+칩·CTA press) → 단언=testID·글자·요청 수.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// 확정 셸의 [공유하기] 게이트를 고정한다(confirmed 테스트 선례) — 이 파일의 단언과 무관한 CTA 흔들림 차단.
jest.mock('@/features/reflection/model/shareCapture', () => ({
  ...jest.requireActual('@/features/reflection/model/shareCapture'),
  isShareCaptureArmed: () => false,
}));

const BASE = 'http://localhost:8080/api/v1';
const SAVED_PATH = '/api/v1/saved-places';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const WAIT = { timeout: 4000 };

const BLOCK = 'itinerary-unplaced-mustvisit';
const ITEM_PREFIX = /^itinerary-unplaced-mustvisit-/;
const CONFIRM_ERROR = 'itinerary-confirm-error';

const MSG_NO_SLOT =
  '남은 시간과 이동을 고려하면 넣을 자리가 없었어요. 시각 고정을 풀거나 일정을 줄여 보세요.';
const MSG_WINDOW =
  '다른 필수 방문지와 시간이 겹쳐 넣지 못했어요. 한쪽 시각을 옮겨 주세요.';
const DURATION_TEXT = /\d+\s*(분|시간)|소요/;

const UNPLACED: ItineraryUnplacedMustVisitsItem[] = [
  { poiId: 'poi-mv-1', reasonCode: 'NO_FEASIBLE_SLOT', message: MSG_NO_SLOT },
  { poiId: 'poi-mv-2', reasonCode: 'WINDOW_CONFLICT', message: MSG_WINDOW },
];
const NAME_1 = '해동용궁사';

const itemId = (poiId: string): string => `${BLOCK}-${poiId}`;
const cardId = (date: string, poiId: string): string =>
  `slot-stopcard-${buildSlotKey(date, poiId)}`;

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: DAY1,
    endDate: DAY2,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 2,
  };
}

function slot(poiId: string, startAt: string): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt,
    endAt: startAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: `장소-${poiId}`,
    category: '자연',
    distanceRange: null,
    lat: 35.15,
    lng: 129.11,
  };
}

function itinerary(input: {
  status?: ItineraryStatus;
  unplaced?: ItineraryUnplacedMustVisitsItem[];
}): Itinerary {
  return {
    itineraryId: 'itin-1094',
    tripId: TRIP_ID,
    status: input.status ?? 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      {
        date: DAY1,
        slots: [slot('poi-a', '10:00:00'), slot('poi-b', '13:00:00')],
      },
      { date: DAY2, slots: [slot('poi-c', '10:00:00')] },
    ],
    ...(input.unplaced === undefined
      ? {}
      : { unplacedMustVisits: input.unplaced }),
  };
}

function savedPlace(poiId: string, nameKo: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: {
      poiId,
      nameKo,
      category: '명소',
      lat: 35.15,
      lng: 129.11,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    },
  };
}

let itineraryScript: () => Itinerary;
let savedScript: () => Response;
let observed: { method: string; url: string }[] = [];

function savedHits(): number {
  return observed.filter(
    (hit) => hit.method === 'GET' && new URL(hit.url).pathname === SAVED_PATH
  ).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

// 모듈 전역 상태(연타 가드 창)는 파일 최상위에서 닫는다 — describe 안에만 걸면 앞 테스트 창이 샌다(02a ★12).
beforeEach(() => {
  resetPressGuard();
  observed = [];
  setAccessToken('valid-access');
  savedScript = () => HttpResponse.json([savedPlace('poi-mv-1', NAME_1)]);
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryScript())
    ),
    http.get(`${BASE}/saved-places`, () => savedScript()),
    http.post(
      `${BASE}/trips/:tripId/itinerary/confirm`,
      () => new HttpResponse(null, { status: 500 })
    )
  );
});

afterEach(() => {
  resetPressGuard();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage(): { client: QueryClient } {
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
  render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  return { client };
}

function treeOrder(ids: string[]): string[] {
  const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return screen
    .getAllByTestId(new RegExp(`^(${escaped.join('|')})$`))
    .map((node) => String(node.props.testID));
}

function itemIds(): string[] {
  return within(screen.getByTestId(BLOCK))
    .queryAllByTestId(ITEM_PREFIX)
    .map((node) => String(node.props.testID));
}

async function settle(client: QueryClient, savedCount: number): Promise<void> {
  await waitFor(() => {
    expect(savedHits()).toBe(savedCount);
    expect(client.isFetching()).toBe(0);
  }, WAIT);
}

/** 이름 해소된 1번 + 문구만인 2번 — 한 화면에서 두 얼굴을 함께 잰다. */
async function expectNamedAndUnnamed(): Promise<void> {
  expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
  const first = screen.getByTestId(itemId('poi-mv-1'));
  expect(await within(first).findByText(NAME_1, {}, WAIT)).toBeOnTheScreen();
  expect(first).toHaveTextContent(`${NAME_1}${MSG_NO_SLOT}`);
  expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(MSG_WINDOW);
}

describe('🔴 L1 · AC-1·2·3·11·13 · Q5 — h14 완성 셸 시트 맨 위에 블록이 선다', () => {
  it('헤더 뒤·첫 카드 앞 · CTA 밖 · 이름 있음/없음 · 소요시간 0 · 담은 장소 1회 조회', async () => {
    itineraryScript = () => itinerary({ unplaced: UNPLACED });

    const { client } = renderPage();

    const block = await screen.findByTestId(BLOCK, {}, WAIT);
    expect(
      within(screen.getByTestId('map-sheet-shell-root')).getByTestId(BLOCK)
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-cta-root')).queryByTestId(BLOCK)
    ).toBeNull();
    await expectNamedAndUnnamed();

    expect(
      treeOrder(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')])
    ).toEqual(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')]);
    expect(block).not.toHaveTextContent(DURATION_TEXT);

    await settle(client, 1);
  });
});

describe('🔴 L2 · AC-1 — 미배치는 여행 전체 단위라 일차 탭을 바꿔도 블록이 그대로다', () => {
  it('2일차 칩을 누르면 2일차 카드가 보이고 블록·항목 2 가 남는다', async () => {
    itineraryScript = () => itinerary({ unplaced: UNPLACED });

    renderPage();
    await screen.findByTestId(BLOCK, {}, WAIT);

    fireEvent.press(screen.getByTestId('sheet-daychip-1'));

    expect(
      await screen.findByTestId(cardId(DAY2, 'poi-c'), {}, WAIT)
    ).toBeOnTheScreen();
    expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
    expect(
      treeOrder(['sheet-header-root', BLOCK, cardId(DAY2, 'poi-c')])
    ).toEqual(['sheet-header-root', BLOCK, cardId(DAY2, 'poi-c')]);
  });
});

describe('🔴 L3 · AC-1 — h16 확정 셸에도 같은 블록이 선다', () => {
  it('CONFIRMED → meta 「확정됨 · 」 앵커 · 블록 항목 2 · 헤더 뒤·첫 카드 앞', async () => {
    itineraryScript = () =>
      itinerary({ status: 'CONFIRMED', unplaced: UNPLACED });

    renderPage();

    // 확정 얼굴 착지 앵커(confirmed 테스트 ★2 선례).
    await waitFor(
      () =>
        expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
          /^확정됨 · /
        ),
      WAIT
    );
    expect(await screen.findByTestId(BLOCK, {}, WAIT)).toBeOnTheScreen();
    await expectNamedAndUnnamed();
    expect(
      treeOrder(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')])
    ).toEqual(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')]);
  });
});

describe('🔴 L4 · AC-3 · INV-4 — 담은 장소 조회가 실패해도 서버 문구는 남는다', () => {
  it('/saved-places 500 → 조회가 끝난 뒤에도 두 항목이 문구만 보인다', async () => {
    itineraryScript = () => itinerary({ unplaced: UNPLACED });
    savedScript = () => new HttpResponse(null, { status: 500 });

    const { client } = renderPage();
    await screen.findByTestId(BLOCK, {}, WAIT);
    await settle(client, 1);

    expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
    expect(screen.getByTestId(itemId('poi-mv-1'))).toHaveTextContent(
      MSG_NO_SLOT
    );
    expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(
      MSG_WINDOW
    );
    expect(screen.queryByText('이름을 불러오지 못한 곳')).toBeNull();
  });
});

// 5-b 참고 R1 — 두 페이지에 같은 조회 조건이 복사돼 있어 한쪽만 로그인 조건을 잃어도 조용히 샌다.
// 초안(D4)과 같은 심판을 이 페이지에도 건다: 준비 = 토큰 없음 + 미배치 2건 → 실행 = 화면 열기 →
// 단언 = /saved-places 0회 · 두 항목이 문구만으로 보인다.
describe('🔴 L4b · Q4 — 게스트는 담은 장소를 조회하지 않고, 문구는 그대로 보인다', () => {
  it('토큰 없음 → /saved-places 0회 · 두 항목 문구만', async () => {
    clearAccessToken();
    itineraryScript = () => itinerary({ unplaced: UNPLACED });

    const { client } = renderPage();
    await screen.findByTestId(BLOCK, {}, WAIT);
    await settle(client, 0);

    expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
    expect(screen.getByTestId(itemId('poi-mv-1'))).toHaveTextContent(
      MSG_NO_SLOT
    );
    expect(screen.queryByText(NAME_1)).toBeNull();
  });
});

describe('L5 · AC-7·AC-13 — 미배치가 0건이면 블록도, 담은 장소 조회도 없다 (선제 green 트립와이어)', () => {
  it.each([
    ['빈 배열', [] as ItineraryUnplacedMustVisitsItem[]],
    ['필드 없음', undefined],
  ])('%s → 블록 0 · /saved-places 0회', async (_label, unplaced) => {
    itineraryScript = () => itinerary({ unplaced });

    const { client } = renderPage();

    expect(
      await screen.findByTestId(cardId(DAY1, 'poi-a'), {}, WAIT)
    ).toBeOnTheScreen();
    await settle(client, 0);

    expect(screen.queryByTestId(BLOCK)).toBeNull();
  });
});

describe('🔴 L6 · Q5 — 확정 실패 안내가 뜨면 블록은 그 뒤·첫 카드 앞이다', () => {
  it('「일정 저장하기」 → POST 500 → 확정 실패 안내 → 블록 → 첫 카드', async () => {
    itineraryScript = () => itinerary({ unplaced: UNPLACED });

    renderPage();
    await screen.findByTestId(BLOCK, {}, WAIT);

    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

    expect(
      await screen.findByTestId(CONFIRM_ERROR, {}, WAIT)
    ).toBeOnTheScreen();
    expect(treeOrder([CONFIRM_ERROR, BLOCK, cardId(DAY1, 'poi-a')])).toEqual([
      CONFIRM_ERROR,
      BLOCK,
      cardId(DAY1, 'poi-a'),
    ]);
  });
});
