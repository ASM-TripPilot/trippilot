import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useGetTrips } from '@/shared/api/generated/trips/trips';
import {
  useGetPlaces,
  useGetSavedPlaces,
} from '@/shared/api/generated/places/places';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { useSavedPlaces, type SavedPlacesOutcome } from './savedPlaces';

/**
 * TRIP-220 AC-4 · AC-5 · AC-6 · AC-7 · AC-8 (+ 01b Seed Q2) — 담기 토글 훅의 서버 상태.
 *
 * 무엇을 보장하나:
 *  - **I-1 (AC-4)** 담기를 누르면 **서버가 답하기 전에** 담김으로 보이고, 성공 후 담은 목록·
 *    장소 목록 **두 쿼리만** 다시 받아온다.
 *  - **I-2 (AC-5)** 해제는 poiId가 아니라 **savedPlaceId**로 나간다.
 *  - **I-3 (AC-6)** 409(이미 담음)는 실패가 아니라 담김으로 수렴한다.
 *  - **I-4 (AC-7 · INV-4)** 404·네트워크 실패는 낙관 반영을 되돌리고 **사유를 호출자에게 준다.**
 *  - **I-5 (AC-8 · BR-U1-03)** 미로그인이면 요청을 아예 보내지 않는다 — 담기·해제뿐 아니라
 *    담은 목록 조회까지 0건이다.
 *  - **I-6 (Q2)** 담은 목록이 아직 안 왔으면 해제 요청을 보내지 않고 사유를 올린다.
 *
 * > *(개념)* **낙관적 업데이트(optimistic update)** — 서버 응답을 기다리지 않고 "성공했다고
 * > 치고" 캐시를 먼저 바꾸는 것. 실패하면 바꾸기 전 값으로 **되돌린다**(롤백). 리포에서 이번이
 * > 처음이다 — 지금까지 모든 mutation은 "서버가 답하면 무효화"라는 단순 모양이었다.
 * >
 * > *(개념)* **쿼리 무효화(invalidate)** — 캐시를 지우는 게 아니라 "이제 못 믿는다, 필요해지면
 * > 다시 받아라"는 상한 표시를 붙이는 것. **화면에 떠 있는(=활성) 쿼리만** 표시가 붙는 즉시
 * > 다시 요청한다 — 아래 probe가 세 쿼리를 함께 띄우는 이유가 그것이다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 나간 경로(해제가 어느 id를 실었나)
 * 와 재요청 횟수는 msw만 관찰할 수 있다(`useCreateTrip.integration.test.tsx`와 같은 이유).
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 무효화 대상 두 쿼리와 실패 사유 4갈래가 바뀌지 않는 한 유효하다.
 * d04·d02 화면(TRIP-221~223)이 붙어도 이 단언들은 red를 내지 않는다 — 화면을 렌더하지 않는다.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage 를 정적으로
// 물고 있다. 이 시나리오들은 401 이 없어 실제로 호출되지는 않지만, expo-secure-store 실물
// 로드를 피하려면 useCreateTrip.integration.test.tsx:60 과 같은 형태로 목킹해야 한다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

/** authWiring.integration.test.ts:59 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

const POI_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const POI_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
/** 서버가 이미 갖고 있는 B 의 담기 기록 id — 해제가 실어야 할 값이다. */
const SAVED_ID_B = '22222222-2222-2222-2222-222222222222';
/** 서버가 담기 성공 시 새로 발급하는 id. */
const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

/** openapi `Place.required` 8필드를 전부 채운다 — 픽스처를 상상해서 만들지 않는다. */
function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 33.4589,
    lng: 126.9425,
    region: '제주',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

/** 아직 담지 않은 장소. */
const PLACE_A = makePlace(POI_A, '성산일출봉');
/** 이미 담은 장소. */
const PLACE_B = makePlace(POI_B, '카페 델문도');
const SAVED_B: SavedPlace = {
  savedPlaceId: SAVED_ID_B,
  savedAt: '2026-08-01T00:00:00Z',
  place: PLACE_B,
};

