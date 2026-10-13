import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useGetTrips } from '@/shared/api/index.hooks';
import { useGetSavedStays } from '@/shared/api/index.hooks';
import type { SavedStay, StayItem } from '@/shared/api/index.schemas';
import { flushNotifications } from '@/test-support/flushNotifications';

import { optimisticSavedStayId } from './savedStayIndex';
import { useSavedStays, type SavedStaysOutcome } from './savedStays';

/**
 * TRIP-417 AC-1·AC-2·AC-4·AC-5·AC-6·AC-7 — 숙소 저장 하트 토글 훅의 서버 상태.
 * explore d04 `savedPlaces.integration.test.tsx`의 stay 판(인프라·장치 그대로, 도메인만 바꿈).
 *
 * 무엇을 보장하나:
 *  - **I1 (AC-1·AC-6)** 담기를 누르면 **서버가 답하기 전에** 담김으로 보이고, 성공 후 **담은 목록만**
 *    다시 받아온다(GET /stays 파생 무효화 없음 — Q5).
 *  - **I2 (AC-2)** 해제는 externalId가 아니라 **savedStayId**로 나간다.
 *  - **I3 (AC-5)** 409(이미 담음)는 실패가 아니라 담김으로 수렴한다.
 *  - **I4 (AC-4·INV-4)** 404·네트워크 실패는 낙관 반영을 되돌리고 **사유를 호출자에게 준다.**
 *  - **I5 (AC-7·BR-U1-03)** 미로그인이면 담기·해제 요청을 아예 보내지 않는다.
 *  - **I6 (AC-7)** 담은 목록 조회(GET)까지 게스트에겐 0건이다.
 *  - **I7** 담은 목록이 아직 안 왔으면 해제 요청을 보내지 않고 사유를 올린다.
 *  - **I8 (TRIP-1041 AC-2)** 이미 담긴 숙소를 다시 담으면 요청도 캐시 변경도 없이 담김으로 답한다(멱등).
 *  - **I9 (TRIP-1041 AC-3)** 첫 담기 응답 전에 한 번 더 담아도 POST 는 1건, 캐시의 그 숙소 행도 1개다.
 *  - **I10 (TRIP-1041 맹점 4)** 그 두 번째 담기는 첫 요청보다 먼저 끝나지 않는다(화면의 잠금이 일찍 풀리지 않게).
 *  - **I11 (TRIP-1041 AC-5)** 캐시에 담김 행이 남은 게스트의 담기는 멱등보다 인증 판정이 먼저다.
 *  - **I12 (TRIP-1041 5-b 경고-1)** 담기가 끝난 뒤(실패) 다시 담으면 요청이 다시 나간다(잠금이 풀린다).
 *  - **I13 (TRIP-1041 5-b 경고-2)** 다른 훅 인스턴스가 넣은 임시(optimistic) 행도 담김으로 쳐서 POST 를 막는다.
 *
 * > *(개념)* **낙관적 업데이트(optimistic update)** — 서버 응답을 기다리지 않고 "성공했다 치고"
 * > 캐시를 먼저 바꾸고, 실패하면 바꾸기 전 값으로 **되돌린다**(롤백). explore가 리포 최초였고 이번이 그 stay 판.
 * >
 * > *(개념)* **쿼리 무효화(invalidate)** — 캐시를 지우는 게 아니라 "이제 못 믿는다, 필요하면 다시
 * > 받아라"는 표시. **화면에 떠 있는(=활성) 쿼리만** 즉시 다시 요청한다 — probe가 두 쿼리를 함께 띄우는 이유.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청"이다(해제가 어느 id를 실었나·재요청 횟수는 msw만 관찰).
 *
 * 화면 읽기 규율(TRIP-884·953): react-query 는 캐시 변경 알림을 스케줄러로 미뤄 보낸다. 이 파일은
 * 그 알림을 일부러 5ms 늦춰(beforeAll) "알림을 안 기다리고 result.current 를 읽는" 단언을 드러낸다.
 * ⚠️ 항상 red 는 아니다 — 기대값이 호출 전 값과 같은 단언(롤백 후 false 등)은 flush 를 빼먹어도
 * 옛 화면을 읽고 통과한다. 그러니 화면을 읽기 전엔 예외 없이 `flushNotifications()` 를 거친다.
 * 요청 도착(hitCount·captured*)은 알림과 무관한 비동기라 `waitFor` 로 기다리고, "0건·아직 1건" 같은
 * 부정 단언은 즉시 단언으로 둔다(waitFor 로 감싸면 첫 시도에 통과해 공허해진다).
 */

