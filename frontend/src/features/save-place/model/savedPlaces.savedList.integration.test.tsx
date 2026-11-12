import { http, HttpResponse } from 'msw';
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/index.schemas';

import { useSavedPlaces } from './savedPlaces';
import { BASE } from '@/test-support/apiBase';
import { createGate, createWrapper } from '@/test-support/mswHookHarness';
import {
  createWrapper as createClientWrapper,
  newTestQueryClient,
} from '@/test-support/queryRender';
import { getGetSavedPlacesQueryKey } from '@/shared/api/index.places';

/**
 * 01b Seed Q1 — `useSavedPlaces` 가 **담은 목록 원본과 조회 상태**를 함께 준다.
 *
 * 왜 훅을 넓히나: d02 는 `savedPlaceId`·`savedAt`·`place` 셋 다 필요한데 기존 반환은
 * `savedPoiIds`(문자열 배열)뿐이라 전부 버렸다. 페이지가 `useGetSavedPlaces` 를 따로 부르면
 * `enabled: isAuthed` 가드를 두 곳에 복제하게 되고 **그게 정확히 TRIP-220 W-3 이 났던 자리**다.
 * 서버 상태의 소유자를 이 훅 하나로 유지한다(`frontend/README.md` §66).
 *
 * 무엇을 보장하나:
 *  - **H-1** 로그인 상태에서 `savedPlaces` 가 서버 응답 **원본 그대로** 나온다(정렬은 순수
 *    함수 `orderSavedPlaces` 몫 — 훅이 미리 가공하면 판정이 두 곳으로 갈린다).
 *  - **H-2 (BR-U1-03)** 미로그인이면 요청 0건에 `savedPlaces` 가 `[]` 다.
 *  - **H-2 ★** 그런데 미로그인에서도 `isPending` 은 **true** 다 — 이 사실이 d02 페이지가
 *    게스트 분기를 상태 판정보다 **먼저** 두어야 하는 이유다.
 *  - **회귀 짝** 기존 `savedPoiIds` 가 그대로 나온다 — d04(TRIP-221·222)가 그 값에 매달려 있다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 반환 계약과 미로그인 가드는 훅이 사는 한 유효하다. **B 없음.**
 */

// authedClient(생성 클라이언트가 타는 인증 계층)가 @/shared/storage 를 정적으로 물고 있다.
// expo-secure-store 실물 로드를 피하려면 리포 관례대로 목킹해야 한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 2,
    dataStatus: 'ACTIVE',
  };
}

const ROWS: SavedPlace[] = [
  {
    savedPlaceId: 'sp-1',
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace('p1', '감천문화마을'),
  },
  {
    savedPlaceId: 'sp-2',
    savedAt: '2026-08-01T11:00:00.000Z',
    place: makePlace('p2', '광안리 해변'),
  },
];

let observed: { method: string; url: string }[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  clearAccessToken();
  server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(ROWS)));
});

afterEach(() => server.resetHandlers());
// onlineManager 는 모듈 싱글턴 — 오프라인 케이스(L6)가 어떻게 끝나든 다음 케이스는 온라인으로 시작한다(파일 최상위).
afterEach(() => onlineManager.setOnline(true));
afterAll(() => server.close());

describe('H-1 · 담은 목록 원본을 준다 (01b Seed Q1)', () => {
  it('서버 응답을 가공하지 않고 그대로 내고, savedPoiIds 도 그대로 낸다', async () => {
    setAccessToken('valid-access');

    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.savedPlaces).toHaveLength(2));

    // 원본 그대로 — 정렬을 훅이 미리 해 버리면 "무엇이 참인 순서인가"가 두 곳에 생긴다.
    expect(result.current.savedPlaces).toEqual(ROWS);
    // 회귀 짝 — d04 가 매달린 반환값이 그대로 살아 있다(추가지 교체가 아니다).
    expect(result.current.savedPoiIds).toEqual(['p1', 'p2']);
    expect(result.current.isError).toBe(false);
  });
});

describe('H-2 · 미로그인이면 아무것도 보내지 않는다 (BR-U1-03)', () => {
  it('빈 목록을 주고 요청은 0건이며, isPending 은 true 로 남는다', async () => {
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: false }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.savedPlaces).toEqual([]));
    expect(result.current.savedPoiIds).toEqual([]);
    expect(
      observed.filter(
        (hit) => new URL(hit.url).pathname === '/api/v1/saved-places'
      )
    ).toEqual([]);

    // ★ 함정을 계약으로 못박는다 — `enabled: false` 인 쿼리는 "아직 안 받았다"는 뜻의
    // `isPending: true` 로 **영원히** 남는다(fetchStatus 는 idle). 이 값을 그대로
    // `resolvePlaceListState` 에 태우면 게스트가 끝나지 않는 스켈레톤을 본다.
    expect(result.current.isPending).toBe(true);
    // TRIP-1754 — 게스트는 "조회 실패"가 아니다(요청을 안 보낸 것). 표식이 켜지면 게스트에게 거짓 토스트가 뜬다.
    expect(result.current.loadFailed).toBe(false);
  });
});