/**
 * 테스트가 풀어 줄 때까지 응답하지 않는 문. "서버 응답 **전**"이라는 조건을 시간이 아니라
 * 신호로 만든다 — `delay(ms)`로 재면 느린 CI에서 흔들리고, 무엇보다 "아직 안 왔다"를
 * 결정론적으로 보장하지 못한다.
 */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/** 나간 요청의 `METHOD /경로` 누적 — 재요청 횟수와 **어느 id로 나갔는지**를 세는 데 쓴다. */
let observedHits: string[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  clearAccessToken();
  // 기본 handlers.ts 에 places 계열이 하나도 없다. `onUnhandledRequest: 'error'` 라 안 걸면
  // 요청이 에러로 죽는데, 그 성질을 그대로 쓴다 — 예상 못 한 요청이 조용히 통과하지 않는다.
  // GET /trips 는 **무효화 부정 짝의 모집단**이다(아래 probe 주석).
  server.use(
    http.get(`${BASE}/places`, () => HttpResponse.json([PLACE_A, PLACE_B])),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([SAVED_B])),
    http.get(`${BASE}/trips`, () => HttpResponse.json([]))
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime: 0 — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를
      // 붙잡는다. **mutations 쪽도 반드시 0으로 둔다**: mutation 기본 gcTime 은 5분이고,
      // 빼면 이 버킷이 300초 매달린다(TRIP-203 실측).
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

/**
 * 세 쿼리를 함께 띄운 관찰용 훅.
 *
 * - `savedList`·`places` — 무효화 대상 둘. 무효화가 **실제 재요청**으로 이어지는지 보려면 그
 *   쿼리가 활성이어야 한다.
 * - `trips` — **무효화 부정 짝**. 이게 없으면 `invalidateQueries()`를 인자 없이 불러 모든
 *   캐시를 날리는 구현도 AC-4②를 통과한다(`useCreateTrip.integration.test.tsx` D-1 단언②가
 *   같은 이유로 세워진 선례다).
 */
function useProbe(isAuthed: boolean) {
  return {
    savedList: useGetSavedPlaces(),
    places: useGetPlaces(),
    trips: useGetTrips(),
    saved: useSavedPlaces({ isAuthed }),
  };
}

/** 세 쿼리가 각각 한 번씩 다녀온 상태를 만든다. 이후 증가분이 곧 무효화의 사정거리다. */
async function renderProbeReady(isAuthed = true) {
  const rendered = renderHook(() => useProbe(isAuthed), {
    wrapper: createWrapper(),
  });
  await waitFor(() =>
    expect(rendered.result.current.savedList.isSuccess).toBe(true)
  );
  await waitFor(() =>
    expect(rendered.result.current.places.isSuccess).toBe(true)
  );
  await waitFor(() =>
    expect(rendered.result.current.trips.isSuccess).toBe(true)
  );

  // 앵커 — 초기 상태가 실제로 "각 1회"다. 이게 없으면 아래 증가 단언이 무엇에서 무엇으로
  // 늘었는지 말하지 못한다. 담은 목록이 **한 번만** 나갔다는 것은 훅과 probe가 같은 쿼리 키를
  // 쓴다는 뜻이기도 하다(키를 손으로 다시 적으면 여기서 2가 된다).
  expect(hitCount('GET /api/v1/saved-places')).toBe(1);
  expect(hitCount('GET /api/v1/places')).toBe(1);
  expect(hitCount('GET /api/v1/trips')).toBe(1);

  return rendered;
}

describe('AC-4 · 담기 — 응답 전 반영 + 두 쿼리만 무효화 (I-1)', () => {
  it('서버가 답하기 전에 담김으로 보이고, 성공 후 담은 목록·장소 목록만 다시 받아온다', async () => {
    // 준비 — 담기 응답을 문 뒤에 세워 둔다. 문이 열리기 전까지 서버는 답하지 않는다.
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.post(`${BASE}/saved-places`, async () => {
        await gate.opened;
        return HttpResponse.json(
          {
            savedPlaceId: NEW_SAVED_ID,
            savedAt: '2026-08-03T00:00:00Z',
            place: PLACE_A,
          },
          { status: 201 }
        );
      })
    );
    const { result } = await renderProbeReady();
    // 앵커 — 시작 상태가 "안 담김"이다. 이게 없으면 아래 true 단언이 원래부터 true였는지
    // 낙관 삽입 때문인지 구별되지 않는다.
    expect(result.current.saved.isSaved(POI_A)).toBe(false);

    // 실행 ① — 담기를 발사만 하고 기다리지 않는다.
    let pending!: Promise<SavedPlacesOutcome>;
    await act(async () => {
      pending = result.current.saved.save(PLACE_A);
    });

    // 단언 ① — **서버가 아직 답하지 않았는데** 이미 담김이다(US-EXPL-04 "즉시 반영").
    expect(result.current.saved.isSaved(POI_A)).toBe(true);
    // 단언 ② — 요청은 실제로 나갔고(낙관만 하고 안 보내는 구현이 아니다), 이 시점에 무효화는
    // 아직 없다(담은 목록 재요청 0건).
    expect(hitCount('POST /api/v1/saved-places')).toBe(1);
    expect(hitCount('GET /api/v1/saved-places')).toBe(1);

    // 실행 ② — 문을 열어 서버가 답하게 한다.
    gate.release();
    let outcome!: SavedPlacesOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ③ — 결과가 담김이다(실패도 아니고 "모름"도 아니다).
    expect(outcome).toEqual({ kind: 'saved' });

    // 단언 ④ — 두 쿼리가 무효화되어 실제로 다시 받아왔다(1 → 2).
    // `GET /places` 도 대상인 근거: `Place.savedCount` 가 담기로 변한다(BR-U1-06 파생 집계).
    await waitFor(() => expect(hitCount('GET /api/v1/saved-places')).toBe(2));
    await waitFor(() => expect(hitCount('GET /api/v1/places')).toBe(2));

    // 단언 ⑤ (부정 짝) — 무효화 사정거리는 그 둘뿐이다.
    expect(hitCount('GET /api/v1/trips')).toBe(1);
  });
});

