import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { Linking } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { WeatherCloudGlyph } from '@/features/execution/ui/ExecutionGlyphs';
import { server } from '@/mocks/server';
import type {
  Itinerary,
  ReplanDiff,
  Trigger,
  TriggerList,
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/index.schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdQueryKey,
  getGetTripsTripIdReplanSessionsSessionIdDiffQueryKey,
  getGetTripsTripIdTriggersQueryKey,
  getGetTripsTripIdVisitsDaysDayQueryKey,
} from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * i01 허브(LiveItineraryPage) 통합 테스트 — 실 페이지 + 실제 HTTP(MSW). 관점 8개를 바깥 describe 8개로 나눈다
 * (허브 · i08 반영 시트 · 메모 시트 · [사진]·[메모] · 완료 카드 [사진]·[메모] · i03 위험 시트 · i02 트리거 · 방문 체크).
 *
 * 공용 장치(파일 맨 위 한 벌):
 *  - `jest.mock` 은 파일 전체에 걸린다 — 목은 하나만 두고 관점마다 다른 값은 가변 목(`mockCanGoBack` 등)으로 바꾼다.
 *  - expo-router 목은 넓은 모양(push·replace·navigate·back·setParams·canGoBack·dismissTo)이다. 관점마다 옛 목이 좁았던
 *    곳은 그 describe 의 `afterEach` 가 **옛 목에 없던 메서드가 불리지 않았다**를 단언한다 — 옛 좁은 목은 그런
 *    호출을 TypeError 로 red 냈다(넓힌 목이 그 그물을 조용히 지우지 않게).
 *  - `canGoBack`·`back` 이 없으면 허브 뒤로가기 press 가 `canGoBack is not a function` 으로 거짓 red 다.
 *  - `@/shared/photo` 는 위임형(`mockPick`) — 페이지가 [사진] 경로로 네이티브 앨범 모듈을 import 한다.
 *  - `expo-location` 목은 방문 체크 W9 전용이다. 지금 허브는 expo-location 을 안 물지만, 누가 권한 게이트를
 *    넣으면 W9 의 '거부' 케이스가 red 가 되는 미래 그물이라 남긴다.
 *  - MSW `listen`·요청 관찰자는 한 번만 — 관찰자가 둘이면 요청이 두 번 적혀 개수 단언이 틀어진다.
 *    관점별 기본 핸들러(`server.use`)·모듈 가변 상태는 그 describe 안 `beforeEach` 에 둔다(최상위에 두면 다른
 *    관점의 `onUnhandledRequest: 'error'` 그물이 그 핸들러에 덮인다).
 *  - QueryClient 수명은 관점마다 다르다(렌더마다 새 client · gcTime 0 · 테스트가 캐시를 직접 읽는 모듈 client) —
 *    `wrapper` 는 describe 마다 자기 것을 둔다.
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

// 정적 싱글턴 router 목 — 렌더 중엔 부르지 않는다.
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: (...args: unknown[]) => mockBack(...args),
    setParams: (...args: unknown[]) => mockSetParams(...args),
    canGoBack: () => mockCanGoBack(),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
  },
}));

const mockPick = jest.fn();
const mockResolveUri = jest.fn();
jest.mock('@/shared/photo', () => ({
  pickPhotoAsset: () => mockPick(),
  resolvePhotoUri: (id: string) => mockResolveUri(id),
}));

// TRIP-1021 Q2 — 허브 [도착]은 위치 권한과 무관하다. 허브가 권한을 조회하게 바뀌어도 어느 함수를
// 쓰든 GRANTED/DENIED 가 주입되도록 get·request 둘 다 둔다(지금 허브는 expo-location 을 안 문다).
const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const TOMORROW = '2026-08-21';

/** 실제로 나간 요청을 "메서드 경로" 로 적는다(관찰자는 아래 beforeAll 하나). */
let observedHits: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;

/** 음성 단언("안 나갔다") 전에 비동기 일이 끝날 틈을 준다 — "요청 0회" 단언이 공허해지지 않게. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** 옛 좁은 router 목에 없던 메서드 — 불리면 그 관점의 옛 파일은 TypeError 로 red 였다. */
function expectNotCalled(...fns: jest.Mock[]): void {
  fns.forEach((fn) => expect(fn).not.toHaveBeenCalled());
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  observedHits = [];
  setAccessToken('a');
  mockCanGoBack.mockReturnValue(true);
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  [
    mockPush,
    mockReplace,
    mockNavigate,
    mockBack,
    mockSetParams,
    mockCanGoBack,
    mockDismissTo,
    mockPick,
    mockResolveUri,
    mockGetForeground,
    mockRequestForeground,
  ].forEach((fn) => fn.mockReset());
});
afterAll(() => server.close());

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
 *    TRIP-1233 부터 [직접 수정]은 보고 있는 날을 `?date=` 로 늘 싣는다(I7b·I7h·I7i).
 *  - I8 실앱 done 카드는 사진·후기 칸이 없다 — `GET /visits/days` 계약에 photo/memo 가 없어서
 *    page 가 photos=[]·memo=null 로 넘긴다(맹점③ · G6). 시각은 계획값 "10:00" + "방문".
 *
 * 왜 통합 버킷인가: resolveLiveState 판정이 실 조회 상태(로딩·오류·데이터·404)와 오늘 날짜의
 * 조합에서 갈리므로, 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다.
 *
 * ⚠️ page 가 trip·visits 도 조회하므로 `onUnhandledRequest:'error'` 아래에서 **세 핸들러를 늘 등록**한다.
 */
