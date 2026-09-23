import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type {
  StayRecommendCandidate,
  StayRecommendView,
} from '@/features/itinerary/model/stayRecommend';
import { server } from '@/mocks/server';
import type {
  AssignBaseRequest,
  BaseAssignment,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { StayRecommendPage } from './StayRecommendPage';

/**
 * TRIP-800 · h15 페이지 배선 — **완료조건 "거점 지정 후 h14 복귀 통합 테스트"** + 무데이터 얼굴(AC-10·11·12).
 *
 * 무엇을 보장하나:
 *  - 🔴 I1 기본 선택(첫 카드)으로 CTA → 실 HTTP `POST /trips/{id}/bases` 본문 = `{savedStayId, dateFrom: 여행 시작,
 *    dateTo: 여행 종료}` → 성공하면 h14 로 복귀(`canGoBack` 이면 `back`).
 *  - 🔴 I2 다른 카드를 고르면 CTA 라벨·보내는 숙소가 함께 바뀐다(고른 카드 = 보낸 숙소).
 *  - 🔴 I3 뒤로 갈 곳이 없으면(딥링크) `replace('/trips/{id}/itinerary')`(01b Q4).
 *  - 🔴 I4 실패(500)는 화면 유지 + 인라인 안내 + 다시 누를 수 있다(INV-4).
 *  - 🔴 I5 같은 틱 이중탭 → 요청 1회(★9). 🔴 I6 요청 중 CTA 비활성(AC-12).
 *  - 🔴 I0 여행 기간을 받기 전엔 CTA 비활성(02a D8) · I7 당일치기(start==end)는 지정 불가 사유 + 요청 0(01b Q3).
 *  - 🔴 E1~E3 추천 데이터가 없으면(미전달·후보 0건) 셸·카드·CTA 없이 정직한 안내 + 동작하는 탈출구(01b Q1).
 *
 * ⚠️ 함정(02a §4): ★9 이중탭은 `isPending` 만으론 못 막는다(ref 가드) · ★10 비활성은 요청 0 짝 ·
 *   ★11 라우터 목에 `canGoBack` 필수 · ★12 무데이터 얼굴 · ★13 `준비` 문구 금지 · ★19 게이트는 꼭 푼다.
 *
 * 왜 통합 버킷인가: "고른 카드가 곧 보낸 숙소"와 "요청 본문의 날짜"가 이 화면의 핵심 계약이라, 훅을 목하면
 *   그 본문이 테스트의 *가정*이 된다. 실 axios → MSW 로 나간 본문을 직접 본다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답·추천 뷰 → 실행=렌더·카드/CTA 누르기 → 단언=나간 요청·라우터 호출·보이는 얼굴.
 */

// 셸이 `<MapView>` 를 마운트하므로 얇은 관찰 목으로 바꾼다(h14 통합 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 호이스트돼 바깥 변수를 못 본다 — `mock` 접두만 예외. `canGoBack` 은 복귀 분기가 부르므로
// 반드시 넣는다(없으면 `canGoBack is not a function` 거짓 red — ★11).
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
  router: {
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '80080080-0000-4000-8000-000000000800';

function trip(startDate: string, endDate: string): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate,
    endDate,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

const HAEUNDAE: StayRecommendCandidate = {
  savedStayId: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: '해운대 그랜드 호텔',
  avgDistanceM: 900,
  maxDistanceM: 1400,
  district: '해운대구',
  priceTier: '중간가',
  price: { amount: 120000, currency: 'KRW' },
  lat: 35.1631,
  lng: 129.1636,
};

const SEOMYEON: StayRecommendCandidate = {
  savedStayId: 'aaaaaaaa-0000-4000-8000-000000000002',
  name: '서면 시티 호텔',
  avgDistanceM: 1200,
  maxDistanceM: 2000,
  district: '부산진구',
  priceTier: '중간가',
  price: { amount: 89000, currency: 'KRW' },
  lat: 35.1578,
  lng: 129.0592,
};

const GWANGALLI: StayRecommendCandidate = {
  savedStayId: 'aaaaaaaa-0000-4000-8000-000000000003',
  name: '광안리 오션뷰',
  avgDistanceM: 1300,
  maxDistanceM: 1800,
  district: '수영구',
  priceTier: '중간가',
  price: { amount: 145000, currency: 'KRW' },
  lat: 35.1532,
  lng: 129.1188,
};

const VIEW: StayRecommendView = {
  summary: '이틀 동선이 해운대·서면 중심이에요',
  center: { lat: 35.157, lng: 129.13 },
  radiusM: 1500,
  routePins: [
    { number: 1, lat: 35.1587, lng: 129.1604 },
    { number: 2, lat: 35.156, lng: 129.145 },
  ],
  candidates: [HAEUNDAE, SEOMYEON, GWANGALLI],
};

/** 테스트가 열어 줄 때까지 응답하지 않는 문(useToggles·useVisitCheck 선례) — "응답 전"을 신호로(★19). */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/** 나간 거점 지정 요청 본문 — 도착 순서대로. */
let postBodies: AssignBaseRequest[] = [];

function assigned(body: AssignBaseRequest): BaseAssignment {
  return {
    baseAssignmentId: 'bbbbbbbb-0000-4000-8000-000000000001',
    savedStayId: body.savedStayId,
    dateFrom: body.dateFrom,
    dateTo: body.dateTo,
  };
}

/** 여행 GET(기본 2박 06-10~06-12) + 거점 POST(기본 201). 케이스가 필요한 쪽만 덮어쓴다. */
function useServer(
  options: {
    trip?: Trip;
    tripGate?: Promise<void>;
    post?: (body: AssignBaseRequest, nth: number) => Promise<Response>;
  } = {}
) {
  server.use(
    http.get(`${BASE}/trips/:tripId`, async () => {
      if (options.tripGate) await options.tripGate;
      return HttpResponse.json(
        options.trip ?? trip('2026-06-10', '2026-06-12')
      );
    }),
    http.post(`${BASE}/trips/:tripId/bases`, async ({ request }) => {
      const body = (await request.json()) as AssignBaseRequest;
      postBodies.push(body);
      if (options.post) return options.post(body, postBodies.length);
      return HttpResponse.json(assigned(body), { status: 201 });
    })
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postBodies = [];
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 실패 즉시, 잔존 타이머 방지(h14 선례). */
function renderPage(recommendations?: StayRecommendView) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <StayRecommendPage tripId={TRIP_ID} recommendations={recommendations} />,
    { wrapper: Wrapper }
  );
}

/** CTA 를 찾고, 여행 기간을 받아 활성화될 때까지 기다린다. */
async function readyCta() {
  const cta = await screen.findByTestId('sheet-cta-button-0');
  await waitFor(() => expect(cta).toBeEnabled());
  return cta;
}

describe('🔴 I0 · 02a D8 — 여행 기간을 받기 전엔 CTA 비활성', () => {
  it('trip GET 대기 중 CTA disabled → 응답 후 enabled', async () => {
    // 준비 — 여행 응답을 문으로 붙잡는다.
    const gate = createGate();
    useServer({ tripGate: gate.opened });
    renderPage(VIEW);

    // 단언 ① — 기간을 모르면 요청을 만들 수 없다 → 비활성.
    const cta = await screen.findByTestId('sheet-cta-button-0');
    expect(cta).toBeDisabled();

    // 실행 — 문을 연다(★19 — 붙잡은 응답은 반드시 푼다).
    gate.release();

    // 단언 ② — 기간을 받으면 활성.
    await waitFor(() => expect(cta).toBeEnabled());
  });
});

describe('🔴 I1 · AC-11 완료조건 — 기본 선택으로 거점 지정 → h14 복귀', () => {
  it('요청 본문 {첫 카드 savedStayId, 여행 시작, 여행 종료} · 성공 후 back 1회', async () => {
    useServer();
    renderPage(VIEW);

    // 기본 선택 = 첫 카드(라벨이 증명한다).
    const cta = await readyCta();
    expect(cta).toHaveTextContent('해운대 그랜드 호텔을 거점으로');

    // 실행
    fireEvent.press(cta);

    // 단언 — h14 로 돌아왔다(정상 진입은 h14 에서 push 라 back 이 주 경로).
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
    // 나간 요청 — 고른 숙소 + 여행 전체 기간(체크아웃 배타, 01b Q3).
    expect(postBodies).toEqual([
      {
        savedStayId: HAEUNDAE.savedStayId,
        dateFrom: '2026-06-10',
        dateTo: '2026-06-12',
      },
    ]);
  });
});

describe('🔴 I2 · AC-4·11 — 다른 카드를 고르면 라벨과 보내는 숙소가 함께 바뀐다', () => {
  it('card-1 press → CTA "서면 시티 호텔을 거점으로" → 본문 savedStayId = 서면', async () => {
    useServer();
    renderPage(VIEW);
    await readyCta();

    // 실행 ① — 두 번째 카드를 고른다.
    fireEvent.press(screen.getByTestId('stay-recommend-card-1'));

    // 단언 ① — 선택 표식과 라벨이 따라왔다.
    expect(screen.getByTestId('stay-recommend-card-1')).toBeSelected();
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '서면 시티 호텔을 거점으로'
    );

    // 실행 ② — 지정.
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

    // 단언 ② — 고른 카드 = 보낸 숙소.
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0].savedStayId).toBe(SEOMYEON.savedStayId);
  });
});

