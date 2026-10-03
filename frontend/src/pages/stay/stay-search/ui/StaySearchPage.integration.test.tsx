import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react-native';
import { server } from '@/mocks/server';
import { StaySearchPage } from './StaySearchPage';
import type { StayItem, SavedStay } from '@/shared/api/index.schemas';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { regionPickerHref } from '@/features/explore';
import {
  clearAccessToken,
  setAccessToken,
  getAccessToken,
} from '@/shared/api/tokenManager';
import { PRICE_BUCKETS, type PriceBucketId } from '../model/priceRangeFilter';

/**
 * e02 숙소 검색 — StaySearchPage 배선 통합 테스트(msw 로 실제 나간 요청을 본다).
 *
 * 한 파일로 합친 기록(TRIP-1148): 옛 `StaySearchPage{,.cardNav,.emptyCta,.fab,.filter,.priceFilter,.save,.states}
 * .integration.test.tsx` 8개를 각자의 바깥 describe 하나로 옮겼다. 옛 파일의 상수·헬퍼·beforeEach 는 그 describe
 * 안에 갇혀 서로 안 보인다. 파일 전체에 걸리는 것만 여기 둔다:
 *  - `jest.mock` 두 개(storage·expo-router)는 파일 전체에 걸린다 — 라우터 목은 옛 8개 중 가장 넓은 모양.
 *  - msw listen/close 와 모듈 싱글턴 리셋(토큰·연타 창)은 최상위 훅이 한다 — describe 안에서만 비우면
 *    앞 describe 가 켠 토큰이 뒤 describe 로 새어 "게스트" 전제가 깨진다.
 *  - 옛 `.integration`·`.states` 의 라우터 목에는 `router` 가 없었다. 그 두 관점은 라우터를 부르면 TypeError 로
 *    red 였는데, 합친 목은 router 를 주므로 그 성질을 `expectNoRouterCall` 부재 단언으로 옮겼다.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다. 게스트 여부는 메모리 토큰
// (`getAccessToken`)이 정하므로 저장소 값은 동작에 닿지 않는다(옛 `.fab` 의 null 값 목을 통일, 01b Q3).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려진다 — 팩토리가 참조하는 바깥 변수는 이름이 `mock`으로
// 시작해야 호이스팅 예외를 받는다. 라우터 메서드는 화살표로 감싸 **불릴 때** 목을 읽는다(지연 참조).
let mockSearchParams: {
  region?: string;
  amenity?: string | string[];
  stayType?: string | string[];
} = {};
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
    setParams: (...args: unknown[]) => mockSetParams(...args),
  },
}));

/** 옛 `.integration`·`.states` 의 목은 router 가 없어 어떤 항법이든 TypeError 였다 — 그 그물을 단언으로 옮긴다. */
function expectNoRouterCall(): void {
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockSetParams).not.toHaveBeenCalled();
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockSearchParams = {};
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockSetParams.mockClear();
  // 모듈 싱글턴 — 연타 가드 창·메모리 토큰은 앱 전체에 하나라 describe 사이로 샌다.
  resetPressGuard();
  clearAccessToken();
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

// 옛 StaySearchPage.integration (AC-8)
describe('요청 URL — region 과 부산 폴백 (옛 본 파일)', () => {
  afterEach(expectNoRouterCall);

  /**
   * AC-8 — `StaySearchPage` 배선: `useLocalSearchParams`의 `region`(없으면 `'부산'` 폴백)으로
   * `useStaySearch({ region })`을 호출하고, 그 region이 실제 요청 URL에 실린다.
   *
   * 왜 통합 버킷인가: axios는 params 객체를 어댑터 **안에서** 직렬화하므로, 커스텀 어댑터가
   * 받는 시점엔 아직 객체다 — 직렬화가 끝난 최종 URL은 msw만 관찰할 수 있다
   * (`useStaySearch.integration.test.tsx:20-22` 계승).
   */

  /** authWiring.integration.test.ts:59와 같은 값(리포 관례). */
  const BASE = 'http://localhost:8080/api/v1';

  /** msw가 돌려줄 1건 응답 — 화면까지 실제로 데이터가 흘렀는지 이름으로 확인한다. */
  const FIXTURE = {
    items: [
      {
        externalSource: 'NAVER',
        externalId: 'jeju-1',
        name: '테스트 스테이',
        lat: 33.45,
        lng: 126.57,
        region: 'jeju',
        amenities: ['ocean'],
        stayType: 'HOTEL',
        price: { amount: 50000, currency: 'KRW' },
      },
    ],
    degraded: false,
    filterZeroReasons: [],
  };

  /** 나가는 요청의 최종 URL 전부(직렬화가 끝난 뒤 값 — msw만 이걸 관찰할 수 있다). */
  let observedUrls: string[] = [];

  function onRequestStart({ request }: { request: Request }): void {
    observedUrls.push(request.url);
  }

  beforeAll(() => {
    server.events.on('request:start', onRequestStart);
  });
  afterAll(() => {
    server.events.removeListener('request:start', onRequestStart);
  });

  beforeEach(() => {
    observedUrls = [];
    mockSearchParams = {};
    // 기본 handlers.ts에 stays 핸들러가 0건이므로 매 테스트마다 건다 — afterEach의
    // resetHandlers()가 이전 테스트의 오버라이드를 지우므로 beforeEach에서 다시 건다
    // (useStaySearch.integration.test.tsx:88 사유 동일).
    server.use(
      http.get(`${BASE}/stays/search`, () => HttpResponse.json(FIXTURE))
    );
  });

  /** useBootstrapGate.test.tsx:53 · useStaySearch.integration.test.tsx:139의 것과 동형. */
  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: {
        // gcTime: 0 — 기본값(5분)이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를
        // 300초 붙잡는다(useStaySearch.integration.test.tsx:141-145 실측).
        queries: { retry: false, gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return Wrapper;
  }

  describe('StaySearchPage — region이 요청 URL에 그대로 실린다 (AC-8)', () => {
    it('쿼리 파라미터의 region이 /stays/search 요청 URL에 실리고 응답이 화면까지 흐른다', async () => {
      // 준비 — ASCII 값을 쓴다(한글은 퍼센트 인코딩되어 실패 메시지를 읽을 수 없다,
      // useStaySearch.integration.test.tsx:106 관례).
      mockSearchParams = { region: 'jeju' };

      // 실행
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
      );

      // 단언 — 호출이 정확히 1건 없으면 아래 URL 단언이 "요청이 아예 안 나가서" 공허해진다.
      const hits = observedUrls.filter(
        (raw) => new URL(raw).pathname === '/api/v1/stays/search'
      );
      expect(hits).toHaveLength(1);
      expect(new URL(hits[0]).searchParams.get('region')).toBe('jeju');
    });
  });

  describe('StaySearchPage — region이 없으면 부산으로 떨어진다 (AC-8 폴백)', () => {
    it('useLocalSearchParams가 빈 객체를 주면 region=부산으로 요청이 나간다', async () => {
      mockSearchParams = {};

      render(<StaySearchPage />, { wrapper: createWrapper() });

      // useQuery는 첫 렌더에 data가 undefined다 — 페이지가 data.items로 접근하면 여기서
      // TypeError로 죽는다. `data?.items ?? []` 방어의 유일한 심판이 이 렌더다(Seed §3).
      // 빈 결과 화면 자체(헤더 '부산 · 날짜 미정 · 0곳')는 TRIP-182 범위라 여기서 보지 않는다.
      await waitFor(() => expect(observedUrls.length).toBeGreaterThan(0));

      const hits = observedUrls.filter(
        (raw) => new URL(raw).pathname === '/api/v1/stays/search'
      );
      expect(hits).toHaveLength(1);
      // URL.searchParams.get()이 퍼센트 인코딩을 자동으로 되돌리므로 한글 비교가 성립한다.
      // '부산'은 폴백 계약값 자체라 ASCII로 바꿀 수 없다.
      expect(new URL(hits[0]).searchParams.get('region')).toBe('부산');
    });
  });
});

