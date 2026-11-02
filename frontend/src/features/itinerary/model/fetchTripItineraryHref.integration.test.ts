import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdItineraryQueryOptions,
} from '@/shared/api/index.hooks';
import type { Itinerary } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import {
  DAY1,
  TRIP_ID,
  day,
  itinerary,
  slot,
} from '@/test-support/itineraryFixtures';
import { BASE, createRequestLog } from '@/test-support/mswItinerary';
import { itineraryHits } from '@/test-support/tripItineraryCols';
import { newTestQueryClient } from '@/test-support/queryRender';

import { fetchTripItineraryHref } from './fetchTripItineraryHref';

/**
 * TRIP-1677 · AC-3 — `fetchTripItineraryHref(queryClient, tripId)`: 카드·홈 CTA·셸 [보기]가 "같이 짜기(copick) 생성 중" 여행을 누르는 순간,
 * 일정을 **한 번** 받아 이동할 주소(href)를 만든다. 목록(`GET /trips`)에는 일정의 `days` 가 없어서 첫 비고정 슬롯 키를 주소에 넣으려면 이 조회가 필요하다.
 *
 * 무엇을 보장하나:
 *  - F1 PARTIAL+CO_PLAN 응답 → `copick/<인코딩된 첫 비고정 슬롯 키>` (고정 슬롯은 건너뛴다), 일정 GET 정확히 1번.
 *  - F2 받은 응답으로 목적지를 **다시 판정**한다 — 그사이 생성이 끝났으면 슬롯 채우기가 아니라 완성 확인/초안/허브로 간다.
 *  - F3 404("일정 없음")는 에러가 아니라 방식 선택(`method`) 목적지다.
 *  - F4 그 밖의 실패(500·429)는 던진다 — 호출부가 "이동 안 함 + 안내"를 한다(INV-4). 앱 기본 재시도(3회)를 이 호출만 끈다(GET 1번).
 *  - F5 신선한 캐시가 있어도 다시 묻는다 — 누른 시점의 서버 값으로 정한다.
 *
 * 어떻게: 실 `QueryClient` + msw. 라우터·토스트·연타 잠금은 이 함수 밖(호출부)이라 여기선 안 본다.
 * 3동작 뼈대: 준비 = 서버가 줄 일정 · 클라이언트 → 실행 = 함수 호출 → 단언 = 돌려준 href · 요청 수.
 */

const log = createRequestLog(server);
let reply: () => Response = () => HttpResponse.json(copick());

/** 슬롯 셋 — poi-a 는 고정(건너뜀), 첫 비고정은 poi-b. */
const DAYS = [
  day(DAY1, [
    slot('poi-a', { isFixed: true }),
    slot('poi-b'),
    slot('poi-c', { startAt: '13:00:00', endAt: '14:00:00' }),
  ]),
];

