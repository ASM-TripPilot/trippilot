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
import type { Itinerary, VisitCheck } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-395 → TRIP-746 · LiveItineraryPage 배선을 실 HTTP로 태우는 심판(AC-6).
 *
 * 무엇을 보장하나:
 *  - I1 오늘 슬롯이 허브(`execution-live-screen`)에 뜨고, 시트 헤더 한 줄이
 *    trip.title + 일차 + `formatCoPickDayHeader(date)` + 슬롯 수로 조립된다.
 *  - I2·I2b 오늘이 여행 구간 밖(후·전)이어도 막지 않고 허브를 연다(2026-09-23 제품 규칙 변경 —
 *    구 "오늘은 여행 중이 아니에요" 얼굴 폐지). I3·I4 5xx·404 얼굴.
 *  - I5·I6 뒤로가기는 `canGoBack` 사다리 — 히스토리가 있으면 back, 없으면(딥링크·푸시 직행)
 *    조용히 멈추지 않고 `/(tabs)` 로 replace(INV-4 · ItineraryPlanPage 관례).
 *  - I7·I7b 수동 재계획 진입(BR-U4-10) — TRIP-747 부터 연필 FAB 는 제자리 토글이라 이동하지 않고,
 *    열린 알약이 진입을 맡는다: [AI에게 맡기기] → `/trips/{id}/planb`, [직접 수정] → `/trips/{id}/planb/manual`
 *    (US-PLANB-12 두 방식). 746 의 "FAB → planb" 단언을 지우지 않고 알약 기준으로 교체했다.
 *  - I8 실앱 done 카드는 사진·후기 칸이 없다 — `GET /visits/days` 계약에 photo/memo 가 없어서
 *    page 가 photos=[]·memo=null 로 넘긴다(맹점③ · G6). 시각은 계획값 "10:00" + "방문".
 *
 * 왜 통합 버킷인가: resolveLiveState 판정이 실 조회 상태(로딩·오류·데이터·404)와 오늘 날짜의
 * 조합에서 갈리므로, 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다.
 *
 * ⚠️ expo-router 목에 `canGoBack`·`back` 이 있어야 한다 — 없으면 뒤로가기 press 가
 *   `canGoBack is not a function` 으로 거짓 red(02a ★10).
 * ⚠️ page 가 trip·visits 도 조회하므로 `onUnhandledRequest:'error'` 아래에서 **세 핸들러를 늘 등록**한다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => mockCanGoBack(),
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';

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
            poiId: 'p1',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '감천문화마을',
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

/** p1 방문 완료 기록 — done 카드를 만든다(I8). */
const completedVisit = (): VisitCheck => ({
  visitCheckId: 'v1',
  poiId: 'p1',
  slotKey: `${TODAY}#p1`,
  arrivedAt: '2026-08-20T10:02:00',
  completedAt: '2026-08-20T10:55:00',
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T10:55:05Z',
});

/** trip 핸들러는 항상 등록(page 가 무조건 조회). itinerary 핸들러만 케이스별로 갈아끼운다. */
const tripHandler = () =>
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()));
const itineraryOk = () =>
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(itinerary())
  );
/** 2일짜리 일정(20일 p1 · 21일 p2) — 여행 전/후에 어느 날을 여는지 가르려면 날이 둘 이상이어야 한다. */
const DAY2 = '2026-08-21';
const twoDayItineraryOk = () =>
  http.get(`${BASE}/trips/:tripId/itinerary`, () => {
    const base = itinerary();
    const [day1] = base.days;
    return HttpResponse.json({
      ...base,
      days: [
        day1,
        {
          date: DAY2,
          slots: [{ ...day1.slots[0], poiId: 'p2', nameKo: '해운대' }],
        },
      ],
    });
  });
const visitsHandler = (visits: VisitCheck[] = []) =>
  http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
    HttpResponse.json({ visits })
  );

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  mockCanGoBack.mockReturnValue(true);
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockReplace.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  mockCanGoBack.mockClear();
});
afterAll(() => server.close());

async function renderActive(): Promise<void> {
  render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
  await waitFor(() =>
    expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
  );
}