// 옛 StaySearchPage.cardNav — TRIP-457 AC-5·AC-7, TRIP-1013
describe('카드 → 상세 push (옛 .cardNav)', () => {
  /**
   * TRIP-457 AC-5(배선) — e02 카드 탭이 실제로 상세 라우트 push 로 이어진다는 증거.
   * 화면은 `onPressCard?(item)` 콜백만 올린다(cardPress.test) — 그 콜백이 진짜 `/stays/[stayId]`
   * push(객체형)로 이어지는지는 이 배선 층에서만 확인된다.
   *
   * *(개념·★F-3)* push 는 리포 idiom 인 **객체형**: `router.push({ pathname:'/stays/[stayId]',
   * params:{ stayId } })`(CoPick·MustVisit 선례). `stayId` 는 raw `stayKey`(콜론 포함) —
   * expo-router 가 세그먼트를 자동 인코딩하고 수신측이 자동 디코딩하므로 수동 encodeURIComponent 를
   * 걸지 않는다(이중 인코딩 회피). TRIP-940 부터 load-bearing 은 `stayId` 하나다 — 상세가 그 값으로
   * `GET /stays/{stayId}` 를 부른다(구 `item` JSON param 폐기, 01b D0).
   */

  const BASE = 'http://localhost:8080/api/v1';

  const ITEM_A: StayItem = {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 145000, currency: 'KRW' },
  };
  const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;

  const SEARCH_RESPONSE = {
    items: [ITEM_A],
    degraded: false,
    filterZeroReasons: [],
  };

  beforeEach(() => {
    resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
    mockSearchParams = { region: '해운대' };
    mockPush.mockClear();
    server.use(
      http.get(`${BASE}/stays/search`, () =>
        HttpResponse.json(SEARCH_RESPONSE)
      ),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  /** push 호출 인자 중 상세 라우트로 가는 객체형 push 만 골라낸다. */
  function detailPushes() {
    return mockPush.mock.calls
      .map((call) => call[0])
      .filter(
        (arg): arg is { pathname: string; params: Record<string, unknown> } =>
          typeof arg === 'object' &&
          arg !== null &&
          (arg as { pathname?: string }).pathname === '/stays/[stayId]'
      );
  }

  describe('N1 · 카드 press → 상세 push (AC-5)', () => {
    // TRIP-940 AC-10 재작성 — 상세가 `GET /stays/{stayId}` 로 스스로 조회하므로 item(JSON) 을 싣지
    // 않는다(01b D0). toHaveBeenCalledWith 는 toEqual 과 같은 재귀 비교라 params 에 item 이 남으면 red.
    it('카드를 누르면 stayKey 만 실어 /stays/[stayId] 로 push 한다(item 없음)', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByText(ITEM_A.name)).toBeOnTheScreen()
      );

      fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/stays/[stayId]',
        params: { stayId: KEY_A },
      });
    });
  });

  describe('N2 · 하트 press 는 상세 push 를 삼키지 않는다 (AC-7 배선)', () => {
    it('게스트 하트 press 는 상세 라우트 push 를 0건으로 둔다', async () => {
      // "아직 없다" 앵커 — 게스트 전제. 앞 관점(저장 하트)이 켠 토큰이 새면 여기서 red 다.
      expect(getAccessToken()).toBeNull();
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
        ).toBeOnTheScreen()
      );

      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

      // 상세 라우트로 가는 push 는 없다(로그인 유도 push 는 별개 문자열 인자라 제외된다).
      expect(detailPushes()).toHaveLength(0);
    });
  });
});

