import type { ReactNode } from 'react';
import * as Linking from 'expo-linking';
import { Share } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { StayDetail } from '@/shared/api/generated/schemas';
import { getGetMeSettingsQueryKey } from '@/shared/api/generated/profile/profile';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { StayDetailPage } from './StayDetailPage';

/**
 * TRIP-457 AC-2·8·9·10·11 (배선) — e03 상세 페이지가 params 데이터·제휴 시트·이동·저장에
 * 실제로 이어진다는 증거. 화면·시트는 라우터·훅·Linking 을 모르므로(FSD 경계), params 파싱·
 * 저장 요청·웹검색 이동·로그인 유도는 이 배선 층에서만 확인된다.
 *
 * 무엇을 보장하나:
 *  - D1~D11 (TRIP-940) 데이터는 **서버 조회 `GET /stays/{stayId}` 하나**에서 온다(01b D0 — 구 I1~I3b 의
 *    "손에 든 `item` JSON param" 계약을 뒤집어 재작성). 응답 전 로딩·404 notFound·400 invalid·
 *    네트워크 error 는 서로 다른 얼굴이고(INV-4), 404·400 은 자동 재시도 없이 바로 뜬다(AC-13).
 *    `item` param 이 와도 읽지 않는다. 전화 줄은 `tel:` 을 연다(AC-3).
 *  - 그 밖의 I·G·F 는 모두 **조회가 끝난 뒤**(`await ready()`) 누른다 — 로딩 얼굴엔 버튼이 없다(AC-4).
 *  - I4 (AC-8 · TRIP-781 AC-1) `stay-detail-book` → 제휴 고지 시트(l07 본문 정확 문구) 마운트.
 *  - I5 (AC-9) 시트 [이동] → 웹검색 URL 로 Linking.openURL(01b Q2 웹검색 폴백).
 *  - I6 (AC-10) 로그인 사용자 `stay-detail-addtotrip` → POST /saved-stays + 거점 편입 안내.
 *  - I7 (AC-10) 게스트 addtotrip → 요청 0 + /(auth)/login push(죽은 버튼 아님, BR-U1-03·55).
 *  - I8 (AC-11) 게스트 하트 → 요청 0 + /(auth)/login push.
 *  - I9~I12 (TRIP-781 AC-7·8) 이동 실패 → error 얼굴·재시도.
 *  - I13~I24 (TRIP-781 AC-9~11 → TRIP-778 AC-10 재작성) "다시 보지 않기"의 저장처가 기기(SecureStore)에서
 *    **서버 `/me/settings.affiliateNoticeDismissed`** 로 바뀌었다(BR-U6-33 계정 단위, 01b 사용자 결정).
 *    읽기 = 로그인일 때 GET, 저장 = 체크 후 [이동]에서 PATCH `{affiliateNoticeDismissed:true}` 한 필드.
 *    응답 전·실패면 고지 쪽으로 쓰러진다(시트를 띄운다). 결론(생략·재진입 유지·재누름)은 781 그대로다.
 *  - G1 (TRIP-778 D9) 게스트는 서버 설정을 조회하지 않고, 시트에 "다시 보지 않기"가 없다(저장할 곳 없는 약속 금지).
 *  - G2 (TRIP-778 D9 · 5-b 경고-1) 캐시에 이전 계정의 `dismissed:true`가 남은 게스트도 시트를 본다.
 *  - F1 (TRIP-778 · 781 "실패 = 고지 쪽" · 5-b 경고-2) 저장·재조회가 모두 실패하면 다시 누를 때 시트가 뜬다.
 *  - F2 (TRIP-778 · 5-b 재리뷰 경고-R1) 첫 GET 부터 실패해 이전 값이 없어도 같다.
 *
 * 인프라: `StaySearchPage.save.integration.test.tsx` 의 msw·tokenManager·expo-router 목을 복제
 * (리포 관례 — 공용화 안 함). expo-linking 은 nextNav.test 패턴으로 목.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 호이스팅 예외 — 이름이 mock 으로 시작해야 한다(기존 통합테스트 관례).
let mockSearchParams: { stayId?: string; item?: string } = {};
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
  },
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
}));

const mockOpenURL = Linking.openURL as jest.Mock;

const BASE = 'http://localhost:8080/api/v1';

const OLD_BR_U1_30 =
  '예약 · 결제는 외부 OTA에서 진행되며, TripPilot은 제휴(어필리에이트) 수수료를 받을 수 있어요.';
// l07 본문(가운뎃점 U+00B7) — 시트 단위 테스트와 같은 리터럴. 둘 중 하나만 바꾸면 통합에서만 red.
const BODY =
  '외부 OTA 사이트로 이동하며, 실제 예약·결제는 해당 사이트에서 진행됩니다.';
const ERROR_TITLE = '링크를 열 수 없습니다';

// openapi `StayDetail` 계약 모양(필수 9 + 선택 4). 진입 카드가 들고 있던 값이 아니라 **서버 응답**이다.
const DETAIL: StayDetail = {
  stayId: 'NAVER:s1',
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean', 'wifi'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
  address: '부산 해운대구 우동 1411-1',
  phone: '051-749-7000',
  rooms: 120,
};
const KEY_A = `${DETAIL.externalSource}:${DETAIL.externalId}`;
/** 상세 조회 요청 한 건의 관측 문자열(`request:start` 의 method + pathname, 02a §5 실측). */
const DETAIL_GET = `GET /api/v1/stays/${KEY_A}`;

