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
  ItineraryGenerationState,
  ItinerarySolveMode,
  ItineraryUnplacedMustVisitsItem,
  SavedPlace,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1094 · h08 초안 셸이 서버의 "넣지 못한 꼭 갈 곳"을 시트 맨 위 블록으로 말하는지 실 HTTP 로 태운다.
 *
 * 무엇을 보장하나:
 *  - 🔴 COMPLETE 셸 시트에 블록이 헤더 뒤·첫 카드 앞에 서고, 항목마다 담은 장소 이름 + 서버 문구가 보인다.
 *    이름을 못 찾은 항목은 문구만 보인다(AC-1·2·3 · Q5).
 *  - 🔴 담은 장소 조회가 **대기 중·실패·게스트**여도 블록과 문구가 먼저 보인다(Q4 · INV-4).
 *  - 🔴 미배치가 0건이면 `/saved-places` 요청이 0회다 — 이름이 필요할 때만 조회한다(AC-13).
 *  - 🔴 일부 실패 안내·폴백 안내와 함께 뜨고, 폴백 안내 **안이 아니라 형제**다(AC-10 · Q3).
 *  - PARTIAL 진행 셸·폴백 인터스티셜에는 블록이 없다(결정 1).
 *
 * jest 가 못 보는 것: 접힘(peek)에서 블록이 **눈에 보이는지**는 바텀시트 목 사각이다(6-b 프리뷰 몫).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+기본 일정 보기 press) → 단언=testID·글자·요청 수.
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

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const SAVED_PATH = '/api/v1/saved-places';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

/** 네트워크 응답을 기다리는 한도 — 로컬 기본 1000ms 의 CI 러너 환산(fallbackShell 선례). */
const WAIT = { timeout: 4000 };

const BLOCK = 'itinerary-unplaced-mustvisit';
const ITEM_PREFIX = /^itinerary-unplaced-mustvisit-/;
const STALE = 'itinerary-draft-stale-failed';
const BANNER = 'itinerary-draft-fallback-banner';
const SHELL = 'map-sheet-shell-root';

/** 서버 `UnplacedText.kt` 원문. */
const MSG_NO_SLOT =
  '남은 시간과 이동을 고려하면 넣을 자리가 없었어요. 시각 고정을 풀거나 일정을 줄여 보세요.';
const MSG_WINDOW =
  '다른 필수 방문지와 시간이 겹쳐 넣지 못했어요. 한쪽 시각을 옮겨 주세요.';
const DURATION_TEXT = /\d+\s*(분|시간)|소요/;

/** 미배치 2건 — poi-mv-1 은 담은 장소에 있고(이름 해소), poi-mv-2 는 없다(문구만). */
const UNPLACED: ItineraryUnplacedMustVisitsItem[] = [
  { poiId: 'poi-mv-1', reasonCode: 'NO_FEASIBLE_SLOT', message: MSG_NO_SLOT },
  { poiId: 'poi-mv-2', reasonCode: 'WINDOW_CONFLICT', message: MSG_WINDOW },
];
const NAME_1 = '성산일출봉';

