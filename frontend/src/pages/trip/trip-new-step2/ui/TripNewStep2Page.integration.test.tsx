import type { ReactElement } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { BaseAssignment, SavedStay } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/create-trip';
import { resetPressGuard } from '@/shared/press/pressGuard';

import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-1028 — g02 2/4 의 숙소 주소 조회(`GET /stays/reverse-geocode`)를 "시트를 열 때"로 미룬다.
 *
 * 무엇을 보장하나 — **실제로 나간 요청 수**로 잰다(msw):
 *  - 2/4 에 들어와 시트를 안 열면 요청 0건(AC-1).
 *  - 밤 카드를 처음 눌러 시트를 열 때, 좌표 중복을 걷은 수만큼만 나가고, 응답 전 첫 화면은 섹션 없는
 *    한 줄 목록이다(AC-2).
 *  - 한 번 켜진 조회는 시트를 닫아도 켜져 있다 — 닫았다 다시 열어도(응답 전이든 후든) 추가 요청 0건,
 *    닫혀 있는 동안 새 좌표가 생기면 그것은 묻는다(AC-3 · 01b "닫아도 끄지 않음").
 *  - 받은 주소는 2/4 를 떠났다 하루 뒤 돌아와도 다시 묻지 않는다. 새 좌표만 묻는다(AC-4).
 *
 * 왜 새 파일인가: 형제 두 파일(`TripNewStep2Page.test.tsx`·`.staysheet.integration.test.tsx`)은 주소 훅
 * 모듈을 목으로 바꿔 끼워 요청 수를 원리적으로 못 잰다(브리프 §8⑤). 이 파일은 그 훅을 **실물**로 두고
 * QueryClientProvider + msw 로 돌린다. 저장 숙소·배정·지정 훅은 형제와 같이 목이다 — 이 파일이 재는 것은
 * 역지오코딩 요청의 시점·횟수뿐이다.
 *
 * ⚠️ `jest.mock` 팩토리가 참조하는 바깥 변수는 이름이 `mock` 으로 시작해야 한다(리포 확립 규칙).
 */

// authedClient 가 @/shared/storage 를 정적으로 문다 — expo-secure-store 실물 로드 회피(리포 관례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

interface QueryStub<T> {
  data?: T;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
}

let mockSavedStaysResult: QueryStub<SavedStay[]>;

jest.mock('@/features/trip/model/useSavedStays', () => ({
  useSavedStays: () => mockSavedStaysResult,
}));

