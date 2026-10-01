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

import { WeatherCloudGlyph } from '@/features/execution/ui/ExecutionGlyphs';
import { server } from '@/mocks/server';
import type {
  Itinerary,
  Trigger,
  TriggerList,
} from '@/shared/api/generated/schemas';
import { getGetTripsTripIdTriggersQueryKey } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-561 → TRIP-748 · i02 트리거 표면의 **페이지 배선**을 실 HTTP로 태운다.
 *
 * 무엇을 보장하나:
 *  - 서버가 발화 중 트리거를 주면 지도 위 알약이 `{라벨} · {대상}` 카피로 뜨고(D2 — 대상은 slotKey
 *    매칭 슬롯의 이름·도착시), 그 슬롯 카드의 "예정" 자리에 라벨 배지가 선다(AC-2·AC-5).
 *  - 카드 아래 배너 문장·×(끄기)·구름 아이콘은 없다. 서버 reason("비 예보 70%")도 허브에 안 보인다(AC-6).
 *  - 매칭 실패(slotKey null·다른 날)면 알약은 라벨만, 배지는 "예정" 그대로(AC-2 폴백).
 *  - 빈 목록·MANUAL 만이면 알약 없음(AC-6b 필터). 슬롯 시각은 계획값 그대로(BR-U4-35).
 *  - (TRIP-749 계약 플립) 알약 press 는 더 이상 바로 planb 로 가지 않고 i03 위험 상세 시트를 연다.
 *    scope 전달(NONE/null→PARTIAL_SLOTS) 검사는 시트 [대안 보기] 경로로
 *    `LiveItineraryPage.riskSheet.integration.test.tsx` R-I5a/b 에 옮겼다(옛 I-T4a/b).
 *  - 숨김 경로(일자 칩·FAB·시트 스크롤)를 눌러도 dismiss POST 는 0회다 — 로컬 숨김일 뿐(D3 · AC-7).
 *
 * 왜 통합 버킷인가(기존 LiveItineraryPage.integration.test.tsx 철학 계승): 표시 게이트·MANUAL
 * 필터·slotKey 매칭·라우팅이 실 조회 상태와 라우터의 조합에서 갈린다 — 훅을 목킹하면 그 조합이
 * 테스트의 가정이 되어 버린다. 그래서 msw 로 트리거 목록을 서빙해 전 경로를 태운다.
 *
 * ⚠️ 통과형 목 사각: router.push 는 "불렸다·이 인자로 나갔다"까지만 잰다 — 실제 네비게이션·실제
 * 스크롤 제스처는 6-b 실기(`live-trigger-*` 프리뷰) 소관.
 */

// authedClient(생성 클라이언트 인증 계층)가 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 알약 press → router.push(planb). 정적 싱글턴 목(useRouter 훅 아님) — 렌더 중엔 부르지 않는다(02a ★14).
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const POI = 'p1';
const SLOT_KEY = `${TODAY}#${POI}`;

/** 오늘 1일 1슬롯(upcoming). 시각은 계획값 10:00–11:00, 재추정 없음. */
const itinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: TODAY,
        slots: [
          {
            poiId: POI,
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '해운대 해변',
            distanceRange: null,
            openingHours: null,
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

const trip = () => ({
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: TODAY,
  endDate: '2026-08-22',
  party: 2,
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

/** 트리거 하나. kind·slotKey·scope 만 케이스가 바꾼다. */
const mkTrigger = (over: Partial<Trigger> = {}): Trigger =>
  ({
    triggerId: 'trg-1',
    kind: 'WEATHER',
    affectedDate: TODAY,
    slotKey: SLOT_KEY,
    reason: '비 예보 70%',
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-08-20T09:00:00Z',
    ...over,
  }) as Trigger;

const tripHandler = () =>
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()));
const itineraryHandler = () =>
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(itinerary())
  );
/** 방문 기록은 빈 목록(전 슬롯 upcoming). 등록해 두어 unhandled 소음 0. */
const visitsHandler = () =>
  http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
    HttpResponse.json({ visits: [] })
  );