const itemId = (poiId: string): string => `${BLOCK}-${poiId}`;
const cardId = (poiId: string): string =>
  `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 3일',
    startDate: DAY1,
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
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
    lat: 33.458,
    lng: 126.942,
  };
}

function itinerary(input: {
  unplaced?: ItineraryUnplacedMustVisitsItem[];
  solveMode?: ItinerarySolveMode;
  isFallback?: boolean;
  generationState?: ItineraryGenerationState;
}): Itinerary {
  return {
    itineraryId: 'itin-1094',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: input.solveMode ?? 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: input.generationState ?? 'COMPLETE',
    isFallback: input.isFallback ?? false,
    days: [
      {
        date: DAY1,
        slots: [slot('poi-a', '09:30:00'), slot('poi-b', '13:00:00')],
      },
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
      lat: 33.458,
      lng: 126.942,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    },
  };
}

let itineraryScript: () => Itinerary;
let savedScript: () => Promise<Response> | Response;
let observed: { method: string; url: string }[] = [];
/** 담은 장소 응답을 테스트가 풀 때까지 붙잡는 게이트(02a ★7). afterEach 가 반드시 연다. */
let releaseSaved: () => void = () => undefined;

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

beforeEach(() => {
  observed = [];
  setAccessToken('valid-access');
  savedScript = () => HttpResponse.json([savedPlace('poi-mv-1', NAME_1)]);
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryScript())
    ),
    // AC-13 은 이 핸들러를 **항상** 등록해 두고 요청 수로 잰다(02a ★10).
    http.get(`${BASE}/saved-places`, () => savedScript())
  );
});

afterEach(() => {
  releaseSaved();
  releaseSaved = () => undefined;
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
  render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  return { client };
}

/** 정확한 testID 몇 개를 트리 전위 순서(부모→자식, 형→아우)로 뽑는다(fallbackShell 선례 · 02a ★11). */
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

/** 두 항목이 서버 문구**만** 보인다(이름 자리·대체 이름 없음 — 완전 일치 · 02a ★1). */
function expectMessageOnlyItems(): void {
  expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
  expect(screen.getByTestId(itemId('poi-mv-1'))).toHaveTextContent(MSG_NO_SLOT);
  expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(MSG_WINDOW);
  expect(screen.queryByText('이름을 불러오지 못한 곳')).toBeNull();
}

/** 조회가 전부 끝날 때까지(담은 장소 요청 n건 + 진행 중 조회 0) 기다린다(02a ★8). */
async function settle(client: QueryClient, savedCount: number): Promise<void> {
  await waitFor(() => {
    expect(savedHits()).toBe(savedCount);
    expect(client.isFetching()).toBe(0);
  }, WAIT);
}

describe('🔴 D1 · AC-1·2·3·11·13 · Q5 — COMPLETE 셸 시트 맨 위에 블록이 서고, 이름은 담은 장소에서 온다', () => {
  it('헤더 뒤·첫 카드 앞 · 항목 2 · 이름 있음/없음 두 얼굴 · 소요시간 0 · 담은 장소 1회 조회', async () => {
    itineraryScript = () => itinerary({ unplaced: UNPLACED });

    const { client } = renderPage();

    const block = await screen.findByTestId(BLOCK, {}, WAIT);
    // 셸 시트 안, 하단 CTA 밖.
    expect(
      within(screen.getByTestId(SHELL)).getByTestId(BLOCK)
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-cta-root')).queryByTestId(BLOCK)
    ).toBeNull();
    expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);

    // 이름은 담은 장소 응답이 와야 붙는다 — findBy 로 기다린다.
    const first = screen.getByTestId(itemId('poi-mv-1'));
    expect(await within(first).findByText(NAME_1, {}, WAIT)).toBeOnTheScreen();
    expect(first).toHaveTextContent(`${NAME_1}${MSG_NO_SLOT}`);
    // 담은 장소에 없는 항목은 문구만(AC-3).
    expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(
      MSG_WINDOW
    );

    // 자리(Q5) — 헤더 → 블록 → 첫 카드.
    expect(treeOrder(['sheet-header-root', BLOCK, cardId('poi-a')])).toEqual([
      'sheet-header-root',
      BLOCK,
      cardId('poi-a'),
    ]);
    // INV-3 — 서버 문구의 「시간」은 정당하고, 숫자+단위는 없다.
    expect(block).not.toHaveTextContent(DURATION_TEXT);

    await settle(client, 1);
  });
});

describe('🔴 D2 · Q4 — 담은 장소 조회가 대기 중이어도 블록과 서버 문구가 먼저 보인다', () => {
  it('응답 보류 중엔 문구만 · 응답이 오면 이름이 채워진다', async () => {
    itineraryScript = () => itinerary({ unplaced: UNPLACED });
    const gate = new Promise<void>((resolve) => {
      releaseSaved = resolve;
    });
    savedScript = async () => {
      await gate;
      return HttpResponse.json([savedPlace('poi-mv-1', NAME_1)]);
    };

    renderPage();

    // 실행 전 앵커 — 요청은 이미 나갔고 응답은 아직이다.
    await screen.findByTestId(BLOCK, {}, WAIT);
    await waitFor(() => expect(savedHits()).toBe(1), WAIT);

    // 보류 중 — 로딩이 보고를 가리지 않는다(INV-4).
    expectMessageOnlyItems();

    // 게이트를 연다 → 이름이 채워진다.
    releaseSaved();
    expect(
      await within(screen.getByTestId(itemId('poi-mv-1'))).findByText(
        NAME_1,
        {},
        WAIT
      )
    ).toBeOnTheScreen();
  });
});

describe('🔴 D3 · AC-3 · INV-4 — 담은 장소 조회가 실패해도 항목은 남고 서버 문구만 보인다', () => {
  it('/saved-places 500 → 조회가 끝난 뒤에도 블록·항목 2 · 대체 이름 없음', async () => {
    itineraryScript = () => itinerary({ unplaced: UNPLACED });
    savedScript = () => new HttpResponse(null, { status: 500 });

    const { client } = renderPage();
    await screen.findByTestId(BLOCK, {}, WAIT);

    // 실패가 확정될 때까지 기다린 뒤 잰다 — 요청 직후에 재면 isError 로 숨기는 구현도 통과한다(02a ★8).
    await settle(client, 1);

    expect(screen.getByTestId(BLOCK)).toBeOnTheScreen();
    expectMessageOnlyItems();
  });
});

describe('🔴 D4 · Q4 — 게스트는 담은 장소를 조회하지 않고, 문구는 그대로 보인다', () => {
  it('토큰 없음 → /saved-places 0회 · 두 항목 문구만', async () => {
    clearAccessToken();
    itineraryScript = () => itinerary({ unplaced: UNPLACED });

    const { client } = renderPage();
    await screen.findByTestId(BLOCK, {}, WAIT);
    await settle(client, 0);

    expectMessageOnlyItems();
  });
});

describe('D5 · AC-7·AC-13 — 미배치가 0건이면 블록도, 담은 장소 조회도 없다 (선제 green 트립와이어)', () => {
  it.each([
    ['빈 배열', [] as ItineraryUnplacedMustVisitsItem[]],
    ['필드 없음', undefined],
  ])('%s → 블록 0 · /saved-places 0회', async (_label, unplaced) => {
    itineraryScript = () => itinerary({ unplaced });

    const { client } = renderPage();

    // 긍정 앵커 — 셸 카드가 떴다(로딩 중 공허 통과 방지).
    expect(
      await screen.findByTestId(cardId('poi-a'), {}, WAIT)
    ).toBeOnTheScreen();
    await settle(client, 0);

    expect(screen.queryByTestId(BLOCK)).toBeNull();
  });
});

describe('🔴 D6 · AC-10ⓐ — 일부 실패(staleFailed) 안내와 블록이 함께 뜬다', () => {
  it('FAILED + 미배치 → 헤더 → 일부 실패 안내 → 블록 → 첫 카드', async () => {
    itineraryScript = () =>
      itinerary({ unplaced: UNPLACED, generationState: 'FAILED' });

    renderPage();

    await screen.findByTestId(STALE, {}, WAIT);
    expect(await screen.findByTestId(BLOCK, {}, WAIT)).toBeOnTheScreen();
    expect(
      treeOrder(['sheet-header-root', STALE, BLOCK, cardId('poi-a')])
    ).toEqual(['sheet-header-root', STALE, BLOCK, cardId('poi-a')]);
  });
});

describe('🔴 D7 · AC-10ⓑ · Q3 · 결정 1 — 폴백 안내와 블록이 함께 뜨고, 블록은 안내 밖 형제다', () => {
  it('인터스티셜엔 블록 없음 → 「기본 일정 보기」 → 헤더 → 폴백 안내 → 블록 → 첫 카드', async () => {
    itineraryScript = () =>
      itinerary({
        unplaced: UNPLACED,
        solveMode: 'DETERMINISTIC',
        isFallback: true,
      });

    renderPage();

    // 인터스티셜(h07 폴백) — 결정 1 의 자리가 아니다.
    const viewPlan = await screen.findByTestId(
      'itinerary-fallback-view-plan',
      {},
      WAIT
    );
    expect(screen.queryByTestId(BLOCK)).toBeNull();

    fireEvent.press(viewPlan);

    const block = await screen.findByTestId(BLOCK, {}, WAIT);
    const banner = screen.getByTestId(BANNER);
    // 형제 — 안내 안에 넣어도 전위 순서는 같게 나올 수 있어 따로 잰다(02a ★11).
    expect(within(banner).queryByTestId(BLOCK)).toBeNull();
    expect(block).toBeOnTheScreen();
    expect(
      treeOrder(['sheet-header-root', BANNER, BLOCK, cardId('poi-a')])
    ).toEqual(['sheet-header-root', BANNER, BLOCK, cardId('poi-a')]);
  });
});

describe('D8 · 결정 1 — PARTIAL 진행 셸에는 블록이 없다 (선제 green 트립와이어)', () => {
  it('PARTIAL + 미배치 → 진행 카드는 뜨고 블록은 없다', async () => {
    itineraryScript = () =>
      itinerary({ unplaced: UNPLACED, generationState: 'PARTIAL' });

    renderPage();

    expect(
      await screen.findByTestId('generation-progress-card', {}, WAIT)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(BLOCK)).toBeNull();
  });
});
