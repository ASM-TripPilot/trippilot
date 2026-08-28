import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { StayRegisterPage } from './StayRegisterPage';

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

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다
// (StaySearchPage.integration.test.tsx:19-29와 동형).
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
// 시작하는 변수만 예외다(02a ★5). 여기서는 엘리먼트를 만들지 않으므로 인라인 팩토리로 충분하다.
const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

/** authWiring.integration.test.ts:59와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
// computed 접근이 선언과 한 문장이면 eslint-plugin-expo의 no-dynamic-env-var에 걸린다 —
// 선언과 대입을 분리한다(KakaoMapView.test.tsx:38-40 선례).
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

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

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedUrls.push(request.url);
  });
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

afterEach(() => {
  server.resetHandlers();
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

afterAll(() => server.close());

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

describe('I-2 · 날짜 없이도 등록된다 (AC-5)', () => {
  it('체크인·체크아웃을 건드리지 않아도 등록이 성립하고 요청에 날짜가 실리지 않는다', async () => {
    render(<StayRegisterPage />, { wrapper: createWrapper() });

    searchFor('busan');
    await selectAndConfirm(0);
    fireEvent.press(screen.getByTestId('stay-register-submit'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));

    // "전송되지 않거나 null" 둘 다 AC를 만족한다 — 두 형태를 함께 받아들인다.
    expect(postedBodies[0].checkIn ?? null).toBeNull();
    expect(postedBodies[0].checkOut ?? null).toBeNull();
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

    const confirm = within(sheet).getByTestId('stay-register-mapsheet-confirm');
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
    expect(screen.getByTestId('stay-register-search-input')).toHaveDisplayValue(
      'busan'
    );
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
