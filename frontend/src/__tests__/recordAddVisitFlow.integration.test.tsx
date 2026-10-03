import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BottomSheet, { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { router } from 'expo-router';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place } from '@/shared/api/generated/schemas';
import { RecordAddVisitPage } from '@/pages/record/record-add-visit';
import { TripRecordsPage } from '@/pages/record/trip-records';

/**
 * 🔴 TRIP-1072 · AC-5~12·AC-14 — j01 [방문 추가] 장소 피커(즉석 방문 = 계획에 없던 곳의 도착 기록).
 *
 * 무엇을 보장하나(심판 대상 = 실제로 나간 요청 + 보이는 트리):
 *  - AC-5  후보는 `GET /places` 결과만, 여행 목적지로 좁힌다(1곳 region · 2곳+ 병합 · 0곳/실패 region 없음),
 *          여행 조회 전엔 장소 조회를 켜지 않는다.
 *  - AC-6  검색어는 서버 `q` 로 다시 묻고, 성공 0건이면 빈 안내.
 *  - AC-7·8 고르면 `POST /visits` 가 `{slotKey:null, poiId, source:'MANUAL'}` 로 정확히 1회(계획에 있는 곳이어도
 *          slotKey 를 추측해 싣지 않는다), 성공 뒤 뒤로가기 1회.
 *  - AC-9  진행 중엔 같은 곳·다른 곳 모두 두 번째 POST 가 없다(01b E7).
 *  - AC-10 404·네트워크 실패면 오류 안내 + 머묾 + j01 캐시에 낙관 카드 없음, 다시 누르면 재시도된다.
 *  - AC-11·12 j01 과 같은 (tripId, day) 캐시를 봐서 재조회 없이 카드가 늘고, 제목은 poiId 가 아니라 고른 이름.
 *  - AC-14 검색칸이 바텀시트 안에 있다(밖이면 실기기에서 즉시 크래시 — 목은 못 봄, 구조로만 잰다).
 *
 * ★ 하니스 — 실제 앱은 j01 이 스택에 마운트된 채 피커가 위에 뜬다. 테스트 클라이언트는 gcTime 0 이라 관찰자
 *   없는 캐시는 다음 틱에 지워지므로, 두 화면을 한 트리·한 QueryClient 로 함께 그린다. 클라이언트를 wrapper
 *   밖에서 만들어야 rerender(피커 재마운트) 뒤에도 같은 캐시가 남는다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// router 와 useRouter() 가 같은 객체 — 구현이 어느 쪽을 써도 같은 jest.fn 에 기록된다. canGoBack 은 true
// (back 을 canGoBack 으로 감싸는 구현도 back 호출이 관측되게).
jest.mock('expo-router', () => {
  const router = {
    canGoBack: jest.fn(() => true),
    back: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
  };
  return { router, useRouter: () => router };
});

// j01 이 마운트에 위치 권한을 조회한다 — 허용으로 두어 일반 모드.
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: () => Promise.resolve({ granted: true }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const DAY = '2026-08-20';
const ERROR_COPY = '방문을 기록하지 못했어요. 다시 시도해 주세요.';
const EMPTY_COPY = '검색 결과가 없어요';

const pickId = (poiId: string) => `record-add-visit-pick-${poiId}`;
const rowId = (poiId: string) => `record-add-visit-row-${poiId}`;
const cardId = (visitCheckId: string) =>
  `record-trip-visit-card-${visitCheckId}`;

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  region: string
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

/** p1 은 그날 계획 슬롯에도 있다(AC-8). p2 '해운대…' 만 이름에 '해' 가 든다(AC-6). g1 은 경주(AC-5 병합). */
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', '부산'),
  makePlace('p2', '해운대 해수욕장', '야경', '부산'),
  makePlace('p3', '전포 카페거리', '카페', '부산'),
  makePlace('g1', '불국사', '명소', '경주'),
];

function tripJson(
  destinations: { seq: number; region: string; nights: number }[]
) {
  return {
    tripId: TRIP_ID,
    title: '부산',
    startDate: DAY,
    endDate: '2026-08-22',
    party: 2,
    preferenceSnapshot: {},
    destinations,
    status: 'IN_PROGRESS',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

function itinerary() {
  return {
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: DAY,
        slots: [
          {
            poiId: 'p1',
            nameKo: '감천문화마을',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            tags: [] as string[],
          },
        ],
      },
    ],
  };
}

