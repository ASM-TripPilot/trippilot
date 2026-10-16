import { http, HttpResponse } from 'msw';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { BASE } from '@/test-support/apiBase';
import { createGcZeroWrapper, settle } from '@/test-support/queryRender';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { SavedStay } from '@/shared/api/index.schemas';

import { SavedStayPage } from './SavedStayPage';

/**
 * TRIP-461 · e04 저장한 숙소 배선(페이지 층) 승인 테스트 — AC-2·4·5·6·7.
 *
 * 무엇을 보장하나: 페이지가 `GET /saved-stays`를 읽어 카드 N개를 그리고(AC-2), 카드 press 시
 * 상세 라우트로 **`stayId` 하나만** 실어 push 한다(AC-5). 게스트(미로그인)는 조회를 아예 안
 * 내보내고 게스트 얼굴을 그린다(AC-4·★5).
 *
 * TRIP-940 재작성(AC-10 · 01b D0·Q3): 예전엔 `SavedStay`를 e03가 받는 `StayItem`으로 **합성**해
 * `item`(JSON)으로 넘기고, 그 합성물이 e03 검문 게이트를 통과하는지를 여기서 복제 검문했다. 상세가
 * `GET /stays/{stayId}`로 스스로 조회하게 되면서 합성·게이트가 모두 사라졌다 — 이제는 "item 을
 * 싣지 않는다"가 계약이다. 외부키 없는 핀·수동 숙소는 여전히 `savedStayId`로 폴백 push 하고
 * (Q3 — 상세에서 400 식별자 오류 얼굴을 받는다, 새 티켓 후보: 등록 숙소 상세 정의).
 *
 * 왜 통합 버킷인가 — 심판 대상이 "서버 데이터로 조립한 push payload"다. 라우팅 인자는 실
 * react-query 캐시에서 나온 실데이터라야 의미가 있다(d02 `SavedPlacesPage.rowtap` 선례).
 *
 * *(초심자용 개념)*
 *  - `server.use(...)` = 이 파일 안에서만 msw 응답을 갈아끼운다(기본 `/saved-stays`는 `[]`).
 *  - `render(...)` 후 `await screen.findByTestId(...)` = 서버 응답이 도착해 노드가 뜰 때까지 기다린다.
 *  - `mockPush.mock.calls` = 라우터 push가 어떤 인자로 불렸는지 기록한 배열.
 */

// storage 목 — tokenManager 부트스트랩이 실제 저장소를 건드리지 않게 한다(d02 rowtap 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 라우터 목 — push를 문자열이든 객체든 그대로 기록한다(e04 카드 push는 {pathname,params} 객체).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: () => {} },
  useRouter: () => ({ push: mockPush, back: () => {} }),
  useLocalSearchParams: () => ({}),
}));

// 하트 저장분(외부키 있음) — stayId는 stayKey(=SOURCE:ID)가 돼야 한다.
const HEARTED: SavedStay = {
  savedStayId: 'ss-1',
  name: '해운대 오션뷰 호텔',
  lat: 35.1587,
  lng: 129.1604,
  coordConfirmed: true,
  linkedTripIds: [],
  checkIn: '2026-06-10',
  checkOut: '2026-06-13',
  externalSource: 'NAVER',
  externalId: 'n-99',
  registerRoute: 'MAP_SEARCH',
  memo: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

// 핀·수동 등록분(외부키 null) — stayId는 savedStayId로 폴백해야 한다(충돌 방지, ★2).
const PINNED: SavedStay = {
  savedStayId: 'ss-2',
  name: '제주 돌담 게스트하우스',
  lat: null,
  lng: null,
  coordConfirmed: false,
  linkedTripIds: [],
  checkIn: null,
  checkOut: null,
  externalSource: null,
  externalId: null,
  registerRoute: 'PIN',
  memo: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockPush.mockClear();
  clearAccessToken();
  setAccessToken('valid-access');
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('AC-2 · 서버 N건 → 카드 N개 + 개수 부제', () => {
  it('저장 숙소 2건이면 카드 2개와 부제 개수 2가 뜬다', async () => {
    // 준비 — 서버가 2건을 준다.
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );

    // 실행 — 페이지를 그리고 데이터 도착을 기다린다.
    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });
    await screen.findByTestId('saved-stay-card-ss-1');

    // 단언 — 두 카드와 개수 부제(정규식=부분포함, 02a §5-1).
    expect(screen.getByTestId('saved-stay-card-ss-2')).toBeOnTheScreen();
    expect(screen.getByTestId('saved-stay-subtitle')).toHaveTextContent(/2곳/);
  });
});

