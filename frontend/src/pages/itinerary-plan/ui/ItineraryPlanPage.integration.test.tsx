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

import type * as ShareCaptureModule from '@/features/reflection/model/shareCapture';
import { server } from '@/mocks/server';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
  ItineraryGenerationState,
  ItineraryUnplacedMustVisitsItem,
  SavedPlace,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { showToast } from '@/shared/ui/Toast';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdQueryKey,
} from '@/shared/api/generated/trips/trips';
import { flushNotifications } from '@/test-support/flushNotifications';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * h14 완성 일정 · h16 확정 일정(ItineraryPlanPage) — **실 훅 + MSW** 통합 테스트(TRIP-1151 에서 열두 파일을
 * 한 파일로 합쳤다). 3000줄이 넘어도 쪼개지 않는다(README 판정 4 · 배치 결정).
 *
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 각 파일의 픽스처·기본 MSW 핸들러
 * (describe 의 beforeEach)는 그대로다.
 *
 * 합치며 바뀐 장치(02a ★):
 *  - 서버 listen/close 는 최상위 한 번. 라우터 목은 `push`·`back`·`replace`·`canGoBack` 넷을 모두 기록하고
 *    `canGoBack` 은 기본 true 다. 옛 「확정 CTA·재조회 배선」·「확정 예방 잠금」 파일 목엔 `canGoBack` 이
 *    없었다 — 두 describe 는 "canGoBack 0회"를 afterEach 로 단언해 옛 그물(없는 메서드 → TypeError)을 잇는다.
 *  - 연타 가드 창(`pressGuard` 의 openedAt)은 모듈 전역이다. 옛날엔 파일마다 모듈이 새로 로드돼 깨끗했지만
 *    한 파일에선 앞 describe 의 확정 성공이 연 400ms 창이 뒤 describe 의 누름을 조용히 삼킨다 → 최상위
 *    beforeEach 에서 닫는다.
 *  - 공유 카드 캡처 판정(`isShareCaptureArmed`)은 스위치 `mockShareArmed.value` 로 고른다. 기본 null =
 *    실물(옛 열 파일이 실물을 탔다), 옛 「확정 셸」·「넣지 못한 꼭 갈 곳」 describe 만 false/true 로 켠다.
 *  - 토스트 스토어는 모듈 싱글턴이라 최상위 afterEach 에서 비운다.
 *
 * 3동작 뼈대: 준비 = MSW 핸들러·토큰 → 실행 = 화면 열기·뒤로/확정/수정 press → 단언 = 보이는 것·나간 요청·이동.
 */

// 지도(네이버 네이티브)는 jest 에서 못 뜬다 — 관찰 목으로 map-root 를 노출한다.
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

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
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
}));

// [공유하기] 게이트 스위치 — null 이면 실물 판정(jest-expo 는 캡처 모듈 3종을 "있는 척"한다), boolean 이면 그 값.
const mockShareArmed: { value: boolean | null } = { value: null };
jest.mock('@/features/reflection/model/shareCapture', () => {
  const actual = jest.requireActual<typeof ShareCaptureModule>(
    '@/features/reflection/model/shareCapture'
  );
  return {
    ...actual,
    isShareCaptureArmed: () =>
      mockShareArmed.value ?? actual.isShareCaptureArmed(),
  };
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  // 모듈 전역 연타 가드 창 — 앞 describe 의 확정 성공이 연 창이 뒤 describe 의 누름을 삼키지 않게 닫는다.
  resetPressGuard();
  [mockPush, mockBack, mockReplace, mockCanGoBack].forEach((fn) =>
    fn.mockClear()
  );
  mockCanGoBack.mockReturnValue(true);
  mockShareArmed.value = null;
});

// 토스트 스토어는 모듈 싱글턴이다 — describe 안이 아니라 파일 최상위에서 비운다.
afterEach(() => {
  resetToast();
});

afterAll(() => server.close());

// TRIP-354 · TRIP-799 · 옛 ItineraryPlanPage.integration.test.tsx
describe('확정 CTA·재조회 배선', () => {
  /**
   * h25 배선을 **실 HTTP 로** 태우는 심판.
   *
   * 무엇을 보장하나:
   *  - 헤더가 **두 조회의 조립**이다 — 제목·기간(GET /trips)과 곳 수(GET /itinerary)를 합쳐 그린다(AC1).
   *  - 🔴 **일정이 아직 없으면(404) notFound 얼굴**을 그리지 시간표를 그리지 않는다(AC9 · isNotFound).
   *  - 🔴 **확정 mutation 3갈래** — 성공(setQueryData 재조회0)·409(안내+재조회)·404(status 불변).
   *
   * **재작성(TRIP-354)**: 세그먼트 토글이 사라져(결정 D) 구 I1(세그먼트 전환 재조회 0)은 **삭제**한다
   * — 토글 자체가 없어 잴 대상이 없다. 지도가 상시 인라인이라 페이지가 지도를 마운트하므로,
   * 지도를 얇은 가짜로 바꿔 렌더 노이즈를 없앤다(이 파일의 관심사는 요청 건수지 지도가 아니다).
   *
   * **재작성(TRIP-799 · narrow)**: PLANNED 완성 일정이 이제 옛 `TimelineScreen` 이 아니라 **지도+시트
   * 셸**(`MapSheetShell`)로 그려진다(01b D1). 그래서 확정 CTA 는 `sheet-cta-button-0`("일정 저장하기"),
   * 확정 실패 안내는 셸 안 `itinerary-confirm-error`, 잔존 얼굴은 `map-sheet-shell-root` 다 — I4~I10 이
   * 이 셸 testID 로 뒤집힌다(★2·★4). `handleConfirm` 로직(setQueryData 성공·409 재조회·404/500/network
   * 무재조회)은 무변경이라 재조회 계수 심판(GET 1 vs 2)은 그대로다. I2 는 CONFIRMED 라 TimelineScreen
   * 을 그대로 써 무변경, I3 은 notFound 얼굴이라 무변경(narrow 경계).
   *
   * 왜 통합 버킷인가: 심판의 핵심이 **어떤 요청이 몇 건 나갔나**다. 훅을 목킹하면 그 계수가 테스트의
   * *가정*이 되어 그 가정이 틀려도 아무도 모른다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고 확정 CTA 를 탭 → 단언=나간 요청·보이는 것.
   */

  // 옛 파일 라우터 목엔 `canGoBack` 이 없었다 — 페이지가 부르면 TypeError 로 red 였던 그물을 잇는다(02a ★).
  afterEach(() => {
    expect(mockCanGoBack).not.toHaveBeenCalled();
  });
  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  /** startDate/endDate 가 헤더의 "N박M일" 출처다(3박 4일 = 06-10 → 06-13). */
  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** 2일 · 총 3곳(day1 2장 + day2 1장). status=CONFIRMED(완성 일정). */
  function itinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'poi-b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
      {
        date: DAY2,
        slots: [
          {
            poiId: 'poi-c',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'CONFIRMED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  /** 확정 흐름(TRIP-300)용 — 같은 일정을 status 만 갈아 끼운다. PLANNED 여야 활성 확정 CTA 가 뜬다. */
  function plannedItinerary(): Itinerary {
    return { ...itinerary(), status: 'PLANNED' };
  }
  function confirmedItinerary(): Itinerary {
    return { ...itinerary(), status: 'CONFIRMED' };
  }

  /** GET /itinerary 가 몇 번 처리됐나. 세그먼트 전환에도 이 값이 안 늘어야 한다(AC6). 확정 흐름에선
   * 성공=불변(setQueryData), 409=+1(재조회), 404=불변(재조회 없음)으로 세 갈래를 가른다(★5·★6). */
  let itineraryGetCalls = 0;
  /** POST /confirm 이 몇 번 처리됐나. press 1회 → POST 1건(중간 다이얼로그 없음 · ★9). */
  let confirmPostCalls = 0;
  /** GET /itinerary 응답을 케이스가 정한다(정상 · 404 · PLANNED/CONFIRMED). */
  let itineraryHandler: () => Response;
  /** POST /confirm 응답을 케이스가 정한다(200 CONFIRMED · 409 · 404). */
  let confirmHandler: () => Response;

  beforeEach(() => {
    resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
    itineraryGetCalls = 0;
    confirmPostCalls = 0;
    mockBack.mockClear();
    setAccessToken('valid-access');
    itineraryHandler = () => HttpResponse.json(itinerary());
    confirmHandler = () => HttpResponse.json(confirmedItinerary());

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        itineraryGetCalls += 1;
        return itineraryHandler();
      }),
      http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
        confirmPostCalls += 1;
        return confirmHandler();
      })
    );
  });

  afterEach(async () => {
    // 테스트 격리 — 인플라이트 쿼리를 취소하고 캐시를 비운다. 재조회하는 케이스(I5a/I5b 409)가
    // 발화한 invalidateQueries 재조회가 테스트 경계를 넘어 **늦게 도착**하면, 공유 카운터
    // itineraryGetCalls 를 다음 테스트의 beforeEach 리셋 뒤 한 번 더 올려 "재조회 0" 단언
    // (I8/I10)을 정상 코드에서도 간헐 red 로 만든다(gcTime:0 언마운트는 인플라이트를 못 죽인다).
    await activeClient?.cancelQueries();
    activeClient?.clear();
    activeClient = null;
    server.resetHandlers();
    clearAccessToken();
    // TRIP-1047 — 토스트 스토어는 모듈 싱글턴이다. describe 안이 아니라 파일 최상위에서 비워야 I4 가
    // 띄운 확정 토스트가 뒤 테스트의 "토스트 없음"으로 새지 않는다(02a ★1).
    resetToast();
  });

  /** 현재 테스트의 QueryClient — afterEach 가 인플라이트 취소·캐시 배수로 테스트 간 재조회
   * 누수를 끊기 위해 모듈 스코프에 든다(공유 카운터 오염 방지, 위 afterEach 참조). */
  let activeClient: QueryClient | null = null;

  /** `retry:false` — 실패를 즉시 실패로(재시도가 돌면 요청 개수 단언이 흔들린다).
   * `gcTime:0` — 기본 타이머가 테스트 종료 후에도 프로세스를 붙잡는 것 방지. */
  function renderPage() {
    activeClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const client = activeClient;
    // TRIP-1047 — 실제 앱에선 토스트 호스트가 루트에 있다. 페이지 옆에 호스트를 함께 그려야 확정
    // 토스트가 "보였다"를 testID 로 잴 수 있다(02a ★3).
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** TRIP-1047 확정 토스트 testID — 문구는 '일정이 확정됐어요'(완전 일치). */
  const CONFIRMED_TOAST = 'itinerary-confirmed-toast';

  /** 확정(CONFIRMED) 얼굴로 바뀔 때까지 기다린다 — 헤더 meta 의 "확정됨 · " 접두는 CONFIRMED 전용이다.
   * 토스트는 2.5초 뒤 사라지고 409 정합·재진입엔 원래 없어 앵커가 될 수 없다(02a ★4). */
  async function waitForConfirmedFace(): Promise<void> {
    await waitFor(() =>
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        /^확정됨 · /
      )
    );
  }

  describe('🔴 I2 · AC-7 — CONFIRMED 헤더가 셸 조립이다 (확정됨 접두 · 두 조회)', () => {
    it('제목(GET /trips)·선택일 비고정 곳 수(GET /itinerary)를 셸 헤더로 조립한다', async () => {
      // TRIP-801 플립 — CONFIRMED 가 이제 셸이라 옛 `itinerary-view-header`(TimelineScreen)는 사라지고
      // `sheet-header-*` 로 조립된다(01b D6 · 02a ★13). 셸 헤더는 **선택일(day1)** 기준이라 곳 수가
      // 전 일자 합(3)이 아니라 day1 비고정 2 다(distanceRange 없어 km null → meta "확정됨 · 2곳").
      renderPage();

      await screen.findByTestId('map-sheet-shell-root');
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        '제주 여행'
      );
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        '확정됨 · 2곳'
      );
      // 짝 — 옛 TimelineScreen 헤더는 소멸.
      expect(screen.queryByTestId('itinerary-view-header')).toBeNull();
    });
  });

  describe('🔴 I3 · AC9 — 일정이 아직 없으면(404) notFound 얼굴을 그린다 (isNotFound)', () => {
    it('GET /itinerary 가 404 면 notFound 가 뜨고 시간표는 안 뜬다', async () => {
      itineraryHandler = () => new HttpResponse(null, { status: 404 });

      renderPage();

      // 404 = "일정이 아직 없다"(isNotFound). 전면 실패 얼굴이 아니라 별도 notFound 얼굴이다.
      await screen.findByTestId('itinerary-view-notfound');
      // 짝 — 시간표로 갈아 끼우지 않았다.
      expect(screen.queryAllByTestId('itinerary-view-timeline')).toEqual([]);
    });
  });

  /**
   * ── TRIP-300 확정 mutation 3갈래 ─────────────────────────────────────────────
   * 무엇을 보장하나:
   *  - 🔴 성공(200)은 **재조회 없이** setQueryData 로 읽기전용 전환(I4 · ★6).
   *  - 🔴 409 는 침묵 없이 안내 + 재조회로 정합하되, 전환과 잔존을 케이스로 가른다(I5a·I5b · ★2).
   *  - 🔴 404 는 status 불변·재조회 없음(I7 · ★5). 409(+1)와 404(불변)를 GET 실건수로 가른다.
   */
  describe('🔴 I4 · AC-8 · TRIP-1047 AC-1 — "일정 저장하기" 성공(200)은 재조회 없이 확정 셸로 전환하고 확정 토스트를 띄운다 (setQueryData · US-SCHED-12)', () => {
    it('셸 CTA press → POST /confirm 1건, GET 재조회 없이 CONFIRMED 셸로 전환하고 "일정이 확정됐어요" 토스트가 뜬다(상주 배너는 없다)', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary());
      confirmHandler = () => HttpResponse.json(confirmedItinerary());

      renderPage();

      // PLANNED 로 열려 셸의 확정 CTA(sheet-cta-button-0 "일정 저장하기", 1버튼)가 뜬다(첫 GET 1건).
      const cta = await screen.findByTestId('sheet-cta-button-0');
      expect(cta).toHaveTextContent('일정 저장하기');
      await waitFor(() => expect(itineraryGetCalls).toBe(1));
      // 앵커 — 확정 전엔 토스트가 없다(뒤에 보이는 토스트가 이번 확정 몫임을 가른다 · 02a ★2).
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();

      // 누른다 — 중간 다이얼로그 없이 곧장 POST.
      fireEvent.press(cta);

      // TRIP-801 플립 — 확정 성공 → setQueryData(CONFIRMED) → 재렌더 → CONFIRMED 도 이제 **셸**.
      //   PLANNED 셸도 map-sheet-shell-root 라(★2) 착지 앵커는 CONFIRMED 전용 표면인 meta "확정됨 · "
      //   접두다(TRIP-1047 — 성공 배너가 사라져 앵커를 옮겼다).
      await waitForConfirmedFace();

      // TRIP-1047 AC-1 — 확정한 그 순간 토스트 1장(문자열 = 완전 일치). AC-3 — 상주 배너는 없다.
      expect(screen.getByTestId(CONFIRMED_TOAST)).toHaveTextContent(
        '일정이 확정됐어요'
      );
      expect(screen.queryByTestId('itinerary-confirmed-banner')).toBeNull();

      // POST 1건, GET 은 **안 늘었다**(재조회 0). setQueryData 로 반영했다는 유일한 설명이다.
      expect(confirmPostCalls).toBe(1);
      expect(itineraryGetCalls).toBe(1);
    });
  });

  describe('🔴 I5a · INV-4 — 409 는 침묵 없이 셸 안 안내 + 재조회, 서버가 PLANNED 면 셸 얼굴 유지', () => {
    it('confirm 이 409 면 셸 안 인라인 안내가 뜨고 GET 을 다시 조회하며, PLANNED 셸이 남는다', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary()); // 재조회해도 PLANNED
      confirmHandler = () => new HttpResponse(null, { status: 409 });

      renderPage();
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      fireEvent.press(cta);

      // ★4 침묵 아님(INV-4) — 셸이 confirmError 를 시트 안에 그린다(TimelineScreen 이 그리던 testID 계승).
      const err = await screen.findByTestId('itinerary-confirm-error');
      expect(err).toHaveTextContent(/\S/);

      // 재조회로 정합 시도 — GET 이 한 번 더 나간다(invalidate → refetch). 404/500 과 계수로 갈린다.
      await waitFor(() => expect(itineraryGetCalls).toBe(2));

      // 서버 진실이 PLANNED 라 셸 얼굴 유지 — 셸·CTA 가 남고 확정 얼굴(meta "확정됨")은 아니다.
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-cta-button-0')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(
        /확정됨/
      );
      // TRIP-1047 AC-5 — 실패에 성공 토스트를 띄우면 거짓말이다(INV-4).
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
    });
  });

  describe('🔴 I5b · INV-4 — 409 후 재조회가 CONFIRMED 면 읽기전용으로 정합한다', () => {
    it('confirm 이 409 이고 서버가 이미 확정이면, 재조회로 확정 얼굴로 정합한다', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary());
      confirmHandler = () => new HttpResponse(null, { status: 409 });

      renderPage();
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      // 409 직후 서버 진실은 이미 CONFIRMED(다른 경로로 확정됨) — 재조회가 그것을 받아온다.
      itineraryHandler = () => HttpResponse.json(confirmedItinerary());
      fireEvent.press(cta);

      // TRIP-801 플립 — 재조회로 CONFIRMED 셸로 정합한다. 착지 앵커는 CONFIRMED 전용 meta 접두다
      //   (TRIP-1047 — 성공 배너 소멸로 옮김. 토스트는 이 경로에 원래 없어 앵커가 될 수 없다).
      await waitForConfirmedFace();
      await waitFor(() => expect(itineraryGetCalls).toBe(2));

      // TRIP-1047 AC-5 판별 — 화면은 확정 얼굴이 됐지만 사용자의 확정 요청은 실패했다. "CONFIRMED 가
      // 됐나"를 감시하는 구현은 여기서 토스트를 띄운다(02a ★5). 재조회 도착 뒤라 공허하지 않다.
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
    });
  });

  describe('🔴 I7 · INV-4 — 404 는 status 를 바꾸지 않고 셸 안에서 실패를 표시한다', () => {
    it('confirm 이 404 면 안내가 뜨고, 재조회 없이 PLANNED 셸이 유지된다', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary());
      confirmHandler = () => new HttpResponse(null, { status: 404 });

      renderPage();
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      fireEvent.press(cta);

      // ★4 실패 표시(INV-4) — 셸 안 인라인 안내.
      const err = await screen.findByTestId('itinerary-confirm-error');
      expect(err).toHaveTextContent(/\S/);

      // 404 는 409 와 달리 재조회하지 않는다(GET 불변 1). status 불변이라 확정 얼굴도 토스트도 없다.
      expect(itineraryGetCalls).toBe(1);
      expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(
        /확정됨/
      );
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
      expect(screen.getByTestId('sheet-cta-button-0')).toBeOnTheScreen();
    });
  });

  /**
   * ── TRIP-355 확정 실패 500·네트워크 재조회 사각 ────────────────────────────────
   * 무엇을 보장하나: 확정이 **계약 밖 실패**(500·네트워크)를 뱉으면, **재조회하지 않고**
   * 인라인 안내만 띄운다. 재조회는 409 에만 걸린다(서버 진실이 이미 CONFIRMED 일 수 있어 정합).
   * 500·네트워크에서 재조회를 걸면, 백엔드가 넓게 죽은 outage 에서 그 재조회마저 실패해
   * `itinerary.isError` → `failed` 전면 얼굴로 타임라인이 통째로 사라진다(INV-4 정반대).
   *
   * ★재조회 카운터가 핵심 심판이다 — 타임라인 present 만으론 "재조회가 성공한" 회귀를 못 잡는다.
   * `itineraryGetCalls === 1`(재조회 0)이 유일한 뮤테이션 트립와이어다.
   */
  describe('🔴 I8 · INV-4 — 확정 500 은 재조회 없이 셸 안 인라인 안내만 (TRIP-355)', () => {
    it('confirm 이 500 이면 안내가 뜨고, 재조회 없이(GET 불변) 셸이 남는다', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary());
      confirmHandler = () => new HttpResponse(null, { status: 500 });

      renderPage();
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      fireEvent.press(cta);

      // ★4 침묵 아님(INV-4) — 셸 안 인라인 안내가 뜬다.
      const err = await screen.findByTestId('itinerary-confirm-error');
      expect(err).toHaveTextContent(/\S/);

      // 500 은 409 와 달리 재조회하지 않는다(GET 불변 1). `!isNotFound` 로 되돌리면 여기서 죽는다.
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      // 셸·CTA 가 남고, 전면 실패 얼굴로 갈아 끼우지 않는다.
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-cta-button-0')).toBeOnTheScreen();
      expect(screen.queryAllByTestId('itinerary-view-failed')).toEqual([]);
      // TRIP-1047 AC-5 — 500 에 성공 토스트 없음(INV-4).
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
    });
  });

  describe('🔴 I9 · INV-4 — 확정 500 + itinerary outage 여도 전면 얼굴로 안 바뀐다 (TRIP-355)', () => {
    it('confirm 500 직후 itinerary GET 도 넓게 죽어도, 재조회가 안 나가 셸이 남는다', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary());
      confirmHandler = () => new HttpResponse(null, { status: 500 });

      renderPage();
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      // 넓게 죽은 outage 재현 — press 직전 GET 핸들러를 500 으로 오염(초기 GET 1건은 이미 성공해 listed).
      itineraryHandler = () => new HttpResponse(null, { status: 500 });
      fireEvent.press(cta);

      // 안내는 뜨되, 옛 코드의 재조회 발화(→GET 500→isError→failed)로 셸이 사라지지 않는다.
      await screen.findByTestId('itinerary-confirm-error');
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.queryAllByTestId('itinerary-view-failed')).toEqual([]);
      // 재조회 자체가 안 나가 outage 가 무해하다.
      expect(itineraryGetCalls).toBe(1);
    });
  });

  describe('🔴 I10 · INV-4 — 확정 네트워크 오류도 재조회 없이 셸 안 인라인 안내만 (TRIP-355)', () => {
    it('confirm 이 네트워크 오류(응답 없음)면 안내가 뜨고, 재조회 없이 셸이 남는다', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary());
      confirmHandler = () => HttpResponse.error(); // 응답 자체가 없는 네트워크 실패

      renderPage();
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      fireEvent.press(cta);

      const err = await screen.findByTestId('itinerary-confirm-error');
      expect(err).toHaveTextContent(/\S/);

      // 응답이 없어 status 판정이 둘 다 false → 재조회 분기 밖(GET 불변 1).
      await waitFor(() => expect(itineraryGetCalls).toBe(1));
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      // TRIP-1047 AC-5 — 네트워크 실패에 성공 토스트 없음(INV-4).
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
    });
  });

  /**
   * ── TRIP-1047 확정 알림은 "확정한 그 순간" 1회 ──────────────────────────────────
   * 무엇을 보장하나:
   *  - 🔴 이미 확정된 일정에 다시 들어오면 토스트도 상주 배너도 없다(AC-2 · 재진입).
   *  - 🔴 확정 토스트가 사라진 뒤 일차를 바꿔 화면이 다시 그려져도 토스트가 다시 뜨지 않는다(AC-6 · 1회).
   *
   * 3동작 뼈대: 준비=가짜 서버(CONFIRMED 직행 / PLANNED→확정 200) → 실행=열기 / 확정·일차 전환 →
   * 단언=토스트·배너 유무.
   */
  describe('🔴 T-AC2 · TRIP-1047 — 이미 확정된 일정에 다시 들어오면 토스트도 상주 배너도 없다', () => {
    it('CONFIRMED 로 바로 열면 확정 얼굴이지만 토스트·배너가 없고, 호스트는 그 트리에 실제로 있다', async () => {
      // 준비·실행 — 기본 조회가 처음부터 CONFIRMED 다(확정 버튼을 누르지 않았다).
      renderPage();
      await waitForConfirmedFace();

      // 단언 — 확정 알림은 확정한 그 순간에만. 재진입엔 없다.
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
      expect(screen.queryByTestId('itinerary-confirmed-banner')).toBeNull();

      // 짝 — 호스트가 이 트리에 있다(없으면 위 "토스트 없음"이 공짜로 통과한다 · 02a ★2).
      act(() => showToast({ message: '탐침', testID: 'toast-probe' }));
      expect(screen.getByTestId('toast-probe')).toBeOnTheScreen();
    });
  });

  describe('🔴 T-AC6 · TRIP-1047 — 확정 토스트는 한 번뿐, 일차를 바꿔 다시 그려도 다시 뜨지 않는다', () => {
    it('확정 성공 → 토스트 → 사라짐 → 2일차 칩 press 뒤에도 토스트가 없고 POST 는 1건이다', async () => {
      itineraryHandler = () => HttpResponse.json(plannedItinerary());
      confirmHandler = () => HttpResponse.json(confirmedItinerary());
      renderPage();
      const cta = await screen.findByTestId('sheet-cta-button-0');

      fireEvent.press(cta);
      await waitForConfirmedFace();
      // 먼저 한 번은 떴다 — 이게 없으면 뒤의 "다시 안 뜬다"가 공허하다.
      expect(screen.getByTestId(CONFIRMED_TOAST)).toBeOnTheScreen();

      // 토스트가 사라진 상황(2.5초 자동 숨김과 같은 hideToast)을 만든다(02a ★10).
      resetToast();
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();

      // 실행 — 2일차로 바꿔 화면을 다시 그린다.
      fireEvent.press(screen.getByTestId('sheet-daychip-1'));
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');

      // 단언 — 다시 그려도 토스트는 다시 안 뜬다. 확정 요청도 1건 그대로다.
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
      expect(confirmPostCalls).toBe(1);
    });
  });

  describe('🔴 TRIP-1076 AC-3 · h16 확정 일정 지도는 핀 전부에 맞춰 연다', () => {
    it('셸 지도에 핀 2개 이상과 fitPins 가 함께 전달된다', async () => {
      // 준비 — 기본 픽스처는 좌표가 없어 핀이 0개다. day1 두 곳에 좌표를 실어 핀 2개를 만든다.
      const plan = itinerary();
      const DAY1_COORDS = [
        { lat: 33.458, lng: 126.942 },
        { lat: 33.512, lng: 126.529 },
      ];
      itineraryHandler = () =>
        HttpResponse.json({
          ...plan,
          days: plan.days.map((day, dayIndex) =>
            dayIndex === 0
              ? {
                  ...day,
                  slots: day.slots.map((slot, i) => ({
                    ...slot,
                    ...DAY1_COORDS[i],
                  })),
                }
              : day
          ),
        });

      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const map = screen.getByTestId('map-root');
      expect((map.props.pins as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect(map.props.fitPins).toBe(true);
    });
  });
});