// TRIP-395 → TRIP-746 · TRIP-747 · TRIP-987 (옛 LiveItineraryPage.integration.test.tsx)
describe('허브 — 얼굴·뒤로가기·재계획 진입·장소 이동', () => {
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
    arrivedAt: '2026-08-20T01:02:00Z',
    completedAt: '2026-08-20T01:55:00Z',
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
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  // 옛 목에 없던 메서드(setParams·navigate).
  afterEach(() => {
    expectNotCalled(mockSetParams, mockNavigate);
  });

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

      expect(
        screen.getByTestId(`execution-live-slot-${TODAY}#p1`)
      ).toBeTruthy();
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

    // TRIP-1278 — 없는 여행(trip 404)과 일정 없는 여행(일정 404)을 가르고, 두 얼굴 모두 탈출 버튼을 둔다.
    describe('여행 없음 vs 일정 없음 — 막다른 얼굴 탈출', () => {
      const tripStatus = (status: number) =>
        http.get(
          `${BASE}/trips/:tripId`,
          () => new HttpResponse(null, { status })
        );
      const itineraryStatus = (status: number) =>
        http.get(
          `${BASE}/trips/:tripId/itinerary`,
          () => new HttpResponse(null, { status })
        );

      /** push 인자(문자열 또는 `{ pathname, params }`)를 실제 목적지 경로로 편다 — 표기법은 보지 않는다. */
      function hrefToPath(href: unknown): string {
        if (typeof href === 'string') return href;
        const { pathname, params = {} } = href as {
          pathname: string;
          params?: Record<string, string>;
        };
        return pathname.replace(
          /\[(\w+)\]/g,
          (_whole, key: string) => params[key] ?? `[${key}]`
        );
      }

      let releaseTrip: (() => void) | undefined;
      afterEach(() => {
        releaseTrip?.();
        releaseTrip = undefined;
      });

      async function renderTripGone(): Promise<ReactTestInstance> {
        server.use(tripStatus(404), itineraryStatus(404));
        render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
          wrapper,
        });
        return waitFor(() =>
          screen.getByTestId('execution-live-trip-notfound')
        );
      }

      async function renderNoItinerary(): Promise<ReactTestInstance> {
        server.use(tripHandler(), itineraryStatus(404));
        render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
          wrapper,
        });
        return waitFor(() => screen.getByTestId('execution-live-notfound'));
      }

      it('I4a 여행이 없으면(trip 404) "페이지를 찾을 수 없어요" + [홈으로]를 주고, 일정 없음·오류로 말하지 않는다 (AC-1·AC-4 · INV-4)', async () => {
        const face = await renderTripGone();

        expect(within(face).getByText('페이지를 찾을 수 없어요')).toBeTruthy();
        expect(
          within(face).getByTestId('execution-live-notfound-home')
        ).toHaveTextContent('홈으로');
        expect(
          within(face).getAllByRole('button').length
        ).toBeGreaterThanOrEqual(1);
        expect(screen.queryByTestId('execution-live-notfound')).toBeNull();
        expect(screen.queryByText('아직 일정이 없어요')).toBeNull();
        expect(screen.queryByTestId('execution-live-error')).toBeNull();
      });

      it('I4b [홈으로]는 router.dismissTo("/(tabs)") 정확히 1회 — push·replace·back 은 0회 (AC-2)', async () => {
        await renderTripGone();

        fireEvent.press(screen.getByTestId('execution-live-notfound-home'));

        expect(mockDismissTo).toHaveBeenCalledTimes(1);
        expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
        expectNotCalled(mockPush, mockReplace, mockBack);
      });

      it('I4c 여행은 있고 일정만 없으면 "아직 일정이 없어요" + [일정 만들기](filled)·[뒤로](outline) 두 버튼 (AC-3·AC-4)', async () => {
        const face = await renderNoItinerary();

        expect(within(face).getByText('아직 일정이 없어요')).toBeTruthy();
        const create = within(face).getByTestId(
          'execution-live-notfound-create'
        );
        const back = within(face).getByTestId('execution-live-notfound-back');
        expect(create).toHaveTextContent('일정 만들기');
        expect(back).toHaveTextContent('뒤로');
        expect(String(create.props.className).split(/\s+/)).toContain(
          'bg-primary'
        );
        const backTokens = String(back.props.className).split(/\s+/);
        expect(backTokens).toContain('border');
        expect(backTokens).not.toContain('bg-primary');
        expect(screen.queryByTestId('execution-live-trip-notfound')).toBeNull();
      });

      it('I4d [일정 만들기]는 방식 선택 /trips/{tripId}/itinerary/method 로 push 1회 (AC-3 · ItineraryPlanPage goCreate 와 같은 목적지)', async () => {
        await renderNoItinerary();

        fireEvent.press(screen.getByTestId('execution-live-notfound-create'));

        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(hrefToPath(mockPush.mock.calls[0][0])).toBe(
          `/trips/${TRIP_ID}/itinerary/method`
        );
        expectNotCalled(mockReplace, mockBack, mockDismissTo);
      });

      it.each([
        ['히스토리가 있으면 router.back() 1회', true],
        ['히스토리가 없으면(딥링크 직행) /(tabs) 로 replace 1회', false],
      ])(
        'I4e [뒤로]는 허브 헤더 ‹ 와 같은 사다리 — %s (AC-3)',
        async (_label, canGoBack) => {
          mockCanGoBack.mockReturnValue(canGoBack);
          await renderNoItinerary();

          fireEvent.press(screen.getByTestId('execution-live-notfound-back'));

          if (canGoBack) {
            expect(mockBack).toHaveBeenCalledTimes(1);
            expect(mockReplace).not.toHaveBeenCalled();
          } else {
            expect(mockReplace).toHaveBeenCalledTimes(1);
            expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
            expect(mockBack).not.toHaveBeenCalled();
          }
          expectNotCalled(mockPush, mockDismissTo);
        }
      );

      it.each([
        ['여행이 있으면 일정 없음 얼굴', 200, 'execution-live-notfound'],
        ['여행도 없으면 404 얼굴', 404, 'execution-live-trip-notfound'],
      ])(
        'I4f 일정 404 가 먼저 와도 여행 조회를 기다리는 동안은 로딩 얼굴이고, 응답 뒤 %s (AC-5)',
        async (_label, tripResponse, face) => {
          const tripGate = new Promise<void>((resolve) => {
            releaseTrip = resolve;
          });
          server.use(
            itineraryStatus(404),
            http.get(`${BASE}/trips/:tripId`, async () => {
              await tripGate;
              return tripResponse === 200
                ? HttpResponse.json(trip())
                : new HttpResponse(null, { status: tripResponse });
            })
          );
          const client = new QueryClient({
            defaultOptions: { queries: { retry: false } },
          });
          render(
            <QueryClientProvider client={client}>
              <LiveItineraryPage tripId={TRIP_ID} today={TODAY} />
            </QueryClientProvider>
          );

          // 앵커: 일정 404 는 이미 도착했고 trip 은 아직 대기다 — 아래 부재 단언이 공허하지 않게.
          await waitFor(() =>
            expect(
              client.getQueryState(getGetTripsTripIdItineraryQueryKey(TRIP_ID))
                ?.status
            ).toBe('error')
          );
          await settle();
          expect(
            client.getQueryState(getGetTripsTripIdQueryKey(TRIP_ID))?.status
          ).toBe('pending');
          expect(screen.getByTestId('execution-live-loading')).toBeTruthy();
          expect(screen.queryByTestId('execution-live-notfound')).toBeNull();
          expect(
            screen.queryByTestId('execution-live-notfound-create')
          ).toBeNull();
          expect(
            screen.queryByTestId('execution-live-trip-notfound')
          ).toBeNull();

          await act(async () => {
            releaseTrip?.();
          });

          await waitFor(() => expect(screen.getByTestId(face)).toBeTruthy());
          expect(screen.queryByTestId('execution-live-loading')).toBeNull();
        }
      );

      it('I4g 여행 조회가 5xx 이고 일정이 있으면 허브를 그대로 연다 — trip 실패는 판정에 넣지 않는다 (AC-6)', async () => {
        server.use(itineraryOk(), tripStatus(500), visitsHandler());

        await renderActive();

        expect(screen.queryByTestId('execution-live-trip-notfound')).toBeNull();
        expect(screen.queryByTestId('execution-live-error')).toBeNull();
      });

      it('I4h 여행 조회가 5xx 이고 일정이 404 면 일정 없음 얼굴(버튼 ≥1) — 로딩에 갇히거나 여행 없음·오류로 바뀌지 않는다 (AC-6·AC-4)', async () => {
        server.use(itineraryStatus(404), tripStatus(500));
        render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
          wrapper,
        });

        const face = await waitFor(() =>
          screen.getByTestId('execution-live-notfound')
        );

        expect(
          within(face).getAllByRole('button').length
        ).toBeGreaterThanOrEqual(1);
        expect(screen.queryByTestId('execution-live-trip-notfound')).toBeNull();
        expect(screen.queryByTestId('execution-live-error')).toBeNull();
        expect(screen.queryByTestId('execution-live-loading')).toBeNull();
      });
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

    it('I7c 🔴 TRIP-1195 허브에서 오늘이 아닌 미래일(2일차)을 보는 중이면 [AI에게 맡기기]가 그 날짜를 targetDate 쿼리로 넘긴다', async () => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      await renderActive();
      fireEvent.press(screen.getByTestId('execution-live-daychip-1'));
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
      fireEvent.press(screen.getByTestId('execution-live-edit-pill-ai'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/planb?targetDate=${DAY2}`
      );
    });

    it('I7d 무회귀 — 2일짜리 일정이어도 오늘(1일차)을 보는 중이면 쿼리 없이 종전 경로다', async () => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      await renderActive();
      fireEvent.press(screen.getByTestId('execution-live-daychip-1'));
      fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
      fireEvent.press(screen.getByTestId('execution-live-edit-pill-ai'));

      expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/planb`);
    });

    it('I7e 🔴 이미 지난 날(1일차, 오늘은 2일차)을 보는 중이면 [AI에게 맡기기]가 없고 [직접 수정]은 남는다 (결정 3 — 눌러서 409 받는 막다른 길을 만들지 않는다)', async () => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      render(<LiveItineraryPage tripId={TRIP_ID} today={DAY2} />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
      );
      fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));

      expect(screen.queryByTestId('execution-live-edit-pill-ai')).toBeNull();
      expect(
        screen.getByTestId('execution-live-edit-pill-manual')
      ).toBeTruthy();
    });

    it('I7g 🔴 TRIP-1214 시작 전 여행(오늘이 1일차 전)이면 [AI에게 맡기기]가 없고 [직접 수정]은 남는다', async () => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      render(<LiveItineraryPage tripId={TRIP_ID} today="2026-08-10" />, {
        wrapper,
      });
      await waitFor(() =>
        expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
      );
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));

      expect(screen.queryByTestId('execution-live-edit-pill-ai')).toBeNull();
      expect(
        screen.getByTestId('execution-live-edit-pill-manual')
      ).toBeTruthy();
    });

    it('I7f 오늘이 2일차일 때 2일차(오늘)를 보면 종전 AI 알약·쿼리 없는 경로다', async () => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      render(<LiveItineraryPage tripId={TRIP_ID} today={DAY2} />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
      );
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
      fireEvent.press(screen.getByTestId('execution-live-edit-pill-ai'));

      expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/planb`);
    });

    describe('🔴 TRIP-1195 결정 5 — 확정 뒤 허브는 확정한 날의 일차로 열린다', () => {
      async function renderWithInitialDate(initialDate?: string) {
        server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());
        render(
          <LiveItineraryPage
            tripId={TRIP_ID}
            today={TODAY}
            initialDate={initialDate}
          />,
          { wrapper }
        );
        await waitFor(() =>
          expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
        );
      }

      it('H1 initialDate=2일차 날짜면 2일차 칩이 선택돼 열린다(오늘은 1일차)', async () => {
        await renderWithInitialDate(DAY2);

        expect(screen.getByTestId('execution-live-daychip-1')).toBeSelected();
        expect(
          screen.getByTestId('execution-live-daychip-0')
        ).not.toBeSelected();
        expect(
          screen.getByTestId(`execution-live-slot-${DAY2}#p2`)
        ).toBeTruthy();
      });

      it('H2 무회귀 — initialDate 가 없으면 종전처럼 오늘(1일차)로 열린다', async () => {
        await renderWithInitialDate(undefined);

        expect(screen.getByTestId('execution-live-daychip-0')).toBeSelected();
      });

      it.each([['2026-12-31'], ['내일'], ['']])(
        'H3 일정에 없거나 형식이 틀린 initialDate(%j)는 무시하고 오늘로 연다 — 보는 위치일 뿐 쓰기가 없다',
        async (bad) => {
          await renderWithInitialDate(bad);

          expect(screen.getByTestId('execution-live-daychip-0')).toBeSelected();
        }
      );

      it('H4 사용자가 칩을 고르면 그 선택이 initialDate 를 이긴다', async () => {
        await renderWithInitialDate(DAY2);

        fireEvent.press(screen.getByTestId('execution-live-daychip-0'));

        expect(screen.getByTestId('execution-live-daychip-0')).toBeSelected();
      });
    });

    it('I7b 열린 [직접 수정] 알약은 i07 편집(/trips/{id}/planb/manual)으로 간다 (US-PLANB-12 · TRIP-747)', async () => {
      server.use(itineraryOk(), tripHandler(), visitsHandler());

      await renderActive();
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
      fireEvent.press(screen.getByTestId('execution-live-edit-pill-manual'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      // TRIP-1233 AC-2d — 보고 있는 날(오늘)을 date 쿼리로 싣는다.
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/planb/manual?date=${TODAY}`
      );
    });

    // TRIP-1233 AC-2d — 편집기는 날짜가 없으면 1일차로 연다(허브처럼 '오늘'이 아니다). 그래서 [AI에게 맡기기]
    // (I7c·I7d)와 달리 오늘을 보고 있어도 날짜를 뺄 수 없다 — 2일짜리 일정이라야 갈린다.
    it('I7h 🔴 2일차를 보다가 [직접 수정] → /planb/manual?date=2일차', async () => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      await renderActive();
      fireEvent.press(screen.getByTestId('execution-live-daychip-1'));
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
      fireEvent.press(screen.getByTestId('execution-live-edit-pill-manual'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/planb/manual?date=${DAY2}`
      );
    });

    it('I7i 🔴 오늘이 2일차면 칩을 안 눌러도 [직접 수정]이 2일차 날짜를 싣는다 (편집기 기본값 1일차와 갈린다)', async () => {
      server.use(twoDayItineraryOk(), tripHandler(), visitsHandler());

      render(<LiveItineraryPage tripId={TRIP_ID} today={DAY2} />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
      );
      fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
      fireEvent.press(screen.getByTestId('execution-live-edit-pill-manual'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/planb/manual?date=${DAY2}`
      );
    });

    it('I8 실앱 done 카드는 사진·후기 칸 없이 실제 도착 시각 "10:02"(KST) + "방문" 만 그린다 (G6 · 맹점③ · TRIP-1220)', async () => {
      server.use(
        itineraryOk(),
        tripHandler(),
        visitsHandler([completedVisit()])
      );

      await renderActive();

      const key = `${TODAY}#p1`;
      await waitFor(() =>
        expect(
          screen.getByTestId(`execution-live-slot-visit-time-${key}`)
        ).toHaveTextContent('10:02')
      );
      expect(
        screen.getByTestId(`execution-live-slot-visit-label-${key}`)
      ).toHaveTextContent('방문');
      expect(
        screen.queryByTestId(`execution-live-slot-photos-${key}`)
      ).toBeNull();
      expect(
        screen.queryByTestId(`execution-live-slot-memo-${key}`)
      ).toBeNull();
    });

    it('I8b TRIP-1220 도착 시각이 없는 완료 방문은 계획 시각 "10:00" + "계획" 으로 표시한다 — 계획 시각을 "방문"으로 말하지 않는다', async () => {
      server.use(
        itineraryOk(),
        tripHandler(),
        visitsHandler([{ ...completedVisit(), arrivedAt: null }])
      );

      await renderActive();

      const key = `${TODAY}#p1`;
      await waitFor(() => {
        expect(
          screen.getByTestId(`execution-live-slot-visit-time-${key}`)
        ).toHaveTextContent('10:00');
        expect(
          screen.getByTestId(`execution-live-slot-visit-label-${key}`)
        ).toHaveTextContent('계획');
      });
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
        ).toHaveTextContent('10:02')
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
});

/**
 * TRIP-754 · AC-6·7·8 · Q5 — i08 변경 반영 시트의 **허브 페이지 배선**을 실 HTTP 로 태운다.
 *
 * 무엇을 보장하나:
 *  - `appliedSessionId` 가 있고 일정이 active 일 때만 시트가 **허브 밖 형제로** 뜬다. 로딩 중에는 기다렸다가
 *    뜨고, 오류·404 면 뜨지 않는다. 라이브에는 부제·배지·내역이 없다(E4).
 *  - applied 로 들어오면 허브는 펼침(index 2)으로 시작한다(Q5). 대조군은 기본 1.
 *  - [확인]·스크림 → `router.setParams({ applied: undefined })` 1회, 화면 이동 0(쿼리 신호를 지운다).
 *  - [되돌리기] → 시트 안에 "이미 반영돼 되돌릴 수 없어요". 서버 쓰기(POST) 0, 시트는 그대로(E2 · Q3 멱등).
 *
 * 왜 통합 버킷인가: 열림 조건이 실 조회 상태(loading→active)와 prop 의 조합에서 갈린다(riskSheet 선례).
 *
 * ⚠️ 통과형 시트 목 사각: 열림은 마운트 여부로만 잰다. 목 setParams 는 URL 을 안 바꾸므로 닫힌 뒤 시트가
 * 사라지는지는 여기서 보지 않는다(02a ★17 — 6-b 실기).
 */
// TRIP-754 (옛 LiveItineraryPage.applied.integration.test.tsx) — 옛 목이 이동 4종·setParams 를 모두 가져 부재 단언을 더하지 않는다.
describe('i08 변경 반영 시트', () => {
  const SESSION_ID = 's1';
  const baseSlot = {
    endAt: '18:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    distanceRange: null,
    tags: [],
    category: null,
    openingHours: null,
  };

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
            },
            {
              ...baseSlot,
              poiId: 'p1',
              startAt: '17:00:00',
              nameKo: 'F1963 복합문화공간',
            },
          ],
        },
      ],
    }) as unknown as Itinerary;

  const trip = () => ({
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: TODAY,
    endDate: TODAY,
    party: 2,
    destinations: [{ seq: 1, region: '부산', nights: 0 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  });

  const itineraryHandler = () =>
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    );
  const restHandlers = () => [
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
    http.get(`${BASE}/trips/:tripId/triggers`, () =>
      HttpResponse.json({ triggers: [] })
    ),
  ];
  const postHits = () => observedHits.filter((hit) => hit.startsWith('POST '));
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  const HUB = 'execution-live-screen';
  const SHEET = 'planb-applied-sheet';

  /** 준비 공통 — 성공 조회 핸들러로 페이지를 띄우고 허브가 뜰 때까지 기다린다. */
  async function renderHub(appliedSessionId?: string): Promise<void> {
    server.use(itineraryHandler(), ...restHandlers());
    render(
      <LiveItineraryPage
        tripId={TRIP_ID}
        today={TODAY}
        appliedSessionId={appliedSessionId}
      />,
      { wrapper }
    );
    await waitFor(() => expect(screen.getByTestId(HUB)).toBeTruthy());
  }

  /** 허브(셸) 시트가 받은 초기 스냅 index — 허브 서브트리 안에서만 센다(02a ★15). */
  function hubSnapIndices(): number[] {
    return screen
      .getByTestId(HUB)
      .findAll(
        (node) =>
          typeof node.props?.index === 'number' &&
          Array.isArray(node.props?.snapPoints)
      )
      .map((node) => node.props.index as number);
  }

  /** 화면 이동 4종이 한 번도 불리지 않았다. */
  function expectNoNavigation(): void {
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  }

  describe('🔴 A1·A2 · AC-6 — applied 신호가 있으면 허브 밖 형제로 시트가 뜬다', () => {
    it('A1 라벨·제목·두 버튼만 있고, 캐시에 diff 가 없으면 부제·배지·내역은 없다 (E4)', async () => {
      await renderHub(SESSION_ID);

      const sheet = screen.getByTestId(SHEET);
      expect(sheet).toBeTruthy();
      expect(within(screen.getByTestId(HUB)).queryByTestId(SHEET)).toBeNull();
      expect(screen.getByTestId('planb-applied-eyebrow')).toHaveTextContent(
        '변경 반영됨'
      );
      expect(screen.getByTestId('planb-applied-title')).toHaveTextContent(
        '새 일정이 반영됐어요'
      );
      expect(screen.queryByTestId('planb-applied-revert')).toBeNull();
      expect(screen.getByTestId('planb-applied-confirm')).toBeTruthy();

      expect(screen.queryByTestId('planb-applied-subtitle')).toBeNull();
      expect(screen.queryByTestId('planb-applied-summary')).toBeNull();
      expect(screen.queryByTestId('planb-applied-diff')).toBeNull();
      // 뜨는 것만으로 아무 데도 가지 않고 쿼리도 건드리지 않는다.
      expectNoNavigation();
      expect(mockSetParams).not.toHaveBeenCalled();
    });

    it('A2 신호가 없으면 시트도 없다 (허브는 그대로)', async () => {
      await renderHub();

      expect(screen.getByTestId(HUB)).toBeTruthy();
      expect(screen.queryByTestId(SHEET)).toBeNull();
    });
  });

  // TRIP-1188 — 배지는 초안 화면(i06)이 확정 직전까지 쿼리 캐시에 들고 있던 diff 에서 만든다.
  // 서버는 확정(APPLIED) 뒤 diff 를 비우므로(`ready=false`) 다시 조회하지 않는다.
  const slotOf = (poiId: string) => ({
    slotKey: `${TODAY}#${poiId}`,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
  });
  const entryOf = (poiId: string, change: string) => ({
    slotKey: `${TODAY}#${poiId}`,
    change,
    beforeStart: null,
    afterStart: null,
  });
  /**
   * 바뀐 곳 3(추가·빠짐·이동) + 안 바뀐 곳(FIXED·UNCHANGED 는 세지 않는다). 곳 수 4→5, 총거리 −6.9km.
   * ⚠️ 서버는 지금 `impact.totalDistanceDeltaM` 을 항상 null 로 준다(openapi·BE ReplanDiffService) — 그래서 실앱 배지는
   * 거리 배지 없이 2개다. 이 픽스처의 −6.9km 는 서버가 델타를 내기 시작했을 때의 계약 모양을 잠근다(TRIP-1188 5-b 참고-1).
   */
  const SEEDED_DIFF = {
    ready: true,
    status: 'DRAFT',
    date: TODAY,
    before: ['a', 'b', 'c', 'd'].map(slotOf),
    after: ['a', 'x', 'c', 'e', 'f'].map(slotOf),
    entries: [
      entryOf('x', 'ADDED'),
      entryOf('b', 'REMOVED'),
      entryOf('e', 'MOVED'),
      entryOf('a', 'FIXED'),
      entryOf('c', 'UNCHANGED'),
    ],
    impact: {
      visitCountDelta: 1,
      returnTimeDeltaMinutes: 0,
      totalDistanceDeltaM: -6900,
      totalDistanceKm: 12,
    },
  } as unknown as ReplanDiff;

  /** diff 를 쿼리 캐시에 심은 채 허브를 띄운다 — 안정된 클라이언트(wrapper 는 렌더마다 새로 만든다). */
  async function renderHubSeeded(
    seeded: { sessionId: string; diff: ReplanDiff } | null
  ): Promise<QueryClient> {
    server.use(itineraryHandler(), ...restHandlers());
    const client = new QueryClient({
      // gcTime 을 끄지 않는다(Infinity) — 0 이면 관찰자 없는 심어 둔 diff 가 일정 로딩 중에 지워져,
      // 시트가 뜨는 시점에는 캐시가 비어 있다. 실제 앱의 기본 gcTime 은 5분이라 이 가정이 맞다.
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { gcTime: 0 },
      },
    });
    if (seeded) {
      client.setQueryData(
        getGetTripsTripIdReplanSessionsSessionIdDiffQueryKey(
          TRIP_ID,
          seeded.sessionId
        ),
        seeded.diff,
        { updatedAt: Date.now() }
      );
    }
    render(
      <LiveItineraryPage
        tripId={TRIP_ID}
        today={TODAY}
        appliedSessionId={SESSION_ID}
      />,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );
    await waitFor(() => expect(screen.getByTestId(HUB)).toBeTruthy());
    return client;
  }

  describe('🔴 A5 · TRIP-1188 — 반영 시트 배지는 diff 캐시에서 온다', () => {
    it('A5a 캐시에 ready diff 가 있으면 [바뀐 곳 3 · 방문지 4→5 · 이동 −6.9km] 가 뜬다', async () => {
      await renderHubSeeded({ sessionId: SESSION_ID, diff: SEEDED_DIFF });

      const badges = screen.getAllByTestId('planb-applied-badge');
      // 배지 하나씩 완전 일치(문자열 toHaveTextContent 는 전체 일치다).
      expect(badges).toHaveLength(3);
      expect(badges[0]).toHaveTextContent('바뀐 곳 3');
      expect(badges[1]).toHaveTextContent('방문지 4→5');
      expect(badges[2]).toHaveTextContent('이동 −6.9km');
    });

    it('A5e 시트가 뜬 뒤 캐시가 정리돼도(gc) 허브가 다시 그려져도 배지가 남는다', async () => {
      // 준비 — 배지가 뜬 상태에서
      const client = await renderHubSeeded({
        sessionId: SESSION_ID,
        diff: SEEDED_DIFF,
      });
      expect(screen.getAllByTestId('planb-applied-badge')).toHaveLength(3);

      // 실행 — 캐시를 비우고(5분 gc 와 같은 상태) 허브를 다시 그리게 한다(일차 칩 누름 → 상태 변경)
      client.removeQueries({
        queryKey: getGetTripsTripIdReplanSessionsSessionIdDiffQueryKey(
          TRIP_ID,
          SESSION_ID
        ),
      });
      fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
      await settle();

      // 단언 — 리렌더 뒤에도 배지는 그대로다
      expect(screen.getAllByTestId('planb-applied-badge')).toHaveLength(3);
    });

    it('A5b 캐시에 diff 가 없으면 배지 줄이 없고, 배지를 만들려고 diff 를 다시 조회하지도 않는다', async () => {
      await renderHubSeeded(null);

      expect(screen.getByTestId(SHEET)).toBeTruthy();
      expect(screen.queryByTestId('planb-applied-summary')).toBeNull();
      // 확정 뒤 서버는 diff 를 비운다 — 재조회는 의미 없는 요청이다.
      expect(observedHits.some((hit) => hit.includes('/diff'))).toBe(false);
    });

    it('A5c 캐시의 diff 가 ready=false 면 배지 줄이 없다', async () => {
      await renderHubSeeded({
        sessionId: SESSION_ID,
        diff: { ...SEEDED_DIFF, ready: false },
      });

      expect(screen.getByTestId(SHEET)).toBeTruthy();
      expect(screen.queryByTestId('planb-applied-summary')).toBeNull();
    });

    it('A5d 다른 세션의 diff 캐시는 쓰지 않는다', async () => {
      await renderHubSeeded({ sessionId: 'other-session', diff: SEEDED_DIFF });

      expect(screen.getByTestId(SHEET)).toBeTruthy();
      expect(screen.queryByTestId('planb-applied-summary')).toBeNull();
    });
  });

  describe('🔴 TRIP-1195 결정 5 · 미래일 확정 — 반영 시트·배지는 그 날 diff 로, 허브는 그 일차로', () => {
    const DAY2 = '2026-08-21';
    const FUTURE_DIFF = {
      ...SEEDED_DIFF,
      date: DAY2,
    } as unknown as ReplanDiff;

    it('F1 확정한 날(2일차)로 열리고, 시트가 펼침으로 뜨며, 배지는 캐시된 그 날 diff 에서 만든다', async () => {
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () => {
          const base = itinerary();
          const [day1] = base.days;
          return HttpResponse.json({
            ...base,
            days: [day1, { date: DAY2, slots: day1.slots }],
          });
        }),
        ...restHandlers()
      );
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { gcTime: 0 },
        },
      });
      client.setQueryData(
        getGetTripsTripIdReplanSessionsSessionIdDiffQueryKey(
          TRIP_ID,
          SESSION_ID
        ),
        FUTURE_DIFF,
        { updatedAt: Date.now() }
      );
      render(
        <LiveItineraryPage
          tripId={TRIP_ID}
          today={TODAY}
          appliedSessionId={SESSION_ID}
          initialDate={DAY2}
        />,
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>
              {children}
            </QueryClientProvider>
          ),
        }
      );
      await waitFor(() => expect(screen.getByTestId(HUB)).toBeTruthy());

      expect(screen.getByTestId('execution-live-daychip-1')).toBeSelected();
      expect(screen.getByTestId(SHEET)).toBeTruthy();
      expect(hubSnapIndices().length).toBeGreaterThan(0);
      expect(hubSnapIndices().every((index) => index === 2)).toBe(true);
      expect(screen.getAllByTestId('planb-applied-badge')).toHaveLength(3);
    });
  });

  describe('🔴 A3·A4 · AC-6 — active 일정에서만 뜬다', () => {
    it('A3 로딩 중에는 없고, 허브가 뜬 뒤에 나타난다', async () => {
      server.use(itineraryHandler(), ...restHandlers());

      render(
        <LiveItineraryPage
          tripId={TRIP_ID}
          today={TODAY}
          appliedSessionId={SESSION_ID}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('execution-live-loading')).toBeTruthy();
      expect(screen.queryByTestId(SHEET)).toBeNull();

      await waitFor(() => expect(screen.getByTestId(HUB)).toBeTruthy());
      expect(screen.getByTestId(SHEET)).toBeTruthy();
    });

    it.each([
      [
        '일정 조회 오류',
        () =>
          http.get(`${BASE}/trips/:tripId/itinerary`, () =>
            HttpResponse.json({ message: 'boom' }, { status: 500 })
          ),
        TODAY,
        'execution-live-error',
      ],
      [
        '일정 없음(404)',
        () =>
          http.get(`${BASE}/trips/:tripId/itinerary`, () =>
            HttpResponse.json({ message: 'none' }, { status: 404 })
          ),
        TODAY,
        'execution-live-notfound',
      ],
    ])(
      'A4 %s 이면 그 얼굴만 있고 시트는 없다',
      async (_label, handler, today, face) => {
        server.use(handler(), ...restHandlers());

        render(
          <LiveItineraryPage
            tripId={TRIP_ID}
            today={today}
            appliedSessionId={SESSION_ID}
          />,
          { wrapper }
        );

        await waitFor(() => expect(screen.getByTestId(face)).toBeTruthy());
        expect(screen.queryByTestId(SHEET)).toBeNull();
      }
    );
  });

  describe('🔴 A5·A6 · AC-7 — 닫기 = applied 쿼리 제거, 이동 없음', () => {
    it('A5 [확인] → setParams({ applied: undefined }) 1회 · 이동 0', async () => {
      await renderHub(SESSION_ID);

      fireEvent.press(screen.getByTestId('planb-applied-confirm'));

      expect(mockSetParams).toHaveBeenCalledTimes(1);
      // 키가 있고 값이 undefined 여야 쿼리가 지워진다 — `{}` 는 병합이라 무동작(02a ★2).
      expect(mockSetParams.mock.calls[0][0]).toStrictEqual({
        applied: undefined,
      });
      expectNoNavigation();
    });

    it('A6 스크림 → [확인]과 같다 (Q1)', async () => {
      await renderHub(SESSION_ID);

      fireEvent.press(screen.getByTestId('planb-applied-scrim'));

      expect(mockSetParams).toHaveBeenCalledTimes(1);
      expect(mockSetParams.mock.calls[0][0]).toStrictEqual({
        applied: undefined,
      });
      expectNoNavigation();
    });
  });

  describe('🔴 A7 · TRIP-1214 — 되돌리기 계약이 없어 버튼을 두지 않는다', () => {
    it('시트에 [되돌리기]·안내 줄이 없고 [확인]만 남는다', async () => {
      await renderHub(SESSION_ID);

      expect(screen.getByTestId(SHEET)).toBeTruthy();
      expect(screen.queryByTestId('planb-applied-revert')).toBeNull();
      expect(screen.queryByTestId('planb-applied-revert-notice')).toBeNull();
      expect(screen.getByTestId('planb-applied-confirm')).toBeTruthy();
    });
  });

  describe('🔴 A8 · Q5 — applied 로 들어오면 허브는 펼침으로 시작한다', () => {
    it('applied 면 허브 스냅 index 가 전부 2', async () => {
      await renderHub(SESSION_ID);

      const indices = hubSnapIndices();
      expect(indices.length).toBeGreaterThan(0);
      indices.forEach((index) => expect(index).toBe(2));
    });

    it('A8b 닫혀서 applied 가 사라져도(rerender) 시트는 없어지고 허브는 펼침 2 를 유지한다', async () => {
      await renderHub(SESSION_ID);
      expect(screen.getByTestId(SHEET)).toBeTruthy();

      // URL 에서 applied 가 지워진 뒤를 prop 으로 직접 만든다(목 setParams 는 URL 을 안 바꾼다).
      screen.rerender(
        <LiveItineraryPage
          tripId={TRIP_ID}
          today={TODAY}
          appliedSessionId={undefined}
        />
      );

      expect(screen.getByTestId(HUB)).toBeTruthy();
      expect(screen.queryByTestId(SHEET)).toBeNull();
      const indices = hubSnapIndices();
      expect(indices.length).toBeGreaterThan(0);
      indices.forEach((index) => expect(index).toBe(2));
    });

    it('대조군 — 신호가 없으면 기본 중간 스냅 1', async () => {
      await renderHub();

      const indices = hubSnapIndices();
      expect(indices.length).toBeGreaterThan(0);
      indices.forEach((index) => expect(index).toBe(1));
    });
  });
});