describe('AC-5 · 카드 press → 상세 push 는 stayId 만 (TRIP-940 AC-10 재작성)', () => {
  it('하트 숙소 카드 press → stayId=stayKey 하나만 싣고 item 은 없다', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );
    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });
    await screen.findByTestId('saved-stay-card-ss-1');

    // 실행 — 하트 숙소 카드를 누른다.
    fireEvent.press(screen.getByTestId('saved-stay-card-ss-1'));

    // 단언 — push 는 한 번, 객체형 전체를 완전일치로 본다(params 에 item 이 남으면 red).
    expect(mockPush.mock.calls).toEqual([
      [{ pathname: '/stays/[stayId]', params: { stayId: 'NAVER:n-99' } }],
    ]);
  });

  it('핀·수동 숙소(외부키 null) 카드 press → stayId=savedStayId 폴백 하나만 싣는다 (★2 · Q3)', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([HEARTED, PINNED])
      )
    );
    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });
    await screen.findByTestId('saved-stay-card-ss-2');

    // 실행 — 외부키가 null인 핀 숙소 카드를 누른다.
    fireEvent.press(screen.getByTestId('saved-stay-card-ss-2'));

    // 단언 — stayKey가 "null:null"로 충돌하지 않고 savedStayId로 폴백하며, item 은 없다.
    expect(mockPush.mock.calls).toEqual([
      [{ pathname: '/stays/[stayId]', params: { stayId: 'ss-2' } }],
    ]);
  });
});

describe('AC-6 · 하단 "거점 지정" → /stays/register', () => {
  it('하단 버튼 press → /stays/register 로 push 한다', async () => {
    server.use(
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([HEARTED]))
    );
    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });
    await screen.findByTestId('saved-stay-register');

    fireEvent.press(screen.getByTestId('saved-stay-register'));

    expect(mockPush.mock.calls).toEqual([['/stays/register']]);
  });
});

describe('AC-7 · empty CTA "숙소 둘러보기" → /stays', () => {
  it('0건 empty 에서 CTA press → /stays 로 push 한다', async () => {
    // 기본 핸들러가 [] 를 주지만 명시적으로 둔다(의도 표시).
    server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])));
    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });
    await screen.findByTestId('saved-stay-browse');

    fireEvent.press(screen.getByTestId('saved-stay-browse'));

    expect(mockPush.mock.calls).toEqual([['/stays']]);
  });
});

describe('AC-4 · 게스트는 조회를 안 내보내고 게스트 얼굴을 그린다 (★5)', () => {
  it('미로그인이면 /saved-stays 요청이 0건이고, 게스트 얼굴이 뜬다(loading·empty 아님)', async () => {
    // 준비 — 토큰을 지우고, /saved-stays 히트를 세는 스파이 핸들러를 건다.
    clearAccessToken();
    let hits = 0;
    server.use(
      http.get(`${BASE}/saved-stays`, () => {
        hits += 1;
        return HttpResponse.json([HEARTED]);
      })
    );

    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });

    // 단언 — 게스트 얼굴이 뜬다(enabled:isAuthed=false 라 조회가 영원히 pending인데, 게스트
    // 분기가 상태 판정보다 먼저라 끝나지 않는 로딩에 안 빠진다, d02 ★1).
    await screen.findByTestId('saved-stay-guest');
    expect(screen.queryByTestId('saved-stay-card-ss-1')).toBeNull();

    // 단언 — 조회가 아예 안 나갔다. `enabled:isAuthed` 게이트를 실제로 잠근다.
    await waitFor(() => expect(hits).toBe(0));
  });
});