/** 서버가 만든 즉석 방문 레코드(도착·미완료, slotKey 없음). */
function createdVisit(visitCheckId: string, poiId: string) {
  return {
    visitCheckId,
    slotKey: null,
    poiId,
    arrivedAt: `${DAY}T05:20:00Z`,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: true,
    updatedAt: `${DAY}T05:20:00Z`,
  };
}

/** 그날 이미 있던 완료 방문(계획 p1). */
function completedVisit() {
  return {
    visitCheckId: 'v-a',
    slotKey: `${DAY}#p1`,
    poiId: 'p1',
    arrivedAt: `${DAY}T01:00:00Z`,
    completedAt: `${DAY}T02:00:00Z`,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: `${DAY}T02:00:00Z`,
  };
}

type PostBody = { slotKey?: string | null; poiId: string; source: string };

let observed: { method: string; url: string }[] = [];
let postBodies: PostBody[] = [];
let visitsOfDay: ReturnType<typeof completedVisit>[] = [];
let createdCount = 0;

/** POST 응답 방식 — 기본은 성공(201 + 새 레코드). 테스트가 실패·붙잡기로 바꾼다. */
let respondPost: (body: PostBody) => Response | Promise<Response>;

function succeed(body: PostBody): Response {
  createdCount += 1;
  return HttpResponse.json(createdVisit(`v-new-${createdCount}`, body.poiId), {
    status: 201,
  });
}

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

const placeHits = () => hitsOf('GET', '/api/v1/places');
const postHits = () => hitsOf('POST', `/api/v1/trips/${TRIP_ID}/visits`);
const dayVisitHits = () =>
  hitsOf('GET', `/api/v1/trips/${TRIP_ID}/visits/days/${DAY}`);
const regionsOf = (hits: { url: string }[]) =>
  hits.map((hit) => new URL(hit.url).searchParams.get('region'));

/** 그 서버처럼 region·category·q 로 거르는 장소 핸들러. */
function placesHandler() {
  return http.get(`${BASE}/places`, ({ request }) => {
    const url = new URL(request.url);
    const region = url.searchParams.get('region');
    const category = url.searchParams.get('category');
    const q = url.searchParams.get('q');
    let result = PLACES;
    if (region !== null) result = result.filter((p) => p.region === region);
    if (category !== null)
      result = result.filter((p) => p.category === category);
    if (q) result = result.filter((p) => p.nameKo.includes(q));
    return HttpResponse.json({ items: result, nextCursor: null });
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  postBodies = [];
  visitsOfDay = [];
  createdCount = 0;
  respondPost = succeed;
  setAccessToken('a');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json(tripJson([{ seq: 1, region: '부산', nights: 2 }]))
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    placesHandler(),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: visitsOfDay })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: [], count: 0 })
    ),
    http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
      const body = (await request.json()) as PostBody;
      postBodies.push(body);
      return respondPost(body);
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  jest.mocked(router.back).mockClear();
});

afterAll(() => server.close());

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** 피커만 그린다(후보 행이 뜰 때까지). */
async function renderPicker(): Promise<void> {
  render(<RecordAddVisitPage tripId={TRIP_ID} day={DAY} />, {
    wrapper: wrapperFor(makeClient()),
  });
  await screen.findByTestId(rowId('p1'));
}

/** j01(스택 아래) + 피커(위)를 한 캐시로 그린다. */
function Harness({ picker }: { picker: boolean }) {
  return (
    <>
      <TripRecordsPage tripId={TRIP_ID} today={DAY} />
      {picker ? <RecordAddVisitPage tripId={TRIP_ID} day={DAY} /> : null}
    </>
  );
}

async function renderHarness() {
  const utils = render(<Harness picker />, {
    wrapper: wrapperFor(makeClient()),
  });
  await screen.findByTestId(pickId('p2'));
  await waitFor(() => expect(dayVisitHits().length).toBeGreaterThan(0));
  return utils;
}

const visitCards = () => screen.queryAllByTestId(/^record-trip-visit-card-/);