function copick(over: Partial<Itinerary> = {}): Itinerary {
  return itinerary({
    tripId: TRIP_ID,
    generationMode: 'CO_PLAN',
    generationState: 'PARTIAL',
    generationSessionId: 'sess-1',
    days: DAYS,
    ...over,
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  log.attach();
});

beforeEach(() => {
  log.reset();
  clearAccessToken();
  setAccessToken('valid-access');
  reply = () => HttpResponse.json(copick());
  server.use(http.get(`${BASE}/trips/:tripId/itinerary`, () => reply()));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const errorBody = (code: string) => ({ error: { code, message: code } });

/** 클라이언트 기본 재시도를 3회·지연 0 으로 올린다 — 함수가 `retry:false` 를 직접 거는지 가르려는 장치(02a ★6). */
function retryingClient() {
  const client = newTestQueryClient();
  client.setDefaultOptions({ queries: { retry: 3, retryDelay: 0 } });
  return client;
}

describe('F1 · copick 응답 → 첫 비고정 슬롯 주소 (AC-3)', () => {
  it('고정 슬롯을 건너뛴 첫 비고정 슬롯의 copick 주소를 내고, 일정 GET 은 1번이다', async () => {
    // 준비 — 서버는 같이 짜기 생성 중인 일정을 준다.
    const client = newTestQueryClient();

    // 실행
    const href = await fetchTripItineraryHref(client, TRIP_ID);

    // 단언 — `#` 는 주소의 조각 구분자라 %23 으로 인코딩돼 실린다.
    expect(href).toBe(
      `/trips/${TRIP_ID}/itinerary/copick/${encodeURIComponent(`${DAY1}#poi-b`)}`
    );
    expect(itineraryHits(log.all())).toBe(1);
  });
});

describe('F2 · 받은 응답으로 목적지를 다시 판정한다 (AC-3)', () => {
  it.each<[string, Itinerary, string]>([
    [
      '그사이 같이 짜기 생성이 끝남(COMPLETE+CO_PLAN)',
      copick({ generationState: 'COMPLETE', generationSessionId: null }),
      `/trips/${TRIP_ID}/itinerary/copick/complete`,
    ],
    [
      '그사이 완전 AI 완료',
      copick({
        generationMode: 'FULLY_AI',
        generationState: 'COMPLETE',
        generationSessionId: null,
      }),
      `/trips/${TRIP_ID}/itinerary/draft`,
    ],
    [
      '그사이 실패',
      copick({ generationState: 'FAILED', generationSessionId: null }),
      `/trips/${TRIP_ID}/itinerary/draft`,
    ],
    [
      '그사이 확정',
      copick({
        status: 'CONFIRMED',
        generationState: 'COMPLETE',
        generationSessionId: null,
      }),
      `/trips/${TRIP_ID}/live`,
    ],
  ])('%s', async (_label, served, expected) => {
    reply = () => HttpResponse.json(served);

    const href = await fetchTripItineraryHref(newTestQueryClient(), TRIP_ID);

    expect(href).toBe(expected);
  });
});

describe('F3 · 404 는 "일정 없음" 목적지다 (AC-3)', () => {
  it('방식 선택(method) 주소를 주고, 404 는 다시 묻지 않는다(GET 1)', async () => {
    reply = () => HttpResponse.json(errorBody('NOT_FOUND'), { status: 404 });

    const href = await fetchTripItineraryHref(retryingClient(), TRIP_ID);

    expect(href).toBe(`/trips/${TRIP_ID}/itinerary/method`);
    expect(itineraryHits(log.all())).toBe(1);
  });
});

describe('F4 · 그 밖의 실패는 던지고, 앱 기본 재시도를 이 호출만 끈다 (INV-4 · AC-3)', () => {
  it.each<[string, number]>([
    ['500', 500],
    ['429', 429],
  ])(
    '%s → reject, 일정 GET 정확히 1번(클라이언트 기본 재시도 3회인데도)',
    async (_label, status) => {
      reply = () => HttpResponse.json(errorBody('FAIL'), { status });

      await expect(
        fetchTripItineraryHref(retryingClient(), TRIP_ID)
      ).rejects.toBeDefined();

      expect(itineraryHits(log.all())).toBe(1);
    }
  );

  it('앵커 — 같은 클라이언트의 일반 조회는 500 에서 재시도한다(위 "1번"이 클라이언트 설정 덕이 아님을 보인다)', async () => {
    // 준비 — 같은 재시도 클라이언트로 함수를 거치지 않고 직접 조회한다.
    reply = () => HttpResponse.json(errorBody('FAIL'), { status: 500 });
    const client = retryingClient();

    // 실행 — 일정 조회 옵션을 그대로 fetchQuery(재시도 옵션은 클라이언트 기본을 따른다).
    await client
      .fetchQuery(getGetTripsTripIdItineraryQueryOptions(TRIP_ID))
      .catch(() => undefined);

    // 단언 — 첫 시도 + 재시도 3번 = 4번.
    expect(itineraryHits(log.all())).toBe(4);
  });
});

describe('F5 · 신선한 캐시가 있어도 누른 시점의 서버 값을 다시 묻는다 (AC-3)', () => {
  it('staleTime 이 길게 시드된 캐시를 두고도 일정 GET 1번 — 캐시의 옛 PARTIAL 이 아니라 서버의 COMPLETE 로 판정', async () => {
    // 준비 — 캐시엔 옛 PARTIAL(copick), 서버는 이미 COMPLETE. 클라이언트는 30분간 신선하다고 본다.
    const client = newTestQueryClient({ staleTime: 30 * 60_000 });
    client.setQueryData(getGetTripsTripIdItineraryQueryKey(TRIP_ID), copick());
    reply = () =>
      HttpResponse.json(
        copick({ generationState: 'COMPLETE', generationSessionId: null })
      );

    // 실행
    const href = await fetchTripItineraryHref(client, TRIP_ID);

    // 단언
    expect(href).toBe(`/trips/${TRIP_ID}/itinerary/copick/complete`);
    expect(itineraryHits(log.all())).toBe(1);
  });
});
