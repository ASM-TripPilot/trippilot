import { http, HttpResponse } from 'msw';
import type { SetupServer } from 'msw/node';

import type { Itinerary, Trip } from '@/shared/api/index.schemas';

/**
 * 일정(itinerary) 통합 테스트용 MSW 조각(TRIP-1351) — 요청 로거(`observedHits`/`hitsFor`)와 여행·일정 기본 핸들러(`serveItinerary`).
 * DraftPage·ItineraryPlanPage 통합 파일의 describe 마다 `server.use(http.get(trips/:id)…)` 와 `request:start` 리스너를 복사해 쓰던 것이다.
 *
 * 쓰는 법: 파일 최상위 `beforeAll` 에서 `log.attach()`, 각 `beforeEach` 에서 `log.reset()` 뒤 `serveItinerary(server, {...})`.
 * 이 파일은 `server` 를 import 하지 않고 인자로 받는다 — 테스트가 `@/mocks/server` 를 정하게 둔다.
 */

export const BASE = 'http://localhost:8080/api/v1';

/** 나간 요청의 `METHOD /경로` 누적 — **도착 순서 그대로** 쌓인다. ⚠️ `request:start` 는 핸들러가 돌기 전에 발화한다. */
export function createRequestLog(server: SetupServer) {
  let hits: string[] = [];
  return {
    attach(): void {
      server.events.on('request:start', ({ request }) => {
        hits.push(`${request.method} ${new URL(request.url).pathname}`);
      });
    },
    reset(): void {
      hits = [];
    },
    all(): string[] {
      return hits;
    },
    /** `method` 로 시작하고 `includes` 를 포함하는 요청 수. */
    hitsFor(method: string, includes: string): number {
      return hits.filter(
        (hit) => hit.startsWith(method) && hit.includes(includes)
      ).length;
    },
  };
}

export interface ServeItineraryOptions {
  /** `GET /trips/:tripId` 본문(`Response` 를 돌려주면 그대로 — 404·500·네트워크 오류용) — 안 주면 이 핸들러를 걸지 않는다. */
  trip?: () => Trip | Response | Promise<Trip | Response>;
  /** `GET /trips/:tripId/itinerary` 본문. `Response` 를 돌려주면 그대로(오류 응답·지연용). */
  itinerary: () => Itinerary | Response | Promise<Itinerary | Response>;
  /** `POST /trips/:tripId/itinerary` — 안 주면 걸지 않는다. */
  post?: () => Response | Promise<Response>;
  /** `PUT /trips/:tripId/itinerary` — 안 주면 걸지 않는다. */
  put?: () => Response | Promise<Response>;
  /** `POST /trips/:tripId/itinerary/confirm` — 안 주면 걸지 않는다. */
  confirm?: () => Response | Promise<Response>;
}

/** 여행·일정 기본 핸들러를 건다. 통합 버킷은 `onUnhandledRequest: 'error'` 라 핸들러가 없으면 준비 단계에서 죽는다. */
export function serveItinerary(
  server: SetupServer,
  { trip, itinerary, post, put, confirm }: ServeItineraryOptions
): void {
  server.use(
    ...(trip
      ? [
          http.get(`${BASE}/trips/:tripId`, async () => {
            const body = await trip();
            return body instanceof Response ? body : HttpResponse.json(body);
          }),
        ]
      : []),
    http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
      const body = await itinerary();
      return body instanceof Response ? body : HttpResponse.json(body);
    }),
    ...(post
      ? [http.post(`${BASE}/trips/:tripId/itinerary`, () => post())]
      : []),
    ...(put ? [http.put(`${BASE}/trips/:tripId/itinerary`, () => put())] : []),
    ...(confirm
      ? [http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => confirm())]
      : [])
  );
}
