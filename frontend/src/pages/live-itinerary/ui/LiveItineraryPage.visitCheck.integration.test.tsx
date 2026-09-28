import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/generated/schemas';
import { getGetTripsTripIdVisitsDaysDayQueryKey } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-396 · AC-3 · AC-4 배선 + active 카드 **도달성** — 방문 기록을 실제 조회 상태에서 태운다.
 *
 * 무엇을 보장하나:
 *  - **W1 (★도달성)** 그 날 방문 기록에 "도착·미완료"가 있으면 그 슬롯이 **active 카드**로 뜬다.
 *    페이지가 `GET /visits/days` → `deriveVisitProgress` → `projectSlotProgress(slots,{activePoiId})`
 *    배선을 안 하면 전부 upcoming → active 카드가 없어 red. 이 배선이 이 티켓의 숨은 필수 전제
 *    (repo-traps execution — 현재 코드는 progress 인자 없이 호출해 active 가 프로덕션에 안 뜬다).
 *  - **W2 (AC-3)** active 카드 [방문 완료] press → `POST /visits/{visitCheckId}/complete` 가 도출된
 *    id 로 나가고, 그 슬롯이 done(컴팩트)으로 바뀐다.
 *  - **W3 (TRIP-1021 AC-1 · 반전)** 기록이 없는 오늘 탭 예정 카드의 [도착] press → `POST /visits`
 *    `{slotKey, poiId, source:'MANUAL'}` 1회 → 그 카드가 active. TRIP-746 이 "도착 자동 원칙"으로 이
 *    표면을 지웠으나, 자동 도착(TRIP-1018)이 보류라 수동이 유일한 도착 경로여서 되살렸다(01b).
 *  - **W4~W9 (TRIP-1021)** 도착→완료 사슬(AC-2) · 실패 롤백(AC-5) · active 있으면 [도착] 없음(AC-3) ·
 *    오늘 탭에서만(Q6) · 연타해도 POST 1회(AC-1) · 위치 권한 무관(Q2).
 *  - **W10~W14 (TRIP-1021 5-c 수정 루프 1)** 여행 전·후엔 어느 탭에도 [도착] 없음(경고1 — `todayIndex`
 *    는 여행 밖이면 첫날/마지막 날로 맞춰 끼운 값이라 "오늘"이 아니다) · 방문 기록 조회가 실패·로딩 중이면
 *    [도착] 없음(경고2) · 도착 실패 뒤 다시 누르면 요청이 다시 나간다(경고4 — 연타 가드가 풀리는가).
 *
 * 왜 통합 버킷인가: 심판 대상이 "조회 상태 → 사영 → 카드"의 배선과 "실제로 나간 경로·바디"다 —
 * 훅을 목킹하면 그 사영이 테스트의 가정이 되어 버린다(기존 `LiveItineraryPage.integration` 선례).
 *
 * (TRIP-746: 형제 `LiveItineraryPage.integration.test.tsx` 는 허브 재작성으로 I1·I5~I8 이 바뀌었다.)
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

// 페이지가 router 를 import 한다(렌더 중엔 안 부른다) — 목이 router 객체를 제공하면 된다.
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

// TRIP-1021 Q2 — 허브 [도착]은 위치 권한과 무관하다. 허브가 권한을 조회하게 바뀌어도 어느 함수를
// 쓰든 GRANTED/DENIED 가 주입되도록 get·request 둘 다 둔다(지금 허브는 expo-location 을 안 문다).
const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const TOMORROW = '2026-08-21';
const T = '2026-08-20T13:00:00';
const VISITS_PATH = `POST /api/v1/trips/${TRIP_ID}/visits`;
const VISITS_GET_TODAY = `GET /api/v1/trips/${TRIP_ID}/visits/days/${TODAY}`;
const arriveId = (date: string, poiId: string) =>
  `execution-live-slot-arrive-${date}#${poiId}`;

const slot = (poiId: string, nameKo: string, startAt: string) => ({
  poiId,
  startAt,
  endAt: startAt,
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo,
  distanceRange: null,
  openingHours: null,
  tags: [],
});