/**
 * TRIP-1117 · i01 허브 [메모] → 허브 위 메모 시트에서 저장 — 실 페이지 + 실제 HTTP(MSW).
 * TRIP-1070 결정 1(c)("[메모]는 j01 그날로 간다")를 뒤집는다.
 *
 * 무엇을 보장하나:
 *  - AC-1·11·12  [메모] → 이동 없이 허브 위 시트(제목 `{장소} · 메모`, 글자 수 `n/2000`).
 *  - AC-2·3·9·8  blur → `PUT …/visits/{관람 중 방문}/memo` 1회(trim), 공백만이면 0회. 성공하면 시트가 닫히고
 *                 관람 중 카드에 메모 박스가 선다(결정 2).
 *  - AC-4 · Q3   실패는 조용히 넘기지 않는다(INV-4) — 시트가 열려 있으면 시트 안, 닫힌 뒤 도착하면 카드 아래 한 줄.
 *  - AC-10       다시 열면 저장본이 입력칸에 심긴다. 같은 값이면 PUT 0회.
 *  - AC-13·14·15 ✕·스크림·끌어 닫기 = 닫힘(초안 버림, Q2). 시트가 열린 동안 수정 FAB 는 숨는다.
 *  - AC-6        입력칸은 허브 셸 시트가 아닌 **별도** 바텀시트 안에 있다.
 *  - AC-16       관람 중 방문이 바뀌면 시트가 사라진다(옛 방문에 쓰지 않는다).
 *  - AC-17 · Q4  사진 목록 GET 0회 유지. 메모 세션 캐시는 j01 과 같은 키 한 벌.
 *
 * 왜 이렇게 테스트하나:
 *  - 훅을 목으로 바꾸지 않는다 — 실제 요청 경로·본문을 MSW 로 본다(훅 목 금지 원칙).
 *  - PUT 응답을 `memoGate` 약속으로 붙잡아 "저장 중에 시트를 닫는" 창(Q3)을 타이머 없이 연다(02a ★3).
 *
 * (개념) `fireEvent(input, 'blur')` = 입력칸에서 포커스가 빠진 것처럼 흉내(키보드 "완료"와 같다) ·
 *   `holdMemo()` = 다음 PUT 응답을 `releaseMemo()` 전까지 붙잡는다 · `settle()` = 비동기 일이 끝나도록 잠깐 기다리기.
 * 3동작: 준비(일정·관람 중 방문·PUT 응답 모양) → 실행(누르기·입력·blur) → 단언(요청·시트·카드·문구).
 */
// TRIP-1117 (옛 LiveItineraryPage.memoSheet.integration.test.tsx)
describe('메모 시트', () => {
  const MEMO_PUT = `PUT /api/v1/trips/${TRIP_ID}/visits/v1/memo`;
  const PHOTOS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
  const COPY_MEMO_FAILED = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

  const SHEET = 'live-memo-sheet';
  const INPUT = 'record-trip-memo-input';
  const CARD_MEMO = `execution-live-slot-memo-${TODAY}#p1`;
  const CARD_NOTICE = 'execution-arrive-memo-notice';
  const FAB = 'execution-live-replan-fab';

  const slot = (poiId: string, nameKo: string, startAt: string) => ({
    poiId,
    startAt,
    endAt: startAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo,
    distanceRange: null,
    openingHours: null,
    tags: [],
  });

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
            slot('p1', '감천문화마을', '13:00:00'),
            slot('p2', '광안리 해변', '15:00:00'),
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

  const visit = (
    visitCheckId: string,
    poiId: string,
    completedAt: string | null
  ): VisitCheck => ({
    visitCheckId,
    poiId,
    slotKey: `${TODAY}#${poiId}`,
    arrivedAt: '2026-08-20T13:00:00',
    completedAt,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-08-20T13:00:05Z',
  });
  const memoHits = () => observedHits.filter((hit) => hit.endsWith('/memo'));
  let memoBodies: unknown[] = [];
  let memoStatus = 200;
  let memoGate: Promise<void> = Promise.resolve();
  let releaseMemo: () => void = () => {};
  let visitsResponse: () => VisitCheck[];

  /** 다음 PUT 응답을 releaseMemo() 전까지 붙잡는다 — 응답 상태는 풀 때의 memoStatus 로 정해진다. */
  function holdMemo() {
    memoGate = new Promise<void>((resolve) => {
      releaseMemo = resolve;
    });
  }

  let client: QueryClient;
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  async function release() {
    await act(async () => {
      releaseMemo();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
  beforeEach(() => {
    memoBodies = [];
    memoStatus = 200;
    memoGate = Promise.resolve();
    releaseMemo = () => {};
    visitsResponse = () => [visit('v1', 'p1', null)];
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    // 옛 목 값 — 이 관점은 뒤로가기 히스토리가 없는 것으로 돌았다.
    mockCanGoBack.mockReturnValue(false);
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: visitsResponse() })
      ),
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: [], count: 0 })
      ),
      http.put(
        `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
        async ({ request }) => {
          const body = (await request.json()) as { text: string };
          memoBodies.push(body);
          await memoGate;
          if (memoStatus !== 200) {
            return HttpResponse.json(
              { error: { code: 'INTERNAL', message: 'boom' } },
              { status: memoStatus }
            );
          }
          return HttpResponse.json({
            text: body.text,
            updatedAt: '2026-08-20T13:10:00Z',
          });
        }
      )
    );
  });
  afterEach(() => {
    client.clear();
    // 옛 목에 없던 메서드(navigate).
    expectNotCalled(mockNavigate);
  });

  async function renderHub() {
    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    return screen.findByTestId('execution-arrive-memo');
  }

  /** [메모]를 눌러 시트를 연다 — 입력칸을 돌려준다. */
  async function openSheet() {
    fireEvent.press(await screen.findByTestId('execution-arrive-memo'));
    return screen.findByTestId(INPUT);
  }

  /** 입력하고 포커스를 뺀다(= 키보드 "완료"). */
  function typeAndBlur(input: ReactTestInstance, text: string) {
    fireEvent.changeText(input, text);
    fireEvent(input, 'blur');
  }

  /** 가장 가까운 바텀시트 host — 통과형 목은 `index` 등 시트 prop 을 host View 에 펼친다(BottomSheetView 는 index 가 없다). */
  function nearestSheetHost(node: ReactTestInstance): ReactTestInstance | null {
    let current: ReactTestInstance | null = node;
    while (current !== null && typeof current.props.index !== 'number') {
      current = current.parent;
    }
    return current;
  }

  // AC-1([메모] → 이동·저장 없이 시트)은 아래 「관람 중 카드 [사진]·[메모]」 L3 가 본다 — 같은 동작이던 M1 은 합치며 지웠다(TRIP-1152).
  describe('🔴 AC-11·AC-12 · 제목과 글자 수', () => {
    it('M2 제목은 "감천문화마을 · 메모", 글자 수는 0/2000 에서 입력하면 바로 7/2000 이 된다', async () => {
      await renderHub();
      const input = await openSheet();

      expect(screen.getByTestId('live-memo-title')).toHaveTextContent(
        '감천문화마을 · 메모'
      );
      expect(screen.getByTestId('live-memo-count')).toHaveTextContent('0/2000');

      fireEvent.changeText(input, '광안리 좋았다');

      expect(screen.getByTestId('live-memo-count')).toHaveTextContent('7/2000');
    });
  });

  describe('🔴 AC-2·AC-9·AC-8 · blur 저장 → 시트 닫힘 → 카드에 메모 박스', () => {
    it('M3 앞뒤 공백을 걷은 본문으로 PUT …/visits/v1/memo 1회, 성공하면 시트가 닫히고 관람 중 카드에 본문이 보인다', async () => {
      await renderHub();
      const input = await openSheet();

      typeAndBlur(input, '  바다가 예뻤다  ');

      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
      expect(memoBodies).toEqual([{ text: '바다가 예뻤다' }]);
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );
      expect(screen.getByTestId(CARD_MEMO)).toHaveTextContent('바다가 예뻤다');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('M4 저장 전엔 관람 중 카드에 메모 박스가 없다', async () => {
      await renderHub();
      await settle();

      // 앵커 — 관람 중 카드는 있다.
      expect(
        screen.getByTestId(`execution-live-slot-${TODAY}#p1`)
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(CARD_MEMO)).toBeNull();
    });
  });

  describe('🔴 AC-3 · 공백만이면 저장하지 않는다', () => {
    it('M5 공백만 입력하고 blur → PUT 0회, 시트는 그대로 열려 있다', async () => {
      await renderHub();
      const input = await openSheet();

      typeAndBlur(input, '   ');
      await settle();

      expect(memoHits()).toEqual([]);
      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-9 (Q1) · 닫힘은 저장 성공 **뒤**다', () => {
    it('M6 PUT 응답을 기다리는 동안엔 시트가 열려 있고, 200 이 오면 닫힌다', async () => {
      holdMemo();
      await renderHub();
      const input = await openSheet();

      typeAndBlur(input, '기다리는 메모');
      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
      await settle();

      // 단언 — 응답 전: 아직 열림.
      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();

      await release();

      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );
    });
  });

  describe('🔴 AC-4 · 시트가 열린 채 실패하면 시트 안에 알린다 (INV-4)', () => {
    it('M7 PUT 500 → live-memo-notice 문구, 시트는 열린 채 입력값을 지키고 카드 아래 안내는 없다', async () => {
      memoStatus = 500;
      await renderHub();
      const input = await openSheet();

      typeAndBlur(input, '실패할 메모');

      expect(await screen.findByTestId('live-memo-notice')).toHaveTextContent(
        COPY_MEMO_FAILED
      );
      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
      expect(screen.getByTestId(INPUT).props.value).toBe('실패할 메모');
      expect(screen.queryByTestId(CARD_NOTICE)).toBeNull();
    });

    it('M8 실패 뒤 다시 blur 하면 안내가 지워지고, 이번에 성공하면 시트가 닫힌다 (PUT 총 2회)', async () => {
      memoStatus = 500;
      await renderHub();
      const input = await openSheet();
      typeAndBlur(input, '두 번째엔 된다');
      expect(await screen.findByTestId('live-memo-notice')).toHaveTextContent(
        COPY_MEMO_FAILED
      );

      // 실행 — 두 번째 시도는 응답을 붙잡은 채 보낸다.
      memoStatus = 200;
      holdMemo();
      fireEvent(screen.getByTestId(INPUT), 'blur');
      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(2));
      await settle();

      // 단언 — 새 시도가 시작되면 옛 안내는 사라진다.
      expect(screen.queryByTestId('live-memo-notice')).toBeNull();

      await release();

      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );
    });
  });

  describe('🔴 Q3 · 저장 중에 시트를 닫으면 결과는 관람 중 카드가 받는다', () => {
    it('M9 blur → PUT 보류 중 ✕ 로 닫고 → 500 이 오면 카드 아래에 안내 한 줄이 뜬다', async () => {
      holdMemo();
      await renderHub();
      const input = await openSheet();
      typeAndBlur(input, '닫고 나서 실패');
      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));

      fireEvent.press(screen.getByTestId('live-memo-close'));
      expect(screen.queryByTestId(SHEET)).toBeNull();

      memoStatus = 500;
      await release();

      expect(await screen.findByTestId(CARD_NOTICE)).toHaveTextContent(
        COPY_MEMO_FAILED
      );
      expect(screen.queryByTestId('live-memo-notice')).toBeNull();
    });

    it('M10 같은 창에서 200 이 오면 카드에 메모 박스가 서고 안내는 없다', async () => {
      holdMemo();
      await renderHub();
      const input = await openSheet();
      typeAndBlur(input, '닫고 나서 성공');
      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));

      fireEvent.press(screen.getByTestId('live-memo-close'));
      await release();

      expect(await screen.findByTestId(CARD_MEMO)).toHaveTextContent(
        '닫고 나서 성공'
      );
      expect(screen.queryByTestId(CARD_NOTICE)).toBeNull();
    });

    it('M11 카드 아래 안내는 다음 [메모] 누름에 지워지고, 새로 연 시트에도 안내가 없다', async () => {
      holdMemo();
      await renderHub();
      const input = await openSheet();
      typeAndBlur(input, '닫고 나서 실패');
      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
      fireEvent.press(screen.getByTestId('live-memo-close'));
      memoStatus = 500;
      await release();
      expect(await screen.findByTestId(CARD_NOTICE)).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('execution-arrive-memo'));

      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
      expect(screen.queryByTestId(CARD_NOTICE)).toBeNull();
      expect(screen.queryByTestId('live-memo-notice')).toBeNull();
    });
  });

  describe('🔴 AC-10 · 다시 열면 저장본이 심긴다', () => {
    it('M12 저장 뒤 [메모]를 다시 누르면 입력값·글자 수가 저장본이고, 같은 값으로 blur 해도 PUT 은 총 1회다', async () => {
      await renderHub();
      typeAndBlur(await openSheet(), '다시 볼 메모');
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );

      const again = await openSheet();

      expect(again.props.value).toBe('다시 볼 메모');
      expect(screen.getByTestId('live-memo-count')).toHaveTextContent('7/2000');

      fireEvent(again, 'blur');
      await settle();

      expect(hitCount(MEMO_PUT)).toBe(1);
    });
  });

  describe('🔴 AC-13·AC-14 · ✕·스크림·끌어 닫기 = 저장 없이 닫힘 (Q2 초안 버림)', () => {
    it('M13 입력 뒤 ✕ → 시트가 사라지고 이동·저장 0회, 다시 열면 입력칸이 비어 있다', async () => {
      await renderHub();
      const input = await openSheet();
      fireEvent.changeText(input, '버릴 초안');

      const close = screen.getByTestId('live-memo-close');
      expect(close).toHaveAccessibleName('닫기');
      fireEvent.press(close);
      await settle();

      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
      expect(memoHits()).toEqual([]);

      const reopened = await openSheet();
      expect(reopened.props.value).toBe('');
      expect(screen.getByTestId('live-memo-count')).toHaveTextContent('0/2000');
    });

    it('M14 스크림을 누르면 시트가 사라지고 이동·저장 0회다', async () => {
      await renderHub();
      fireEvent.changeText(await openSheet(), '스크림으로 닫기');

      fireEvent.press(screen.getByTestId('live-memo-scrim'));
      await settle();

      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
      expect(memoHits()).toEqual([]);
    });

    it('M15 시트를 아래로 끌어 닫으면(시트의 close) 시트가 사라진다', async () => {
      await renderHub();
      const host = nearestSheetHost(await openSheet());
      expect(host).not.toBeNull();

      fireEvent(host as ReactTestInstance, 'close');

      expect(screen.queryByTestId(SHEET)).toBeNull();
    });
  });

  describe('🔴 AC-15 · 시트가 열린 동안 수정 FAB 는 숨는다', () => {
    it('M16 열기 전 FAB 있음 → 열면 없음 → ✕ 로 닫으면 다시 있음', async () => {
      await renderHub();
      expect(screen.getByTestId(FAB)).toBeOnTheScreen();

      await openSheet();
      expect(screen.queryByTestId(FAB)).toBeNull();

      fireEvent.press(screen.getByTestId('live-memo-close'));
      expect(screen.getByTestId(FAB)).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-6 · 입력칸은 허브 셸 시트가 아닌 별도 바텀시트 안에 있다', () => {
    it('M17 입력칸의 가장 가까운 시트는 닫힘(onClose)을 쥐고 메모 시트를 품으며, 허브 셸 헤더는 품지 않는다', async () => {
      await renderHub();

      // 판별자 자가검사(짝) — 허브 셸 시트는 onClose 가 없다. 이게 깨지면 아래 onClose 단언이 셸도 통과시킨다.
      const shellHost = nearestSheetHost(
        screen.getByTestId('execution-live-sheet-header')
      );
      expect(shellHost).not.toBeNull();
      expect(typeof shellHost?.props.onClose).not.toBe('function');

      const host = nearestSheetHost(await openSheet());

      expect(host).not.toBeNull();
      expect(typeof host?.props.onClose).toBe('function');
      expect(
        host?.findAll(
          (node) => node.props.testID === 'execution-live-sheet-header'
        )
      ).toEqual([]);
      expect(
        host?.findAll((node) => node.props.testID === SHEET).length
      ).toBeGreaterThan(0);
    });
  });

  // TRIP-1203 Q1 — 옛 AC-16("관람 중 방문이 바뀌면 시트가 사라지고 옛 방문에 저장하지 않는다")을 뒤집었다.
  // 시트를 연 방문이 완료돼도 같은 방문이고 완료 방문 메모도 정당하다 → 시트는 남고 저장은 그 방문으로 간다.
  // 시트가 빠지는 것은 그 방문이 그날 목록에서 사라졌을 때뿐이다(M18b — 옛 M18 의 남는 절반).
  describe('🔴 AC-16 (TRIP-1203 Q1 개정) · 시트를 연 방문이 완료돼도 시트는 남고, 목록에서 사라지면 빠진다', () => {
    it('M18 시트가 열린 채 p1 완료·p2 도착으로 재조회돼도 시트는 v1 에 남고, 저장은 v1 으로 가 완료 카드에 박스가 선다', async () => {
      // 준비 — 관람 중 v1 으로 시트를 연다.
      await renderHub();
      await openSheet();

      // 실행 — 재조회로 p1 완료·p2 관람 중.
      visitsResponse = () => [
        visit('v1', 'p1', '2026-08-20T14:00:00'),
        visit('v2', 'p2', null),
      ];
      await act(async () => {
        await client.invalidateQueries();
      });

      // 앵커 — p2 가 관람 중 얼굴로 바뀌었다(관람 중 문구 완전 일치로 기다린다).
      await waitFor(() =>
        expect(
          screen.getByTestId(`execution-live-slot-time-${TODAY}#p2`)
        ).toHaveTextContent('15:00 도착 · 지금 관람 중')
      );
      // 단언 — 시트는 그 방문(감천문화마을)에 남는다.
      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
      expect(screen.getByTestId('live-memo-title')).toHaveTextContent(
        '감천문화마을 · 메모'
      );

      // 실행 — 그대로 입력하고 blur.
      typeAndBlur(screen.getByTestId(INPUT), '완료 뒤 메모');

      // 단언 — PUT 은 v1 으로 정확히 1회, v2 로는 0회. 닫히고 (이제 완료인) p1 카드에 박스.
      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );
      await settle();
      expect(hitCount(MEMO_PUT)).toBe(1);
      expect(hitCount(`PUT /api/v1/trips/${TRIP_ID}/visits/v2/memo`)).toBe(0);
      expect(screen.getByTestId(CARD_MEMO)).toHaveTextContent('완료 뒤 메모');
    });

    it('M18b 시트가 열린 채 그 방문이 그날 목록에서 사라지면(빈 목록) 시트가 빠지고 저장하지 않는다', async () => {
      await renderHub();
      await openSheet();

      visitsResponse = () => [];
      await act(async () => {
        await client.invalidateQueries();
      });

      // 앵커 — p1 이 예정 얼굴로 돌아갔다.
      await waitFor(() =>
        expect(
          screen.getByTestId(`execution-live-slot-time-${TODAY}#p1`)
        ).toHaveTextContent('13:00 도착 예정')
      );
      expect(screen.queryByTestId(SHEET)).toBeNull();
      await settle();
      expect(memoHits()).toEqual([]);
    });
  });

  describe('🔴 AC-17 · 허브는 메모를 저장해도 사진 목록을 조회하지 않는다 (F6)', () => {
    it('M19 시트를 열고 저장까지 해도 GET …/visits/v1/photos 는 0회다', async () => {
      await renderHub();
      typeAndBlur(await openSheet(), '사진은 안 부른다');
      await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
      await settle();

      expect(hitCount(PHOTOS_GET)).toBe(0);
    });
  });

  describe('🔴 Q4 · 메모 세션 캐시는 j01 과 같은 키 한 벌이다', () => {
    it('M20a j01 이 같은 세션에 저장한 메모(세션 캐시)가 있으면 허브 카드 박스와 시트 입력칸이 그 값이다', async () => {
      // 준비 — j01(useVisitAttachments)이 PUT 성공 뒤 적는 자리. 관찰자 없는 값이 gcTime 0 에 지워지지 않게 한다(02a ★8).
      client.setQueryDefaults(['visit-memo'], { gcTime: Infinity });
      client.setQueryData(['visit-memo', TRIP_ID, 'v1'], 'j01에서 쓴 메모');

      await renderHub();

      expect(await screen.findByTestId(CARD_MEMO)).toHaveTextContent(
        'j01에서 쓴 메모'
      );
      const input = await openSheet();
      expect(input.props.value).toBe('j01에서 쓴 메모');
    });

    it('M20b 허브에서 저장하면 j01 이 읽는 같은 키에 저장본이 남는다', async () => {
      await renderHub();
      typeAndBlur(await openSheet(), '  허브에서 쓴 메모 ');
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );

      expect(client.getQueryData(['visit-memo', TRIP_ID, 'v1'])).toBe(
        '허브에서 쓴 메모'
      );
    });
  });

  describe('AC-5 · 관람 중 방문이 없으면 [메모]도 시트도 없다 (무회귀)', () => {
    it('M21 방문 기록이 비면 [메모] 버튼이 없다', async () => {
      visitsResponse = () => [];
      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 앵커 — 카드는 그려졌다(예정 상태).
      expect(
        await screen.findByTestId(`execution-live-slot-${TODAY}#p1`)
      ).toBeOnTheScreen();
      await settle();
      expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();
      expect(screen.queryByTestId(SHEET)).toBeNull();
    });
  });
});