// authedClient(mutator의 인증 계층)가 @/shared/storage를 정적으로 물고 있다 — expo-secure-store
// 실물 로드를 피하려면 목킹한다(savedPlaces.integration.test.tsx:49 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';

/** openapi `StayItem.required` 필드를 전부 채운다. */
function makeItem(externalId: string, name: string): StayItem {
  return {
    externalSource: 'NAVER',
    externalId,
    name,
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: [],
    stayType: 'HOTEL',
  };
}

/** 아직 담지 않은 숙소. */
const ITEM_A = makeItem('s1', '해운대 그랜드 호텔');
/** 이미 담은 숙소. */
const ITEM_B = makeItem('s2', '광안리 오션뷰');
const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;
const KEY_B = `${ITEM_B.externalSource}:${ITEM_B.externalId}`;

/** 서버가 이미 갖고 있는 B의 담기 기록 id — 해제가 실어야 할 값이다. */
const SAVED_ID_B = '22222222-2222-2222-2222-222222222222';
/** 서버가 담기 성공 시 새로 발급하는 id. */
const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

/** openapi `SavedStay.required` 6필드 + 외부키를 채운다(픽스처를 상상하지 않는다). */
function makeSaved(item: StayItem, savedStayId: string): SavedStay {
  return {
    savedStayId,
    name: item.name,
    coordConfirmed: false,
    linkedTripIds: [],
    registerRoute: 'MAP_SEARCH',
    externalSource: item.externalSource,
    externalId: item.externalId,
    lat: item.lat,
    lng: item.lng,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

const SAVED_B = makeSaved(ITEM_B, SAVED_ID_B);

/** 테스트가 풀어 줄 때까지 응답하지 않는 문 — "서버 응답 전"을 시간이 아니라 신호로 만든다. */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/** 나간 요청의 `METHOD /경로` 누적 — 재요청 횟수·어느 id로 나갔는지를 센다. */
let observedHits: string[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

beforeAll(() => {
  notifyManager.setScheduler((cb) => setTimeout(cb, 5));
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  clearAccessToken();
  // handlers.ts에 saved-stays 계열이 없다 — 매 테스트마다 다시 건다(onUnhandledRequest:'error'라
  // 안 걸면 요청이 에러로 죽는다, 그 성질을 그대로 쓴다). GET /trips는 무효화 부정 짝 모집단이다.
  server.use(
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([SAVED_B])),
    http.get(`${BASE}/trips`, () => HttpResponse.json([]))
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  notifyManager.setScheduler(defaultScheduler);
  server.close();
});

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime:0 — 기본값 타이머가 종료 후에도 살아남아 Node 프로세스를 붙잡는다. mutations도 0
      // (기본 5분, 빼면 이 버킷이 매달린다 — TRIP-203 실측).
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
 * 두 쿼리를 함께 띄운 관찰용 훅.
 * - `savedList` — 무효화 대상. 무효화가 실제 재요청으로 이어지는지 보려면 활성이어야 한다.
 * - `trips` — **무효화 부정 짝**. 없으면 `invalidateQueries()`를 인자 없이 불러 전 캐시를 날리는
 *   구현도 AC-6을 통과한다(savedPlaces I-1 단언⑤와 같은 이유 — Q5: saved-stays만 무효화).
 */
function useProbe(isAuthed: boolean) {
  return {
    savedList: useGetSavedStays(),
    trips: useGetTrips(),
    saved: useSavedStays({ isAuthed }),
  };
}

/** 두 쿼리가 각각 한 번씩 다녀온 상태를 만든다. 이후 증가분이 곧 무효화의 사정거리다. */
async function renderProbeReady(isAuthed = true) {
  const rendered = renderHook(() => useProbe(isAuthed), {
    wrapper: createWrapper(),
  });
  await waitFor(() =>
    expect(rendered.result.current.savedList.isSuccess).toBe(true)
  );
  await waitFor(() =>
    expect(rendered.result.current.trips.isSuccess).toBe(true)
  );

  // 앵커 — 초기 상태가 실제로 "각 1회"다. 담은 목록이 한 번만 나갔다는 것은 훅과 probe가 같은
  // 쿼리 키를 쓴다는 뜻이기도 하다(키를 손으로 다시 적으면 여기서 2가 된다).
  expect(hitCount('GET /api/v1/saved-stays')).toBe(1);
  expect(hitCount('GET /api/v1/trips')).toBe(1);

  return rendered;
}

describe('AC-1 · 담기 — 응답 전 반영 + 담은 목록만 무효화 (I1)', () => {
  it('서버가 답하기 전에 담김으로 보이고, 성공 후 담은 목록만 다시 받아온다', async () => {
    // 준비 — 담기 응답을 문 뒤에 세운다.
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.post(`${BASE}/saved-stays`, async () => {
        await gate.opened;
        return HttpResponse.json(makeSaved(ITEM_A, NEW_SAVED_ID), {
          status: 201,
        });
      })
    );
    const { result } = await renderProbeReady();
    // 앵커 — 시작 상태가 "안 담김"이다.
    expect(result.current.saved.isSaved(KEY_A)).toBe(false);

    // 실행 ① — 담기를 발사만 하고 기다리지 않는다.
    let pending!: Promise<SavedStaysOutcome>;
    await act(async () => {
      pending = result.current.saved.save(ITEM_A);
    });
    await flushNotifications();

    // 단언 ① — 서버가 아직 답하지 않았는데 이미 담김이다(낙관).
    expect(result.current.saved.isSaved(KEY_A)).toBe(true);
    // 단언 ② — 요청은 실제로 나갔고, 이 시점에 무효화는 아직 없다.
    await waitFor(() => expect(hitCount('POST /api/v1/saved-stays')).toBe(1));
    expect(hitCount('GET /api/v1/saved-stays')).toBe(1);

    // 실행 ② — 문을 열어 서버가 답하게 한다.
    gate.release();
    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ③ — 결과가 담김이다.
    expect(outcome).toEqual({ kind: 'saved' });
    // 단언 ④ — 담은 목록이 무효화되어 다시 받아왔다(1 → 2).
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
    // 단언 ⑤ (부정 짝) — 무효화 사정거리는 담은 목록뿐이다(Q5 — GET /trips 여전히 1).
    expect(hitCount('GET /api/v1/trips')).toBe(1);
  });
});

describe('AC-2 · 해제 — externalId가 아니라 savedStayId로 나간다 (I2)', () => {
  it('응답 전에 빈 하트가 되고, 해제 요청이 담기 기록 id를 싣고 나간다', async () => {
    // 준비 — 해제 응답을 문 뒤에 세운다. 경로 패턴은 어떤 세그먼트든 받는다(externalId를 그대로
    // 넣는 구현도 죽지 않고 잡히게).
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.delete(`${BASE}/saved-stays/:savedStayId`, async () => {
        await gate.opened;
        return new HttpResponse(null, { status: 204 });
      })
    );
    const { result } = await renderProbeReady();
    // 앵커 — 시작 상태가 "담김"이다(GET /saved-stays가 SAVED_B를 준다).
    expect(result.current.saved.isSaved(KEY_B)).toBe(true);

    // 실행 ①
    let pending!: Promise<SavedStaysOutcome>;
    await act(async () => {
      pending = result.current.saved.remove(ITEM_B);
    });
    await flushNotifications();

    // 단언 ① — 서버가 답하기 전에 이미 빈 하트다.
    expect(result.current.saved.isSaved(KEY_B)).toBe(false);
    // 단언 ② — 나간 경로가 담기 기록 id다.
    await waitFor(() =>
      expect(hitCount(`DELETE /api/v1/saved-stays/${SAVED_ID_B}`)).toBe(1)
    );
    // 단언 ③ (부정 짝) — externalId(또는 key)를 그대로 경로에 넣지 않았다. 이 짝이 없으면 그런
    // 구현이 404를 받고, 그 실패가 AC-4 롤백에 흡수되어 조용히 남는다.
    expect(hitCount(`DELETE /api/v1/saved-stays/${ITEM_B.externalId}`)).toBe(0);
    expect(hitCount(`DELETE /api/v1/saved-stays/${KEY_B}`)).toBe(0);

    // 실행 ②
    gate.release();
    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ④⑤⑥
    expect(outcome).toEqual({ kind: 'removed' });
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
    expect(hitCount('GET /api/v1/trips')).toBe(1);
  });
});

describe('AC-5 · 409(이미 담음)는 실패가 아니라 담김으로 수렴한다 (I3)', () => {
  it('409를 받아도 실패로 표시하지 않고, 롤백하지 않으며, 담은 목록을 다시 받아온다', async () => {
    // 준비 — 서버가 "이미 담겨 있다"고 답한다. 목표 상태(담김)와 결과 상태(담김)가 같으므로 실패가
    // 아니다(INV-U1-04). ★ 목의 두 응답이 모순되면 안 된다 — 409를 준 서버의 담은 목록엔 A가
    // 들어 있어야 한다. 첫 조회는 A 없이, 무효화 재조회부터는 A를 포함해(다른 기기에서 담은 상황).
    setAccessToken('valid-access');
    const SAVED_A_ON_SERVER = makeSaved(ITEM_A, NEW_SAVED_ID);
    let savedListReads = 0;
    server.use(
      http.get(`${BASE}/saved-stays`, () => {
        savedListReads += 1;
        return HttpResponse.json(
          savedListReads === 1 ? [SAVED_B] : [SAVED_B, SAVED_A_ON_SERVER]
        );
      }),
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json({}, { status: 409 })
      )
    );
    const { result } = await renderProbeReady();
    expect(result.current.saved.isSaved(KEY_A)).toBe(false);

    // 실행
    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(ITEM_A);
    });
    await flushNotifications();

    // 단언 ① — 실패 갈래가 아니다.
    expect(outcome).toEqual({ kind: 'saved' });
    // 단언 ② — 롤백하지 않았다(409도 axios는 예외로 던진다 — onError에서 무조건 되돌리면 여기서
    // false가 되어 red). 위 정합 목 덕분에 이 단언은 오직 "되돌렸나"만 잰다.
    expect(result.current.saved.isSaved(KEY_A)).toBe(true);
    // 단언 ③ — 서버 진실로 맞춘다. 낙관 삽입 항목의 savedStayId는 임시 표식이라, 갈아치우지
    // 않으면 그 카드는 영영 해제할 수 없다(Q6).
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
  });
});