// TRIP-801 · TRIP-939 · 옛 ItineraryPlanPage.confirmed.integration.test.tsx — 공유 게이트 스위치는 이 describe beforeEach 가 false 로 켠다.
describe('확정 셸(h16) 얼굴', () => {
  /**
   * TRIP-801 · h16 확정 일정(CONFIRMED)의 **지도+시트 셸 얼굴**을 실 HTTP 로 태우는 심판
   * (01b D1 계약 플립 · AC-1~6 · INV-3). 799(h14 PLANNED 셸)의 CONFIRMED 짝.
   *
   * 무엇을 보장하나:
   *  - 🔴 CONFIRMED 면 `ItineraryPlanPage` 가 옛 `TimelineScreen` 대신 공용 지도+시트 셸을 조립한다.
   *    옛 CONFIRMED 앵커는 사라진다(AC-1). TRIP-1047 로 지도 위 상주 성공 배너(`itinerary-confirmed-banner`)
   *    는 없어졌다 — 확정 알림은 확정한 순간의 토스트 1회로 옮겼다(그 심판은 「확정 CTA·재조회 배선」 describe).
   *  - 🔴 하단 CTA — `일정 수정`→h12 은 항상, `공유하기`→j06 은 공유 카드 캡처 개통(armed) 시에만(TRIP-939
   *    Q2 — 미장전이면 1버튼). 완전일치 push, 활성(AC-2).
   *  - 🔴 헤더 meta 가 "확정됨 · " 접두를 단다(km null 이면 "확정됨 · N곳", AC-3).
   *  - 🔴 슬롯 `openingHoursKnown === false` 에만 휴관 경고 표면이 뜬다(true/null/undefined 부재, AC-4).
   *  - 🔴 읽기전용 — 다른 후보(alt) 링크가 없다(AC-5).
   *  - 🔴 뒤로가기는 내 여행 목록으로 replace(AC-6).
   *  - 🔴 셸 얼굴 어디에도 소요시간·% 가 없다(INV-3, 배너·경고 신규 표면 포함).
   *
   * 왜 통합 버킷인가: 얼굴 판정(CONFIRMED vs PLANNED vs notFound)이 심판의 핵심이라 훅을 목하면
   * 그 판정이 테스트의 *가정*이 된다 — 실 HTTP 로 강제해 판정 회귀를 가시화한다(기존 5파일 관례).
   *
   * ⚠️ 함정(02a §4):
   *  - ★2 CONFIRMED 셸도 `map-sheet-shell-root` 를 쓴다 → 전이 착지 앵커는 헤더 meta 의 "확정됨 · " 접두
   *    (TRIP-1047: CONFIRMED 전용 배너가 사라져 옮김. 토스트는 사라지고 재진입엔 없어 앵커 불가).
   *  - ★5 warning 트리거는 boolean `openingHoursKnown` 하나, 문구는 상수 `휴관일 확인`(요일 발명 금지).
   *  - ★12 "1일차"는 day-chip·헤더 둘 다 → getByText 금지, testID 로만 스코프.
   *  - ★13 meta 카운트는 선택일 **비고정만**(확정됨 접두). totalPlaces·coPickProgress 재사용 시 red.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';
  const DAY1 = '2026-06-10';

  /** 4일 여행 — day-chip 수의 출처는 여행 기간, title(❗name 아님). */
  function trip() {
    return {
      tripId: TRIP_ID,
      title: '부산 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
      status: 'PLANNED' as const,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
    };
  }

  /** 비고정 슬롯. `openingHoursKnown` 은 케이스가 주입(AC-4). */
  function poi(
    poiId: string,
    startAt: string,
    endAt: string,
    distanceRange: string | null,
    nameKo: string,
    tags: string[],
    openingHoursKnown?: boolean | null
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt,
      endAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags,
      nameKo,
      category: '자연',
      imageUrl: null,
      distanceRange,
      lat: 35.15,
      lng: 129.11,
      openingHoursKnown,
    };
  }

  /** 고정 숙소 슬롯 — 단일 시각 21:00 + 고정 배지. */
  function hotel(distanceRange: string | null): ItineraryDaysItemSlotsItem {
    return {
      poiId: 'poi-hotel',
      startAt: '21:00:00',
      endAt: '21:00:00',
      isFixed: true,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: '해운대 그랜드 호텔',
      category: '숙소',
      imageUrl: null,
      distanceRange,
      lat: 35.16,
      lng: 129.16,
    };
  }

  /** 비고정 4장 — poi-c(부산시립미술관)에만 휴관 신호를 케이스가 얹는다. 커넥터 합 slice(1)=4.1km. */
  function fourPois(
    distances: (string | null)[],
    openingHoursKnownC?: boolean | null
  ): ItineraryDaysItemSlotsItem[] {
    return [
      poi('poi-a', '10:00:00', '11:00:00', distances[0], '광안리 해변', [
        '바다',
      ]),
      poi('poi-b', '11:30:00', '12:10:00', distances[1], '황령산 전망대', [
        '전망',
      ]),
      poi(
        'poi-c',
        '13:00:00',
        '14:30:00',
        distances[2],
        '부산시립미술관',
        ['미술'],
        openingHoursKnownC
      ),
      poi('poi-d', '14:30:00', '15:15:00', distances[3], '웨이브온 카페', [
        '감성',
      ]),
    ];
  }

  /** CONFIRMED 일정 빌더. */
  function confirmed(slots: ItineraryDaysItemSlotsItem[]): Itinerary {
    const days: ItineraryDaysItem[] = [{ date: DAY1, slots }];
    return {
      itineraryId: 'itin-801',
      tripId: TRIP_ID,
      status: 'CONFIRMED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  /** default — 비고정 4 + 고정 숙소 1. poi-c openingHoursKnown=false(휴관 경고 트리거). */
  function confirmedDefault(): Itinerary {
    return confirmed([
      ...fourPois([null, '2.1km', '0.8km', '0.6km'], false),
      hotel('0.6km'),
    ]);
  }

  /** 거리 계산 중 — 전 슬롯 distanceRange=null → legDistance null → meta km 생략. */
  function confirmedPending(): Itinerary {
    return confirmed([...fourPois([null, null, null, null]), hotel(null)]);
  }

  /** 렌더된 문자열 전부를 공백으로 이어 붙인다(INV-3 스캔 모집단, h14 선례). */
  function renderedText(): string {
    const out: string[] = [];
    screen.root
      .findAll(() => true)
      .forEach((node) => {
        const children = node.props?.children as unknown;
        const list = Array.isArray(children) ? children : [children];
        list.forEach((child) => {
          if (typeof child === 'string') out.push(child);
        });
      });
    return out.join(' ');
  }

  beforeEach(() => {
    resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
    mockShareArmed.value = false;
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

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 만 갈린다. */
  function useItinerary(response: () => Response) {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => response())
    );
  }

  describe('🔴 C1 · AC-1 · TRIP-1047 AC-3 — CONFIRMED 면 지도+시트 셸, 상주 성공 배너와 옛 앵커는 없다 (계약 플립)', () => {
    it('셸 골격이 확정 얼굴(meta "확정됨 · ")로 뜨고, 상주 배너·옛 TimelineScreen CONFIRMED 앵커는 부재한다', async () => {
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();

      await screen.findByTestId('map-sheet-shell-root');
      // 짝 — 확정 얼굴이다(AC-4). 이게 있어야 아래 "배너 없음"이 PLANNED 셸에서 공짜로 통과한 게 아니다.
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        /^확정됨 · /
      );
      // TRIP-1047 AC-3 — 지도 위 상주 배너는 없다(확정 상태 표시는 meta 가 맡는다).
      expect(screen.queryByTestId('itinerary-confirmed-banner')).toBeNull();

      // ★1 옛 CONFIRMED 앵커(TimelineScreen)는 소멸 — 셸로 갈아끼워졌다.
      expect(screen.queryByTestId('itinerary-view-timeline')).toBeNull();
      expect(screen.queryByTestId('itinerary-view-header')).toBeNull();
      expect(screen.queryByTestId('itinerary-view-share')).toBeNull();
      expect(screen.queryByTestId('itinerary-confirmed-note')).toBeNull();
    });
  });

  describe('🔴 C2 · AC-2 — CTA 가 h12(항상)·j06(캡처 개통 시)으로 push 하고 활성이다', () => {
    it('C2a · 일정 수정(button-0) press → h12 편집 push 1회, 활성', async () => {
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const edit = screen.getByTestId('sheet-cta-button-0');
      expect(edit).toBeEnabled();

      fireEvent.press(edit);
      // 형태 완전일치(★2·D5) — 객체형 push(goEdit 관용구), pathname·params 정확히.
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/edit',
        params: { tripId: TRIP_ID },
      });
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it('C2b · TRIP-939: 캡처 미장전(armed:false)이면 [공유하기]가 없고 [일정 수정] 1버튼이다', async () => {
      // 준비·실행: 확정 일정을 연다(캡처 미장전 = 오늘의 운영 빌드).
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 단언: 두 번째 버튼·'공유하기' 글자가 없다 + 짝 앵커([일정 수정]은 남는다).
      expect(screen.queryByTestId('sheet-cta-button-1')).toBeNull();
      expect(screen.queryByText('공유하기')).toBeNull();
      expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
        '일정 수정'
      );
    });

    it('C2c · 캡처 개통(armed:true)이면 공유하기(button-1) press → j06 공유 push 1회, 활성(짝)', async () => {
      mockShareArmed.value = true;
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const share = screen.getByTestId('sheet-cta-button-1');
      expect(share).toBeEnabled();

      fireEvent.press(share);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/records/share',
        params: { tripId: TRIP_ID },
      });
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 C3 · AC-3 — 헤더 meta "확정됨 · " 접두 (km null 이면 곳 수만)', () => {
    it('C3a · default: meta = "확정됨 · 4곳 · 4.1km"(비고정 4·legDistance 합)', async () => {
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // ★13 확정됨 접두 + 비고정 카운트 + 거리 합(완전일치). totalPlaces·coPickProgress 재사용이면 red.
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        '확정됨 · 4곳 · 4.1km'
      );
      // ★12 "1일차"는 day-chip·헤더 둘 다 → testID 로만 스코프.
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        '부산 여행'
      );
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
    });

    it('C3b · 거리 계산 중: meta = "확정됨 · 4곳"(km 생략)', async () => {
      useItinerary(() => HttpResponse.json(confirmedPending()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        '확정됨 · 4곳'
      );
      expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(
        /km/
      );
    });
  });

  describe('🔴 C4 · AC-4 — 휴관 경고는 openingHoursKnown === false 에만 (데이터 구동)', () => {
    it.each([
      [false, true],
      [true, false],
      [null, false],
      [undefined, false],
    ])(
      'poi-c openingHoursKnown=%p → 경고 present=%p',
      async (value, shouldShow) => {
        useItinerary(() =>
          HttpResponse.json(
            confirmed([
              ...fourPois([null, '2.1km', '0.8km', '0.6km'], value),
              hotel('0.6km'),
            ])
          )
        );
        renderPage();
        await screen.findByTestId('map-sheet-shell-root');

        const warning = screen.queryByTestId(
          `slot-stopcard-warning-${DAY1}#poi-c`
        );
        if (shouldShow) {
          expect(warning).toHaveTextContent('휴관일 확인');
        } else {
          expect(warning).toBeNull();
        }
      }
    );

    it('경고 필드 없는 슬롯(poi-a)엔 경고가 안 뜬다 (짝)', async () => {
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(
        screen.queryByTestId(`slot-stopcard-warning-${DAY1}#poi-a`)
      ).toBeNull();
    });
  });

  describe('🔴 C5 · AC-5 — 읽기전용: 다른 후보(alt) 링크가 없다', () => {
    it('CONFIRMED 셸 카드에 onPressAlt 미주입 → alt 링크 0개', async () => {
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.queryAllByTestId(/^slot-stopcard-alt-/)).toHaveLength(0);
    });
  });

  describe('🔴 C6 · AC-6 — 뒤로가기는 내 여행 목록으로 replace 한다', () => {
    it('sheet-daychip-back press → replace("/(tabs)/itinerary") 1회, back() 미호출', async () => {
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      fireEvent.press(screen.getByTestId('sheet-daychip-back'));

      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/itinerary');
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 C7 · INV-3 — 셸 얼굴에 소요시간·% 가 0건이다 (배너·경고 신규 표면 포함)', () => {
    it('분·시간·소요·% 어휘가 화면 어디에도 없다', async () => {
      useItinerary(() => HttpResponse.json(confirmedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const text = renderedText();
      expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
      expect(text).not.toContain('%');
    });
  });

  describe('🔴 C3c · TRIP-1110 AC-4 — 확정 헤더도 커넥터 구간에 null 이 섞이면 km 를 접는다', () => {
    it('일부 구간만 null 이면 meta 는 정확히 "확정됨 · 4곳"이다', async () => {
      // 준비 — b→c 구간만 null. 옛 스킵 규약이면 "확정됨 · 4곳 · 3.3km"(2.1+0.6+0.6 부분합).
      useItinerary(() =>
        HttpResponse.json(
          confirmed([
            ...fourPois([null, '2.1km', null, '0.6km']),
            hotel('0.6km'),
          ])
        )
      );
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const meta = screen.getByTestId('sheet-header-meta');
      expect(meta).toHaveTextContent('확정됨 · 4곳'); // 완전 일치
      expect(meta).not.toHaveTextContent(/km|이동|분|시간|소요/);
    });
  });
});

// TRIP-505 · 옛 ItineraryPlanPage.confirmedBack.integration.test.tsx
describe('확정 일정 뒤로가기', () => {
  /**
   * TRIP-505 — h34 확정 일정에서 **뒤로가기 재배선**(브리프 01 · Seed 01b AC-1·AC-2).
   *
   * **재작성(TRIP-799 · narrow)**: 미확정(PLANNED) 얼굴이 이제 지도+시트 셸이라 그 얼굴의 뒤로가기는
   * 셸의 `sheet-daychip-back`(옛 `itinerary-view-back` 아님)이다(★6) — CB2 의 앵커·press 대상만 셸로
   * 바뀐다. **CONFIRMED 얼굴은 TimelineScreen 유지**라 CB1 은 무변경(back testID·replace 목적지 그대로).
   *
   * 무엇을 보장하나: 확정(CONFIRMED) 얼굴에서 뒤로가기를 누르면, 생성/확정 흐름 스택으로
   * 되돌아가는 대신 **내 여행 목록**(`/(tabs)/itinerary`)으로 `router.replace` 한다(AC-1). 그리고
   * 그 확정 분기가 **미확정(PLANNED) 경로를 바꾸지 않는다** — PLANNED 뒤로가기는 기존
   * `canGoBack()?back():replace(HOME_FALLBACK)` 그대로다(AC-2, 회귀 방지).
   *
   * 왜 페이지 통합 버킷인가: 뒤로가기 목적지 판정은 status 를 아는 **배선(페이지)**에서만
   * 성립한다(화면 TimelineScreen 은 라우팅을 모른다 · 구조 가드). `useRouter` 를 목으로 갈아
   * `replace`/`back` 호출을 관찰한다.
   *
   * ★ 얼굴은 훅이 아니라 **실 HTTP** 로 강제한다 — 훅을 목하면 status(PLANNED/CONFIRMED)
   *   판정이 테스트의 가정이 되어, 페이지가 status 를 안 보는 회귀를 아무도 못 본다.
   * ★ 목은 `push`/`back`/`replace`/`canGoBack` 4종을 **hoisted** 상수로 올린다(`edit.integration`
   *   :55-66 복제). `replace` 가 익명 `jest.fn()` 이면 호출을 단언할 수 없고, `canGoBack` 이 없으면
   *   `handleBack` 이 `canGoBack is not a function` 으로 거짓 red 가 난다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답(status) 지정 → 실행=뒤로가기 press → 단언=나간 replace/back.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** 2일·3슬롯 완성 일정. status 만 갈아 CONFIRMED(확정 얼굴) vs PLANNED(편집 얼굴)를 만든다 —
   * 뒤로가기 목적지는 status 로만 갈리므로 슬롯 내용은 그대로 둔다. */
  function itineraryOf(status: ItineraryStatus): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'poi-b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
      {
        date: DAY2,
        slots: [
          {
            poiId: 'poi-c',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockClear();
    // 히스토리가 있다고 가정 — 이래야 CONFIRMED 확정 분기가 canGoBack 경로(back())와 갈린다(★T5).
    mockCanGoBack.mockReturnValue(true);
    setAccessToken('valid-access');
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false` — 상태를 즉시 확정(재시도가 돌면 얼굴이 흔들린다). `gcTime:0` — 기본 타이머가
   * 테스트 종료 후에도 프로세스를 붙잡는 것 방지(동결 통합테스트와 동형). */
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 의 status 만 갈린다. */
  function useItinerary(status: ItineraryStatus) {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryOf(status))
      )
    );
  }

  describe('🔴 CB1 · AC-1 — 확정(CONFIRMED) 뒤로가기는 내 여행 목록으로 replace 한다', () => {
    it('CONFIRMED 셸에서 sheet-daychip-back press → replace("/(tabs)/itinerary") 1회, back() 미호출', async () => {
      // 준비(TRIP-801 플립) — CONFIRMED 가 이제 지도+시트 셸이라(01b D1) 착지 앵커는
      // `map-sheet-shell-root`(옛 TimelineScreen 앱바 제목 '확정 일정'은 셸엔 없음 · 02a ★2)이고,
      // 뒤로가기 대상은 셸의 `sheet-daychip-back`(옛 `itinerary-view-back` 아님 · ★1). canGoBack=true.
      useItinerary('CONFIRMED');
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 실행 — 셸 back.
      fireEvent.press(screen.getByTestId('sheet-daychip-back'));

      // 단언 — 확정 분기는 canGoBack 경로를 타지 않고 곧장 내 여행 목록으로 replace 한다(무변경 계약).
      //   `/(tabs)/itinerary`(목록)는 딥링크 폴백 `/(tabs)`(홈)과 다른 리터럴이다.
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/itinerary');
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 CB2 · AC-2 — 미확정(PLANNED) 셸 뒤로가기는 기존 동작 유지(회귀 방지)', () => {
    it('PLANNED 셸에서 sheet-daychip-back press → back() 1회, replace 미호출(확정 분기가 안 샌다)', async () => {
      // 준비 — 일정 200·PLANNED → 지도+시트 셸 얼굴. 히스토리 있음(canGoBack=true).
      useItinerary('PLANNED');
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 실행 — ★6 셸 back(sheet-daychip-back) → handleBack.
      fireEvent.press(screen.getByTestId('sheet-daychip-back'));

      // 단언 — canGoBack()=true 라 back(). 확정 분기가 PLANNED 로 새지 않아 replace 는 안 불린다.
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});

// TRIP-482 · 옛 ItineraryPlanPage.edit.integration.test.tsx
describe('일정 수정 진입', () => {
  /**
   * TRIP-482 — h25 완성 일정(PLANNED)에서 h24 일정 편집으로 **들어가는 문** 배선(브리프 01 · Seed 01b).
   *
   * **재작성(TRIP-799 · narrow)**: PLANNED 완성 일정이 이제 지도+시트 셸이고 Figma h14 는 **편집 연필이
   * 없다**(01b D3 제거 목록) → IE1 은 "PLANNED → 편집 진입 push"에서 "PLANNED 셸엔 `itinerary-view-edit`
   * **부재**"로 뒤집힌다(★7). IE2(CONFIRMED)는 TimelineScreen 유지라 무변경(편집 문이 확정 일정으로
   * 새지 않음, AC-2).
   *
   * 무엇을 보장하나: PLANNED 셸 얼굴엔 편집 진입 어포던스(`itinerary-view-edit`)가 **없고**(Figma h14
   * 미설계), CONFIRMED(h34)에도 어포던스가 없다(편집 문이 확정 일정으로 새지 않음).
   *
   * 왜 페이지 통합 버킷인가: 화면(TimelineScreen)은 라우팅을 모르므로(구조 가드) push 배선은 반드시
   * 페이지에서만 성립한다. `useRouter` 를 목으로 갈아 `push` 호출 인자를 관찰한다(escape 통합테스트와
   * 동형 목).
   *
   * ★ 얼굴은 훅이 아니라 **실 HTTP 로** 강제한다(02a ★4) — 훅을 목하면 status(PLANNED/CONFIRMED) 판정이
   * 테스트의 가정이 되어, 페이지가 status 를 안 내리는 회귀를 아무도 못 본다.
   * ★ `router.canGoBack` 은 페이지 `handleBack` 이 부르므로 목에 반드시 넣는다 — 없으면 어떤 경로에서
   * `canGoBack is not a function` 으로 거짓 red 가 난다(escape 테스트 ★1 실측 · 02a ★5).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답(핸들러) 지정 → 실행=열고 어포던스 press → 단언=나간 push 인자·부재.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** 2일·3슬롯 완성 일정. status 만 갈아 PLANNED(편집 진입 있음) vs CONFIRMED(h34, 편집 진입 없음)를
   * 만든다 — 편집 진입은 status 로만 갈리므로 슬롯 내용은 그대로 둔다. */
  function itineraryOf(status: ItineraryStatus): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'poi-b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
      {
        date: DAY2,
        slots: [
          {
            poiId: 'poi-c',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  beforeEach(() => {
    resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
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

  /** `retry:false` — 상태를 즉시 확정(재시도가 돌면 얼굴이 흔들린다). `gcTime:0` — 기본 타이머가
   * 테스트 종료 후에도 프로세스를 붙잡는 것 방지(동결 통합테스트와 동형). */
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 의 status 만 갈린다(02a ★4). */
  function useItinerary(status: ItineraryStatus) {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryOf(status))
      )
    );
  }

  describe('🔴 IE1 · narrow(★7) — PLANNED 셸 얼굴엔 편집 연필이 없다 (Figma h14 미설계)', () => {
    it('PLANNED 는 지도+시트 셸이고 itinerary-view-edit 가 부재하며 push 도 안 나간다', async () => {
      // 준비 — 두 조회 성공(PLANNED) → 지도+시트 셸 얼굴.
      useItinerary('PLANNED');
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 단언 — 편집 연필은 셸에 없다(D3 제거 목록). 현행은 PLANNED→TimelineScreen 이라 이 얼굴 자체가
      //   안 떠(map-sheet-shell-root findBy 에서 red), 셸 전환 후엔 어포던스 부재로 green.
      expect(screen.queryByTestId('itinerary-view-edit')).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('🔴 IE2 · AC-7 의미 반전 — CONFIRMED h16 셸엔 "일정 수정" 버튼이 있고 h12 로 push 한다', () => {
    it('CONFIRMED 셸의 sheet-cta-button-0(일정 수정) press → h12 편집 push 1회', async () => {
      // 준비(TRIP-801 의미 반전) — 799 까지 IE2 는 "확정 일정엔 편집 문이 없다"를 잠갔으나, h16 정본이
      // 정면으로 **일정 수정 버튼을 추가**한다(01b D5 · 02a ★1). CONFIRMED 는 이제 셸이라 착지 앵커는
      // `map-sheet-shell-root`(옛 '확정 일정' 앱바 제목은 셸엔 없음 · ★2).
      useItinerary('CONFIRMED');
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 단언 — 편집 문이 확정 일정으로 **의도적으로** 열린다. h12 는 이 배선이 최초 앱-내 진입점이다.
      const edit = screen.getByTestId('sheet-cta-button-0');
      expect(edit).toHaveTextContent('일정 수정');

      fireEvent.press(edit);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/edit',
        params: { tripId: TRIP_ID },
      });
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });
});

// TRIP-402 · 옛 ItineraryPlanPage.escape.integration.test.tsx
describe('탈출구 — 뒤로·일정 만들기', () => {
  /**
   * TRIP-402 — h25 완성 일정 화면의 **탈출구** 배선(브리프 01 · Seed 01b).
   *
   * 무엇을 보장하나: 4얼굴(loading·notFound·failed·listed) 어디에 착지해도 눈에 보이는 뒤로가기가
   * 있고, 뒤로 갈 히스토리가 없으면(딥링크) 조용히 무동작하지 않고 홈(`/(tabs)`)으로 간다(침묵 no-op
   * 금지 · INV-4). 빈 얼굴(notFound)은 나갈 길 대신 "일정 만들기" 다음 행동도 준다.
   *
   * 왜 페이지 통합 버킷인가: 화면(TimelineScreen)은 라우팅을 모르므로(구조 가드) 탈출구 배선은
   * 반드시 페이지에서만 성립한다. `useRouter`를 목으로 갈아 `back()`/`push()`/`replace()` 호출을
   * 관찰한다(TRIP-369 `StayRegisterPage.back.integration.test.tsx`와 동형 목).
   *
   * ★ `router.canGoBack()`은 리포 선례 0건 신규 API — 목이 그 함수를 안 주면 구현이 옳아도
   * `canGoBack is not a function`으로 죽어 거짓 red가 난다(02a ★1). 그래서 `canGoBack`을 목에 반드시
   * 넣고, 케이스마다 `mockCanGoBack.mockReturnValue(true|false)`로 히스토리 유무를 강제한다.
   *
   * 얼굴은 훅이 아니라 **실 HTTP로** 강제한다(02a ★2) — 훅을 목하면 얼굴 판정이 테스트의 가정이 되어
   * 그 판정 회귀를 아무도 못 본다. loading은 `delay('infinite')`로 두 GET을 영영 pending시킨다.
   *
   * **재작성(TRIP-799 · narrow)**: listed(PLANNED) 얼굴이 이제 지도+시트 셸이라 그 얼굴의 뒤로가기는
   * DayChipOverlay 의 `sheet-daychip-back`(옛 `itinerary-view-back` 아님)이고, 본체 앵커는
   * `map-sheet-shell-root` 다(★6). **loading·notFound·failed 얼굴은 여전히 PlanFace/PlanAppBar**라
   * 그쪽 뒤로가기는 `itinerary-view-back` 그대로 — 셸 back 과 PlanFace back 의 testID 가 갈린 것이
   * narrow 경계다. AC-5a·5b·6 은 셸 testID 로, AC-7 은 settle 후 앵커만 셸로 바뀐다(AC-1~4 무변경).
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** PLANNED 완성 일정(2일·3슬롯). PLANNED여야 listed 얼굴에 활성 `itinerary-confirm-cta`가 뜬다
   * (CONFIRMED은 읽기전용 2버튼으로 갈림) — AC-6 대상이 확정 CTA라 PLANNED 고정. */
  function plannedItinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'poi-b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
      {
        date: DAY2,
        slots: [
          {
            poiId: 'poi-c',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  beforeEach(() => {
    mockBack.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockClear();
    // 기본: 히스토리 있음. 딥링크(canGoBack=false) 케이스만 각 테스트에서 뒤집는다.
    mockCanGoBack.mockReturnValue(true);
    setAccessToken('valid-access');
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false` — 404/500을 즉시 실패로(재시도가 돌면 얼굴이 흔들린다). `gcTime:0` — 기본 타이머가
   * 테스트 종료 후에도 프로세스를 붙잡는 것 방지(동결 통합테스트와 동형). */
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** 얼굴 강제 헤더 — trip GET은 케이스마다 다르지 않아 항상 200, itinerary GET만 갈린다(02a ★2). */
  function useTripOk() {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()))
    );
  }
  function useItineraryNotFound() {
    useTripOk();
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 404 })
      )
    );
  }
  function useItineraryFailed() {
    useTripOk();
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
  }
  function useItineraryListed() {
    useTripOk();
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(plannedItinerary())
      )
    );
  }

  describe('🔴 AC-1 · 빈 얼굴(notFound) 뒤로가기 — 히스토리 있으면 이전 화면으로', () => {
    it('notFound 얼굴에서 뒤로가기를 누르면 router.back()으로 이어진다', async () => {
      // 준비 — 일정 404 → 빈 얼굴("아직 완성된 일정이 없어요")로 착지.
      useItineraryNotFound();
      renderPage();
      await screen.findByTestId('itinerary-view-notfound');

      // 실행 — 4얼굴 공통 뒤로가기(없으면 getByTestId가 throw).
      fireEvent.press(screen.getByTestId('itinerary-view-back'));

      // 단언 — 히스토리 있으니 back(), replace 아님.
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-2 · 빈 얼굴 다음 행동 — "일정 만들기" → 방식 선택(h04)', () => {
    it('notFound 얼굴의 일정 만들기 액션을 누르면 method 라우트로 push한다', async () => {
      // 준비 — 빈 얼굴 착지.
      useItineraryNotFound();
      renderPage();
      await screen.findByTestId('itinerary-view-notfound');

      // 실행 — StateNotice 액션 버튼(현행은 actions=[]라 부재 → red).
      fireEvent.press(screen.getByTestId('itinerary-plan-create-cta'));

      // 단언 — 동적 라우트 push 관용구(객체 1인자, DraftPage·MethodPage 선례).
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/method',
        params: { tripId: TRIP_ID },
      });
    });
  });

  describe('🔴 AC-3 · 실패 얼굴(failed) 뒤로가기', () => {
    it('failed 얼굴에서 뒤로가기를 누르면 router.back()으로 이어진다', async () => {
      // 준비 — 일정 500(비-404) → 실패 얼굴(404는 notFound가 먹으므로 500이어야 failed).
      useItineraryFailed();
      renderPage();
      await screen.findByTestId('itinerary-view-failed');

      // 실행 + 단언.
      fireEvent.press(screen.getByTestId('itinerary-view-back'));
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-4 · 딥링크(히스토리 없음) — 침묵 no-op 금지, 홈으로 replace', () => {
    it('canGoBack()===false면 back이 아니라 홈(/(tabs))으로 replace한다', async () => {
      // 준비 — 빈 얼굴 + 히스토리 없음(딥링크로 직접 들어온 최악 조합).
      useItineraryNotFound();
      mockCanGoBack.mockReturnValue(false);
      renderPage();
      await screen.findByTestId('itinerary-view-notfound');

      // 실행.
      fireEvent.press(screen.getByTestId('itinerary-view-back'));

      // 단언 — 홈 목적지 자체를 잠근다('/(tabs)/itinerary'는 trips[0] 리다이렉트 함정이라 금지).
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      // 침묵 no-op도, back+replace 이중 호출도 아님 — replace만.
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-5a · listed(PLANNED) 셸 뒤로가기 — 히스토리 있으면 이전 화면으로', () => {
    it('셸의 sheet-daychip-back 을 누르면 router.back()으로 이어진다', async () => {
      // 준비 — 두 조회 성공(PLANNED) → 지도+시트 셸 얼굴.
      useItineraryListed();
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 실행 + 단언 — ★6 셸 back(sheet-daychip-back) → handleBack → 히스토리 있으면 back(무회귀).
      fireEvent.press(screen.getByTestId('sheet-daychip-back'));
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-5b · listed 딥링크 사각 봉합 — 공통 handleBack이라 셸 얼굴도 홈 폴백', () => {
    it('셸에서도 canGoBack()===false면 홈(/(tabs))으로 replace한다', async () => {
      // 준비 — listed(PLANNED) 셸 + 히스토리 없음.
      useItineraryListed();
      mockCanGoBack.mockReturnValue(false);
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 실행 + 단언.
      fireEvent.press(screen.getByTestId('sheet-daychip-back'));
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-6 · listed(PLANNED) 본체 = 지도+시트 셸 (옛 timeline 앵커 소멸)', () => {
    it('셸 본체·CTA가 뜨고 옛 TimelineScreen listed 앵커는 사라진다', async () => {
      // 준비 — listed(PLANNED) 얼굴.
      useItineraryListed();
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 단언 — PLANNED 본체는 셸이다(narrow). 옛 인라인 지도·지도 크게 보기·시간표·확정 CTA testID 소멸.
      expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-view-timeline')).toBeNull();
      expect(screen.queryByTestId('itinerary-view-map')).toBeNull();
      expect(screen.queryByTestId('itinerary-map-expand')).toBeNull();
      expect(screen.queryByTestId('itinerary-confirm-cta')).toBeNull();
    });
  });

  describe('🔴 AC-7 · loading 얼굴 뒤로가기 — 조회가 걸려도 갇히지 않는다', () => {
    it('loading 얼굴에도 뒤로가기가 있고 router.back()으로 이어진다', async () => {
      // 준비 — 정상 핸들러지만 아직 settle 안 됨: 두 쿼리가 `isPending`이라 **초기 렌더가 곧 loading**
      // 이다(동결 통합테스트가 loading을 지나려 `findBy`로 기다리는 바로 그 창). 영영 pending(delay
      // infinite)은 jest 프로세스를 붙잡아 leak을 내므로 안 쓴다 — settle되는 핸들러로 창만 쓴다.
      useItineraryListed();
      renderPage();

      // 얼굴 증명 — settle 전이라 다른 얼굴은 없다(부재는 queryAll, getAll은 0건에서 throw). loading임.
      // narrow: settle 후 PLANNED 는 셸이므로 loading 중엔 셸(map-sheet-shell-root)도 아직 없다.
      expect(screen.queryAllByTestId('map-sheet-shell-root')).toEqual([]);
      expect(screen.queryAllByTestId('itinerary-view-notfound')).toEqual([]);
      expect(screen.queryAllByTestId('itinerary-view-failed')).toEqual([]);

      // 실행 — loading 얼굴의 뒤로가기(PlanAppBar, itinerary-view-back — 무변경)를 지금(settle 전) 누른다.
      fireEvent.press(screen.getByTestId('itinerary-view-back'));

      // 단언 — 히스토리 있으니 back().
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();

      // 정리 — 쿼리를 settle시켜 teardown의 dangling promise/act 경고를 없앤다(단언 아님).
      //   settle 후 PLANNED 는 셸이라 앵커를 셸 루트로 바꾼다(narrow).
      await screen.findByTestId('map-sheet-shell-root');
    });
  });
});

// TRIP-337 → TRIP-799 · 옛 ItineraryPlanPage.lock.integration.test.tsx
describe('확정 예방 잠금(PARTIAL)', () => {
  /**
   * TRIP-337 → TRIP-799 · AC-9 확정 예방 잠금을 **실 HTTP 로** 태우는 심판.
   *
   * **재작성(TRIP-799 · narrow)**: PLANNED 완성 일정이 이제 지도+시트 셸이라 확정 CTA 는
   * `sheet-cta-button-0`("일정 저장하기")이고, PARTIAL 잠금은 **CtaButton.disabled**(가산 prop)로
   * 표현된다(★5). 그리고 옛 잠금 **배너**(`itinerary-confirm-locked-notice`)는 새 흐름에서 **제거**된다
   * (D6 — h14 는 PARTIAL 도달 안 함) → A4-1 은 "배너가 뜬다"에서 "배너가 부재한다"로 뒤집힌다.
   *
   * 무엇을 보장하나:
   *  - 🔴 `generationState==='PARTIAL'` 이면 셸 CTA 가 **비활성**이고 **눌러도 확정 요청이 한 건도 안
   *    나간다**(계약: PARTIAL 동안 확정은 409). 잠금 배너는 **안 뜬다**(옛 lock 테스트 뒤집기).
   *  - `COMPLETE` 면 CTA 가 다시 활성이고 눌리면 요청이 실제로 나간다(잠금은 PARTIAL 에서만).
   *  - ★ `toBeDisabled()` 단독은 accessibilityState 만으로 통과하므로, **disabled + press→confirm 0**
   *    짝으로만 심판이 된다(★5 — CtaButton.disabled 없이 accessibilityState 만 켠 가짜 비활성은 red).
   *
   * 왜 통합 버킷인가: 핵심 단언이 **"눌러도 확정 요청이 안 나갔다"**(POST 0건)다 — 순수함수·화면
   * 단독으로는 못 잰다. 훅을 목킹하면 그 계수가 테스트의 *가정*이 되어 틀려도 아무도 모른다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고 확정 CTA 를 누른다 → 단언=비활성·사유·나간 요청.
   */

  // 옛 파일 라우터 목엔 `canGoBack` 이 없었다 — 페이지가 부르면 TypeError 로 red 였던 그물을 잇는다(02a ★).
  afterEach(() => {
    expect(mockCanGoBack).not.toHaveBeenCalled();
  });
  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';

  /** 3일 여행(06-10 → 06-12). status 는 항상 PLANNED — 확정 CTA 가 뜨는 조건. */
  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /**
   * 확정 CTA 가 뜨려면 `resolvePlanState` 가 'listed' 여야 하고(=슬롯 있는 days), status 가
   * CONFIRMED 가 아니어야 한다. day1 슬롯 하나만 담아 그 조건을 만든다 — 곳 수·카드 모양은
   * 이 칸의 심판이 아니다. `generationState`·`status` 는 케이스가 정한다.
   */
  function itinerary(input: {
    generationState: ItineraryGenerationState;
    status?: ItineraryStatus;
  }): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: input.status ?? 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: input.generationState,
      isFallback: false,
      days: [
        {
          date: DAY1,
          slots: [
            {
              poiId: 'poi-a',
              startAt: '09:30:00',
              endAt: '11:00:00',
              isFixed: false,
              endsNextDay: false,
              hasViolation: false,
              alternatives: [],
              tags: [],
              nameKo: '성산일출봉',
            },
          ],
        },
      ],
    };
  }

  /** POST /confirm 이 몇 번 처리됐나 — press 가 확정 요청을 발화시켰는지의 유일한 심판. */
  let confirmPostCalls = 0;
  /** GET /itinerary 응답을 케이스가 정한다(PARTIAL · COMPLETE). */
  let itineraryHandler: () => Response;
  /** POST /confirm 응답을 케이스가 정한다(계약: PARTIAL 이면 409, 정상 확정이면 200 CONFIRMED). */
  let confirmHandler: () => Response;

  beforeEach(() => {
    resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
    confirmPostCalls = 0;
    mockBack.mockClear();
    setAccessToken('valid-access');
    itineraryHandler = () =>
      HttpResponse.json(itinerary({ generationState: 'COMPLETE' }));
    confirmHandler = () =>
      HttpResponse.json(
        itinerary({ generationState: 'COMPLETE', status: 'CONFIRMED' })
      );

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler()),
      http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
        confirmPostCalls += 1;
        return confirmHandler();
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false` — 실패를 즉시 실패로(재시도가 돌면 요청 개수 단언이 흔들린다).
   * `gcTime:0` — 기본 타이머가 테스트 종료 후에도 프로세스를 붙잡는 것 방지. */
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** press(동기) 후 mutate(비동기) 가 한 틱 돌 시간을 준다 — "그래도 요청이 안 나갔다"를 재려면 필요. */
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  describe('🔴 A4-1 · AC-9 — PARTIAL 이면 셸 CTA 가 잠긴다 (계약 409 · ★5, 잠금 배너 부재)', () => {
    it('셸 CTA 가 비활성이고 잠금 배너가 없으며, 눌러도 확정 요청이 0건이다', async () => {
      // 준비 — 생성 진행 중(PARTIAL)인데 확정 상태축은 아직 PLANNED. 계약상 확정은 409.
      itineraryHandler = () =>
        HttpResponse.json(
          itinerary({ generationState: 'PARTIAL', status: 'PLANNED' })
        );
      confirmHandler = () => new HttpResponse(null, { status: 409 });

      renderPage();

      // ① 비활성 — `toBeDisabled()` 는 accessibilityState 만 켜도 통과하므로 단독으로는 "회색인데
      //    눌리는" 구현을 통과시킨다. 아래 ③(요청 0건)과 짝을 이뤄야 심판이 된다(★5).
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(cta).toBeDisabled());

      // ② 잠금 배너 부재(D6 뒤집기) — 옛 흐름의 `itinerary-confirm-locked-notice` 는 새 셸에 없다
      //    (h14 는 PARTIAL 에 도달 안 함, 사유 배너 대신 disabled CTA 로만 방어).
      expect(
        screen.queryByTestId('itinerary-confirm-locked-notice')
      ).toBeNull();

      // ③ ★ 핵심 — 눌러도 확정 요청이 **한 건도 안 나간다**. 죽은 활성 버튼(눌러 409만 받음)이
      //    아니다. accessibilityState 만 켠 가짜 비활성은 press 가 살아 있어 여기서 red 가 된다.
      fireEvent.press(cta);
      await sleep(50);
      expect(confirmPostCalls).toBe(0);
    });
  });

  describe('🔴 A4-2 · AC-9 — COMPLETE 면 셸 CTA 가 다시 활성이다 (필수 짝 · ★5)', () => {
    it('셸 CTA 가 활성이고 잠금 배너가 없으며, 누르면 확정 요청이 1건 나간다', async () => {
      // 준비 — status 는 A4-1 과 **똑같이 PLANNED**, generationState 만 COMPLETE 로 바뀐다.
      // 이 대조가 "잠금은 generationState 축에서만 갈린다"를 못박는다(★4).
      itineraryHandler = () =>
        HttpResponse.json(
          itinerary({ generationState: 'COMPLETE', status: 'PLANNED' })
        );
      confirmHandler = () =>
        HttpResponse.json(
          itinerary({ generationState: 'COMPLETE', status: 'CONFIRMED' })
        );

      renderPage();

      // ① 활성 — A4-1 을 만족시키려 CTA 를 무조건 비활성화하는 과잉 구현을 여기서 죽인다.
      const cta = await screen.findByTestId('sheet-cta-button-0');
      await waitFor(() => expect(cta).toBeEnabled());

      // ② 잠금 배너는 없다(COMPLETE 는 잠글 이유가 없다 · 새 셸엔 배너 자체가 없다).
      expect(
        screen.queryAllByTestId('itinerary-confirm-locked-notice')
      ).toEqual([]);

      // ③ 실제로 눌리면 확정 요청이 나간다 — 항상 비활성인 구현을 죽인다.
      fireEvent.press(cta);
      await waitFor(() => expect(confirmPostCalls).toBe(1));
    });
  });
});

// TRIP-919 · 옛 ItineraryPlanPage.mapFallback.integration.test.tsx
describe('지도 실패 폴백', () => {
  /**
   * TRIP-919 · AC-5 — h14 완성 일정(PLANNED 셸)에서 지도가 실패하면 **페이지 코드 변경 없이** 셸이 폴백
   * 바를 띄우고, 시트 카드 목록과 [일정 저장하기] CTA 는 그대로 남는다(INV-4 · US-SCHED-06 예외).
   *
   * 무엇을 보장하나: 실패 감지·폴백 표시는 셸 몫이라 9 소비처가 공짜로 얻는다 — 그중 h14 페이지 층에서
   * "셸이 실패를 받아 처리한다"를 한 번 확인한다. 페이지 파일(ItineraryPlanPage.tsx) 무변경은 명령 검증
   * (`git diff --stat`)이 따로 본다.
   *
   * ★ 지도는 `mapViewMock` 이다(얇은 관찰 마커). 목은 남는 props 를 host 로 흘리므로, 셸이 넘긴
   *   `onLoadFailed` 를 `getByTestId('map-root').props.onLoadFailed()` 로 직접 발화한다(02a ★11, 실측).
   *   직접 호출이라 상태 갱신을 `act` 로 감싼다.
   * ★ 얼굴은 훅이 아니라 실 HTTP(MSW)로 강제한다 — 동결 통합 테스트들과 같은 장치. `canGoBack` 은
   *   페이지 handleBack 이 부르므로 목에 넣는다(escape ★1 계승).
   *
   * 3동작 뼈대: 준비=가짜 서버(PLANNED) + 셸 도착 → 실행=지도 실패 발화 → 단언=폴백·카드·CTA.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const FALLBACK_MESSAGE =
    '지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** 1일·2슬롯 완성 일정(PLANNED) — 지도 실패 전후로 카드 2장이 그대로인지 본다. */
  function itinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'poi-b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockClear();
    mockCanGoBack.mockReturnValue(true);
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false` — 얼굴 즉시 확정. `gcTime:0` — 타이머가 프로세스를 붙잡지 않게(동결 통합 테스트 동형). */
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  const CARD_A = `slot-stopcard-${DAY1}#poi-a`;
  const CARD_B = `slot-stopcard-${DAY1}#poi-b`;

  describe('🔴 PF1 · AC-5 — h14 셸에서 지도가 실패하면 폴백 바가 뜨고 카드·CTA 는 남는다', () => {
    it('map-root 의 onLoadFailed 발화 → map-sheet-fallback 표시 · 지도 자리 교체 · 카드 2장·일정 저장하기 유지', async () => {
      // 준비 — PLANNED 셸 도착, 실패 전 카드·CTA 확인(부정 단언의 공허 통과 방지).
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');
      expect(screen.getByTestId(CARD_A)).toBeOnTheScreen();
      expect(screen.getByTestId(CARD_B)).toBeOnTheScreen();
      const map = screen.getByTestId('map-root');
      // 셸이 지도에 실패 콜백을 실제로 넘겼다(현행 셸은 안 넘겨 여기서 red).
      expect(typeof map.props.onLoadFailed).toBe('function');

      // 실행 — 지도가 실패를 알린다.
      act(() => {
        (map.props.onLoadFailed as () => void)();
      });

      // 단언 — 셸 기본 폴백 바가 지도 자리를 대신한다.
      const fallback = screen.getByTestId('map-sheet-fallback');
      expect(within(fallback).getByText(FALLBACK_MESSAGE)).toBeOnTheScreen();
      expect(screen.queryByTestId('map-root')).toBeNull();
      // 화면을 비우지 않는다(INV-4) — 카드 2장과 [일정 저장하기] CTA 가 그대로다.
      expect(screen.getByTestId(CARD_A)).toBeOnTheScreen();
      expect(screen.getByTestId(CARD_B)).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('sheet-cta-button-0')).getByText(
          '일정 저장하기'
        )
      ).toBeOnTheScreen();
    });
  });
});

// TRIP-1013 #057 · 옛 ItineraryPlanPage.pressGuard.integration.test.tsx — 시계 정지(Date.now 스파이)는 이 describe 안에만 건다.
describe('연타 가드 — 저장 직후 일정 수정 관통 차단', () => {
  /**
   * TRIP-1013 #057 — '일정 저장하기' 연타의 두 번째 탭이, 확정 성공으로 같은 CTA 자리에 새로 뜬
   * '일정 수정'을 누르지 않는다(실기에서는 확정 직후 편집 화면으로 들어갔다).
   *
   * 가드는 이 페이지가 만드는 cta 배열의 콜백에 건다 — `CtaBar` 는 소비처가 여럿이라 건드리지 않는다
   * (01b 결정 1). "창 밖"은 `resetPressGuard()`로 만든다(=400ms 이상 흐른 것과 같다).
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';

  const EDIT_ROUTE = {
    pathname: '/trips/[tripId]/itinerary/edit',
    params: { tripId: TRIP_ID },
  };

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-11',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function itinerary(status: 'PLANNED' | 'CONFIRMED'): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  let confirmPostCalls = 0;
  /** POST /confirm 응답을 붙잡아 두는 문 — null 이면 즉시 응답한다. */
  let confirmGate: Promise<void> | null = null;
  let releaseConfirm: (() => void) | null = null;

  function holdConfirm(): void {
    confirmGate = new Promise<void>((resolve) => {
      releaseConfirm = resolve;
    });
  }

  let activeClient: QueryClient | null = null;

  /** 가드 판정용으로 멈춰 둘 시각(값 자체는 의미 없다 — 흐르지 않는 것이 요점). */
  const FROZEN_NOW = 1_790_000_000_000;

  // 이 파일은 전부 가드 판정 테스트다 — 시계를 멈춘다(화면을 그리고 응답을 기다리는 동안 실제 시간이
  // 흘러 "창 안"이 400ms 를 넘기면 판정이 흔들린다, 02a ★2). "창 밖"은 resetPressGuard() 로만 만든다.
  let clock: jest.SpyInstance;

  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
    resetPressGuard();
    mockPush.mockClear();
    confirmPostCalls = 0;
    confirmGate = null;
    releaseConfirm = null;
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary('PLANNED'))
      ),
      http.post(`${BASE}/trips/:tripId/itinerary/confirm`, async () => {
        confirmPostCalls += 1;
        if (confirmGate !== null) await confirmGate;
        return HttpResponse.json(itinerary('CONFIRMED'));
      })
    );
  });

  afterEach(async () => {
    clock.mockRestore();
    releaseConfirm?.();
    await activeClient?.cancelQueries();
    activeClient?.clear();
    activeClient = null;
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
    activeClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const client = activeClient;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** PLANNED 로 열려 '일정 저장하기' 1버튼이 뜰 때까지 기다린다. */
  async function openPlanned(): Promise<void> {
    renderPage();
    const cta = await screen.findByTestId('sheet-cta-button-0');
    expect(cta).toHaveTextContent('일정 저장하기');
  }

  /** 확정 성공으로 같은 자리가 '일정 수정'으로 바뀔 때까지 기다린다. */
  async function waitForEditCta(): Promise<void> {
    // 착지 앵커 = 확정 전용 meta 접두(TRIP-1047 — 상주 배너가 사라져 옮김).
    await waitFor(() =>
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        /^확정됨 · /
      )
    );
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '일정 수정'
    );
  }

  /** 창이 닫힌 뒤(=사람이 다시 누름) "일정 수정"이 편집으로 정확히 1회 간다 — 앞의 "0회"가 공짜
   * 통과가 아니라는 긍정 앵커를 겸한다. */
  function expectEditWorksAfterWindow(): void {
    resetPressGuard();
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(EDIT_ROUTE);
  }

  describe('AC-057 · 확정 성공으로 CTA 가 바뀐 직후, 창 안의 "일정 수정"은 무시된다', () => {
    it('창 안의 "일정 수정"은 편집 push 가 0회이고, 창이 지난 뒤 한 번 누르면 정확히 1회다', async () => {
      await openPlanned();

      // 실행 ① — 첫 탭(일정 저장하기).
      fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
      await waitForEditCta();
      // 앵커 — 첫 탭은 제 할 일을 했다(확정 POST 1건).
      expect(confirmPostCalls).toBe(1);

      // 실행 ② — 같은 자리에 새로 뜬 '일정 수정'에 떨어진 두 번째 탭.
      fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

      // 단언 — 무시된다.
      expect(mockPush).toHaveBeenCalledTimes(0);
      // 무회귀 — 창이 지난 뒤의 한 번은 정상 동작한다.
      expectEditWorksAfterWindow();
    });

    it('01b Q2 · 확정 응답이 창(400ms)보다 늦어도, CTA 가 바뀌는 순간 창이 다시 열려 무시된다', async () => {
      await openPlanned();
      holdConfirm();

      fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
      // 첫 탭의 창이 닫힐 만큼 응답이 늦었다(=400ms 이상 흐름).
      resetPressGuard();
      releaseConfirm?.();
      await waitForEditCta();

      fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

      expect(mockPush).toHaveBeenCalledTimes(0);
      expectEditWorksAfterWindow();
    });
  });

  describe('01b Q3 · 창 안에서 "일정 저장하기"를 다시 눌러도 확정 요청은 1건이다', () => {
    it('응답을 기다리는 동안 연타해도 POST /confirm 이 한 번만 나간다', async () => {
      await openPlanned();
      holdConfirm();

      // 실행 — 응답 전 같은 버튼 연타(이 버튼엔 in-flight 잠금이 없다 — 브리프 맹점 ④).
      fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
      fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
      releaseConfirm?.();
      await waitForEditCta();
      // 두 번째 요청이 나갔다면 도착할 틈을 준다 — "1건"이 "아직 안 왔을 뿐"으로 공짜 통과하지 않게.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });

      expect(confirmPostCalls).toBe(1);
    });
  });
});

