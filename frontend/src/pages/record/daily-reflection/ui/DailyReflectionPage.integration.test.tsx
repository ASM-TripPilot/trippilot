import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { useDailyReflection } from '../model/useDailyReflection';
import { server } from '@/mocks/server';
import { getGetTripsTripIdReflectionsQueryKey } from '@/shared/api/index.hooks';
import type {
  EditReflectionRequest,
  ErrorResponse,
  Reflection,
  ReflectionCard,
  ReflectionList,
  Trip,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { router } from 'expo-router';

import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * j03 오늘의 회고 — 실제 페이지·훅 + msw(가짜 서버) + 실 QueryClient 로 보는 사용자 흐름. 관점마다 describe 하나:
 *  - 레코드가 없는 날 한 번 만들어 보여주기(생성) — 옛 `DailyReflectionPage.generate.integration.test.tsx`
 *  - 직접 쓴 회고 저장 뒤 같은 화면(저장) — 옛 `DailyReflectionPage.save.integration.test.tsx`
 * 서버 기동·정지는 파일 최상위 한 번, 관점별 가짜 서버 상태(serverItems·응답 스위치)는 각 describe 의 beforeEach 가 다시 세운다.
 * 훅·화면을 목으로 갈아 끼워 배선만 보는 node 테스트는 `DailyReflectionPage.test.tsx`.
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

// TRIP-1584 — 하단 바가 `useTripSummary`(GET /summary)를 읽는다. `onUnhandledRequest:'error'` 라 스텁(조회 중)으로 막는다.
jest.mock('@/features/reflection/model/useTripSummary', () => ({
  useTripSummary: () => ({
    envelope: undefined,
    summary: undefined,
    source: undefined,
    isPending: true,
    isError: false,
    refetch: () => {},
  }),
}));

// 사진 배선(TRIP-1444)은 useReflectionPhotos.test 가 본다 — 여기선 사진 요청이 가짜 서버로 새지 않게 비운다.
jest.mock('../model/useReflectionPhotos', () => ({
  useReflectionPhotos: () => [],
}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
    back: jest.fn(),
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const DAY = '2026-09-24';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => server.close());

// TRIP-1425 — 토스트 스토어는 모듈 싱글턴이라 describe 안이 아니라 파일 최상위에서 비운다(toastHarness).
afterEach(() => resetToast());

describe('생성 — 레코드가 없는 지난 날·오늘은 한 번 만들어 보여준다', () => {
  // TRIP-1068 (옛 DailyReflectionPage.generate.integration.test.tsx)
  /**
   * TRIP-1068 · j03 — 레코드가 없는 지난 날·오늘은 페이지가 한 번 만들어 보여준다(실제 페이지·훅 + msw +
   * 실 QueryClient).
   *
   * 무엇을 보장하나:
   *  - AC-1: 레코드가 없고 날짜가 오늘 이하면 POST 가 정확히 1회 나가고, 응답의 stats 로 얼굴이 바뀐다.
   *  - AC-3: POST 응답이 목록 캐시의 그 날 항목으로 들어간다 — 재조회 없이, 화면을 떠난 뒤 응답이 와도.
   *    목록 캐시가 없으면 무효화해 다시 받는다.
   *  - AC-4: 목록 조회 중·POST 중에는 pending 이고 empty 가 비치지 않는다.
   *  - AC-5: POST 가 실패하면 error + "직접 회고 작성", 빈 문구 없음, 저절로 다시 쏘지 않는다.
   *    '다시 시도'를 누를 때만 한 번 더 쏜다(Seed Q1). 실패 뒤 직접 써서 저장하면 그 글이 보인다 — 생성
   *    실패 표시가 남아 있어도 레코드가 생겼으면 error 로 덮지 않는다(5-b W-1).
   *  - AC-6·7·8: 미래 날짜·다시 연 날·조회 실패는 POST 0회.
   *
   * 왜 통합인가: 요청 횟수·캐시 교체·이탈 뒤 응답은 실제 캐시와 네트워크가 있어야 보인다.
   * 장치(02a ★2·★3·★6): 서버는 POST 로 만든 레코드를 기억하고, 목록 GET·POST 횟수를 센다. 게이트로
   * 응답을 붙잡아 "진행 중"을 관찰하고, afterEach 에서 전부 연다.
   */

  const TRIP_ID = 'trip-1068';

  const PAST_TODAY = '2026-09-26';

  const FUTURE_TODAY = '2026-09-23';

  const POST_PATH = `/api/v1/trips/${TRIP_ID}/reflections/${DAY}`;

  const EMPTY_TEXT = /기록된 활동이 없습니다/;

  const TRIP: Trip = {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: '2026-09-24',
    endDate: '2026-09-25',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };

  const RULE_TEXT = '광안리해수욕장·부산시립미술관 을(를) 다녀왔어요.';

  const RULE_CARD: ReflectionCard = {
    templateId: 'backend.rule.daily.v1',
    format: 'CARD',
    title: '부산 첫날',
    subtitle: RULE_TEXT,
    payload: JSON.stringify({
      template_id: 'backend.rule.daily.v1',
      format: 'CARD',
      cover: { title: '부산 첫날', subtitle: RULE_TEXT },
      scenes: [],
    }),
  };

  /** 서버가 POST 로 만들어 돌려주는 회고 — 방문 2·사진 0 → 얼굴은 data-insufficient("사진 없음"). */
  function generated(dayDate: string): Reflection {
    return {
      dayDate,
      card: RULE_CARD,
      draftCard: RULE_CARD,
      editedCard: null,
      source: 'RULE',
      stats: {
        visitCount: 2,
        distanceKm: 3.4,
        distanceSource: 'VISIT_LINE',
        photoCount: 0,
      },
      generatedAt: '2026-09-26T01:00:00Z',
      updatedAt: '2026-09-26T01:00:00Z',
    };
  }

  type Reply = 200 | 400 | 500 | 'network';

  interface Gate {
    promise: Promise<void>;
    open: () => void;
  }

  function makeGate(): Gate {
    let open = () => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  }

  let serverItems: Reflection[];

  /** 호출 순서대로 꺼내 쓰는 응답(비면 200). */
  let listReplies: Reply[];

  let postReplies: Reply[];

  let listGate: Gate | null;

  let postGate: Gate | null;

  let listCount: number;

  let postPaths: string[];

  let clients: QueryClient[];

  function postCount(): number {
    return postPaths.length;
  }

  function failure(reply: Exclude<Reply, 200>) {
    if (reply === 'network') return HttpResponse.error();
    const error: ErrorResponse = {
      error: {
        code: reply === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
        message: '실패',
      },
    };
    return HttpResponse.json(error, { status: reply });
  }

  beforeEach(() => {
    serverItems = [];
    listReplies = [];
    postReplies = [];
    listGate = null;
    postGate = null;
    listCount = 0;
    postPaths = [];
    clients = [];
    setAccessToken('a');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(TRIP)),
      http.get(`${BASE}/trips/:tripId/reflections`, async () => {
        listCount += 1;
        if (listGate) await listGate.promise;
        const reply = listReplies.shift() ?? 200;
        if (reply !== 200) return failure(reply);
        return HttpResponse.json({ items: serverItems });
      }),
      http.post(
        `${BASE}/trips/:tripId/reflections/:dayDate`,
        async ({ request, params }) => {
          postPaths.push(new URL(request.url).pathname);
          if (postGate) await postGate.promise;
          const reply = postReplies.shift() ?? 200;
          if (reply !== 200) return failure(reply);
          const made = generated(String(params.dayDate));
          serverItems = [
            ...serverItems.filter((item) => item.dayDate !== made.dayDate),
            made,
          ];
          return HttpResponse.json(made);
        }
      )
    );
  });

  afterEach(() => {
    // 붙잡아 둔 응답을 풀어 다음 테스트로 새지 않게 한다(02a ★6).
    listGate?.open();
    postGate?.open();
    clients.forEach((client) => client.clear());
    server.resetHandlers();
    clearAccessToken();
  });

  /**
   * 쿼리 gcTime 은 기본(5분) 그대로 — 이탈 뒤에도 목록 캐시가 남아야 AC-3 을 가를 수 있다(02a ★2).
   * 뮤테이션 gcTime 만 0 — `client.clear()` 는 뮤테이션 gc 타이머를 안 지워 jest 가 끝나지 않는다.
   */
  function newClient(): QueryClient {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false, gcTime: 0 },
      },
    });
    clients.push(client);
    return client;
  }

  function wrapperFor(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  function renderPage(today: string, client: QueryClient = newClient()) {
    const view = render(
      <DailyReflectionPage tripId={TRIP_ID} date={DAY} today={today} />,
      { wrapper: wrapperFor(client) }
    );
    return { client, unmount: view.unmount };
  }

  /** 더 일어날 일이 없을 만큼 시간을 흘린다(자동 재발사·늦은 요청을 잡는 창). */
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  /** 생성 응답이 화면에 반영됐다 = stats 방문 칸에 2 가 보인다. */
  async function waitForGenerated() {
    await waitFor(() =>
      expect(
        within(screen.getByTestId('reflection-daily-stats')).getByText('2')
      ).toBeOnTheScreen()
    );
  }

  function cachedDay(client: QueryClient): Reflection | undefined {
    return client
      .getQueryData<ReflectionList>(
        getGetTripsTripIdReflectionsQueryKey(TRIP_ID)
      )
      ?.items?.find((item) => item.dayDate === DAY);
  }

  describe('AC-1 · 레코드가 없는 지난 날·오늘은 한 번 만들어 보여준다 (US-REC-06 · BR-U5-32 · 결정 1)', () => {
    it.each([
      ['지난 날', PAST_TODAY],
      ['오늘', DAY],
    ])(
      '%s: POST 가 그 날짜로 정확히 1회 나가고, 응답 뒤 empty 없이 방문 2·"사진 없음" 얼굴이 된다',
      async (_label, today) => {
        renderPage(today);

        await waitForGenerated();

        expect(postPaths).toEqual([POST_PATH]);
        expect(
          screen.getByTestId('reflection-daily-photo-empty')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
        expect(screen.queryByTestId('reflection-daily-pending')).toBeNull();
        await settle();
        expect(postCount()).toBe(1);
      }
    );
  });

  describe('AC-3 · POST 응답이 목록 캐시의 그 날 항목이 된다 (TRIP-980 PUT 과 같은 모양)', () => {
    it('재조회 없이 화면이 바뀐다 — 목록 GET 은 1회뿐이고 캐시의 그 날 항목이 POST 응답이다', async () => {
      const { client } = renderPage(PAST_TODAY);

      await waitForGenerated();
      await settle();

      expect(listCount).toBe(1);
      expect(cachedDay(client)).toEqual(generated(DAY));
    });

    it('생성 중에 화면을 떠나도, 뒤늦게 온 응답이 목록 캐시에 들어간다(훅 수준 갱신)', async () => {
      postGate = makeGate();
      const { client, unmount } = renderPage(PAST_TODAY);
      await waitFor(() => expect(postCount()).toBe(1));

      unmount();
      postGate.open();

      await waitFor(() => expect(cachedDay(client)).toEqual(generated(DAY)));
    });

    it('목록 캐시가 없을 때 생성하면 목록을 무효화해 다시 받는다(다른 날짜를 지어내지 않는다)', async () => {
      listReplies = [500];
      const client = newClient();
      const { result } = renderHook(() => useDailyReflection(TRIP_ID, DAY), {
        wrapper: wrapperFor(client),
      });
      await waitFor(() => expect(result.current.isError).toBe(true));

      act(() => {
        result.current.create();
      });

      await waitFor(() => expect(postCount()).toBe(1));
      await waitFor(() => expect(listCount).toBe(2));
      await waitFor(() =>
        expect(result.current.reflection).toEqual(generated(DAY))
      );
    });
  });

  describe('AC-4 · 조회·생성 중에는 pending 이고 empty 가 비치지 않는다 (INV-4)', () => {
    it('① 목록 GET 이 진행 중이면 pending', () => {
      listGate = makeGate();

      renderPage(PAST_TODAY);

      expect(screen.getByTestId('reflection-daily-pending')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    });

    it('② POST 가 진행 중이면 pending', async () => {
      postGate = makeGate();
      renderPage(PAST_TODAY);

      await waitFor(() => expect(postCount()).toBe(1));

      expect(screen.getByTestId('reflection-daily-pending')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      expect(screen.queryByText(EMPTY_TEXT)).toBeNull();

      // TRIP-1068 Q2(옛 hookMock 회고 카드 묶음에서 옮김) — 생성 중에도 헤더 "편집"은 빈 칸 입력을 연다.
      fireEvent.press(screen.getByTestId('reflection-daily-edit'));
      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toHaveDisplayValue('');
    });
  });

  describe('AC-5 · 생성이 실패하면 직접 쓸 수 있게 하고, 저절로 다시 쏘지 않는다 (BR-U5-36 · INV-4)', () => {
    it.each<Reply>([500, 400, 'network'])(
      'POST 가 %s 로 실패하면 error + "직접 회고 작성"이 보이고 빈 문구는 없으며, POST 는 1회에서 멈춘다',
      async (reply) => {
        postReplies = [reply];
        renderPage(PAST_TODAY);

        await screen.findByTestId('reflection-daily-error');
        await settle();

        expect(
          screen.getByTestId('reflection-daily-compose')
        ).toBeOnTheScreen();
        expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
        expect(screen.queryByTestId('reflection-daily-pending')).toBeNull();
        expect(postCount()).toBe(1);
      }
    );

    it('실패 뒤 "다시 시도"를 누를 때만 POST 를 한 번 더 쏘고, 성공하면 그 회고를 보인다 (Seed Q1)', async () => {
      postReplies = [500, 200];
      renderPage(PAST_TODAY);
      await screen.findByTestId('reflection-daily-error');
      await settle();
      // 앵커 — 누르기 전엔 1회뿐(자동 재발사 없음).
      expect(postCount()).toBe(1);

      fireEvent.press(screen.getByTestId('reflection-daily-retry'));

      await waitFor(() => expect(postCount()).toBe(2));
      await waitForGenerated();
      expect(screen.queryByTestId('reflection-daily-error')).toBeNull();
    });

    it('생성 실패 뒤 "직접 회고 작성"으로 써서 저장하면 error 가 걷히고 본문에 쓴 글이 보인다 (BR-U5-36 · 5-b W-1)', async () => {
      // 준비 — POST 는 실패, PUT 은 서버처럼 그 날 레코드(0·0 + 수정본)를 만들어 기억한다.
      postReplies = [500];
      const written = '생성이 실패해도 직접 남긴 하루';
      server.use(
        http.put(
          `${BASE}/trips/:tripId/reflections/:dayDate`,
          async ({ request, params }) => {
            const body = (await request.json()) as EditReflectionRequest;
            const cover = (
              JSON.parse(body.card as string) as { cover: { title: string } }
            ).cover;
            const edited: ReflectionCard = {
              templateId: 'user.edit.v1',
              format: 'CARD',
              title: cover.title,
              subtitle: written,
              payload: body.card as string,
            };
            const saved: Reflection = {
              dayDate: String(params.dayDate),
              card: edited,
              draftCard: edited,
              editedCard: edited,
              source: 'BASIC',
              stats: {
                visitCount: 0,
                distanceKm: 0,
                distanceSource: 'VISIT_LINE',
                photoCount: 0,
              },
              generatedAt: '2026-09-26T01:00:00Z',
              updatedAt: '2026-09-26T01:00:00Z',
            };
            serverItems = [saved];
            return HttpResponse.json(saved);
          }
        )
      );
      renderPage(PAST_TODAY);
      await screen.findByTestId('reflection-daily-error');

      // 실행 — 직접 회고 작성 → 입력 → 저장.
      fireEvent.press(screen.getByTestId('reflection-daily-compose'));
      fireEvent.changeText(
        screen.getByTestId('reflection-daily-edit-input'),
        written
      );
      fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));

      // 단언 — 쓴 글이 본문에 보이고 error 카드는 없다(생성 실패 표시가 남아 있어도 레코드가 이긴다).
      await waitFor(() =>
        expect(
          screen.getByTestId('reflection-daily-narrative')
        ).toHaveTextContent(written)
      );
      expect(screen.queryByTestId('reflection-daily-error')).toBeNull();
      expect(postCount()).toBe(1);
    });
  });

  describe('AC-6 · 미래 날짜는 만들지 않는다 (결정 2)', () => {
    it('목록이 도착한 뒤에도 POST 0회, empty 이고 pending 이 아니다', async () => {
      renderPage(FUTURE_TODAY);
      await waitFor(() => expect(listCount).toBe(1));

      await settle();

      expect(postCount()).toBe(0);
      expect(screen.getByTestId('reflection-daily-empty')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-pending')).toBeNull();
    });
  });

  describe('AC-7 · 다시 열면 만들지 않는다 (결정 2 · 알림 중복 억제)', () => {
    it('생성 뒤 화면을 닫고 같은 날을 다시 열면 곧바로 그 회고가 보이고 POST 는 1회 그대로다', async () => {
      const first = renderPage(PAST_TODAY);
      await waitForGenerated();
      first.unmount();

      renderPage(PAST_TODAY, first.client);

      // 재진입 첫 화면 — 캐시에 레코드가 있으니 pending·empty 를 거치지 않는다.
      expect(screen.queryByTestId('reflection-daily-pending')).toBeNull();
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      await settle();
      expect(postCount()).toBe(1);
    });
  });

  describe('AC-8 · 목록 조회가 실패하면 만들지 않는다', () => {
    it('error 얼굴이고 POST 0회 — "다시 시도"는 목록을 다시 받을 뿐 POST 를 쏘지 않는다', async () => {
      listReplies = [500, 500];
      renderPage(PAST_TODAY);
      await screen.findByTestId('reflection-daily-error');
      await settle();
      expect(postCount()).toBe(0);

      fireEvent.press(screen.getByTestId('reflection-daily-retry'));

      await waitFor(() => expect(listCount).toBe(2));
      await settle();
      expect(postCount()).toBe(0);
    });
  });
});

describe('저장 — 직접 쓴 회고를 저장한 뒤 같은 화면', () => {
  // TRIP-980 (옛 DailyReflectionPage.save.integration.test.tsx)
  /**
   * TRIP-980 · j03 회고 — 직접 쓴 회고를 저장한 뒤 같은 화면이 어떻게 바뀌는가(실제 페이지 + msw + 실 QueryClient).
   *
   * 무엇을 보장하나:
   *  - AC-1: 회고가 없는 날 직접 써서 저장하면 empty 얼굴이 사라지고 본문에 그 글이 보인다.
   *  - AC-2: 저장이 반영된 뒤 편집을 열면 입력칸에 방금 쓴 글이 채워져 있다.
   *  - AC-4: 저장이 실패(500·400·네트워크)하면 "저장하지 못했어요. 다시 시도해 주세요"를 보이고, 편집창과
   *    쓴 글을 그대로 둔다. 취소해도 저장된 척(본문 표시)하지 않는다(INV-4).
   *  - AC-7: 저장 뒤 얼굴에 소요시간 표기가 없다(INV-3).
   *  - 보강(5-b 경고-1·참고-2·3): 이미 회고가 있는 날을 고쳐 저장하면 목록의 그 날짜 항목이 갈아 끼워지고
   *    (중복 없음) 편집은 기존 글로 열린다. 실패 뒤 편집을 다시 열면 실패 문구가 남아 있지 않다.
   *
   * 왜 통합인가: 심판 대상이 "저장 뒤 목록 캐시가 바뀌어 화면이 바뀐다"라서 실제 캐시가 있어야 보인다.
   * 생성 훅을 목으로 바꾼 card.test 로는 원리적으로 못 본다. **.integration.test 명명 필수.**
   *
   * 장치(02a ★1): msw 서버가 상태를 기억한다 — PUT 이 만든 레코드를 서버 목록에 넣고 같은 값을 응답한다.
   * 그래서 캐시를 PUT 응답으로 직접 고치든(setQueryData) 목록을 다시 받든(invalidateQueries) 같은 결과다.
   *
   * TRIP-1068 전제: 레코드가 없는 지난 날은 진입 시 페이지가 POST 로 회고를 만든다. 서버는 방문 0 이어도
   * BASIC 0·0 레코드를 만들어 돌려주므로(BR-U5-32) 첫 화면 empty 는 "그 0·0 레코드"의 얼굴이고, 직접 쓴
   * 글은 그 레코드에 수정본으로 붙는다(stats 는 0·0 그대로). 오늘은 `TODAY` 로 고정해 전제를 시계에서 뗀다.
   */

  const TRIP_ID = 'trip-980';

  /** 여행이 끝난 뒤 — DAY 는 지난 날이라 진입 시 생성(POST) 대상이다. */
  const TODAY = '2026-09-26';

  const PUT_PATH = `/api/v1/trips/${TRIP_ID}/reflections/${DAY}`;

  const WRITTEN = '바다를 보며 천천히 걸은 하루';

  const SAVE_FAILED = '저장하지 못했어요. 다시 시도해 주세요';

  /** 소요시간 표기 탐지기(INV-3) — reflectionStructure G6 · card.test 와 같은 식. */
  const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

  const TRIP: Trip = {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: '2026-09-24',
    endDate: '2026-09-25',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };

  /** 서버가 PUT 때 함께 만드는 BASIC 초안(기록 없는 날) — stats 0 이라 저장 뒤 얼굴은 data-insufficient. */
  const BASIC_DRAFT: ReflectionCard = {
    templateId: 'backend.basic.daily.v1',
    format: 'CARD',
    title: '기록이 없는 하루',
    subtitle: '기록이 없는 하루',
    payload: JSON.stringify({
      template_id: 'backend.basic.daily.v1',
      format: 'CARD',
      cover: { title: '기록이 없는 하루', subtitle: '기록이 없는 하루' },
      scenes: [],
    }),
  };

  /**
   * PUT 바디(카드 원문 문자열)로 서버가 돌려줄 Reflection 을 만든다 — 표시본 card = 수정본.
   * 그 날짜 레코드가 이미 있으면 초안·source·stats 는 그대로 두고 수정본만 바꾼다(BR-U5-35).
   */
  function reflectionFromPut(
    dayDate: string,
    cardText: string,
    prev: Reflection | undefined
  ): Reflection {
    const parsed = JSON.parse(cardText) as {
      cover: { title: string; subtitle: string };
    };
    const edited: ReflectionCard = {
      templateId: 'user.edit.v1',
      format: 'CARD',
      title: parsed.cover.title,
      subtitle: parsed.cover.subtitle,
      payload: cardText,
    };
    if (prev) {
      return {
        ...prev,
        card: edited,
        editedCard: edited,
        updatedAt: '2026-09-26T01:00:00Z',
      };
    }
    return {
      dayDate,
      card: edited,
      draftCard: BASIC_DRAFT,
      editedCard: edited,
      source: 'BASIC',
      stats: {
        visitCount: 0,
        distanceKm: 0,
        distanceSource: 'VISIT_LINE',
        photoCount: 0,
      },
      generatedAt: '2026-09-26T01:00:00Z',
      updatedAt: '2026-09-26T01:00:00Z',
    };
  }

  const EXISTING_TEXT = '해운대에서 조개구이를 먹은 하루';

  const EDITED_TEXT = '바다 냄새가 오래 남은 하루';

  /** 이미 있는 RULE 회고(방문 3·사진 2 → default 얼굴, "수정" 링크가 있다). */
  const RULE_CARD: ReflectionCard = {
    templateId: 'backend.rule.daily.v1',
    format: 'CARD',
    title: '부산 첫날',
    subtitle: EXISTING_TEXT,
    payload: JSON.stringify({
      template_id: 'backend.rule.daily.v1',
      format: 'CARD',
      cover: { title: '부산 첫날', subtitle: EXISTING_TEXT },
      scenes: [],
    }),
  };

  const EXISTING: Reflection = {
    dayDate: DAY,
    card: RULE_CARD,
    draftCard: RULE_CARD,
    source: 'RULE',
    stats: {
      visitCount: 3,
      distanceKm: 4.2,
      distanceSource: 'VISIT_LINE',
      photoCount: 2,
    },
    generatedAt: '2026-09-24T12:00:00Z',
    updatedAt: '2026-09-24T12:00:00Z',
  };

  type PutReply = 200 | 400 | 500 | 'network';

  let serverItems: Reflection[];

  let putReply: PutReply;

  let putBodies: EditReflectionRequest[];

  let putPaths: string[];

  let postCount: number;

  function putCount(): number {
    return putBodies.length;
  }

  beforeEach(() => {
    serverItems = [];
    putReply = 200;
    putBodies = [];
    putPaths = [];
    postCount = 0;
    setAccessToken('a');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(TRIP)),
      // 상태 기억 GET — 매번 지금의 서버 목록을 돌려준다(재조회하면 PUT 결과가 보인다).
      http.get(`${BASE}/trips/:tripId/reflections`, () =>
        HttpResponse.json({ items: serverItems })
      ),
      // 생성 — 방문 0 인 날도 BASIC 0·0 레코드를 만들어 서버 목록에 넣는다(수정본 없음 → empty 얼굴).
      http.post(`${BASE}/trips/:tripId/reflections/:dayDate`, ({ params }) => {
        postCount += 1;
        const made: Reflection = {
          dayDate: String(params.dayDate),
          card: BASIC_DRAFT,
          draftCard: BASIC_DRAFT,
          editedCard: null,
          source: 'BASIC',
          stats: {
            visitCount: 0,
            distanceKm: 0,
            distanceSource: 'VISIT_LINE',
            photoCount: 0,
          },
          generatedAt: '2026-09-26T00:30:00Z',
          updatedAt: '2026-09-26T00:30:00Z',
        };
        serverItems = [
          ...serverItems.filter((item) => item.dayDate !== made.dayDate),
          made,
        ];
        return HttpResponse.json(made);
      }),
      http.put(
        `${BASE}/trips/:tripId/reflections/:dayDate`,
        async ({ request, params }) => {
          const body = (await request.json()) as EditReflectionRequest;
          putBodies.push(body);
          putPaths.push(new URL(request.url).pathname);
          if (putReply === 'network') return HttpResponse.error();
          if (putReply !== 200) {
            const error: ErrorResponse = {
              error: {
                code: putReply === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
                message: '저장 실패',
              },
            };
            return HttpResponse.json(error, { status: putReply });
          }
          const dayDate = String(params.dayDate);
          const saved = reflectionFromPut(
            dayDate,
            body.card as string,
            serverItems.find((item) => item.dayDate === dayDate)
          );
          serverItems = [
            ...serverItems.filter((item) => item.dayDate !== saved.dayDate),
            saved,
          ];
          return HttpResponse.json(saved);
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
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
    render(<DailyReflectionPage tripId={TRIP_ID} date={DAY} today={TODAY} />, {
      wrapper: Wrapper,
    });
    return client;
  }

  /** 첫 화면(생성된 0·0 레코드의 empty) 을 기다렸다가 "직접 회고 작성" → 글 입력 → 저장. */
  async function composeAndSave(text: string) {
    await screen.findByTestId('reflection-daily-empty');
    fireEvent.press(screen.getByTestId('reflection-daily-compose'));
    fireEvent.changeText(
      screen.getByTestId('reflection-daily-edit-input'),
      text
    );
    fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));
  }

  /** 저장이 화면에 반영됐다 = 본문에 그 글이 보인다(편집이 닫혀야 본문이 그려진다). */
  async function waitForNarrative(text: string) {
    await waitFor(() =>
      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toHaveTextContent(text)
    );
  }

  describe('AC-1 · 저장하면 같은 화면에서 쓴 글이 보인다 (BR-U5-35·36 · INV-4)', () => {
    it('회고가 없는 날 직접 써서 저장하면 empty 얼굴이 사라지고 본문에 그 글이 보인다', async () => {
      renderPage();

      await composeAndSave(WRITTEN);

      // 앵커 — 진입 생성(POST)은 한 번, PUT 이 이 날짜로 한 번 나갔고, 쓴 글이 cover.subtitle 로 실렸다.
      expect(postCount).toBe(1);
      await waitFor(() => expect(putCount()).toBe(1));
      expect(putPaths).toEqual([PUT_PATH]);
      expect(JSON.parse(putBodies[0].card as string).cover.subtitle).toBe(
        WRITTEN
      );
      await waitForNarrative(WRITTEN);
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    });
  });

  /**
   * TRIP-945 AC-1·3·4·6(옛 DailyReflectionPage.hookMock 「회고 카드」 묶음에서 옮김) — 표시·편집 시드·저장 바탕이 모두
   * 서버가 고른 `card` 다. 클라가 `editedCard ?? draftCard` 를 다시 고르지 않는다. 서버가 card 와 다른 draft·edited 를
   * 내려주는 상태에서 본문·입력칸 시드·PUT 바디(title·scenes)가 전부 card 의 것이어야 한다.
   */
  describe('TRIP-945 · 본문·편집 시드·저장 바탕은 서버가 고른 card 다 (BR-U5-35)', () => {
    const CARD_SUBTITLE =
      '광안리해수욕장·부산시립미술관·해운대시장 외 1곳 을(를) 다녀왔어요. 이동 거리는 약 12.0km 였어요.';
    const CARD_TITLE = '광안리해수욕장 외 3곳';
    const CARD_SCENES = ['광안리해수욕장', '부산시립미술관'].map((name) => ({
      layout: 'TEXT',
      caption: `${name} 을(를) 다녀왔어요.`,
    }));

    function cardWith(title: string, subtitle: string, scenes: unknown[]) {
      const made: ReflectionCard = {
        templateId: 'backend.rule.daily.v1',
        format: 'CARD',
        title,
        subtitle,
        payload: JSON.stringify({
          template_id: 'backend.rule.daily.v1',
          format: 'CARD',
          cover: { title, subtitle },
          scenes,
        }),
      };
      return made;
    }

    it('본문·입력칸 시드는 card.subtitle, 저장 PUT 은 { card } 한 필드이며 title·scenes 는 card 것이다', async () => {
      serverItems = [
        {
          ...EXISTING,
          card: cardWith(CARD_TITLE, CARD_SUBTITLE, CARD_SCENES),
          draftCard: cardWith('초안 제목 D', '초안 D 문장', []),
          editedCard: cardWith('수정본 제목 E', '수정본 E 문장', []),
          stats: {
            visitCount: 4,
            distanceKm: 12,
            distanceSource: 'VISIT_LINE',
            photoCount: 6,
          },
        },
      ];
      renderPage();

      await waitForNarrative(CARD_SUBTITLE);
      // INV-3 — 규칙 카드를 그린 화면에 소요시간 표기가 없고, 거리 문장은 있다.
      expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
      expect(screen.root).toHaveTextContent(/12\.0km/);

      fireEvent.press(screen.getByTestId('reflection-daily-narrative-edit'));
      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toHaveDisplayValue(CARD_SUBTITLE);

      fireEvent.changeText(
        screen.getByTestId('reflection-daily-edit-input'),
        '바다가 좋았다'
      );
      fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));

      await waitFor(() => expect(putCount()).toBe(1));
      expect(putPaths).toEqual([PUT_PATH]);
      expect(Object.keys(putBodies[0])).toEqual(['card']);
      const parsed = JSON.parse(putBodies[0].card as string);
      expect(parsed.cover.subtitle).toBe('바다가 좋았다');
      expect(parsed.cover.title).toBe(CARD_TITLE);
      expect(parsed.scenes).toEqual(CARD_SCENES);
    });
  });

  describe('AC-2 · 저장 직후 편집에는 방금 쓴 글이 채워져 있다 (INV-U5-06)', () => {
    it('저장이 반영된 뒤 헤더 "편집"을 누르면 입력칸 값이 방금 쓴 글이다(빈칸 아님)', async () => {
      renderPage();
      await composeAndSave(WRITTEN);
      await waitForNarrative(WRITTEN);

      // 저장 뒤 얼굴은 data-insufficient(stats 0) — "수정" 링크가 없어 헤더 "편집"으로 연다.
      fireEvent.press(screen.getByTestId('reflection-daily-edit'));

      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toHaveDisplayValue(WRITTEN);
    });
  });

  describe('AC-4 · 저장이 실패하면 알리고 쓴 글을 지킨다 (INV-4)', () => {
    it.each<PutReply>([500, 400, 'network'])(
      'PUT 이 %s 로 실패하면 실패 문구를 보이고 편집창에 쓴 글이 그대로 남는다',
      async (reply) => {
        putReply = reply;
        renderPage();

        await composeAndSave(WRITTEN);

        await waitFor(() => expect(putCount()).toBe(1));
        expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
        expect(
          screen.getByTestId('reflection-daily-edit-input')
        ).toHaveDisplayValue(WRITTEN);
        expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      }
    );

    it('실패 뒤 편집을 취소하면 저장된 척하지 않는다(empty 얼굴 · 본문 없음)', async () => {
      putReply = 500;
      renderPage();
      await composeAndSave(WRITTEN);
      await screen.findByText(SAVE_FAILED);

      fireEvent.press(screen.getByTestId('reflection-daily-edit-cancel'));

      expect(screen.getByTestId('reflection-daily-empty')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-narrative')).toBeNull();
    });
  });

  describe('AC-7 · 저장 뒤 얼굴에 소요시간 표기가 없다 (INV-3)', () => {
    it('저장 뒤 화면 전체 글자에 소요·N분·N시간이 없고, 쓴 글은 보인다', async () => {
      renderPage();
      await composeAndSave(WRITTEN);

      await waitForNarrative(WRITTEN);

      expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
    });
  });

  describe('보강 · 이미 회고가 있는 날을 고쳐 저장한다 (BR-U5-35 · 5-b 경고-1·참고-2)', () => {
    it('편집은 기존 글로 열리고, 고쳐 저장하면 본문이 새 글로 바뀌며 목록에 그 날짜 항목은 1건뿐이다', async () => {
      serverItems = [EXISTING];
      const client = renderPage();
      // 목록이 비동기로 도착한 뒤(첫 렌더엔 회고가 없다) 기존 글이 본문에 보일 때까지 기다린다.
      await waitForNarrative(EXISTING_TEXT);

      fireEvent.press(screen.getByTestId('reflection-daily-narrative-edit'));

      // (a) 편집 시드 — 입력칸이 빈칸이 아니라 기존 글이다.
      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toHaveDisplayValue(EXISTING_TEXT);

      fireEvent.changeText(
        screen.getByTestId('reflection-daily-edit-input'),
        EDITED_TEXT
      );
      fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));

      // (b) 앵커 — PUT 한 번, 고친 글이 실렸다.
      await waitFor(() => expect(putCount()).toBe(1));
      expect(JSON.parse(putBodies[0].card as string).cover.subtitle).toBe(
        EDITED_TEXT
      );
      // (c) 본문이 새 글이고 옛 글은 화면에 없다.
      await waitForNarrative(EDITED_TEXT);
      expect(screen.queryByText(EXISTING_TEXT)).toBeNull();
      // (d) 목록 캐시에 이 날짜 항목이 1건뿐이다(옛 항목이 남아 겹치지 않는다).
      const cached = client.getQueryData<ReflectionList>(
        getGetTripsTripIdReflectionsQueryKey(TRIP_ID)
      );
      expect(
        cached?.items?.filter((item) => item.dayDate === DAY)
      ).toHaveLength(1);
      // (e) 레코드가 이미 있던 날이라 진입 생성(POST)은 없었다(TRIP-1068 AC-7).
      expect(postCount).toBe(0);
    });
  });

  describe('보강 · 실패 뒤 편집을 다시 열면 실패 문구가 없다 (INV-4 · 5-b 참고-3)', () => {
    it('저장 실패 → 취소 → 헤더 "편집"을 누르면 입력칸은 열리고 실패 문구는 보이지 않는다', async () => {
      putReply = 500;
      renderPage();
      await composeAndSave(WRITTEN);
      await screen.findByText(SAVE_FAILED);
      fireEvent.press(screen.getByTestId('reflection-daily-edit-cancel'));

      fireEvent.press(screen.getByTestId('reflection-daily-edit'));

      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toBeOnTheScreen();
      expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    });
  });
});