/** TRIP-1021 — 날짜별 슬롯을 직접 준다(두 슬롯·이틀 케이스). */
const itineraryOf = (
  days: { date: string; slots: ReturnType<typeof slot>[] }[]
): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days,
  }) as unknown as Itinerary;

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
            poiId: 'p1',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '감천문화마을',
            distanceRange: null,
            openingHours: null,
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

const trip = () => ({
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: TODAY,
  endDate: '2026-08-22',
  party: 2,
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

const vc = (
  over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
): VisitCheck => ({
  slotKey: `${TODAY}#${over.poiId}`,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  // 서버 버전 시각(BR-U5-22 · openapi:1953) — codegen 후 required 라 픽스처가 미리 채운다(TRIP-619).
  updatedAt: '2026-08-20T13:00:05Z',
  ...over,
});

/** trip·itinerary 핸들러는 항상 등록(page 가 무조건 조회). visits 만 케이스가 갈아끼운다. */
const baseHandlers = (plan: Itinerary = itinerary()) => [
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
  http.get(`${BASE}/trips/:tripId/itinerary`, () => HttpResponse.json(plan)),
];

let observedHits: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;
/** POST /visits 로 나간 본문(TRIP-1021 — 슬롯 키 트립와이어). */
let arriveBodies: unknown[] = [];

// 테스트마다 새 클라이언트 — W4 는 재조회가 캐시에 도착했는지를 이 클라이언트로 기다린다(02a ★5).
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  observedHits = [];
  arriveBodies = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mockGetForeground.mockResolvedValue({ status: 'granted', granted: true });
  mockRequestForeground.mockResolvedValue({ status: 'granted', granted: true });
  setAccessToken('a');
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockReplace.mockClear();
  client.clear();
});
afterAll(() => server.close());

