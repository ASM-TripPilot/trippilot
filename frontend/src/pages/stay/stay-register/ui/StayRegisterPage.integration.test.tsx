import type * as StaysApi from '@/shared/api/generated/stays/stays';
import type * as SavedStaysApi from '@/shared/api/generated/saved-stays/saved-stays';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
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
import { useSavedStays } from '@/features/trip';
import { server } from '@/mocks/server';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';
import { StayRegisterPage } from './StayRegisterPage';
import type { MapCenter } from '@/shared/map';

/**
 * e05 숙소 등록 — StayRegisterPage 배선 통합 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1148): 옛 `StayRegisterPage.integration.test.tsx`·`.pin.integration.test.tsx`·
 * `.back.integration.test.tsx` 를 각자의 바깥 describe 로 옮겼다. 두 관점이 같은 모듈을 다르게 다룬다.
 *  - 생성 훅(`stays`·`saved-stays`): 본 관점은 msw 로 실물을 태우고, 핀 관점은 역지오코딩 응답을 케이스마다
 *    갈아끼우고 `mutateAsync` 인자로 본문을 본다. `jest.mock` 은 파일 전체에 걸리므로(babel 이 맨 위로 끌어올린다)
 *    팩토리 안에 스위치 `mockPinStubs` 를 두고, 훅이 **불리는 순간** 그 값을 읽어 목/실물을 고른다. 핀 describe 의
 *    `beforeEach` 만 켜고, 최상위 `afterEach` 가 끈다. 핀 관점은 옛 파일처럼 Provider 없이 그린다(스위치가 켜져야 유효).
 *  - 지도(`@/shared/map`): 옛 핀 파일만 `mapViewMock` 을 썼다. 본·뒤로 관점은 지도 testID 를 안 보므로 파일 전체에
 *    `mapViewMock` 을 건다(01b Q2 — 실측 green 으로 스위치 없이 확정).
 *  - 토스트 스토어·지도 키(`process.env`)는 모듈 싱글턴·프로세스 전역이라 최상위 `afterEach` 가 비운다.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 바깥 변수를 못 본다 — 이름이 `mock`으로
// 시작하는 변수만 예외다.
const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 핀 관점 스위치 — true 인 동안만 검색·역지오코딩·등록 훅이 아래 목으로 답한다(그 외엔 실물 + msw).
let mockPinStubs = false;
const mockStubGeocode = jest.fn();
const mockStubReverse = jest.fn();
const mockMutateAsync = jest.fn();

jest.mock('@/shared/api/generated/stays/stays', () => {
  const actual = jest.requireActual<typeof StaysApi>(
    '@/shared/api/generated/stays/stays'
  );
  return {
    ...actual,
    useGetStaysGeocode: (
      ...args: Parameters<typeof actual.useGetStaysGeocode>
    ) =>
      mockPinStubs
        ? mockStubGeocode(...args)
        : actual.useGetStaysGeocode(...args),
    useGetStaysReverseGeocode: (
      ...args: Parameters<typeof actual.useGetStaysReverseGeocode>
    ) =>
      mockPinStubs
        ? mockStubReverse(...args)
        : actual.useGetStaysReverseGeocode(...args),
  };
});

jest.mock('@/shared/api/generated/saved-stays/saved-stays', () => {
  const actual = jest.requireActual<typeof SavedStaysApi>(
    '@/shared/api/generated/saved-stays/saved-stays'
  );
  return {
    ...actual,
    usePostSavedStays: (
      ...args: Parameters<typeof actual.usePostSavedStays>
    ) =>
      mockPinStubs
        ? { mutateAsync: mockMutateAsync }
        : actual.usePostSavedStays(...args),
  };
});

const MAP_KEY_ENV = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
// 분리 대입 — 결합 초기화는 expo/no-dynamic-env-var 에 걸린다.
let ORIGINAL_MAP_KEY: string | undefined;
ORIGINAL_MAP_KEY = process.env[MAP_KEY_ENV];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
});
afterEach(() => {
  server.resetHandlers();
  mockPinStubs = false;
  // 토스트 스토어는 모듈 싱글턴이라 describe 사이로 샌다 — 핀 관점의 등록 성공도 토스트를 남긴다.
  resetToast();
  if (ORIGINAL_MAP_KEY === undefined) {
    delete process.env[MAP_KEY_ENV];
  } else {
    process.env[MAP_KEY_ENV] = ORIGINAL_MAP_KEY;
  }
});
afterAll(() => server.close());

// 옛 StayRegisterPage.integration — §3-1~§3-5·TRIP-600·TRIP-1023·TRIP-1052 (INV-4)
describe('검색 후보로 등록 — 실물 훅 + msw (옛 본 파일)', () => {
  /**
   * I-1~I-7 (동결 AC-1·5·6 · 01b Seed §3-1·§3-2·§3-3·§3-5) — e05 등록 배선.
   *
   * 무엇을 보장하나: 화면에서 일어난 조작이 **실제 HTTP 요청과 라우팅**으로 이어진다.
   *  - 검색어가 `GET /stays/geocode`의 `q`로 실리고, 검색 키를 누르기 전에는 요청이 0건이다
   *  - 등록이 `POST /saved-stays`에 `registerRoute: 'MAP_SEARCH'`와 확정 좌표를 담아 나간다
   *  - **재검색하면 이전 후보 선택과 좌표 확정이 함께 초기화된다** — 'A 호텔의 좌표'에
   *    'B 호텔의 이름'이 붙어 서버로 가는 불일치를 막는 이 사이클의 무결성 축(가중치 1.0)
   *
   * 왜 통합 버킷인가: axios는 params를 어댑터 **안에서** 직렬화하므로 최종 URL은 msw만
   * 관찰할 수 있고, 요청 본문도 마찬가지다(선례 `StaySearchPage.integration.test.tsx:12-15`).
   *
   * env 규율(`KakaoMapView.test.tsx:36-49` 선례): 지도 시트가 성공 얼굴을 쓸지 실패 얼굴을
   * 쓸지는 카카오 JS 키의 유무로 갈린다(02a ★6 — `KakaoMapView`에 바깥으로 나가는 이벤트
   * 채널이 없어서, 키 유무가 지도 성공 여부와 정확히 같은 값이다). 기계마다 셸 env가 다를 수
   * 있으므로 각 테스트가 원하는 상태를 명시적으로 만들고 afterEach에서 되돌린다.
   */

  /** authWiring.integration.test.ts:59와 같은 값(리포 관례). */
  const BASE = 'http://localhost:8080/api/v1';

  const ENV_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';

  /** 검색어별 후보 — 재검색 초기화(I-5)를 재려면 두 검색이 서로 다른 결과를 줘야 한다. */
  const BUSAN_CANDIDATE = {
    name: '해운대 그랜드 호텔',
    address: '부산 해운대구 우동 1407',
    lat: 35.1587,
    lng: 129.1604,
  };

  const SEOUL_CANDIDATES = [
    {
      name: '명동 시티 호텔',
      address: '서울 중구 명동길 1',
      lat: 37.5636,
      lng: 126.9827,
    },
    {
      name: '명동 스테이',
      address: '서울 중구 명동길 20',
      lat: 37.5641,
      lng: 126.9851,
    },
  ];

  const SAVED_STAY = {
    savedStayId: 'ss-1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    coordConfirmed: true,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };

  let observedUrls: string[] = [];
  let postedBodies: Record<string, unknown>[] = [];

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
    postedBodies = [];
    mockBack.mockClear();
    mockPush.mockClear();
    // 기본 상태 = 카카오 키 없음. 이것이 실제 개발 환경 조건이기도 하다(Seed §3-3 폴백 근거 ③).
    delete process.env[ENV_KEY];

    // 기본 handlers.ts에 stays·saved-stays 핸들러가 0건이므로 매 테스트마다 건다
    // (afterEach의 resetHandlers()가 지우므로 beforeEach에서 다시 건다).
    server.use(
      http.get(`${BASE}/stays/geocode`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        return HttpResponse.json(
          q === 'seoul' ? SEOUL_CANDIDATES : [BUSAN_CANDIDATE]
        );
      }),
      http.post(`${BASE}/saved-stays`, async ({ request }) => {
        postedBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(SAVED_STAY, { status: 201 });
      })
    );
  });

  /** useStaySearch.integration.test.tsx:139의 것과 동형 — gcTime: 0이 없으면 기본값(5분)의
   * 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를 붙잡는다. */
  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return Wrapper;
  }

  function geocodeHits(): string[] {
    return observedUrls.filter(
      (raw) => new URL(raw).pathname === '/api/v1/stays/geocode'
    );
  }

  function postHits(): string[] {
    return observedUrls.filter(
      (raw) => new URL(raw).pathname === '/api/v1/saved-stays'
    );
  }

  /** 검색어를 넣고 키보드 '검색' 키를 누른다(§3-1 — 이것만이 검색 트리거다). */
  function searchFor(text: string): void {
    const input = screen.getByTestId('stay-register-search-input');
    fireEvent.changeText(input, text);
    fireEvent(input, 'submitEditing', { nativeEvent: { text } });
  }

  /** 후보 선택 → 지도 시트 열기 → 확인. 이 세 걸음을 다 밟아야 coordConfirmed가 true다(§3-2). */
  async function selectAndConfirm(index: number): Promise<void> {
    fireEvent.press(
      await screen.findByTestId(`stay-register-candidate-${index}`)
    );
    fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));
    fireEvent.press(screen.getByTestId('stay-register-mapsheet-confirm'));
  }

  describe('I-1 · 정상 등록 (AC-1 · §3-5)', () => {
    it('후보를 고르고 확인하면 MAP_SEARCH 경로로 등록되고, 성공 후 이전 화면으로 돌아간다', async () => {
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      searchFor('busan');
      await selectAndConfirm(0);

      fireEvent.press(screen.getByTestId('stay-register-submit'));

      await waitFor(() => expect(postHits()).toHaveLength(1));

      // 본문이 계약대로다(브리프 §4-2 — mutate 인자가 { data } 한 겹인 것은 생성 훅 사정).
      expect(postedBodies).toHaveLength(1);
      expect(postedBodies[0]).toMatchObject({
        name: '해운대 그랜드 호텔',
        registerRoute: 'MAP_SEARCH',
        lat: 35.1587,
        lng: 129.1604,
        coordConfirmed: true,
      });

      // 201 후 숙소 검색(e02)으로 복귀한다(§3-5).
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    });
  });

  describe('🔴 I-2 · 날짜 입력 없이 등록되고 요청 본문에 checkIn·checkOut 키가 없다 (TRIP-1052 AC-1·AC-2)', () => {
    it('페이지에 날짜 입력 표면이 없고, 등록 요청 본문에 날짜 키 자체가 실리지 않는다', async () => {
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      // 준비 — 페이지 층에서도 날짜 입력 표면(필드·요약·오류·시트·칸)이 0개다. 짝으로 등록
      // 버튼은 있다(화면이 통째로 비어서 참이 된 게 아니다).
      expect(screen.queryAllByTestId(/^stay-register-date/)).toHaveLength(0);
      expect(screen.getByTestId('stay-register-submit')).toBeOnTheScreen();

      searchFor('busan');
      await selectAndConfirm(0);
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      await waitFor(() => expect(postedBodies).toHaveLength(1));

      // 개정 정본(US-STAY-08)은 "싣지 않는다"다 — 옛 `?? null` 단언은 `checkIn: null`을 실어도
      // 통과했다. 키 부재로 잰다(toHaveProperty는 값이 null이어도 키가 있으면 "있다").
      expect(postedBodies[0]).not.toHaveProperty('checkIn');
      expect(postedBodies[0]).not.toHaveProperty('checkOut');
      // 날짜를 필수로 막으면 위반 — 등록 자체는 실제로 나갔다.
      expect(postHits()).toHaveLength(1);
    });
  });

  describe('I-3 · 검색 실패와 재시도 (AC-6 · INV-4)', () => {
    it('실패를 문구로 드러내고, "다시 시도"가 실제로 재조회를 일으킨다', async () => {
      server.use(
        http.get(
          `${BASE}/stays/geocode`,
          () => new HttpResponse(null, { status: 500 })
        )
      );

      render(<StayRegisterPage />, { wrapper: createWrapper() });
      searchFor('busan');

      await waitFor(() =>
        expect(screen.getByTestId('stay-register-searchfail')).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('stay-register-searchfail')).getByText(
          '지도 검색을 사용할 수 없어요'
        )
      ).toBeOnTheScreen();

      const before = geocodeHits().length;
      expect(before).toBeGreaterThan(0);

      fireEvent.press(screen.getByTestId('stay-register-searchfail-retry'));

      // 표시만 하고 아무 일도 안 하면 위반 — 요청 수가 실제로 늘어야 한다.
      await waitFor(() => expect(geocodeHits().length).toBeGreaterThan(before));
    });
  });

  describe('I-4 · 자동 검색은 없다 (§3-1)', () => {
    it('렌더만으로도, 타이핑만으로도 요청이 나가지 않고 검색 키에서만 나간다', async () => {
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      // 훅의 q가 required라 조건 없이 부르면 빈 문자열로 요청이 나간다(02a ★14).
      expect(geocodeHits()).toHaveLength(0);

      fireEvent.changeText(
        screen.getByTestId('stay-register-search-input'),
        'busan'
      );
      expect(geocodeHits()).toHaveLength(0);

      fireEvent(
        screen.getByTestId('stay-register-search-input'),
        'submitEditing',
        { nativeEvent: { text: 'busan' } }
      );

      await waitFor(() => expect(geocodeHits()).toHaveLength(1));
      // ASCII 값을 쓴다 — 한글은 퍼센트 인코딩되어 실패 메시지를 읽을 수 없다(리포 관례).
      expect(new URL(geocodeHits()[0]).searchParams.get('q')).toBe('busan');
    });
  });

  describe('I-5 · 재검색하면 좌표 확정이 풀린다 (§3-2, 가중치 1.0)', () => {
    it('다른 검색어로 다시 찾으면 후보 선택과 좌표 확정이 함께 초기화되고 등록이 다시 잠긴다', async () => {
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      // 1) 부산 숙소를 고르고 좌표까지 확정한다 → 등록이 열린다.
      searchFor('busan');
      await selectAndConfirm(0);
      await waitFor(() =>
        expect(screen.getByTestId('stay-register-submit')).toBeEnabled()
      );

      // 2) 검색어를 바꿔 다시 검색한다(후보가 아예 다른 도시로 바뀐다).
      searchFor('seoul');
      await screen.findByTestId('stay-register-candidate-1');

      // 3) 본체 — 등록이 다시 잠기고 안내가 돌아온다.
      expect(screen.getByTestId('stay-register-submit')).toBeDisabled();
      expect(
        within(screen.getByTestId('stay-register-coordnotice')).getByText(
          '지도에서 위치를 확인해 주세요'
        )
      ).toBeOnTheScreen();

      // 4) 이전 선택이 남아 있지 않다 — 남아 있으면 'A의 좌표 + B의 이름'이 만들어진다.
      expect(screen.getByTestId('stay-register-candidate-0')).not.toBeChecked();
      expect(screen.getByTestId('stay-register-candidate-1')).not.toBeChecked();

      // 5) 눌러도 아무것도 나가지 않는다.
      fireEvent.press(screen.getByTestId('stay-register-submit'));
      expect(postHits()).toHaveLength(0);
    });
  });

  describe('I-6 · 지도가 안 뜨는 환경에서도 등록할 수 있다 (§3-3 · INV-4)', () => {
    it('카카오 키가 없으면 시트가 이름·주소를 보여주고 "이 주소로 확인"으로 확정된다', async () => {
      // beforeEach가 이미 키를 지웠다 — 이것이 실제 개발 환경의 기본 상태다.
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      searchFor('busan');
      fireEvent.press(await screen.findByTestId('stay-register-candidate-0'));
      fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));

      const sheet = screen.getByTestId('stay-register-mapsheet');
      expect(
        within(sheet).getByText('지도를 불러오지 못했어요')
      ).toBeOnTheScreen();
      // 사람이 무엇을 보고 확인했는지가 화면에 남는다(INV-U1-08 취지 유지).
      expect(within(sheet).getByText('해운대 그랜드 호텔')).toBeOnTheScreen();
      expect(
        within(sheet).getByText('부산 해운대구 우동 1407')
      ).toBeOnTheScreen();

      const confirm = within(sheet).getByTestId(
        'stay-register-mapsheet-confirm'
      );
      expect(within(confirm).getByText('이 주소로 확인')).toBeOnTheScreen();

      // 막다른 길이 아니다 — 이 버튼으로 등록까지 갈 수 있다.
      fireEvent.press(confirm);
      await waitFor(() =>
        expect(screen.getByTestId('stay-register-submit')).toBeEnabled()
      );
    });

    it('짝: 카카오 키가 있으면 시트가 지도 얼굴이고 버튼이 "이 위치로 확인"이다', async () => {
      process.env[ENV_KEY] = 'test-js-key';

      render(<StayRegisterPage />, { wrapper: createWrapper() });

      searchFor('busan');
      fireEvent.press(await screen.findByTestId('stay-register-candidate-0'));
      fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));

      const sheet = screen.getByTestId('stay-register-mapsheet');
      expect(
        within(sheet).getByTestId('stay-register-mapsheet-confirm')
      ).toBeOnTheScreen();
      expect(within(sheet).getByText('이 위치로 확인')).toBeOnTheScreen();
      expect(within(sheet).queryByText('지도를 불러오지 못했어요')).toBeNull();
    });
  });

  describe('I-7 · 등록 실패는 화면에 드러난다 (§3-5 · INV-4)', () => {
    it('400이면 실패 문구를 띄우고 화면을 떠나지 않으며 입력이 남는다', async () => {
      server.use(
        http.post(`${BASE}/saved-stays`, () =>
          HttpResponse.json(
            { code: 'VALIDATION_ERROR', message: 'bad request' },
            { status: 400 }
          )
        )
      );

      render(<StayRegisterPage />, { wrapper: createWrapper() });

      searchFor('busan');
      await selectAndConfirm(0);
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      await waitFor(() =>
        expect(screen.getByTestId('stay-register-submitfail')).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('stay-register-submitfail')).getByText(
          '등록에 실패했어요'
        )
      ).toBeOnTheScreen();

      // 화면을 떠나지 않는다 — 실패했는데 뒤로 가면 사용자가 무슨 일인지 모른다.
      expect(mockBack).not.toHaveBeenCalled();
      // 입력 보존(§3-5) — 처음부터 다시 검색하게 만들면 위반이다.
      expect(
        screen.getByTestId('stay-register-search-input')
      ).toHaveDisplayValue('busan');
      expect(screen.getByTestId('stay-register-candidate-0')).toBeChecked();
    });
  });

  /**
   * I-8 (TRIP-600 AC-1·AC-5 — 신규) — 좌표 있는 후보는 **선택만으로** 등록이 열린다.
   *
   * 무엇을 보장하나: 지도 검색 후보(`GeocodeCandidate`는 `lat`/`lng`가 required라 항상 좌표를
   * 가진다)를 탭하는 것 하나로 등록 게이트가 열린다 — "지도에서 위치 확인" 시트를 거쳐 좌표를
   * **다시 찍는** 절차를 강요하지 않는다(사용자 구술: "좌표가 있는데 찍어야 된다 이건 말이 안
   * 돼"). 지금 코드(`handleSelectCandidate`가 선택마다 `coordConfirmed=false`로 되돌림, :166)에서
   * 이 두 테스트는 red다.
   *
   * 무엇을 안 잠그나: "지도에서 위치 확인"(`stay-register-mapconfirm`) 버튼/시트의 **존치 여부는
   * 여기서 단언하지 않는다.** 그 시트는 핀 경로(좌표를 처음 얻는 유일 수단)에서 여전히 필요하고
   * (지라 §결정필요 3 "시트는 존치하고 배선만 바꾸는 편이 회귀가 적다"), I-6·IP-3가 그 도달성을
   * 이미 잠근다. 여기서 잠그는 것은 **선택만으로 열린다**는 관측 가능한 부작용뿐이다 —
   * 등록 버튼 활성, 좌표 안내 소멸, 실제 POST 본문의 `coordConfirmed:true`(02a 부채 1 — 시트
   * 실제 여닫힘은 jest 무심판이라 부작용으로만 잠근다).
   */
  describe('I-8 · 좌표 있는 후보는 선택만으로 등록이 열린다 (TRIP-600 AC-1·AC-5)', () => {
    it('후보를 탭하기만 하면(지도 확인 없이) 좌표 안내가 사라지고 등록 버튼이 열린다', async () => {
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      // 준비·실행 — 후보를 '탭'하는 것 하나뿐. mapconfirm·mapsheet-confirm을 거치지 않는다.
      searchFor('busan');
      fireEvent.press(await screen.findByTestId('stay-register-candidate-0'));

      // 단언 (c) — 등록 버튼이 활성이다(날짜 미선택이어도: isStayRangeValid(null,null)=true).
      await waitFor(() =>
        expect(screen.getByTestId('stay-register-submit')).toBeEnabled()
      );
      // 단언 (a) — "지도에서 위치를 확인해 주세요" 안내가 뜨지 않는다(좌표 재확인 강요 없음).
      expect(screen.queryByTestId('stay-register-coordnotice')).toBeNull();
    });

    it('선택만으로 실제 등록까지 간다 — 지도 확인 없이 눌러도 coordConfirmed=true가 서버로 나간다', async () => {
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      searchFor('busan');
      fireEvent.press(await screen.findByTestId('stay-register-candidate-0'));
      // mapconfirm/mapsheet-confirm을 건너뛰고 곧장 등록을 누른다.
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      await waitFor(() => expect(postedBodies).toHaveLength(1));
      // 관측 가능한 부작용으로만 잠근다 — 본문의 좌표 확정 도장이 true여야 g02 거점 배정이 열린다.
      expect(postedBodies[0]).toMatchObject({
        registerRoute: 'MAP_SEARCH',
        coordConfirmed: true,
      });
    });
  });

  /**
   * TRIP-990 · S5 (#036 · D22 · US-STAY-06·08) — 숙소 등록이 성공하면 들어온 곳으로 돌아가고 "숙소를
   * 등록했어요" 토스트를 띄운다.
   *
   * 돌아간 뒤에도 토스트는 루트 호스트가 그리므로 보인다(D19). 실패하면 기존처럼 실패 문구만 뜨고 화면을
   * 떠나지 않는다(I-7). US-STAY-06 의 "등록 후 AI 일정 생성 진입"은 이번 범위 밖(새 티켓 후보).
   *
   * 3동작 뼈대: 준비=후보 검색·선택·확정 → 실행=등록 → 단언=토스트·back.
   */
  describe('🔴 S5 · 등록 성공 토스트 + 뒤로 (#036 · D22)', () => {
    function renderWithToast() {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <WithToastHost>
            <StayRegisterPage />
          </WithToastHost>
        </Wrapper>
      );
    }

    it('POST 201 이면 "숙소를 등록했어요" 토스트가 뜨고 뒤로 1회 간다', async () => {
      renderWithToast();
      // "아직 없다" 앵커 — 토스트 스토어는 모듈 싱글턴이라 앞 테스트가 남기면 아래 단언이 누르기 전부터 참이 된다.
      // 이 앞의 정상 등록 테스트들이 토스트를 남기고, 그것을 최상위 afterEach 의 resetToast() 가 비운다 — 그 줄을 지우면 기본 순서에서도 여기서 red 다(5-b 실측).
      expect(screen.queryByTestId('stay-register-saved')).toBeNull();

      searchFor('busan');
      await selectAndConfirm(0);
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      const toast = await screen.findByTestId('stay-register-saved');
      expect(within(toast).getByText('숙소를 등록했어요')).toBeOnTheScreen();
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    });

    it('짝: POST 400 이면 실패 문구만 뜨고 토스트도 뒤로도 없다', async () => {
      server.use(
        http.post(`${BASE}/saved-stays`, () =>
          HttpResponse.json(
            { code: 'VALIDATION_ERROR', message: 'bad request' },
            { status: 400 }
          )
        )
      );
      renderWithToast();

      searchFor('busan');
      await selectAndConfirm(0);
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      // 실패가 처리된 뒤에 센다.
      expect(
        await screen.findByTestId('stay-register-submitfail')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('stay-register-saved')).toBeNull();
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  /**
   * TRIP-1023 #022 (US-STAY-09 · US-STAY-08 · INV-4 정신) — 등록하고 돌아왔는데 저장 목록에 없다.
   *
   * 무엇을 보장하나: e04 저장 숙소 목록(`SavedStayPage`)은 스택 아래 마운트된 채로 `GET /saved-stays`
   * 결과를 기억하고 있다. 등록 `POST /saved-stays`가 **성공**하면 그 목록 캐시가 낡았다고 표시(무효화)돼
   * 관찰자가 다시 받아야 한다 — 그래야 돌아간 목록에 방금 등록한 숙소가 있다. 실패면 다시 받지 않는다.
   *
   * 관찰자는 목이 아니라 e04 가 쓰는 **진짜 훅**(`useSavedStays`)과 **상태 있는 MSW**다(02a ★9) —
   * 무효화 키가 틀리면 GET 이 다시 안 나가서 잡힌다. 제출 중 화면을 떠나도(언마운트) 성공했으면
   * 갱신돼야 하므로, 호출별 `mutateAsync(vars, { onSuccess })` 콜백 자리는 R-A1u 가 잡는다(02a ★11).
   *
   * 3동작 뼈대: 준비=관찰자+등록 화면 렌더(GET 1회 확인) → 실행=검색·선택·등록 → 단언=GET 재발행·새 이름.
   */
  describe('🔴 TRIP-1023 #022 · 등록 성공 뒤 저장 숙소 목록이 갱신된다 (AC-A1 · AC-A2)', () => {
    let serverSaved: (typeof SAVED_STAY)[] = [];
    let savedListGets = 0;

    /** e04 가 스택 아래 살아 있는 상황의 대역 — 같은 조회 훅으로 이름만 그린다. */
    function SavedListProbe() {
      const query = useSavedStays();
      return (
        <View testID="saved-list-probe">
          {(query.data ?? []).map((stay) => (
            <Text key={stay.savedStayId}>{stay.name}</Text>
          ))}
        </View>
      );
    }

    function Harness({ showRegister }: { showRegister: boolean }) {
      return (
        <>
          <SavedListProbe />
          {showRegister ? <StayRegisterPage /> : null}
        </>
      );
    }

    beforeEach(() => {
      serverSaved = [];
      savedListGets = 0;
      server.use(
        http.get(`${BASE}/saved-stays`, () => {
          savedListGets += 1;
          return HttpResponse.json(serverSaved);
        }),
        http.post(`${BASE}/saved-stays`, async ({ request }) => {
          postedBodies.push((await request.json()) as Record<string, unknown>);
          serverSaved = [SAVED_STAY];
          return HttpResponse.json(SAVED_STAY, { status: 201 });
        })
      );
    });

    async function settle(): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    async function renderWithObserver(): Promise<void> {
      render(<Harness showRegister />, { wrapper: createWrapper() });
      // 관찰자가 살아 있다는 앵커 — 첫 조회 1회, 목록은 아직 비어 있다.
      await waitFor(() => expect(savedListGets).toBe(1));
      expect(
        within(screen.getByTestId('saved-list-probe')).queryByText(
          '해운대 그랜드 호텔'
        )
      ).toBeNull();
    }

    it('R-A1 · 등록이 성공하면 목록을 다시 받아 방금 등록한 숙소가 보인다', async () => {
      await renderWithObserver();

      searchFor('busan');
      await selectAndConfirm(0);
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      await waitFor(() => expect(savedListGets).toBeGreaterThanOrEqual(2));
      expect(
        await within(screen.getByTestId('saved-list-probe')).findByText(
          '해운대 그랜드 호텔'
        )
      ).toBeOnTheScreen();
      // 기존 복귀 순서(AC-A3)는 그대로다.
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    });

    it('R-A1u · 제출 중 화면을 떠나도 등록이 성공하면 목록이 갱신된다', async () => {
      let releasePost: () => void = () => {};
      const postGate = new Promise<void>((resolve) => {
        releasePost = resolve;
      });
      server.use(
        http.post(`${BASE}/saved-stays`, async ({ request }) => {
          postedBodies.push((await request.json()) as Record<string, unknown>);
          await postGate;
          serverSaved = [SAVED_STAY];
          return HttpResponse.json(SAVED_STAY, { status: 201 });
        })
      );
      await renderWithObserver();

      searchFor('busan');
      await selectAndConfirm(0);
      fireEvent.press(screen.getByTestId('stay-register-submit'));
      // 요청이 서버에 닿은 뒤에 떠난다 — 탭 직후 떠나면 요청 자체가 안 나간다(02a ★10).
      await waitFor(() => expect(postedBodies).toHaveLength(1));

      screen.rerender(<Harness showRegister={false} />);
      expect(screen.queryByTestId('stay-register-submit')).toBeNull();

      await act(async () => {
        releasePost();
      });

      await waitFor(() => expect(savedListGets).toBeGreaterThanOrEqual(2));
      expect(
        await within(screen.getByTestId('saved-list-probe')).findByText(
          '해운대 그랜드 호텔'
        )
      ).toBeOnTheScreen();
    });

    it('R-A2 · 등록이 실패하면(400) 목록을 다시 받지 않는다 (선제 green)', async () => {
      server.use(
        http.post(`${BASE}/saved-stays`, () =>
          HttpResponse.json(
            { code: 'VALIDATION_ERROR', message: 'bad request' },
            { status: 400 }
          )
        )
      );
      await renderWithObserver();

      searchFor('busan');
      await selectAndConfirm(0);
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      expect(
        await screen.findByTestId('stay-register-submitfail')
      ).toBeOnTheScreen();
      // 무효화가 catch/finally 에 있으면 이 사이에 GET 이 나간다(02a ★12).
      await settle();
      expect(savedListGets).toBe(1);
      expect(mockBack).not.toHaveBeenCalled();
    });
  });
});

// 옛 StayRegisterPage.pin — TRIP-866 S4 (IP-1~IP-4 · BR-U1-22/23)
describe('핀으로 등록 — 훅 목 (옛 .pin)', () => {
  /**
   * IP-1~IP-4 (AC-5~AC-8 · 02a §4-E) — 핀 지정 **단일 경로**(TRIP-866 S4) 배선.
   *
   * 무엇을 보장하나(초심자용): 옛 흐름은 지도가 `onMapMessage(PIN_DROP/GEOCODE_OK/GEOCODE_FAIL)`로
   * 좌표와 주소를 한꺼번에 브리지로 밀어 넣었다. 새 흐름은 두 갈래가 **분리**된다 —
   *  ① `CenterPinPicker.onPick({lat,lng})` 가 중심 좌표만 올린다.
   *  ② 주소는 페이지가 `useGetStaysReverseGeocode` 훅으로 따로 얻는다.
   * 이 파일은 그 훅의 결과(주소 / null / 503)가 화면 상태로 **올바르게 매핑**되는지, 그리고 핀으로
   * 찍은 좌표가 `registerRoute:'PIN'` 으로 등록까지 가는지를 잰다.
   *
   * ★핵심(02a §4):
   *  - null vs 503: `{address:null}`(주소 없음, 장애 아님)은 "주소 미확인"으로만, 503(장애)은
   *    실패 칸+숙소명 직접 입력으로 갈린다 — 그리고 **둘 다 등록을 막지 않는다**(BR-U1-23).
   *
   * 훅 목 전략(02a §5): `@/shared/api/generated/stays/stays` 를 `jest.mock` 으로 통째 치환한다 —
   * 실 네트워크(MSW) 대신 `useGetStaysReverseGeocode` 의 반환({data}/{isError})을 직접 주입해
   * null·503 갈래를 결정론적으로 만든다. `usePostSavedStays` 도 목이라 QueryClientProvider·MSW 가
   * 없어도 되고, POST 본문은 `mutateAsync` 인자로 관측한다(그 인자가 곧 서버로 갈 본문이다).
   * 지도는 `mapViewMock`(CenterPinPicker 가 onPick 을 host 로 통과)으로 치환한다.
   *
   * 구현 전엔 페이지가 `onMapMessage` 브리지를 쓰고 CenterPinPicker 를 안 그리므로, 핀 좌표 발화
   * 지점(center-pin-picker)이 없어 이 suite 는 red 다.
   */

  const mockGeocode = mockStubGeocode;
  const mockReverse = mockStubReverse;

  const PIN: MapCenter = { lat: 35.1621, lng: 129.1688 };
  const PIN_ADDRESS = '부산 해운대구 중동 1394';
  const SAVED_STAY = { savedStayId: 'ss-1', name: '', registerRoute: 'PIN' };

  const ENV_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';

  /** 역지오코딩 훅이 UseQueryResult 처럼 보이게 하는 최소 형태(실 훅 시그니처 확인: 02a §5). */
  const REVERSE_SUCCESS = {
    data: { address: PIN_ADDRESS, lat: PIN.lat, lng: PIN.lng },
    isError: false,
    isPending: false,
    error: null,
  };
  const REVERSE_NULL = {
    data: { address: null, lat: PIN.lat, lng: PIN.lng },
    isError: false,
    isPending: false,
    error: null,
  };
  const REVERSE_503 = {
    data: undefined,
    isError: true,
    isPending: false,
    error: { status: 503 },
  };
  const REVERSE_IDLE = {
    data: undefined,
    isError: false,
    isPending: false,
    error: null,
  };

  beforeEach(() => {
    mockPinStubs = true;
    mockBack.mockClear();
    mockPush.mockClear();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(SAVED_STAY);
    mockGeocode.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
    });
    mockReverse.mockReturnValue(REVERSE_IDLE);
    // 좌표 확정 시트가 'open'(map-failed 아님) 얼굴을 쓰게 한다 — mapsheet-confirm 이 그 안에 있다.
    process.env[ENV_KEY] = 'test-js-key';
  });

  function goToPinTab(): void {
    fireEvent.press(screen.getByTestId('stay-register-tab-pin'));
  }

  /** 지도를 움직여 멈춘 상황 — CenterPinPicker 가 중심 좌표를 보고했다고 흉내낸다(실 pan 은 6-b). */
  function panTo(center: MapCenter): void {
    const picker = within(
      screen.getByTestId('stay-register-pin-map')
    ).getByTestId('center-pin-picker');
    act(() => {
      (picker.props as { onPick: (c: MapCenter) => void }).onPick(center);
    });
  }

  /** 좌표 확정(D5 단일 경로) — 핀 좌표를 시트에서 「이 위치로 확인」한다(기존 배선 재사용). */
  function confirmCoord(): void {
    fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));
    fireEvent.press(screen.getByTestId('stay-register-mapsheet-confirm'));
  }

  function typeName(text: string): void {
    fireEvent.changeText(screen.getByTestId('stay-register-name-input'), text);
  }

  describe('IP-1 · 핀으로 찍어 등록한다 (AC-5 정상 · registerRoute=PIN)', () => {
    it('핀을 맞춰 주소가 뜨고, 이름을 넣고 확정하면 PIN 경로로 등록된다', async () => {
      mockReverse.mockReturnValue(REVERSE_SUCCESS);
      render(<StayRegisterPage />);

      goToPinTab();
      panTo(PIN);

      // AC-5 — 찍은 지점의 주소가 화면에 뜬다(표시용 사본, 저장 정본은 좌표다).
      await waitFor(() =>
        expect(
          within(screen.getByTestId('stay-register-pin-address')).getByText(
            PIN_ADDRESS
          )
        ).toBeOnTheScreen()
      );

      typeName('해운대 아르떼 빌딩');
      confirmCoord();
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      // 본체 — 좌표의 출처(PIN)가 registerRoute 를 정한다. 'MAP_SEARCH'로 나가면 위반이다(AC-7 계약).
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockMutateAsync).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '해운대 아르떼 빌딩',
          registerRoute: 'PIN',
          lat: PIN.lat,
          lng: PIN.lng,
          coordConfirmed: true,
        }),
      });

      // 201 후 이전 화면으로 돌아간다(기존 계약).
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    });
  });

  describe('IP-2 · 주소 없음(null): "주소 미확인"이고 실패 칸은 아니다 (AC-6)', () => {
    it('reverse-geocode 가 address=null 이면 pin-address 에 "주소 미확인", 실패 칸은 없다', async () => {
      mockReverse.mockReturnValue(REVERSE_NULL);
      render(<StayRegisterPage />);

      goToPinTab();
      panTo(PIN);

      // null 은 그 좌표에 주소가 없다는 사실이지 장애가 아니다 → 'ok' 갈래(pin-address)로만 표시.
      await waitFor(() =>
        expect(
          within(screen.getByTestId('stay-register-pin-address')).getByText(
            /주소 미확인/
          )
        ).toBeOnTheScreen()
      );

      // ★ null≠503 — 장애 칸으로 새지 않는다.
      expect(
        screen.queryAllByTestId('stay-register-pin-addressfail')
      ).toHaveLength(0);
    });
  });

  describe('IP-3 · ★ 장애(503): 실패해도 좌표만으로 등록까지 간다 (AC-7 · BR-U1-23 · INV-4)', () => {
    it('reverse-geocode 503 이면 실패 칸+숙소명 입력이 뜨고, 이름을 넣어 PIN 으로 등록된다', async () => {
      mockReverse.mockReturnValue(REVERSE_503);
      render(<StayRegisterPage />);

      goToPinTab();
      panTo(PIN);

      // 침묵 실패 금지 — 실패를 드러낸다(★ null≠503: 정상 주소 칸이 아니라 실패 칸이다).
      await waitFor(() =>
        expect(
          screen.getByTestId('stay-register-pin-addressfail')
        ).toHaveTextContent(/주소 미확인/)
      );
      expect(screen.queryAllByTestId('stay-register-pin-address')).toHaveLength(
        0
      );

      // 다음 행동 — 주소를 못 받았으니 사람이 이름을 직접 친다.
      typeName('이름만 아는 숙소');
      confirmCoord();
      fireEvent.press(screen.getByTestId('stay-register-submit'));

      // ★ 헤드라인 — 503 은 등록을 막지 않는다(저장 정본은 좌표다). POST 가 실제로 나가야 증명된다.
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockMutateAsync).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '이름만 아는 숙소',
          registerRoute: 'PIN',
          lat: PIN.lat,
          lng: PIN.lng,
          coordConfirmed: true,
        }),
      });
    });
  });

  describe('IP-4 · 좌표 미확정: 핀을 맞추기 전에는 등록이 잠긴다 (AC-8 · BR-U1-22)', () => {
    it('핀 탭에 막 들어와 아직 안 움직였으면 안내가 뜨고 등록은 잠기며 눌러도 POST 가 없다', () => {
      render(<StayRegisterPage />);

      goToPinTab();

      // 좌표가 없으니 다음 걸음을 글자로 안내한다(BR-U1-22, 완전일치).
      expect(
        within(screen.getByTestId('stay-register-coordnotice')).getByText(
          '지도에서 위치를 확인해 주세요'
        )
      ).toBeOnTheScreen();

      // 잠금 + 눌러도 무반응(disabled 만으로는 부족 — 실제 POST 0을 함께 잠근다).
      const submit = screen.getByTestId('stay-register-submit');
      expect(submit).toBeDisabled();
      fireEvent.press(submit);
      expect(mockMutateAsync).not.toHaveBeenCalled();

      // 막다른 길이 아니다 — 좌표를 맞출 지도는 이미 떠 있다.
      expect(
        within(screen.getByTestId('stay-register-pin-map')).getByTestId(
          'center-pin-picker'
        )
      ).toBeOnTheScreen();
    });
  });

  // TRIP-1283 — 숙소명 오류는 [등록하기]를 누른 뒤에만(01b Q1=A·Q2·Q3). 빈 이름이면 버튼은 눌리지만
  // 제출 경로가 POST 를 막는다(AC-4 — 버튼 disabled 로 막는 것은 증명이 아니다).
  const NAME_MISSING = '등록하려면 숙소명을 입력해 주세요';

  /** 실기 네이버 지도는 처음 그려질 때 제자리에서 한 번 멈추며 그 중심을 올린다(첫 onCameraIdle).
   * 목은 스스로 onPick 을 안 쏘므로, 목이 받은 center 를 그대로 되돌려 그 사건을 흉내낸다. */
  function simulateFirstIdle(): void {
    const picker = within(
      screen.getByTestId('stay-register-pin-map')
    ).getByTestId('center-pin-picker');
    const { center, onPick } = picker.props as {
      center: MapCenter;
      onPick: (c: MapCenter) => void;
    };
    act(() => {
      onPick(center);
    });
  }

  async function waitPinAddressOk(): Promise<void> {
    await waitFor(() =>
      expect(
        within(screen.getByTestId('stay-register-pin-address')).getByText(
          PIN_ADDRESS
        )
      ).toBeOnTheScreen()
    );
  }

  describe('IP-5 · 진입 직후에는 숙소명 오류가 없다 (AC-1 · A-06)', () => {
    it('핀 탭에 들어와 지도가 첫 중심을 올리고 주소까지 떠도 문구가 없다', async () => {
      mockReverse.mockReturnValue(REVERSE_SUCCESS);
      render(<StayRegisterPage />);

      goToPinTab();
      simulateFirstIdle();
      // 도달 앵커 — 좌표가 담기고 주소 ok 까지 왔다(옛 구현이 문구를 띄우던 바로 그 상태).
      await waitPinAddressOk();

      expect(
        screen.queryAllByTestId('stay-register-name-missing')
      ).toHaveLength(0);
      expect(screen.queryAllByText(NAME_MISSING)).toHaveLength(0);
    });
  });

  describe('IP-6 · 좌표 확정 + 빈 이름으로 누르면 버튼 위에 문구가 뜬다 (AC-2)', () => {
    it('확정까지는 문구가 없고, [등록하기]를 누른 뒤에야 정확한 문구가 뜬다', async () => {
      mockReverse.mockReturnValue(REVERSE_SUCCESS);
      render(<StayRegisterPage />);
      goToPinTab();
      simulateFirstIdle();
      await waitPinAddressOk();
      confirmCoord();

      // 좌표 확정은 "시도"가 아니다(01b — D안 탈락).
      expect(
        screen.queryAllByTestId('stay-register-name-missing')
      ).toHaveLength(0);
      expect(screen.queryAllByText(NAME_MISSING)).toHaveLength(0);

      const submit = screen.getByTestId('stay-register-submit');
      expect(submit).not.toBeDisabled();
      fireEvent.press(submit);

      expect(
        await screen.findByTestId('stay-register-name-missing')
      ).toHaveTextContent(NAME_MISSING);
    });
  });

  describe('IP-7 · 빈 이름이면 여러 번 눌러도 POST 가 없다 (AC-4)', () => {
    it('눌리는 버튼을 3번 눌러도 등록 요청이 0회이고 화면을 떠나지 않는다', async () => {
      mockReverse.mockReturnValue(REVERSE_SUCCESS);
      render(<StayRegisterPage />);
      goToPinTab();
      simulateFirstIdle();
      await waitPinAddressOk();
      confirmCoord();

      // 버튼이 잠겨서 0회인 것은 증명이 아니다 — 눌리는 버튼을 제출 경로가 막아야 한다.
      const submit = screen.getByTestId('stay-register-submit');
      expect(submit).not.toBeDisabled();
      fireEvent.press(submit);
      fireEvent.press(submit);
      fireEvent.press(submit);

      // 누름이 처리됐음을 확인한 뒤에 횟수를 읽는다("아직 안 불렸을 뿐" 배제).
      await screen.findByTestId('stay-register-name-missing');
      expect(mockMutateAsync).toHaveBeenCalledTimes(0);
      expect(mockBack).toHaveBeenCalledTimes(0);
    });
  });

  describe('IP-8 · 이름을 치면 문구가 사라지고, 다시 비우면 다시 뜬다 (AC-3 · 01b Q3)', () => {
    it('시도 뒤 이름 입력으로 문구가 사라지고, 시도 표시는 남아 다시 비우면 곧바로 보인다', async () => {
      mockReverse.mockReturnValue(REVERSE_SUCCESS);
      render(<StayRegisterPage />);
      goToPinTab();
      simulateFirstIdle();
      await waitPinAddressOk();
      confirmCoord();
      fireEvent.press(screen.getByTestId('stay-register-submit'));
      expect(
        await screen.findByTestId('stay-register-name-missing')
      ).toBeOnTheScreen();

      typeName('해운대 아르떼 빌딩');
      expect(
        screen.queryAllByTestId('stay-register-name-missing')
      ).toHaveLength(0);

      typeName('');
      expect(
        screen.getByTestId('stay-register-name-missing')
      ).toHaveTextContent(NAME_MISSING);
    });

    // 5-b W-1 보강 — 위 케이스는 같은 탭 안에서만 본다. 탭을 옮길 때 시도 표시를 지우는 회귀
    // (01b Q3 반전)를 잡으려면 탭 전환 자체를 밟아야 한다. 탭 전환은 후보를 풀지 않으므로
    // 공통 영역의 문구가 그대로 남아야 한다.
    it('시도 뒤 지도 검색 탭으로 옮겨도 시도 표시는 남아 문구가 그대로 보인다 (01b Q3)', async () => {
      mockReverse.mockReturnValue(REVERSE_SUCCESS);
      render(<StayRegisterPage />);
      goToPinTab();
      simulateFirstIdle();
      await waitPinAddressOk();
      confirmCoord();
      fireEvent.press(screen.getByTestId('stay-register-submit'));
      expect(
        await screen.findByTestId('stay-register-name-missing')
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('stay-register-tab-mapsearch'));

      expect(
        screen.getByTestId('stay-register-name-missing')
      ).toHaveTextContent(NAME_MISSING);
    });
  });

  describe('IP-9 · 주소 장애(503)여도 빈 이름으로 누르면 침묵하지 않는다 (AC-2 · AC-4 · 01b Q2 · INV-4)', () => {
    it('503 얼굴에서 확정 뒤 빈 이름으로 누르면 문구가 뜨고 POST 는 0회다', async () => {
      mockReverse.mockReturnValue(REVERSE_503);
      render(<StayRegisterPage />);
      goToPinTab();
      simulateFirstIdle();
      await waitFor(() =>
        expect(
          screen.getByTestId('stay-register-pin-addressfail')
        ).toBeOnTheScreen()
      );
      confirmCoord();

      fireEvent.press(screen.getByTestId('stay-register-submit'));

      expect(
        await screen.findByTestId('stay-register-name-missing')
      ).toHaveTextContent(NAME_MISSING);
      expect(mockMutateAsync).toHaveBeenCalledTimes(0);
    });
  });

  describe('IP-10 · 좌표 미확정이면 이름과 무관하게 잠긴다 (AC-5 · BR-U1-22)', () => {
    it.each(['', '해운대 아르떼 빌딩'])(
      '첫 중심이 담겼지만 확정 전·이름="%s"이면 disabled 이고 눌러도 POST 0회',
      async (name) => {
        mockReverse.mockReturnValue(REVERSE_SUCCESS);
        render(<StayRegisterPage />);
        goToPinTab();
        simulateFirstIdle();
        await waitPinAddressOk();
        typeName(name);

        const submit = screen.getByTestId('stay-register-submit');
        expect(submit).toBeDisabled();
        fireEvent.press(submit);
        expect(mockMutateAsync).toHaveBeenCalledTimes(0);
      }
    );
  });
});