/** 유효 진입 params — 진입 4곳이 넘기는 형태(TRIP-940: stayId 하나). */
function validParams(): { stayId?: string; item?: string } {
  return { stayId: KEY_A };
}

let observedHits: string[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

/** `/stays/…` 상세 조회 GET 전부 — 빈 stayId 로 `/stays/` 가 나가도 여기서 센다(AC-8). */
function detailGets(): number {
  return observedHits.filter((hit) => hit.startsWith('GET /api/v1/stays/'))
    .length;
}

// TRIP-778 — 서버 쪽 "다시 보지 않기" 상태. PATCH 가 바꾸고 GET 이 읽는다(상태형 핸들러 — 재진입 왕복 I21).
const SETTINGS_GET = 'GET /api/v1/me/settings';
let serverDismissed = false;
/** 나간 PATCH /me/settings 의 와이어 본문(직렬화 후 파싱) — 순서대로. */
let patchBodies: unknown[] = [];
/** 끝난 요청(`METHOD /path`) — 응답이 도착했는지 기다리는 데 쓴다(02a ★9). */
let endedHits: string[] = [];

/** GET /me/settings 를 서버 상태로 답하고, PATCH 는 본문을 적어 두고 준 필드만 바꾼다. */
function installSettingsServer(): void {
  server.use(
    http.get(`${BASE}/me/settings`, () =>
      HttpResponse.json({ affiliateNoticeDismissed: serverDismissed })
    ),
    http.patch(`${BASE}/me/settings`, async ({ request }) => {
      const body = (await request.json()) as {
        affiliateNoticeDismissed?: boolean | null;
      };
      patchBodies.push(body);
      if (typeof body.affiliateNoticeDismissed === 'boolean') {
        serverDismissed = body.affiliateNoticeDismissed;
      }
      return HttpResponse.json({ affiliateNoticeDismissed: serverDismissed });
    })
  );
}

/** 로그인 사용자 + 서버 저장값. */
function signInWithDismissed(dismissed: boolean): void {
  setAccessToken('valid-access');
  serverDismissed = dismissed;
  installSettingsServer();
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  server.events.on('request:end', ({ request }) => {
    endedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockSearchParams = validParams();
  mockPush.mockClear();
  mockBack.mockClear();
  mockOpenURL.mockClear();
  mockOpenURL.mockResolvedValue(true);
  serverDismissed = false;
  patchBodies = [];
  endedHits = [];
  clearAccessToken();
  // GET /saved-stays 는 항상 등록(게스트에서 잘못 나가도 throw 아니라 hitCount 로 잡히게).
  // GET /stays/:stayId 도 기본 200(DETAIL) — onUnhandledRequest:'error' 라 핸들러가 없으면 AC 가
  // 아니라 준비 단계에서 무너진다(브리프 맹점 ①-a). 개별 테스트가 server.use 로 덮어쓴다.
  server.use(
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${BASE}/stays/:stayId`, () => HttpResponse.json(DETAIL))
  );
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** 조회가 끝나 ready 얼굴(`stay-detail-root`)이 뜰 때까지 기다린다 — 버튼은 그 뒤에만 있다(AC-4). */
function ready() {
  return screen.findByTestId('stay-detail-root');
}

/** 시작한 요청이 모두 끝나고 결과가 화면에 반영될 때까지 흘린다(02a ★5). */
async function settleAll(): Promise<void> {
  await waitFor(() => expect(endedHits).toHaveLength(observedHits.length));
  await act(async () => {});
}

/** 상세 조회를 멈춰 두고, 테스트가 `release()`를 부를 때 `body`로 답한다(로딩 얼굴 관찰용). */
function holdDetail(body: StayDetail = DETAIL): () => void {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get(`${BASE}/stays/:stayId`, async () => {
      await gate;
      return HttpResponse.json(body);
    })
  );
  return () => release();
}

/** 상세 조회가 오류 봉투(`ErrorResponse`)로 답한다 — 404 = 없음, 400 = 형식 오류(openapi). */
function answerDetailWith(status: 400 | 404 | 500): void {
  const code =
    status === 404
      ? 'NOT_FOUND'
      : status === 400
        ? 'VALIDATION_ERROR'
        : 'INTERNAL';
  server.use(
    http.get(`${BASE}/stays/:stayId`, () =>
      HttpResponse.json({ error: { code, message: 'x' } }, { status })
    )
  );
}

describe('D1·D2 · 데이터는 서버 조회 GET /stays/{stayId} 하나에서 (TRIP-940 AC-1 · AC-10 · D0)', () => {
  it('D1 · stayId param 으로 GET /stays/{stayId} 를 정확히 1회 부르고, 응답 값으로 그린다', async () => {
    // 준비: beforeEach — params { stayId: 'NAVER:s1' } · 서버는 DETAIL 로 답한다.
    // 실행
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleAll();

    // 단언: 요청 — 합성 식별자 그대로 경로에 실려 딱 한 번(다른 /stays/… 조회 없음).
    expect(hitCount(DETAIL_GET)).toBe(1);
    expect(detailGets()).toBe(1);
    // 단언: 화면 — 응답 필드가 각 자리에 그려진다.
    expect(screen.getByText(DETAIL.name)).toBeOnTheScreen();
    const priceRow = screen.getByTestId('stay-detail-price-row');
    expect(
      within(priceRow).getByText(formatPrice(DETAIL.price).slice(0, -1))
    ).toBeOnTheScreen();
    expect(within(priceRow).getByText(DETAIL.region)).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-amenity-ocean')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-address')).toHaveTextContent(
      /부산 해운대구 우동 1411-1/
    );
    expect(screen.getByTestId('stay-detail-phone')).toHaveTextContent(
      /051-749-7000/
    );
    expect(screen.getByTestId('stay-detail-rooms')).toHaveTextContent(/120실/);
  });

  it('D2 · item param 이 함께 와도 읽지 않는다 — 로딩 중에도, 응답 뒤에도 카드 이름이 안 보인다', async () => {
    // 준비: 옛 진입처럼 item(JSON)을 실어 보내되 이름을 서버 값과 다르게 둔다(출처 판별용).
    const CARD_NAME = '목록 카드에 있던 이름';
    mockSearchParams = {
      stayId: KEY_A,
      item: JSON.stringify({ ...DETAIL, name: CARD_NAME }),
    };
    const release = holdDetail();

    // 실행 ①: 응답 전.
    render(<StayDetailPage />, { wrapper: createWrapper() });

    // 단언 ①: 로딩 얼굴이고, 목록 값을 placeholder 로 그리지 않는다(사용자 확정 D0).
    expect(await screen.findByTestId('stay-detail-loading')).toBeOnTheScreen();
    expect(screen.queryByText(CARD_NAME)).toBeNull();

    // 실행 ②: 응답 도착.
    release();
    await ready();

    // 단언 ②: 서버 이름만 보인다.
    expect(screen.getByText(DETAIL.name)).toBeOnTheScreen();
    expect(screen.queryByText(CARD_NAME)).toBeNull();
  });
});

describe('D3 · 로딩 얼굴 (TRIP-940 AC-4 · AC-11)', () => {
  it('응답 전에는 로딩 얼굴과 뒤로 버튼만 있고, 하트·예약·일정 추가가 없다', async () => {
    // 준비: 응답을 멈춰 둔다.
    const release = holdDetail();

    // 실행
    render(<StayDetailPage />, { wrapper: createWrapper() });

    // 단언: 로딩 얼굴 + 그 안의 뒤로 버튼.
    const face = await screen.findByTestId('stay-detail-loading');
    expect(within(face).getByTestId('stay-detail-back')).toBeOnTheScreen();
    // 단언: 조회가 끝나기 전엔 저장·예약·일정 추가가 일어날 수 없다(버튼 부재).
    expect(screen.queryByTestId('stay-detail-save')).toBeNull();
    expect(screen.queryByTestId('stay-detail-book')).toBeNull();
    expect(screen.queryByTestId('stay-detail-addtotrip')).toBeNull();

    // 정리: 멈춘 요청을 풀어 준다.
    release();
    await ready();
  });
});

describe('D4·D5 · 404 와 400 은 다른 얼굴이다 (TRIP-940 AC-5 · AC-6 · INV-4)', () => {
  it('D4 · 404 → notFound 얼굴, 재시도 버튼 없음', async () => {
    answerDetailWith(404);

    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(await screen.findByTestId('stay-detail-notfound')).toBeOnTheScreen();
    // 앵커: 얼굴의 근거가 실제 조회 404 다(조회 없이 notFound 를 그리던 구 동작 차단).
    expect(hitCount(DETAIL_GET)).toBe(1);
    expect(screen.queryByTestId('stay-detail-invalid')).toBeNull();
    expect(screen.queryByTestId('stay-detail-error')).toBeNull();
    expect(screen.queryByTestId('stay-detail-retry')).toBeNull();
  });

  it('D5 · 400 → invalid 얼굴(notFound 가 아니다), 재시도 버튼 없음', async () => {
    answerDetailWith(400);

    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(await screen.findByTestId('stay-detail-invalid')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-detail-notfound')).toBeNull();
    expect(screen.queryByTestId('stay-detail-error')).toBeNull();
    expect(screen.queryByTestId('stay-detail-retry')).toBeNull();
  });
});

describe('D6 · 네트워크 오류 → 다시 시도 → 정상 (TRIP-940 AC-7 · INV-4)', () => {
  it.each<[string, () => Response]>([
    [
      '5xx',
      () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'x' } },
          { status: 500 }
        ),
    ],
    ['응답 없음(네트워크 끊김)', () => HttpResponse.error()],
  ])(
    '%s 이면 error 얼굴과 "다시 시도"가 뜨고, 누르면 재조회해 정상 얼굴로 바뀐다',
    async (_label, fail) => {
      // 준비: 첫 조회만 실패, 두 번째는 200.
      let calls = 0;
      server.use(
        http.get(`${BASE}/stays/:stayId`, () => {
          calls += 1;
          return calls === 1 ? fail() : HttpResponse.json(DETAIL);
        })
      );
      render(<StayDetailPage />, { wrapper: createWrapper() });
      const face = await screen.findByTestId('stay-detail-error');
      // 404·400 얼굴로 오접지 않는다(isNotFound 는 네트워크 오류를 false 로 판정).
      expect(screen.queryByTestId('stay-detail-notfound')).toBeNull();
      expect(screen.queryByTestId('stay-detail-invalid')).toBeNull();

      // 실행
      fireEvent.press(within(face).getByTestId('stay-detail-retry'));

      // 단언: 재조회(2회째)가 나가고, 정상 얼굴로 바뀐다.
      await ready();
      expect(screen.getByText(DETAIL.name)).toBeOnTheScreen();
      expect(screen.queryByTestId('stay-detail-error')).toBeNull();
      expect(hitCount(DETAIL_GET)).toBe(2);
    }
  );
});

describe('D7 · stayId 가 없거나 비면 요청 0 · invalid 얼굴 (TRIP-940 AC-8)', () => {
  it.each<[string, { stayId?: string }]>([
    ['param 없음', {}],
    ['빈 문자열', { stayId: '' }],
  ])(
    '%s → /stays/… 조회를 보내지 않고 invalid 얼굴을 그린다',
    async (_label, params) => {
      // 준비: 생성 훅의 enabled 는 null/undefined 만 거른다 — '' 는 `/stays/` 로 새어 나간다(맹점 ①-c).
      mockSearchParams = params;

      // 실행
      render(<StayDetailPage />, { wrapper: createWrapper() });

      // 단언: 끝나지 않는 로딩이 아니라 invalid 얼굴(INV-4).
      expect(
        await screen.findByTestId('stay-detail-invalid')
      ).toBeOnTheScreen();
      await act(async () => {});
      await act(async () => {});
      // 단언: 상세 조회는 한 건도 나가지 않았다(onUnhandledRequest 는 로그만 하므로 직접 센다).
      expect(detailGets()).toBe(0);
    }
  );
});

describe('D8 · 비정상 얼굴의 뒤로 = router.back (TRIP-940 AC-9)', () => {
  it('404 얼굴의 뒤로 버튼을 누르면 router.back() 이 한 번 불린다', async () => {
    answerDetailWith(404);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    const face = await screen.findByTestId('stay-detail-notfound');

    fireEvent.press(within(face).getByTestId('stay-detail-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('D9 · 404·400 은 자동 재시도 없이 바로 (TRIP-940 AC-13 · 맹점 ①-b)', () => {
  // 운영 QueryClient(`src/app/_layout.tsx`)는 기본 재시도 3회다. 테스트 공용 wrapper 는 retry:false 라
  // 이 차이를 못 본다 → 여기서만 **재시도가 켜진** 클라이언트로 돌린다(지연 0 — 켜져 있으면 즉시 4회).
  function retryingWrapper() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: 3, retryDelay: 0, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  it.each([
    [404, 'stay-detail-notfound'],
    [400, 'stay-detail-invalid'],
  ] as const)(
    '%s → 재시도가 켜진 클라이언트에서도 조회는 1회뿐이고 %s 얼굴이 뜬다',
    async (status, face) => {
      answerDetailWith(status);

      render(<StayDetailPage />, { wrapper: retryingWrapper() });

      expect(await screen.findByTestId(face)).toBeOnTheScreen();
      await settleAll();
      expect(hitCount(DETAIL_GET)).toBe(1);
    }
  );
});

describe('D10 · 전화 줄 → tel: (TRIP-940 AC-3 · Q5)', () => {
  it('전화 줄을 누르면 tel:{phone} 을 그대로 연다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-phone'));

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith('tel:051-749-7000')
    );
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });

  it('tel: 열기가 실패해도(전화 앱 없음) 화면은 그대로 남는다', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('no phone app'));
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-phone'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(screen.getByTestId('stay-detail-root')).toBeOnTheScreen();
  });
});

describe('D11 · 정본 실데이터 모양 (TRIP-940 AC-2 · BR-U1-14 · BR-U1-18)', () => {
  it('price null · amenities [] · phone null 이어도 ready 얼굴 — 가격 미확인 · 편의시설 미확인 · 전화 줄 없음', async () => {
    // 준비: LOCALDATA 정본은 가격 null 100%·편의시설 빈 배열 100%·전화 채움률 54.8%(브리프 ③).
    server.use(
      http.get(`${BASE}/stays/:stayId`, () =>
        HttpResponse.json({
          ...DETAIL,
          price: null,
          amenities: [],
          phone: null,
        })
      )
    );

    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    expect(screen.getByText('가격 미확인')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-amenities-empty')).toHaveTextContent(
      /미확인/
    );
    expect(screen.queryByTestId('stay-detail-phone')).toBeNull();
    // 앵커: 이웃 줄은 그대로(얼굴째 사라진 공짜 green 차단).
    expect(screen.getByTestId('stay-detail-rooms')).toHaveTextContent(/120실/);
  });
});

describe('I4·I5 · 예약하기 → 제휴 시트 → 이동 (AC-8 · AC-9)', () => {
  it('I4 · book press → 시트 마운트 + l07 본문 정확 문구, 옛 문장 없음', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.queryByText(OLD_BR_U1_30)).toBeNull();
  });

  it('I5 · 시트 [이동] → 웹검색 URL 로 openURL (01b Q2)', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(`${DETAIL.name} 예약`))
      )
    );
  });
});

describe('I6·I7 · 일정에 추가 (AC-10)', () => {
  it('I6 · 로그인 사용자 → POST /saved-stays + 거점 편입 안내', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json(
          {
            savedStayId: 'new-1',
            name: DETAIL.name,
            coordConfirmed: false,
            registerRoute: 'MAP_SEARCH',
            externalSource: DETAIL.externalSource,
            externalId: DETAIL.externalId,
            lat: DETAIL.lat,
            lng: DETAIL.lng,
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          },
          { status: 201 }
        )
      )
    );
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-addtotrip'));

    await waitFor(() => expect(hitCount('POST /api/v1/saved-stays')).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId('stay-detail-add-notice')).toBeOnTheScreen()
    );
  });

  it('I7 · 게스트 → 요청 0 + /(auth)/login push (죽은 버튼 아님)', async () => {
    clearAccessToken();
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-addtotrip'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});

describe('I8 · 저장 하트 게스트 (AC-11)', () => {
  it('게스트 하트 press → 요청 0 + /(auth)/login push', async () => {
    clearAccessToken();
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-save'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});

// ── TRIP-781 · l07 error 얼굴 · 다시 보지 않기 ─────────────────────────────

/** 다음 openURL 호출을 멈춰 두고, 테스트가 원할 때 성공/실패로 풀 수 있게 한다. 풀기(`settle`)는
 * openURL 이 실제로 불린 뒤에만 채워진다. */
function holdNextOpenURL() {
  const hold: {
    resolve?: (value: boolean) => void;
    reject?: (reason: Error) => void;
  } = {};
  mockOpenURL.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve, reject) => {
        hold.resolve = resolve;
        hold.reject = reject;
      })
  );
  return hold;
}

/** 마운트 때 나간 GET /me/settings 응답이 도착하고 화면에 반영될 때까지 흘린다(02a ★9). */
async function settleSettings(): Promise<void> {
  await waitFor(() =>
    expect(
      endedHits.filter((hit) => hit === SETTINGS_GET).length
    ).toBeGreaterThanOrEqual(1)
  );
  await act(async () => {});
}

async function openErrorFace(): Promise<void> {
  mockOpenURL.mockRejectedValueOnce(new Error('cannot open'));
  fireEvent.press(screen.getByTestId('stay-detail-book'));
  fireEvent.press(screen.getByTestId('stay-ota-confirm'));
  await waitFor(() => expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen());
}

describe('I9~I12 · 이동 실패 → error 얼굴 → 재시도/취소 (TRIP-781 AC-7 · AC-8 · BR-U1-55)', () => {
  it('I9 · openURL 이 실패하면 시트가 닫히지 않고 error 얼굴로 바뀐다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    await openErrorFace();

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-ota-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-ota-confirm')).toBeNull();
  });

  it('I10 · [다시 시도]가 openURL 을 다시 부르고, 성공하면 시트가 닫힌다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await openErrorFace();
    const second = holdNextOpenURL();

    fireEvent.press(screen.getByTestId('stay-ota-retry'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve?.(true);
    });

    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });

  it('I11 · 재시도도 실패하면 error 얼굴에 그대로 남는다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await openErrorFace();
    const second = holdNextOpenURL();

    fireEvent.press(screen.getByTestId('stay-ota-retry'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    // 실패 처리가 끝난 뒤에 본다 — 재시도 직후엔 실패 전이라도 error 제목이 보인다.
    await act(async () => {
      second.reject?.(new Error('still cannot open'));
    });

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(2);
  });

  it('I12 · error 얼굴의 [취소]는 시트를 닫고, 다음 [예약하기]는 default 얼굴에서 시작한다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await openErrorFace();

    fireEvent.press(screen.getByTestId('stay-ota-cancel'));
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.queryByText(ERROR_TITLE)).toBeNull();
  });
});

// ── TRIP-778 · "다시 보지 않기" 저장처 = 서버 /me/settings (AC-10 · D9) ─────────

describe('G1 · 게스트 (TRIP-778 D9)', () => {
  it('게스트는 서버 설정을 조회하지 않고, 시트는 뜨되 "다시 보지 않기"가 없다', async () => {
    // 준비: 게스트(토큰 없음). 핸들러는 걸어 두되 불리면 안 된다.
    installSettingsServer();
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await act(async () => {});

    // 실행
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    // 단언(긍정 앵커): 고지 시트는 뜬다.
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    // 단언: 저장할 곳이 없으니 체크박스를 보이지 않는다.
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
    // 단언: 로그인이 필요한 조회를 보내지 않았다(onUnhandledRequest 는 실패를 로그만 하므로 직접 센다).
    expect(hitCount(SETTINGS_GET)).toBe(0);
  });
});

describe('G2 · 캐시가 남은 게스트 (TRIP-778 D9 · 5-b 경고-1)', () => {
  it('이전 계정의 dismissed:true 가 캐시에 남아 있어도, 게스트는 고지 시트를 본다', async () => {
    // 준비: 세션 만료(토큰만 지워짐 — beforeEach 의 clearAccessToken) + 캐시는 그대로인 상태.
    // gcTime: Infinity — 관찰자가 붙기 전에 캐시가 수거되지 않게(앱 기본 5분과 같은 효과).
    installSettingsServer();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    client.setQueryData(getGetMeSettingsQueryKey(), {
      affiliateNoticeDismissed: true,
    });
    render(<StayDetailPage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await ready();
    await act(async () => {});

    // 실행
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    // 단언: 바로 이동하지 않고 고지 시트가 뜬다.
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).not.toHaveBeenCalled();
    // 단언: 게스트라 체크박스는 없고(D9), 조회도 보내지 않았다(G1 과 같은 계약).
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
    expect(hitCount(SETTINGS_GET)).toBe(0);
  });
});

describe('F1 · 저장 실패는 고지 쪽으로 닫힌다 (TRIP-778 · 5-b 경고-2)', () => {
  it('오프라인 — PATCH 와 재조회 GET 이 모두 실패하면, 다시 눌렀을 때 시트가 또 뜬다', async () => {
    // 준비: 로그인 · 첫 GET 만 dismissed:false 로 성공하고, 그 뒤 GET·PATCH 는 네트워크 오류.
    setAccessToken('valid-access');
    let gets = 0;
    server.use(
      http.get(`${BASE}/me/settings`, () => {
        gets += 1;
        return gets === 1
          ? HttpResponse.json({ affiliateNoticeDismissed: false })
          : HttpResponse.error();
      }),
      http.patch(`${BASE}/me/settings`, async ({ request }) => {
        patchBodies.push(await request.json());
        return HttpResponse.error();
      })
    );
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();

    // 실행 ①: 체크하고 [이동] — 저장 요청이 나가서 실패한다.
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        endedHits.filter((hit) => hit === 'PATCH /api/v1/me/settings')
      ).toHaveLength(1)
    );
    // 실패 뒤에 나간 요청(재조회 등)이 있으면 그것까지 끝나기를 기다린다.
    await act(async () => {});
    await waitFor(() => expect(endedHits).toHaveLength(observedHits.length));
    await act(async () => {});
    expect(patchBodies).toEqual([{ affiliateNoticeDismissed: true }]);

    // 실행 ②: 같은 화면에서 다시 [예약하기].
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    // 단언: 실패한 저장이 "다시 보지 않기"로 남지 않았다 — 시트가 뜨고, 이동은 1번 그대로다.
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });

  it('F2 · 처음부터 오프라인 — 첫 GET 도 실패해 이전 값이 없어도, 다시 눌렀을 때 시트가 또 뜬다', async () => {
    // 준비: 로그인 · GET·PATCH 모두 처음부터 네트워크 오류 — 캐시에 되돌릴 이전 값이 없다.
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/me/settings`, () => HttpResponse.error()),
      http.patch(`${BASE}/me/settings`, async ({ request }) => {
        patchBodies.push(await request.json());
        return HttpResponse.error();
      })
    );
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();

    // 실행 ①: 모르는 상태라 시트가 뜬다 → 체크하고 [이동] — 저장 요청이 나가서 실패한다.
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        endedHits.filter((hit) => hit === 'PATCH /api/v1/me/settings')
      ).toHaveLength(1)
    );
    await act(async () => {});
    await waitFor(() => expect(endedHits).toHaveLength(observedHits.length));
    await act(async () => {});
    expect(patchBodies).toEqual([{ affiliateNoticeDismissed: true }]);

    // 실행 ②: 같은 화면에서 다시 [예약하기].
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    // 단언: 낙관값 true 가 남지 않았다 — 시트가 뜨고, 이동은 1번 그대로다.
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });
});