describe('LiveItineraryPage · 방문 체크', () => {
  it('W1 도착·미완료 기록이 있으면 그 슬롯이 active 카드로 뜬다 (★도달성)', async () => {
    server.use(
      ...baseHandlers(),
      // 그 날 방문 기록: p1 이 도착했고 아직 미완료 → 진행 중.
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: [vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })],
        })
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // active 카드에만 있는 [방문 완료]가 뜬다 = progress 인자가 실제로 배선됐다.
    await waitFor(() =>
      expect(screen.getByTestId('execution-arrive-complete')).toBeTruthy()
    );
  });

  it('W2 [방문 완료] press → POST /visits/{id}/complete + 슬롯이 done 으로 바뀐다 (AC-3)', async () => {
    // 완료 POST 이후 방문 기록 조회가 완료 상태를 준다(낙관·재조회 모두 done 으로 수렴).
    let completed = false;
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: [
            vc({
              visitCheckId: 'v1',
              poiId: 'p1',
              arrivedAt: T,
              completedAt: completed ? '2026-08-20T13:40:00' : null,
            }),
          ],
        })
      ),
      http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () => {
        completed = true;
        return HttpResponse.json(
          vc({
            visitCheckId: 'v1',
            poiId: 'p1',
            arrivedAt: T,
            completedAt: '2026-08-20T13:40:00',
          })
        );
      })
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('execution-arrive-complete')).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('execution-arrive-complete'));

    // 완료 요청이 **도출된 visitCheckId 'v1'** 로 나갔다(poiId 로 새지 않는다 — 부정 짝).
    await waitFor(() =>
      expect(hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/v1/complete`)).toBe(
        1
      )
    );
    expect(hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/p1/complete`)).toBe(
      0
    );

    // 슬롯이 done 으로 — [방문 완료] 사라지고 우측에 계획 시각 "13:00" + "방문" 이 뜬다
    // (TRIP-746 done 카드 · BR-U4-34 계획값. 옛 시각범위 배지 "13:00–14:00" 은 삭제됐다).
    await waitFor(() =>
      expect(screen.queryByTestId('execution-arrive-complete')).toBeNull()
    );
    expect(
      screen.getByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
    ).toHaveTextContent('13:00');
    expect(
      screen.getByTestId(`execution-live-slot-visit-label-${TODAY}#p1`)
    ).toHaveTextContent('방문');
  });

  it('W3 기록이 없는 오늘 탭 예정 카드의 [도착] press → POST /visits {slotKey, poiId, MANUAL} 1회 → active (TRIP-1021 AC-1·AC-4)', async () => {
    // TRIP-746 이 지운 수동 [도착]을 되살린 자리다(옛 W3 = 부재 짝 → 반전). 자동 도착(TRIP-1018)이
    // 보류라 이 버튼이 유일한 도착 경로다.
    let arrived = false;
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: arrived
            ? [vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T })]
            : [],
        })
      ),
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        arriveBodies.push(await request.json());
        arrived = true;
        return HttpResponse.json(
          vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
          { status: 201 }
        );
      })
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 준비 — 예정 카드("13:00 도착 예정")와 그 [도착]이 뜬다.
    const arrive = await screen.findByTestId(arriveId(TODAY, 'p1'));
    expect(
      screen.getByTestId(`execution-live-slot-time-${TODAY}#p1`)
    ).toHaveTextContent('13:00 도착 예정');

    fireEvent.press(arrive);

    // 단언 ① — POST 1회, 본문은 슬롯 키를 실은 수동 도착(슬롯 키가 비면 서버가 즉석 방문으로 기록한다).
    await waitFor(() => expect(hitCount(VISITS_PATH)).toBe(1));
    expect(arriveBodies[0]).toEqual({
      slotKey: `${TODAY}#p1`,
      poiId: 'p1',
      source: 'MANUAL',
    });
    // 단언 ② — 그 카드가 active 로: [방문 완료]가 서고 [도착]은 사라진다. 시각은 계획 startAt 그대로(AC-4).
    await waitFor(() =>
      expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId(arriveId(TODAY, 'p1'))).toBeNull();
    expect(
      screen.getByTestId(`execution-live-slot-time-${TODAY}#p1`)
    ).toHaveTextContent('13:00 도착 · 지금 관람 중');
  });

  it('W4 도착 → 재조회 → [방문 완료] 사슬: 완료 요청은 서버 id(v9)로 나가고 카드가 done 이 된다 (AC-2)', async () => {
    let arrived = false;
    let completed = false;
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: arrived
            ? [
                vc({
                  visitCheckId: 'v9',
                  poiId: 'p1',
                  arrivedAt: T,
                  completedAt: completed ? '2026-08-20T13:40:00' : null,
                }),
              ]
            : [],
        })
      ),
      http.post(`${BASE}/trips/:tripId/visits`, () => {
        arrived = true;
        return HttpResponse.json(
          vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
          { status: 201 }
        );
      }),
      http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () => {
        completed = true;
        return HttpResponse.json(
          vc({
            visitCheckId: 'v9',
            poiId: 'p1',
            arrivedAt: T,
            completedAt: '2026-08-20T13:40:00',
          })
        );
      })
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    fireEvent.press(await screen.findByTestId(arriveId(TODAY, 'p1')));

    // 재조회가 캐시에 도착할 때까지 — 낙관 레코드(optimistic:p1)로 완료를 누르면 가짜 id 로 나간다(02a ★5).
    await waitFor(() =>
      expect(
        client.getQueryData<VisitCheckList>(
          getGetTripsTripIdVisitsDaysDayQueryKey(TRIP_ID, TODAY)
        )?.visits[0]?.visitCheckId
      ).toBe('v9')
    );
    fireEvent.press(await screen.findByTestId('execution-arrive-complete'));

    await waitFor(() =>
      expect(hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/v9/complete`)).toBe(
        1
      )
    );
    expect(observedHits.filter((hit) => hit.includes('optimistic'))).toEqual(
      []
    );
    await waitFor(() =>
      expect(screen.queryByTestId('execution-arrive-complete')).toBeNull()
    );
    expect(
      screen.getByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
    ).toHaveTextContent('13:00');
  });

  it.each([
    [
      '409 이미 도착',
      () =>
        HttpResponse.json(
          { code: 'VISIT_ALREADY_RECORDED', message: 'already' },
          { status: 409 }
        ),
    ],
    ['네트워크 실패', () => HttpResponse.error()],
  ])(
    'W5 도착이 %s 로 실패하면 그 카드만 예정으로 되돌아가고, 다른 레코드는 그대로다 (AC-5)',
    async (_name, failure) => {
      let failed = false;
      server.use(
        ...baseHandlers(
          itineraryOf([
            {
              date: TODAY,
              slots: [
                slot('p1', '감천문화마을', '13:00:00'),
                slot('p2', '광안리 해변', '15:00:00'),
              ],
            },
          ])
        ),
        // p1 은 이미 완료(done) · p2 는 기록 없음(upcoming).
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [
              vc({
                visitCheckId: 'v0',
                poiId: 'p1',
                arrivedAt: T,
                completedAt: '2026-08-20T13:40:00',
              }),
            ],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits`, () => {
          failed = true;
          return failure();
        })
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
        wrapper,
      });
      fireEvent.press(await screen.findByTestId(arriveId(TODAY, 'p2')));

      // 서버가 실패를 돌려준 뒤에 본다 — 그 전 첫 폴링이 "버튼 있음"을 공허하게 통과하지 않게(02a ★6).
      await waitFor(() => expect(failed).toBe(true));
      await waitFor(() => {
        expect(screen.getByTestId(arriveId(TODAY, 'p2'))).toBeOnTheScreen();
        expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
      });
      expect(
        screen.getByTestId(`execution-live-slot-status-${TODAY}#p2`)
      ).toHaveTextContent('예정');
      // 다른 레코드(p1 done)는 그대로.
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00');
      expect(hitCount(VISITS_PATH)).toBe(1);
    }
  );

  it('W6 진행 중 슬롯이 있으면 다른 예정 카드에도 [도착]이 없다 (AC-3 · Q1)', async () => {
    server.use(
      ...baseHandlers(
        itineraryOf([
          {
            date: TODAY,
            slots: [
              slot('p1', '감천문화마을', '13:00:00'),
              slot('p2', '광안리 해변', '15:00:00'),
            ],
          },
        ])
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: [vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })],
        })
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 짝 앵커 — p1 은 active([방문 완료]), p2 는 예정 카드로 실제로 떴다.
    await waitFor(() =>
      expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen()
    );
    expect(
      screen.getByTestId(`execution-live-slot-status-${TODAY}#p2`)
    ).toHaveTextContent('예정');
    expect(
      screen.queryAllByTestId(/^execution-live-slot-arrive-/)
    ).toHaveLength(0);
  });

  it('W7 [도착]은 오늘 탭에서만 — 내일 탭엔 없고, 오늘로 돌아오면 다시 선다 (Q6)', async () => {
    server.use(
      ...baseHandlers(
        itineraryOf([
          { date: TODAY, slots: [slot('p1', '감천문화마을', '13:00:00')] },
          { date: TOMORROW, slots: [slot('p3', '해운대 해변', '10:00:00')] },
        ])
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 오늘(1일차) — [도착]이 있다.
    expect(await screen.findByTestId(arriveId(TODAY, 'p1'))).toBeOnTheScreen();

    // 내일(2일차) — 예정 카드는 뜨지만 [도착]은 없다.
    fireEvent.press(screen.getByTestId('execution-live-daychip-1'));
    expect(
      await screen.findByTestId(`execution-live-slot-time-${TOMORROW}#p3`)
    ).toHaveTextContent('10:00 도착 예정');
    expect(
      screen.queryAllByTestId(/^execution-live-slot-arrive-/)
    ).toHaveLength(0);

    // 오늘로 돌아오면 다시 선다("한 번이라도 탭을 고르면 끈다" 오구현 차단, 02a ★7).
    fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
    expect(await screen.findByTestId(arriveId(TODAY, 'p1'))).toBeOnTheScreen();
  });

  it('W8 [도착]을 연타해도 POST /visits 는 1회뿐이다 (AC-1 "1회")', async () => {
    let arrived = false;
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: arrived
            ? [vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T })]
            : [],
        })
      ),
      http.post(`${BASE}/trips/:tripId/visits`, () => {
        arrived = true;
        return HttpResponse.json(
          vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
          { status: 201 }
        );
      })
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    const arrive = await screen.findByTestId(arriveId(TODAY, 'p1'));

    // 같은 참조를 연달아 — 캐시 갱신의 재렌더는 setTimeout 으로 미뤄져 두 번째 press 때도 버튼이
    // 트리에 남아 있다(02a ★1 · §5-1 실측). 새로 getByTestId 하면 공허해질 수 있다.
    fireEvent.press(arrive);
    fireEvent.press(arrive);

    // 첫 POST 의 응답·무효화(재조회 GET)까지 기다린 뒤 센다 — 두 번째 요청이 늦게 찍히는 것까지 포함(02a ★2).
    await waitFor(() =>
      expect(hitCount(VISITS_GET_TODAY)).toBeGreaterThanOrEqual(2)
    );
    await waitFor(() =>
      expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen()
    );
    expect(hitCount(VISITS_PATH)).toBe(1);
  });

  it.each([
    ['허용', { status: 'granted', granted: true, canAskAgain: true }],
    ['거부', { status: 'denied', granted: false, canAskAgain: false }],
  ])(
    'W9 위치 권한이 %s 이어도 [도착]은 선다 (Q2 — 자동 도착이 없는 동안 유일한 도착 경로)',
    async (_name, permission) => {
      mockGetForeground.mockResolvedValue(permission);
      mockRequestForeground.mockResolvedValue(permission);
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({ visits: [] })
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
        wrapper,
      });

      expect(
        await screen.findByTestId(arriveId(TODAY, 'p1'))
      ).toBeOnTheScreen();
    }
  );
});