describe('AC-4 · INV-4 — 실패는 되돌리고 사유를 올린다 (I4)', () => {
  /**
   * ⚠️ **실패 경로에서는 무효화하지 않는다**가 세 케이스 공통 장치다. 실패 후 무효화하면 재요청이
   * 서버 진실로 캐시를 덮어써, `isSaved` 원복이 롤백 때문인지 재요청 때문인지 원리적으로 구별할 수
   * 없다 — 롤백을 아예 안 하는 구현도 통과한다. 그래서 각 케이스 마지막이 "담은 목록 재요청 0건"이다.
   */
  it('담기 404 — 낙관 삽입을 되돌리고 not-found를 올린다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json({}, { status: 404 })
      )
    );
    const { result } = await renderProbeReady();

    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(ITEM_A);
    });
    await flushNotifications();

    // 단언 ① — 사유가 호출자에게 도달한다(조용히 삼키면 INV-4 위반).
    expect(outcome).toEqual({ kind: 'failed', reason: 'not-found' });
    // 단언 ② — 호출 전 상태로 되돌아갔다.
    expect(result.current.saved.isSaved(KEY_A)).toBe(false);
    // 단언 ③ (부정 짝) — 위 헤더의 장치.
    expect(hitCount('GET /api/v1/saved-stays')).toBe(1);
  });

  it('해제 404 — 낙관 제거를 되돌리고 not-found를 올린다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.delete(`${BASE}/saved-stays/:savedStayId`, () =>
        HttpResponse.json({}, { status: 404 })
      )
    );
    const { result } = await renderProbeReady();

    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await result.current.saved.remove(ITEM_B);
    });
    await flushNotifications();

    expect(outcome).toEqual({ kind: 'failed', reason: 'not-found' });
    // 되돌아왔다 = 다시 담김으로 보인다.
    expect(result.current.saved.isSaved(KEY_B)).toBe(true);
    expect(hitCount('GET /api/v1/saved-stays')).toBe(1);
  });

  it('네트워크 오류 — 응답 자체가 없어도 되돌리고 network를 올린다', async () => {
    // HttpResponse.error() = 응답이 아예 오지 않는 실패(axios 에러에 response가 없다).
    setAccessToken('valid-access');
    server.use(http.post(`${BASE}/saved-stays`, () => HttpResponse.error()));
    const { result } = await renderProbeReady();

    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(ITEM_A);
    });
    await flushNotifications();

    expect(outcome).toEqual({ kind: 'failed', reason: 'network' });
    expect(result.current.saved.isSaved(KEY_A)).toBe(false);
    expect(hitCount('GET /api/v1/saved-stays')).toBe(1);
  });
});