describe('I13~I16 · "다시 보지 않기" 저장 = PATCH /me/settings (TRIP-778 AC-10 · 781 AC-9 재작성)', () => {
  it('I13 · 체크하고 [이동]을 누르면 {affiliateNoticeDismissed:true} 한 필드를 한 번 보낸다', async () => {
    signInWithDismissed(false);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    expect(screen.getByTestId('stay-ota-dont-show')).toBeChecked();
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    // 단언(완전일치 · 배열): 한 번 · 이 필드만 · 값 방향 true(다시 보지 않음).
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies).toEqual([{ affiliateNoticeDismissed: true }]);
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
  });

  it('I14 · 이동이 실패해도(error 얼굴) 저장 요청은 이미 나갔다 — 이동 결과와 무관', async () => {
    signInWithDismissed(false);
    mockOpenURL.mockRejectedValueOnce(new Error('cannot open'));
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    await waitFor(() =>
      expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen()
    );
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies).toEqual([{ affiliateNoticeDismissed: true }]);
  });

  it('I15 · 체크하고 [취소]하거나, 체크 없이 [이동]하면 저장하지 않는다', async () => {
    signInWithDismissed(false);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();

    // 체크 → 취소.
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-cancel'));
    // 체크 없이 → 이동. openURL 호출이 "핸들러가 실제로 돌았다"는 앵커다.
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(patchBodies).toEqual([]);
  });

  it('I16 · 시트를 다시 열면 체크는 해제 상태로 시작한다', async () => {
    signInWithDismissed(false);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-cancel'));

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByTestId('stay-ota-dont-show')).not.toBeChecked();
  });
});