/**
 * 이틀 일정 + 날마다 완료 1곳·예정 1곳. 완료 카드(visit-time)는 방문 기록이 **도착해 그려진 뒤에만**
 * 보이므로, 그것을 기다리면 "기록이 아직 안 와서 [도착]이 없다"는 공허 통과를 막는다(02c ★1).
 */
const twoDaysWithDone = () =>
  itineraryOf([
    {
      date: TODAY,
      slots: [
        slot('p0', '자갈치시장', '09:00:00'),
        slot('p1', '감천문화마을', '13:00:00'),
      ],
    },
    {
      date: TOMORROW,
      slots: [
        slot('p2', '동백섬', '09:00:00'),
        slot('p3', '해운대 해변', '10:00:00'),
      ],
    },
  ]);
const doneVisitsOf = (day: string) => ({
  visits: [
    vc({
      visitCheckId: `v-${day}`,
      poiId: day === TODAY ? 'p0' : 'p2',
      slotKey: `${day}#${day === TODAY ? 'p0' : 'p2'}`,
      arrivedAt: `${day}T09:00:00`,
      completedAt: `${day}T09:40:00`,
    }),
  ],
});

describe('LiveItineraryPage · [도착] 게이트 (TRIP-1021 5-c 경고1·2)', () => {
  it.each([
    ['여행 이틀 전(첫날 탭으로 열림)', '2026-08-18', 0],
    ['여행 끝난 뒤(마지막 날 탭으로 열림)', '2026-08-25', 1],
  ])(
    'W10 오늘이 %s 이면 어느 탭에도 [도착]이 없다 (경고1 — 선택 일자 날짜 == 실제 오늘일 때만)',
    async (_name, today, openedIndex) => {
      server.use(
        ...baseHandlers(twoDaysWithDone()),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
          HttpResponse.json(doneVisitsOf(String(params.day)))
        )
      );
      const [opened, other] =
        openedIndex === 0 ? [TODAY, TOMORROW] : [TOMORROW, TODAY];
      const doneOf = (day: string) => (day === TODAY ? 'p0' : 'p2');
      const upcomingOf = (day: string) => (day === TODAY ? 'p1' : 'p3');

      render(<LiveItineraryPage tripId={TRIP_ID} today={today} />, {
        wrapper,
      });

      // 열린 탭 — 완료 카드가 떴다(기록 도착 앵커) + 예정 카드도 있다. 그런데 [도착]은 0.
      expect(
        await screen.findByTestId(
          `execution-live-slot-visit-time-${opened}#${doneOf(opened)}`
        )
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(
          `execution-live-slot-status-${opened}#${upcomingOf(opened)}`
        )
      ).toHaveTextContent('예정');
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);

      // 다른 탭 — 역시 0.
      fireEvent.press(
        screen.getByTestId(`execution-live-daychip-${1 - openedIndex}`)
      );
      expect(
        await screen.findByTestId(
          `execution-live-slot-visit-time-${other}#${doneOf(other)}`
        )
      ).toBeOnTheScreen();
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);
      expect(hitCount(VISITS_PATH)).toBe(0);
    }
  );

  it('W11 짝 — 같은 이틀 일정에서 오늘이 2일차면 2일차 탭에만 [도착]이 선다 (경고1 긍정 앵커)', async () => {
    server.use(
      ...baseHandlers(twoDaysWithDone()),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
        HttpResponse.json(doneVisitsOf(String(params.day)))
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TOMORROW} />, {
      wrapper,
    });

    // 오늘(2일차) — 예정 p3 에 [도착]이 있다(게이트가 "항상 끔"으로 공허하게 통과하지 않게).
    expect(
      await screen.findByTestId(arriveId(TOMORROW, 'p3'))
    ).toBeOnTheScreen();

    // 지난 날(1일차) — 완료 카드 앵커 뒤 [도착] 0.
    fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
    expect(
      await screen.findByTestId(`execution-live-slot-visit-time-${TODAY}#p0`)
    ).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId(/^execution-live-slot-arrive-/)
    ).toHaveLength(0);
  });

  it('W12 방문 기록 조회가 실패(500)하면 예정 카드는 보여도 [도착]은 없다 (경고2)', async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 앵커 ① 예정 카드는 그려졌다 · ② 조회가 실제로 실패 상태에 닿았다(로딩과 구분).
    expect(
      await screen.findByTestId(`execution-live-slot-time-${TODAY}#p1`)
    ).toHaveTextContent('13:00 도착 예정');
    await waitFor(() =>
      expect(
        client.getQueryState(
          getGetTripsTripIdVisitsDaysDayQueryKey(TRIP_ID, TODAY)
        )?.status
      ).toBe('error')
    );
    expect(
      screen.queryAllByTestId(/^execution-live-slot-arrive-/)
    ).toHaveLength(0);
  });

  it('W13 방문 기록 조회가 로딩 중이면 [도착]이 없고, 조회가 성공하면 그때 선다 (경고2 — 성공 뒤에만)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, async () => {
        await gate;
        return HttpResponse.json({ visits: [] });
      })
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 앵커 — 예정 카드가 그려졌고 조회 요청이 나가 응답을 기다리는 중이다.
    expect(
      await screen.findByTestId(`execution-live-slot-time-${TODAY}#p1`)
    ).toHaveTextContent('13:00 도착 예정');
    await waitFor(() => expect(hitCount(VISITS_GET_TODAY)).toBe(1));
    expect(
      screen.queryAllByTestId(/^execution-live-slot-arrive-/)
    ).toHaveLength(0);

    // 조회 성공 → 그제야 [도착]이 선다("로딩이면 영원히 끔" 오구현이 아님을 확인하는 짝).
    release();
    expect(await screen.findByTestId(arriveId(TODAY, 'p1'))).toBeOnTheScreen();
  });
});