describe('AC-11 · 실앱 degrade — 페이지가 거점/지역/가격을 발명하지 않는다 (TRIP-729)', () => {
  it('서버 SavedStay 로드 시 카드는 이름만, 거점 배지·가격은 미표시 (계약 공백, 사변 금지)', async () => {
    // SavedStay 계약엔 isBase·region·price 필드가 없다. 페이지는 이 값들을 채우는 조회 훅을 만들지
    // 않고 VM 에 미설정으로 둔다 → 카드가 이름만 그린다(Figma 풀샷은 프리뷰 픽스처에서만).
    // 선제 green(회귀 트립와이어) — 페이지가 `isBase:true` 를 매핑하면 이 단언이 red 로 뒤집힌다.
    server.use(
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([HEARTED]))
    );
    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });
    const card = await screen.findByTestId('saved-stay-card-ss-1');

    // 긍정 짝 — 이름은 뜬다(카드 자체가 안 떠서 공짜 통과하는 것 차단).
    expect(screen.getByText('해운대 오션뷰 호텔')).toBeOnTheScreen();
    // 부정 — 거점 배지·"거점" 문자열·가격 발명 0.
    expect(screen.queryByTestId('saved-stay-card-ss-1-base-badge')).toBeNull();
    expect(screen.queryByText('거점')).toBeNull();
    expect(card).not.toHaveTextContent(/원~|₩/);
  });
});