/**
 * TRIP-1070 · i01 허브 관람 중 카드의 [사진]·[메모] 개통 — 실 페이지 + 실제 HTTP(MSW).
 *
 * 무엇을 보장하나:
 *  - AC-1  관람 중 방문이 있으면 [사진]·[메모]가 서고, 옛 "준비 중" 힌트는 없다.
 *  - AC-2  [사진] → 앨범에서 1장 → `POST …/visits/{관람 중 방문}/photos` 1회, 본문엔 자산 번호·설치 식별자.
 *  - AC-3  [메모] → 이동하지 않고 허브 위 메모 시트가 열린다(TRIP-1117 이 TRIP-1070 결정 1(c) "j01 그날로
 *          이동"을 뒤집었다). 여는 것만으로는 저장 요청이 없다 — 저장·실패·표시 계약은 위 「메모 시트」.
 *  - AC-8  좌표는 서버의 GPS 기록 동의(`gpsRecordingOptIn`)가 켜졌을 때만 싣는다. 동의 조회가 실패하면 끈 것으로.
 *  - AC-9·10·12  취소는 조용히, 권한 거부·자산 번호 없음·피커 실패·저장 실패는 카드 아래 안내 한 줄로.
 *  - F6  허브는 사진 목록을 조회하지 않고, 화면을 열 때 동의를 미리 조회하지도 않는다(누른 뒤에만).
 *
 * 왜 이렇게 테스트하나:
 *  - 앨범(`@/shared/photo`)은 네이티브라 가짜로 바꾸고, 서버 요청은 MSW 로 실제 경로·본문을 본다.
 *  - 동의 픽스처는 `legalConsent` 와 `gpsRecordingOptIn` 을 **서로 반대로** 둔다 — 같은 값이면 엉뚱한
 *    필드를 읽어도 통과한다(02a ★3). 켜짐 → 좌표 있음 짝이 없으면 "항상 끔" 구현이 통과한다(★4).
 *
 * (개념) `server.events.on('request:start')` = 실제로 나간 요청을 "메서드 경로" 로 적는 관찰자 ·
 *   `findByTestId` = 나타날 때까지 기다렸다 찾기 · `settle()` = 비동기 일이 끝나도록 잠깐 기다리기.
 * 3동작: 준비(일정·관람 중 방문·앨범 응답) → 실행(버튼 누르기) → 단언(요청 경로·본문·안내 문구·이동).
 */
// TRIP-1070 (옛 LiveItineraryPage.photoMemo.integration.test.tsx)
describe('관람 중 카드 [사진]·[메모]', () => {
  const PHOTOS_POST = `POST /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
  const PHOTOS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
  const CONSENT_GET = 'GET /api/v1/me/location-consent';

  const COPY_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';
  const COPY_NO_ASSET_ID =
    '선택한 사진을 불러올 수 없어요. 사진 전체 접근을 허용해 주세요';
  const COPY_LIMITED =
    '사진 접근이 "선택한 사진만"으로 제한돼 있어요. 설정에서 모든 사진 접근을 허용해 주세요';
  const COPY_FAILED = '사진을 불러올 수 없어요';
  const COPY_SAVE_FAILED = '사진을 기록하지 못했어요. 다시 시도해 주세요';

  const PICKED_ASSET = {
    localAssetId: 'asset-1',
    deviceId: 'dev-A',
    takenAt: '2026-08-20T04:30:00.000Z',
    exifLat: 35.1532,
    exifLng: 129.1186,
  };

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
              startAt: '13:00:00',
              endAt: '14:00:00',
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

  /** p1 에 도착했고 아직 완료 전 — 허브에서 관람 중 카드가 된다. */
  const arrivedVisit = (): VisitCheck => ({
    visitCheckId: 'v1',
    poiId: 'p1',
    slotKey: `${TODAY}#p1`,
    arrivedAt: '2026-08-20T13:00:00',
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-08-20T13:00:05Z',
  });

  const consent = (legalConsent: boolean, gpsRecordingOptIn: boolean) => ({
    osPermissionMirror: 'GRANTED',
    legalConsent,
    gpsRecordingOptIn,
    capabilities: {
      localLocationUse: legalConsent,
      serverLocationService: legalConsent,
      gpsTrackRetention: gpsRecordingOptIn,
    },
  });
  let photoBodies: Record<string, unknown>[] = [];
  let photoStatus = 201;
  let consentResponse: () => Response;

  let client: QueryClient;
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  beforeEach(() => {
    photoBodies = [];
    photoStatus = 201;
    consentResponse = () => HttpResponse.json(consent(true, true));
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    // 옛 목 값 — 이 관점은 뒤로가기 히스토리가 없는 것으로 돌았다.
    mockCanGoBack.mockReturnValue(false);
    mockPick.mockReset().mockResolvedValue({
      kind: 'picked',
      asset: PICKED_ASSET,
    });
    mockResolveUri.mockReset().mockResolvedValue(null);
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [arrivedVisit()] })
      ),
      http.get(`${BASE}/me/location-consent`, () => consentResponse()),
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          photoBodies.push(body);
          if (photoStatus !== 201) {
            return HttpResponse.json(
              { error: { code: 'INTERNAL', message: 'boom' } },
              { status: photoStatus }
            );
          }
          return HttpResponse.json(
            {
              visitPhotoMetaId: 'ph-new',
              localAssetId: body.localAssetId,
              deviceId: body.deviceId,
              takenAt: body.takenAt ?? null,
              exifLat: null,
              exifLng: null,
              sortOrder: 0,
            },
            { status: 201 }
          );
        }
      )
    );
  });
  afterEach(() => {
    client.clear();
    // 옛 목에 없던 메서드(navigate).
    expectNotCalled(mockNavigate);
  });

  async function renderHub() {
    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    return screen.findByTestId('execution-arrive-photo');
  }

  describe('🔴 AC-1 · 관람 중 카드에 [사진]·[메모]가 선다', () => {
    it('L1 도착·미완료 방문이 있으면 [사진]·[메모]가 [방문 완료] 옆에 있고, "준비 중" 힌트는 없다', async () => {
      await renderHub();

      expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen();
      expect(screen.getByTestId('execution-arrive-memo')).toBeOnTheScreen();
      expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();
      expect(screen.queryByText(/준비 중/)).toBeNull();
    });
  });

  describe('🔴 AC-2 · [사진] → 앨범에서 고른 사진의 메타가 관람 중 방문에 붙는다', () => {
    it('L2 1장을 고르면 POST …/visits/v1/photos 가 1회, 본문에 자산 번호와 설치 식별자가 있다', async () => {
      const photo = await renderHub();

      fireEvent.press(photo);

      await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
      expect(photoBodies[0]).toMatchObject({
        localAssetId: 'asset-1',
        deviceId: 'dev-A',
      });
      expect(mockPick).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 AC-3 · [메모] → 허브를 떠나지 않고 메모 시트가 열린다 (TRIP-1117 · 결정 1(c) 번복)', () => {
    it('L3 [메모]를 누르면 이동은 0회, 허브 위에 메모 시트가 열리고, 여는 것만으로는 메모 저장 요청이 없다', async () => {
      await renderHub();

      fireEvent.press(screen.getByTestId('execution-arrive-memo'));
      await settle();

      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.getByTestId('live-memo-sheet')).toBeOnTheScreen();
      expect(observedHits.filter((hit) => hit.endsWith('/memo')).length).toBe(
        0
      );
      expect(mockPick).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-8 · 좌표는 GPS 기록 동의가 켜졌을 때만 싣는다 (BR-U5-12 · INV-U5-04)', () => {
    it.each([
      [
        '법적 동의만 켜짐 · GPS 기록 꺼짐 → 좌표 없음',
        () => HttpResponse.json(consent(true, false)),
        false,
      ],
      [
        '법적 동의 꺼짐 · GPS 기록 켜짐 → 좌표 있음',
        () => HttpResponse.json(consent(false, true)),
        true,
      ],
      [
        '동의 조회 실패(500) → 끈 것으로 보고 좌표 없음',
        () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom' } },
            { status: 500 }
          ),
        false,
      ],
    ])('L4 %s', async (_label, response, expectCoords) => {
      consentResponse = response;
      const photo = await renderHub();

      fireEvent.press(photo);

      // 동의 조회가 실패해도 사진 기록은 막지 않는다 — POST 는 나간다.
      await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
      const body = photoBodies[0] ?? {};
      if (expectCoords) {
        expect(body).toMatchObject({ exifLat: 35.1532, exifLng: 129.1186 });
      } else {
        expect(body).not.toHaveProperty('exifLat');
        expect(body).not.toHaveProperty('exifLng');
      }
    });
  });

  describe('🔴 AC-9·AC-10·AC-12 · 실패 경로 — 취소는 조용히, 나머지는 안내 한 줄', () => {
    it('L5 앨범에서 취소하면 요청도 안내도 없다', async () => {
      mockPick.mockResolvedValue({ kind: 'canceled' });
      const photo = await renderHub();

      fireEvent.press(photo);
      await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
      await settle();

      expect(hitCount(PHOTOS_POST)).toBe(0);
      expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
    });

    it.each([
      ['사진 권한 거부', 'denied', COPY_DENIED],
      ['자산 번호 없음(선택한 사진만 허용)', 'no-asset-id', COPY_NO_ASSET_ID],
      ['제한 접근', 'limited', COPY_LIMITED],
      ['피커 실패(재빌드 전 앱)', 'failed', COPY_FAILED],
    ])(
      'L6 %s → 카드 아래 안내가 뜨고 요청은 0회다',
      async (_label, kind, copy) => {
        mockPick.mockResolvedValue({ kind });
        const photo = await renderHub();

        fireEvent.press(photo);

        expect(
          await screen.findByTestId('execution-arrive-photo-notice')
        ).toHaveTextContent(copy);
        await settle();
        expect(hitCount(PHOTOS_POST)).toBe(0);
        expect(hitCount(CONSENT_GET)).toBe(0);
      }
    );

    it('L6b 권한 거부 안내에는 [설정 열기] 가 있고 누르면 openSettings 1회 · 피커 실패 안내에는 없다 (TRIP-1216 d)', async () => {
      const openSettings = jest
        .spyOn(Linking, 'openSettings')
        .mockResolvedValue(undefined);
      mockPick.mockResolvedValueOnce({ kind: 'failed' });
      const photo = await renderHub();

      fireEvent.press(photo);
      await screen.findByTestId('execution-arrive-photo-notice');
      expect(
        screen.queryByTestId('execution-arrive-photo-settings')
      ).toBeNull();

      mockPick.mockResolvedValueOnce({ kind: 'denied' });
      fireEvent.press(screen.getByTestId('execution-arrive-photo'));
      fireEvent.press(
        await screen.findByTestId('execution-arrive-photo-settings')
      );

      expect(openSettings).toHaveBeenCalledTimes(1);
      openSettings.mockRestore();
    });

    it.each(['limited', 'no-asset-id'])(
      'L6c %s 안내에도 [설정 열기] 가 있다 (TRIP-1216 a)',
      async (kind) => {
        mockPick.mockResolvedValueOnce({ kind });
        const photo = await renderHub();

        fireEvent.press(photo);

        expect(
          await screen.findByTestId('execution-arrive-photo-settings')
        ).toBeTruthy();
        expect(hitCount(PHOTOS_POST)).toBe(0);
      }
    );

    it('L7 사진 기록 요청이 실패하면(500) 저장 실패 안내가 뜬다', async () => {
      photoStatus = 500;
      const photo = await renderHub();

      fireEvent.press(photo);

      expect(
        await screen.findByTestId('execution-arrive-photo-notice')
      ).toHaveTextContent(COPY_SAVE_FAILED);
      expect(hitCount(PHOTOS_POST)).toBe(1);
    });

    it('L8 안내가 뜬 뒤 [사진]을 다시 누르면 안내가 지워진다', async () => {
      mockPick.mockResolvedValueOnce({ kind: 'denied' });
      const photo = await renderHub();
      fireEvent.press(photo);
      expect(
        await screen.findByTestId('execution-arrive-photo-notice')
      ).toHaveTextContent(COPY_DENIED);

      // 실행 — 두 번째는 취소.
      mockPick.mockResolvedValueOnce({ kind: 'canceled' });
      fireEvent.press(screen.getByTestId('execution-arrive-photo'));
      await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(2));
      await settle();

      expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
    });
  });

  describe('🔴 F6 · 허브는 사진 목록을 조회하지 않고, 동의는 누른 뒤에만 읽는다', () => {
    it('L9 화면을 연 뒤 동의 조회 0회 · 사진을 붙인 뒤에도 사진 목록 조회 0회', async () => {
      const photo = await renderHub();
      await settle();

      // 단언 — 누르기 전엔 동의를 조회하지 않는다.
      expect(hitCount(CONSENT_GET)).toBe(0);

      fireEvent.press(photo);
      await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
      await settle();

      // 단언 — 동의는 누른 뒤 1회, 사진 목록 조회는 처음부터 끝까지 0회.
      expect(hitCount(CONSENT_GET)).toBe(1);
      expect(hitCount(PHOTOS_GET)).toBe(0);
    });
  });
});