describe('TRIP-1372 · 기분·한 줄 메모 저장 — 서버가 받고 돌려준다 (TRIP-828 · V2.63)', () => {
  /**
   * 무엇을 보장하나:
   *  - 서버가 돌려준 mood·shortMemo 가 화면에 복원된다(기분 칩 선택·한 줄 입력 값).
   *  - 기분만 고치는 PUT 바디는 { mood } 뿐이다 — card 를 실으면 카드가 갈아끼워진다. 한 줄도 { shortMemo } 뿐.
   *  - 선택한 기분을 다시 누르면 빈 문자열로 지운다. 한 줄을 비우면 빈 문자열(공백뿐 포함)로 지운다.
   *  - 안 바뀐 한 줄은 요청을 쏘지 않는다. 개행·제어 문자는 입력에서 걷고 상한 60 을 건다.
   *  - 저장이 실패하면 알리고 이탈하지 않는다(INV-4). (TRIP-1591: 하단 「확인」은 없앴다 — 한 줄은 입력을 마칠 때만 저장된다.)
   * 서버는 PUT 을 받아 mood·shortMemo 를 기억하고 목록 GET 에 돌려준다(상태 기억).
   */
  const TRIP_ID = 'trip-1372';
  const TODAY = '2026-09-26';
  const FAILED = '저장하지 못했어요. 다시 시도해 주세요';
  const PUT_PATH = `/api/v1/trips/${TRIP_ID}/reflections/${DAY}`;

  const TRIP: Trip = {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: '2026-09-24',
    endDate: '2026-09-25',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };

  const CARD: ReflectionCard = {
    templateId: 'backend.rule.daily.v1',
    format: 'CARD',
    title: '부산 첫날',
    subtitle: '해운대에서 조개구이를 먹은 하루',
    payload: '{}',
  };

  const BASE_REFLECTION: Reflection = {
    dayDate: DAY,
    card: CARD,
    draftCard: CARD,
    source: 'RULE',
    stats: {
      visitCount: 3,
      distanceKm: 4.2,
      distanceSource: 'VISIT_LINE',
      photoCount: 2,
    },
    generatedAt: '2026-09-24T12:00:00Z',
    updatedAt: '2026-09-24T12:00:00Z',
  };

  let serverItem: Reflection;
  let putBodies: EditReflectionRequest[];
  let putPaths: string[];
  let putFails: boolean;
  // TRIP-1497 — PUT 응답을 붙잡는 문(기본은 열려 있다).
  let putGate: Promise<void>;
  let releasePut: () => void;

  beforeEach(() => {
    serverItem = BASE_REFLECTION;
    putBodies = [];
    putPaths = [];
    putFails = false;
    putGate = Promise.resolve();
    releasePut = () => {};
    (router.back as jest.Mock).mockClear();
    setAccessToken('a');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(TRIP)),
      http.get(`${BASE}/trips/:tripId/reflections`, () =>
        HttpResponse.json({ items: [serverItem] })
      ),
      http.put(
        `${BASE}/trips/:tripId/reflections/:dayDate`,
        async ({ request }) => {
          const body = (await request.json()) as EditReflectionRequest;
          putBodies.push(body);
          putPaths.push(new URL(request.url).pathname);
          await putGate;
          if (putFails) {
            const error: ErrorResponse = {
              error: { code: 'INTERNAL_ERROR', message: '저장 실패' },
            };
            return HttpResponse.json(error, { status: 500 });
          }
          // '' 는 지움, null/미전송은 그대로 — 서버 계약 그대로.
          const pick = (
            sent: string | null | undefined,
            kept?: string | null
          ) =>
            sent === undefined || sent === null
              ? kept
              : sent === ''
                ? null
                : sent;
          serverItem = {
            ...serverItem,
            mood: pick(body.mood, serverItem.mood),
            shortMemo: pick(body.shortMemo?.trim(), serverItem.shortMemo),
          };
          return HttpResponse.json(serverItem);
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    render(<DailyReflectionPage tripId={TRIP_ID} date={DAY} today={TODAY} />, {
      wrapper: Wrapper,
    });
  }

  const selected = (key: string) =>
    screen.getByTestId(`reflection-daily-mood-${key}`).props.accessibilityState
      .selected;

  it('서버가 돌려준 기분·한 줄이 화면에 복원된다', async () => {
    serverItem = {
      ...BASE_REFLECTION,
      mood: 'good',
      shortMemo: '바다가 좋았다',
    };

    renderPage();
    await screen.findByTestId('reflection-daily-mood-good');

    expect(selected('good')).toBe(true);
    expect(selected('soso')).toBe(false);
    expect(selected('sad')).toBe(false);
    expect(screen.getByTestId('reflection-daily-memo-input').props.value).toBe(
      '바다가 좋았다'
    );
  });

  it('기분을 고르면 PUT 바디는 { mood } 뿐이고(card 없음) 응답이 칩에 반영된다', async () => {
    renderPage();
    await screen.findByTestId('reflection-daily-mood-soso');

    fireEvent.press(screen.getByTestId('reflection-daily-mood-soso'));

    await waitFor(() => expect(selected('soso')).toBe(true));
    expect(putBodies).toEqual([{ mood: 'soso' }]);
    expect(putPaths).toEqual([PUT_PATH]);
  });

  it('선택한 기분을 다시 누르면 빈 문자열로 지운다', async () => {
    serverItem = { ...BASE_REFLECTION, mood: 'good' };
    renderPage();
    await screen.findByTestId('reflection-daily-mood-good');

    fireEvent.press(screen.getByTestId('reflection-daily-mood-good'));

    await waitFor(() => expect(selected('good')).toBe(false));
    expect(putBodies).toEqual([{ mood: '' }]);
  });

  it('기분 저장이 실패하면 알리고 선택은 서버 값 그대로다(INV-4)', async () => {
    serverItem = { ...BASE_REFLECTION, mood: 'good' };
    putFails = true;
    renderPage();
    await screen.findByTestId('reflection-daily-mood-good');

    fireEvent.press(screen.getByTestId('reflection-daily-mood-sad'));

    expect(await screen.findByText(FAILED)).toBeOnTheScreen();
    expect(selected('good')).toBe(true);
    expect(selected('sad')).toBe(false);
  });

  it('한 줄은 입력을 마치면 PUT 바디 { shortMemo } 뿐으로 저장된다', async () => {
    renderPage();
    const input = await screen.findByTestId('reflection-daily-memo-input');

    fireEvent.changeText(input, '  바다가 좋았다  ');
    fireEvent(input, 'endEditing');

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ shortMemo: '바다가 좋았다' });
  });

  it('바뀌지 않은 한 줄은 요청을 쏘지 않는다', async () => {
    serverItem = { ...BASE_REFLECTION, shortMemo: '바다가 좋았다' };
    renderPage();
    const input = await screen.findByTestId('reflection-daily-memo-input');

    fireEvent(input, 'endEditing');
    fireEvent.changeText(input, ' 바다가 좋았다 ');
    fireEvent(input, 'endEditing');

    expect(putBodies).toHaveLength(0);
  });

  it('한 줄을 모두 지우면 빈 문자열로 지운다', async () => {
    serverItem = { ...BASE_REFLECTION, shortMemo: '바다가 좋았다' };
    renderPage();
    const input = await screen.findByTestId('reflection-daily-memo-input');

    fireEvent.changeText(input, '   ');
    fireEvent(input, 'endEditing');

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ shortMemo: '' });
  });

  it('한 줄은 개행·제어 문자를 걷고 상한 60 을 건다', async () => {
    renderPage();
    const input = await screen.findByTestId('reflection-daily-memo-input');

    expect(input.props.maxLength).toBe(60);
    fireEvent.changeText(input, '첫째 줄\n둘째\t줄');

    expect(screen.getByTestId('reflection-daily-memo-input').props.value).toBe(
      '첫째 줄 둘째 줄'
    );
  });

  // TRIP-1425 · Q-112 — 입력을 마치면 조용히 저장돼 됐는지 알 수 없었다. PUT 이 나가 성공했을 때만 공용 토스트로 알린다.
  describe('TRIP-1425 · 한 줄을 실제로 저장했을 때만 "한 줄 메모를 저장했어요"', () => {
    const TOAST = 'reflection-daily-memo-saved-toast';
    const COPY = '한 줄 메모를 저장했어요';
    const TOAST_WAIT = { timeout: 2000 };

    it('한 줄을 바꿔 입력을 마치고 저장이 성공하면 안내가 뜬다 (AC-13)', async () => {
      // 준비
      renderPage();
      const input = await screen.findByTestId('reflection-daily-memo-input');
      // 앵커 — 저장 전엔 안내가 없다.
      expect(screen.queryByTestId(TOAST)).toBeNull();

      // 실행
      fireEvent.changeText(input, '바다가 좋았다');
      fireEvent(input, 'endEditing');

      // 단언
      expect(
        await screen.findByTestId(TOAST, {}, TOAST_WAIT)
      ).toHaveTextContent(COPY);
      expect(putBodies).toEqual([{ shortMemo: '바다가 좋았다' }]);
    });

    it('입력을 마쳐 PUT 이 진행 중일 때 응답 전에 같은 글로 한 번 더 마쳐도 PUT 은 1회다 (TRIP-1497 · TRIP-1591: 「확인」은 없어져 두 번째 마침으로 잰다)', async () => {
      // 준비 — data-insufficient 날 + PUT 응답을 붙잡는다.
      serverItem = {
        ...BASE_REFLECTION,
        stats: { ...BASE_REFLECTION.stats, visitCount: 1, photoCount: 0 },
      };
      putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      renderPage();
      const input = await screen.findByTestId('reflection-daily-memo-input');
      fireEvent.changeText(input, '바다가 좋았다');
      fireEvent(input, 'endEditing');
      await waitFor(() => expect(putBodies).toHaveLength(1));

      // 실행 — 응답 전에 같은 글로 한 번 더 마침.
      fireEvent(input, 'endEditing');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await act(async () => {
        releasePut();
      });

      // 단언 — PUT 은 한 번뿐이다.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(putBodies).toEqual([{ shortMemo: '바다가 좋았다' }]);
    });

    it('PUT 이 진행 중인 사이 한 줄을 더 고쳐 다시 마치면 먼저 보낸 저장이 끝난 뒤 고친 글이 한 번 더 저장된다 — 새 글이 사라지지 않는다 (TRIP-1497)', async () => {
      serverItem = {
        ...BASE_REFLECTION,
        stats: { ...BASE_REFLECTION.stats, visitCount: 1, photoCount: 0 },
      };
      putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      renderPage();
      const input = await screen.findByTestId('reflection-daily-memo-input');
      fireEvent.changeText(input, 'A글');
      fireEvent(input, 'endEditing');
      await waitFor(() => expect(putBodies).toHaveLength(1));

      fireEvent.changeText(input, 'A글 더');
      fireEvent(input, 'endEditing');
      putGate = Promise.resolve();
      await act(async () => {
        releasePut();
      });

      await waitFor(() => expect(putBodies).toHaveLength(2));
      expect(putBodies).toEqual([
        { shortMemo: 'A글' },
        { shortMemo: 'A글 더' },
      ]);
    });

    it('안 바뀐 한 줄은 입력을 마쳐도 요청·안내가 없다 — 바뀐 글은 뜬다 (AC-15)', async () => {
      // 준비
      serverItem = { ...BASE_REFLECTION, shortMemo: '바다가 좋았다' };
      renderPage();
      const input = await screen.findByTestId('reflection-daily-memo-input');

      // 실행 ① — 그대로 마침 · 같은 글(앞뒤 공백만 다름)로 마침.
      fireEvent(input, 'endEditing');
      fireEvent.changeText(input, ' 바다가 좋았다 ');
      fireEvent(input, 'endEditing');
      // "안 바뀜"도 Promise 로 끝난다 — 한 바퀴 흘려야 잘못 건 안내가 보인다(02a ★11).
      await act(async () => {});

      // 단언 ①
      expect(putBodies).toHaveLength(0);
      expect(screen.queryByTestId(TOAST)).toBeNull();

      // 실행 ② — 짝: 다른 글(센티널).
      const again = screen.getByTestId('reflection-daily-memo-input');
      fireEvent.changeText(again, '노을도 좋았다');
      fireEvent(again, 'endEditing');

      // 단언 ② — 이번엔 저장되고 안내가 뜬다.
      expect(
        await screen.findByTestId(TOAST, {}, TOAST_WAIT)
      ).toHaveTextContent(COPY);
      expect(putBodies).toEqual([{ shortMemo: '노을도 좋았다' }]);
    });

    it('저장이 실패하면 안내는 없고 실패 줄이 남는다 — 화면을 닫지도 않는다 (AC-16 · INV-4)', async () => {
      // 준비
      putFails = true;
      renderPage();
      const input = await screen.findByTestId('reflection-daily-memo-input');

      // 실행
      fireEvent.changeText(input, '바다가 좋았다');
      fireEvent(input, 'endEditing');
      expect(await screen.findByText(FAILED)).toBeOnTheScreen();
      await act(async () => {});

      // 단언
      expect(screen.getByText(FAILED)).toBeOnTheScreen();
      expect(screen.queryByTestId(TOAST)).toBeNull();
      expect(router.back).not.toHaveBeenCalled();
    });

    it('기분을 고를 때는 안내가 없다 — 한 줄을 저장하면 뜬다 (AC-17)', async () => {
      // 준비
      renderPage();
      await screen.findByTestId('reflection-daily-mood-soso');

      // 실행 ① — 기분만 저장.
      fireEvent.press(screen.getByTestId('reflection-daily-mood-soso'));
      await waitFor(() => expect(selected('soso')).toBe(true));
      await act(async () => {});

      // 단언 ①
      expect(putBodies).toEqual([{ mood: 'soso' }]);
      expect(screen.queryByTestId(TOAST)).toBeNull();

      // 실행 ② — 짝: 한 줄 저장.
      const input = screen.getByTestId('reflection-daily-memo-input');
      fireEvent.changeText(input, '바다가 좋았다');
      fireEvent(input, 'endEditing');

      // 단언 ②
      expect(
        await screen.findByTestId(TOAST, {}, TOAST_WAIT)
      ).toHaveTextContent(COPY);
    });
  });
});