// 옛 StaySearchPage.emptyCta — TRIP-416·TRIP-499
describe('빈 결과 CTA 배선 (옛 .emptyCta)', () => {
  /**
   * TRIP-416 AC-1·2·4·5(배선) — e02 빈 상태 카드 CTA 4종이 실제로 라우터를 부른다는 증거.
   * 화면은 라우터·params 를 모르므로(FSD 경계), 카드 버튼 press 가 진짜로 `/explore/region` 진입·
   * 필터 URL 갱신으로 이어지는지는 이 배선 층에서만 확인할 수 있다.
   *
   * 무엇을 보장하나:
   *  - empty "지역 바꾸기" press → `router.push('/explore/region?purpose=stay')`(상단 지역 칩과
   *    같은 목적지, TRIP-499 재배선 — 여행지 선택 정본).
   *  - empty "필터 완화"(적용필터 있음) press → `router.setParams({amenity:[], stayType:[]})`.
   *  - filter-zero "필터 초기화" press → 전체 해제(위와 동일 동작).
   *  - filter-zero "'{원인}' 필터 해제" press → 원인만 뺀 값으로 `setParams`(조식은 남고 오션뷰만 빠짐).
   *  - 나간 params 가 재조회 URL 에 실리는 것은 기존 AC-8/12(.states.integration.test.tsx)가 담보.
   *
   * 인프라(msw·mock·wrapper)는 `StaySearchPage.filter.integration.test.tsx`를 그대로 복제한다
   * (공용화하지 않는 것이 리포 관례). `StaySearchPage.tsx`는 `import { router } from 'expo-router'`
   * 정적 싱글턴을 쓰므로 목이 `router` 객체를 제공해야 한다(useRouter 훅 아님).
   */

  const BASE = 'http://localhost:8080/api/v1';

  /** 0건 + 필터 사유 없음 → empty 상태로 접힌다. */
  const EMPTY_RESPONSE = { items: [], degraded: false, filterZeroReasons: [] };
  /** 0건 + 필터 사유 있음 → filter-zero 상태로 접힌다. */
  const FILTER_ZERO_RESPONSE = {
    items: [],
    degraded: false,
    filterZeroReasons: ['amenity:오션뷰'],
  };

  beforeEach(() => {
    mockSearchParams = { region: 'jeju' };
    mockPush.mockClear();
    mockSetParams.mockClear();
    // handlers.ts 에 /stays/search 핸들러가 없다 — it 안에서 상태별 응답을 덮어쓴다.
    server.use(
      http.get(`${BASE}/stays/search`, () => HttpResponse.json(EMPTY_RESPONSE))
    );
  });

  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  describe('StaySearchPage — empty 지역 바꾸기 (TRIP-499 · AC-4)', () => {
    it('지역 바꾸기 버튼을 누르면 여행지 선택 /explore/region?purpose=stay 로 push 한다', async () => {
      // 준비: 필터 없는 빈 상태.
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen()
      );

      // 실행
      fireEvent.press(screen.getByTestId('stay-search-empty-region'));

      // 단언 — 상단 지역 칩과 같은 목적지. 철자는 공유 헬퍼 출력으로 잠근다(TRIP-989 F 철자 사슬).
      expect(mockPush).toHaveBeenCalledWith(regionPickerHref('stay'));
    });
  });

  describe('StaySearchPage — empty 필터 완화 (AC-2)', () => {
    it('적용필터가 있을 때 필터 완화 버튼을 누르면 전체 해제로 setParams 한다', async () => {
      // 준비: amenity 가 걸린 빈 상태(→ activeFilterCount 1, 버튼 노출).
      mockSearchParams = { region: 'jeju', amenity: '조식' };
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen()
      );

      // 실행
      fireEvent.press(screen.getByTestId('stay-search-empty-filter'));

      // 단언: amenity/stayType 두 키만 비운다(region 은 merge 로 유지 — 넣지 않는다).
      expect(mockSetParams).toHaveBeenCalledWith({ amenity: [], stayType: [] });
    });
  });

  describe('StaySearchPage — filter-zero 필터 초기화 (AC-4)', () => {
    it('필터 초기화 버튼을 누르면 전체 해제로 setParams 한다', async () => {
      // 준비: 원인이 있는 filter-zero 상태.
      mockSearchParams = { region: 'jeju', amenity: '오션뷰' };
      server.use(
        http.get(`${BASE}/stays/search`, () =>
          HttpResponse.json(FILTER_ZERO_RESPONSE)
        )
      );
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('stay-search-filterzero')).toBeOnTheScreen()
      );

      // 실행
      fireEvent.press(screen.getByTestId('stay-search-filterzero-reset'));

      // 단언
      expect(mockSetParams).toHaveBeenCalledWith({ amenity: [], stayType: [] });
    });
  });

  describe('StaySearchPage — filter-zero 원인 필터만 해제 (AC-5)', () => {
    it('원인 필터 해제 버튼을 누르면 원인(오션뷰)만 빠지고 나머지(조식)는 남는다', async () => {
      // 준비: 원인(오션뷰)과 무관한 조식이 함께 걸린 filter-zero 상태.
      mockSearchParams = { region: 'jeju', amenity: ['오션뷰', '조식'] };
      server.use(
        http.get(`${BASE}/stays/search`, () =>
          HttpResponse.json(FILTER_ZERO_RESPONSE)
        )
      );
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('stay-search-filterzero')).toBeOnTheScreen()
      );

      // 실행
      fireEvent.press(screen.getByTestId('stay-search-filterzero-clear'));

      // 단언: filterZeroReasons[0]='amenity:오션뷰' → amenity 에서 오션뷰만 제거, 조식 유지.
      expect(mockSetParams).toHaveBeenCalledWith({
        amenity: ['조식'],
        stayType: [],
      });
    });
  });
});

// 옛 StaySearchPage.fab — TRIP-725
describe('2단 FAB 목적지 (옛 .fab)', () => {
  /**
   * TRIP-725 AC-8 (배선) — e02 우하단 2단 원형 FAB 이 실제로 목적지 라우트로 push 되는 증거.
   * 화면은 라우터를 모르므로(FSD 경계), FAB press 가 흰 하트→`/stays/saved`·＋→`/stays/register`로
   * 이어지는지는 이 배선 층(페이지)에서만 확인할 수 있다(현재 e02 FAB 목적지 통합 심판이 0 —
   * traps-stay). 알약 "여행 만들기"→`/trips/new/step1` 배선은 폐기된다.
   *
   * 인프라: `StaySearchPage.save.integration.test.tsx` 의 expo-router 목(mockPush)·MSW·
   * QueryClientProvider 래퍼를 복제한다(공용화 안 함 — 리포 관례). FAB press 는 인증과 무관하므로
   * 게스트(토큰 미설정)로 돌린다(담은 목록 GET 은 안 나간다).
   */

  const BASE = 'http://localhost:8080/api/v1';

  const ITEM: StayItem = {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 120000, currency: 'KRW' },
  };

  const SEARCH_RESPONSE = {
    items: [ITEM],
    degraded: false,
    filterZeroReasons: [],
  };

  beforeEach(() => {
    mockSearchParams = { region: '부산' };
    mockPush.mockClear();
    clearAccessToken();
    server.use(
      http.get(`${BASE}/stays/search`, () =>
        HttpResponse.json(SEARCH_RESPONSE)
      ),
      // 게스트라 담은 목록 조회는 안 나가지만, onUnhandledRequest:'error' 방어로 등록해 둔다.
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  describe('AC-8 · e02 2단 FAB 목적지 배선 (TRIP-725)', () => {
    it('흰 하트 FAB press → router.push("/stays/saved")', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });

      // FAB 은 데이터와 무관한 absolute 오버레이라 즉시 뜬다.
      const saved = await screen.findByTestId('stay-search-fab-saved');
      fireEvent.press(saved);

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/stays/saved')
      );
    });

    it('분홍 ＋ FAB press → router.push("/stays/register")', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });

      const register = await screen.findByTestId('stay-search-fab-register');
      fireEvent.press(register);

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/stays/register')
      );
    });
  });
});

