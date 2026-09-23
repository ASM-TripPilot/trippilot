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
import type { Itinerary, VisitCheck } from '@/shared/api/generated/schemas';
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
 *  - **W3 (TRIP-746)** 기록이 없으면 upcoming 이고 수동 [도착] 표면이 없다 — POST /visits 0.
 *    (옛 W3 "수동 [도착] press → POST /visits{MANUAL}" 은 도착 자동 원칙으로 표면째 삭제됐다.)
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

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const T = '2026-08-20T13:00:00';

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
const baseHandlers = () => [
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(itinerary())
  ),
];

let observedHits: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
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
  setAccessToken('a');
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockReplace.mockClear();
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

  it('W3 기록이 없으면 upcoming 이고, 수동 [도착]은 없으며 POST /visits 도 나가지 않는다 (TRIP-746 · 도착 자동 원칙)', async () => {
    // TRIP-746 으로 수동 [도착] 표면이 삭제됐다(도착은 지오펜스 자동 — BR-U4-36). 이 케이스는
    // 옛 W3(수동 [도착] press → POST /visits)의 **부재 짝**이다. ⚠️ 지오펜스 실배선 전까지 실앱은
    // active 에 도달할 경로가 없다(Seed 새 티켓 후보) — 버그가 아니라 선행 조건 대기다.
    server.use(
      ...baseHandlers(),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 짝 앵커 — upcoming 카드가 실제로 떴다("13:00 도착 예정", 영업시간 null → 꼬리 없음).
    await waitFor(() =>
      expect(
        screen.getByTestId(`execution-live-slot-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00 도착 예정')
    );
    expect(
      screen.queryByTestId(`execution-arrive-manual-${TODAY}#p1`)
    ).toBeNull();
    expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
    expect(hitCount(`POST /api/v1/trips/${TRIP_ID}/visits`)).toBe(0);
  });
});