/**
 * TRIP-1754 · 저장 목록 조회가 **실패했는데 "안 담김"처럼 보이는** 문제 — 훅이 "모름" 표식을 더한다(기존 필드는 그대로).
 *
 * 무엇을 보장하나(3동작 = 준비 → 실행 → 단언):
 *  - **L1** 로그인 · `GET` 500 → `loadFailed`·`loadFailureConfirmed` 둘 다 true. `savedPoiIds`·`savedPlaces` `[]`·`isError` true 는 그대로.
 *  - **L2** 성공이면 둘 다 false, 실패 뒤 재조회가 성공하면 다시 false.
 *  - **L3** 게스트는 실패가 아니다. **L4** 로그인 중 실패한 캐시가 남은 채 로그아웃해도 false.
 *  - **L5** 실패 캐시 위에 다시 마운트해 **재조회가 진행 중**이면 `loadFailed` 는 유지(v5 가 그때 `isError` 를 끄므로),
 *    `loadFailureConfirmed` 는 그 재조회가 끝나 실패로 굳기 전엔 false → 실패로 굳으면 true, 성공하면 둘 다 false.
 *  - **L6** 오프라인 콜드스타트(요청이 나가지도 못함)도 실패다(true·true). **L7** 받은 목록이 있으면 재조회 실패에도 false(Seed Q5 ⓐ).
 *
 * *(개념 — isFetchedAfterMount)* TanStack 이 "이 구독자가 마운트된 뒤에 응답(성공·실패)이 한 번이라도 왔나"를 기억하는 값.
 * 마운트 때 이미 실패 캐시를 만났다면 그 옛 실패는 세지 않는다 → 옛 실패만 보고 토스트를 쏘지 않게 해 주는 신호다.
 */