/**
 * TRIP-1203 · i01 허브 **방문 완료 카드**의 [사진]·[메모] — 실 페이지 + 실제 HTTP(MSW).
 *
 * 무엇을 보장하나:
 *  - AC-1  방문 id 를 아는 완료 카드(낙관 id 가 아닌 완료 계획 방문)에 [사진]·[메모]가 선다. [방문 완료]·[길찾기]는
 *          없고, 관람 중 카드의 고정 한 쌍은 그대로 1쌍이다. 시각 표기(TRIP-1220)는 그대로다(AC-8).
 *  - AC-2  완료 [사진] → `POST …/visits/{그 완료 방문 id}/photos` 1회(본문은 관람 중과 같은 메타), 사진 목록 GET 0(F6).
 *  - AC-3  결과 안내는 누른 그 카드 아래 1줄 — 취소 무음, 권한 사유면 [설정 열기], 저장 실패 문구. 어느 카드든
 *          다음 [사진]에 지워진다.
 *  - AC-4  완료 [메모] → 이동 없이 허브 위 메모 시트(제목 `{그 장소} · 메모`, 시드 = 그 방문 저장본) → blur →
 *          `PUT …/visits/{그 완료 방문 id}/memo` 1회 → 닫힘 → 그 완료 카드에 메모 박스.
 *  - AC-5  저장 실패: 시트가 열려 있으면 시트 안, 닫힌 뒤 도착하면 그 완료 카드 아래.
 *  - AC-6  완료 시트를 연 동안·저장 뒤에도 관람 중 카드 메모 박스는 관람 중 방문 값이고, 관람 중 [메모]는
 *          관람 중 방문으로 PUT 한다(저장 대상 ≠ 표시 대상, 02a ★3).
 *  - AC-7  j01 이 같은 세션에 저장한 완료 방문 메모가 허브 완료 카드에 보이고, 나중에 바뀌어도 따라온다(구독).
 *
 * 픽스처: 오늘 p1 감천문화마을 10:00(v1 완료) · p2 광안리 해변 13:00(v2 관람 중) · p3 전포 카페거리 15:00(예정).
 * ⚠️ client 는 gcTime 0 — 렌더 전에 심는 세션 저장본은 `setQueryDefaults(['visit-memo'], { gcTime: Infinity })`
 *   뒤에 넣는다(02a ★5). 실패 응답은 500 JSON 으로만 낸다(`HttpResponse.error()` 는 대기 헬퍼를 영원히 막는다, ★8).
 * (개념) `within(카드)` = 그 카드 노드 안에서만 찾기 — "그 카드 아래에만"을 재는 자 ·
 *   `invalidateQueries` 는 쓰지 않는다(재조회 사슬은 「메모 시트」 M18 이 본다).
 * 3동작: 준비(일정·방문·앨범/서버 응답) → 실행(완료 카드 버튼) → 단언(요청 경로·횟수·카드 안 표시).
 */
