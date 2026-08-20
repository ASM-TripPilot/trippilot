import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type {
  SavedStay,
  StayItem,
  StayPrice,
} from '@/shared/api/generated/schemas';
import { stayKey } from '@/features/stay/model/stayKey';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import ExploreRoute from '@/app/(tabs)/explore';

/**
 * TRIP-447 AC-4·5·6·7·8 (배선) — d01 랜딩 숙소 카드 하트가 실제로 서버 요청·낙관 채움·롤백·
 * 로그인 이동에 이어진다는 증거. `StaySearchPage.save.integration.test.tsx`(TRIP-417)의 랜딩판.
 *
 * 왜 라우트 통합인가(02a §0): 랜딩 화면(`ExploreLandingScreen`, features/explore)은
 * `placeExploreStructure` 재귀 스캔이 `@/features/stay` import 를 0건 강제해 담기 훅
 * (`useSavedStays`, features/stay)을 직접 못 부른다. 그래서 라우트 `(tabs)/explore.tsx`(app 층,
 * 스캔 밖)가 훅을 물어 `savedKeys`·`pendingKeys`·`onToggleSave`·`saveError`를 props 로 내린다 —
 * 낙관 채움/롤백은 훅 캐시(`setQueryData`) 내부, 로그인 이동·pending·saveError 는 라우트 상태라
 * 순수 화면 렌더로는 못 잰다.
 *
 * seam 분리(02a ★5): 데이터 소스 훅 `useStaySearch`·`useSavedPlaces`는 **딥 경로 목**(카드·bridge
 * 카운트만 공급), 담기 훅 `useSavedStays`는 **목 안 함(실물)** + msw 로 태운다(목하면 낙관/롤백이
 * 사라져 AC-4/6/8 이 무의미해진다).
 *
 * ★ 심판(02a §6):
 *  - **★1** 담김/미담김을 서로 다른 글리프 testID(`explore-stay-heart-filled-{key}`/`-outline-{key}`)로
 *    잰다 — fill 색 토글이면 두 testID 가 동시에 존재할 수 없어 원리적으로 red(repo-trap 글리프 절).
 *  - **★2** AC-6 은 배너 표시 + 하트 안 굳음(롤백)을 **둘 다** 단언(하나만 보면 "채우고 침묵"이 통과).
 *  - **★3** AC-7 은 서버 미호출 + 로그인 push 를 **둘 다** 단언.
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

// 호이스팅 예외를 받으려면 이름이 mock 으로 시작해야 한다(기존 통합테스트 관례). `useRouter().push`
// 는 렌더 시점이 아니라 실제로 눌렸을 때만 평가되므로 TDZ 없이 안전하다(tabsExploreRoute 선례).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 데이터 소스 훅은 딥 경로 목(배럴 아님 — 02a ★5). 카드 2건·bridge 카운트만 공급한다.
jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: jest.fn(),
}));
jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: jest.fn(),
}));

const mockUseStaySearch = useStaySearch as jest.MockedFunction<
  typeof useStaySearch
>;
const mockUseSavedPlaces = useSavedPlaces as jest.MockedFunction<
  typeof useSavedPlaces
>;

const BASE = 'http://localhost:8080/api/v1';

/** 검색 결과 카드 2건(A·B). */
function item(
  externalSource: string,
  externalId: string,
  region: string,
  name: string,
  lat: number,
  lng: number,
  price: StayPrice | null
): StayItem {
  return {
    externalSource,
    externalId,
    name,
    lat,
    lng,
    region,
    amenities: [],
    stayType: 'HOTEL',
    price,
  };
}

const ITEM_A = item(
  'NAVER',
  's1',
  '해운대',
  '해운대 그랜드 호텔',
  35.1587,
  129.1604,
  {
    amount: 145000,
    currency: 'KRW',
  }
);
const ITEM_B = item(
  'NAVER',
  's2',
  '서면',
  '서면 시티 호텔',
  35.1577,
  129.0594,
  null
);
const KEY_A = stayKey(ITEM_A); // 'NAVER:s1'
const KEY_B = stayKey(ITEM_B); // 'NAVER:s2'

const SAVED_ID_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

/** 라우트가 읽는 필드(data·isError·isPending)만 채운 조회 결과. */
function stayResults(items: StayItem[]) {
  return {
    data: { items, degraded: false, filterZeroReasons: [] },
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useStaySearch>;
}

/** bridgeBar 는 savedPoiIds 개수만 읽는다(하트 심판과 무관, 목으로 고정). */
function savedPlacesResult(savedPoiIds: string[]) {
  return { savedPoiIds } as unknown as ReturnType<typeof useSavedPlaces>;
}

/** openapi SavedStay.required + 외부키를 채운 서버 담기 기록. */
function savedFrom(source: StayItem, savedStayId: string): SavedStay {
  return {
    savedStayId,
    name: source.name,
    coordConfirmed: false,
    registerRoute: 'MAP_SEARCH',
    externalSource: source.externalSource,
    externalId: source.externalId,
    lat: source.lat,
    lng: source.lng,
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
  mockPush.mockClear();
  mockUseStaySearch.mockReset();
  mockUseSavedPlaces.mockReset();
  clearAccessToken();
  // 기본값: 카드 2건 + 담은 장소 0(bridge). 각 테스트가 인증·GET/POST 만 덮어쓴다.
  mockUseStaySearch.mockReturnValue(stayResults([ITEM_A, ITEM_B]));
  mockUseSavedPlaces.mockReturnValue(savedPlacesResult([]));
  // GET /saved-stays 는 항상 등록 — 게스트에서 잘못 나가면 throw 가 아니라 hitCount 로 잡히게.
  server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])));
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