// 옛 StaySearchPage.filter — TRIP-415·TRIP-499
describe('지역 칩·필터 시트 (옛 .filter)', () => {
  /**
   * TRIP-415 — 지역·필터 칩 배선(page 몫). 화면은 라우터·시트를 모르므로, 칩 press 가 실제로
   * 라우팅·시트 열기·필터 적용으로 이어지는지는 이 배선 층에서만 확인할 수 있다.
   *
   * 무엇을 보장하나:
   *  - 지역 칩 press → `/explore/region?purpose=stay` 진입(여행지 선택 정본, TRIP-499 재배선 —
   *    통합검색 대신 지역 선택 화면 재사용).
   *  - 필터 칩 press → 시트 열림(`stay-filter-sheet`), 옵션 토글 → [적용] → 고른 조건이
   *    `router.setParams`로 나간다(그 params 가 재조회 URL 에 실리는 것은 기존 AC-8/12 가 담보).
   *
   * 인프라(msw·mock·wrapper)는 기존 `StaySearchPage.integration.test.tsx`와 동형.
   */

  const BASE = 'http://localhost:8080/api/v1';

  const FIXTURE = {
    items: [
      {
        externalSource: 'NAVER',
        externalId: 'jeju-1',
        name: '테스트 스테이',
        lat: 33.45,
        lng: 126.57,
        region: 'jeju',
        amenities: ['ocean'],
        stayType: 'HOTEL',
        price: { amount: 50000, currency: 'KRW' },
      },
    ],
    degraded: false,
    filterZeroReasons: [],
  };

  beforeEach(() => {
    mockSearchParams = { region: 'jeju' };
    mockPush.mockClear();
    mockSetParams.mockClear();
    server.use(
      http.get(`${BASE}/stays/search`, () => HttpResponse.json(FIXTURE))
    );
  });

  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  describe('StaySearchPage — 지역 칩 (TRIP-499 · AC-3)', () => {
    it('지역 칩을 누르면 여행지 선택 /explore/region?purpose=stay 로 간다', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
      );

      fireEvent.press(screen.getByTestId('stay-search-filter-region'));

      // 철자는 공유 헬퍼 출력으로 잠근다(TRIP-989 F — 985 철자 사슬의 stay 고리). 완전 일치라 stay↔trip 오타도 잡는다.
      expect(mockPush).toHaveBeenCalledWith(regionPickerHref('stay'));
    });
  });

  describe('StaySearchPage — 필터 시트 (TRIP-415)', () => {
    it('필터 칩 → 시트 열림 → 옵션 토글 → 적용 시 그 조건이 setParams 로 나간다', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
      );

      // 필터 칩 → 시트 열림(gorhom 목이 children 을 무조건 렌더하므로, 시트 컴포넌트가
      // 마운트됐는지=페이지가 열었는지로 관찰한다).
      fireEvent.press(screen.getByTestId('stay-search-filter-more'));
      expect(screen.getByTestId('stay-filter-sheet')).toBeOnTheScreen();

      // 결과 facet 두 축(편의시설 ocean·숙소유형 HOTEL)을 골라 적용 → 두 축 모두 setParams 로
      // 나간다. amenity 만 보면 stayType 배선을 지우거나 오배선해도 통과한다(code-critic W-1).
      fireEvent.press(screen.getByTestId('stay-filter-amenity-ocean'));
      fireEvent.press(screen.getByTestId('stay-filter-staytype-HOTEL'));
      fireEvent.press(screen.getByTestId('stay-filter-apply'));

      expect(mockSetParams).toHaveBeenCalledTimes(1);
      expect(mockSetParams.mock.calls[0][0]).toEqual(
        expect.objectContaining({ amenity: ['ocean'], stayType: ['HOTEL'] })
      );

      // 적용하면 시트가 닫힌다(setSheetOpen(false) — 안 닫으면 이 단언이 red, code-critic N-1).
      expect(screen.queryByTestId('stay-filter-sheet')).toBeNull();
    });

    it('URL 에 이미 필터가 걸려 있으면 "필터" 칩 배지가 적용값 개수를 보인다', async () => {
      // 이미 amenity=ocean 이 적용된 상태로 진입 — 배지는 초안(마운트 시 [])이 아니라
      // 적용값(params)에서 나와야 "1"이다(code-critic W-2 — 초안에서 뽑으면 0으로 거짓말).
      mockSearchParams = { region: 'jeju', amenity: 'ocean' };

      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
      );

      expect(screen.getByTestId('stay-search-filter-more')).toHaveTextContent(
        /1/
      );
    });
  });
});