jest.mock('@/features/assign-trip-base/model/useTripBases', () => ({
  useTripBases: () => ({
    data: [] as BaseAssignment[],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useAssignBase: () => ({
    isPending: false,
    isError: false,
    mutate: jest.fn(),
  }),
}));

const BASE = 'http://localhost:8080/api/v1';

function stay(over: Partial<SavedStay>): SavedStay {
  return {
    savedStayId: 'stay-x',
    name: '숙소',
    coordConfirmed: true,
    linkedTripIds: [],
    checkIn: null,
    checkOut: null,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

// QA 재현(#036) 좌표 — 훅 통합 테스트와 같은 값. 파라다이스는 중복 등록(#021)이라 같은 좌표로 두 줄.
const JW = stay({
  savedStayId: 'jw',
  name: 'JW 메리어트 동대문',
  lat: 37.57,
  lng: 127.009,
});
const PARA_1 = stay({
  savedStayId: 'para-1',
  name: '파라다이스호텔부산',
  lat: 35.16,
  lng: 129.164,
});
const PARA_2 = stay({ ...PARA_1, savedStayId: 'para-2' });
const NO_COORD = stay({
  savedStayId: 'no-coord',
  name: '좌표 없는 숙소',
  lat: null,
  lng: null,
});
/** AC-4·AC-3 "새 좌표" 역할 — 처음 목록엔 없다가 나중에 저장된 숙소. */
const DENBA = stay({
  savedStayId: 'denba',
  name: '덴바스타 구서점',
  lat: 35.26,
  lng: 129.09,
});

const JW_KEY = '37.57,127.009';
const PARA_KEY = '35.16,129.164';
const DENBA_KEY = '35.26,129.09';

const ADDRESS_BY_LAT: Record<string, string> = {
  '37.57': '서울특별시 종로구 청계천로 279',
  '35.16': '부산광역시 해운대구 해운대해변로 296',
  '35.26': '부산 금정구 구서동 1',
};

/** 실제로 나간 reverse-geocode 요청의 `lat,lng` 목록(나간 순서). */
let requested: string[] = [];
/** true 면 응답을 붙잡아 둔다 — "응답 전" 순간을 결정론적으로 만든다. `releaseAll()` 로 푼다. */
let holdResponses = false;
let held: (() => void)[] = [];

function releaseAll(): void {
  const pending = held;
  held = [];
  pending.forEach((release) => release());
}

/** 요청이 나갈 틈을 준다 — 0건 단언이 "아직 안 나갔을 뿐"으로 공짜 통과하지 않게(실시간 50ms). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/**
 * 후보 카드 **루트**만 고르는 testID 패턴(형제 staysheet 파일과 같은 이유 — 카드 밑 `-photo` 등 하위
 * testID 를 빼야 카드 한 장이 한 번만 센다).
 */
const CARD_ROOT =
  /^trip-base-staysheet-cand-(?!.*-(photo|photo-placeholder|base-badge)$)/;
const SECTION = /^trip-base-staysheet-section-/;

const DAY_MS = 24 * 60 * 60 * 1000;

let client: QueryClient;

/** 앱과 같은 캐시 기본값(gcTime 기본 5분)에 retry 만 끈다 — 실패를 곧바로 떨어뜨리려고(리포 관례). */
function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function page(): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <TripNewStep2Page />
    </QueryClientProvider>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
  requested = [];
  holdResponses = false;
  held = [];
  client = makeClient();
  setAccessToken('valid-access');
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  routerMock.replace.mockClear();

  // 서울 2박(9/26~9/28) — 밤1·밤2 둘 다 서울특별시. 여행지를 담은 **뒤에** 기간을 적는다(TRIP-1027:
  // 시작이 있으면 담을 때마다 끝이 다시 계산된다).
  const store = useTripWizardStore.getState();
  store.reset();
  store.setCreatedTripId('trip-1');
  store.addDestination('서울특별시', 2);
  store.setPeriod(undefined, '2026-09-26', '2026-09-28');

  mockSavedStaysResult = {
    data: [JW, PARA_1, PARA_2, NO_COORD],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  };

  server.use(
    http.get(`${BASE}/stays/reverse-geocode`, async ({ request }) => {
      const url = new URL(request.url);
      const lat = url.searchParams.get('lat') ?? '';
      const lng = url.searchParams.get('lng') ?? '';
      requested.push(`${lat},${lng}`);
      if (holdResponses) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      const address = ADDRESS_BY_LAT[lat];
      // 표에 없는 lat 는 테스트 준비 실수라 500 으로 드러낸다.
      if (address === undefined) return new HttpResponse(null, { status: 500 });
      return HttpResponse.json({ address, lat: Number(lat), lng: Number(lng) });
    })
  );
});

afterEach(() => {
  releaseAll(); // 붙잡힌 응답을 남기지 않는다.
  jest.useRealTimers();
  client.clear();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function openNight(n: number): void {
  fireEvent.press(screen.getByTestId(`trip-base-night-card-${n}`));
}

function closeSheet(): void {
  // 시트 닫힘은 `<BottomSheet onClose>` — 통과형 목이라 시트 본문에서 close 이벤트를 쏘면 조상의
  // onClose 로 올라간다(리포 선례: PlaceAddPage·ManualPlanPage.edit·ItineraryEditPage.slot-time).
  fireEvent(screen.getByTestId('trip-base-staysheet'), 'close');
}

async function waitForSections(): Promise<void> {
  await waitFor(() =>
    expect(
      screen.getByTestId('trip-base-staysheet-section-here')
    ).toBeOnTheScreen()
  );
}

describe('TRIP-1028 P1 · 2/4 에 들어오기만 하면 주소 요청 0건 (AC-1)', () => {
  it('시트를 안 열고 머무는 동안 0건 — 밤 카드를 누르면 그제야 나간다', async () => {
    render(page());

    // 앵커 — 화면은 default 얼굴로 밤 카드 2장을 다 그렸다(아무것도 안 그려 0건인 것이 아니다).
    expect(screen.getAllByTestId(/^trip-base-night-card-\d+$/)).toHaveLength(2);

    await settle();
    expect(requested).toEqual([]);

    // 짝 — 여는 순간 나간다(0건이 "핸들러가 죽어서"가 아님을 같은 it 안에서 보인다).
    openNight(1);
    await waitFor(() => expect(requested).toHaveLength(2));
  });

  it('"숙소 없이 시작하기"로 떠나도 0건', async () => {
    render(page());

    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    // 앵커 — 출구 CTA 가 실제로 눌려 h04 로 replace 됐다.
    expect(routerMock.replace).toHaveBeenCalledTimes(1);

    await settle();
    expect(requested).toEqual([]);
  });
});

describe('TRIP-1028 P2 · 처음 열 때 좌표 중복을 걷은 수만큼만 묻고, 응답 전엔 한 줄 목록 (AC-2)', () => {
  it('숙소 4곳(중복 좌표 2 · 좌표 없음 1) → 열기 전 0건, 열면 2건 · 응답 전 카드 4장 · 섹션 0', async () => {
    holdResponses = true;
    render(page());
    await settle();
    expect(requested).toEqual([]);

    openNight(1);

    // 응답 전 첫 화면 — 섹션 없는 한 줄 목록(1011 규칙 재사용, 브리프 Q1=a).
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(4);
    expect(screen.queryAllByTestId(SECTION)).toHaveLength(0);

    // 좌표 없는 숙소는 안 묻고, 파라다이스 두 줄은 한 번만 — JW·파라다이스 2건(순서 무관).
    await waitFor(() => expect(requested).toHaveLength(2));
    expect([...requested].sort()).toEqual([PARA_KEY, JW_KEY].sort());

    // 응답이 오면 두 섹션으로 갈린다(데이터가 실제로 시트까지 흐른다).
    act(() => releaseAll());
    await waitForSections();
    expect(requested).toHaveLength(2);
  });
});

describe('TRIP-1028 P3 · 한 번 켜진 조회는 닫아도 켜져 있다 (AC-3)', () => {
  it('응답 뒤 닫고 같은 밤·다른 밤을 다시 열어도 추가 요청 0건', async () => {
    render(page());
    openNight(1);
    await waitForSections();
    expect(requested).toHaveLength(2);

    closeSheet();
    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();
    openNight(1);
    closeSheet();
    openNight(2);

    // 다시 연 시트도 곧바로 섹션이 있다(캐시에서) — 그리고 새 요청은 없다.
    expect(
      screen.getByTestId('trip-base-staysheet-section-here')
    ).toBeOnTheScreen();
    await settle();
    expect(requested).toHaveLength(2);
  });

  it('응답이 오기 전에 닫았다 다시 열어도 추가 요청 0건 (조회가 시트 수명에 묶이면 취소·재요청된다 — 브리프 §8①)', async () => {
    holdResponses = true;
    render(page());
    openNight(1);
    await waitFor(() => expect(requested).toHaveLength(2));

    // 응답 전 닫기 → 다시 열기.
    closeSheet();
    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();
    await settle();
    openNight(1);
    await settle();

    act(() => releaseAll());
    await waitForSections();
    await settle();
    expect(requested).toHaveLength(2);
  });

  it('닫혀 있는 동안 새 숙소가 저장되면(새 좌표) 다시 열지 않아도 그 좌표를 묻는다 (01b "닫아도 끄지 않음")', async () => {
    const { rerender } = render(page());
    openNight(1);
    await waitForSections();
    closeSheet();
    expect(requested).toHaveLength(2);

    // 둘러보기(/stays push)에서 숙소를 하나 더 저장하고 돌아온 상황 — 2/4 는 스택에 남아 있고 저장 숙소
    // 목록만 새로 온다. 시트는 닫힌 채다.
    mockSavedStaysResult = {
      ...mockSavedStaysResult,
      data: [JW, PARA_1, PARA_2, NO_COORD, DENBA],
    };
    rerender(page());

    await waitFor(() => expect(requested).toHaveLength(3));
    expect(requested[2]).toBe(DENBA_KEY);
    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();
  });
});

describe('TRIP-1028 P4 · 받은 주소는 앱 세션 동안 기억한다 (AC-4)', () => {
  it('2/4 를 떠났다가 하루 뒤 돌아와 열면 받은 좌표는 다시 안 묻고, 새로 저장한 숙소 좌표만 묻는다', async () => {
    const first = render(page());
    openNight(1);
    await waitForSections();
    expect(requested).toHaveLength(2);

    // 2/4 를 떠난다(언마운트 → 관찰자 0명이라 캐시 정리 타이머가 여기서 걸린다) → 하루를 흘린다.
    // 가짜 시계는 이 구간에만 켠다 — 요청·응답(msw)은 진짜 시계 구간에서만 오간다.
    jest.useFakeTimers();
    try {
      first.unmount();
      act(() => {
        jest.advanceTimersByTime(DAY_MS);
      });
    } finally {
      jest.useRealTimers();
    }

    // 그 사이 숙소를 하나 더 저장했다.
    mockSavedStaysResult = {
      ...mockSavedStaysResult,
      data: [JW, PARA_1, PARA_2, NO_COORD, DENBA],
    };
    render(page());

    // 다시 들어와도 열기 전엔 0건(AC-1 은 재진입에도 성립).
    await settle();
    expect(requested).toHaveLength(2);

    openNight(1);
    await waitFor(() => expect(requested).toHaveLength(3));
    expect(requested[2]).toBe(DENBA_KEY);
    await settle();
    expect(requested).toHaveLength(3);
  });
});

describe('🔴 TRIP-1074 P5 · 받은 주소로 카드 동네 라벨을 붙여도 요청은 늘지 않는다 (AC-6)', () => {
  it('섹션이 뜬 뒤 카드 서브라인이 시군구 라벨이고, reverse-geocode 는 여전히 2건이다', async () => {
    render(page());

    openNight(1);
    await waitForSections();

    // 실물 훅의 주소가 라벨까지 흐른다(이 파일 픽스처는 날짜가 없어 라벨만 남는다).
    expect(
      screen.getByTestId('trip-base-staysheet-cand-jw-meta')
    ).toHaveTextContent('종로구');
    expect(
      screen.getByTestId('trip-base-staysheet-cand-para-1-meta')
    ).toHaveTextContent('해운대구');
    expect(
      screen.getByTestId('trip-base-staysheet-cand-para-2-meta')
    ).toHaveTextContent('해운대구');
    // 좌표 없는 숙소 — 주소도 날짜도 없어 서브라인이 없다.
    expect(
      screen.queryByTestId('trip-base-staysheet-cand-no-coord-meta')
    ).toBeNull();

    // 라벨 계산이 조회를 새로 걸지 않는다 — 좌표 중복을 걷은 2건 그대로.
    await settle();
    expect(requested).toHaveLength(2);
  });
});
