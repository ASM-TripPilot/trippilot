import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  AssignBaseRequest,
  BaseAssignment,
  SavedStay,
  Trip,
  TripStatus,
} from '@/shared/api/index.schemas';

/**
 * 상태를 기억하는 거점(bases)·저장 숙소 가짜 서버(TRIP-1353) — `TripBasesPage.integration` 의 두 describe(여행 단위 거점 화면 ·
 * 편집 모드)가 글자까지 같게 복제해 쓰던 것이다. DELETE 는 목록에서 지우고 POST 는 더하므로 "재조회 뒤 카드가 B 다"를 목이 아니라
 * 서버 흉내의 결과로 잰다. 교체 **순서**는 `handled`(서버가 처리를 끝낸 순서)로 잰다 — DELETE 를 일부러 30ms 늦게 끝내므로,
 * DELETE 를 기다리지 않고 POST 를 같이 쏘면 POST 가 먼저 기록돼 red 가 된다.
 *
 * 쓰는 법: describe 본문에서 `createBasesFakeServer(tripId)` 를 한 번 부른다(요청 관찰자의 `beforeAll`/`afterAll` 을 건다). 매 테스트
 * `beforeEach` 에서 `fake.reset({...})` 로 초기 상태를 정하고(→ 새 `QueryClient` 도 만든다) `fake.install()` 로 핸들러를 건다.
 * 테스트는 `fake.serverBases = [...]`·`fake.failPostAt = 1` 처럼 상태 필드를 직접 바꾼다.
 *
 * ⚠️ 연타 가드 창 리셋(`resetPressGuard`)·라우터 목 리셋·`setAccessToken` 은 describe 몫이다 — 이 모듈은 라우터를 모른다.
 * 모듈 스코프 `.ts` 라 JSX 가 없다(JSX 가 있는 하네스는 `wizardStep1Harness.tsx` 처럼 별도 `.tsx`).
 */

const BASE = 'http://localhost:8080/api/v1';

export function basesStay(savedStayId: string, name: string): SavedStay {
  return {
    savedStayId,
    name,
    coordConfirmed: true,
    linkedTripIds: [],
    checkIn: null,
    checkOut: null,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

// 두 이름은 서로의 부분 문자열이 아니다 — 카드 텍스트 부분 일치(정규식)가 서로를 잡지 않게.
export const STAY_A = basesStay('stay-a', '롯데호텔 서울');
export const STAY_B = basesStay('stay-b', '메리어트 동대문');

export function basesAssignment(
  baseAssignmentId: string,
  savedStayId: string,
  dateFrom: string,
  dateTo: string
): BaseAssignment {
  return { baseAssignmentId, savedStayId, dateFrom, dateTo };
}

/** 서울특별시 N박 여행(9/26 시작). 기본 2박 = 9/26·9/27 두 밤. */
export function basesTrip(
  tripId: string,
  {
    nights = 2,
    status = 'PLANNED',
    itineraryDayCount = 0,
  }: { nights?: number; status?: TripStatus; itineraryDayCount?: number } = {}
): Trip {
  return {
    tripId,
    title: '서울 여행',
    startDate: '2026-09-26',
    endDate: `2026-09-${26 + nights}`,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '서울특별시', nights }],
    status,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    baseCount: 1,
    itineraryDayCount,
  };
}

/**
 * 네트워크를 타는 기다림의 상한. RNTL 기본(1초)은 첫 실행(모듈 변환·msw 기동)에서 DELETE→POST→재조회 사슬을 못 기다려 단독
 * 실행에서만 간헐 red 가 났다(실측 — 묶음 실행은 green). CI 러너는 로컬보다 ~4배 느리다(PR #766 실측 — 이 파일 로컬 10s · CI 40s).
 * 결과를 바꾸지 않고 "얼마나 기다리나"만 늘린다.
 */
export const NETWORK_WAIT = { timeout: 15000 };

/** n박 카드를 눌러 시트를 열고 숙소를 골라 "지정"한다. */
export function assignNight(nightNumber: number, savedStayId: string): void {
  fireEvent.press(screen.getByTestId(`trip-base-night-card-${nightNumber}`));
  fireEvent.press(
    screen.getByTestId(`trip-base-staysheet-cand-${savedStayId}`)
  );
  fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
}

/**
 * 지정이 끝나 시트가 닫힐 때까지 기다린다.
 * `.toBeNull()` 이 아니라 `.not.toBeOnTheScreen()` — 시트가 열려 있는 동안 실패 때마다 `toBeNull` 은 받은 요소(fiber 그래프)를
 * 통째로 문자열로 만들어 폴링 한 번이 수백 ms CPU 를 쓴다. 이 매처는 요소 하나만 찍고, 요소가 없으면(null) 곧바로 통과한다.
 */
export async function sheetClosed(): Promise<void> {
  await waitFor(
    () =>
      expect(screen.queryByTestId('trip-base-staysheet')).not.toBeOnTheScreen(),
    NETWORK_WAIT
  );
}