// 옛 StaySearchPage.priceFilter — TRIP-457·TRIP-1019·TRIP-989
describe('가격대 필터 (옛 .priceFilter)', () => {
  /**
   * TRIP-457 AC-12·AC-13 — e02 가격대 칩 "복구"(01b Q4 (a) 클라이언트 가격대 필터).
   *
   * 무엇을 보장하나: 현재 `handlePressFilter` 에 `axis==='price'` 분기가 **아예 없어** 가격대 칩이
   * 무동작이다(이 티켓이 고치는 결함). 복구 후 가격대 칩 → 가격대 시트 열림 → 버킷 선택 → 페이지가
   * `priceRangeFilter` 로 `items` 를 파생 필터해 화면 목록이 좁혀진다. 지역 칩·필터 시트 기존 배선은
   * 무회귀(AC-13).
   *
   * *(개념·★F-11)* gorhom 목이 통과 컴포넌트라 실제 시트 열림은 무심판 — "페이지가 시트를
   * 마운트했나(testID present)"·"목록이 실제로 좁혀졌나"만 잰다. 실 슬라이드/딤은 6-b 실기.
   */

  const BASE = 'http://localhost:8080/api/v1';

  const CHEAP: StayItem = {
    externalSource: 'NAVER',
    externalId: 'cheap',
    name: '게스트하우스 알뜰',
    lat: 35.1,
    lng: 129.1,
    region: '부산',
    amenities: [],
    stayType: 'GUESTHOUSE',
    price: { amount: 50000, currency: 'KRW' },
  };
  const LUX: StayItem = {
    externalSource: 'NAVER',
    externalId: 'lux',
    name: '오션 스위트',
    lat: 35.2,
    lng: 129.2,
    region: '부산',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 250000, currency: 'KRW' },
  };
  const KEY_CHEAP = `${CHEAP.externalSource}:${CHEAP.externalId}`;
  const KEY_LUX = `${LUX.externalSource}:${LUX.externalId}`;

  const SEARCH_RESPONSE = {
    items: [CHEAP, LUX],
    degraded: false,
    filterZeroReasons: [],
  };

  beforeEach(() => {
    mockSearchParams = { region: '부산' };
    mockPush.mockClear();
    server.use(
      http.get(`${BASE}/stays/search`, () =>
        HttpResponse.json(SEARCH_RESPONSE)
      ),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  describe('PF1·PF2 · 가격대 칩 복구 (AC-12)', () => {
    it('가격대 칩 → 시트 열림 → over-200k 선택 → 저가 카드가 사라진다', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByTestId(`stay-card-${KEY_CHEAP}`)).toBeOnTheScreen();
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen();
      });

      // 무동작 아님 — 가격대 시트가 열린다(이 티켓이 고치는 결함).
      fireEvent.press(screen.getByTestId('stay-search-filter-price'));
      expect(screen.getByTestId('stay-price-sheet')).toBeOnTheScreen();

      // over-200k 선택 → 목록이 파생 필터된다(50k 게스트하우스가 빠지고 250k 만 남는다).
      fireEvent.press(screen.getByTestId('stay-price-option-over-200k'));

      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`stay-card-${KEY_CHEAP}`)).toBeNull();
    });
  });

  describe('PF3 · 지역 칩 무회귀 (TRIP-499 · AC-3)', () => {
    it('지역 칩은 여행지 선택 /explore/region?purpose=stay 로 간다', async () => {
      // AC-3 본체(filter.integration)와 같은 소스 push 사이트(StaySearchPage.tsx:109)를 누른다 —
      // 그 사이트가 하나뿐이라, 여기 목적지를 갱신하지 않으면 구현이 이 파일을 영구 red 로 만든다.
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
      );

      fireEvent.press(screen.getByTestId('stay-search-filter-region'));

      // 철자는 공유 헬퍼 출력으로 잠근다(TRIP-989 F — 985 철자 사슬의 stay 고리).
      expect(mockPush).toHaveBeenCalledWith(regionPickerHref('stay'));
    });
  });

  // ── TRIP-989 E · Q4 ─────────────────────────────────────────────────────────────────────
  // 가격대는 서버 파라미터가 없어 클라이언트에서만 거른다(BR-U1-15, priceRangeFilter). 그래서 가격 때문에
  // 0곳이 되면 서버 filterZeroReasons 가 비어 **empty** 얼굴이 된다 — 사용자가 보는 탈출구는 "필터 완화"다
  // (02a ★4). 표본 버킷은 5만·25만 두 장을 다 빼는 100k-200k 다(★5).

  /** 0건 + 필터 사유 있음 → filter-zero(가격이 아니라 amenity 가 원인). */
  const FILTER_ZERO_RESPONSE = {
    items: [],
    degraded: false,
    filterZeroReasons: ['amenity:오션뷰'],
  };

  function priceChip() {
    return screen.getByTestId('stay-search-filter-price');
  }

  function bucketLabel(id: PriceBucketId): string {
    const label = PRICE_BUCKETS.find((bucket) => bucket.id === id)?.label;
    if (!label) throw new Error(`PRICE_BUCKETS 에 ${id} 가 없다`);
    return label;
  }

  /** 가격대 칩 → 시트 → 버킷 선택. 고르는 순간 시트가 닫힌다(TRIP-1019 Q1) — 칩 라벨은 `within(priceChip())`
   * 로만 읽는다(시트가 열려 있던 시절엔 같은 라벨이 두 곳에 떴다, ★6). */
  function applyPrice(id: PriceBucketId): void {
    fireEvent.press(priceChip());
    fireEvent.press(screen.getByTestId(`stay-price-option-${id}`));
  }

  /** 가격대 칩이 "안 걸린" 얼굴인가 — 선택 아님 + 라벨 "가격대". */
  function expectPriceCleared(): void {
    expect(priceChip()).not.toBeSelected();
    expect(within(priceChip()).getByText('가격대')).toBeOnTheScreen();
  }

  // TRIP-1019 #013(결정 3) — "필터 N" 배지는 **필터 시트에서 고른 것**(편의시설·숙소 유형)만 센다. 가격대는
  // 자기 칩이 이미 버킷 이름·선택 얼굴로 드러나므로 배지에서 뺀다(TRIP-989 Q1 "가격도 1로 센다"를 뒤집는다).
  // ★ 짝(필수): 배지에서 가격을 빼도 empty 카드 "필터 완화"는 가격이 걸려 있으면 **켜져 있어야** 한다 —
  // 같은 숫자 하나로 두 일을 하던 자리라(브리프 맹점 ③), 배지 숫자만 줄이면 가격 때문에 0곳이 된 사용자가
  // 갇힌다(INV-4, E-3). 구 E-2("배지 1")를 지우지 않고 새 계약으로 옮겼다.
  describe('E-2 · 가격대는 "필터" 배지에 세지 않되, 0곳의 "필터 완화"는 켠다 (TRIP-1019 #013 · BR-U1-16 · INV-4)', () => {
    it('가격대만 걸면 "필터" 배지에 숫자가 없고, 0곳 카드의 "필터 완화"는 켜져 있다', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
      );
      // 준비 확인: 아무 필터도 없으면 배지 숫자가 없다.
      expect(
        screen.getByTestId('stay-search-filter-more')
      ).not.toHaveTextContent(/\d/);

      applyPrice('100k-200k');

      // 앵커: 가격이 실제로 걸려 0곳이 됐다(가격이 안 걸려서 배지가 비는 공허 통과 방지).
      expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen();
      expect(priceChip()).toBeSelected();
      expect(
        within(priceChip()).getByText(bucketLabel('100k-200k'))
      ).toBeOnTheScreen();
      // 금지: 배지에 가격이 세지지 않는다.
      expect(
        screen.getByTestId('stay-search-filter-more')
      ).not.toHaveTextContent(/\d/);
      // 짝: 탈출구는 켜져 있다.
      expect(screen.getByTestId('stay-search-empty-filter')).not.toBeDisabled();
    });

    it('편의시설 1개 + 가격대를 걸면 배지는 1이다(가격은 세지 않는다)', async () => {
      mockSearchParams = { region: '부산', amenity: '오션뷰' };
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
      );
      // 준비 확인: 편의시설 하나만 걸린 배지는 1이다.
      expect(screen.getByTestId('stay-search-filter-more')).toHaveTextContent(
        /1/
      );

      applyPrice('over-200k');

      // 앵커: 가격이 걸려 25만 카드만 남았다.
      expect(priceChip()).toBeSelected();
      expect(screen.queryByTestId(`stay-card-${KEY_CHEAP}`)).toBeNull();
      // 배지는 여전히 1 — 2 가 아니다.
      expect(screen.getByTestId('stay-search-filter-more')).toHaveTextContent(
        /1/
      );
      expect(
        screen.getByTestId('stay-search-filter-more')
      ).not.toHaveTextContent(/2/);
    });
  });

  // TRIP-1019 #013 · 01b Q1 — "적용" 버튼이 없어졌으니 옵션을 고르는 것이 곧 끝이다. 고르면 적용과 함께 시트가
  // 닫힌다. gorhom 목은 통과형이라 "시트가 화면에서 내려갔는가"는 못 본다 — 페이지가 시트를 **내렸는가**
  // (마운트 해제)까지만 잰다. 실제 슬라이드 닫힘은 6-b.
  describe('PF-close · 옵션을 고르면 적용과 함께 시트가 닫힌다 (TRIP-1019 #013 · 01b Q1)', () => {
    it('over-200k 를 누르면 목록이 좁혀지고, 가격대 시트가 사라진다', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
      );
      fireEvent.press(priceChip());
      // 앵커: 시트가 열렸다(처음부터 없어서 통과하는 부재 단언 방지).
      expect(screen.getByTestId('stay-price-sheet')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('stay-price-option-over-200k'));

      // 적용됐다.
      expect(screen.queryByTestId(`stay-card-${KEY_CHEAP}`)).toBeNull();
      expect(priceChip()).toBeSelected();
      // 닫혔다.
      expect(screen.queryByTestId('stay-price-sheet')).toBeNull();
    });
  });

  describe('E-3 · 가격 때문에 0곳 → "필터 완화"로 빠져나온다 (TRIP-989 · 01b E · INV-4)', () => {
    it('empty "필터 완화"를 누르면 가격대가 풀리고 두 카드가 다시 보인다', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
      );
      applyPrice('100k-200k');
      expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('stay-search-empty-filter'));

      expect(screen.getByTestId(`stay-card-${KEY_CHEAP}`)).toBeOnTheScreen();
      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen();
      expectPriceCleared();
    });

    it('filter-zero "필터 초기화"도 가격대까지 푼다', async () => {
      mockSearchParams = { region: '부산', amenity: '오션뷰' };
      server.use(
        http.get(`${BASE}/stays/search`, () =>
          HttpResponse.json(FILTER_ZERO_RESPONSE)
        )
      );
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('stay-search-filterzero')).toBeOnTheScreen()
      );
      applyPrice('over-200k');
      expect(priceChip()).toBeSelected();

      fireEvent.press(screen.getByTestId('stay-search-filterzero-reset'));

      expectPriceCleared();
    });
  });

  // Q4 — 지역 선택이 dismissTo 로 **같은 결과 화면 인스턴스**에 돌아오므로(F), 로컬 state 인 가격대·
  // 검색어가 남는다. params 목을 바꿔 rerender 해 그 순간을 흉내 낸다(02a ★7).
  describe('Q4 · 지역이 바뀌면 가격대·검색어를 비운다 (TRIP-989 F · 01b Q4)', () => {
    it('다른 지역으로 돌아오면 가격대 칩이 풀리고 검색창이 빈다', async () => {
      const { rerender } = render(<StaySearchPage />, {
        wrapper: createWrapper(),
      });
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
      );
      applyPrice('over-200k');
      fireEvent.changeText(
        screen.getByTestId('stay-search-name-input'),
        '오션'
      );
      expect(priceChip()).toBeSelected();

      mockSearchParams = { region: '무주' };
      rerender(<StaySearchPage />);

      expectPriceCleared();
      expect(screen.getByTestId('stay-search-name-input')).toHaveDisplayValue(
        ''
      );
    });

    it('짝: 지역은 그대로이고 다른 조건만 바뀌면 가격대·검색어가 남는다', async () => {
      const { rerender } = render(<StaySearchPage />, {
        wrapper: createWrapper(),
      });
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
      );
      applyPrice('over-200k');
      fireEvent.changeText(
        screen.getByTestId('stay-search-name-input'),
        '오션'
      );
      expect(priceChip()).toBeSelected();

      mockSearchParams = { region: '부산', amenity: '오션뷰' };
      rerender(<StaySearchPage />);

      expect(priceChip()).toBeSelected();
      expect(
        within(priceChip()).getByText(bucketLabel('over-200k'))
      ).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-name-input')).toHaveDisplayValue(
        '오션'
      );
    });
  });
});