describe('AC-5 · 해제 — poiId 가 아니라 savedPlaceId 로 나간다 (I-2)', () => {
  it('응답 전에 목록에서 빠지고, 해제 요청이 담기 기록 id를 싣고 나간다', async () => {
    // 준비 — 해제 응답도 문 뒤에 세운다. 경로 패턴은 어떤 세그먼트든 받는다(`:savedPlaceId`)
    // — 그래야 poiId 를 그대로 넣는 구현도 **죽지 않고 잡힌다**(죽으면 원인이 가려진다).
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.delete(`${BASE}/saved-places/:savedPlaceId`, async () => {
        await gate.opened;
        return new HttpResponse(null, { status: 204 });
      })
    );
    const { result } = await renderProbeReady();
    // 앵커 — 시작 상태가 "담김"이다.
    expect(result.current.saved.isSaved(POI_B)).toBe(true);

    // 실행 ①
    let pending!: Promise<SavedPlacesOutcome>;
    await act(async () => {
      pending = result.current.saved.remove(POI_B);
    });

    // 단언 ① — 서버가 답하기 전에 이미 빠졌다(BR-U1-04 "해제 시 즉시 목록에서 빠진다").
    expect(result.current.saved.isSaved(POI_B)).toBe(false);

    // 단언 ② — 나간 경로가 담기 기록 id 다.
    expect(hitCount(`DELETE /api/v1/saved-places/${SAVED_ID_B}`)).toBe(1);

    // 단언 ③ (부정 짝) — poiId 를 그대로 경로에 넣지 않았다. 이 짝이 없으면 poiId 구현이
    // 서버 404 를 받고, 그 실패가 AC-7 의 롤백에 흡수되어 **"동작은 하는데 아무것도 안 되는"**
    // 모양으로 조용히 남는다.
    expect(hitCount(`DELETE /api/v1/saved-places/${POI_B}`)).toBe(0);

    // 실행 ②
    gate.release();
    let outcome!: SavedPlacesOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ④⑤⑥
    expect(outcome).toEqual({ kind: 'removed' });
    await waitFor(() => expect(hitCount('GET /api/v1/saved-places')).toBe(2));
    await waitFor(() => expect(hitCount('GET /api/v1/places')).toBe(2));
    expect(hitCount('GET /api/v1/trips')).toBe(1);
  });
});