const triggersHandler = (list: TriggerList) =>
  http.get(`${BASE}/trips/:tripId/triggers`, () => HttpResponse.json(list));
const dismissHandler = () =>
  http.post(`${BASE}/trips/:tripId/triggers/:triggerId/dismiss`, () =>
    HttpResponse.json(mkTrigger())
  );

/** 케이스마다 바뀌는 것은 트리거 목록뿐 — 나머지 4핸들러는 항상 등록(unhandled 0). */
const baseHandlers = (list: TriggerList) => [
  itineraryHandler(),
  tripHandler(),
  visitsHandler(),
  triggersHandler(list),
];

let observedHits: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  observedHits = [];
  setAccessToken('a');
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockReplace.mockClear();
  mockPush.mockClear();
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CHIP = 'execution-live-trigger-chip';
const LABEL = 'execution-live-trigger-label';
const STATUS = `execution-live-slot-status-${SLOT_KEY}`;
const DISMISS_PATH = `POST /api/v1/trips/${TRIP_ID}/triggers/trg-1/dismiss`;

/** 음성 단언("안 나갔다") 전에 요청이 나갈 틈을 준다(02a ★10). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/** 시트 본문 스크롤 시작 — 통과형 목에 실린 prop 을 직접 부른다(02a ★3). */
function fireSheetScrollBeginDrag(): void {
  const nodes = screen.root.findAll(
    (node) => typeof node.props?.onScrollBeginDrag === 'function'
  );
  if (nodes.length === 0) {
    throw new Error(
      '시트 본문 스크롤 뷰에 onScrollBeginDrag 가 달려 있지 않다'
    );
  }
  act(() => {
    (nodes[nodes.length - 1].props.onScrollBeginDrag as (e: unknown) => void)({
      nativeEvent: {},
    });
  });
}