// 옛 StaySearchPage.save — TRIP-417
describe('저장 하트 (옛 .save)', () => {
  /**
   * TRIP-417 AC-1·AC-2·AC-3·AC-7·AC-8 (배선) — e02 카드 하트가 실제로 서버 요청·라우팅에 이어진다는 증거.
   * 화면은 라우터·훅을 모르므로(FSD 경계), 하트 press가 진짜로 `POST/DELETE /saved-stays`·초기 채움·
   * 미인증 로그인 이동으로 이어지는지는 이 배선 층에서만 확인할 수 있다.
   *
   * 무엇을 보장하나:
   *  - **P1 (AC-1)** 미담김 하트 press → `POST /saved-stays`가 **buildSaveStayRequest 본문**(MAP_SEARCH·
   *    좌표 보유 시 coordConfirmed:true, TRIP-600)으로 나가고, 응답 전 낙관적으로 찬 하트가 되며, 성공 후 담은 목록을 다시 받는다.
   *  - **P2 (AC-2)** 담김 하트 press → 매칭 **savedStayId**로 `DELETE /saved-stays/{id}`가 나간다(externalId 아님).
   *  - **P3 (AC-3)** 진입 시 `GET /saved-stays`와 externalSource+externalId로 매칭해 초기 채움을 그린다
   *    (외부키 null인 핀·수동 저장은 무시).
   *  - **P4 (AC-7)** 게스트는 `GET /saved-stays`·`POST` 0건이고, 누름은 `router.push('/(auth)/login')`로 간다.
   *  - **P5 (AC-8)** 응답 대기 중 재누름해도 `POST`는 1건뿐(연타 중복 요청 없음).
   *
   * 인프라: `StaySearchPage.emptyCta.integration.test.tsx`의 expo-router 목 + `savedPlaces.integration.test.tsx`의
   * observedHits/POST 본문 관찰을 복제(공용화 안 함 — 리포 관례). 인증은 `@/shared/api/tokenManager`의
   * set/clear로 구동(`getAccessToken() !== null`을 렌더 시점 읽는 PlaceExplorePage seam).
   */

  const BASE = 'http://localhost:8080/api/v1';

  /** 검색결과 카드 2건(A·B). */
  const ITEM_A: StayItem = {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 30000, currency: 'KRW' },
  };
  const ITEM_B: StayItem = {
    externalSource: 'NAVER',
    externalId: 's2',
    name: '서면 시티 호텔',
    lat: 35.1577,
    lng: 129.0594,
    region: '서면',
    amenities: ['wifi'],
    stayType: 'HOTEL',
    price: { amount: 10000, currency: 'KRW' },
  };
  const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;
  const KEY_B = `${ITEM_B.externalSource}:${ITEM_B.externalId}`;

  const SEARCH_RESPONSE = {
    items: [ITEM_A, ITEM_B],
    degraded: false,
    filterZeroReasons: [],
  };

  const SAVED_ID_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

  /** buildSaveStayRequest(ITEM_A)가 내야 할 본문 — 정본 결정(MAP_SEARCH·좌표 보유 시 coordConfirmed:true,
   * TRIP-600 INV-U1-08 재정의)을 이 배선 층에서 리터럴로 한 번 더 못 박는다(순수 함수 단위 테스트 U9와 별개로 실배선 확인). */
  const EXPECTED_POST_A = {
    name: '해운대 그랜드 호텔',
    registerRoute: 'MAP_SEARCH',
    coordConfirmed: true,
    externalSource: 'NAVER',
    externalId: 's1',
    lat: 35.1587,
    lng: 129.1604,
  };

  /** openapi SavedStay.required + 외부키를 채운 서버 담기 기록. */
  function savedFrom(item: StayItem, savedStayId: string): SavedStay {
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

  function createGate() {
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { opened, release };
  }

  let observedHits: string[] = [];
  let postedBodies: unknown[] = [];

  function hitCount(needle: string): number {
    return observedHits.filter((hit) => hit === needle).length;
  }

  function onRequestStart({ request }: { request: Request }): void {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  }

  beforeAll(() => {
    server.events.on('request:start', onRequestStart);
  });
  afterAll(() => {
    server.events.removeListener('request:start', onRequestStart);
  });

  beforeEach(() => {
    observedHits = [];
    postedBodies = [];
    mockSearchParams = { region: '부산' };
    mockPush.mockClear();
    clearAccessToken();
    // GET /saved-stays는 항상 등록해 둔다 — 게스트에서 잘못 나가면 throw가 아니라 hitCount로
    // 잡히게(P4의 "0건"이 깨끗한 red가 되도록).
    server.use(
      http.get(`${BASE}/stays/search`, () =>
        HttpResponse.json(SEARCH_RESPONSE)
      ),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

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

  describe('P1 · 담기 — POST 본문·낙관·무효화 (AC-1)', () => {
    it('미담김 하트 press → buildSaveStayRequest 본문으로 POST + 낙관적 찬 하트 + 성공 후 재조회', async () => {
      // 준비 — 로그인 + 담은 목록 비어 있음. POST 응답은 문 뒤에 세운다.
      setAccessToken('valid-access');
      const gate = createGate();
      server.use(
        http.post(`${BASE}/saved-stays`, async ({ request }) => {
          postedBodies.push(await request.json());
          await gate.opened;
          return HttpResponse.json(savedFrom(ITEM_A, NEW_SAVED_ID), {
            status: 201,
          });
        })
      );
      render(<StaySearchPage />, { wrapper: createWrapper() });
      // 카드 A의 빈 하트가 뜰 때까지 기다린다(GET 두 건 도착).
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
        ).toBeOnTheScreen()
      );

      // 실행 — 하트 A press.
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

      // 단언 ① — POST가 정확한 본문으로 나갔다(MAP_SEARCH·좌표 보유 시 coordConfirmed:true 실배선, TRIP-600).
      await waitFor(() => expect(postedBodies).toHaveLength(1));
      expect(postedBodies[0]).toEqual(EXPECTED_POST_A);

      // 단언 ② — 응답 전(문 닫힘)에 이미 찬 하트다(낙관).
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
        ).toBeOnTheScreen()
      );
      expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeSelected();

      // 실행 ② — 문 열기 → 성공 → 담은 목록 무효화.
      gate.release();
      await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
    });
  });

  describe('P2 · 해제 — savedStayId로 DELETE (AC-2)', () => {
    it('담김 하트 press → 매칭 savedStayId로 DELETE (externalId·key 경로 아님) + 낙관 빈 하트', async () => {
      // 준비 — 로그인 + A가 이미 담김. DELETE 응답을 문 뒤에 세운다(P1·P5의 POST 게이트와 동형).
      // 게이트가 필요한 이유: 해제 성공은 담은 목록을 무효화(refetch)하는데, 이 GET 목은 상태를
      // 지니지 않아 재조회에 다시 [A 담김]을 돌려준다 → 낙관 빈 하트가 즉시 찬 하트로 되돌아간다.
      // 그래서 응답 전(문 닫힘) transient 시점에 빈 하트를 결정론적으로 관찰한다.
      setAccessToken('valid-access');
      const gate = createGate();
      server.use(
        http.get(`${BASE}/saved-stays`, () =>
          HttpResponse.json([savedFrom(ITEM_A, SAVED_ID_A)])
        ),
        http.delete(`${BASE}/saved-stays/:savedStayId`, async () => {
          await gate.opened;
          return new HttpResponse(null, { status: 204 });
        })
      );
      render(<StaySearchPage />, { wrapper: createWrapper() });
      // 초기 채움(AC-3 겸) — A가 찬 하트로 뜬다.
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
        ).toBeOnTheScreen()
      );

      // 실행 — 하트 A press.
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

      // 단언 ① — 담기 기록 id로 나갔다(요청은 문 뒤 대기 중이지만 request:start로 관찰된다).
      await waitFor(() =>
        expect(hitCount(`DELETE /api/v1/saved-stays/${SAVED_ID_A}`)).toBe(1)
      );
      // 단언 ② (부정 짝) — externalId·key를 그대로 경로에 넣지 않았다.
      expect(hitCount(`DELETE /api/v1/saved-stays/${ITEM_A.externalId}`)).toBe(
        0
      );
      expect(hitCount(`DELETE /api/v1/saved-stays/${KEY_A}`)).toBe(0);
      // 단언 ③ — 응답 전(문 닫힘)에 이미 낙관적으로 빈 하트다. 무효화가 아직 안 돌아 되돌림이 없다.
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
        ).toBeOnTheScreen()
      );

      // 정리 — 문 열기 → 해제 성공 → 담은 목록 무효화(재요청)로 대기 중 요청을 매듭짓는다.
      gate.release();
      await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
    });
  });

  describe('P3 · 초기 채움 매칭키 (AC-3)', () => {
    it('externalSource+externalId로 매칭해 A만 찬 하트이고, 외부키 null 저장은 무시된다', async () => {
      // 준비 — A는 담김, 그리고 핀·수동 등록(외부키 null)도 하나 있음.
      setAccessToken('valid-access');
      const pinSaved: SavedStay = {
        savedStayId: 'pin-1',
        name: '직접 등록한 숙소',
        coordConfirmed: true,
        linkedTripIds: [],
        registerRoute: 'PIN',
        externalSource: null,
        externalId: null,
        lat: 35.1,
        lng: 129.0,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
      };
      server.use(
        http.get(`${BASE}/saved-stays`, () =>
          HttpResponse.json([savedFrom(ITEM_A, SAVED_ID_A), pinSaved])
        )
      );
      render(<StaySearchPage />, { wrapper: createWrapper() });

      // 단언 — A는 찬 하트+selected, B는 빈 하트+not selected(핀 저장은 어느 카드와도 매칭 안 됨).
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
        ).toBeOnTheScreen()
      );
      expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeSelected();
      expect(
        screen.getByTestId(`stay-card-save-${KEY_B}-outline`)
      ).toBeOnTheScreen();
      expect(screen.getByTestId(`stay-card-save-${KEY_B}`)).not.toBeSelected();
    });
  });

  describe('P4 · 미인증 — 요청 미전송 + 로그인 이동 (AC-7)', () => {
    it('게스트는 GET/POST 0건이고, 하트 press는 /(auth)/login으로 push한다', async () => {
      // 준비 — 토큰 없음(게스트).
      clearAccessToken();
      render(<StaySearchPage />, { wrapper: createWrapper() });
      // 카드가 뜰 때까지(검색 GET는 인증과 무관) — 빈 하트.
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
        ).toBeOnTheScreen()
      );

      // 단언 ① — 담은 목록 조회는 아예 안 나간다(enabled:isAuthed).
      expect(hitCount('GET /api/v1/saved-stays')).toBe(0);

      // 실행 — 하트 press.
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

      // 단언 ② — 로그인 유도로 간다(죽은 버튼이 아니다).
      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/(auth)/login')
      );
      // 단언 ③ — 담기 요청은 나가지 않았고, 하트는 여전히 빈 상태다.
      expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen();
    });
  });

  describe('P5 · 연타 가드 (AC-8)', () => {
    it('응답 대기 중 하트를 다시 눌러도 POST는 1건뿐이다', async () => {
      // 준비 — 로그인 + POST를 문 뒤에 세운다.
      setAccessToken('valid-access');
      const gate = createGate();
      server.use(
        http.post(`${BASE}/saved-stays`, async () => {
          await gate.opened;
          return HttpResponse.json(savedFrom(ITEM_A, NEW_SAVED_ID), {
            status: 201,
          });
        })
      );
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(
          screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
        ).toBeOnTheScreen()
      );

      // 실행 ① — 첫 press로 요청이 나가고 하트가 대기(disabled) 상태가 된다.
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeDisabled()
      );

      // 실행 ② — 대기 중 다시 press(비활성이라 무동작).
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

      // 실행 ③ — 문 열어 완료시킨다.
      gate.release();
      await waitFor(() =>
        expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).not.toBeDisabled()
      );

      // 단언 — 연타에도 POST는 딱 한 번만 나갔다.
      expect(hitCount('POST /api/v1/saved-stays')).toBe(1);
    });
  });
});