describe('AC-7 · BR-U1-03 — 미로그인이면 요청을 보내지 않는다 (I5)', () => {
  it('담기·해제 둘 다 네트워크 요청 0건이고 unauthenticated 사유가 돌아온다', async () => {
    // 준비 — 토큰 없이 isAuthed:false를 주입한다(판정을 훅 안 비동기로 두면 "판정 대기" 제3 상태가
    // 생기는데 이 칸 AC에 없다 — resolveNearby·savedPlaces와 같은 선택).
    const { result } = await renderProbeReady(false);

    // 실행 — 담기·해제를 둘 다 눌러 본다.
    let saveOutcome!: SavedStaysOutcome;
    let removeOutcome!: SavedStaysOutcome;
    await act(async () => {
      saveOutcome = await result.current.saved.save(ITEM_A);
      removeOutcome = await result.current.saved.remove(ITEM_B);
    });

    // 단언 ① (긍정 짝) — 훅이 실제로 돌았고 사유를 돌려줬다.
    expect(saveOutcome).toEqual({ kind: 'failed', reason: 'unauthenticated' });
    expect(removeOutcome).toEqual({
      kind: 'failed',
      reason: 'unauthenticated',
    });
    // 단언 ② — 요청이 한 건도 나가지 않았다(서버 401로 막는 것으로는 부족 — BR-U1-03은 보내지
    // 않는 것을 요구).
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
    expect(hitCount(`DELETE /api/v1/saved-stays/${SAVED_ID_B}`)).toBe(0);
  });

  it('담은 목록 조회(GET)도 게스트에겐 나가지 않는다 (I6)', async () => {
    // probe의 useGetSavedStays()는 쿼리 키가 같아 히트가 합쳐진다 — 그래서 여기선 안 쓰고, 키가
    // 다른 GET /trips만 시간 기준으로 띄운다.
    const guest = renderHook(
      () => ({
        trips: useGetTrips(),
        saved: useSavedStays({ isAuthed: false }),
      }),
      { wrapper: createWrapper() }
    );

    // trips가 왕복을 끝냈다면 담은 목록 요청도 이미 나갔어야 한다 — 그래서 아래 0건이 "아직 안
    // 나갔다"가 아니라 "안 나간다"다.
    await waitFor(() =>
      expect(guest.result.current.trips.isSuccess).toBe(true)
    );

    // 단언 ① — 게스트에게는 담은 목록 조회가 한 건도 나가지 않는다(enabled:isAuthed).
    expect(hitCount('GET /api/v1/saved-stays')).toBe(0);

    // 단언 ② (긍정 짝·대조군) — 같은 훅을 isAuthed:true로 띄우면 같은 조회가 실제로 나간다.
    const member = renderHook(() => useSavedStays({ isAuthed: true }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(1));

    guest.unmount();
    member.unmount();
  });
});

describe('Q6 · 담은 목록이 아직 안 왔으면 해제를 보내지 않는다 (I7)', () => {
  it('목록 로딩 중 해제는 요청 0건 + saved-id-unknown 이다', async () => {
    // 준비 — 담은 목록을 문 뒤에 세운다. 해제에 필요한 savedStayId는 이 응답에만 있으므로 역인덱스가
    // 비어 있고 보낼 값 자체가 없다(기다렸다 실행도, 조용히 무시(INV-4 위반)도 아닌 세 번째 선택지).
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.get(`${BASE}/saved-stays`, async () => {
        await gate.opened;
        return HttpResponse.json([SAVED_B]);
      }),
      http.delete(`${BASE}/saved-stays/:savedStayId`, () => {
        return new HttpResponse(null, { status: 204 });
      })
    );
    const { result } = renderHook(() => useProbe(true), {
      wrapper: createWrapper(),
    });
    // 목록은 기다리지 않는다(그게 이 케이스의 조건). trips 도착으로 마운트를 확인한다.
    await waitFor(() => expect(result.current.trips.isSuccess).toBe(true));

    // 앵커 — 담은 목록 요청은 나갔고 아직 응답 전이다.
    expect(hitCount('GET /api/v1/saved-stays')).toBe(1);
    expect(result.current.savedList.isSuccess).toBe(false);

    // 실행
    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await result.current.saved.remove(ITEM_B);
    });

    // 단언 ① — 아무 일도 안 일어난 이유가 호출자에게 도달한다.
    expect(outcome).toEqual({ kind: 'failed', reason: 'saved-id-unknown' });
    // 단언 ② — 추측한 id로 요청을 지어 보내지 않았다.
    expect(hitCount(`DELETE /api/v1/saved-stays/${SAVED_ID_B}`)).toBe(0);

    // 정리 — 문을 열어 매달린 요청을 끝낸다.
    gate.release();
    await act(async () => {
      await waitFor(() =>
        expect(result.current.savedList.isSuccess).toBe(true)
      );
    });
  });
});