// TRIP-799 · 옛 ItineraryPlanPage.timeline.integration.test.tsx
describe('완성 셸(h14) 얼굴', () => {
  /**
   * TRIP-799 · h14 완성 일정(PLANNED)의 **지도+시트 셸 얼굴**을 실 HTTP 로 태우는 심판
   * (01b D1 narrow · AC-1~7·AC-10).
   *
   * 무엇을 보장하나:
   *  - 🔴 PLANNED 완성 일정이면 `ItineraryPlanPage` 가 옛 `TimelineScreen` 대신 **공용 지도+시트 셸**
   *    (`MapSheetShell`)을 조립한다(AC-1). 옛 listed 앵커(`itinerary-view-timeline`·`-map`)는 사라진다.
   *  - 🔴 전 슬롯 검증 시각 칩 — 비고정 `HH:mm–HH:mm`(en-dash U+2013), 고정 숙소 단일 `21:00`(AC-2).
   *  - 🔴 INV-3 — 셸 얼굴 어디에도 소요시간(`분`·`시간`·`소요`)·`%` 0(AC-3).
   *  - 🔴 헤더 "부산 여행 · 1일차 · 6월 10일…" + meta `4곳 · 4.1km`(N=비고정 4, km=legDistance 합, AC-4).
   *  - 🔴 전 슬롯 distanceRange=null → 커넥터는 글리프 줄만(문구 칸·"이동 거리 계산 중" 없음, TRIP-1054)
   *    + meta `4곳`(km 생략, AC-5).
   *  - 🔴 고정 숙소 슬롯 부재 → 거점없음 안내 카드 + 링크 push / 숙소 있으면 카드 부재(AC-7).
   *  - narrow 경계 — CONFIRMED 는 기존 `TimelineScreen`, 404 는 기존 notFound 얼굴(셸 부재, AC-10).
   *
   * ⚠️ 함정(02a §4):
   *  - ★8 "1일차"는 day-chip·헤더 dayLabel 둘 다 그린다 → getByText('1일차') 금지, testID 로만.
   *  - ★9 meta 카운트는 비고정만(4곳). totalPlaces·coPickProgress 재사용 시 red.
   *  - ★12 비고정 시각칩 en-dash `–`(U+2013), 고정은 단일 `21:00`(완전일치라 `21:00–21:00` 이면 red).
   *
   * 왜 통합 버킷인가: 얼굴 판정(PLANNED vs CONFIRMED vs notFound)이 심판의 핵심이라 훅을 목하면
   * 그 판정이 테스트의 *가정*이 된다 — 실 HTTP 로 강제해 판정 회귀를 가시화한다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고/누른다 → 단언=보이는 얼굴·testID·나간 요청.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '33333333-3333-3333-3333-333333333333';
  const DAY1 = '2026-06-10';

  /** 4일 여행 — day-chip 수의 출처는 여행 기간(또는 days), title(❗name 아님). */
  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '부산 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** 비고정 슬롯 — 사진 없는 슬롯(imageUrl null)을 1개 섞어 플레이스홀더 회귀도 겸한다(완료조건). */
  function poi(
    poiId: string,
    startAt: string,
    endAt: string,
    distanceRange: string | null,
    nameKo: string,
    tags: string[]
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt,
      endAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags,
      nameKo,
      category: '자연',
      imageUrl: null,
      distanceRange,
      lat: 35.15,
      lng: 129.11,
    };
  }

  /** 고정 숙소 슬롯 — 단일 시각 `21:00`(startAt=endAt) + 고정 배지 + 부제 대상. */
  function hotel(distanceRange: string | null): ItineraryDaysItemSlotsItem {
    return {
      poiId: 'poi-hotel',
      startAt: '21:00:00',
      endAt: '21:00:00',
      isFixed: true,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: '해운대 그랜드 호텔',
      category: '숙소',
      imageUrl: null,
      distanceRange,
      lat: 35.16,
      lng: 129.16,
    };
  }

  /** 비고정 4장(광안리 사진 없음) — 커넥터 합 2.1+0.8+0.6=3.5km(첫 슬롯 distanceRange 는 slice(1)라 미사용). */
  function fourPois(
    distances: (string | null)[]
  ): ItineraryDaysItemSlotsItem[] {
    return [
      poi('poi-a', '10:00:00', '11:00:00', distances[0], '광안리 해변', [
        '바다',
        '산책',
      ]),
      poi('poi-b', '11:30:00', '12:10:00', distances[1], '황령산 전망대', [
        '전망',
      ]),
      poi('poi-c', '13:00:00', '14:30:00', distances[2], '부산시립미술관', [
        '미술',
      ]),
      poi('poi-d', '14:30:00', '15:15:00', distances[3], '웨이브온 카페', [
        '감성',
      ]),
    ];
  }

  /** status·slots 를 케이스가 정하는 일정 빌더. */
  function itineraryOf(
    status: ItineraryStatus,
    slots: ItineraryDaysItemSlotsItem[]
  ): Itinerary {
    const days: ItineraryDaysItem[] = [{ date: DAY1, slots }];
    return {
      itineraryId: 'itin-799',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  /** default — 비고정 4(2.1·0.8·0.6km) + 고정 숙소 1(0.6km). legDistance(slice(1))=4.1km. */
  function plannedDefault(): Itinerary {
    return itineraryOf('PLANNED', [
      ...fourPois([null, '2.1km', '0.8km', '0.6km']),
      hotel('0.6km'),
    ]);
  }

  /** 거리 계산 중 — 전 슬롯 distanceRange=null → legDistance null → meta km 생략. */
  function plannedPending(): Itinerary {
    return itineraryOf('PLANNED', [
      ...fourPois([null, null, null, null]),
      hotel(null),
    ]);
  }

  /** 거점 없음 — 고정 숙소 슬롯 부재(비고정 4). legDistance(slice(1))=[2.1,0.8,0.6]=3.5km. */
  function plannedNoBase(): Itinerary {
    return itineraryOf('PLANNED', fourPois([null, '2.1km', '0.8km', '0.6km']));
  }

  /** 렌더된 문자열 전부를 공백으로 이어 붙인다(INV-3 스캔 모집단, h11 선례). */
  function renderedText(): string {
    const out: string[] = [];
    screen.root
      .findAll(() => true)
      .forEach((node) => {
        const children = node.props?.children as unknown;
        const list = Array.isArray(children) ? children : [children];
        list.forEach((child) => {
          if (typeof child === 'string') out.push(child);
        });
      });
    return out.join(' ');
  }

  beforeEach(() => {
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

  /** `retry:false`·`gcTime:0` — 실패 즉시, 잔존 타이머 방지. */
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 만 갈린다. */
  function useItinerary(response: () => Response) {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => response())
    );
  }

  describe('🔴 T1 · AC-1 — PLANNED 완성 일정이면 지도+시트 셸이 뜬다 (narrow, 계약 플립)', () => {
    it('셸 골격(지도·헤더·5슬롯·커넥터·CTA)이 뜨고 옛 TimelineScreen listed 앵커는 사라진다', async () => {
      useItinerary(() => HttpResponse.json(plannedDefault()));
      renderPage();

      // 셸 골격.
      await screen.findByTestId('map-sheet-shell-root');
      expect(screen.getByTestId('map-root')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-title')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-meta')).toBeOnTheScreen();
      // 카드 root testID 는 `slot-stopcard-{날짜}#{poiId}`(날짜=digit) — `/^slot-stopcard-\d/` 가 root 5장만.
      expect(screen.queryAllByTestId(/^slot-stopcard-\d/)).toHaveLength(5);
      expect(
        screen.queryAllByTestId(/^sheet-connector-\d/).length
      ).toBeGreaterThan(0);
      expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();

      // ★1 옛 listed 앵커(TimelineScreen)는 PLANNED 경로에서 소멸 — 셸로 갈아끼워졌다.
      expect(screen.queryByTestId('itinerary-view-timeline')).toBeNull();
      expect(screen.queryByTestId('itinerary-view-map')).toBeNull();
    });
  });

  describe('🔴 T2 · AC-2 — 전 슬롯 검증 시각 칩 (비고정 range en-dash · 고정 숙소 단일)', () => {
    it('5슬롯 전부 시각 칩이고 비고정은 range, 고정 숙소는 단일 21:00 이다', async () => {
      useItinerary(() => HttpResponse.json(plannedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.queryAllByTestId(/^slot-stopcard-time-/)).toHaveLength(5);

      // ★12 en-dash `–`(U+2013) — toHaveTextContent(문자열)=완전일치.
      expect(
        screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-a`)
      ).toHaveTextContent('10:00–11:00');
      expect(
        screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-c`)
      ).toHaveTextContent('13:00–14:30');
      // 고정 숙소 — 단일 21:00(완전일치라 `21:00–21:00` 오구현이면 red).
      expect(
        screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-hotel`)
      ).toHaveTextContent('21:00');
      // 고정 배지·부제(발명 display copy · 01b D3 동결).
      expect(
        screen.getByTestId(`slot-stopcard-fixed-${DAY1}#poi-hotel`)
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(`slot-stopcard-subtitle-${DAY1}#poi-hotel`)
      ).toHaveTextContent('저녁 · 숙소 · 변경 불가');
      // 짝 — 비고정 슬롯엔 고정 배지·부제 부재.
      expect(
        screen.queryByTestId(`slot-stopcard-fixed-${DAY1}#poi-a`)
      ).toBeNull();
      expect(
        screen.queryByTestId(`slot-stopcard-subtitle-${DAY1}#poi-a`)
      ).toBeNull();
    });

    it('T2b · 시각 고정 비숙소(must-visit)는 고정 배지는 있어도 "숙소" 부제가 안 붙는다 (5-b 경고-1)', async () => {
      // 시각 고정 must-visit POI(isFixed·비숙소)를 섞는다. 부제("…· 숙소 · 변경 불가")는 거점없음
      // 판정 hasBase 와 같은 isFixed&&숙소 정의라야 한다 — isFixed 단독으로 붙이면 미술관을 "숙소"로
      // 오표기한다. 고정 배지·단일 시각은 유지, 부제만 부재여야 한다.
      const fixedMustVisit: ItineraryDaysItemSlotsItem = {
        ...poi(
          'poi-fixed-mv',
          '14:00:00',
          '14:00:00',
          '0.8km',
          '부산시립미술관',
          ['미술']
        ),
        isFixed: true,
        category: '명소',
      };
      useItinerary(() =>
        HttpResponse.json(
          itineraryOf('PLANNED', [
            poi('poi-a', '10:00:00', '11:00:00', null, '광안리 해변', ['바다']),
            fixedMustVisit,
          ])
        )
      );
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 고정 배지·단일 시각은 유지.
      expect(
        screen.getByTestId(`slot-stopcard-fixed-${DAY1}#poi-fixed-mv`)
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-fixed-mv`)
      ).toHaveTextContent('14:00');
      // ★ 부제는 부재 — 비숙소 고정에 "숙소" 부제를 붙이면 red(경고-1 뮤테이션 그물).
      expect(
        screen.queryByTestId(`slot-stopcard-subtitle-${DAY1}#poi-fixed-mv`)
      ).toBeNull();
    });
  });

  describe('🔴 T3 · AC-3 — 셸 얼굴에 소요시간·% 가 0건이다 (INV-3)', () => {
    it('분·시간·소요·% 어휘가 화면 어디에도 없다', async () => {
      useItinerary(() => HttpResponse.json(plannedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const text = renderedText();
      expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
      expect(text).not.toContain('%');
    });
  });

  describe('🔴 T4 · AC-4 — 헤더 3세그 + meta "4곳 · 4.1km"(비고정 카운트·거리 합)', () => {
    it('제목=부산 여행·일차=1일차·날짜=6월 10일, meta=4곳 · 4.1km(고정 제외·legDistance 합)', async () => {
      useItinerary(() => HttpResponse.json(plannedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // ★8 "1일차"는 day-chip·헤더 둘 다 그리므로 testID 로만 스코프(getByText 금지).
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        '부산 여행'
      );
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
      // 날짜 포맷("· 수" vs "(수)")은 강요 안 함 — 정규식 부분.
      expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
        /6월 10일/
      );
      // ★9 meta = 비고정 4곳 + 거리 합 4.1km(2.1+0.8+0.6+0.6). totalPlaces·coPickProgress 재사용이면 red.
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        '4곳 · 4.1km'
      );
    });
  });

  describe('🔴 T5 · AC-5 — 거리 없음: 커넥터 글리프 줄만 + meta km 생략 (TRIP-1054 AC-7)', () => {
    it('전 슬롯 distanceRange=null 이면 커넥터 줄은 남고 문구 칸·"계산 중"이 없으며 meta 는 곳 수만 그린다', async () => {
      useItinerary(() => HttpResponse.json(plannedPending()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 줄은 남는다(T1 과 같은 줄 선택자 — 줄 testID 는 날짜로 시작).
      expect(
        screen.queryAllByTestId(/^sheet-connector-\d/).length
      ).toBeGreaterThan(0);
      // 문구 칸은 하나도 없다(값이 없으니 그릴 글자가 없다 — 결정 1b).
      expect(
        screen.queryAllByTestId(/^sheet-connector-distance-/)
      ).toHaveLength(0);
      // 옛 거짓 신호 "계산 중" 0(QA #038).
      expect(screen.queryByText(/이동 거리 계산 중/)).toBeNull();

      // ★10 legDistance([null,…])→null → meta km 생략(곳 수만). "4곳 · X.Xkm" 이면 red.
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('4곳');
      expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(
        /km/
      );
    });
  });

  describe('🔴 T7 · AC-7 — 거점 없음: 안내 카드 + 링크 push / 숙소 있으면 카드 부재', () => {
    it('T7a · 고정 숙소 슬롯이 없으면 거점없음 안내 카드가 뜨고 링크 press 로 이동한다', async () => {
      useItinerary(() => HttpResponse.json(plannedNoBase()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const card = screen.getByTestId('itinerary-plan-no-base');
      // ⚠️ 한 카드가 두 카피(제목+링크)를 담으므로 exact(문자열 인자)는 둘 다 통과 불가 —
      // toHaveTextContent 는 이 RNTL 버전에서 문자열 인자를 exact(자손 join 전체 일치)로 본다.
      // 의도는 "포함"(02a §6)이라 regex(부분 일치)로 각 카피 존재를 잠근다.
      expect(card).toHaveTextContent(/거점 숙소가 없어요/);
      expect(card).toHaveTextContent(/동선 기준 추천 보기/);

      // 링크 press → 항법(침묵 no-op 아님). h15 라우트는 TRIP-800 밖이라 목적지 리터럴은 강요 안 하고
      // (as Href 캐스트·planb-request 선례) push 가 한 번 나갔는지만 잠근다(02a §8).
      fireEvent.press(screen.getByTestId('itinerary-plan-no-base-link'));
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it('T7b · 고정 숙소 슬롯이 있으면 거점없음 안내 카드가 없다 (짝)', async () => {
      useItinerary(() => HttpResponse.json(plannedDefault()));
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.queryByTestId('itinerary-plan-no-base')).toBeNull();
    });
  });

  describe('AC-10 · narrow 경계 — 도착·확정·404 얼굴 보존', () => {
    it('T10a · CONFIRMED 도 이제 지도+시트 셸이고 옛 TimelineScreen 은 안 뜬다 (TRIP-801 플립)', async () => {
      // TRIP-801: 799 시점의 "CONFIRMED=TimelineScreen"(선제 green)을 뒤집는다 — CONFIRMED 도 셸이라
      // `map-sheet-shell-root` 가 뜨고 `itinerary-view-timeline` 은 사라진다(01b D1 · 02a ★1).
      useItinerary(() =>
        HttpResponse.json(
          itineraryOf('CONFIRMED', [
            ...fourPois([null, '2.1km', '0.8km', '0.6km']),
            hotel('0.6km'),
          ])
        )
      );
      renderPage();

      await screen.findByTestId('map-sheet-shell-root');
      expect(screen.queryByTestId('itinerary-view-timeline')).toBeNull();
    });

    it('T10b · 404 는 기존 notFound 얼굴이고 셸은 안 뜬다 (선제 green)', async () => {
      useItinerary(() => new HttpResponse(null, { status: 404 }));
      renderPage();

      await screen.findByTestId('itinerary-view-notfound');
      expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
    });
  });

  describe('🔴 T5b · TRIP-1110 AC-4·AC-6 — 커넥터 구간(slice(1))에 null 이 섞이면 meta km 를 접는다', () => {
    it('T5b-1 · 일부 구간만 null 이면 meta 는 정확히 "4곳"이고 null 커넥터는 글리프 줄만 남는다', async () => {
      // 준비 — b→c·c→d 구간 null(교체 뒤), a→b 2.1km·d→숙소 0.6km. 옛 스킵 규약이면 "4곳 · 2.7km".
      useItinerary(() =>
        HttpResponse.json(
          itineraryOf('PLANNED', [
            ...fourPois([null, '2.1km', null, null]),
            hotel('0.6km'),
          ])
        )
      );
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const meta = screen.getByTestId('sheet-header-meta');
      expect(meta).toHaveTextContent('4곳'); // 문자열 인자 = 완전 일치(02a §5)
      expect(meta).not.toHaveTextContent(/km|이동|분|시간|소요/);
      // 커넥터는 무변경(결정 2=A): 값 구간은 문구 칸, null 구간은 줄만.
      expect(
        screen.getByTestId(`sheet-connector-distance-${DAY1}#poi-a`)
      ).toHaveTextContent('2.1km');
      expect(
        screen.getByTestId(`sheet-connector-distance-${DAY1}#poi-d`)
      ).toHaveTextContent('0.6km');
      for (const poiId of ['poi-b', 'poi-c']) {
        expect(
          screen.getByTestId(`sheet-connector-${DAY1}#${poiId}`)
        ).toBeOnTheScreen();
        expect(
          screen.queryByTestId(`sheet-connector-distance-${DAY1}#${poiId}`)
        ).toBeNull();
      }
      expect(renderedText()).not.toMatch(/\d+\s*(분|시간)|소요/);
    });

    it('T5b-2 · 첫 슬롯(거점→첫 방문지) 거리는 헤더 합에 안 들어간다 — 커넥터 합 "4곳 · 4.1km" 그대로', async () => {
      // 준비 — 첫 슬롯에 9.9km. slice(1) 을 버리고 전 슬롯을 더하면 14.0km 가 된다.
      useItinerary(() =>
        HttpResponse.json(
          itineraryOf('PLANNED', [
            ...fourPois(['9.9km', '2.1km', '0.8km', '0.6km']),
            hotel('0.6km'),
          ])
        )
      );
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        '4곳 · 4.1km'
      );
    });
  });
});

// TRIP-1075 · 옛 ItineraryPlanPage.tripDeleted.integration.test.tsx
describe('삭제된 여행 안내', () => {
  /**
   * TRIP-1075 · 결정 2(A) — 삭제된 여행의 일정 알림을 눌러 이 화면에 오면 '일정 만들기'라는 거짓 다음
   * 행동 대신 "삭제된 여행" 안내 얼굴(`itinerary-view-trip-deleted`)과 뒤로가기만 보인다(INV-4).
   *
   * 무엇을 보장하나:
   *  - **AC-5**: `GET /trips/{id}` 404 가 판정 근거다. 실제 삭제처럼 두 조회가 모두 404여도, 캐시에 옛
   *    여행 data 가 남아 있어도, 일정 조회가 200이어도 삭제 얼굴이 이긴다. 얼굴 안엔 버튼이 없다.
   *  - **AC-6**: 삭제 얼굴의 뒤로가기는 기존 탈출구 규칙(히스토리 있으면 back, 없으면 홈 replace)이다.
   *  - **AC-7·8(무회귀)**: 여행은 있고 일정만 404면 기존 빈 얼굴 + '일정 만들기'. 여행 500·네트워크
   *    오류는 삭제가 아니다 — 기존 얼굴 그대로.
   *
   * 얼굴은 훅 목이 아니라 실 HTTP(msw)로 강제한다 — 훅을 목하면 얼굴 판정이 테스트의 가정이 된다.
   * 모든 단언은 두 조회가 끝나고 마지막 화면 갱신까지 커밋된 뒤에 한 번 더 본다(02a ★2).
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '22222222-2222-2222-2222-222222222222';
  const DAY1 = '2026-06-10';

  const DELETED = 'itinerary-view-trip-deleted';
  const NOT_FOUND = 'itinerary-view-notfound';
  const FAILED = 'itinerary-view-failed';
  const CREATE_CTA = 'itinerary-plan-create-cta';
  const BACK = 'itinerary-view-back';
  const SHELL = 'map-sheet-shell-root';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '부산 여행',
      startDate: DAY1,
      endDate: '2026-06-11',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function plannedItinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  type Reply = () => Response;
  const notFound: Reply = () => new HttpResponse(null, { status: 404 });
  const serverError: Reply = () => new HttpResponse(null, { status: 500 });
  const networkError: Reply = () => HttpResponse.error();
  const tripOk: Reply = () => HttpResponse.json(trip());
  const itineraryOk: Reply = () => HttpResponse.json(plannedItinerary());

  /** 두 조회의 응답을 케이스마다 정한다. */
  function reply(tripReply: Reply, itineraryReply: Reply): void {
    server.use(
      http.get(`${BASE}/trips/:tripId`, tripReply),
      http.get(`${BASE}/trips/:tripId/itinerary`, itineraryReply)
    );
  }

  beforeEach(() => {
    mockBack.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockClear();
    mockCanGoBack.mockReturnValue(true);
    setAccessToken('valid-access');
  });

  afterEach(async () => {
    // 테스트 격리 — 인플라이트 조회 취소 + 캐시 비우기(늦게 도착한 응답이 다음 테스트로 새지 않게).
    await activeClient?.cancelQueries();
    activeClient?.clear();
    activeClient = null;
    server.resetHandlers();
    clearAccessToken();
  });

  let activeClient: QueryClient | null = null;

  /**
   * `retry:false` — 실패를 즉시 실패로(앱 전역 `retryUnlessNotFound` 도 404 는 재시도 안 한다, 02a ★5).
   * `gcTime:0` — 기본 타이머가 프로세스를 붙잡지 않게.
   * `seed` — 렌더 **직전 같은 틱**에 캐시를 채운다(gcTime:0 이라 틱을 넘기면 지워진다, 02a ★3).
   */
  function renderPage(seed?: (client: QueryClient) => void): QueryClient {
    activeClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const client = activeClient;
    seed?.(client);
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
    return client;
  }

  /** 두 조회가 다 끝나고 마지막 화면 갱신까지 커밋될 때까지 기다린다 — 그 뒤 단언이 최종 얼굴이다. */
  async function settle(client: QueryClient): Promise<void> {
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await flushNotifications();
  }

  /** 삭제 얼굴의 최종 모습 — 버튼 0개 · 비공백 글자 2줄 이상 · 다른 얼굴·CTA 없음 · 앱바 뒤로가기 있음. */
  function expectDeletedFace(): void {
    const face = screen.getByTestId(DELETED);
    expect(screen.getByTestId(BACK)).toBeOnTheScreen();
    // 어떤 액션 버튼도 없다(testID 하나가 아니라 역할로 — 02a ★7).
    expect(within(face).queryAllByRole('button')).toEqual([]);
    // 문구는 정본이 없어 비공백만 잠근다(Seed Q3).
    const lines = face
      .findAll((node) => (node.type as unknown) === 'Text')
      .map((node) => [node.props.children].flat().join('').trim())
      .filter((text) => text.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId(CREATE_CTA)).toBeNull();
    expect(screen.queryByTestId(NOT_FOUND)).toBeNull();
    expect(screen.queryByTestId(FAILED)).toBeNull();
    expect(screen.queryByTestId(SHELL)).toBeNull();
  }

  describe('🔴 D1 · AC-5 — 여행·일정 둘 다 404(실제 삭제)면 삭제 얼굴이다', () => {
    it('일정 404 가 이기던 빈 얼굴·일정 만들기 대신 삭제 얼굴과 뒤로가기만 보인다', async () => {
      // 준비 — 소프트 삭제된 여행: 두 조회 모두 404(02a ★1).
      reply(notFound, notFound);

      // 실행.
      const client = renderPage();
      await screen.findByTestId(DELETED);
      await settle(client);

      // 단언 — 두 조회가 끝난 뒤에도 삭제 얼굴이다(깜빡임 뒤 notFound 로 뒤집히지 않음, 02a ★2).
      expectDeletedFace();
    });
  });

  describe('🔴 D2 · AC-5 — 캐시에 옛 여행 data 가 남아 있어도 조회 오류 404 가 근거다', () => {
    it('선적재된 셸이 먼저 뜨고, 재조회가 둘 다 404 로 끝나면 data 가 남은 채로도 삭제 얼굴이다', async () => {
      // 준비 — 같은 세션에서 전에 연 여행·일정 캐시(삭제는 목록만 무효화한다) + 재조회는 둘 다 404.
      reply(notFound, notFound);

      // 실행 — 캐시를 채운 채 렌더.
      const client = renderPage((c) => {
        c.setQueryData(getGetTripsTripIdQueryKey(TRIP_ID), trip());
        c.setQueryData(
          getGetTripsTripIdItineraryQueryKey(TRIP_ID),
          plannedItinerary()
        );
      });

      // 앵커 — 선적재가 실제로 먹혀 첫 화면은 옛 data 의 셸이다(시나리오 성립 증거).
      expect(screen.getByTestId(SHELL)).toBeOnTheScreen();

      await screen.findByTestId(DELETED);
      await settle(client);

      // 단언 — 최종 얼굴은 삭제 얼굴.
      expectDeletedFace();
      // 자가증명 — 여행 data 는 여전히 캐시에 있다(= "data 없으면 삭제" 판정은 이 경로를 놓친다, 02a ★3).
      expect(client.getQueryData(getGetTripsTripIdQueryKey(TRIP_ID))).toEqual(
        trip()
      );
    });
  });

  describe('🔴 D3 · AC-5 — 판정 근거는 여행 404 하나다(일정 조회가 200 이어도)', () => {
    it('여행 404 · 일정 200 이면 실패 얼굴이 아니라 삭제 얼굴이다', async () => {
      // 준비 — 여행만 404(D1 과 짝, 02a ★1).
      reply(notFound, itineraryOk);

      // 실행.
      const client = renderPage();
      await screen.findByTestId(DELETED);
      await settle(client);

      // 단언.
      expectDeletedFace();
    });
  });

  describe('🔴 D4 · AC-6 — 삭제 얼굴 뒤로가기는 기존 탈출구 규칙이다', () => {
    it('히스토리가 있으면 router.back() 한 번(홈 replace 아님)', async () => {
      // 준비 — 삭제 얼굴 + 히스토리 있음.
      reply(notFound, notFound);
      const client = renderPage();
      await screen.findByTestId(DELETED);
      await settle(client);

      // 실행.
      fireEvent.press(screen.getByTestId(BACK));

      // 단언.
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('히스토리가 없으면(딥링크·알림 진입) 홈(/(tabs))으로 replace 한다', async () => {
      // 준비 — 삭제 얼굴 + 히스토리 없음.
      reply(notFound, notFound);
      mockCanGoBack.mockReturnValue(false);
      const client = renderPage();
      await screen.findByTestId(DELETED);
      await settle(client);

      // 실행.
      fireEvent.press(screen.getByTestId(BACK));

      // 단언 — 침묵 무동작도, back+replace 이중 호출도 아니다.
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('🟢 D5 · AC-7 무회귀 — 여행은 있고 일정만 404 면 기존 빈 얼굴 + 일정 만들기', () => {
    it('여행 200 · 일정 404 면 notFound 얼굴과 create-cta 가 있고 삭제 얼굴은 없다', async () => {
      // 준비.
      reply(tripOk, notFound);

      // 실행.
      const client = renderPage();
      await screen.findByTestId(NOT_FOUND);
      await settle(client);

      // 단언.
      expect(screen.getByTestId(NOT_FOUND)).toBeOnTheScreen();
      expect(screen.getByTestId(CREATE_CTA)).toBeOnTheScreen();
      expect(screen.queryByTestId(DELETED)).toBeNull();
    });
  });

  describe('🟢 D6 · AC-8 무회귀 — 404 만 삭제다(여행 500·네트워크 오류는 삭제가 아니다)', () => {
    it.each([
      ['여행 500 · 일정 200', serverError, itineraryOk, FAILED],
      ['여행 500 · 일정 500', serverError, serverError, FAILED],
      ['여행 네트워크 오류 · 일정 200', networkError, itineraryOk, FAILED],
      ['여행 500 · 일정 404', serverError, notFound, NOT_FOUND],
    ])(
      '%s → 기존 얼굴 그대로, 삭제 얼굴 없음',
      async (_label, tripReply, itineraryReply, expectedFace) => {
        // 준비.
        reply(tripReply, itineraryReply);

        // 실행.
        const client = renderPage();
        await screen.findByTestId(expectedFace);
        await settle(client);

        // 단언 — 기존 우선순위(notFound > failed) 그대로이고 삭제로 단정하지 않는다(02a ★4).
        expect(screen.getByTestId(expectedFace)).toBeOnTheScreen();
        expect(screen.queryByTestId(DELETED)).toBeNull();
      }
    );
  });
});

// TRIP-1094 · 옛 ItineraryPlanPage.unplaced.integration.test.tsx — 요청 관찰자(server.events)는 이 describe beforeAll 에 남는다.
describe('넣지 못한 꼭 갈 곳 블록', () => {
  /**
   * TRIP-1094 · h14 완성(PLANNED)·h16 확정(CONFIRMED) 셸이 "넣지 못한 꼭 갈 곳"을 시트 맨 위 블록으로
   * 말하는지 실 HTTP 로 태운다. 두 얼굴은 같은 listed 셸 하나라 이 파일이 둘 다 잰다.
   *
   * 무엇을 보장하나:
   *  - 🔴 블록이 헤더 뒤·첫 카드 앞에 서고(확정 실패 안내가 있으면 그 뒤), 항목마다 담은 장소 이름 + 서버
   *    문구, 이름을 못 찾으면 문구만 보인다(AC-1·2·3 · Q5).
   *  - 🔴 미배치는 여행 전체 단위라 일차 탭을 바꿔도 같은 블록이 남는다(AC-1).
   *  - 🔴 담은 장소 조회가 실패해도 문구는 남는다(AC-3 · INV-4). 미배치 0건이면 조회 0회(AC-13).
   *
   * 기존 ItineraryPlanPage.* 11파일은 건드리지 않으려고 새 파일로 뒀다(다른 레인이 같은 페이지를 만진다).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+칩·CTA press) → 단언=testID·글자·요청 수.
   */

  // 옛 파일은 [공유하기] 게이트를 false 로 고정했다 — 스위치를 켠다(TRIP-1151 합치기).
  beforeEach(() => {
    mockShareArmed.value = false;
  });
  const BASE = 'http://localhost:8080/api/v1';
  const SAVED_PATH = '/api/v1/saved-places';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
  const WAIT = { timeout: 4000 };

  const BLOCK = 'itinerary-unplaced-mustvisit';
  const ITEM_PREFIX = /^itinerary-unplaced-mustvisit-/;
  const CONFIRM_ERROR = 'itinerary-confirm-error';

  const MSG_NO_SLOT =
    '남은 시간과 이동을 고려하면 넣을 자리가 없었어요. 시각 고정을 풀거나 일정을 줄여 보세요.';
  const MSG_WINDOW =
    '다른 필수 방문지와 시간이 겹쳐 넣지 못했어요. 한쪽 시각을 옮겨 주세요.';
  const DURATION_TEXT = /\d+\s*(분|시간)|소요/;

  const UNPLACED: ItineraryUnplacedMustVisitsItem[] = [
    { poiId: 'poi-mv-1', reasonCode: 'NO_FEASIBLE_SLOT', message: MSG_NO_SLOT },
    { poiId: 'poi-mv-2', reasonCode: 'WINDOW_CONFLICT', message: MSG_WINDOW },
  ];
  const NAME_1 = '해동용궁사';

  const itemId = (poiId: string): string => `${BLOCK}-${poiId}`;
  const cardId = (date: string, poiId: string): string =>
    `slot-stopcard-${buildSlotKey(date, poiId)}`;

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '부산 여행',
      startDate: DAY1,
      endDate: DAY2,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 2,
    };
  }

  function slot(poiId: string, startAt: string): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt,
      endAt: startAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: `장소-${poiId}`,
      category: '자연',
      distanceRange: null,
      lat: 35.15,
      lng: 129.11,
    };
  }

  function itinerary(input: {
    status?: ItineraryStatus;
    unplaced?: ItineraryUnplacedMustVisitsItem[];
  }): Itinerary {
    return {
      itineraryId: 'itin-1094',
      tripId: TRIP_ID,
      status: input.status ?? 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [
        {
          date: DAY1,
          slots: [slot('poi-a', '10:00:00'), slot('poi-b', '13:00:00')],
        },
        { date: DAY2, slots: [slot('poi-c', '10:00:00')] },
      ],
      ...(input.unplaced === undefined
        ? {}
        : { unplacedMustVisits: input.unplaced }),
    };
  }

  function savedPlace(poiId: string, nameKo: string): SavedPlace {
    return {
      savedPlaceId: `sp-${poiId}`,
      savedAt: '2026-08-01T10:00:00.000Z',
      place: {
        poiId,
        nameKo,
        category: '명소',
        lat: 35.15,
        lng: 129.11,
        tags: [],
        savedCount: 0,
        dataStatus: 'ACTIVE',
      },
    };
  }

  let itineraryScript: () => Itinerary;
  let savedScript: () => Response;
  let observed: { method: string; url: string }[] = [];

  function savedHits(): number {
    return observed.filter(
      (hit) => hit.method === 'GET' && new URL(hit.url).pathname === SAVED_PATH
    ).length;
  }

  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      observed.push({ method: request.method, url: request.url });
    });
  });

  // 모듈 전역 상태(연타 가드 창)는 파일 최상위에서 닫는다 — describe 안에만 걸면 앞 테스트 창이 샌다(02a ★12).
  beforeEach(() => {
    resetPressGuard();
    observed = [];
    setAccessToken('valid-access');
    savedScript = () => HttpResponse.json([savedPlace('poi-mv-1', NAME_1)]);
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryScript())
      ),
      http.get(`${BASE}/saved-places`, () => savedScript()),
      http.post(
        `${BASE}/trips/:tripId/itinerary/confirm`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
  });

  afterEach(() => {
    resetPressGuard();
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage(): { client: QueryClient } {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
    return { client };
  }

  function treeOrder(ids: string[]): string[] {
    const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return screen
      .getAllByTestId(new RegExp(`^(${escaped.join('|')})$`))
      .map((node) => String(node.props.testID));
  }

  function itemIds(): string[] {
    return within(screen.getByTestId(BLOCK))
      .queryAllByTestId(ITEM_PREFIX)
      .map((node) => String(node.props.testID));
  }

  async function settle(
    client: QueryClient,
    savedCount: number
  ): Promise<void> {
    await waitFor(() => {
      expect(savedHits()).toBe(savedCount);
      expect(client.isFetching()).toBe(0);
    }, WAIT);
  }

  /** 이름 해소된 1번 + 문구만인 2번 — 한 화면에서 두 얼굴을 함께 잰다. */
  async function expectNamedAndUnnamed(): Promise<void> {
    expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
    const first = screen.getByTestId(itemId('poi-mv-1'));
    expect(await within(first).findByText(NAME_1, {}, WAIT)).toBeOnTheScreen();
    expect(first).toHaveTextContent(`${NAME_1}${MSG_NO_SLOT}`);
    expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(
      MSG_WINDOW
    );
  }

  describe('🔴 L1 · AC-1·2·3·11·13 · Q5 — h14 완성 셸 시트 맨 위에 블록이 선다', () => {
    it('헤더 뒤·첫 카드 앞 · CTA 밖 · 이름 있음/없음 · 소요시간 0 · 담은 장소 1회 조회', async () => {
      itineraryScript = () => itinerary({ unplaced: UNPLACED });

      const { client } = renderPage();

      const block = await screen.findByTestId(BLOCK, {}, WAIT);
      expect(
        within(screen.getByTestId('map-sheet-shell-root')).getByTestId(BLOCK)
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('sheet-cta-root')).queryByTestId(BLOCK)
      ).toBeNull();
      await expectNamedAndUnnamed();

      expect(
        treeOrder(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')])
      ).toEqual(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')]);
      expect(block).not.toHaveTextContent(DURATION_TEXT);

      await settle(client, 1);
    });
  });

  describe('🔴 L2 · AC-1 — 미배치는 여행 전체 단위라 일차 탭을 바꿔도 블록이 그대로다', () => {
    it('2일차 칩을 누르면 2일차 카드가 보이고 블록·항목 2 가 남는다', async () => {
      itineraryScript = () => itinerary({ unplaced: UNPLACED });

      renderPage();
      await screen.findByTestId(BLOCK, {}, WAIT);

      fireEvent.press(screen.getByTestId('sheet-daychip-1'));

      expect(
        await screen.findByTestId(cardId(DAY2, 'poi-c'), {}, WAIT)
      ).toBeOnTheScreen();
      expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
      expect(
        treeOrder(['sheet-header-root', BLOCK, cardId(DAY2, 'poi-c')])
      ).toEqual(['sheet-header-root', BLOCK, cardId(DAY2, 'poi-c')]);
    });
  });

  describe('🔴 L3 · AC-1 — h16 확정 셸에도 같은 블록이 선다', () => {
    it('CONFIRMED → meta 「확정됨 · 」 앵커 · 블록 항목 2 · 헤더 뒤·첫 카드 앞', async () => {
      itineraryScript = () =>
        itinerary({ status: 'CONFIRMED', unplaced: UNPLACED });

      renderPage();

      // 확정 얼굴 착지 앵커(confirmed 테스트 ★2 선례).
      await waitFor(
        () =>
          expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
            /^확정됨 · /
          ),
        WAIT
      );
      expect(await screen.findByTestId(BLOCK, {}, WAIT)).toBeOnTheScreen();
      await expectNamedAndUnnamed();
      expect(
        treeOrder(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')])
      ).toEqual(['sheet-header-root', BLOCK, cardId(DAY1, 'poi-a')]);
    });
  });

  describe('🔴 L4 · AC-3 · INV-4 — 담은 장소 조회가 실패해도 서버 문구는 남는다', () => {
    it('/saved-places 500 → 조회가 끝난 뒤에도 두 항목이 문구만 보인다', async () => {
      itineraryScript = () => itinerary({ unplaced: UNPLACED });
      savedScript = () => new HttpResponse(null, { status: 500 });

      const { client } = renderPage();
      await screen.findByTestId(BLOCK, {}, WAIT);
      await settle(client, 1);

      expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
      expect(screen.getByTestId(itemId('poi-mv-1'))).toHaveTextContent(
        MSG_NO_SLOT
      );
      expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(
        MSG_WINDOW
      );
      expect(screen.queryByText('이름을 불러오지 못한 곳')).toBeNull();
    });
  });

  // 5-b 참고 R1 — 두 페이지에 같은 조회 조건이 복사돼 있어 한쪽만 로그인 조건을 잃어도 조용히 샌다.
  // 초안(D4)과 같은 심판을 이 페이지에도 건다: 준비 = 토큰 없음 + 미배치 2건 → 실행 = 화면 열기 →
  // 단언 = /saved-places 0회 · 두 항목이 문구만으로 보인다.
  describe('🔴 L4b · Q4 — 게스트는 담은 장소를 조회하지 않고, 문구는 그대로 보인다', () => {
    it('토큰 없음 → /saved-places 0회 · 두 항목 문구만', async () => {
      clearAccessToken();
      itineraryScript = () => itinerary({ unplaced: UNPLACED });

      const { client } = renderPage();
      await screen.findByTestId(BLOCK, {}, WAIT);
      await settle(client, 0);

      expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
      expect(screen.getByTestId(itemId('poi-mv-1'))).toHaveTextContent(
        MSG_NO_SLOT
      );
      expect(screen.queryByText(NAME_1)).toBeNull();
    });
  });

  describe('L5 · AC-7·AC-13 — 미배치가 0건이면 블록도, 담은 장소 조회도 없다 (선제 green 트립와이어)', () => {
    it.each([
      ['빈 배열', [] as ItineraryUnplacedMustVisitsItem[]],
      ['필드 없음', undefined],
    ])('%s → 블록 0 · /saved-places 0회', async (_label, unplaced) => {
      itineraryScript = () => itinerary({ unplaced });

      const { client } = renderPage();

      expect(
        await screen.findByTestId(cardId(DAY1, 'poi-a'), {}, WAIT)
      ).toBeOnTheScreen();
      await settle(client, 0);

      expect(screen.queryByTestId(BLOCK)).toBeNull();
    });
  });

  describe('🔴 L6 · Q5 — 확정 실패 안내가 뜨면 블록은 그 뒤·첫 카드 앞이다', () => {
    it('「일정 저장하기」 → POST 500 → 확정 실패 안내 → 블록 → 첫 카드', async () => {
      itineraryScript = () => itinerary({ unplaced: UNPLACED });

      renderPage();
      await screen.findByTestId(BLOCK, {}, WAIT);

      fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

      expect(
        await screen.findByTestId(CONFIRM_ERROR, {}, WAIT)
      ).toBeOnTheScreen();
      expect(treeOrder([CONFIRM_ERROR, BLOCK, cardId(DAY1, 'poi-a')])).toEqual([
        CONFIRM_ERROR,
        BLOCK,
        cardId(DAY1, 'poi-a'),
      ]);
    });
  });
});

// TRIP-1008 · 옛 ItineraryPlanPage.violation.integration.test.tsx
describe('위반 슬롯 경고 표식', () => {
  /**
   * TRIP-1008 · C1~C3 — h14 완성(PLANNED)·h16 확정(CONFIRMED) 일정의 위반 슬롯 카드에 경고 표식이 뜬다
   * (D6 · BR-U3-13 지속 가시화). 표식 문구는 서버 사유와 무관한 **고정 라벨**이다(02c) — 서버 사유 원문에
   * "이동 54분 필요" 같은 소요시간이 섞여 오므로, 원문을 그리면 INV-3(소요시간 비표시)이 이 화면으로 번진다.
   * FE 는 원문을 파싱해 거르지 않는다(D5) — 아예 그리지 않는다.
   *
   * ★ 모드가 아니라 데이터가 정한다(Q3) — 같은 단언을 PLANNED·CONFIRMED 두 행이 받는다. 휴관 경고
   *   (`warning`)처럼 `isConfirmed` 로 게이트하면 PLANNED 행이 red 다.
   *
   * 3동작 뼈대: 준비=가짜 서버(status 행별) → 실행=렌더·셸 도착 대기 → 단언=카드 안 표식 텍스트·개수.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';

  const RAW_RANGE = /\d{3,4}~\d{3,4}/;
  /** 소요시간 탐지기 — 리포 INV-3 스캐너들과 같은 식(`DraftScreen.test.tsx` 등). */
  const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;
  /** 서버 사유 — HC2(소요시간 섞임) · HC1(원시 분 범위)을 ` · ` 로 이은 실제 결합 형태. */
  const MIXED_REASON = '이동 54분 필요, 간격 -60분 · 영업시간 밖: 543~618';
  const VIOLATION_LABEL = '일정 확인이 필요해요';
  const k = (poiId: string): string => buildSlotKey(DAY1, poiId);

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function slot(
    poiId: string,
    over: Partial<ItineraryDaysItemSlotsItem> = {}
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt: '09:30:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      ...over,
    };
  }

  /** 1일·2슬롯 — `poi-a` 위반(사유는 행이 정함), `poi-b` 위반 없음. */
  function itinerary(
    status: ItineraryStatus,
    reason: string | null
  ): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [
        {
          date: DAY1,
          slots: [
            slot('poi-a', { hasViolation: true, violationReason: reason }),
            slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
          ],
        },
      ],
    };
  }

  let itineraryScript: () => Itinerary;

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockClear();
    mockCanGoBack.mockReturnValue(true);
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryScript())
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  describe('🔴 C1·C2 · h14/h16 — 위반 슬롯 카드에만 고정 라벨 표식, 사유 원문·소요시간 0건 (확정 여부 무관 · Q3 · INV-3)', () => {
    it.each<[string, ItineraryStatus]>([
      ['h14 완성(PLANNED)', 'PLANNED'],
      ['h16 확정(CONFIRMED)', 'CONFIRMED'],
    ])(
      '%s — poi-a 카드 안 "일정 확인이 필요해요", 전체 1개, 소요시간·사유 원문·원시 분 범위 0건',
      async (_label, status) => {
        itineraryScript = () => itinerary(status, MIXED_REASON);

        renderPage();
        await screen.findByTestId('map-sheet-shell-root');

        const cardA = screen.getByTestId(`slot-stopcard-${k('poi-a')}`);
        expect(
          within(cardA).getByTestId(`slot-stopcard-violation-${k('poi-a')}`)
        ).toHaveTextContent(VIOLATION_LABEL);
        // C2 — 위반 없는 poi-b 카드는 떠 있지만 표식은 없다(전체 1개).
        const cardB = screen.getByTestId(`slot-stopcard-${k('poi-b')}`);
        expect(
          within(cardB).queryAllByTestId(/^slot-stopcard-violation-/).length
        ).toBe(0);
        expect(
          screen.queryAllByTestId(/^slot-stopcard-violation-/).length
        ).toBe(1);
        // INV-3 — 위 긍정 짝(표식이 카드 안에 있다)이 선 뒤라 이 0건은 빈 화면 공짜 통과가 아니다.
        expect(screen.queryAllByText(DURATION_TEXT).length).toBe(0);
        expect(screen.queryAllByText(/영업시간 밖/).length).toBe(0);
        expect(screen.queryAllByText(RAW_RANGE).length).toBe(0);
      }
    );
  });

  describe('🔴 C3 · h14 — 사유가 없어도 같은 고정 라벨이다 (사유 유무로 문구가 갈리지 않는다 · 02c)', () => {
    it('hasViolation=true · violationReason=null → 표식 "일정 확인이 필요해요"', async () => {
      itineraryScript = () => itinerary('PLANNED', null);

      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(
        screen.getByTestId(`slot-stopcard-violation-${k('poi-a')}`)
      ).toHaveTextContent(VIOLATION_LABEL);
    });
  });
});