// 옛 StayRegisterPage.back — SB-1 (이 배선을 누르는 유일한 통합)
describe('뒤로가기 배선 (옛 .back)', () => {
  /**
   * SB-1 (TRIP-369 · AC-2 · 02a §3) — e05 뒤로가기의 페이지 배선.
   *
   * 무엇을 보장하나: 화면(`StayRegisterScreen`)이 그린 뒤로가기 컨트롤의 `onBack`이 페이지의
   * `router.back()`으로 이어져 있다. 화면은 라우팅을 모르므로(구조 가드) 이 배선은 반드시
   * 페이지에서만 성립한다 — SR-1(화면)이 "콜백이 불렸나"까지 재고, 이 파일이 그 콜백이 실제
   * 라우터로 가는지를 잰다.
   *
   * 왜 통합 버킷인가: `useRouter`를 목으로 갈아끼워 `router.back()` 호출을 관찰해야 하기 때문이다
   * (프리즈 `StayRegisterPage.integration.test.tsx:48~53`과 동형 목).
   *
   * 서버(msw)는 띄우지 않는다(02a ★K): 마운트 시 `useGetStaysGeocode`는 `enabled:false`로 꺼져
   * 있고 `usePostSavedStays`는 미발화라 HTTP가 0건이다. `@/shared/storage`만 목킹한다 —
   * authedClient(생성 클라이언트의 인증 계층)가 정적으로 물어 expo-secure-store 실물을 로드하려
   * 하므로(프리즈 통합테스트 :33~44 동형).
   */

  beforeEach(() => {
    mockBack.mockClear();
    mockPush.mockClear();
  });

  /** 프리즈 통합테스트(:145~155)와 동형 — gcTime:0이 없으면 기본값(5분) 타이머가 테스트 종료
   * 후에도 살아남아 Node 프로세스를 붙잡는다. */
  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return Wrapper;
  }

  // 리셋 앵커(TRIP-1187) — 핀 describe 의 beforeEach 가 켠 `mockPinStubs` 는 최상위 afterEach 만 끈다.
  // 그 줄이 빠지면 여기서 red 다(기본 순서에서도 — 핀 describe 가 이 describe 보다 앞이다).
  it('핀 관점이 켠 훅 스텁 스위치가 이 관점으로 새지 않는다', () => {
    expect(mockPinStubs).toBe(false);
  });

  describe('SB-1 · 뒤로가기 버튼이 router.back()으로 배선된다 (AC-2)', () => {
    it('페이지를 열고 헤더 뒤로가기를 누르면 이전 화면으로 돌아간다', () => {
      // 준비 — 기본 탭(지도 검색) 상태로 연다. 뒤로가기는 탭과 무관하게 헤더에 있다(02a ★L).
      render(<StayRegisterPage />, { wrapper: createWrapper() });

      // 실행 — 화면이 그린 뒤로가기 컨트롤을 누른다(없으면 getByTestId가 throw).
      fireEvent.press(screen.getByTestId('stay-register-back'));

      // 단언 — 화면의 onBack이 페이지의 router.back()으로 이어져 있다(목 mockBack).
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });
});