// ── TRIP-1041 · 담기 멱등(이미 담겼으면 아무것도 안 한다) ─────────────────────────────

/** 캐시(목록)에서 그 숙소의 행이 몇 개인가 — 같은 숙소가 두 줄이면 2. */
function rowsFor(list: SavedStay[] | undefined, item: StayItem): number {
  return (list ?? []).filter(
    (entry) =>
      entry.externalSource === item.externalSource &&
      entry.externalId === item.externalId
  ).length;
}

/** POST /saved-stays 를 문 뒤에 세운다 — 열리면 201(새 id)로 답한다. */
function holdSavePost() {
  const gate = createGate();
  server.use(
    http.post(`${BASE}/saved-stays`, async () => {
      await gate.opened;
      return HttpResponse.json(makeSaved(ITEM_A, NEW_SAVED_ID), {
        status: 201,
      });
    })
  );
  return gate;
}

describe('TRIP-1041 AC-2 · 이미 담긴 숙소 다시 담기 = 아무 일도 없음 (I8)', () => {
  it('요청 0건 · 목록 캐시 그대로(같은 참조) · 결과는 담김', async () => {
    // 준비 — B 는 서버 목록에 이미 있다. POST 가 나가면 성공(201)해 캐시를 바꿀 수 있게 열어 둔다
    // (안 열어 두면 요청이 에러로 죽어 롤백되고, "캐시 그대로"가 롤백 덕에 공허하게 통과한다).
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json(makeSaved(ITEM_B, NEW_SAVED_ID), { status: 201 })
      )
    );
    const { result } = await renderProbeReady();
    // 앵커 — 시작 상태: B 는 담김이고 목록에 1줄이다.
    expect(result.current.saved.isSaved(KEY_B)).toBe(true);
    const before = result.current.savedList.data;
    expect(rowsFor(before, ITEM_B)).toBe(1);

    // 실행
    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(ITEM_B);
    });
    await flushNotifications();

    // 단언 ① — 결과는 담김(실패가 아니다 — 원하던 상태에 이미 있다, INV-4).
    expect(outcome).toEqual({ kind: 'saved' });
    // 단언 ② — 담기 요청이 나가지 않았다.
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
    // 단언 ③ — 캐시를 건드리지 않았다(새 배열로 갈아 끼우지 않았다 → 같은 참조).
    expect(result.current.savedList.data).toBe(before);
    expect(rowsFor(result.current.savedList.data, ITEM_B)).toBe(1);
    // 단언 ④ — 다시 받아오지도 않았다(요청 0건 — "아무것도 안 한다").
    expect(hitCount('GET /api/v1/saved-stays')).toBe(1);
  });
});