// 옛 StaySearchPage.states — AC-11·AC-12 (INV-4 재시도)
describe('상태별 재시도·딥링크 파라미터 (옛 .states)', () => {
  afterEach(expectNoRouterCall);

  /**
   * AC-11(재시도 실배선) · AC-12(딥링크 파라미터) — `StaySearchPage`가 `resolveStaySearchState`가
   * 만든 상태를 실제 서버 응답·재요청과 함께 배선한다는 증거.
   *
   * 무엇을 보장하나: partial-failure·error 화면의 재시도 버튼을 누르면 `/stays/search`로 진짜
   * 요청이 한 번 더 나가고(AC-11, `onRetry`=`refetch` 실배선), `useLocalSearchParams`의
   * `amenity`·`stayType`이 나가는 URL 쿼리에 그대로 실린다(AC-12). 인프라(msw·mock·wrapper)는
   * `StaySearchPage.integration.test.tsx`에서 그대로 복사한다(공용화하지 않는 것이 리포 관례).
   */

  const BASE = 'http://localhost:8080/api/v1';

  /** partial-failure 모양 1건 응답 — degraded:true라 F5-1의 배너가 뜬다. */
  const FIXTURE = {
    items: [
      {
        externalSource: 'NAVER',
        externalId: 'jeju-1',
        name: '테스트 스테이',
        lat: 33.45,
        lng: 126.57,
        region: 'jeju',
        amenities: ['ocean'],
        stayType: 'HOTEL',
        price: { amount: 50000, currency: 'KRW' },
      },
    ],
    degraded: true,
    filterZeroReasons: [],
  };

  /** 나가는 요청의 최종 URL 전부(직렬화가 끝난 뒤 값 — msw만 이걸 관찰할 수 있다). */
  let observedUrls: string[] = [];

  function onRequestStart({ request }: { request: Request }): void {
    observedUrls.push(request.url);
  }

  beforeAll(() => {
    server.events.on('request:start', onRequestStart);
  });
  afterAll(() => {
    server.events.removeListener('request:start', onRequestStart);
  });

  beforeEach(() => {
    observedUrls = [];
    mockSearchParams = {};
    // handlers.ts에 /stays/search 핸들러가 없다 — afterEach의 resetHandlers()가 지우므로
    // 매 테스트마다 다시 건다(§5 ★11).
    server.use(
      http.get(`${BASE}/stays/search`, () => HttpResponse.json(FIXTURE))
    );
  });

  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: {
        // retry:false가 없으면 TanStack Query가 스스로 재시도해 누르기 전에 이미 2건이
        // 된다(F5-2 필수 조건). gcTime:0 — 기본값(5분) 타이머가 테스트 종료 후에도 살아남아
        // Node 프로세스를 붙잡는다(useStaySearch.integration.test.tsx:141-145 실측).
        queries: { retry: false, gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return Wrapper;
  }

  function staysHits(): string[] {
    return observedUrls.filter(
      (raw) => new URL(raw).pathname === '/api/v1/stays/search'
    );
  }

  describe('StaySearchPage — partial-failure 재시도가 실제로 재요청한다 (AC-11)', () => {
    it('재시도 버튼을 누르면 /stays/search로 요청이 한 번 더 나간다', async () => {
      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(
          screen.getByTestId('stay-search-partialfailure')
        ).toBeOnTheScreen()
      );
      // 누르기 전 짝 — 이게 없으면 아래 "2건"이 재요청인지 최초 요청 2번인지 구분이 안 된다.
      expect(staysHits()).toHaveLength(1);

      fireEvent.press(screen.getByTestId('stay-search-partialfailure-retry'));

      await waitFor(() => expect(staysHits()).toHaveLength(2));
    });
  });

  describe('StaySearchPage — error 재시도가 실제로 재요청한다 (AC-11)', () => {
    it('500 응답 후 재시도 버튼을 누르면 요청이 한 번 더 나간다', async () => {
      // beforeEach가 건 200 핸들러 위에 이 it 안에서 500을 덮어쓴다 — 뒤에 건 것이
      // 이긴다(§5 ★11).
      server.use(
        http.get(
          `${BASE}/stays/search`,
          () => new HttpResponse(null, { status: 500 })
        )
      );

      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('stay-search-error')).toBeOnTheScreen()
      );
      expect(staysHits()).toHaveLength(1);

      fireEvent.press(screen.getByTestId('stay-search-error-retry'));

      await waitFor(() => expect(staysHits()).toHaveLength(2));
    });
  });

  describe('StaySearchPage — 딥링크 파라미터가 요청 URL에 실린다 (AC-12)', () => {
    const CASES: {
      name: string;
      params: { region?: string; amenity?: string; stayType?: string };
      expectedRegion: string;
      expectedAmenity: string[];
      expectedStayType: string[];
    }[] = [
      {
        name: '파라미터 없음 — region 폴백만',
        params: {},
        expectedRegion: '부산',
        expectedAmenity: [],
        expectedStayType: [],
      },
      {
        name: 'amenity 하나',
        params: { region: '부산', amenity: '조식' },
        expectedRegion: '부산',
        expectedAmenity: ['조식'],
        expectedStayType: [],
      },
      {
        name: 'stayType 하나',
        params: { region: '부산', stayType: 'HOTEL' },
        expectedRegion: '부산',
        expectedAmenity: [],
        expectedStayType: ['HOTEL'],
      },
    ];

    it.each(CASES)(
      '$name',
      async ({ params, expectedRegion, expectedAmenity, expectedStayType }) => {
        mockSearchParams = params;

        render(<StaySearchPage />, { wrapper: createWrapper() });
        await waitFor(() => expect(staysHits().length).toBeGreaterThan(0));

        // 짝 — 호출이 정확히 1건 없으면 아래 URL 단언이 공허해진다.
        expect(staysHits()).toHaveLength(1);
        const url = new URL(staysHits()[0]);
        expect(url.searchParams.get('region')).toBe(expectedRegion);
        expect(url.searchParams.getAll('amenity')).toEqual(expectedAmenity);
        expect(url.searchParams.getAll('stayType')).toEqual(expectedStayType);
        // 브래킷 없음(선례 계승) — axios가 amenity=A&amenity=B로 직렬화한다.
        expect(url.searchParams.getAll('amenity[]')).toEqual([]);
      }
    );
  });
});