describe('LiveItineraryPage · 도착 실패 뒤 재시도 (TRIP-1021 5-c 경고4)', () => {
  it('W14 도착이 네트워크 실패로 되돌아간 뒤 [도착]을 다시 누르면 POST 가 한 번 더 나가고 active 가 된다', async () => {
    let posts = 0;
    let arrived = false;
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: arrived
            ? [vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T })]
            : [],
        })
      ),
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        arriveBodies.push(await request.json());
        posts += 1;
        if (posts === 1) return HttpResponse.error();
        arrived = true;
        return HttpResponse.json(
          vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
          { status: 201 }
        );
      })
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    fireEvent.press(await screen.findByTestId(arriveId(TODAY, 'p1')));

    // 1차 — 서버가 실패를 돌려준 뒤, 롤백으로 [도착]이 다시 섰다.
    await waitFor(() => expect(posts).toBe(1));
    await waitFor(() => {
      expect(screen.getByTestId(arriveId(TODAY, 'p1'))).toBeOnTheScreen();
      expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
    });
    // 가드 해제가 롤백 재렌더보다 늦게 오는 구현도 있다 — 사람 손가락처럼 한 틱 쉬고 누른다(02c ★4).
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    // 2차 — 새로 찾은 [도착]을 누른다(실패 뒤라 연타가 아니다).
    fireEvent.press(screen.getByTestId(arriveId(TODAY, 'p1')));

    await waitFor(() => expect(hitCount(VISITS_PATH)).toBe(2));
    expect(arriveBodies[1]).toEqual({
      slotKey: `${TODAY}#p1`,
      poiId: 'p1',
      source: 'MANUAL',
    });
    await waitFor(() =>
      expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen()
    );
  });
});