describe('TRIP-1041 AC-3 · 응답 전에 한 번 더 담기 = 흡수 (I9)', () => {
  it('await 없이 두 번 불러도 POST 1건 · 캐시의 그 숙소 행 1개 · 두 결과 모두 담김', async () => {
    // 준비 — 첫 담기 응답을 문 뒤에 세운다(= "첫 요청 대기 중").
    setAccessToken('valid-access');
    const gate = holdSavePost();
    const { result } = await renderProbeReady();
    expect(result.current.saved.isSaved(KEY_A)).toBe(false);

    // 실행 ① — 같은 렌더(같은 isSaved 사본)에서 기다리지 않고 두 번 부른다 = 같은 순간 두 탭.
    let first!: Promise<SavedStaysOutcome>;
    let second!: Promise<SavedStaysOutcome>;
    await act(async () => {
      first = result.current.saved.save(ITEM_A);
      second = result.current.saved.save(ITEM_A);
    });
    await waitFor(() =>
      expect(hitCount('POST /api/v1/saved-stays')).toBeGreaterThanOrEqual(1)
    );
    await flushNotifications();

    // 단언 ① — 대기 중 캐시에 A 는 한 줄뿐이다(임시 행이 두 개 쌓이지 않는다).
    expect(rowsFor(result.current.savedList.data, ITEM_A)).toBe(1);

    // 실행 ② — 응답을 풀어 둘 다 끝낸다.
    gate.release();
    let outcomes!: SavedStaysOutcome[];
    await act(async () => {
      outcomes = await Promise.all([first, second]);
    });

    // 단언 ② — 담기 요청은 한 번만 나갔다(두 호출이 모두 끝난 뒤라 "아직 안 나감"이 아니다).
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);
    // 단언 ③ — 두 번째 호출도 실패가 아니라 담김이다.
    expect(outcomes).toEqual([{ kind: 'saved' }, { kind: 'saved' }]);
  });
});