describe('AC-6 · 409(이미 담음)는 실패가 아니라 담김으로 수렴한다 (I-3)', () => {
  it('409 를 받아도 실패로 표시하지 않고, 롤백하지 않으며, 담은 목록을 다시 받아온다', async () => {
    // 준비 — 서버가 "이미 담겨 있다"고 답한다. 요청의 **목표 상태**(담김)와 **결과 상태**(담김)가
    // 같으므로 실패가 아니다(INV-U1-04 (계정,POI) 유일의 자연스러운 귀결).
    //
    // ★ 목의 두 응답이 서로 모순이면 안 된다. 서버가 409("A 는 이미 담겨 있다")를 준다면
    //   그 서버의 담은 목록에는 **A 가 들어 있어야 한다.** 우리 화면의 첫 조회가 그보다
    //   앞서 끝났을 뿐이다(예: A 를 다른 기기에서 담았다) — 그 어긋남이 곧 409 가 나는
    //   이유다. 그래서 첫 조회는 A 없이, 무효화 재조회부터는 A 를 포함해 답한다.
    //   이 정합이 없으면(전부 `[SAVED_B]` 고정) 아래 단언 ②가 "롤백했나"가 아니라
    //   "재조회 응답이 아직 안 왔나"를 재게 되어 실행마다 판정이 뒤집힌다.
    setAccessToken('valid-access');
    const SAVED_A_ON_SERVER: SavedPlace = {
      savedPlaceId: NEW_SAVED_ID,
      savedAt: '2026-08-02T00:00:00Z',
      place: PLACE_A,
    };
    let savedListReads = 0;
    server.use(
      http.get(`${BASE}/saved-places`, () => {
        savedListReads += 1;
        return HttpResponse.json(
          savedListReads === 1 ? [SAVED_B] : [SAVED_B, SAVED_A_ON_SERVER]
        );
      }),
      http.post(`${BASE}/saved-places`, () =>
        HttpResponse.json({}, { status: 409 })
      )
    );
    const { result } = await renderProbeReady();
    expect(result.current.saved.isSaved(POI_A)).toBe(false);

    // 실행
    let outcome!: SavedPlacesOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(PLACE_A);
    });

    // 단언 ① — 실패 갈래가 아니다.
    expect(outcome).toEqual({ kind: 'saved' });

    // 단언 ② — 롤백하지 않았다. (409 도 axios 는 **예외로 던진다** — 순진하게 onError 에서
    // 무조건 되돌리면 여기서 false 가 되어 red 다.)
    // 위 정합 목 덕분에 이 시점에 재조회가 도착했든 아직 안 왔든 답이 같다 —
    // 낙관 삽입분이든 서버가 준 목록이든 A 가 들어 있다. 그래서 이 단언은 오직
    // "되돌렸나"만 잰다.
    expect(result.current.saved.isSaved(POI_A)).toBe(true);

    // 단언 ③ — 서버 진실로 맞춘다. 낙관 삽입 항목의 savedPlaceId 는 임시 표식이라, 갈아치우지
    // 않으면 그 카드는 영영 해제할 수 없다(01b Seed Q6).
    await waitFor(() => expect(hitCount('GET /api/v1/saved-places')).toBe(2));
  });
});