/** 요청이 나갈 틈을 준다 — "0건" 단언이 "아직 안 나갔을 뿐"으로 공짜 통과하지 않게. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

export interface BasesFakeInit {
  serverBases?: BaseAssignment[];
  serverTrip: Trip;
  savedStays?: SavedStay[];
}

export function createBasesFakeServer(tripId: string) {
  const fake = {
    tripId,
    /** 서버가 지금 들고 있는 배정 — DELETE 가 지우고 POST 가 더한다. */
    serverBases: [] as BaseAssignment[],
    serverTrip: undefined as unknown as Trip,
    savedStays: [] as SavedStay[],
    /** 나간 요청 `METHOD /경로`(발사 순서) — 핸들러 없는 요청도 기록된다. */
    hits: [] as string[],
    /** 서버가 **처리를 끝낸** 순서 — 교체 순서(DELETE 먼저) 판정은 이 기록으로 한다. */
    handled: [] as string[],
    /** 받은 POST 본문(도착 순서). */
    postBodies: [] as AssignBaseRequest[],
    /** n 번째 POST(1부터)를 500 으로 — 중간 실패 재현. */
    failPostAt: null as number | null,
    /** 다음 GET 한 번을 500 으로 — 재시도 재현. 한 번 실패하면 스스로 꺼진다. */
    failOnce: { trip: false, stays: false, bases: false },
    /** 여행 GET 응답을 붙잡는 문 — loading 얼굴을 결정론적으로 만든다. */
    tripGate: null as Promise<void> | null,
    postSeq: 0,
    /** retry:false — 실패를 곧바로 얼굴로. gcTime:0 — 테스트 뒤 타이머가 프로세스를 붙잡지 않게. */
    client: undefined as unknown as QueryClient,

    hitCount(needle: string): number {
      return fake.hits.filter((hit) => hit === needle).length;
    },

    /** 매 테스트 시작 — 서버 상태·관찰 기록을 비우고 새 `QueryClient` 를 만든다. */
    reset(init: BasesFakeInit): void {
      fake.serverBases = init.serverBases ?? [];
      fake.serverTrip = init.serverTrip;
      fake.savedStays = init.savedStays ?? [STAY_A, STAY_B];
      fake.hits = [];
      fake.handled = [];
      fake.postBodies = [];
      fake.failPostAt = null;
      fake.failOnce = { trip: false, stays: false, bases: false };
      fake.tripGate = null;
      fake.postSeq = 0;
      fake.client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false, gcTime: 0 },
        },
      });
    },

    install(): void {
      server.use(
        http.get(`${BASE}/trips/:tripId`, async ({ params }) => {
          if (params.tripId !== tripId)
            return new HttpResponse(null, { status: 404 });
          if (fake.tripGate) await fake.tripGate;
          if (fake.failOnce.trip) {
            fake.failOnce.trip = false;
            return new HttpResponse(null, { status: 500 });
          }
          return HttpResponse.json(fake.serverTrip);
        }),
        http.get(`${BASE}/saved-stays`, () => {
          if (fake.failOnce.stays) {
            fake.failOnce.stays = false;
            return new HttpResponse(null, { status: 500 });
          }
          return HttpResponse.json(fake.savedStays);
        }),
        http.get(`${BASE}/trips/:tripId/bases`, ({ params }) => {
          if (params.tripId !== tripId)
            return new HttpResponse(null, { status: 404 });
          if (fake.failOnce.bases) {
            fake.failOnce.bases = false;
            return new HttpResponse(null, { status: 500 });
          }
          return HttpResponse.json(fake.serverBases);
        }),
        http.delete(
          `${BASE}/trips/:tripId/bases/:baseAssignmentId`,
          async ({ params }) => {
            // 일부러 늦게 끝낸다 — DELETE 를 기다리지 않고 POST 를 같이 쏘면 POST 가 먼저 기록된다.
            await new Promise((resolve) => setTimeout(resolve, 30));
            const id = String(params.baseAssignmentId);
            const exists = fake.serverBases.some(
              (row) => row.baseAssignmentId === id
            );
            if (params.tripId !== tripId || !exists) {
              return new HttpResponse(null, { status: 404 });
            }
            fake.serverBases = fake.serverBases.filter(
              (row) => row.baseAssignmentId !== id
            );
            fake.handled.push(`DELETE ${id}`);
            return new HttpResponse(null, { status: 204 });
          }
        ),
        http.post(
          `${BASE}/trips/:tripId/bases`,
          async ({ params, request }) => {
            const body = (await request.json()) as AssignBaseRequest;
            fake.postBodies.push(body);
            fake.handled.push(`POST ${body.savedStayId} ${body.dateFrom}`);
            if (params.tripId !== tripId)
              return new HttpResponse(null, { status: 404 });
            if (
              fake.failPostAt !== null &&
              fake.postBodies.length === fake.failPostAt
            ) {
              return new HttpResponse(null, { status: 500 });
            }
            fake.postSeq += 1;
            const created = {
              baseAssignmentId: `new-${fake.postSeq}`,
              ...body,
            };
            fake.serverBases = [...fake.serverBases, created];
            return HttpResponse.json(created, { status: 201 });
          }
        )
      );
    },
  };

  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      fake.hits.push(`${request.method} ${new URL(request.url).pathname}`);
    });
  });

  // 이 describe 의 관찰자만 떼어 낸다 — 다음 describe 의 요청이 이 배열로 새지 않게.
  afterAll(() => server.events.removeAllListeners('request:start'));

  return fake;
}