describe('LiveItineraryPage', () => {
  it('I1 오늘 슬롯이 허브에 뜨고 헤더는 "여행명 · N일차 · M월 D일(요일) · N곳" 한 줄이다 (AC-6)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());

    await renderActive();

    expect(screen.getByTestId(`execution-live-slot-${TODAY}#p1`)).toBeTruthy();
    // trip.title 은 별도 조회라 늦게 도착할 수 있다 — 완성 문장이 될 때까지 기다린다(완전 일치).
    await waitFor(() =>
      expect(
        screen.getByTestId('execution-live-sheet-header')
      ).toHaveTextContent('부산 여행 · 1일차 · 8월 20일(목) · 1곳')
    );
  });

  it.each([
    [
      'I2 여행이 끝난 뒤',
      '2026-12-25',
      '마지막 날',
      `${DAY2}#p2`,
      `${TODAY}#p1`,
    ],
    [
      'I2b 여행이 시작되기 전',
      '2026-08-01',
      '첫날',
      `${TODAY}#p1`,
      `${DAY2}#p2`,
    ],
  ])(
    '%s(today=%s)에도 막지 않고 허브에 %s 슬롯을 띄운다',
    async (_label, today, _day, shownSlot, hiddenSlot) => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      render(<LiveItineraryPage tripId={TRIP_ID} today={today} />, {
        wrapper,
      });

      await waitFor(() =>
        expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
      );
      expect(
        screen.getByTestId(`execution-live-slot-${shownSlot}`)
      ).toBeTruthy();
      expect(
        screen.queryByTestId(`execution-live-slot-${hiddenSlot}`)
      ).toBeNull();
      expect(screen.queryByTestId('execution-live-outside')).toBeNull();
    }
  );

  it('I3 조회가 5xx로 실패하면 실패 얼굴을 준다 (INV-4)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 500 })
      ),
      tripHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-error')).toBeTruthy()
    );
  });

  it('I4 일정 미생성(404)이면 네트워크 오류가 아닌 별도 안내를 준다 (AC-4b)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 404 })
      ),
      tripHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-notfound')).toBeTruthy()
    );
    // 404 는 네트워크 오류 얼굴로 새지 않는다(가드 대상).
    expect(screen.queryByTestId('execution-live-error')).toBeNull();
  });

  it('I5 뒤로가기 — 히스토리가 있으면 router.back() 한 번, replace 는 없다', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());
    mockCanGoBack.mockReturnValue(true);

    await renderActive();
    fireEvent.press(screen.getByTestId('execution-live-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('I6 뒤로가기 — 히스토리가 없으면(딥링크 직행) /(tabs) 로 replace 한다 (INV-4 침묵 금지)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());
    mockCanGoBack.mockReturnValue(false);

    await renderActive();
    fireEvent.press(screen.getByTestId('execution-live-back'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('I7 FAB 는 이동하지 않고, 열린 [AI에게 맡기기] 알약이 수동 재계획 세션(/trips/{id}/planb)을 연다 (BR-U4-10 · TRIP-747)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());

    await renderActive();
    fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
    // FAB 는 메뉴만 연다 — 여기서 push 가 나가면 "FAB 도 이동 + 알약도 이동" 이중 진입이다.
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('execution-live-edit-pill-ai'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/planb`);
  });

  it('I7b 열린 [직접 수정] 알약은 i07 편집(/trips/{id}/planb/manual)으로 간다 (US-PLANB-12 · TRIP-747)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());

    await renderActive();
    fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
    fireEvent.press(screen.getByTestId('execution-live-edit-pill-manual'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/planb/manual`);
  });

  it('I8 실앱 done 카드는 사진·후기 칸 없이 계획 시각 "10:00" + "방문" 만 그린다 (G6 · 맹점③)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler([completedVisit()]));

    await renderActive();

    const key = `${TODAY}#p1`;
    await waitFor(() =>
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${key}`)
      ).toHaveTextContent('10:00')
    );
    expect(
      screen.getByTestId(`execution-live-slot-visit-label-${key}`)
    ).toHaveTextContent('방문');
    expect(
      screen.queryByTestId(`execution-live-slot-photos-${key}`)
    ).toBeNull();
    expect(screen.queryByTestId(`execution-live-slot-memo-${key}`)).toBeNull();
  });

  it('I9 슬롯 이름을 누르면 /trips/{tripId}/live/place/{poiId} 로 간다 — done·active·upcoming 모두 (TRIP-987 A-3 · US-ONTRIP-02)', async () => {
    // 준비: 같은 날 세 곳 — p1 완료(done) · p2 도착·미완료(active) · p3 기록 없음(upcoming).
    const threeSlots = http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      const base = itinerary();
      const [p1] = base.days[0].slots;
      return HttpResponse.json({
        ...base,
        days: [
          {
            date: TODAY,
            slots: [
              p1,
              {
                ...p1,
                poiId: 'p2',
                nameKo: '광안리 해변',
                startAt: '12:00:00',
              },
              { ...p1, poiId: 'p3', nameKo: '해운대', startAt: '15:00:00' },
            ],
          },
        ],
      });
    });
    const activeVisit: VisitCheck = {
      ...completedVisit(),
      visitCheckId: 'v2',
      poiId: 'p2',
      slotKey: `${TODAY}#p2`,
      arrivedAt: '2026-08-20T12:01:00',
      completedAt: null,
    };
    server.use(
      threeSlots,
      tripHandler(),
      visitsHandler([completedVisit(), activeVisit]),
      http.get(`${BASE}/trips/:tripId/triggers`, () =>
        HttpResponse.json({ triggers: [] })
      )
    );

    await renderActive();
    // 세 상태가 실제로 섰다 — done 우측 시각 · active [방문 완료] · upcoming 상태줄.
    await waitFor(() =>
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
      ).toHaveTextContent('10:00')
    );
    expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen();
    expect(
      screen.getByTestId(`execution-live-slot-time-${TODAY}#p3`)
    ).toHaveTextContent('15:00 도착 예정');

    // 실행: 세 카드의 이름을 차례로 누른다.
    for (const poiId of ['p1', 'p2', 'p3']) {
      fireEvent.press(
        screen.getByTestId(`execution-live-slot-name-${TODAY}#${poiId}`)
      );
    }

    // 단언: 정확히 그 문자열로 세 번, 다른 이동은 없다.
    expect(mockPush.mock.calls).toEqual([
      [`/trips/${TRIP_ID}/live/place/p1`],
      [`/trips/${TRIP_ID}/live/place/p2`],
      [`/trips/${TRIP_ID}/live/place/p3`],
    ]);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