describe('TRIP-1041 맹점 4 · 두 번째 담기는 첫 요청보다 먼저 끝나지 않는다 (I10)', () => {
  /**
   * 왜 필요한가: 화면들은 `await save()` 가 끝나면 대기 표시(pending)를 푼다. 두 번째 호출이 "이미 담김"
   * 이라며 즉시 끝나면 첫 요청이 아직 날아가는 중인데 하트가 다시 눌리게 되고, 그 누름은 임시 행을 보고
   * 해제(remove)로 가서 saved-id-unknown 실패가 된다(탐색 랜딩은 실패 배너까지 띄운다).
   */
  it('첫 요청이 대기 중이면 두 번째 호출도 끝나지 않고, 첫 요청이 끝나면 함께 담김으로 끝난다', async () => {
    // 준비
    setAccessToken('valid-access');
    const gate = holdSavePost();
    const { result } = await renderProbeReady();
    let secondSettled = false;

    // 실행 ① — 같은 순간 두 번 부르고, 두 번째가 언제 끝나는지 표시를 단다.
    let first!: Promise<SavedStaysOutcome>;
    let second!: Promise<SavedStaysOutcome>;
    await act(async () => {
      first = result.current.saved.save(ITEM_A);
      second = result.current.saved.save(ITEM_A);
      void second.then(() => {
        secondSettled = true;
      });
    });
    await waitFor(() =>
      expect(hitCount('POST /api/v1/saved-stays')).toBeGreaterThanOrEqual(1)
    );
    await flushNotifications();

    // 단언 ① — 첫 요청이 문 뒤에 있는 동안 두 번째 호출은 아직 끝나지 않았다.
    expect(secondSettled).toBe(false);

    // 실행 ② — 응답을 푼다.
    gate.release();
    let outcomes!: SavedStaysOutcome[];
    await act(async () => {
      outcomes = await Promise.all([first, second]);
    });

    // 단언 ② — 이제 둘 다 담김으로 끝났고, 담기 요청은 한 번뿐이다(두 번째가 제 요청을 따로 보내서
    // "늦게 끝난" 게 아니다).
    expect(secondSettled).toBe(true);
    expect(outcomes).toEqual([{ kind: 'saved' }, { kind: 'saved' }]);
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);
  });
});