/** 붙잡힌 POST — release 전까지 응답하지 않는다. */
function holdPost(): () => void {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  respondPost = async (body) => {
    await gate;
    return succeed(body);
  };
  return () => release();
}

async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('🔴 AC-5 · 후보는 GET /places 결과만, 여행 목적지로 좁힌다', () => {
  it('P5-a: 여행 조회가 끝나기 전엔 장소를 묻지 않고, 끝나면 region=부산 으로만 묻는다', async () => {
    // 준비 — 여행 응답을 붙잡는다.
    let releaseTrip: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseTrip = resolve;
    });
    server.use(
      http.get(`${BASE}/trips/:tripId`, async () => {
        await gate;
        return HttpResponse.json(
          tripJson([{ seq: 1, region: '부산', nights: 2 }])
        );
      })
    );

    // 실행 — 렌더하고 여행 요청이 나간 뒤 조금 더 흘린다.
    render(<RecordAddVisitPage tripId={TRIP_ID} day={DAY} />, {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() =>
      expect(
        hitsOf('GET', `/api/v1/trips/${TRIP_ID}`).length
      ).toBeGreaterThanOrEqual(1)
    );
    await flush(50);

    // 단언 ① — 여행을 모르는 동안 장소 요청 0건.
    expect(placeHits()).toHaveLength(0);

    // 실행 — 여행 응답을 푼다.
    releaseTrip();
    await screen.findByTestId(rowId('p1'));

    // 단언 ② — 나간 장소 요청은 전부 region=부산.
    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => '부산'));
  });

  it('P5-b: 목적지가 부산·경주면 지역마다 묻고 두 지역 후보를 함께 보여 준다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(
          tripJson([
            { seq: 1, region: '부산', nights: 1 },
            { seq: 2, region: '경주', nights: 1 },
          ])
        )
      )
    );

    render(<RecordAddVisitPage tripId={TRIP_ID} day={DAY} />, {
      wrapper: wrapperFor(makeClient()),
    });

    expect(await screen.findByTestId(rowId('p1'))).toBeOnTheScreen();
    expect(await screen.findByTestId(rowId('g1'))).toBeOnTheScreen();
    expect([...new Set(regionsOf(placeHits()))].sort()).toEqual([
      '경주',
      '부산',
    ]);
  });

  it.each([
    [
      '여행 조회 실패(404)',
      () =>
        HttpResponse.json(
          { error: { code: 'TRIP_NOT_FOUND', message: 'gone' } },
          { status: 404 }
        ),
    ],
    ['목적지 0곳', () => HttpResponse.json(tripJson([]))],
  ])('P5-c: %s 이면 region 없이 묻는다', async (_label, respondTrip) => {
    server.use(http.get(`${BASE}/trips/:tripId`, respondTrip));

    render(<RecordAddVisitPage tripId={TRIP_ID} day={DAY} />, {
      wrapper: wrapperFor(makeClient()),
    });

    // 앵커 — 경주 장소까지 보인다(지역으로 안 좁혔다).
    expect(await screen.findByTestId(rowId('g1'))).toBeOnTheScreen();
    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => null));
  });

  it('P5-d: 행은 서버가 준 후보 그대로이고, 각 행에 장소 이름이 있다', async () => {
    await renderPicker();

    const ids = screen
      .getAllByTestId(/^record-add-visit-row-/)
      .map((node) => node.props.testID as string)
      .sort();
    expect(ids).toEqual([rowId('p1'), rowId('p2'), rowId('p3')]);
    expect(
      within(screen.getByTestId(rowId('p1'))).getByText('감천문화마을')
    ).toBeTruthy();
  });
});

describe('🔴 AC-6 · 검색은 서버 q 로, 0건이면 안내', () => {
  it('P6-a: 검색어를 넣으면 q 를 실어 다시 묻고 서버가 거른 후보만 남는다', async () => {
    await renderPicker();

    fireEvent.changeText(screen.getByTestId('record-add-visit-search'), '해');

    await waitFor(() =>
      expect(
        placeHits().some(
          (hit) => new URL(hit.url).searchParams.get('q') === '해'
        )
      ).toBe(true)
    );
    await waitFor(() => expect(screen.queryByTestId(rowId('p1'))).toBeNull());
    expect(screen.getByTestId(rowId('p2'))).toBeOnTheScreen();
  });

  it('P6-b: 결과가 있으면 안내가 없고, 0건이 되면 "검색 결과가 없어요" 가 뜬다', async () => {
    await renderPicker();
    expect(screen.queryByTestId('record-add-visit-empty')).toBeNull();

    fireEvent.changeText(
      screen.getByTestId('record-add-visit-search'),
      '없는장소'
    );

    expect(
      await screen.findByTestId('record-add-visit-empty')
    ).toHaveTextContent(EMPTY_COPY);
  });
});