describe('I17~I21 · 서버 값이 켜져 있으면 시트 생략, 모르면 고지 쪽 (TRIP-778 AC-10 · 781 AC-10·11 재작성)', () => {
  it('I17 · 서버 값 true → [예약하기]가 시트 없이 바로 웹검색을 연다', async () => {
    signInWithDismissed(true);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(`${DETAIL.name} 예약`))
      )
    );
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
    // 앵커: 값은 서버에서 읽었다.
    expect(hitCount(SETTINGS_GET)).toBeGreaterThanOrEqual(1);
  });

  it('I18 · 생략 경로에서 이동이 실패하면 error 얼굴 시트가 뜬다(침묵 금지)', async () => {
    signInWithDismissed(true);
    mockOpenURL.mockRejectedValueOnce(new Error('cannot open'));
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() =>
      expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen()
    );
    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
  });

  it('I19 · 서버 값을 아직 못 받았으면 시트를 띄운다(고지 쪽으로 닫힌 실패)', async () => {
    // 준비: 로그인 + 응답하지 않는 GET.
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/me/settings`, () => new Promise<never>(() => {}))
    );
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await waitFor(() => expect(hitCount(SETTINGS_GET)).toBe(1));

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('I20 · 서버 조회가 실패해도(500) 시트를 띄운다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/me/settings`, () =>
        HttpResponse.json({}, { status: 500 })
      )
    );
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('I21 · 체크하고 이동한 뒤 다시 들어오면 시트 없이 바로 이동한다(PATCH → GET 서버 왕복)', async () => {
    signInWithDismissed(false);
    const first = render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    first.unmount();

    // 재진입 = 새 캐시(createWrapper 가 QueryClient 를 새로 만든다) — 값은 서버에서만 온다.
    endedHits = [];
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });
});

