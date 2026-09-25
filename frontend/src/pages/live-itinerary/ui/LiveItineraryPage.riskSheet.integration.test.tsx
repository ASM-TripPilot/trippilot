import type { ReactNode } from 'react';
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
import type {
  Itinerary,
  Trigger,
  TriggerList,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-749 · AC-7 — i03 위험 상세 시트의 **페이지 배선**을 실 HTTP 로 태운다.
 *
 * 무엇을 보장하나:
 *  - 알약을 누르면 planb 로 바로 가지 않고(push 0) 위험 상세 시트가 **허브 밖 형제로** 열린다.
 *    시트 제목 = 서버 reason, eyebrow = kind 카테고리, 영향 행 = slotKey 매칭 슬롯, 배지 = 실제 kind.
 *  - 영향 행은 slotKey 안의 **날짜**에서 찾는다 — 허브가 오늘을 보고 있어도 내일 슬롯이 뜬다(Q3).
 *    slotKey 가 없으면 행을 통째로 뺀다(G6).
 *  - [대안 보기] → 시트를 닫고 `/trips/{id}/planb?scope=…&triggerId=…` 로 push(옛 748 I-T4a/b 이관 —
 *    NONE→PARTIAL_SLOTS). 스크림 → 닫기만(push 0 · dismiss POST 0).
 *  - 시트가 열려도 지도 알약은 그대로다(D3 숨김 아님). 트리거가 없으면 시트도 없다.
 *
 * 왜 통합 버킷인가: 열림 상태·트리거 선택·슬롯 조인·사영·라우팅이 실 조회 상태와 라우터의 조합에서
 * 갈린다(`LiveItineraryPage.trigger.integration.test.tsx` 철학 계승 — 훅을 목킹하지 않는다).
 *
 * ⚠️ 통과형 목 사각: 시트 목은 `index` 를 무시하고 항상 그린다 — 그래서 "열림"은 **마운트 여부**로만
 * 잰다(02a ★1). 실제 딤 전면 커버·끌어 닫기·i04 가 위에 겹쳐 뜨는 모습은 실기(AC-V2).
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

// 정적 싱글턴 router 목 — 렌더 중엔 부르지 않는다(748 02a ★14).
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
const TOMORROW = '2026-08-21';
const REASON = '17시 이후 비 예보 70%';

const baseSlot = {
  endAt: '18:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  distanceRange: null,
  tags: [],
};

/** 오늘 2곳(해운대가 2번째) + 내일 1곳. 영업시간은 데이터로만 흘린다(INV-3 스캔 밖). */
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
            ...baseSlot,
            poiId: 'p0',
            startAt: '09:30:00',
            nameKo: '감천문화마을',
            category: null,
            openingHours: null,
          },
          {
            ...baseSlot,
            poiId: 'p1',
            startAt: '17:00:00',
            nameKo: '해운대 해변',
            category: '해변',
            openingHours: '24시간 개방',
          },
        ],
      },
      {
        date: TOMORROW,
        slots: [
          {
            ...baseSlot,
            poiId: 'p9',
            startAt: '10:00:00',
            nameKo: '태종대',
            category: null,
            openingHours: null,
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
    slotKey: `${TODAY}#p1`,
    reason: REASON,
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-08-20T09:00:00Z',
    ...over,
  }) as Trigger;

const baseHandlers = (list: TriggerList) => [
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(itinerary())
  ),
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
  http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
    HttpResponse.json({ visits: [] })
  ),
  http.get(`${BASE}/trips/:tripId/triggers`, () => HttpResponse.json(list)),
];
const dismissHandler = () =>
  http.post(`${BASE}/trips/:tripId/triggers/:triggerId/dismiss`, () =>
    HttpResponse.json(mkTrigger())
  );

/** router.push 인자를 문자열로 정규화 — 문자열/객체 두 형태를 모두 받아 경로·쿼리만 잰다. */
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

const CHIP = 'execution-live-trigger-chip';
const ALT = 'execution-live-trigger-alternative';
const SHEET = 'planb-risk-sheet';
const DISMISS_PATH = `POST /api/v1/trips/${TRIP_ID}/triggers/trg-1/dismiss`;

/** 음성 단언("안 나갔다") 전에 요청이 나갈 틈을 준다(748 02a ★10). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/** 준비 공통 — 트리거 목록으로 페이지를 띄우고 알약이 뜰 때까지 기다린다. */
async function renderWithTriggers(triggers: Trigger[]): Promise<void> {
  server.use(...baseHandlers({ triggers }), dismissHandler());
  render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
  await waitFor(() => expect(screen.getByTestId(CHIP)).toBeTruthy());
}

function expectBadges(texts: [string, string, string]): void {
  expect(screen.getByTestId('planb-risk-watch-weather')).toHaveTextContent(
    texts[0]
  );
  expect(screen.getByTestId('planb-risk-watch-delay')).toHaveTextContent(
    texts[1]
  );
  expect(screen.getByTestId('planb-risk-watch-closure')).toHaveTextContent(
    texts[2]
  );
}