describe('TRIP-1041 AC-5 · 캐시가 남은 게스트 — 인증 판정이 멱등보다 먼저 (I11)', () => {
  it('캐시에 B 담김 행이 있어도 게스트의 B 담기는 요청 0건 + unauthenticated 다', async () => {
    // 준비 — probe 의 목록 조회가 B 를 캐시에 채운다(= 이전 계정이 남긴 캐시). 훅은 게스트로 띄운다.
    const { result } = await renderProbeReady(false);
    // 앵커 — 캐시에는 정말 B 행이 있다(멱등 판정이 "담김"으로 볼 재료가 있다).
    expect(rowsFor(result.current.savedList.data, ITEM_B)).toBe(1);

    // 실행
    let outcome!: SavedStaysOutcome;
    await act(async () => {
      outcome = await result.current.saved.save(ITEM_B);
    });

    // 단언 — 담김(saved)이 새지 않고 로그인 유도 사유가 돌아온다. 요청도 없다.
    expect(outcome).toEqual({ kind: 'failed', reason: 'unauthenticated' });
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});

describe('TRIP-1041 5-b 경고-1 · 끝난 담기는 잠금을 풀어 다시 담을 수 있다 (I12)', () => {
  /**
   * 진행 중 잠금(같은 숙소 담기가 날아가는 동안 두 번째 호출이 그 결과를 기다림)은 요청이 **끝나면**
   * 풀려야 한다. 안 풀리면 다음 담기가 이미 끝난 옛 결과를 그대로 돌려받아 요청이 영영 다시 안 나간다
   * — 실패 뒤 재시도가 옛 실패만 되풀이하는 조용한 무반응(INV-4 성격).
   */
  it('첫 담기가 네트워크 실패로 끝난 뒤 다시 담으면 POST 가 한 번 더 나가고 이번엔 담김이다', async () => {
    // 준비 — 첫 POST 는 응답 없는 실패, 그 뒤 POST 는 201 로 답한다.
    setAccessToken('valid-access');
    let posts = 0;
    server.use(
      http.post(`${BASE}/saved-stays`, () => {
        posts += 1;
        return posts === 1
          ? HttpResponse.error()
          : HttpResponse.json(makeSaved(ITEM_A, NEW_SAVED_ID), {
              status: 201,
            });
      })
    );
    const { result } = await renderProbeReady();

    // 실행 ① — 첫 담기(실패)를 끝까지 기다린다.
    let firstOutcome!: SavedStaysOutcome;
    await act(async () => {
      firstOutcome = await result.current.saved.save(ITEM_A);
    });
    await flushNotifications();
    // 앵커 — 첫 담기는 정말 실패했고 되돌려졌다(캐시 멱등이 흡수할 행이 없다).
    expect(firstOutcome).toEqual({ kind: 'failed', reason: 'network' });
    expect(result.current.saved.isSaved(KEY_A)).toBe(false);
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);

    // 실행 ② — 다시 담는다.
    let secondOutcome!: SavedStaysOutcome;
    await act(async () => {
      secondOutcome = await result.current.saved.save(ITEM_A);
    });

    // 단언 — 요청이 다시 나갔고(옛 결과 재사용 아님), 결과는 새 요청의 담김이다.
    expect(hitCount('POST /api/v1/saved-stays')).toBe(2);
    expect(secondOutcome).toEqual({ kind: 'saved' });
  });
});

describe('TRIP-1041 5-b 경고-2 · 다른 훅 인스턴스의 임시 행도 담김이다 (I13)', () => {
  /**
   * 진행 중 잠금은 훅 인스턴스(화면)마다 따로다. 두 화면이 같은 숙소를 담으면 둘째 화면의 잠금은
   * 비어 있고, 막아 주는 것은 캐시 판정뿐이다 — 이때 캐시엔 첫 화면이 넣은 **임시 행**(`optimistic:`)만
   * 있다. 임시 행을 "모름"으로 치는 판정(`findSavedStayId` — 임시 행에 null)이면 POST 가 두 번 나간다.
   */
  it('첫 인스턴스의 담기가 대기 중일 때 둘째 인스턴스의 담기는 POST 없이 담김이다', async () => {
    // 준비 — 첫 POST 를 문 뒤에 세우고, 같은 QueryClient 안에 훅 인스턴스 두 개를 띄운다.
    setAccessToken('valid-access');
    const gate = holdSavePost();
    const { result } = renderHook(
      () => ({
        savedList: useGetSavedStays(),
        first: useSavedStays({ isAuthed: true }),
        second: useSavedStays({ isAuthed: true }),
      }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.savedList.isSuccess).toBe(true));

    // 실행 ① — 첫 인스턴스가 담기를 보내고 응답을 기다린다.
    let firstPending!: Promise<SavedStaysOutcome>;
    await act(async () => {
      firstPending = result.current.first.save(ITEM_A);
    });
    await waitFor(() =>
      expect(hitCount('POST /api/v1/saved-stays')).toBeGreaterThanOrEqual(1)
    );
    await flushNotifications();
    // 앵커 — 캐시의 A 행은 서버 id 가 아니라 임시 표식 행 하나뿐이다(이 판정 갈래에 정말 닿는다).
    const rowsA = (result.current.savedList.data ?? []).filter(
      (entry) => entry.externalId === ITEM_A.externalId
    );
    expect(rowsA.map((entry) => entry.savedStayId)).toEqual([
      optimisticSavedStayId(KEY_A),
    ]);

    // 실행 ② — 둘째 인스턴스가 같은 숙소를 담는다(기다리지 않는다 — 막히지 않으면 문 뒤에 매달린다).
    let secondPending!: Promise<SavedStaysOutcome>;
    await act(async () => {
      secondPending = result.current.second.save(ITEM_A);
    });
    await flushNotifications();

    // 단언 ① — 둘째 담기는 요청을 만들지 않았다.
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);

    // 실행 ③ — 문을 열어 둘 다 끝낸다.
    gate.release();
    let outcomes!: SavedStaysOutcome[];
    await act(async () => {
      outcomes = await Promise.all([firstPending, secondPending]);
    });

    // 단언 ② — 둘 다 담김이고, 끝난 뒤에도 POST 는 한 번뿐이다.
    expect(outcomes).toEqual([{ kind: 'saved' }, { kind: 'saved' }]);
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);
  });
});
