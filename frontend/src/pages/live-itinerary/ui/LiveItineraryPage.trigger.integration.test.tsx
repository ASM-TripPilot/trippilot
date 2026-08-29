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
import type {
  Itinerary,
  Trigger,
  TriggerList,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-561 · AC-1·2·3·4·6 — i08 트리거 칩 + i01 변수감지 배너의 **페이지 배선**을 실 HTTP로 태운다.
 *
 * 무엇을 보장하나:
 *  - 서버가 발화 중 트리거를 주면 칩(+대안 보기 어포던스)이 뜨고, 영향 슬롯(`slotKey` 매칭)에
 *    배너가 뜨며 서버 `reason` 이 배너 문구에 흐른다(AC-1). 슬롯 시각은 계획값 그대로(AC-3).
 *  - 빈 목록이면 칩·배너 둘 다 미노출(AC-2). MANUAL 만 실린 응답도 미노출(AC-6b 필터).
 *  - chevron press → `/trips/{id}/planb` 로 router.push + scope 전달(NONE/null→PARTIAL_SLOTS, AC-4).
 *  - × press → dismiss POST(triggerId) + GET /triggers 무효화(refetch)(AC-6a).
 *
 * 왜 통합 버킷인가(기존 LiveItineraryPage.integration.test.tsx 철학 계승): 표시 게이트·MANUAL
 * 필터·라우팅·억제가 실 조회 상태와 라우터/뮤테이션의 조합에서 갈린다 — 훅을 목킹하면 그 조합이
 * 테스트의 가정이 되어 버린다. 그래서 msw 로 트리거 목록을 서빙해 전 경로를 태운다.
 *
 * ⚠️ 통과형 목 사각(★3): router.push/dismiss POST 는 "불렸다·이 인자로 나갔다"까지만 잰다 —
 * 실제 네비게이션·서버 부작용은 6-b 실기(`live-itinerary` 프리뷰) 소관.
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

// chevron press → router.push(planb), 탭바 → router.replace. 정적 싱글턴 목(useRouter 훅 아님).
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

/** router.push 인자를 문자열로 정규화 — 문자열/객체 두 형태를 모두 받아 경로·쿼리만 잰다(★3). */
function hrefString(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  const obj = (arg ?? {}) as {
    pathname?: string;
    params?: Record<string, unknown>;
  };
  const qs = Object.entries(obj.params ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return qs ? `${obj.pathname ?? ''}?${qs}` : (obj.pathname ?? '');
}

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

describe('LiveItineraryPage · 트리거 표면', () => {
  it('I-T1 발화 중(매칭 slotKey)이면 칩+대안보기 어포던스와 슬롯 배너(reason)를 그린다 (AC-1)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger({ kind: 'WEATHER' })] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-trigger-chip')).toBeTruthy()
    );
    // 대안 보기 어포던스(chevron)가 존재.
    expect(
      screen.getByTestId('execution-live-trigger-alternative')
    ).toBeTruthy();
    // 영향 슬롯에 배너가 뜨고 서버 reason 이 문구에 흐른다(동적 축, regex 부분일치).
    expect(screen.getByTestId('execution-live-trigger-banner')).toBeTruthy();
    expect(screen.getByText(/비 예보 70%/)).toBeTruthy();
  });

  it('I-T2 발화 없음(빈 목록)이면 칩·배너 둘 다 미노출이다 (AC-2)', async () => {
    server.use(...baseHandlers({ triggers: [] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 화면(타임라인)은 뜨되 트리거 표면은 없다.
    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );
    expect(screen.queryByTestId('execution-live-trigger-chip')).toBeNull();
    expect(screen.queryByTestId('execution-live-trigger-banner')).toBeNull();
  });

  it('I-T3 어떤 트리거가 떠도 슬롯 시각 텍스트는 계획값 그대로다 (AC-3 · BR-U4-35)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger({ kind: 'DELAY' })] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-trigger-chip')).toBeTruthy()
    );
    // 계획 시각 10:00 그대로("도착 예정") — 지연 반영 재추정 0. 문자열=완전일치(RNTL).
    expect(
      screen.getByTestId(`execution-live-slot-time-${SLOT_KEY}`)
    ).toHaveTextContent('10:00 도착 예정');
  });

  it('I-T4a [대안 보기]는 그 scope(FULL_DAY)로 planb 세션을 연다 (AC-4 pass-through)', async () => {
    server.use(
      ...baseHandlers({ triggers: [mkTrigger({ scope: 'FULL_DAY' })] })
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByTestId('execution-live-trigger-alternative')
      ).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('execution-live-trigger-alternative'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const href = hrefString(mockPush.mock.calls[0][0]);
    expect(href).toContain(`/trips/${TRIP_ID}/planb`);
    expect(href).toContain('scope=FULL_DAY');
    expect(href).toContain('triggerId=trg-1');
  });

  it('I-T4b scope=NONE 이면 기본값 PARTIAL_SLOTS 로 세션을 연다 (AC-4 기본값)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger({ scope: 'NONE' })] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByTestId('execution-live-trigger-alternative')
      ).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('execution-live-trigger-alternative'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const href = hrefString(mockPush.mock.calls[0][0]);
    expect(href).toContain(`/trips/${TRIP_ID}/planb`);
    expect(href).toContain('scope=PARTIAL_SLOTS');
  });

  it('I-T5 ×(끄기)를 누르면 dismiss(triggerId) POST + GET /triggers 무효화가 나간다 (AC-6a)', async () => {
    server.use(
      ...baseHandlers({ triggers: [mkTrigger({ kind: 'WEATHER' })] }),
      dismissHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('execution-live-trigger-dismiss')).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('execution-live-trigger-dismiss'));

    // dismiss 가 triggerId 를 실어 나간다(경로에 trg-1 포함).
    await waitFor(() =>
      expect(
        hitCount(`POST /api/v1/trips/${TRIP_ID}/triggers/trg-1/dismiss`)
      ).toBe(1)
    );
    // 억제 성공 → GET /triggers 무효화 → refetch(최초 1 + 재조회 → ≥2).
    await waitFor(() =>
      expect(
        hitCount(`GET /api/v1/trips/${TRIP_ID}/triggers`)
      ).toBeGreaterThanOrEqual(2)
    );
  });

  it('I-T6 MANUAL 만 실린 응답이면 칩·배너 미노출이다 (AC-6b 필터)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger({ kind: 'MANUAL' })] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );
    expect(screen.queryByTestId('execution-live-trigger-chip')).toBeNull();
    expect(screen.queryByTestId('execution-live-trigger-banner')).toBeNull();
  });

  it('I-T7 slotKey=null(날짜 전체) 트리거는 칩만 뜨고 슬롯 배너는 없다 (AC-1 경계 · 칩=상시/배너=슬롯)', async () => {
    server.use(...baseHandlers({ triggers: [mkTrigger({ slotKey: null })] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-trigger-chip')).toBeTruthy()
    );
    // 매칭 슬롯이 없으므로 슬롯 배너는 안 뜬다(칩이 전체-날짜 케이스를 대행).
    expect(screen.queryByTestId('execution-live-trigger-banner')).toBeNull();
  });
});