describe('AC-7 · INV-4 — 실패는 되돌리고 사유를 올린다 (I-4)', () => {
  /**
   * ⚠️ **실패 경로에서는 무효화하지 않는다**는 것이 이 describe 세 케이스의 공통 장치다.
   * 실패 후 무효화하면 재요청이 **서버 진실**로 캐시를 덮어써서, `isSaved` 가 원복된 것이
   * 롤백 때문인지 재요청 때문인지 **원리적으로 구별할 수 없다** — 롤백을 아예 안 하는 구현도
   * 통과한다. 그래서 각 케이스의 마지막 단언이 "담은 목록 재요청이 0건"이다.
   */
  it('담기 404 — 낙관 삽입을 되돌리고 not-found 를 올린다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-places`, () =>
        HttpResponse.json({}, { status: 404 })
      )
    );
    const { result } = await renderProbeReady();

    let outcome!: SavedPlacesOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(PLACE_A);
    });

    // 단언 ① — 사유가 호출자에게 도달한다. 조용히 삼키면 위반이다(INV-4).
    // 404 의 두 갈래(담기: POI 없음/비-ACTIVE · 해제: 없음/타 계정)는 나누지 않는다 —
    // **계약이 갈라 주지 않는다**(사유 코드 없는 맨 404). 클라가 갈라 부르면 발명이다(01b Q3).
    expect(outcome).toEqual({ kind: 'failed', reason: 'not-found' });

    // 단언 ② — 호출 전 상태로 되돌아갔다.
    expect(result.current.saved.isSaved(POI_A)).toBe(false);

    // 단언 ③ (부정 짝) — 위 헤더의 장치.
    expect(hitCount('GET /api/v1/saved-places')).toBe(1);
  });

  it('해제 404 — 낙관 제거를 되돌리고 not-found 를 올린다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.delete(`${BASE}/saved-places/:savedPlaceId`, () =>
        HttpResponse.json({}, { status: 404 })
      )
    );
    const { result } = await renderProbeReady();

    let outcome!: SavedPlacesOutcome;
    await act(async () => {
      outcome = await result.current.saved.remove(POI_B);
    });

    expect(outcome).toEqual({ kind: 'failed', reason: 'not-found' });
    // 되돌아왔다 = 다시 담김으로 보인다.
    expect(result.current.saved.isSaved(POI_B)).toBe(true);
    expect(hitCount('GET /api/v1/saved-places')).toBe(1);
  });

  it('네트워크 오류 — 응답 자체가 없어도 되돌리고 network 를 올린다', async () => {
    // `HttpResponse.error()` = 응답이 아예 오지 않는 실패. axios 에러에 `response` 가 없다
    // (`normalizeSocialError` 가 같은 조건으로 NETWORK_ERROR 를 가르는 선례).
    setAccessToken('valid-access');
    server.use(http.post(`${BASE}/saved-places`, () => HttpResponse.error()));
    const { result } = await renderProbeReady();

    let outcome!: SavedPlacesOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(PLACE_A);
    });

    expect(outcome).toEqual({ kind: 'failed', reason: 'network' });
    expect(result.current.saved.isSaved(POI_A)).toBe(false);
    expect(hitCount('GET /api/v1/saved-places')).toBe(1);
  });
});

describe('AC-8 · BR-U1-03 — 미로그인이면 요청을 보내지 않는다 (I-5)', () => {
  it('담기·해제 둘 다 네트워크 요청 0건이고 unauthenticated 사유가 돌아온다', async () => {
    // 준비 — 토큰을 넣지 않고, 훅에 `isAuthed: false` 를 **주입**한다. 판정을 훅 안에서
    // 하지 않는 이유(01b Q1): `hasStoredToken()` 이 비동기라 훅이 직접 부르면 "판정을
    // 기다리는 중"이라는 제3의 상태가 새로 생기는데, 그 상태는 이 칸의 AC 어디에도 없다.
    // 같은 슬라이스의 `resolveNearby`(의존을 전부 인자로 받는 순수 함수)와 같은 선택이다.
    const { result } = await renderProbeReady(false);

    // 실행 — 담기·해제를 둘 다 눌러 본다.
    let saveOutcome!: SavedPlacesOutcome;
    let removeOutcome!: SavedPlacesOutcome;
    await act(async () => {
      saveOutcome = await result.current.saved.save(PLACE_A);
      removeOutcome = await result.current.saved.remove(POI_B);
    });

    // 단언 ① (긍정 짝) — 훅이 실제로 돌았고 사유를 돌려줬다. 이게 없으면 "아무것도 안 하는"
    // 구현과 구별되지 않아 아래 0건이 공허해진다.
    expect(saveOutcome).toEqual({
      kind: 'failed',
      reason: 'unauthenticated',
    });
    expect(removeOutcome).toEqual({
      kind: 'failed',
      reason: 'unauthenticated',
    });

    // 단언 ② — 요청이 한 건도 나가지 않았다. 서버가 401 로 막아 주는 것으로는 부족하다 —
    // BR-U1-03 은 **보내지 않는 것**을 요구한다.
    expect(hitCount('POST /api/v1/saved-places')).toBe(0);
    expect(hitCount(`DELETE /api/v1/saved-places/${SAVED_ID_B}`)).toBe(0);
  });

  it('담은 목록 조회(GET)도 나가지 않는다', async () => {
    // 준비 — 여기서는 `useProbe` 를 쓰지 않는다. probe 는 `useGetSavedPlaces()` 를 **따로**
    // 부르므로, 훅이 그 요청을 보내든 안 보내든 쿼리 키가 같아 히트수가 1로 합쳐진다.
    // 그러면 아래 단언이 어느 쪽이든 통과해 **아무것도 잡지 못한다.**
    // 대신 쿼리 키가 다른 장소 목록만 함께 띄운다 — 시간 기준점 용도다.
    const guest = renderHook(
      () => ({
        places: useGetPlaces(),
        saved: useSavedPlaces({ isAuthed: false }),
      }),
      { wrapper: createWrapper() }
    );

    // 두 쿼리는 같은 마운트에서 함께 발사된다. 장소 목록이 왕복을 **끝냈다**면 담은 목록
    // 요청도 이미 나갔어야 한다 — 그래서 아래 0건이 "아직 안 나갔다"가 아니라 "안 나간다"다.
    await waitFor(() =>
      expect(guest.result.current.places.isSuccess).toBe(true)
    );

    // 단언 ① — 게스트에게는 담은 목록 조회가 한 건도 나가지 않는다. BR-U1-03 이 막는 것은
    // 담기·해제만이 아니라 **요청 자체**다. 나가면 401 → 토큰 리프레시 → 세션 만료 처리까지
    // 헛돌고, 프로덕션 QueryClient 는 retry 기본값이 살아 있어 그 왕복이 배수가 된다.
    expect(hitCount('GET /api/v1/saved-places')).toBe(0);

    // 단언 ② (긍정 짝 · 대조군) — 같은 훅을 `isAuthed: true` 로 띄우면 같은 조회가 **실제로
    // 나간다.** 이 짝이 없으면 담은 목록을 아예 안 읽는(= 담김 여부를 알 수 없는) 구현도
    // 위 0건을 공허하게 통과한다.
    const member = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(hitCount('GET /api/v1/saved-places')).toBe(1));

    guest.unmount();
    member.unmount();
  });
});