describe('🔴 I3 · 01b Q4 — 뒤로 갈 곳이 없으면 h14 로 replace', () => {
  it('canGoBack=false → replace("/trips/{id}/itinerary") 1회 · back 0', async () => {
    mockCanGoBack.mockReturnValue(false);
    useServer();
    renderPage(VIEW);

    fireEvent.press(await readyCta());

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary`)
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 I4 · AC-11 짝 · INV-4 — 실패는 화면 유지 + 안내 + 재시도 가능', () => {
  it('1회차 500 → 안내·이동 0·CTA 재활성 → 재press 로 2회차 201 → back', async () => {
    // 준비 — 첫 요청만 실패.
    useServer({
      post: async (body, nth) =>
        nth === 1
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : HttpResponse.json(assigned(body), { status: 201 }),
    });
    renderPage(VIEW);

    // 실행 ① — 첫 시도.
    fireEvent.press(await readyCta());

    // 단언 ① — 침묵하지 않는다: 인라인 안내가 뜨고, 화면을 떠나지 않았다.
    expect(
      await screen.findByTestId('stay-recommend-notice')
    ).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(postBodies).toHaveLength(1);

    // 실행 ② — 다시 누를 수 있어야 한다(이중탭 가드가 실패 때 풀려야 한다, ★9).
    const cta = await readyCta();
    fireEvent.press(cta);

    // 단언 ② — 두 번째 요청이 나갔고 성공해 복귀했다.
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(postBodies).toHaveLength(2);
  });
});

describe('🔴 I5 · AC-11 — 같은 틱 이중탭은 요청 1회 (★9)', () => {
  it('CTA 를 연달아 두 번 눌러도 POST 는 한 번 · back 한 번', async () => {
    useServer();
    renderPage(VIEW);
    const cta = await readyCta();

    // 실행 — 연달아 두 번 press. ⚠️ fireEvent 는 press 마다 act 로 리렌더를 끝내므로 두 번째 press 때 CTA 는
    // 이미 isPending 으로 비활성이다 — 이 it 은 "비활성이 press 를 막는다"를 보고, ref 가드는 I5b 가 본다.
    fireEvent.press(cta);
    fireEvent.press(cta);

    // 단언
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(postBodies).toHaveLength(1);
  });
});

/**
 * CTA 의 실제 `onPress` 핸들러를 찾는다. `getByTestId` 는 host 노드를 주는데 host 엔 `onPress` 가 없다 —
 * 위로 올라가 `onPress` 를 가진 첫 조상(Pressable 합성 노드)을 쓴다.
 */
function ctaOnPress(): () => void {
  let node: { props: Record<string, unknown>; parent: unknown } | null =
    screen.getByTestId('sheet-cta-button-0') as unknown as {
      props: Record<string, unknown>;
      parent: unknown;
    };
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent as typeof node;
  }
  if (!node) throw new Error('CTA onPress 를 찾지 못했다');
  return node.props.onPress as () => void;
}

describe('🔴 I5b · AC-11 — 리렌더 없는 같은 틱 이중 호출도 요청 1회 (★9 · 5-b 후속 경고-1)', () => {
  it('한 act 안에서 CTA onPress 를 두 번 불러도 POST 는 한 번 · back 한 번', async () => {
    // 왜 I5 와 따로 있나: `fireEvent.press` 는 호출마다 act 로 감싸 두 press 사이에 리렌더가 끝난다.
    // 그래서 I5 는 `disabled={isPending}` 만으로도 통과한다(ref 가드를 지워도 green — 03b 경고-1 실측).
    // 실기기에서 두 터치가 한 프레임에 들어오는 경우는 리렌더 전이다 — 그걸 막는 것은 in-flight ref 뿐이다.
    useServer();
    renderPage(VIEW);
    await readyCta();
    const onPress = ctaOnPress();

    // 실행 — 한 act 안에서 두 번. 사이에 리렌더가 없으니 두 호출 모두 같은 렌더의 핸들러·isPending 을 본다.
    act(() => {
      onPress();
      onPress();
    });

    // 단언
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(postBodies).toHaveLength(1);
  });
});

describe('🔴 I6 · AC-12 — 지정 요청 중엔 CTA 비활성', () => {
  it('POST 대기 중 disabled → 응답 후 back', async () => {
    // 준비 — 거점 응답을 문으로 붙잡는다.
    const gate = createGate();
    useServer({
      post: async (body) => {
        await gate.opened;
        return HttpResponse.json(assigned(body), { status: 201 });
      },
    });
    renderPage(VIEW);

    // 실행 ① — 지정 시작.
    fireEvent.press(await readyCta());

    // 단언 ① — 요청이 나갔고, 끝나기 전까지 CTA 는 잠겨 있다.
    await waitFor(() => expect(postBodies).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId('sheet-cta-button-0')).toBeDisabled()
    );

    // 실행 ② — 문을 연다(★19).
    gate.release();

    // 단언 ② — 성공 후 복귀.
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });
});

describe('🔴 I7 · 01b Q3 — 당일치기(시작=종료)는 거점 지정 불가: 사유 + 요청 0 (★10)', () => {
  it('CTA disabled · 안내 표시 · 눌러도 POST 0', async () => {
    useServer({ trip: trip('2026-06-10', '2026-06-10') });
    renderPage(VIEW);

    // 여행을 받은 뒤의 상태를 본다(안내가 곧 "기간을 받았다"의 신호).
    expect(
      await screen.findByTestId('stay-recommend-notice')
    ).toBeOnTheScreen();
    const cta = screen.getByTestId('sheet-cta-button-0');
    expect(cta).toBeDisabled();

    fireEvent.press(cta);

    expect(postBodies).toHaveLength(0);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 I8 · AC-6 — 셸 뒤로 · 다른 숙소 둘러보기', () => {
  it('back press → back 1회 / 링크 press → push("/stays") 1회', async () => {
    useServer();
    renderPage(VIEW);
    await readyCta();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('stay-recommend-browse'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/stays');
  });
});

/** 무데이터 얼굴 공통 단언 — 셸·카드·CTA 없음, 정직한 제목, `준비` 문구 0(★12·★13). */
async function expectEmptyFace() {
  const face = await screen.findByTestId('stay-recommend-empty');
  expect(face).toBeOnTheScreen();
  expect(
    screen.getByText('지금은 동선 기준 추천을 보여 드릴 수 없어요')
  ).toBeOnTheScreen();
  // 가짜 추천·동작 안 하는 CTA 가 새지 않는다.
  expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
  expect(screen.queryAllByTestId(/^stay-recommend-card-\d+$/)).toHaveLength(0);
  expect(screen.queryByTestId('sheet-cta-button-0')).toBeNull();
  // TRIP-939 — '준비 중' 류 문구 금지.
  expect(screen.queryAllByText(/준비/)).toHaveLength(0);
  // 탈출구 둘이 실재한다.
  expect(screen.getByTestId('stay-recommend-empty-back')).toBeOnTheScreen();
  expect(screen.getByTestId('stay-recommend-empty-browse')).toBeOnTheScreen();
}

describe('🔴 E1·E2 · AC-10 — 추천 데이터가 없으면 정직한 안내 얼굴 (★12)', () => {
  it('E1 recommendations 미전달(라우트 모양) → 안내 얼굴', async () => {
    useServer();
    renderPage();

    await expectEmptyFace();
  });

  it('E2 후보 0건 → 같은 안내 얼굴(첫 카드 접근·"undefined를 거점으로" 누수 차단)', async () => {
    useServer();
    renderPage({ ...VIEW, candidates: [] });

    await expectEmptyFace();
  });
});

describe('🔴 E3 · AC-10 — 안내 얼굴의 탈출구가 실제로 동작한다', () => {
  it('둘러보기 → push("/stays")', async () => {
    useServer();
    renderPage();

    fireEvent.press(await screen.findByTestId('stay-recommend-empty-browse'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/stays');
  });

  it('뒤로(canGoBack=true) → back 1회', async () => {
    useServer();
    renderPage();

    fireEvent.press(await screen.findByTestId('stay-recommend-empty-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('뒤로(canGoBack=false, 딥링크) → replace("/trips/{id}/itinerary")', async () => {
    mockCanGoBack.mockReturnValue(false);
    useServer();
    renderPage();

    fireEvent.press(await screen.findByTestId('stay-recommend-empty-back'));

    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary`);
    expect(mockBack).not.toHaveBeenCalled();
  });
});