describe('🔴 AC-7·AC-8 · 고르면 slotKey 없는 도착이 정확히 1회, 성공하면 뒤로', () => {
  it('P7: 계획에 없는 곳을 고르면 {slotKey:null, poiId, MANUAL} 로 1회 POST 하고 뒤로 1회 간다', async () => {
    await renderPicker();

    // 화면 카피(01b E2) — 시트 제목과 행 버튼.
    expect(screen.getByText('방문 추가')).toBeTruthy();
    expect(screen.getByTestId(pickId('p2'))).toHaveTextContent('기록');

    // 실행
    fireEvent.press(screen.getByTestId(pickId('p2')));

    // 단언
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(postBodies).toEqual([
      { slotKey: null, poiId: 'p2', source: 'MANUAL' },
    ]);
    expect(postHits()).toHaveLength(1);
  });

  it('P8: 그날 계획에 있는 곳(p1)을 골라도 slotKey 를 추측해 싣지 않는다', async () => {
    await renderPicker();

    fireEvent.press(screen.getByTestId(pickId('p1')));

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies).toEqual([
      { slotKey: null, poiId: 'p1', source: 'MANUAL' },
    ]);
  });
});

describe('🔴 AC-9 · 진행 중엔 어떤 행을 눌러도 두 번째 POST 가 없다', () => {
  it('P9: 첫 POST 응답 전 같은 곳·다른 곳을 눌러도 POST 는 1건, 오류 안내도 없다', async () => {
    const release = holdPost();
    await renderPicker();

    // 실행 ① — 첫 선택, 요청이 실제로 출발할 때까지 기다린다.
    fireEvent.press(screen.getByTestId(pickId('p2')));
    await waitFor(() => expect(postHits()).toHaveLength(1));

    // 실행 ② — 진행 중에 같은 곳·다른 곳을 누른다.
    fireEvent.press(screen.getByTestId(pickId('p2')));
    fireEvent.press(screen.getByTestId(pickId('p3')));
    await flush();

    // 단언 — 두 번째 요청 없음, 행은 그대로(화면에 머묾), 연타는 오류가 아니다.
    expect(postHits()).toHaveLength(1);
    expect(screen.getByTestId(pickId('p3'))).toBeOnTheScreen();
    expect(screen.queryByTestId('record-add-visit-error')).toBeNull();

    // 응답이 오면 뒤로 1회, 여전히 POST 1건.
    release();
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(postHits()).toHaveLength(1);
    expect(postBodies.map((body) => body.poiId)).toEqual(['p2']);
    expect(screen.queryByTestId('record-add-visit-error')).toBeNull();
  });
});

describe('🔴 AC-10 · 실패하면 알리고 머문다, 다시 누르면 재시도된다', () => {
  it.each([
    [
      '404',
      () =>
        HttpResponse.json(
          { error: { code: 'TRIP_NOT_FOUND', message: 'gone' } },
          { status: 404 }
        ),
    ],
    ['네트워크', () => HttpResponse.error()],
  ])(
    'P10: POST %s 실패 → 오류 안내·뒤로 0회·j01 낙관 카드 없음 → 재시도 성공하면 뒤로 가고 안내가 사라진다',
    async (_label, fail) => {
      respondPost = () => fail();
      await renderHarness();
      expect(visitCards()).toHaveLength(0);

      // 실행 ① — 실패하는 선택.
      fireEvent.press(screen.getByTestId(pickId('p2')));

      // 단언 ① — 문구 그대로 안내, 피커에 머묾, j01 에 낙관 카드가 남지 않음.
      expect(
        await screen.findByTestId('record-add-visit-error')
      ).toHaveTextContent(ERROR_COPY);
      expect(router.back).not.toHaveBeenCalled();
      expect(screen.queryByTestId(cardId('optimistic:p2'))).toBeNull();
      expect(visitCards()).toHaveLength(0);

      // 실행 ② — 서버가 회복된 뒤 다시 누른다.
      respondPost = succeed;
      fireEvent.press(screen.getByTestId(pickId('p2')));

      // 단언 ② — 재시도 요청이 나가고, 성공해 뒤로 가며, 안내는 사라진다.
      await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
      expect(postHits()).toHaveLength(2);
      expect(screen.queryByTestId('record-add-visit-error')).toBeNull();
      expect(visitCards()).toHaveLength(1);
    }
  );
});