describe('Q2 · 담은 목록이 아직 안 왔으면 해제를 보내지 않는다 (I-6)', () => {
  it('목록 로딩 중 해제는 요청 0건 + saved-id-unknown 이다', async () => {
    // 준비 — 담은 목록을 문 뒤에 세운다. 해제에 필요한 savedPlaceId 는 이 응답에만 있으므로
    // 역인덱스가 비어 있고, **보낼 값 자체가 없다.** 기다렸다 실행(대기열·취소 처리가 새로
    // 생긴다)도, 조용히 무시(INV-4 위반)도 아닌 세 번째 선택지다(01b Q2).
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.get(`${BASE}/saved-places`, async () => {
        await gate.opened;
        return HttpResponse.json([SAVED_B]);
      }),
      http.delete(`${BASE}/saved-places/:savedPlaceId`, () => {
        return new HttpResponse(null, { status: 204 });
      })
    );
    const { result } = renderHook(() => useProbe(true), {
      wrapper: createWrapper(),
    });
    // 목록은 기다리지 않는다(그게 이 케이스의 조건이다). 장소 목록이 도착한 것으로 마운트를
    // 확인한다.
    await waitFor(() => expect(result.current.places.isSuccess).toBe(true));

    // 앵커 — 담은 목록 요청은 나갔고 **아직 응답 전**이다.
    expect(hitCount('GET /api/v1/saved-places')).toBe(1);
    expect(result.current.savedList.isSuccess).toBe(false);

    // 실행
    let outcome!: SavedPlacesOutcome;
    await act(async () => {
      outcome = await result.current.saved.remove(POI_B);
    });

    // 단언 ① — 아무 일도 안 일어난 이유가 호출자에게 도달한다.
    expect(outcome).toEqual({ kind: 'failed', reason: 'saved-id-unknown' });

    // 단언 ② — 추측한 id로 요청을 지어 보내지 않았다.
    expect(hitCount(`DELETE /api/v1/saved-places/${SAVED_ID_B}`)).toBe(0);
    expect(hitCount(`DELETE /api/v1/saved-places/${POI_B}`)).toBe(0);

    // 정리 — 문을 열어 매달린 요청을 끝낸다(핸들러가 영영 응답하지 않으면 열린 핸들이 남는다).
    gate.release();
    await act(async () => {
      await waitFor(() =>
        expect(result.current.savedList.isSuccess).toBe(true)
      );
    });
  });
});