// TRIP-1203
describe('방문 완료 카드 [사진]·[메모]', () => {
  const DONE_KEY = `${TODAY}#p1`;
  const ACTIVE_KEY = `${TODAY}#p2`;
  const UPCOMING_KEY = `${TODAY}#p3`;
  const done = (role: string) => `execution-live-slot-done-${role}-${DONE_KEY}`;
  const DONE_ANY = /^execution-live-slot-done-/;
  const card = (key: string) =>
    screen.getByTestId(`execution-live-slot-${key}`);

  const PHOTOS_POST_V1 = `POST /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
  const PHOTOS_POST_V2 = `POST /api/v1/trips/${TRIP_ID}/visits/v2/photos`;
  const PHOTOS_GET_V1 = `GET /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
  const MEMO_PUT_V1 = `PUT /api/v1/trips/${TRIP_ID}/visits/v1/memo`;
  const MEMO_PUT_V2 = `PUT /api/v1/trips/${TRIP_ID}/visits/v2/memo`;

  const COPY_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';
  const COPY_FAILED = '사진을 불러올 수 없어요';
  const COPY_SAVE_FAILED = '사진을 기록하지 못했어요. 다시 시도해 주세요';
  const COPY_MEMO_FAILED = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

  const SHEET = 'live-memo-sheet';
  const INPUT = 'record-trip-memo-input';

  const slot = (poiId: string, nameKo: string, startAt: string) => ({
    poiId,
    startAt,
    endAt: startAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo,
    distanceRange: null,
    openingHours: null,
    tags: [],
  });

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
            slot('p1', '감천문화마을', '10:00:00'),
            slot('p2', '광안리 해변', '13:00:00'),
            slot('p3', '전포 카페거리', '15:00:00'),
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

  const visit = (
    over: Partial<VisitCheck> & { poiId: string }
  ): VisitCheck => ({
    visitCheckId: `v-${over.poiId}`,
    slotKey: `${TODAY}#${over.poiId}`,
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-08-20T05:00:05Z',
    ...over,
  });
  /** v1 = p1 완료(도착 01:02Z = KST 10:02), v2 = p2 도착·미완료(관람 중). */
  const doneV1 = () =>
    visit({
      visitCheckId: 'v1',
      poiId: 'p1',
      arrivedAt: '2026-08-20T01:02:00Z',
      completedAt: '2026-08-20T02:00:00Z',
    });
  const activeV2 = () =>
    visit({
      visitCheckId: 'v2',
      poiId: 'p2',
      arrivedAt: '2026-08-20T04:00:00Z',
    });

  const PICKED_ASSET = {
    localAssetId: 'asset-9',
    deviceId: 'dev-B',
    takenAt: '2026-08-20T01:30:00.000Z',
    exifLat: 35.0975,
    exifLng: 129.0106,
  };

  let visitsResponse: () => VisitCheck[];
  let photoBodies: Record<string, unknown>[] = [];
  let photoStatus = 201;
  let memoBodies: unknown[] = [];
  let memoStatus = 200;
  let memoGate: Promise<void> = Promise.resolve();
  let releaseMemo: () => void = () => {};

  /** 다음 PUT 응답을 releaseMemo() 전까지 붙잡는다 — 응답 상태는 풀 때의 memoStatus 로 정해진다. */
  function holdMemo() {
    memoGate = new Promise<void>((resolve) => {
      releaseMemo = resolve;
    });
  }
  async function release() {
    await act(async () => {
      releaseMemo();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  let client: QueryClient;
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  /** 렌더 전에 세션 저장본을 심는다 — j01·관람 중 시트가 PUT 성공 뒤 적는 자리(gcTime 0 이라 기본값부터 푼다). */
  function seedMemo(visitCheckId: string, text: string) {
    client.setQueryDefaults(['visit-memo'], { gcTime: Infinity });
    client.setQueryData(['visit-memo', TRIP_ID, visitCheckId], text);
  }

  beforeEach(() => {
    visitsResponse = () => [doneV1(), activeV2()];
    photoBodies = [];
    photoStatus = 201;
    memoBodies = [];
    memoStatus = 200;
    memoGate = Promise.resolve();
    releaseMemo = () => {};
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    mockCanGoBack.mockReturnValue(false);
    mockPick.mockReset().mockResolvedValue({
      kind: 'picked',
      asset: PICKED_ASSET,
    });
    mockResolveUri.mockReset().mockResolvedValue(null);
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: visitsResponse() })
      ),
      http.get(`${BASE}/me/location-consent`, () =>
        HttpResponse.json({
          osPermissionMirror: 'GRANTED',
          legalConsent: true,
          gpsRecordingOptIn: false,
          capabilities: {
            localLocationUse: true,
            serverLocationService: true,
            gpsTrackRetention: false,
          },
        })
      ),
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: [], count: 0 })
      ),
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          photoBodies.push(body);
          if (photoStatus !== 201) {
            return HttpResponse.json(
              { error: { code: 'INTERNAL', message: 'boom' } },
              { status: photoStatus }
            );
          }
          return HttpResponse.json(
            {
              visitPhotoMetaId: 'ph-new',
              localAssetId: body.localAssetId,
              deviceId: body.deviceId,
              takenAt: body.takenAt ?? null,
              exifLat: null,
              exifLng: null,
              sortOrder: 0,
            },
            { status: 201 }
          );
        }
      ),
      http.put(
        `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
        async ({ request }) => {
          const body = (await request.json()) as { text: string };
          memoBodies.push(body);
          await memoGate;
          if (memoStatus !== 200) {
            return HttpResponse.json(
              { error: { code: 'INTERNAL', message: 'boom' } },
              { status: memoStatus }
            );
          }
          return HttpResponse.json({
            text: body.text,
            updatedAt: '2026-08-20T05:10:00Z',
          });
        }
      )
    );
  });
  afterEach(() => {
    client.clear();
    expectNotCalled(mockNavigate);
  });

  /** 허브를 그리고 완료 카드 [사진]이 설 때까지 기다린다 — 그 버튼을 돌려준다. */
  async function renderHub() {
    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
    return screen.findByTestId(done('photo'));
  }

  /** 입력하고 포커스를 뺀다(= 키보드 "완료"). */
  function typeAndBlur(input: ReactTestInstance, text: string) {
    fireEvent.changeText(input, text);
    fireEvent(input, 'blur');
  }

  describe('🔴 AC-1·AC-8 · 방문 id 를 아는 완료 카드에 [사진]·[메모]가 선다', () => {
    it('D1 완료 카드 안에 [사진]·[메모]가 있고 [방문 완료]·[길찾기]는 없다 — 관람 중 고정 한 쌍은 1쌍, 예정 카드엔 없다, 시각은 10:02 방문', async () => {
      await renderHub();

      // 단언 — 완료(p1) 카드 안.
      const doneCard = within(card(DONE_KEY));
      expect(doneCard.getByTestId(done('photo'))).toHaveTextContent('사진');
      expect(doneCard.getByTestId(done('memo'))).toHaveTextContent('메모');
      expect(doneCard.queryByTestId('execution-arrive-complete')).toBeNull();
      expect(
        doneCard.queryByTestId(`execution-live-slot-directions-${DONE_KEY}`)
      ).toBeNull();
      // TRIP-1220 무변경 — 실제 도착 시각 + "방문".
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${DONE_KEY}`)
      ).toHaveTextContent('10:02');
      expect(
        screen.getByTestId(`execution-live-slot-visit-label-${DONE_KEY}`)
      ).toHaveTextContent('방문');

      // 단언 — 관람 중(p2) 고정 한 쌍은 그대로 1쌍, 예정(p3) 카드엔 done 버튼 없음.
      expect(screen.getAllByTestId('execution-arrive-photo')).toHaveLength(1);
      expect(
        within(card(ACTIVE_KEY)).getByTestId('execution-arrive-memo')
      ).toBeOnTheScreen();
      expect(
        within(card(UPCOMING_KEY)).queryAllByTestId(DONE_ANY)
      ).toHaveLength(0);
    });

    it('D2 낙관 id(optimistic:) 로 완료된 카드엔 버튼이 없고, 같은 화면의 서버 id 완료 카드엔 있다', async () => {
      // 준비 — p1 완료 레코드는 아직 낙관 id(재조회 전 [방문 완료]와 같은 캐시 상태, 02a ★6), p2 는 서버 id 로 완료.
      visitsResponse = () => [
        visit({
          visitCheckId: 'optimistic:p1',
          poiId: 'p1',
          arrivedAt: '2026-08-20T00:00:00',
          completedAt: '2026-08-20T00:00:00',
        }),
        visit({
          visitCheckId: 'v2',
          poiId: 'p2',
          arrivedAt: '2026-08-20T04:00:00Z',
          completedAt: '2026-08-20T05:00:00Z',
        }),
      ];
      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 단언 — 서버 id 완료 카드(p2)엔 한 쌍.
      const p2 = await screen.findByTestId(
        `execution-live-slot-done-photo-${ACTIVE_KEY}`
      );
      expect(within(card(ACTIVE_KEY)).getAllByTestId(DONE_ANY)).toHaveLength(2);
      expect(p2).toBeOnTheScreen();
      // 단언 — 낙관 완료 카드(p1)는 완료 얼굴(계획 시각 폴백)이지만 버튼이 없다.
      expect(
        screen.getByTestId(`execution-live-slot-visit-label-${DONE_KEY}`)
      ).toHaveTextContent('계획');
      expect(within(card(DONE_KEY)).queryAllByTestId(DONE_ANY)).toHaveLength(0);
    });
  });

  describe('🔴 AC-2 · 완료 [사진] → 그 완료 방문에 메타만 POST', () => {
    it('D3 POST …/visits/v1/photos 정확히 1회(v2 로는 0), 본문에 자산 번호·설치 식별자, 사진 목록 조회 0', async () => {
      const photo = await renderHub();

      fireEvent.press(photo);

      await waitFor(() => expect(hitCount(PHOTOS_POST_V1)).toBe(1));
      await settle();
      expect(hitCount(PHOTOS_POST_V1)).toBe(1);
      expect(hitCount(PHOTOS_POST_V2)).toBe(0);
      expect(photoBodies[0]).toMatchObject({
        localAssetId: 'asset-9',
        deviceId: 'dev-B',
      });
      expect(hitCount(PHOTOS_GET_V1)).toBe(0);
    });
  });

  describe('🔴 AC-3 · 안내는 누른 그 완료 카드 아래 한 줄 (INV-4)', () => {
    it('D4 권한 거부 → 그 카드 안에 안내와 [설정 열기], 누르면 openSettings 1회 · 관람 중 고정 안내는 없고 POST 0', async () => {
      const openSettings = jest
        .spyOn(Linking, 'openSettings')
        .mockResolvedValue(undefined);
      mockPick.mockResolvedValueOnce({ kind: 'denied' });
      const photo = await renderHub();

      fireEvent.press(photo);

      const doneCard = within(card(DONE_KEY));
      expect(await screen.findByTestId(done('photo-notice'))).toHaveTextContent(
        COPY_DENIED
      );
      expect(doneCard.getByTestId(done('photo-notice'))).toBeOnTheScreen();
      expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
      fireEvent.press(doneCard.getByTestId(done('photo-settings')));
      expect(openSettings).toHaveBeenCalledTimes(1);
      await settle();
      expect(hitCount(PHOTOS_POST_V1)).toBe(0);
      openSettings.mockRestore();
    });

    it('D5 피커 실패 → 안내만 있고 [설정 열기]는 없다', async () => {
      mockPick.mockResolvedValueOnce({ kind: 'failed' });
      const photo = await renderHub();

      fireEvent.press(photo);

      expect(await screen.findByTestId(done('photo-notice'))).toHaveTextContent(
        COPY_FAILED
      );
      expect(screen.queryByTestId(done('photo-settings'))).toBeNull();
    });

    it('D6 사진 기록 요청이 500 이면 그 카드 아래 저장 실패 안내가 뜬다', async () => {
      photoStatus = 500;
      const photo = await renderHub();

      fireEvent.press(photo);

      expect(
        await within(card(DONE_KEY)).findByTestId(done('photo-notice'))
      ).toHaveTextContent(COPY_SAVE_FAILED);
      expect(hitCount(PHOTOS_POST_V1)).toBe(1);
    });

    it('D7 앨범에서 취소하면 요청도 안내도 없다', async () => {
      mockPick.mockResolvedValueOnce({ kind: 'canceled' });
      const photo = await renderHub();

      fireEvent.press(photo);
      await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
      await settle();

      expect(hitCount(PHOTOS_POST_V1)).toBe(0);
      expect(screen.queryByTestId(done('photo-notice'))).toBeNull();
      expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
    });

    it('D8 안내는 마지막 한 줄 — 관람 중 [사진]을 누르면 완료 카드 안내가 지워지고, 다시 완료 [사진](취소)을 누르면 둘 다 없다', async () => {
      // 1) 완료 카드 — 권한 거부 안내.
      mockPick.mockResolvedValueOnce({ kind: 'denied' });
      const photo = await renderHub();
      fireEvent.press(photo);
      expect(await screen.findByTestId(done('photo-notice'))).toHaveTextContent(
        COPY_DENIED
      );

      // 2) 관람 중 카드 — 권한 거부 안내가 그 카드로 옮겨 간다.
      mockPick.mockResolvedValueOnce({ kind: 'denied' });
      fireEvent.press(screen.getByTestId('execution-arrive-photo'));
      expect(
        await within(card(ACTIVE_KEY)).findByTestId(
          'execution-arrive-photo-notice'
        )
      ).toHaveTextContent(COPY_DENIED);
      expect(screen.queryByTestId(done('photo-notice'))).toBeNull();

      // 3) 완료 카드 — 이번엔 취소: 아무 안내도 없다.
      mockPick.mockResolvedValueOnce({ kind: 'canceled' });
      fireEvent.press(screen.getByTestId(done('photo')));
      await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(3));
      await settle();
      expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
      expect(screen.queryByTestId(done('photo-notice'))).toBeNull();
    });
  });

  describe('🔴 AC-4 · 완료 [메모] → 허브 위 시트 → 그 완료 방문으로 PUT → 그 카드에 박스', () => {
    it('D9 이동 없이 "감천문화마을 · 메모" 시트가 빈 입력으로 열리고, blur 하면 PUT …/v1/memo 정확히 1회 → 닫힘 → 완료 카드에 본문', async () => {
      await renderHub();

      fireEvent.press(screen.getByTestId(done('memo')));
      const input = await screen.findByTestId(INPUT);

      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.getByTestId('live-memo-title')).toHaveTextContent(
        '감천문화마을 · 메모'
      );
      expect(input.props.value).toBe('');

      typeAndBlur(input, '  벽화 골목 좋았다  ');

      await waitFor(() => expect(hitCount(MEMO_PUT_V1)).toBe(1));
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );
      await settle();
      expect(hitCount(MEMO_PUT_V1)).toBe(1);
      expect(hitCount(MEMO_PUT_V2)).toBe(0);
      expect(memoBodies).toEqual([{ text: '벽화 골목 좋았다' }]);
      expect(
        within(card(DONE_KEY)).getByTestId(
          `execution-live-slot-memo-${DONE_KEY}`
        )
      ).toHaveTextContent('벽화 골목 좋았다');
      expect(
        screen.queryByTestId(`execution-live-slot-memo-${ACTIVE_KEY}`)
      ).toBeNull();
    });
  });

  describe('🔴 AC-7 · j01 이 같은 세션에 저장한 완료 방문 메모가 보이고 따라온다 (키 한 벌·구독)', () => {
    it('D10 렌더 전 저장본이 완료 카드 박스에 보이고, 렌더 뒤 바뀌면 다시 그려지며, 시트 입력칸도 새 값이다', async () => {
      // 준비 — j01 이 v1 에 저장해 둔 값.
      seedMemo('v1', 'j01에서 쓴 메모');
      await renderHub();

      const memoBox = `execution-live-slot-memo-${DONE_KEY}`;
      expect(await screen.findByTestId(memoBox)).toHaveTextContent(
        'j01에서 쓴 메모'
      );

      // 실행 — 허브가 떠 있는 동안 j01 쪽에서 값이 바뀐다(같은 키).
      await act(async () => {
        client.setQueryData(['visit-memo', TRIP_ID, 'v1'], 'j01에서 고친 메모');
      });

      // 단언 — 구독이라 다시 그려진다(렌더 중 한 번 읽기면 옛 값에 머문다, 02a ★4).
      await waitFor(() =>
        expect(screen.getByTestId(memoBox)).toHaveTextContent(
          'j01에서 고친 메모'
        )
      );
      fireEvent.press(screen.getByTestId(done('memo')));
      expect((await screen.findByTestId(INPUT)).props.value).toBe(
        'j01에서 고친 메모'
      );
    });
  });

  describe('🔴 AC-5 · 완료 메모 저장 실패 (INV-4)', () => {
    it('D11 시트가 열린 채 500 → 시트 안에 안내, 카드 아래 안내(완료·관람 중)는 없다', async () => {
      memoStatus = 500;
      await renderHub();
      fireEvent.press(screen.getByTestId(done('memo')));

      typeAndBlur(await screen.findByTestId(INPUT), '실패할 메모');

      expect(await screen.findByTestId('live-memo-notice')).toHaveTextContent(
        COPY_MEMO_FAILED
      );
      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
      expect(screen.queryByTestId(done('memo-notice'))).toBeNull();
      expect(screen.queryByTestId('execution-arrive-memo-notice')).toBeNull();
    });

    it('D12 PUT 보류 중 ✕ 로 닫고 500 이 오면 그 완료 카드 아래에 안내 한 줄', async () => {
      holdMemo();
      await renderHub();
      fireEvent.press(screen.getByTestId(done('memo')));
      typeAndBlur(await screen.findByTestId(INPUT), '닫고 나서 실패');
      await waitFor(() => expect(hitCount(MEMO_PUT_V1)).toBe(1));

      fireEvent.press(screen.getByTestId('live-memo-close'));
      expect(screen.queryByTestId(SHEET)).toBeNull();
      memoStatus = 500;
      await release();

      expect(
        await within(card(DONE_KEY)).findByTestId(done('memo-notice'))
      ).toHaveTextContent(COPY_MEMO_FAILED);
      expect(screen.queryByTestId('execution-arrive-memo-notice')).toBeNull();
      expect(screen.queryByTestId('live-memo-notice')).toBeNull();
    });
  });

  describe('🔴 AC-6 · 무회귀 — 관람 중 박스와 관람 중 PUT 대상은 그대로', () => {
    it('D13 완료 시트를 연 동안에도 관람 중 박스는 관람 중 메모이고, 완료 저장은 v1 만 · 뒤이은 관람 중 저장은 v2 로 간다', async () => {
      // 준비 — 관람 중 방문(v2)에 이미 저장본이 있다.
      seedMemo('v2', '관람 중 메모');
      await renderHub();
      const activeBox = `execution-live-slot-memo-${ACTIVE_KEY}`;
      const doneBox = `execution-live-slot-memo-${DONE_KEY}`;
      expect(await screen.findByTestId(activeBox)).toHaveTextContent(
        '관람 중 메모'
      );

      // 실행 — 완료 카드 [메모]로 시트를 연다.
      fireEvent.press(screen.getByTestId(done('memo')));
      const input = await screen.findByTestId(INPUT);

      // 단언 — 열린 동안: 시드는 완료 방문 것(빈 값), 관람 중 박스는 그대로(02a ★3).
      expect(input.props.value).toBe('');
      expect(screen.getByTestId(activeBox)).toHaveTextContent('관람 중 메모');

      // 실행 — 완료 메모 저장.
      typeAndBlur(input, '완료 메모');
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );
      await settle();

      // 단언 — v1 만 1회, 두 박스가 각자 제 값.
      expect(hitCount(MEMO_PUT_V1)).toBe(1);
      expect(hitCount(MEMO_PUT_V2)).toBe(0);
      expect(screen.getByTestId(doneBox)).toHaveTextContent('완료 메모');
      expect(screen.getByTestId(activeBox)).toHaveTextContent('관람 중 메모');

      // 실행 — 관람 중 [메모]: 시드는 관람 중 저장본, 저장은 v2.
      fireEvent.press(screen.getByTestId('execution-arrive-memo'));
      const activeInput = await screen.findByTestId(INPUT);
      expect(activeInput.props.value).toBe('관람 중 메모');
      typeAndBlur(activeInput, '관람 중 새 메모');
      await waitFor(() => expect(hitCount(MEMO_PUT_V2)).toBe(1));
      await settle();

      // 단언
      expect(hitCount(MEMO_PUT_V1)).toBe(1);
      expect(hitCount(MEMO_PUT_V2)).toBe(1);
      expect(screen.getByTestId(activeBox)).toHaveTextContent(
        '관람 중 새 메모'
      );
      expect(screen.getByTestId(doneBox)).toHaveTextContent('완료 메모');
    });
  });
});

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
 * 갈린다(아래 「i02 트리거 표면」 철학 계승 — 훅을 목킹하지 않는다).
 *
 * ⚠️ 통과형 목 사각: 시트 목은 `index` 를 무시하고 항상 그린다 — 그래서 "열림"은 **마운트 여부**로만
 * 잰다(02a ★1). 실제 딤 전면 커버·끌어 닫기·i04 가 위에 겹쳐 뜨는 모습은 실기(AC-V2).
 */
// TRIP-749 (옛 LiveItineraryPage.riskSheet.integration.test.tsx)
describe('i03 위험 상세 시트', () => {
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
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  const CHIP = 'execution-live-trigger-chip';
  const ALT = 'execution-live-trigger-alternative';
  const SHEET = 'planb-risk-sheet';
  const DISMISS_PATH = `POST /api/v1/trips/${TRIP_ID}/triggers/trg-1/dismiss`;
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
  // 옛 목은 replace·push 뿐이었다 — 그 밖의 메서드가 불리면 red 였다.
  afterEach(() => {
    expectNotCalled(mockBack, mockCanGoBack, mockSetParams, mockNavigate);
  });

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

    // 발화 트리거가 없으면 알약이 없다는 것은 「i02 트리거 표면」 I-T2 가 본다 — 같은 동작이던 R-I7 은 합치며 지웠다
    // (트리거가 0개면 시트는 원리적으로 못 뜬다 — 시트는 목록 안 트리거를 id 로 찾는다, TRIP-1152).
  });
});

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
 *    위 「i03 위험 상세 시트」 R-I5a/b 에 옮겼다(옛 I-T4a/b).
 *  - 숨김 경로(일자 칩·FAB·시트 스크롤)를 눌러도 dismiss POST 는 0회다 — 로컬 숨김일 뿐(D3 · AC-7).
 *
 * 왜 통합 버킷인가(위 「허브」 철학 계승): 표시 게이트·MANUAL
 * 필터·slotKey 매칭·라우팅이 실 조회 상태와 라우터의 조합에서 갈린다 — 훅을 목킹하면 그 조합이
 * 테스트의 가정이 되어 버린다. 그래서 msw 로 트리거 목록을 서빙해 전 경로를 태운다.
 *
 * ⚠️ 통과형 목 사각: router.push 는 "불렸다·이 인자로 나갔다"까지만 잰다 — 실제 네비게이션·실제
 * 스크롤 제스처는 6-b 실기(`live-trigger-*` 프리뷰) 소관.
 */
// TRIP-561 → TRIP-748 (옛 LiveItineraryPage.trigger.integration.test.tsx)
describe('i02 트리거 표면', () => {
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
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  const CHIP = 'execution-live-trigger-chip';
  const LABEL = 'execution-live-trigger-label';
  const STATUS = `execution-live-slot-status-${SLOT_KEY}`;
  const DISMISS_PATH = `POST /api/v1/trips/${TRIP_ID}/triggers/trg-1/dismiss`;
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
      (nodes[nodes.length - 1].props.onScrollBeginDrag as (e: unknown) => void)(
        {
          nativeEvent: {},
        }
      );
    });
  }
  // 옛 목은 replace·push 뿐이었다 — 그 밖의 메서드가 불리면 red 였다.
  afterEach(() => {
    expectNotCalled(mockBack, mockCanGoBack, mockSetParams, mockNavigate);
  });

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

        expect(
          screen.queryByTestId('execution-live-trigger-banner')
        ).toBeNull();
        expect(
          screen.queryByTestId('execution-live-trigger-dismiss')
        ).toBeNull();
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
      server.use(
        ...baseHandlers({ triggers: [mkTrigger({ kind: 'MANUAL' })] })
      );

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
});

/**
 * TRIP-396 · AC-3 · AC-4 배선 + active 카드 **도달성** — 방문 기록을 실제 조회 상태에서 태운다.
 *
 * 무엇을 보장하나:
 *  - **W1 (★도달성)** 그 날 방문 기록에 "도착·미완료"가 있으면 그 슬롯이 **active 카드**로 뜬다.
 *    페이지가 `GET /visits/days` → `deriveVisitProgress` → `projectSlotProgress(slots,{activePoiId})`
 *    배선을 안 하면 전부 upcoming → active 카드가 없어 red. 이 배선이 이 티켓의 숨은 필수 전제
 *    (repo-traps execution — 현재 코드는 progress 인자 없이 호출해 active 가 프로덕션에 안 뜬다).
 *  - **W2 (AC-3)** active 카드 [방문 완료] press → `POST /visits/{visitCheckId}/complete` 가 도출된
 *    id 로 나가고, 그 슬롯이 done(컴팩트)으로 바뀐다.
 *  - **W3 (TRIP-1021 AC-1 · 반전)** 기록이 없는 오늘 탭 예정 카드의 [도착] press → `POST /visits`
 *    `{slotKey, poiId, source:'MANUAL'}` 1회 → 그 카드가 active. TRIP-746 이 "도착 자동 원칙"으로 이
 *    표면을 지웠으나, 자동 도착(TRIP-1018)이 보류라 수동이 유일한 도착 경로여서 되살렸다(01b).
 *  - **W4~W9 (TRIP-1021)** 도착→완료 사슬(AC-2) · 실패 롤백(AC-5) · active 있으면 [도착] 없음(AC-3) ·
 *    오늘 탭에서만(Q6) · 연타해도 POST 1회(AC-1) · 위치 권한 무관(Q2).
 *  - **W10~W14 (TRIP-1021 5-c 수정 루프 1)** 여행 전·후엔 어느 탭에도 [도착] 없음(경고1 — `todayIndex`
 *    는 여행 밖이면 첫날/마지막 날로 맞춰 끼운 값이라 "오늘"이 아니다) · 방문 기록 조회가 실패·로딩 중이면
 *    [도착] 없음(경고2) · 도착 실패 뒤 다시 누르면 요청이 다시 나간다(경고4 — 연타 가드가 풀리는가).
 *  - **W16~W19 (TRIP-1079)** 즉석 방문(slotKey 없음)은 허브 판정에서 빠진다 — 계획 슬롯의 관람 중을
 *    가로채지 않고(AC-1·AC-4), 혼자서 계획 카드를 관람 중·완료로 칠하지도 않는다(AC-3·AC-5).
 *  - **W20 (TRIP-1079 5-c 경고-1)** 계획 도착 후보가 둘이면 페이지가 planOrder 를 **순서대로**
 *    넘겨야 앞 슬롯이 관람 중이 된다(AC-6) — W16~W19 는 후보가 하나라 순서 배선을 못 본다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "조회 상태 → 사영 → 카드"의 배선과 "실제로 나간 경로·바디"다 —
 * 훅을 목킹하면 그 사영이 테스트의 가정이 되어 버린다(위 「허브」 선례).
 */
