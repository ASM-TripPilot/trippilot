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

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import { server } from '@/mocks/server';
import { getGetTripsTripIdReflectionsQueryKey } from '@/shared/api/generated/reflection/reflection';
import type {
  EditReflectionRequest,
  ErrorResponse,
  Reflection,
  ReflectionCard,
  ReflectionList,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * j03 오늘의 회고 — 실제 페이지·훅 + msw(가짜 서버) + 실 QueryClient 로 보는 사용자 흐름. 관점마다 describe 하나:
 *  - 레코드가 없는 날 한 번 만들어 보여주기(생성) — 옛 `DailyReflectionPage.generate.integration.test.tsx`
 *  - 직접 쓴 회고 저장 뒤 같은 화면(저장) — 옛 `DailyReflectionPage.save.integration.test.tsx`
 * 서버 기동·정지는 파일 최상위 한 번, 관점별 가짜 서버 상태(serverItems·응답 스위치)는 각 describe 의 beforeEach 가 다시 세운다.
 * 훅·화면을 목으로 갈아 끼워 배선만 보는 node 테스트는 `DailyReflectionPage.hookMock.test.tsx`.
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
              JSON.parse(body.card) as { cover: { title: string } }
            ).cover;
            const edited: ReflectionCard = {
              templateId: 'user.edit.v1',
              format: 'CARD',
              title: cover.title,
              subtitle: written,
              payload: body.card,
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
            body.card,
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
      expect(JSON.parse(putBodies[0].card).cover.subtitle).toBe(WRITTEN);
      await waitForNarrative(WRITTEN);
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      expect(screen.queryByText(SAVE_FAILED)).toBeNull();
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
      expect(JSON.parse(putBodies[0].card).cover.subtitle).toBe(EDITED_TEXT);
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