describe('LiveItineraryPage · i03 위험 상세 시트 (TRIP-749 AC-7)', () => {
  it('R-I1 알약 press → 허브 밖에 시트가 열리고(push 0) 제목·eyebrow·영향 행·배지가 실데이터로 찬다', async () => {
    await renderWithTriggers([mkTrigger()]);

    // press 전 — 시트는 마운트돼 있지 않고, 허브에 reason 은 없다(748 I-T1 과 공존).
    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(screen.queryByText(/70%/)).toBeNull();

    fireEvent.press(screen.getByTestId(ALT));

    expect(screen.getByTestId(SHEET)).toBeTruthy();
    // 형제 마운트 — 허브(execution-live-screen) 서브트리 밖이다(02a ★3).
    expect(
      within(screen.getByTestId('execution-live-screen')).queryByTestId(SHEET)
    ).toBeNull();
    expect(screen.getByTestId('planb-risk-title')).toHaveTextContent(REASON);
    expect(screen.getByTestId('planb-risk-eyebrow')).toHaveTextContent(
      '위험 요소 · 날씨'
    );
    expect(screen.getByTestId('planb-risk-affected-time')).toHaveTextContent(
      '17:00'
    );
    expect(screen.getByTestId('planb-risk-affected-name')).toHaveTextContent(
      '해운대 해변'
    );
    expect(screen.getByTestId('planb-risk-affected-meta')).toHaveTextContent(
      '2번째 · 해변 · 24시간 개방'
    );
    expectBadges(['날씨 · 활성', '이동 · 정상', '영업 · 정상']);

    // 알약은 그대로(D3 숨김 경로 아님), 아직 아무 데도 안 갔다.
    expect(screen.getByTestId(CHIP)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('R-I2 DELAY 트리거면 eyebrow 는 "위험 요소 · 이동", 이동 배지만 활성이다', async () => {
    await renderWithTriggers([mkTrigger({ kind: 'DELAY' })]);

    fireEvent.press(screen.getByTestId(ALT));

    expect(screen.getByTestId('planb-risk-eyebrow')).toHaveTextContent(
      '위험 요소 · 이동'
    );
    expectBadges(['날씨 · 정상', '이동 · 활성', '영업 · 정상']);
  });

  it('R-I3 slotKey 가 내일 슬롯이면 허브는 오늘을 보고 있어도 영향 행은 내일 그 장소다 (Q3)', async () => {
    await renderWithTriggers([mkTrigger({ slotKey: `${TOMORROW}#p9` })]);

    fireEvent.press(screen.getByTestId(ALT));

    expect(screen.getByTestId('planb-risk-affected-time')).toHaveTextContent(
      '10:00'
    );
    expect(screen.getByTestId('planb-risk-affected-name')).toHaveTextContent(
      '태종대'
    );
    expect(screen.getByTestId('planb-risk-affected-meta')).toHaveTextContent(
      '1번째'
    );
  });

  it('R-I4 slotKey 가 없으면(날짜 전체 영향) 시트는 열리되 영향 행은 통째로 없다 (G6)', async () => {
    await renderWithTriggers([mkTrigger({ slotKey: null })]);

    fireEvent.press(screen.getByTestId(ALT));

    expect(screen.getByTestId('planb-risk-title')).toHaveTextContent(REASON);
    expect(screen.queryByTestId('planb-risk-affected')).toBeNull();
  });

  it('R-I5a [대안 보기] → 시트를 닫고 그 scope(FULL_DAY)·triggerId 로 planb 세션을 연다 (옛 I-T4a)', async () => {
    await renderWithTriggers([mkTrigger({ scope: 'FULL_DAY' })]);
    fireEvent.press(screen.getByTestId(ALT));

    fireEvent.press(screen.getByTestId('planb-risk-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const href = hrefString(mockPush.mock.calls[0][0]);
    expect(href).toContain(`/trips/${TRIP_ID}/planb`);
    expect(href).toContain('scope=FULL_DAY');
    expect(href).toContain('triggerId=trg-1');
    // i04 는 transparentModal 이라 허브가 남는다 — 시트를 닫고 가야 뒤에 비치지 않는다(02a ★14).
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });

  it('R-I5b scope=NONE 이면 [대안 보기]는 기본값 PARTIAL_SLOTS 로 세션을 연다 (옛 I-T4b)', async () => {
    await renderWithTriggers([mkTrigger({ scope: 'NONE' })]);
    fireEvent.press(screen.getByTestId(ALT));

    fireEvent.press(screen.getByTestId('planb-risk-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const href = hrefString(mockPush.mock.calls[0][0]);
    expect(href).toContain(`/trips/${TRIP_ID}/planb`);
    expect(href).toContain('scope=PARTIAL_SLOTS');
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });

  it('R-I6 스크림 press → 시트만 닫히고 push 0 · dismiss POST 0 이다', async () => {
    await renderWithTriggers([mkTrigger()]);
    // 짝 앵커 — 요청 관측 배선이 살아 있다.
    expect(
      hitCount(`GET /api/v1/trips/${TRIP_ID}/triggers`)
    ).toBeGreaterThanOrEqual(1);
    fireEvent.press(screen.getByTestId(ALT));
    expect(screen.getByTestId(SHEET)).toBeTruthy();

    fireEvent.press(screen.getByTestId('planb-risk-scrim'));
    await settle();

    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(hitCount(DISMISS_PATH)).toBe(0);
  });

  it('R-I7 발화 트리거가 없으면 알약도 시트도 없다', async () => {
    server.use(...baseHandlers({ triggers: [] }));

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );
    expect(screen.queryByTestId(CHIP)).toBeNull();
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});