// TRIP-1429 결정 ⑥ — e04 하트는 저장을 푸는 버튼이다(Q-040). 누르면 그 행이 응답 전에 목록에서 빠지고(낙관 갱신),
// 실패·409 면 같은 자리로 돌아오며 안내가 뜬다(INV-4). 해제는 savedStayId 로 지운다 — 토글 훅의 remove 는
// 외부키 역인덱스라 핀·수동 숙소를 못 지운다. 서버는 거점으로 쓰는 숙소를 409 로 막는다(openapi 미기재, 서버 코드 기준).
describe('RM · 하트로 저장을 푼다 (D1~D5 · 01b Q3·Q5 · INV-4)', () => {
  const THIRD: SavedStay = {
    ...HEARTED,
    savedStayId: 'ss-3',
    name: '광안리 바다 스테이',
    externalId: 'n-77',
  };

  /** 서버 문구 그대로 — 화면은 이 문장을 노출하지 않는다(01b Q5). */
  const SERVER_409_MESSAGE =
    '거점으로 사용 중인 숙소는 삭제할 수 없습니다. 거점 배정을 먼저 해제하세요.';

  type DeleteResult = 204 | 404 | 409 | 'network';
  interface Gate {
    promise: Promise<void>;
    open: () => void;
  }
  function gate(): Gate {
    let open: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  }

  // 서버 상태는 가변이다 — 204·404 면 목록에서도 빠져야 무효화 재조회가 지운 행을 되살리지 않는다.
  let serverList: SavedStay[];
  let plans: Record<string, { result: DeleteResult; gate?: Gate }>;
  let deleteHits: string[];
  let deleteDone: string[];
  let getHits: number;
  // 첫 GET 뒤의 재조회를 붙잡는다 — 롤백이 남긴 유령 행이 재조회에 덮여 사라지기 전에 보려고(RM-6).
  let refetchGate: Gate | null;

  beforeEach(() => {
    serverList = [];
    plans = {};
    deleteHits = [];
    deleteDone = [];
    getHits = 0;
    refetchGate = null;
    server.use(
      http.get(`${BASE}/saved-stays`, async () => {
        getHits += 1;
        if (getHits > 1 && refetchGate) await refetchGate.promise;
        return HttpResponse.json(serverList);
      }),
      http.delete(`${BASE}/saved-stays/:savedStayId`, async ({ params }) => {
        const id = String(params.savedStayId);
        deleteHits.push(id);
        const plan = plans[id] ?? { result: 204 };
        if (plan.gate) await plan.gate.promise;
        deleteDone.push(id);
        if (plan.result === 'network') return HttpResponse.error();
        if (plan.result === 409) {
          return HttpResponse.json(
            { error: { code: 'CONFLICT', message: SERVER_409_MESSAGE } },
            { status: 409 }
          );
        }
        serverList = serverList.filter((stay) => stay.savedStayId !== id);
        if (plan.result === 404) {
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: '찾을 수 없습니다.' } },
            { status: 404 }
          );
        }
        return new HttpResponse(null, { status: 204 });
      })
    );
  });

  // 실패한 it 이 붙잡아 둔 응답을 풀어 준다(다음 it 으로 열린 요청이 새지 않게).
  afterEach(() => {
    Object.values(plans).forEach((plan) => plan.gate?.open());
    refetchGate?.open();
  });

  async function renderWith(list: SavedStay[]): Promise<void> {
    serverList = list;
    render(<SavedStayPage />, { wrapper: createGcZeroWrapper() });
    await screen.findByTestId(`saved-stay-card-${list[0].savedStayId}`);
  }

  /** 눌림 이벤트를 함께 넘긴다 — 콜백 직결 회귀는 인자 없는 press 로 안 잡힌다(traps-stay). */
  function pressHeart(id: string): void {
    fireEvent.press(screen.getByTestId(`saved-stay-heart-${id}`), {
      nativeEvent: {},
    });
  }

  /** 화면에 그려진 카드 순서(하위 testID `-base-badge` 등은 `$` 로 뺀다). */
  function cardIds(): string[] {
    return screen
      .getAllByTestId(/^saved-stay-card-ss-\d+$/)
      .map((node) => String(node.props.testID));
  }

  async function waitGone(id: string): Promise<void> {
    await waitFor(() =>
      expect(screen.queryByTestId(`saved-stay-card-${id}`)).toBeNull()
    );
  }

  /** 붙잡은 DELETE 를 풀고, 그 응답이 서버를 떠나 클라이언트 처리까지 흘러가게 한다. */
  async function release(id: string): Promise<void> {
    await act(async () => plans[id].gate?.open());
    await waitFor(() => expect(deleteDone).toContain(id));
    await settle();
  }

  const BANNER = 'saved-stay-remove-error';
  const RETRY = 'saved-stay-remove-error-retry';

  describe('RM-1 · 하트 → DELETE 1회 · 응답 전에 행이 빠진다 · 상세 이동 없음 (D1)', () => {
    it.each([
      { kind: '하트 저장 숙소', id: 'ss-1', other: 'ss-2' },
      { kind: '핀·수동 숙소(외부키 null)', id: 'ss-2', other: 'ss-1' },
    ])('$kind', async ({ id, other }) => {
      // 준비 — 두 건, 대상 DELETE 는 응답을 붙잡아 둔다.
      plans[id] = { result: 204, gate: gate() };
      await renderWith([HEARTED, PINNED]);

      // 실행.
      pressHeart(id);

      // 단언 — 응답 전에 그 행만 빠졌다(낙관 갱신). DELETE 는 savedStayId 로 한 번.
      await waitGone(id);
      expect(deleteHits).toEqual([id]);
      expect(screen.getByTestId(`saved-stay-card-${other}`)).toBeOnTheScreen();
      expect(screen.getByTestId('saved-stay-subtitle')).toHaveTextContent(
        /1곳/
      );
      // 하트 누름이 카드 누름(상세 push)으로 새지 않았다.
      expect(mockPush).not.toHaveBeenCalled();

      // 응답 뒤 목록을 다시 받아도(무효화 재조회) 그대로 빠져 있고, 실패 안내는 없다.
      await release(id);
      await waitFor(() => expect(getHits).toBeGreaterThanOrEqual(2));
      await settle();
      expect(screen.queryByTestId(`saved-stay-card-${id}`)).toBeNull();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe('RM-2 · 409(거점으로 쓰는 숙소) → 같은 자리로 되돌리고 거점 사유를 알린다 (D2 · BR-U1-19 · Q5)', () => {
    it('행이 원래 순서로 돌아오고, 배너가 사유를 우리 문구로 말하며 다시 시도는 없다', async () => {
      plans['ss-1'] = { result: 409, gate: gate() };
      await renderWith([HEARTED, PINNED]);

      pressHeart('ss-1');
      // 앵커 — 낙관 제거가 실제로 일어났다(처음부터 안 빠져서 "돌아왔다"가 공짜로 통과하는 것 방지).
      await waitGone('ss-1');
      await release('ss-1');

      await waitFor(() =>
        expect(screen.getByTestId('saved-stay-card-ss-1')).toBeOnTheScreen()
      );
      expect(cardIds()).toEqual([
        'saved-stay-card-ss-1',
        'saved-stay-card-ss-2',
      ]);
      const banner = screen.getByTestId(BANNER);
      expect(banner).toHaveTextContent(
        /여행의 거점으로 쓰는 숙소라 지울 수 없어요/
      );
      expect(banner).toHaveTextContent(/여행에서 거점을 먼저 바꿔 주세요/);
      // 서버 문장은 그대로 노출하지 않는다.
      expect(banner).not.toHaveTextContent(/삭제할 수 없습니다/);
      // 다시 해도 같은 409 라 다시 시도 버튼을 두지 않는다.
      expect(screen.queryByTestId(RETRY)).toBeNull();
    });
  });

  describe('RM-3 · 네트워크 실패 → 되돌림 + 안내 + 다시 시도가 실제로 다시 지운다 (D2 · Q5 · INV-4)', () => {
    it('실패하면 행이 돌아오고 "저장을 풀지 못했어요"가 뜨며, 다시 시도를 누르면 DELETE 가 한 번 더 나가 행이 빠진다', async () => {
      plans['ss-1'] = { result: 'network' };
      await renderWith([HEARTED, PINNED]);

      pressHeart('ss-1');

      await waitFor(() =>
        expect(screen.getByTestId(BANNER)).toHaveTextContent(
          /저장을 풀지 못했어요/
        )
      );
      expect(screen.getByTestId('saved-stay-card-ss-1')).toBeOnTheScreen();
      expect(cardIds()).toEqual([
        'saved-stay-card-ss-1',
        'saved-stay-card-ss-2',
      ]);

      // 다시 시도 — 이번엔 서버가 받아 준다.
      plans['ss-1'] = { result: 204 };
      fireEvent.press(screen.getByTestId(RETRY), { nativeEvent: {} });

      await waitGone('ss-1');
      expect(deleteHits).toEqual(['ss-1', 'ss-1']);
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe('RM-4 · 실패 안내는 다음 하트 조작에서 지운다 (01b Q5 · d02 선례)', () => {
    it('409 배너가 떠 있는 채 다른 숙소 하트를 누르면 배너가 사라진다', async () => {
      plans['ss-1'] = { result: 409 };
      await renderWith([HEARTED, PINNED]);
      pressHeart('ss-1');
      await screen.findByTestId(BANNER);

      pressHeart('ss-2');

      await waitGone('ss-2');
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe('RM-5 · 404 는 "이미 없음" — 되돌리지 않고 목록을 다시 받는다 (01b Q3)', () => {
    it('행이 돌아오지 않고 실패 안내도 없으며, 목록을 다시 조회한다', async () => {
      plans['ss-1'] = { result: 404 };
      await renderWith([HEARTED, PINNED]);

      pressHeart('ss-1');

      await waitFor(() => expect(getHits).toBeGreaterThanOrEqual(2));
      await settle();
      expect(screen.queryByTestId('saved-stay-card-ss-1')).toBeNull();
      expect(screen.getByTestId('saved-stay-card-ss-2')).toBeOnTheScreen();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  // 문제로그 2026-08-03 · traps-stay 「동시 토글 스냅숏 롤백」과 같은 뿌리. 호출 전 목록을 통째로 되돌리면 A 의 실패가
  // 이미 지운 B 를 되살린다(유령 — 누르면 404). 실패한 행만 제자리로 돌린다. 두 응답 순서를 다 돈다.
  describe('RM-6 · 두 하트를 잇달아 눌러 한쪽만 실패하면 실패한 행만 돌아온다 (D3)', () => {
    it.each([
      {
        order: '성공(ss-2) 먼저 → 실패(ss-1) 나중',
        first: 'ss-2',
        second: 'ss-1',
      },
      {
        order: '실패(ss-1) 먼저 → 성공(ss-2) 나중',
        first: 'ss-1',
        second: 'ss-2',
      },
    ])('$order', async ({ first, second }) => {
      plans['ss-1'] = { result: 409, gate: gate() };
      plans['ss-2'] = { result: 204, gate: gate() };
      await renderWith([HEARTED, PINNED, THIRD]);
      refetchGate = gate();

      pressHeart('ss-1');
      await waitGone('ss-1');
      pressHeart('ss-2');
      await waitGone('ss-2');

      await release(first);
      await release(second);

      // 재조회가 붙잡혀 있는 동안 — 캐시가 낸 결과 그대로를 본다.
      await waitFor(() =>
        expect(screen.getByTestId('saved-stay-card-ss-1')).toBeOnTheScreen()
      );
      expect(screen.queryByTestId('saved-stay-card-ss-2')).toBeNull();
      expect(cardIds()).toEqual([
        'saved-stay-card-ss-1',
        'saved-stay-card-ss-3',
      ]);
      expect(screen.getByTestId(BANNER)).toHaveTextContent(
        /여행의 거점으로 쓰는 숙소라 지울 수 없어요/
      );

      // 재조회를 풀어도 서버 상태(ss-1·ss-3)와 같다.
      await act(async () => refetchGate?.open());
      await settle();
      expect(screen.queryByTestId('saved-stay-card-ss-2')).toBeNull();
      expect(cardIds()).toEqual([
        'saved-stay-card-ss-1',
        'saved-stay-card-ss-3',
      ]);
    });
  });

  describe('RM-7 · 마지막 한 곳을 풀면 빈 얼굴, 실패하면 목록으로 돌아온다 (D5)', () => {
    it('성공 — 응답 전부터 빈 얼굴이고 응답 뒤에도 그대로다', async () => {
      plans['ss-1'] = { result: 204, gate: gate() };
      await renderWith([HEARTED]);

      pressHeart('ss-1');

      await screen.findByTestId('saved-stay-empty');
      await release('ss-1');
      await waitFor(() => expect(getHits).toBeGreaterThanOrEqual(2));
      await settle();
      expect(screen.getByTestId('saved-stay-empty')).toBeOnTheScreen();
      expect(screen.queryByTestId('saved-stay-card-ss-1')).toBeNull();
    });

    it('실패 — 빈 얼굴이 목록 얼굴로 돌아오고 카드와 안내가 보인다', async () => {
      plans['ss-1'] = { result: 'network', gate: gate() };
      await renderWith([HEARTED]);

      pressHeart('ss-1');
      // 앵커 — 낙관 제거로 빈 얼굴까지 갔다.
      await screen.findByTestId('saved-stay-empty');
      await release('ss-1');

      await waitFor(() =>
        expect(screen.getByTestId('saved-stay-card-ss-1')).toBeOnTheScreen()
      );
      expect(screen.queryByTestId('saved-stay-empty')).toBeNull();
      expect(screen.getByTestId('saved-stay-subtitle')).toHaveTextContent(
        /1곳/
      );
      expect(screen.getByTestId(BANNER)).toBeOnTheScreen();
    });
  });
});