describe('AC-4 · 로그인 담기 → 채워짐', () => {
  it('미담김 하트 press → 낙관적으로 찬 하트(-filled)+selected 로 바뀐다', async () => {
    // 준비 — 로그인 + 담은 목록 비어 있음. POST 응답은 문 뒤에 세운다(낙관 관찰).
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
    render(<ExploreRoute />, { wrapper: createWrapper() });
    // 카드 A 의 빈 하트가 뜰 때까지 기다린다(담은 목록 GET 도착).
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
      ).toBeOnTheScreen()
    );

    // 실행 — 하트 A press.
    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    // 단언 ① — 응답 전(문 닫힘)에 이미 찬 하트다(★1: 색 아니라 별도 글리프 testID).
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-filled-${KEY_A}`)
      ).toBeOnTheScreen()
    );
    // 단언 ② — 담김=선택됨.
    expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).toBeSelected();

    // 정리 — 문 열기 → 성공 → 담은 목록 무효화(재요청)로 대기 중 요청을 매듭짓는다.
    gate.release();
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));

    // 단언 ③(★2 짝) — 담기가 성공으로 정착한 뒤에도 실패 배너는 없다. 찬 하트와
    // "실패" 배너를 동시에 띄우는 거짓 실패 표시를 잠근다(무조건 setSaveError 뮤테이션이 여기서 red).
    expect(screen.queryByTestId('explore-stay-save-error')).toBeNull();
  });
});

describe('AC-5 · 재진입 담김 유지', () => {
  it('담은 목록에 A 가 있으면, press 없이 처음부터 A 만 찬 하트(-filled)+selected 다', async () => {
    // 준비 — 로그인 + A 가 이미 담김.
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([savedFrom(ITEM_A, SAVED_ID_A)])
      )
    );
    render(<ExploreRoute />, { wrapper: createWrapper() });

    // 단언 — A 는 찬 하트+selected, B 는 빈 하트+not selected(다른 카드로 새지 않는다).
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-filled-${KEY_A}`)
      ).toBeOnTheScreen()
    );
    expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).toBeSelected();
    expect(
      screen.getByTestId(`explore-stay-heart-outline-${KEY_B}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(`explore-stay-save-${KEY_B}`)).not.toBeSelected();
    // 부정 짝 — 조회만 하고 담기 조작이 없었으니 실패 배너도 없다(거짓 실패 금지).
    expect(screen.queryByTestId('explore-stay-save-error')).toBeNull();
  });
});

describe('AC-6 · 담기 실패 → 알림(INV-4) — 배너 + 안 굳음 (★2 둘 다)', () => {
  it('POST 실패 → 실패 배너가 보이고, 하트는 filled 로 굳지 않고 롤백된다', async () => {
    // 준비 — 로그인 + 담은 목록 비어 있음 + POST 500(network 실패로 분류).
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json({ error: { code: 'X' } }, { status: 500 })
      )
    );
    render(<ExploreRoute />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
      ).toBeOnTheScreen()
    );

    // 실행 — 하트 A press.
    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    // 단언 ① — 실패를 알린다(침묵 금지, INV-4).
    await waitFor(() =>
      expect(screen.getByTestId('explore-stay-save-error')).toBeOnTheScreen()
    );
    // 단언 ② — 하트가 filled 로 안 굳는다(롤백): 빈 하트로 되돌아오고 찬 하트는 사라졌다.
    expect(
      screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`explore-stay-heart-filled-${KEY_A}`)
    ).toBeNull();
    expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).not.toBeSelected();
  });
});

describe('AC-7 · 비로그인 담기 → 로그인 안내 (★3 둘 다)', () => {
  it('게스트가 하트를 누르면 서버 담기 요청은 0건이고, /(auth)/login 으로 push 한다', async () => {
    // 준비 — 토큰 없음(게스트).
    clearAccessToken();
    render(<ExploreRoute />, { wrapper: createWrapper() });
    // 카드가 뜰 때까지(검색은 목이라 인증 무관) — 빈 하트.
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
      ).toBeOnTheScreen()
    );
    // 사전 단언 — 담은 목록 조회는 아예 안 나간다(enabled:isAuthed=false).
    expect(hitCount('GET /api/v1/saved-stays')).toBe(0);

    // 실행 — 하트 press.
    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    // 단언 ① — 로그인 유도로 간다(죽은 버튼이 아니다).
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    // 단언 ② — 담기 요청은 나가지 않았고, 하트는 여전히 빈 상태다(담김 표식 없음).
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
    expect(
      screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
    ).toBeOnTheScreen();
  });
});

describe('AC-8 · 연타 가드', () => {
  it('응답 대기 중 하트를 다시 눌러도 POST 는 1건뿐이다', async () => {
    // 준비 — 로그인 + POST 를 문 뒤에 세운다.
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
    render(<ExploreRoute />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
      ).toBeOnTheScreen()
    );

    // 실행 ① — 첫 press 로 요청이 나가고 하트가 대기(disabled) 상태가 된다.
    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));
    await waitFor(() =>
      expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).toBeDisabled()
    );

    // 실행 ② — 대기 중 다시 press(비활성이라 무동작).
    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    // 실행 ③ — 문 열어 완료시킨다.
    gate.release();
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-save-${KEY_A}`)
      ).not.toBeDisabled()
    );

    // 단언 — 연타에도 POST 는 딱 한 번만 나갔다.
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);
  });
});