describe('LiveItineraryPage · i02 트리거 표면 (TRIP-748)', () => {
  it.each([
    ['WEATHER', '비 예보 · 해운대 해변 10시', '비 예보'],
    ['DELAY', '이동 지연 · 해운대 해변 방면', '이동 지연'],
    ['CLOSURE', '휴무 · 해운대 해변 주변 시설', '휴무'],
  ] as const)(
    'I-T1 %s(매칭 slotKey) → 알약 카피 "%s" + 슬롯 배지 "%s", 배너·×·reason·구름 아이콘은 없다 (AC-2·5·6)',
    async (kind, copy, badge) => {
      server.use(...baseHandlers({ triggers: [mkTrigger({ kind })] }));

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
        wrapper,
      });

      await waitFor(() => expect(screen.getByTestId(CHIP)).toBeTruthy());
      expect(screen.getByTestId(LABEL)).toHaveTextContent(copy);
      expect(screen.getByTestId(STATUS)).toHaveTextContent(badge);

      expect(screen.queryByTestId('execution-live-trigger-banner')).toBeNull();
      expect(screen.queryByTestId('execution-live-trigger-dismiss')).toBeNull();
      expect(screen.queryByText(/70%/)).toBeNull();
      expect(screen.UNSAFE_queryAllByType(WeatherCloudGlyph)).toHaveLength(0);
    }
  );

  it('I-T2 발화 없음(빈 목록)이면 알약이 없고 배지는 "예정" 이다 (AC-2)', async () => {
    server.use(...baseHandlers({ triggers: [] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );
    expect(screen.queryByTestId(CHIP)).toBeNull();
    expect(screen.queryByTestId('execution-live-trigger-banner')).toBeNull();
    expect(screen.getByTestId(STATUS)).toHaveTextContent('예정');
  });

  it('I-T3 어떤 트리거가 떠도 슬롯 시각 텍스트는 계획값 그대로다 (AC-3 · BR-U4-35)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger({ kind: 'DELAY' })] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() => expect(screen.getByTestId(CHIP)).toBeTruthy());
    // 계획 시각 10:00 그대로("도착 예정") — 지연 반영 재추정 0. 문자열=완전일치(RNTL).
    expect(
      screen.getByTestId(`execution-live-slot-time-${SLOT_KEY}`)
    ).toHaveTextContent('10:00 도착 예정');
  });

  it('I-T5 숨김 경로(일자 칩·FAB·시트 스크롤)는 알약만 숨기고 dismiss POST 는 0회다 (D3 · AC-7)', async () => {
    server.use(
      ...baseHandlers({ triggers: [mkTrigger({ kind: 'WEATHER' })] }),
      // 등록은 해 둔다 — 만약 나가면 unhandled 오류가 아니라 카운트로 잡히게(02a ★10).
      dismissHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    await waitFor(() => expect(screen.getByTestId(CHIP)).toBeTruthy());
    // 짝 앵커 — 요청 관측 배선이 살아 있다(GET /triggers 가 잡혔다).
    expect(
      hitCount(`GET /api/v1/trips/${TRIP_ID}/triggers`)
    ).toBeGreaterThanOrEqual(1);

    fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
    expect(screen.queryByTestId(CHIP)).toBeNull();
    fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
    fireSheetScrollBeginDrag();
    await settle();

    expect(screen.queryByTestId(CHIP)).toBeNull();
    expect(hitCount(DISMISS_PATH)).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('I-T8 숨긴 뒤 같은 트리거로 재조회되면 숨긴 채, 다른 triggerId(trg-2)가 오면 알약이 다시 뜬다 (D3 · 5-b 경고-1)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger()] }));
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    const refetchTriggers = () =>
      act(() =>
        client.invalidateQueries({
          queryKey: getGetTripsTripIdTriggersQueryKey(TRIP_ID),
        })
      );
    const TRIGGERS_GET = `GET /api/v1/trips/${TRIP_ID}/triggers`;

    render(
      <QueryClientProvider client={client}>
        <LiveItineraryPage tripId={TRIP_ID} today={TODAY} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId(CHIP)).toBeTruthy());
    expect(screen.getByTestId(LABEL)).toHaveTextContent(
      '비 예보 · 해운대 해변 10시'
    );

    fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
    expect(screen.queryByTestId(CHIP)).toBeNull();

    // ① 같은 트리거(trg-1)로 재조회 — 숨긴 채다(재조회마다 다시 뜨면 "숨김"이 무의미).
    const before = hitCount(TRIGGERS_GET);
    await refetchTriggers();
    await waitFor(() => expect(hitCount(TRIGGERS_GET)).toBe(before + 1));
    await settle();
    expect(screen.queryByTestId(CHIP)).toBeNull();

    // ② 같은 kind(WEATHER)·다른 triggerId — kind 로 키를 잡으면 여기서 안 뜬다.
    //    slotKey=null 이라 카피가 라벨만으로 바뀌어, 새 트리거의 알약임이 글자로도 구분된다.
    server.use(
      triggersHandler({
        triggers: [mkTrigger({ triggerId: 'trg-2', slotKey: null })],
      })
    );
    await refetchTriggers();

    await waitFor(() => expect(screen.getByTestId(CHIP)).toBeTruthy());
    expect(screen.getByTestId(LABEL)).toHaveTextContent('비 예보');
  });

  it('I-T6 MANUAL 만 실린 응답이면 알약이 없고 배지는 "예정" 이다 (AC-6b 필터)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger({ kind: 'MANUAL' })] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );
    expect(screen.queryByTestId(CHIP)).toBeNull();
    expect(screen.getByTestId(STATUS)).toHaveTextContent('예정');
  });

  it.each([
    ['slotKey=null(날짜 전체)', null],
    ['slotKey 가 다른 날', '2026-08-21#p1'],
  ])(
    'I-T7 %s 이면 알약은 라벨만("비 예보"), 배지는 "예정" 그대로다 (AC-2 폴백)',
    async (_name, slotKey) => {
      server.use(...baseHandlers({ triggers: [mkTrigger({ slotKey })] }));

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
        wrapper,
      });

      await waitFor(() => expect(screen.getByTestId(CHIP)).toBeTruthy());
      expect(screen.getByTestId(LABEL)).toHaveTextContent('비 예보');
      expect(screen.getByTestId(STATUS)).toHaveTextContent('예정');
    }
  );
});