describe('TRIP-1754 · 저장 목록 조회 실패 표식 (loadFailed)', () => {
  type Reply = 'ok' | 500 | 'hold' | 'hold500';
  let replies: Reply[] = [];
  let gate = createGate();

  function listGets(): number {
    return observed.filter(
      (hit) =>
        hit.method === 'GET' &&
        new URL(hit.url).pathname === '/api/v1/saved-places'
    ).length;
  }

  beforeEach(() => {
    replies = [];
    gate = createGate();
    setAccessToken('valid-access');
    // 파일 최상위 beforeEach 의 평소 응답(ROWS) 위에 응답 큐를 얹는다(server.use 는 앞에 끼운다).
    server.use(
      http.get(`${BASE}/saved-places`, async () => {
        const reply = replies.shift() ?? 'ok';
        if (reply === 'hold' || reply === 'hold500') await gate.opened;
        if (reply === 500 || reply === 'hold500') {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        return HttpResponse.json(ROWS);
      })
    );
  });

  // 실패해 중간에 죽은 케이스가 보류 요청을 남기지 않게.
  afterEach(() => gate.release());

  async function pause(ms = 30): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  it('L1 로그인 · 500 이면 둘 다 true, 기존 필드는 그대로다', async () => {
    // 준비
    replies = [500];

    // 실행
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(newTestQueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // 단언
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loadFailureConfirmed).toBe(true);
    expect(result.current.savedPoiIds).toEqual([]);
    expect(result.current.savedPlaces).toEqual([]);
  });

  it('L2 성공이면 둘 다 false, 실패 뒤 재조회가 성공하면 다시 false 다', async () => {
    // 준비 — 성공 한 번.
    const ok = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(newTestQueryClient()),
    });
    await waitFor(() => expect(ok.result.current.savedPlaces).toHaveLength(2));
    expect(ok.result.current.loadFailed).toBe(false);
    expect(ok.result.current.loadFailureConfirmed).toBe(false);
    ok.unmount();

    // 준비 — 이번엔 첫 응답만 실패.
    replies = [500];
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(newTestQueryClient()),
    });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    // 실행
    await act(async () => {
      await result.current.refetch();
    });

    // 단언
    await waitFor(() => expect(result.current.savedPlaces).toHaveLength(2));
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadFailureConfirmed).toBe(false);
  });

  it('L3 게스트는 실패가 아니다 — 둘 다 false · isError false · 요청 0건', async () => {
    // 실행
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: false }), {
      wrapper: createClientWrapper(newTestQueryClient()),
    });
    await pause();

    // 단언
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadFailureConfirmed).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(listGets()).toBe(0);
  });

  it('L4 로그인 중 실패한 캐시가 남은 채 isAuthed 가 false 가 되면 둘 다 false 다', async () => {
    // 준비 — 로그인으로 실패 캐시를 만든다.
    replies = [500];
    const client = newTestQueryClient();
    const { result, rerender } = renderHook(
      ({ authed }: { authed: boolean }) => useSavedPlaces({ isAuthed: authed }),
      { wrapper: createClientWrapper(client), initialProps: { authed: true } }
    );
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    // 실행 — 세션 만료(같은 캐시, 이제 게스트).
    rerender({ authed: false });

    // 단언 — 앵커: 캐시에 실패가 정말 남아 있다(isError true). 그래도 게스트에겐 표식이 없다.
    expect(result.current.isError).toBe(true);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadFailureConfirmed).toBe(false);
  });

  it('L5 실패 캐시 위 재조회가 진행 중이면 loadFailed 는 유지되고 confirmed 는 아직 false, 실패로 굳으면 true', async () => {
    // 준비 — 첫 마운트에서 실패하고 닫는다. 캐시(gcTime 무한)에 실패 이력이 남는다. 두 번째 응답은 문 뒤.
    replies = [500, 'hold500'];
    const client = newTestQueryClient();
    const first = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(client),
    });
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    first.unmount();

    // 실행 — 다시 마운트(재조회가 시작되고 문 앞에서 멈춘다).
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(client),
    });
    await waitFor(() => expect(listGets()).toBe(2));
    await pause();

    // 단언 ① — 보류 중: v5 가 isError 를 껐지만(앵커) loadFailed 는 유지, confirmed 는 아직 아니다.
    expect(result.current.isError).toBe(false);
    expect(result.current.isPending).toBe(true);
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loadFailureConfirmed).toBe(false);

    // 실행 ② — 문을 열면 두 번째도 500.
    gate.release();

    // 단언 ②
    await waitFor(() => expect(result.current.loadFailureConfirmed).toBe(true));
    expect(result.current.loadFailed).toBe(true);
  });

  it('L5b 재조회가 성공으로 끝나면 둘 다 false 로 끝난다(보류 중 confirmed 가 켜진 적도 없다)', async () => {
    // 준비
    replies = [500, 'hold'];
    const client = newTestQueryClient();
    const first = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(client),
    });
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    first.unmount();
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(client),
    });
    await waitFor(() => expect(listGets()).toBe(2));
    await pause();
    expect(result.current.loadFailureConfirmed).toBe(false);

    // 실행
    gate.release();

    // 단언
    await waitFor(() => expect(result.current.savedPlaces).toHaveLength(2));
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadFailureConfirmed).toBe(false);
  });

  it('L6 오프라인 콜드스타트(요청이 나가지도 못함)도 실패다 — true·true, 요청 0건', async () => {
    // 준비 — 앞 케이스의 오프라인이 새지 않았다는 앵커.
    expect(onlineManager.isOnline()).toBe(true);
    onlineManager.setOnline(false);

    // 실행
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(newTestQueryClient()),
    });
    await pause();

    // 단언 — isError 도 errorUpdateCount 도 없는 보류 상태(pending·paused)라 이 판독만이 잡는다.
    expect(result.current.isError).toBe(false);
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loadFailureConfirmed).toBe(true);
    expect(listGets()).toBe(0);
  });

  it('L7 목록을 받은 뒤 재조회가 실패해도(데이터가 남아 있으니) loadFailed 는 false 다 (Seed Q5 ⓐ)', async () => {
    // 준비 — 첫 응답 성공, 두 번째 500.
    replies = ['ok', 500];
    const client = newTestQueryClient();
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createClientWrapper(client),
    });
    await waitFor(() => expect(result.current.savedPlaces).toHaveLength(2));

    // 실행 — 무효화로 다시 받는데 서버가 500.
    await act(async () => {
      await client.invalidateQueries({ queryKey: getGetSavedPlacesQueryKey() });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // 단언 — 진짜 목록이 그대로이니 "모름"이 아니다.
    expect(result.current.savedPoiIds).toEqual(['p1', 'p2']);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadFailureConfirmed).toBe(false);
  });
});