describe('LiveItineraryPage · 도착 낙관 반영 (TRIP-1076 AC-2 — 선제 green 증거)', () => {
  it('W15 POST /visits 응답이 오기 전에도 [도착] press 만으로 카드가 active 가 된다 (재조회 없이 낙관 캐시로)', async () => {
    // QA #055 "도착 뒤 다음 터치까지 카드가 그대로" — JS 사슬(press → setQueryData → 사영 → 카드)이
    // 끊겼는지 가른다. POST 를 끝까지 붙잡아 두므로 active 는 낙관 캐시에서만 올 수 있다.
    // green 이면 JS 경로 정상 증거이고, 원인은 네이티브 커밋 쪽(6-b · 새 티켓)으로 넘긴다.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.post(`${BASE}/trips/:tripId/visits`, async () => {
        await gate;
        return HttpResponse.json(
          vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
          { status: 201 }
        );
      })
    );

    try {
      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
        wrapper,
      });

      // 준비 — 예정 카드와 [도착]이 섰고, 방문 기록 조회는 1회로 가라앉았다.
      const arrive = await screen.findByTestId(arriveId(TODAY, 'p1'));
      await waitFor(() => expect(hitCount(VISITS_GET_TODAY)).toBe(1));
      expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();

      // 실행
      fireEvent.press(arrive);

      // 단언 — POST 는 나갔지만 아직 응답 전(gate 잠김)인데 카드가 active 다.
      await waitFor(() => expect(hitCount(VISITS_PATH)).toBe(1));
      await waitFor(() =>
        expect(
          screen.getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen()
      );
      expect(screen.queryByTestId(arriveId(TODAY, 'p1'))).toBeNull();
      // 재조회로 반영된 것이 아니다 — 방문 기록 조회 수가 press 전과 같다.
      expect(hitCount(VISITS_GET_TODAY)).toBe(1);

      // 정리 — 응답을 풀고 성공 뒤 재조회까지 이 테스트 안에서 끝낸다(다음 테스트로 요청이 새지 않게).
      release();
      await waitFor(() =>
        expect(hitCount(VISITS_GET_TODAY)).toBeGreaterThanOrEqual(2)
      );
    } finally {
      // 단언이 먼저 실패해도 붙잡힌 핸들러를 푼다(두 번 불러도 무해).
      release();
    }
  });
});