describe('🔴 AC-11·AC-12 · j01 카드가 재조회 없이 늘고, 제목은 고른 장소 이름이다', () => {
  it('P11: 응답 전 낙관 카드부터 이름으로 서고, 응답 뒤 실 카드도 이름이다(poiId 노출 없음)', async () => {
    const release = holdPost();
    await renderHarness();

    // 실행 — 고른다(응답은 붙잡혀 있다).
    fireEvent.press(screen.getByTestId(pickId('p2')));

    // 단언 ① — 낙관 카드 제목이 이름.
    const optimistic = await screen.findByTestId(cardId('optimistic:p2'));
    expect(within(optimistic).getByText('해운대 해수욕장')).toBeTruthy();

    // 단언 ② — 응답으로 바뀐 실 카드도 이름, poiId 는 어디에도 글자로 없다.
    release();
    const real = await screen.findByTestId(cardId('v-new-1'));
    expect(within(real).getByText('해운대 해수욕장')).toBeTruthy();
    expect(screen.queryByText('p2')).toBeNull();
  });

  it('P12: 같은 곳을 두 번 추가하면 카드가 1→2→3 장이 되고, 그날 방문 목록은 다시 묻지 않는다', async () => {
    visitsOfDay = [completedVisit()];
    const { rerender } = await renderHarness();
    await screen.findByTestId(cardId('v-a'));
    expect(visitCards()).toHaveLength(1);
    const listFetches = dayVisitHits().length;

    // 실행 ① — 첫 추가.
    fireEvent.press(screen.getByTestId(pickId('p2')));
    await screen.findByTestId(cardId('v-new-1'));
    expect(visitCards()).toHaveLength(2);

    // 실행 ② — 피커를 닫았다 다시 열어(j01 → [방문 추가]) 같은 곳을 또 고른다.
    rerender(<Harness picker={false} />);
    rerender(<Harness picker />);
    fireEvent.press(await screen.findByTestId(pickId('p2')));
    await screen.findByTestId(cardId('v-new-2'));

    // 단언 — 3장, 두 즉석 카드 모두 이름, 방문 목록 재조회 없음.
    expect(visitCards()).toHaveLength(3);
    expect(
      within(screen.getByTestId(cardId('v-new-1'))).getByText('해운대 해수욕장')
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(cardId('v-new-2'))).getByText('해운대 해수욕장')
    ).toBeTruthy();
    expect(dayVisitHits()).toHaveLength(listFetches);
  });
});

describe('🔴 AC-14 · 검색칸은 바텀시트 안에 있다', () => {
  /** 요소에서 부모를 따라 올라가며 바텀시트(목) 조상을 찾는다. */
  function insideSheet(element: ReactTestInstance): boolean {
    let node: ReactTestInstance | null = element.parent;
    while (node) {
      if (node.type === (BottomSheet as unknown)) return true;
      node = node.parent;
    }
    return false;
  }

  it('P14: 루트가 서고, 검색칸·카테고리 칩이 시트 조상 아래에 있으며 검색칸은 BottomSheetTextInput 이다', async () => {
    await renderPicker();

    expect(screen.getByTestId('record-add-visit-screen')).toBeOnTheScreen();
    expect(insideSheet(screen.getByTestId('record-add-visit-search'))).toBe(
      true
    );
    expect(
      insideSheet(screen.getByTestId('record-add-visit-category-all'))
    ).toBe(true);
    const inputIds = screen
      .UNSAFE_getAllByType(BottomSheetTextInput)
      .map((node) => node.props.testID);
    expect(inputIds).toContain('record-add-visit-search');
  });
});