// TRIP-396 · TRIP-1021 · TRIP-1076 · TRIP-1079 (옛 LiveItineraryPage.visitCheck.integration.test.tsx)
describe('방문 체크', () => {
  // KST 13:00 — 시각 단언이 기기 시간대와 무관하도록 Z 로 못박는다(CI 는 UTC).
  const T = '2026-08-20T04:00:00Z';
  const VISITS_PATH = `POST /api/v1/trips/${TRIP_ID}/visits`;
  const VISITS_GET_TODAY = `GET /api/v1/trips/${TRIP_ID}/visits/days/${TODAY}`;
  const arriveId = (date: string, poiId: string) =>
    `execution-live-slot-arrive-${date}#${poiId}`;

  const slot = (poiId: string, nameKo: string, startAt: string) => ({
    poiId,
    startAt,
    endAt: startAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo,
    distanceRange: null,
    openingHours: null,
    tags: [],
  });

  /** TRIP-1021 — 날짜별 슬롯을 직접 준다(두 슬롯·이틀 케이스). */
  const itineraryOf = (
    days: { date: string; slots: ReturnType<typeof slot>[] }[]
  ): Itinerary =>
    ({
      itineraryId: 'it1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL',
      generationMode: 'AI',
      isFallback: false,
      generationState: 'COMPLETE',
      days,
    }) as unknown as Itinerary;

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
              startAt: '13:00:00',
              endAt: '14:00:00',
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

  const vc = (
    over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
  ): VisitCheck => ({
    slotKey: `${TODAY}#${over.poiId}`,
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    // 서버 버전 시각(BR-U5-22 · openapi:1953) — codegen 후 required 라 픽스처가 미리 채운다(TRIP-619).
    updatedAt: '2026-08-20T13:00:05Z',
    ...over,
  });

  /** trip·itinerary 핸들러는 항상 등록(page 가 무조건 조회). visits 만 케이스가 갈아끼운다. */
  const baseHandlers = (plan: Itinerary = itinerary()) => [
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => HttpResponse.json(plan)),
  ];
  /** POST /visits 로 나간 본문(TRIP-1021 — 슬롯 키 트립와이어). */
  let arriveBodies: unknown[] = [];

  // 테스트마다 새 클라이언트 — W4 는 재조회가 캐시에 도착했는지를 이 클라이언트로 기다린다(02a ★5).
  let client: QueryClient;
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  beforeEach(() => {
    arriveBodies = [];
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    mockGetForeground.mockResolvedValue({ status: 'granted', granted: true });
    mockRequestForeground.mockResolvedValue({
      status: 'granted',
      granted: true,
    });
  });
  afterEach(() => {
    client.clear();
    // 옛 목은 replace 뿐이었다 — 그 밖의 메서드가 불리면 red 였다.
    expectNotCalled(
      mockPush,
      mockBack,
      mockCanGoBack,
      mockSetParams,
      mockNavigate
    );
  });

  describe('LiveItineraryPage · 방문 체크', () => {
    it('W1 도착·미완료 기록이 있으면 그 슬롯이 active 카드로 뜬다 (★도달성)', async () => {
      server.use(
        ...baseHandlers(),
        // 그 날 방문 기록: p1 이 도착했고 아직 미완료 → 진행 중.
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })],
          })
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // active 카드에만 있는 [방문 완료]가 뜬다 = progress 인자가 실제로 배선됐다.
      await waitFor(() =>
        expect(screen.getByTestId('execution-arrive-complete')).toBeTruthy()
      );
    });

    it('W2 [방문 완료] press → POST /visits/{id}/complete + 슬롯이 done 으로 바뀐다 (AC-3)', async () => {
      // 완료 POST 이후 방문 기록 조회가 완료 상태를 준다(낙관·재조회 모두 done 으로 수렴).
      let completed = false;
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [
              vc({
                visitCheckId: 'v1',
                poiId: 'p1',
                arrivedAt: T,
                completedAt: completed ? '2026-08-20T13:40:00' : null,
              }),
            ],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () => {
          completed = true;
          return HttpResponse.json(
            vc({
              visitCheckId: 'v1',
              poiId: 'p1',
              arrivedAt: T,
              completedAt: '2026-08-20T13:40:00',
            })
          );
        })
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId('execution-arrive-complete')).toBeTruthy()
      );

      fireEvent.press(screen.getByTestId('execution-arrive-complete'));

      // 완료 요청이 **도출된 visitCheckId 'v1'** 로 나갔다(poiId 로 새지 않는다 — 부정 짝).
      await waitFor(() =>
        expect(
          hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/v1/complete`)
        ).toBe(1)
      );
      expect(hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/p1/complete`)).toBe(
        0
      );

      // 슬롯이 done 으로 — [방문 완료] 사라지고 우측에 계획 시각 "13:00" + "방문" 이 뜬다
      // (TRIP-746 done 카드 · BR-U4-34 계획값. 옛 시각범위 배지 "13:00–14:00" 은 삭제됐다).
      await waitFor(() =>
        expect(screen.queryByTestId('execution-arrive-complete')).toBeNull()
      );
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00');
      expect(
        screen.getByTestId(`execution-live-slot-visit-label-${TODAY}#p1`)
      ).toHaveTextContent('방문');
    });

    it('W3 기록이 없는 오늘 탭 예정 카드의 [도착] press → POST /visits {slotKey, poiId, MANUAL} 1회 → active (TRIP-1021 AC-1·AC-4)', async () => {
      // TRIP-746 이 지운 수동 [도착]을 되살린 자리다(옛 W3 = 부재 짝 → 반전). 자동 도착(TRIP-1018)이
      // 보류라 이 버튼이 유일한 도착 경로다.
      let arrived = false;
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: arrived
              ? [vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T })]
              : [],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
          arriveBodies.push(await request.json());
          arrived = true;
          return HttpResponse.json(
            vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
            { status: 201 }
          );
        })
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 준비 — 예정 카드("13:00 도착 예정")와 그 [도착]이 뜬다.
      const arrive = await screen.findByTestId(arriveId(TODAY, 'p1'));
      expect(
        screen.getByTestId(`execution-live-slot-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00 도착 예정');

      fireEvent.press(arrive);

      // 단언 ① — POST 1회, 본문은 슬롯 키를 실은 수동 도착(슬롯 키가 비면 서버가 즉석 방문으로 기록한다).
      await waitFor(() => expect(hitCount(VISITS_PATH)).toBe(1));
      expect(arriveBodies[0]).toEqual({
        slotKey: `${TODAY}#p1`,
        poiId: 'p1',
        source: 'MANUAL',
      });
      // 단언 ② — 그 카드가 active 로: [방문 완료]가 서고 [도착]은 사라진다. 시각은 계획 startAt 그대로(AC-4).
      await waitFor(() =>
        expect(
          screen.getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen()
      );
      expect(screen.queryByTestId(arriveId(TODAY, 'p1'))).toBeNull();
      expect(
        screen.getByTestId(`execution-live-slot-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00 도착 · 지금 관람 중');
    });

    it('W4 도착 → 재조회 → [방문 완료] 사슬: 완료 요청은 서버 id(v9)로 나가고 카드가 done 이 된다 (AC-2)', async () => {
      let arrived = false;
      let completed = false;
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: arrived
              ? [
                  vc({
                    visitCheckId: 'v9',
                    poiId: 'p1',
                    arrivedAt: T,
                    completedAt: completed ? '2026-08-20T13:40:00' : null,
                  }),
                ]
              : [],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits`, () => {
          arrived = true;
          return HttpResponse.json(
            vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
            { status: 201 }
          );
        }),
        http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () => {
          completed = true;
          return HttpResponse.json(
            vc({
              visitCheckId: 'v9',
              poiId: 'p1',
              arrivedAt: T,
              completedAt: '2026-08-20T13:40:00',
            })
          );
        })
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
      fireEvent.press(await screen.findByTestId(arriveId(TODAY, 'p1')));

      // 재조회가 캐시에 도착할 때까지 — 낙관 레코드(optimistic:p1)로 완료를 누르면 가짜 id 로 나간다(02a ★5).
      await waitFor(() =>
        expect(
          client.getQueryData<VisitCheckList>(
            getGetTripsTripIdVisitsDaysDayQueryKey(TRIP_ID, TODAY)
          )?.visits[0]?.visitCheckId
        ).toBe('v9')
      );
      fireEvent.press(await screen.findByTestId('execution-arrive-complete'));

      await waitFor(() =>
        expect(
          hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/v9/complete`)
        ).toBe(1)
      );
      expect(observedHits.filter((hit) => hit.includes('optimistic'))).toEqual(
        []
      );
      await waitFor(() =>
        expect(screen.queryByTestId('execution-arrive-complete')).toBeNull()
      );
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00');
    });

    it.each([
      [
        '409 이미 도착',
        () =>
          HttpResponse.json(
            { code: 'VISIT_ALREADY_RECORDED', message: 'already' },
            { status: 409 }
          ),
      ],
      ['네트워크 실패', () => HttpResponse.error()],
    ])(
      'W5 도착이 %s 로 실패하면 그 카드만 예정으로 되돌아가고, 다른 레코드는 그대로다 (AC-5)',
      async (_name, failure) => {
        let failed = false;
        server.use(
          ...baseHandlers(
            itineraryOf([
              {
                date: TODAY,
                slots: [
                  slot('p1', '감천문화마을', '13:00:00'),
                  slot('p2', '광안리 해변', '15:00:00'),
                ],
              },
            ])
          ),
          // p1 은 이미 완료(done) · p2 는 기록 없음(upcoming).
          http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
            HttpResponse.json({
              visits: [
                vc({
                  visitCheckId: 'v0',
                  poiId: 'p1',
                  arrivedAt: T,
                  completedAt: '2026-08-20T13:40:00',
                }),
              ],
            })
          ),
          http.post(`${BASE}/trips/:tripId/visits`, () => {
            failed = true;
            return failure();
          })
        );

        render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
          wrapper,
        });
        fireEvent.press(await screen.findByTestId(arriveId(TODAY, 'p2')));

        // 서버가 실패를 돌려준 뒤에 본다 — 그 전 첫 폴링이 "버튼 있음"을 공허하게 통과하지 않게(02a ★6).
        await waitFor(() => expect(failed).toBe(true));
        await waitFor(() => {
          expect(screen.getByTestId(arriveId(TODAY, 'p2'))).toBeOnTheScreen();
          expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
        });
        expect(
          screen.getByTestId(`execution-live-slot-status-${TODAY}#p2`)
        ).toHaveTextContent('예정');
        // 다른 레코드(p1 done)는 그대로.
        expect(
          screen.getByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
        ).toHaveTextContent('13:00');
        expect(hitCount(VISITS_PATH)).toBe(1);
      }
    );

    it('W6 진행 중 슬롯이 있으면 다른 예정 카드에도 [도착]이 없다 (AC-3 · Q1)', async () => {
      server.use(
        ...baseHandlers(
          itineraryOf([
            {
              date: TODAY,
              slots: [
                slot('p1', '감천문화마을', '13:00:00'),
                slot('p2', '광안리 해변', '15:00:00'),
              ],
            },
          ])
        ),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })],
          })
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 짝 앵커 — p1 은 active([방문 완료]), p2 는 예정 카드로 실제로 떴다.
      await waitFor(() =>
        expect(
          screen.getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen()
      );
      expect(
        screen.getByTestId(`execution-live-slot-status-${TODAY}#p2`)
      ).toHaveTextContent('예정');
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);
    });

    it('W7 [도착]은 오늘 탭에서만 — 내일 탭엔 없고, 오늘로 돌아오면 다시 선다 (Q6)', async () => {
      server.use(
        ...baseHandlers(
          itineraryOf([
            { date: TODAY, slots: [slot('p1', '감천문화마을', '13:00:00')] },
            { date: TOMORROW, slots: [slot('p3', '해운대 해변', '10:00:00')] },
          ])
        ),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({ visits: [] })
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 오늘(1일차) — [도착]이 있다.
      expect(
        await screen.findByTestId(arriveId(TODAY, 'p1'))
      ).toBeOnTheScreen();

      // 내일(2일차) — 예정 카드는 뜨지만 [도착]은 없다.
      fireEvent.press(screen.getByTestId('execution-live-daychip-1'));
      expect(
        await screen.findByTestId(`execution-live-slot-time-${TOMORROW}#p3`)
      ).toHaveTextContent('10:00 도착 예정');
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);

      // 오늘로 돌아오면 다시 선다("한 번이라도 탭을 고르면 끈다" 오구현 차단, 02a ★7).
      fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
      expect(
        await screen.findByTestId(arriveId(TODAY, 'p1'))
      ).toBeOnTheScreen();
    });

    it('W8 [도착]을 연타해도 POST /visits 는 1회뿐이다 (AC-1 "1회")', async () => {
      let arrived = false;
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: arrived
              ? [vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T })]
              : [],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits`, () => {
          arrived = true;
          return HttpResponse.json(
            vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
            { status: 201 }
          );
        })
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
      const arrive = await screen.findByTestId(arriveId(TODAY, 'p1'));

      // 같은 참조를 연달아 — 캐시 갱신의 재렌더는 setTimeout 으로 미뤄져 두 번째 press 때도 버튼이
      // 트리에 남아 있다(02a ★1 · §5-1 실측). 새로 getByTestId 하면 공허해질 수 있다.
      fireEvent.press(arrive);
      fireEvent.press(arrive);

      // 첫 POST 의 응답·무효화(재조회 GET)까지 기다린 뒤 센다 — 두 번째 요청이 늦게 찍히는 것까지 포함(02a ★2).
      await waitFor(() =>
        expect(hitCount(VISITS_GET_TODAY)).toBeGreaterThanOrEqual(2)
      );
      await waitFor(() =>
        expect(
          screen.getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen()
      );
      expect(hitCount(VISITS_PATH)).toBe(1);
    });

    it.each([
      ['허용', { status: 'granted', granted: true, canAskAgain: true }],
      ['거부', { status: 'denied', granted: false, canAskAgain: false }],
    ])(
      'W9 위치 권한이 %s 이어도 [도착]은 선다 (Q2 — 자동 도착이 없는 동안 유일한 도착 경로)',
      async (_name, permission) => {
        mockGetForeground.mockResolvedValue(permission);
        mockRequestForeground.mockResolvedValue(permission);
        server.use(
          ...baseHandlers(),
          http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
            HttpResponse.json({ visits: [] })
          )
        );

        render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
          wrapper,
        });

        expect(
          await screen.findByTestId(arriveId(TODAY, 'p1'))
        ).toBeOnTheScreen();
      }
    );
  });

  /**
   * 이틀 일정 + 날마다 완료 1곳·예정 1곳. 완료 카드(visit-time)는 방문 기록이 **도착해 그려진 뒤에만**
   * 보이므로, 그것을 기다리면 "기록이 아직 안 와서 [도착]이 없다"는 공허 통과를 막는다(02c ★1).
   */
  const twoDaysWithDone = () =>
    itineraryOf([
      {
        date: TODAY,
        slots: [
          slot('p0', '자갈치시장', '09:00:00'),
          slot('p1', '감천문화마을', '13:00:00'),
        ],
      },
      {
        date: TOMORROW,
        slots: [
          slot('p2', '동백섬', '09:00:00'),
          slot('p3', '해운대 해변', '10:00:00'),
        ],
      },
    ]);
  const doneVisitsOf = (day: string) => ({
    visits: [
      vc({
        visitCheckId: `v-${day}`,
        poiId: day === TODAY ? 'p0' : 'p2',
        slotKey: `${day}#${day === TODAY ? 'p0' : 'p2'}`,
        arrivedAt: `${day}T09:00:00`,
        completedAt: `${day}T09:40:00`,
      }),
    ],
  });

  describe('LiveItineraryPage · [도착] 게이트 (TRIP-1021 5-c 경고1·2)', () => {
    it.each([
      ['여행 이틀 전(첫날 탭으로 열림)', '2026-08-18', 0],
      ['여행 끝난 뒤(마지막 날 탭으로 열림)', '2026-08-25', 1],
    ])(
      'W10 오늘이 %s 이면 어느 탭에도 [도착]이 없다 (경고1 — 선택 일자 날짜 == 실제 오늘일 때만)',
      async (_name, today, openedIndex) => {
        server.use(
          ...baseHandlers(twoDaysWithDone()),
          http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
            HttpResponse.json(doneVisitsOf(String(params.day)))
          )
        );
        const [opened, other] =
          openedIndex === 0 ? [TODAY, TOMORROW] : [TOMORROW, TODAY];
        const doneOf = (day: string) => (day === TODAY ? 'p0' : 'p2');
        const upcomingOf = (day: string) => (day === TODAY ? 'p1' : 'p3');

        render(<LiveItineraryPage tripId={TRIP_ID} today={today} />, {
          wrapper,
        });

        // 열린 탭 — 완료 카드가 떴다(기록 도착 앵커) + 예정 카드도 있다. 그런데 [도착]은 0.
        expect(
          await screen.findByTestId(
            `execution-live-slot-visit-time-${opened}#${doneOf(opened)}`
          )
        ).toBeOnTheScreen();
        expect(
          screen.getByTestId(
            `execution-live-slot-status-${opened}#${upcomingOf(opened)}`
          )
        ).toHaveTextContent('예정');
        expect(
          screen.queryAllByTestId(/^execution-live-slot-arrive-/)
        ).toHaveLength(0);

        // 다른 탭 — 역시 0.
        fireEvent.press(
          screen.getByTestId(`execution-live-daychip-${1 - openedIndex}`)
        );
        expect(
          await screen.findByTestId(
            `execution-live-slot-visit-time-${other}#${doneOf(other)}`
          )
        ).toBeOnTheScreen();
        expect(
          screen.queryAllByTestId(/^execution-live-slot-arrive-/)
        ).toHaveLength(0);
        expect(hitCount(VISITS_PATH)).toBe(0);
      }
    );

    it('W11 짝 — 같은 이틀 일정에서 오늘이 2일차면 2일차 탭에만 [도착]이 선다 (경고1 긍정 앵커)', async () => {
      server.use(
        ...baseHandlers(twoDaysWithDone()),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
          HttpResponse.json(doneVisitsOf(String(params.day)))
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TOMORROW} />, {
        wrapper,
      });

      // 오늘(2일차) — 예정 p3 에 [도착]이 있다(게이트가 "항상 끔"으로 공허하게 통과하지 않게).
      expect(
        await screen.findByTestId(arriveId(TOMORROW, 'p3'))
      ).toBeOnTheScreen();

      // 지난 날(1일차) — 완료 카드 앵커 뒤 [도착] 0.
      fireEvent.press(screen.getByTestId('execution-live-daychip-0'));
      expect(
        await screen.findByTestId(`execution-live-slot-visit-time-${TODAY}#p0`)
      ).toBeOnTheScreen();
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);
    });

    it('W12 방문 기록 조회가 실패(500)하면 예정 카드는 보여도 [도착]은 없다 (경고2)', async () => {
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 앵커 ① 예정 카드는 그려졌다 · ② 조회가 실제로 실패 상태에 닿았다(로딩과 구분).
      expect(
        await screen.findByTestId(`execution-live-slot-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00 도착 예정');
      await waitFor(() =>
        expect(
          client.getQueryState(
            getGetTripsTripIdVisitsDaysDayQueryKey(TRIP_ID, TODAY)
          )?.status
        ).toBe('error')
      );
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);
    });

    it('W13 방문 기록 조회가 로딩 중이면 [도착]이 없고, 조회가 성공하면 그때 선다 (경고2 — 성공 뒤에만)', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, async () => {
          await gate;
          return HttpResponse.json({ visits: [] });
        })
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 앵커 — 예정 카드가 그려졌고 조회 요청이 나가 응답을 기다리는 중이다.
      expect(
        await screen.findByTestId(`execution-live-slot-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00 도착 예정');
      await waitFor(() => expect(hitCount(VISITS_GET_TODAY)).toBe(1));
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);

      // 조회 성공 → 그제야 [도착]이 선다("로딩이면 영원히 끔" 오구현이 아님을 확인하는 짝).
      release();
      expect(
        await screen.findByTestId(arriveId(TODAY, 'p1'))
      ).toBeOnTheScreen();
    });
  });

  describe('LiveItineraryPage · 도착 실패 뒤 재시도 (TRIP-1021 5-c 경고4)', () => {
    it('W14 도착이 네트워크 실패로 되돌아간 뒤 [도착]을 다시 누르면 POST 가 한 번 더 나가고 active 가 된다', async () => {
      let posts = 0;
      let arrived = false;
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: arrived
              ? [vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T })]
              : [],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
          arriveBodies.push(await request.json());
          posts += 1;
          if (posts === 1) return HttpResponse.error();
          arrived = true;
          return HttpResponse.json(
            vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
            { status: 201 }
          );
        })
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
      fireEvent.press(await screen.findByTestId(arriveId(TODAY, 'p1')));

      // 1차 — 서버가 실패를 돌려준 뒤, 롤백으로 [도착]이 다시 섰다.
      await waitFor(() => expect(posts).toBe(1));
      await waitFor(() => {
        expect(screen.getByTestId(arriveId(TODAY, 'p1'))).toBeOnTheScreen();
        expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
      });
      // 가드 해제가 롤백 재렌더보다 늦게 오는 구현도 있다 — 사람 손가락처럼 한 틱 쉬고 누른다(02c ★4).
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      // 2차 — 새로 찾은 [도착]을 누른다(실패 뒤라 연타가 아니다).
      fireEvent.press(screen.getByTestId(arriveId(TODAY, 'p1')));

      await waitFor(() => expect(hitCount(VISITS_PATH)).toBe(2));
      expect(arriveBodies[1]).toEqual({
        slotKey: `${TODAY}#p1`,
        poiId: 'p1',
        source: 'MANUAL',
      });
      await waitFor(() =>
        expect(
          screen.getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen()
      );
    });
  });

  describe('LiveItineraryPage · 도착 낙관 반영 (TRIP-1076 AC-2 — 선제 green 증거)', () => {
    it('W15 POST /visits 응답이 오기 전에도 [도착] press 만으로 카드가 active 가 된다 (재조회 없이 낙관 캐시로)', async () => {
      // QA #055 "도착 뒤 다음 터치까지 카드가 그대로" — JS 사슬(press → setQueryData → 사영 → 카드)이
      // 끊겼는지 가른다. POST 를 끝까지 붙잡아 두므로 active 는 낙관 캐시에서만 올 수 있다.
      // green 이면 JS 경로 정상 증거이고, 원인은 네이티브 커밋 쪽(6-b · 새 티켓)으로 넘긴다.
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({ visits: [] })
        ),
        http.post(`${BASE}/trips/:tripId/visits`, async () => {
          await gate;
          return HttpResponse.json(
            vc({ visitCheckId: 'v9', poiId: 'p1', arrivedAt: T }),
            { status: 201 }
          );
        })
      );

      try {
        render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
          wrapper,
        });

        // 준비 — 예정 카드와 [도착]이 섰고, 방문 기록 조회는 1회로 가라앉았다.
        const arrive = await screen.findByTestId(arriveId(TODAY, 'p1'));
        await waitFor(() => expect(hitCount(VISITS_GET_TODAY)).toBe(1));
        expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();

        // 실행
        fireEvent.press(arrive);

        // 단언 — POST 는 나갔지만 아직 응답 전(gate 잠김)인데 카드가 active 다.
        await waitFor(() => expect(hitCount(VISITS_PATH)).toBe(1));
        await waitFor(() =>
          expect(
            screen.getByTestId('execution-arrive-complete')
          ).toBeOnTheScreen()
        );
        expect(screen.queryByTestId(arriveId(TODAY, 'p1'))).toBeNull();
        // 재조회로 반영된 것이 아니다 — 방문 기록 조회 수가 press 전과 같다.
        expect(hitCount(VISITS_GET_TODAY)).toBe(1);

        // 정리 — 응답을 풀고 성공 뒤 재조회까지 이 테스트 안에서 끝낸다(다음 테스트로 요청이 새지 않게).
        release();
        await waitFor(() =>
          expect(hitCount(VISITS_GET_TODAY)).toBeGreaterThanOrEqual(2)
        );
      } finally {
        // 단언이 먼저 실패해도 붙잡힌 핸들러를 푼다(두 번 불러도 무해).
        release();
      }
    });
  });

  describe('LiveItineraryPage · 즉석 방문은 허브 판정에서 빠진다 (TRIP-1079)', () => {
    /** 즉석 방문 — slotKey 가 null(서버가 계획 밖 방문으로 기록한 것). */
    const spontaneous = (
      over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
    ): VisitCheck => vc({ ...over, slotKey: null, spontaneous: true });

    it('W16 계획 슬롯 도착 + 즉석 도착이 같은 날이면 계획 카드가 관람 중이고, [방문 완료]는 계획 레코드 id 로 나간다 (AC-1)', async () => {
      server.use(
        ...baseHandlers(
          itineraryOf([
            {
              date: TODAY,
              slots: [
                slot('p1', '감천문화마을', '13:00:00'),
                slot('p2', '광안리 해변', '15:00:00'),
              ],
            },
          ])
        ),
        // 서버는 도착 최신순 — 먼저 도착한 즉석 X 가 목록 끝에 온다(QA 066 재현 순서, 02a ★1).
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [
              vc({ visitCheckId: 'vS', poiId: 'p1', arrivedAt: T }),
              spontaneous({
                visitCheckId: 'vX',
                poiId: 'px',
                arrivedAt: '2026-08-20T12:00:00',
              }),
            ],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () =>
          HttpResponse.json(
            vc({
              visitCheckId: 'vS',
              poiId: 'p1',
              arrivedAt: T,
              completedAt: '2026-08-20T13:40:00',
            })
          )
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 단언 ① — p1 카드 **안에** [방문 완료]가 있고 상태줄이 관람 중이다.
      await waitFor(() =>
        expect(
          within(
            screen.getByTestId(`execution-live-slot-${TODAY}#p1`)
          ).getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen()
      );
      expect(
        screen.getByTestId(`execution-live-slot-time-${TODAY}#p1`)
      ).toHaveTextContent('13:00 도착 · 지금 관람 중');
      expect(
        screen.getByTestId(`execution-live-slot-status-${TODAY}#p2`)
      ).toHaveTextContent('예정');
      // 관람 중 1장 ↔ [도착] 전부 숨김(AC-8 짝).
      expect(
        screen.queryAllByTestId(/^execution-live-slot-arrive-/)
      ).toHaveLength(0);

      // 실행 — [방문 완료]. 단언 ② — 계획 레코드 id(vS)로 나가고 즉석 id(vX)로는 안 나간다.
      fireEvent.press(screen.getByTestId('execution-arrive-complete'));
      await waitFor(() =>
        expect(
          hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/vS/complete`)
        ).toBe(1)
      );
      expect(hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/vX/complete`)).toBe(
        0
      );
    });

    it('W17 도착 기록이 즉석뿐이면 — 계획 슬롯과 같은 poi 여도 — 그 카드는 예정이고 [도착]이 선다 (AC-3)', async () => {
      // slotKey 필드 자체가 없는 즉석(생성 타입이 optional) + 계획 슬롯 p1 과 같은 poi 의 즉석.
      // 같은 poi 즉석을 목록 **끝**에 둔다 — 앞에 두면 옛 "마지막이 이긴다" 코드도 공허하게 통과한다(02a ★3).
      const absentKey = spontaneous({
        visitCheckId: 'vA',
        poiId: 'px',
        arrivedAt: T,
      });
      delete absentKey.slotKey;
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [
              absentKey,
              spontaneous({ visitCheckId: 'vB', poiId: 'p1', arrivedAt: T }),
            ],
          })
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // [도착]은 방문 기록 조회가 성공한 뒤에만 선다(W13) — 이것이 "기록 도착" 앵커다(02a ★6).
      expect(
        await screen.findByTestId(arriveId(TODAY, 'p1'))
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(`execution-live-slot-status-${TODAY}#p1`)
      ).toHaveTextContent('예정');
      expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
    });

    it('W18 즉석 방문 완료는 같은 poi 의 계획 카드를 완료로 칠하지 않는다 (AC-5)', async () => {
      server.use(
        ...baseHandlers(),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [
              spontaneous({
                visitCheckId: 'vP',
                poiId: 'p1',
                arrivedAt: T,
                completedAt: '2026-08-20T13:40:00',
              }),
            ],
          })
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      expect(
        await screen.findByTestId(arriveId(TODAY, 'p1'))
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(`execution-live-slot-status-${TODAY}#p1`)
      ).toHaveTextContent('예정');
      // done 카드에만 있는 "방문 시각" 칸이 없다.
      expect(
        screen.queryByTestId(`execution-live-slot-visit-time-${TODAY}#p1`)
      ).toBeNull();
    });

    it('W19 즉석 방문이 관람 중인 날 계획 슬롯 [도착] → 낙관·서버 순서 재조회 양쪽에서 관람 중 → [방문 완료]는 서버 id 로 (AC-4 · QA 066)', async () => {
      const drop = spontaneous({
        visitCheckId: 'vX',
        poiId: 'px',
        arrivedAt: '2026-08-19T20:07:00Z',
      });
      let arrived = false;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        ...baseHandlers(),
        // 재조회는 서버 순서(도착 최신순) — 방금 도착한 S 가 앞, 먼저 온 즉석 X 가 끝(02a ★4).
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: arrived
              ? [
                  vc({
                    visitCheckId: 'v9',
                    poiId: 'p1',
                    arrivedAt: '2026-08-20T04:00:00Z',
                  }),
                  drop,
                ]
              : [drop],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
          arriveBodies.push(await request.json());
          await gate;
          arrived = true;
          return HttpResponse.json(
            vc({
              visitCheckId: 'v9',
              poiId: 'p1',
              arrivedAt: '2026-08-20T04:00:00Z',
            }),
            { status: 201 }
          );
        }),
        http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () =>
          HttpResponse.json(
            vc({
              visitCheckId: 'v9',
              poiId: 'p1',
              arrivedAt: '2026-08-20T04:00:00Z',
              completedAt: '2026-08-20T04:40:00Z',
            })
          )
        )
      );
      const p1Card = () =>
        screen.getByTestId(`execution-live-slot-${TODAY}#p1`);

      try {
        render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, {
          wrapper,
        });

        // 준비 — 즉석 X 만 있는 오늘: 계획 카드는 예정 + [도착].
        const arrive = await screen.findByTestId(arriveId(TODAY, 'p1'));
        await waitFor(() => expect(hitCount(VISITS_GET_TODAY)).toBe(1));

        // 실행 ① — [도착].
        fireEvent.press(arrive);

        // 단언 ① — POST 1회·슬롯 키 본문, 응답 전(재조회 없음)에도 p1 이 관람 중(낙관 캐시).
        await waitFor(() => expect(hitCount(VISITS_PATH)).toBe(1));
        expect(arriveBodies[0]).toEqual({
          slotKey: `${TODAY}#p1`,
          poiId: 'p1',
          source: 'MANUAL',
        });
        await waitFor(() =>
          expect(
            within(p1Card()).getByTestId('execution-arrive-complete')
          ).toBeOnTheScreen()
        );
        expect(hitCount(VISITS_GET_TODAY)).toBe(1);

        // 실행 ② — 서버 응답 → 재조회([S, X])가 캐시에 들어올 때까지, 그 뒤 한 틱 흘려 재렌더를 받는다(02a ★4).
        release();
        await waitFor(() =>
          expect(
            client.getQueryData<VisitCheckList>(
              getGetTripsTripIdVisitsDaysDayQueryKey(TRIP_ID, TODAY)
            )?.visits[0]?.visitCheckId
          ).toBe('v9')
        );
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

        // 단언 ② — 재조회 뒤에도 p1 이 관람 중이고 [도착]은 어디에도 없다.
        expect(
          within(p1Card()).getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen();
        expect(
          screen.queryAllByTestId(/^execution-live-slot-arrive-/)
        ).toHaveLength(0);

        // 실행 ③ · 단언 ③ — [방문 완료]는 서버 id(v9)로, 낙관 id 는 새지 않는다.
        fireEvent.press(screen.getByTestId('execution-arrive-complete'));
        await waitFor(() =>
          expect(
            hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/v9/complete`)
          ).toBe(1)
        );
        expect(
          observedHits.filter((hit) => hit.includes('optimistic'))
        ).toEqual([]);
      } finally {
        // 단언이 먼저 실패해도 붙잡힌 핸들러를 푼다(02a ★5).
        release();
      }
    });
  });

  describe('LiveItineraryPage · 관람 중 후보가 둘이면 계획 순서가 가른다 (TRIP-1079 5-c 경고-1)', () => {
    it('W20 오늘 슬롯 [p1, p2]가 둘 다 도착·미완료이고 서버 목록이 p2 를 앞에 주어도 p1 이 관람 중이고, [방문 완료]는 p1 레코드 id 로 나간다 (AC-6)', async () => {
      server.use(
        ...baseHandlers(
          itineraryOf([
            {
              date: TODAY,
              slots: [
                slot('p1', '감천문화마을', '13:00:00'),
                slot('p2', '광안리 해변', '15:00:00'),
              ],
            },
          ])
        ),
        // 비정상 상태(01b-4) — 계획 도착 레코드가 둘. 목록 앞이 p2 라 "목록 첫째" 구현도 여기서 틀린다.
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [
              vc({
                visitCheckId: 'v2',
                poiId: 'p2',
                arrivedAt: '2026-08-20T13:10:00',
              }),
              vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }),
            ],
          })
        ),
        http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () =>
          HttpResponse.json(
            vc({
              visitCheckId: 'v1',
              poiId: 'p1',
              arrivedAt: T,
              completedAt: '2026-08-20T13:40:00',
            })
          )
        )
      );

      render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

      // 단언 ① — 계획 순서가 앞선 p1 카드 **안에** [방문 완료]가 있고, p2 는 예정이다.
      await waitFor(() =>
        expect(
          within(
            screen.getByTestId(`execution-live-slot-${TODAY}#p1`)
          ).getByTestId('execution-arrive-complete')
        ).toBeOnTheScreen()
      );
      expect(
        screen.getByTestId(`execution-live-slot-status-${TODAY}#p2`)
      ).toHaveTextContent('예정');

      // 실행 — [방문 완료]. 단언 ② — p1 레코드(v1)로 나가고 p2 레코드(v2)로는 안 나간다.
      fireEvent.press(screen.getByTestId('execution-arrive-complete'));
      await waitFor(() =>
        expect(
          hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/v1/complete`)
        ).toBe(1)
      );
      expect(hitCount(`POST /api/v1/trips/${TRIP_ID}/visits/v2/complete`)).toBe(
        0
      );
    });
  });
});