describe('I22~I24 · 같은 화면 재누름·체크 해제 (781 AC-9·10 → TRIP-778 서버 기준)', () => {
  it('I22 · 체크 없이 [이동]한 뒤 같은 화면에서 다시 누르면 고지 시트가 또 뜬다', async () => {
    signInWithDismissed(false);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });

  it('I23 · 체크하고 [이동]한 뒤 같은 화면에서 다시 누르면 시트 없이 바로 이동한다', async () => {
    signInWithDismissed(false);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    await act(async () => {});

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });

  it('I24 · 체크했다 다시 풀고 [이동]하면 저장하지 않고, 다시 들어오면 시트가 뜬다', async () => {
    signInWithDismissed(false);
    const first = render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(patchBodies).toEqual([]);
    first.unmount();

    endedHits = [];
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();
    await settleSettings();
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });
});

// TRIP-989 A-2 — 공유 원 → OS 공유 시트. 딥링크 URL 계약이 없어 숙소 이름만 나른다(장소 상세 선례·01b Q5).
// 진짜 Share.share 는 네이티브 모듈이라 스파이로 막고, 끝에서 원래 함수로 되돌린다.
describe('A-2 · 공유 → Share.share(숙소 이름) (TRIP-989 · INV-4)', () => {
  it('ready 뒤 공유 원을 누르면 Share.share 가 숙소 이름을 message 로 한 번 불린다', async () => {
    const spy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await ready();

    fireEvent.press(screen.getByTestId('stay-detail-share'));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].message).toBe(DETAIL.name);
    spy.mockRestore();
  });
});
