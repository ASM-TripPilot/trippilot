import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import fc from 'fast-check';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '@/shared/api/tokenManager';
import { guardPress, resetPressGuard } from '@/shared/lib/pressGuard';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import {
  BASE,
  makePreference,
  makeTrip,
  TRIP,
  TRIP_ID,
  wizardStep1Harness,
} from '@/test-support/wizardStep1Harness';
import { server } from '@/mocks/server';
import type {
  CompanionType,
  PreferenceView,
  Trip,
  Place,
  SavedPlace,
  MustVisit,
} from '@/shared/api/index.schemas';
import { seedMustVisits, useTripWizardStore } from '@/features/create-trip';
import { regionPickerHref } from '@/features/explore';
import type { MustVisitSeedItem } from '@/features/create-trip';
import { useGetTrips } from '@/shared/api/index.hooks';

/**
 * TRIP-1149 — g01 여행 만들기 1/4 페이지 통합 테스트(실 HTTP·MSW). 옛 12파일을 하나로 합쳤다.
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 단언은 옛 그대로이고, 각 describe 위
 * 머리말이 그 옛 파일의 머리말(TRIP 번호 포함)이다.
 *
 * 파일 전체가 공유하는 것(jest.mock 은 파일 맨 위로 끌어올려져 describe 마다 다르게 걸 수 없다):
 *  - expo-router 목 = 옛 `.leave` 의 라우터 객체(push·back·replace·canGoBack + `router` export). 다른
 *    11개 옛 목을 모두 포함한다. ⚠️ 그 11개 옛 목에는 `canGoBack` 이 없어 부르면 TypeError 로 red 였다
 *    → 그 describe 들은 `afterEach(expectNoExitWizard)` 로 "canGoBack 0회"를 명시해 그 그물을 옮겼다.
 *  - MSW 서버는 최상위 beforeAll 이 한 번 켠다. 요청 관찰자·배열은 describe 마다 따로 두고 끝나면 뗀다.
 *  - 로그인 상태(tokenManager 모듈 전역): `꼭 갈 곳 자동 시드 폐지` describe 만 로그인으로 돈다.
 *    나머지는 게스트이고 `/saved-places` 핸들러가 없다(onUnhandledRequest:'error') — 최상위 afterEach 의
 *    clearAccessToken 이 토큰이 새는 것을 막는다.
 *  - 모듈 싱글턴(위저드 스토어·누름 가드·토스트)은 최상위 훅이 매 테스트 되돌린다.
 */

// jest.mock 팩토리는 호이스트돼 바깥 변수를 못 본다 — `mock` 접두만 예외. 단 팩토리는 import 시점(아래
// `const mockRouter` 초기화 전)에 평가되므로 `router` export 는 `undefined` 다(실측). `useRouter()` 는 호출
// 시점에 `mockRouter` 를 읽어 살아 있으니, 구현은 `useRouter()` 만 써야 같은 jest.fn 에 기록된다(옛 `.leave` 목).
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockRouter = {
  push: mockPush,
  back: mockBack,
  replace: mockReplace,
  canGoBack: mockCanGoBack,
};

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useNavigation: require('@/test-support/preventRemoveMock').useNavigation,
}));

// TRIP-1272 — 페이지가 뒤로 가로채기(`usePreventRemove`)를 건다. 실물은 네비게이터 밖에서 throw 하므로 그려지기만 하게
// 대역으로 바꾼다(가로채기 동작은 `src/__tests__/tripWizardLeaveSwipe.integration.test.tsx` 몫).
jest.mock('@react-navigation/native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/preventRemoveMock')
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  // "아직 없다" 앵커 — 로그인은 그 describe 의 beforeEach 만 켠다. 토큰이 앞 describe 에서 새면 여기서 red
  // (게스트 describe 가 `/saved-places` 를 불러도 미처리 요청은 단언을 깨지 않아 그 자체로는 조용하다).
  expect(getAccessToken()).toBeNull();
  [mockPush, mockBack, mockReplace].forEach((fn) => fn.mockReset());
  mockCanGoBack.mockReset();
  mockCanGoBack.mockImplementation(() => true);
  resetPressGuard();
});

afterEach(() => {
  clearAccessToken();
  resetToast();
  useTripWizardStore.getState().reset();
  server.resetHandlers();
});

afterAll(() => server.close());

/** 옛 목에 `canGoBack` 이 없던 describe 의 그물 — 위저드 나가기(exitWizard)가 불리지 않았다. */
function expectNoExitWizard(): void {
  expect(mockCanGoBack).not.toHaveBeenCalled();
}

/**
 * TRIP-665 g01 default 재작성 — **제출·예외 배선 보존**(실 HTTP 심판).
 *
 * 무엇을 보장하나: 신 default 에서도 제출 계약이 그대로다.
 *  - 정상 제출이 `POST /trips` **1회**로 나가고(바디 계약대로) 201 뒤 `/trips/new/step2` 로 이동한다.
 *  - 국내 밖 400 은 다이얼로그, 네트워크·미상 실패는 배너로 드러나고 입력이 남는다(INV-4).
 *  - 제출 중 두 번째 press 가 두 번째 요청을 만들지 않는다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청과 그 횟수"다(msw 만 관찰). 뮤테이션을 쓰므로 실
 * QueryClientProvider 필요.
 *
 * 왜 재작성인가: 옛 테스트는 인라인 시트·프리셋을 눌러 드래프트를 만들었다. 신 default 엔 그 컨트롤이
 * 없어(편집은 S2~S6 스텁), 드래프트를 **스토어 선상태로 주입**한다. canProceed 는 스토어 선상태에서만 참이
 * 될 수 있다(맹점①). 인라인 오류 표면(I-2/I-3)·달력 파생(I-9)은 대응물이 사라져 삭제했다(02a §3).
 *
 * ⚠️ 게스트(토큰 없음)로 돈다 — 담은목록 조회가 `enabled:isAuthed` 라 안 나가고 `savedPlacesLoading`
 * (=isAuthed && isPending)이 false 라 게이트를 막지 않는다(01b 비회원 예외). 그래서 /saved-places 핸들러가
 * 필요 없다. `/regions`·`/saved-stays` 핸들러도 따로 안 준다 — 다만 통합 버킷의 기본 핸들러(`mocks/handlers.ts`)가
 * 응답하므로 이 생략은 신 페이지가 그 훅을 드롭했음을 강제하지 않는다(02a ★9 의 옛 전제는 낡았다).
 *
 * ⚠️ 매처 함정(02a §5-2): `toHaveTextContent('문자열')` 완전 일치, 부분은 정규식/`within(x).getByText`.
 */
describe('제출·예외 배선 (I-1~I-7)', () => {
  afterEach(expectNoExitWizard);

  const {
    tracker,
    preferenceHandler,
    createTripHandler,
    renderPage,
    next,
    seedValidDraft,
    waitForPrefill,
  } = wizardStep1Harness();

  function createHits(): number {
    return tracker.hits.filter((hit) => hit === 'POST /api/v1/trips').length;
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    useTripWizardStore.getState().reset();

    server.use(preferenceHandler(), createTripHandler());
  });

  afterEach(() => {
    server.resetHandlers();
  });

  describe('I-1 · 정상 제출이 계약대로 나가고 step2 로 이동한다', () => {
    it('[다음]을 누르면 POST /trips 가 정확히 1회 나가고 201 뒤 이동한다', async () => {
      seedValidDraft();
      renderPage();
      await waitForPrefill();

      expect(createHits()).toBe(0);
      expect(next()).toBeEnabled();

      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      expect(tracker.postedBodies).toHaveLength(1);
      expect(tracker.postedBodies[0]).toMatchObject({
        startDate: '2026-06-10',
        endDate: '2026-06-13',
        party: 1,
        destinations: [{ seq: 1, region: '부산', nights: 3 }],
      });
      // 예산 입력 기능을 걷어냈다 — 프리필 취향에 예산 러프값(800000)이 있어도 키 자체를 안 보낸다.
      expect(Object.keys(tracker.postedBodies[0])).not.toContain('budgetTotal');
      // 취향 스냅숏(정책 A) — override 없이도 프리필 스냅숏이 실린다.
      expect(Object.keys(tracker.postedBodies[0])).toContain(
        'preferenceSnapshot'
      );
      expect(tracker.postedBodies[0].preferenceSnapshot).toMatchObject({
        styles: ['미식', '전시'],
        activities: ['야경'],
      });

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
      );
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });

  describe('I-1d · 0박(당일치기)은 거점 숙소 단계를 건너뛰고 방식 선택으로 간다', () => {
    it('도시 하나 0박 + 같은 날 기간 → POST 1회(nights 0·start==end) 뒤 방식 선택(h04)으로 가고 step2 는 안 간다', async () => {
      // 준비 — 부산 0박, 기간 6/10~6/10(당일). 묵는 밤이 없어 거점 숙소를 고를 이유가 없다.
      const store = useTripWizardStore.getState();
      store.addDestination('부산', 0);
      store.setPeriod(undefined, '2026-06-10', '2026-06-10');
      renderPage();
      await waitForPrefill();
      expect(next()).toBeEnabled();

      // 실행
      fireEvent.press(next());

      // 단언 — 서버엔 0박 그대로 나가고, 이동은 방식 선택 하나(step2 push 0건).
      await waitFor(() => expect(createHits()).toBe(1));
      expect(tracker.postedBodies[0]).toMatchObject({
        startDate: '2026-06-10',
        endDate: '2026-06-10',
        destinations: [{ seq: 1, region: '부산', nights: 0 }],
      });
      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith({
          pathname: '/trips/[tripId]/itinerary/method',
          params: { tripId: '11111111-1111-1111-1111-111111111111' },
        })
      );
      expect(mockPush).not.toHaveBeenCalledWith('/trips/new/step2');
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });

  describe('I-1c · TRIP-1045 동행을 안 건드리고 제출해도 companionType 혼자가 실린다', () => {
    it('동행 시트를 한 번도 안 열고 [다음]을 누르면 바디에 companionType "혼자"·party 1 이 있다', async () => {
      // 준비 — 여행지·기간만 채운다(동행은 기본값 그대로).
      seedValidDraft();
      renderPage();
      await waitForPrefill();

      // 실행
      fireEvent.press(next());

      // 단언 — CompanionType enum 계약값(혼자·친구·연인·가족)이 그대로 나간다.
      await waitFor(() => expect(createHits()).toBe(1));
      expect(tracker.postedBodies[0]).toMatchObject({
        companionType: '혼자',
        party: 1,
      });
    });
  });

  describe('I-4 · 국내 밖 400 은 다이얼로그로 뜨고 드래프트가 남는다', () => {
    it('국내 차단 안내가 뜨고 요약 여행지 행이 그대로 남으며 이동하지 않는다', async () => {
      // 'OVERSEAS_DESTINATION' 은 발명값(openapi enum 부재) — 상수 import 로 비교하면 동어반복이라 직접 박는다.
      server.use(
        http.post(`${BASE}/trips`, () =>
          HttpResponse.json(
            { error: { code: 'OVERSEAS_DESTINATION', message: 'outside KR' } },
            { status: 400 }
          )
        )
      );

      seedValidDraft();
      renderPage();
      await waitForPrefill();
      fireEvent.press(next());

      const dialog = await screen.findByTestId('trip-wizard-overseas-dialog');
      expect(
        within(dialog).getByText('지금은 국내 여행만 지원해요')
      ).toBeOnTheScreen();
      // 배너와 이중으로 뜨지 않는다.
      expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
      // 드래프트가 그대로다 — 요약 여행지 행이 살아 있다.
      expect(
        screen.getByTestId('trip-wizard-summary-destination')
        // 2톤 분리(TRIP-732): main "부산"·sub "3박"이 별 Text 라 연결 텍스트는 "부산3박"(공백은 레이아웃 gap).
      ).toHaveTextContent(/부산.*3박/);
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('I-5 · 네트워크 실패는 배너로 드러나고 다시 시도가 재요청한다 (INV-4)', () => {
    it('배너가 뜨고, 다시 시도가 실제로 요청 수를 늘린다', async () => {
      // 응답 자체가 없는 실패 — axios 에러에 response 가 아예 없다(상태코드 분기가 미끄러지는 자리).
      server.use(http.post(`${BASE}/trips`, () => HttpResponse.error()));

      seedValidDraft();
      renderPage();
      await waitForPrefill();
      fireEvent.press(next());

      const banner = await screen.findByTestId('trip-wizard-submit-banner');
      // TRIP-734 §F ⓐ — 배너 출현 확인용 카피(고정 단일 줄). 서버 실패→배너 배선·재시도 사정거리는 무변경.
      expect(within(banner).getByText('저장하지 못했어요')).toBeOnTheScreen();
      expect(mockPush).not.toHaveBeenCalled();

      const before = createHits();
      expect(before).toBe(1);
      fireEvent.press(
        within(banner).getByTestId('trip-wizard-submit-banner-retry')
      );
      await waitFor(() => expect(createHits()).toBe(before + 1));
    });
  });

  describe('I-7 · 미상 실패도 조용히 삼키지 않는다 (INV-4)', () => {
    it('처음 보는 error.code 가 와도 배너로 떨어지고, 국내 차단으로 오인하지 않는다', async () => {
      server.use(
        http.post(`${BASE}/trips`, () =>
          HttpResponse.json(
            {
              error: {
                code: 'SOMETHING_WE_NEVER_SAW',
                message: 'unmapped',
                fields: [{ field: 'zzz', reason: 'nope' }],
              },
            },
            { status: 400 }
          )
        )
      );

      seedValidDraft();
      renderPage();
      await waitForPrefill();
      fireEvent.press(next());

      const banner = await screen.findByTestId('trip-wizard-submit-banner');
      // TRIP-734 §F ⓐ — 미상 실패도 같은 고정 카피 배너로 떨어진다(국내 차단 오인 아님).
      expect(within(banner).getByText('저장하지 못했어요')).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('I-6 · 제출 중 두 번째 press 는 두 번째 요청을 만들지 않는다', () => {
    it('응답이 오기 전 다시 눌러도 요청은 1건이고, 풀리면 정상 완주한다', async () => {
      let release: () => void = () => {};
      let createStarted = false;
      server.use(
        http.post(`${BASE}/trips`, async ({ request }) => {
          tracker.postedBodies.push(
            (await request.json()) as Record<string, unknown>
          );
          await new Promise<void>((resolve) => {
            release = resolve;
            createStarted = true;
          });
          return HttpResponse.json(TRIP, { status: 201 });
        })
      );

      seedValidDraft();
      renderPage();
      await waitForPrefill();

      fireEvent.press(next());
      await waitFor(() => expect(createStarted).toBe(true));
      expect(createHits()).toBe(1);

      // 아직 응답이 안 온 상태에서 한 번 더 누른다.
      fireEvent.press(next());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(createHits()).toBe(1);
      expect(tracker.postedBodies).toHaveLength(1);

      await act(async () => {
        release();
      });
      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
      );
      expect(createHits()).toBe(1);
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * TRIP-665 g01 default 재작성 — **자동 시드 폐지 + 등록 파이프라인 부재**(실 HTTP 심판, 보존).
 *
 * 무엇을 보장하나: 담은 곳(하트) 자동 시드는 폐지됐다(사용자 결정) — `GET /saved-places` 는 (담은목록 게이트
 * 때문에) 여전히 나가지만 "꼭 갈 곳" 스트립은 자동으로 채워지지 않고, 제출해도 `POST /trips/{id}/must-visits`
 * 등록 요청이 **한 건도 안 나간다**. 이 두 성질은 훅을 목하면 가정으로 전락하므로 실 HTTP 로 태운다.
 *
 * 왜 재작성인가: 옛 스트립은 담은 곳을 자동 시드해 썸네일로 보여줬다(옛 I-1 이 `-mustvisit-poi-1` 셋을 봄).
 * 신 스트립은 `mustVisits`(스토어) 만 그리고 자동 시드 경로가 없어 항상 카드 0장이다 — 옛 empty 얼굴·캡션
 * 단언을 신 스트립(카드 0장)으로 교체한다.
 *
 * ⚠️ /regions·/saved-stays 핸들러는 따로 안 준다 — 기본 핸들러(`mocks/handlers.ts`)가 응답하므로 이 생략은 그 훅의 드롭을 강제하지 않는다.
 *
 * 로그인 상태는 이 describe 의 beforeEach(setAccessToken)·afterEach(clearAccessToken)에만 있다.
 */
describe('꼭 갈 곳 자동 시드 폐지 (로그인)', () => {
  afterEach(expectNoExitWizard);

  const { tracker, renderPage, next, seedValidDraft } = wizardStep1Harness();

  function makePlace(poiId: string, nameKo: string): Place {
    return {
      poiId,
      nameKo,
      category: '명소',
      lat: 35.1587,
      lng: 129.1604,
      region: '수영구',
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    };
  }

  function savedPlace(poiId: string, nameKo: string): SavedPlace {
    return {
      savedPlaceId: `sp-${poiId}`,
      savedAt: '2026-08-01T10:00:00.000Z',
      place: makePlace(poiId, nameKo),
    };
  }

  const THREE: SavedPlace[] = [
    savedPlace('poi-1', '감천마을'),
    savedPlace('poi-2', '광안리'),
    savedPlace('poi-3', '전포'),
  ];

  /** ⚠️ 완전 일치로 센다 — must-visits 경로가 생성 경로를 접두로 포함하므로 부분 일치로 세면 섞인다. */
  function createHits(): number {
    return tracker.hits.filter((hit) => hit === 'POST /api/v1/trips').length;
  }
  function mustVisitHits(): number {
    return tracker.hits.filter((hit) => hit.endsWith('/must-visits')).length;
  }
  function savedPlaceGetHits(): number {
    return tracker.hits.filter((hit) => hit === 'GET /api/v1/saved-places')
      .length;
  }

  beforeEach(() => {
    mockPush.mockClear();
    useTripWizardStore.getState().reset();
    // 담은목록 조회는 enabled:isAuthed — 토큰이 있어야 나간다.
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/saved-places`, () => HttpResponse.json(THREE)),
      http.post(`${BASE}/trips`, () =>
        HttpResponse.json(TRIP, { status: 201 })
      ),
      // must-visits 핸들러는 **호출되면 안 되는** 것을 확인하는 용도로만 건다(등록 파이프라인 폐지).
      http.post(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json({}, { status: 201 })
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  describe('I-1 · 조회는 나가지만 "꼭 갈 곳"은 자동으로 안 채워진다', () => {
    it('담은 곳 3건이 있어도 스트립 카드는 0장이고, GET /saved-places 는 나간다', async () => {
      renderPage();

      // GET 은 게이트 때문에 여전히 나간다(자동 시드와 무관).
      await waitFor(() => expect(savedPlaceGetHits()).toBe(1));

      // ★ 예전엔 여기서 썸네일이 셋 다 떴다 — 자동 시드가 폐지돼 이제 담은 곳이 몇이든 카드 0장이다.
      expect(
        screen.getByTestId('trip-wizard-mustvisit-block')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-wizard-mustvisit-poi-1')).toBeNull();
      expect(
        screen.queryAllByTestId(/^trip-wizard-mustvisit-poi-/)
      ).toHaveLength(0);
    });
  });

  describe('I-2 · 제출해도 must-visits 등록 자체가 안 나간다', () => {
    it('POST /trips 1건만 나가고 must-visits 는 0건, step2 로 이동한다', async () => {
      seedValidDraft();
      renderPage();

      // 담은목록 게이트가 열릴 때까지 기다린다(GET 도착 → savedPlacesLoading false).
      await waitFor(() => expect(next()).toBeEnabled());

      fireEvent.press(next());

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
      );
      expect(createHits()).toBe(1);
      // ★ 옛 계약(남은 시드를 ANYTIME 으로 등록)은 폐지됐다 — 시드를 채우는 경로가 없어 등록이 안 나간다.
      expect(mustVisitHits()).toBe(0);
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * TRIP-666 g01 여행지 편집 시트 — **배선 승인 테스트**(요약 행 → 시트 오픈 → 콜백 → 스토어/라우트).
 *
 * 무엇을 보장하나: S1 이 남긴 요약 행 오픈 콜백(현 `openEditSheet` 스텁)에 이 시트가 배선돼
 *  ① 여행지 행 탭 → 시트 마운트(트리 존재) ② 스테퍼 → `setNights` 로 **즉시** 스토어 반영(로컬
 *  드래프트 아님, 01b D3) ③ "도시 추가" → `router.push('/explore/region?purpose=trip')`
 *  ④ 삭제× → `removeDestination(seq)` ⑤ "적용" → 닫기(스토어 재커밋 없음).
 *
 * 왜 통합 버킷인가: 심판 대상이 "페이지가 시트 콜백을 무엇에 배선했나"다 — 스토어 실반영과 실제
 * router 인자를 관측해야 한다. 스토어 뮤테이션·router 목이 필요.
 *
 * ⚠️ 게스트(토큰 미주입)로 돈다 — `useSavedPlaces`/`useSavedStays` 가 `enabled:false` 라 안 나가고
 * (01b 비회원 예외), 무조건 발화하는 `useGetMePreferences`(프리필)만 `/me/preferences` 핸들러로 받는다.
 * `/regions`·`/saved-stays`·`/saved-places` 핸들러는 **일부러 안 준다**(남기면 신 페이지가 그 훅을
 * 게스트에서 물었다는 증거로 `onUnhandledRequest:'error'` 크래시 red). 제출을 안 하므로 POST /trips 불필요.
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 을 무조건 렌더한다 — 여기서 관측하는 "시트 오픈"은
 * **조건부 마운트 트리 존재/부재**뿐이다. 실제 슬라이드업·딤·중앙정렬·터치차단은 jest 사각(6-b 실기).
 */
describe('여행지 편집 시트 (W-1~W-6)', () => {
  afterEach(expectNoExitWizard);

  const { preferenceHandler, renderPage, openSheet } = wizardStep1Harness();

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    useTripWizardStore.getState().reset();
    // 두 도시를 담아 시트가 그릴 행을 만든다(부산 2박·경주 1박).
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().addDestination('경주', 1);

    server.use(preferenceHandler({ styles: { value: ['미식'] } }));
  });

  afterEach(() => {
    server.resetHandlers();
  });

  describe('W-1 · 여행지 행 탭이 시트를 연다', () => {
    it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
      renderPage();
      // 아직 안 눌렀다 — 조건부 마운트라 트리에 없다.
      expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();

      fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));

      expect(
        await screen.findByTestId('trip-wizard-destination-sheet')
      ).toBeOnTheScreen();
    });
  });

  describe('W-2 · 스테퍼가 setNights 로 즉시 반영된다 (01b D3)', () => {
    it('+ 를 누른 그 순간(적용 전) 스토어 박수가 바뀐다 = 로컬 드래프트가 아니다', async () => {
      renderPage();
      await openSheet('destination');

      fireEvent.press(
        screen.getByTestId('trip-wizard-destination-nights-inc-1')
      );
      await waitFor(() =>
        expect(useTripWizardStore.getState().destinations[0].nights).toBe(3)
      );

      fireEvent.press(
        screen.getByTestId('trip-wizard-destination-nights-dec-1')
      );
      await waitFor(() =>
        expect(useTripWizardStore.getState().destinations[0].nights).toBe(2)
      );
    });
  });

  describe('W-3 · 도시 추가가 explore/region 라우트를 연다 (AC-3)', () => {
    // TRIP-1210 — 도시 하나 제한을 걷었다(옛 계약: 도시가 있으면 이동 대신 "준비 중" 안내). 이 describe 는
    // 부산·경주 두 도시가 담긴 채 시작한다 — 그래도 도시 추가는 지역 피커로 간다.
    // TRIP-1353 — 옛 3 it(두 곳 담김 · 리터럴 철자 · `regionPickerHref` 같은 출처)은 모두 같은 `push(regionPickerHref('trip'))` 를
    // 봤다. 한 it 로 합친다: 뮤테이션(리터럴을 다른 철자로·도시가 있으면 이동 대신 안내·도시가 0곳이면 이동 안 함)이 각각 red.
    // TRIP-985 5-b 참고-1 — 리터럴은 "지금 철자"를, `regionPickerHref` 는 "피커가 위저드로 알아듣는 철자와 같은 출처"를 잠근다.
    // 헬퍼 유니온에서 'trip' 이름이 바뀌면 인자가 먼저 `pnpm tsc` 에서 걸린다.
    it('도시 추가는 도시가 두 곳이든 0곳이든 지역 피커(regionPickerHref("trip"))로 이동하고 준비 중 안내는 없다', async () => {
      renderPage();
      await openSheet('destination');
      expect(useTripWizardStore.getState().destinations).toHaveLength(2);

      fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

      await waitFor(() =>
        expect(mockPush.mock.calls).toEqual([[regionPickerHref('trip')]])
      );
      expect(mockPush).toHaveBeenCalledWith('/explore/region?purpose=trip');
      expect(
        screen.queryByTestId('trip-wizard-destination-one-city-notice')
      ).toBeNull();

      // 짝 — 도시가 0곳이 돼도 같은 곳으로 간다.
      mockPush.mockClear();
      act(() => {
        useTripWizardStore.setState({ destinations: [] });
      });
      fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

      await waitFor(() =>
        expect(mockPush.mock.calls).toEqual([[regionPickerHref('trip')]])
      );
    });
  });

  describe('W-4 · 삭제× 가 removeDestination(seq) 로 배선된다 (AC-4/5)', () => {
    it('경주(seq 2) 삭제 → 부산만 남고 seq 가 다시 1..N 으로 매겨진다', async () => {
      renderPage();
      await openSheet('destination');

      fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-2'));

      await waitFor(() =>
        expect(useTripWizardStore.getState().destinations).toEqual([
          { seq: 1, region: '부산', nights: 2 },
        ])
      );
    });
  });

  // TRIP-1499 AC-9 — 삭제로 같은 도시가 이웃해지면 스토어가 합친다(단위 R1~). 시트는 합쳐진 목록을 그리기만 한다.
  describe('W-6 · 삭제× 로 같은 도시가 이웃해지면 시트에도 한 행으로 보인다 (TRIP-1499)', () => {
    it('부산 2박·제주 1박·부산 1박에서 제주를 지우면 부산 한 줄(3박)만 남고 두·세 번째 줄은 없다', async () => {
      // 준비 — beforeEach 가 담은 부산·경주를 비우고 왕복 동선을 담는다.
      useTripWizardStore.getState().reset();
      useTripWizardStore.getState().addDestination('부산', 2);
      useTripWizardStore.getState().addDestination('제주시', 1);
      useTripWizardStore.getState().addDestination('부산', 1);
      renderPage();
      await openSheet('destination');
      // 앵커 — 지우기 전에는 세 줄이다(실행을 지워도 green 이 되는 것을 막는다).
      expect(
        screen.getByTestId('trip-wizard-destination-row-3')
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-2'));

      await waitFor(() =>
        expect(screen.queryByTestId('trip-wizard-destination-row-3')).toBeNull()
      );
      expect(screen.queryByTestId('trip-wizard-destination-row-2')).toBeNull();
      const row1 = screen.getByTestId('trip-wizard-destination-row-1');
      expect(within(row1).getByText('부산')).toBeOnTheScreen();
      expect(within(row1).getByText('3박')).toBeOnTheScreen();
      expect(useTripWizardStore.getState().destinations).toEqual([
        { seq: 1, region: '부산', nights: 3 },
      ]);
    });
  });

  describe('W-5 · 적용은 닫기뿐 — 스토어를 더 안 건드린다 (01b D3·AC-4)', () => {
    it('적용 press 가 시트를 닫고, destinations 는 적용 직전 스냅숏 그대로다', async () => {
      renderPage();
      await openSheet('destination');

      // 스냅숏 — 즉시반영이라 이 시점 값이 곧 최종값이다(적용은 커밋이 아니다).
      const snapshot = useTripWizardStore.getState().destinations;

      fireEvent.press(screen.getByTestId('trip-wizard-destination-apply'));

      // 닫힘(조건부 마운트 해제)
      await waitFor(() =>
        expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull()
      );
      // 스토어 불변 — "적용=커밋" 구현이면 여기서 값이 달라져 red.
      expect(useTripWizardStore.getState().destinations).toEqual(snapshot);
    });
  });
});

/**
 * TRIP-667 g01 기간 편집 시트 — **배선 승인 테스트**(요약 "기간" 행 → 시트 오픈 → 시작 탭 → 적용 → 스토어).
 * TRIP-1027 로 시트는 **시작 날짜만** 고른다 — 끝 날짜는 시작 + 여행지 박수 합이다(01b D2).
 *
 * 무엇을 보장하나:
 *  ① 기간 행 탭 → 시트 마운트(트리 존재)
 *  ② 날짜 탭 한 번 → 배선이 range 를 {시작, 시작 + Σ} 로 갱신해 재렌더 → 시작·사이·끝 표식이 실제로 바뀐다
 *     (무상태 시트라 이 전이는 여기서만 관측된다). 두 번째 탭도 새 시작이다(끝을 고르지 않는다)
 *  ③ "적용" **누르기 전엔** 스토어 기간 불변, 누르면 시작·파생 끝 커밋 + 닫힘
 *  ④ 제출 바디의 endDate − startDate = 박수 합(AC-9)
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "셀 탭→표식 변화"는 배선이 range 를 소유·갱신할 때만
 * 일어난다 — 스토어 실반영과 전이를 함께 관측해야 한다. 컴포넌트 단위(표식 렌더·콜백)는 별 파일이 잠근다.
 *
 * ⚠️ 게스트(토큰 미주입)로 돈다 — `useSavedPlaces`/`useSavedStays` 가 `enabled:false` 라 안 나가고
 * (01b 비회원 예외), 무조건 발화하는 `useGetMePreferences`(프리필)만 `/me/preferences` 핸들러로 받는다.
 * `/regions`·`/saved-stays`·`/saved-places` 핸들러는 **일부러 안 준다**(남기면 신 페이지가 그 훅을
 * 게스트에서 물었다는 증거로 `onUnhandledRequest:'error'` 크래시 red). POST /trips 는 W-5 만 자기 안에서 준다.
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 을 무조건 렌더한다 — 여기서 관측하는 "시트 오픈"은
 * **조건부 마운트 트리 존재/부재**뿐이다. 실제 슬라이드업·딤·범위 하이라이트 실렌더는 jest 사각(6-b 실기).
 *
 * ⚠️ 모듈 싱글턴 스토어 — 파일 최상위 beforeEach·afterEach 에서 reset 한다(02a ★11).
 */
describe('기간 편집 시트 (W-1~W-5)', () => {
  afterEach(expectNoExitWizard);

  // 결정론적 today 주입 — 6/1 이라 6월 전 칸이 활성이다(과거 없음).
  const { preferenceHandler, renderPage, openSheet } = wizardStep1Harness({
    baseDate: '2026-06-01',
  });

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    useTripWizardStore.getState().reset();

    server.use(preferenceHandler({ styles: { value: ['미식'] } }));
  });

  afterEach(() => {
    server.resetHandlers();
    useTripWizardStore.getState().reset();
  });

  describe('W-1 · 기간 행 탭이 시트를 연다', () => {
    it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
      renderPage();
      // 아직 안 눌렀다 — 조건부 마운트라 트리에 없다.
      expect(screen.queryByTestId('trip-wizard-period-sheet')).toBeNull();

      fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));

      expect(
        await screen.findByTestId('trip-wizard-period-sheet')
      ).toBeOnTheScreen();
    });
  });

  /** 시작 날짜만 고른다(TRIP-1027) — 끝 표식은 시작 + 박수 합에 뜬다. */
  function seedDestinations(nights: number[]): void {
    const store = useTripWizardStore.getState();
    const names = ['서울특별시', '부산광역시', '경주시'];
    nights.forEach((n, i) => store.addDestination(names[i], n));
  }

  function mark(role: 'start' | 'between' | 'end', date: string) {
    return screen.queryByTestId(`trip-wizard-period-cell-${role}-${date}`);
  }

  describe('W-2 · 날짜 탭 한 번 = 새 시작, 끝 표식은 시작 + 박수 합 (TRIP-1027 AC-5)', () => {
    it('서울1·부산2(3박)에서 6/10 탭 → 6/10–6/13, 범위 안 6/12 탭 → 새 시작 6/12–6/15, 6/20 탭 → 6/20–6/23', async () => {
      // 준비 — 박수 합 3.
      seedDestinations([1, 2]);
      renderPage();
      await openSheet('period');

      // 실행 ① — 6/10 한 번. 끝(6/13)을 누르지 않아도 범위가 완성돼 그려진다.
      fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
      expect(
        await screen.findByTestId('trip-wizard-period-cell-start-2026-06-10')
      ).toBeOnTheScreen();
      expect(mark('between', '2026-06-11')).toBeOnTheScreen();
      expect(mark('between', '2026-06-12')).toBeOnTheScreen();
      expect(mark('end', '2026-06-13')).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-period-summary')
      ).toHaveTextContent(/6월 10일.*13일/);

      // 실행 ② — 파생 범위 안쪽 뒤 날짜(6/12). 옛 2탭 규칙이면 "끝 = 6/12 완성"이었다(02a ★8).
      fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-12'));
      expect(
        await screen.findByTestId('trip-wizard-period-cell-start-2026-06-12')
      ).toBeOnTheScreen();
      expect(mark('end', '2026-06-15')).toBeOnTheScreen();
      expect(mark('end', '2026-06-12')).toBeNull();
      expect(mark('end', '2026-06-13')).toBeNull();
      expect(mark('start', '2026-06-10')).toBeNull();

      // 실행 ③ — 먼 날짜(6/20)도 새 시작.
      fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-20'));
      expect(
        await screen.findByTestId('trip-wizard-period-cell-start-2026-06-20')
      ).toBeOnTheScreen();
      expect(mark('end', '2026-06-23')).toBeOnTheScreen();
      await waitFor(() => expect(mark('end', '2026-06-15')).toBeNull());
    });
  });

  describe('W-3 · 한 번 탭하면 적용이 열리고, 적용 = 시작·파생 끝 커밋 + 닫기 (TRIP-1027 AC-5)', () => {
    it('탭 전엔 적용이 닫혀 있고, 6/10 한 번 탭하면 열리며, 적용하면 6/10–6/13 이 커밋된다', async () => {
      seedDestinations([1, 2]);
      renderPage();
      await openSheet('period');
      const apply = () => screen.getByTestId('trip-wizard-period-apply');

      // 앵커 — 아직 아무것도 안 골랐다(02a ★7).
      expect(apply()).toBeDisabled();

      fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
      await screen.findByTestId('trip-wizard-period-cell-start-2026-06-10');
      expect(apply()).toBeEnabled();

      // 적용 전 — 아직 커밋 안 됨.
      expect(useTripWizardStore.getState().startDate).toBeUndefined();
      expect(useTripWizardStore.getState().endDate).toBeUndefined();

      fireEvent.press(apply());

      await waitFor(() =>
        expect(useTripWizardStore.getState().startDate).toBe('2026-06-10')
      );
      expect(useTripWizardStore.getState().endDate).toBe('2026-06-13');
      expect(useTripWizardStore.getState().presetCode).toBeUndefined();
      await waitFor(() =>
        expect(screen.queryByTestId('trip-wizard-period-sheet')).toBeNull()
      );
    });
  });

  describe('W-4 · 여행지 0곳이면 당일 — 끝 원 없이 시작만, 적용하면 시작 = 끝 (TRIP-1027 AC-2)', () => {
    it('6/10 탭 → 시작 표식만(끝·사이 없음) · 적용 열림 → 커밋 6/10–6/10', async () => {
      expect(useTripWizardStore.getState().destinations).toHaveLength(0);
      renderPage();
      await openSheet('period');

      fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));

      expect(
        await screen.findByTestId('trip-wizard-period-cell-start-2026-06-10')
      ).toBeOnTheScreen();
      expect(mark('end', '2026-06-10')).toBeNull();
      expect(mark('between', '2026-06-11')).toBeNull();
      expect(screen.getByTestId('trip-wizard-period-apply')).toBeEnabled();

      fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));

      await waitFor(() =>
        expect(useTripWizardStore.getState().startDate).toBe('2026-06-10')
      );
      expect(useTripWizardStore.getState().endDate).toBe('2026-06-10');
    });
  });

  /** openapi `Trip.required` 필드를 채운 201 응답(제출 배선 형제 파일 선례). */
  const CREATED_TRIP: Trip = {
    tripId: '11111111-1111-1111-1111-111111111111',
    title: '서울 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 1,
    companionType: null,
    budgetTotal: 800000,
    preferenceSnapshot: {},
    destinations: [
      { seq: 1, region: '서울특별시', nights: 1 },
      { seq: 2, region: '부산광역시', nights: 2 },
    ],
    status: 'PLANNED',
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };

  describe('W-5 · 제출 바디의 기간은 시작 + 박수 합이다 (TRIP-1027 AC-9)', () => {
    it('6/10 적용 → 부산 +1 → 다음: POST /trips 1회, startDate 6/10 · endDate 6/13 · 박수 [1, 2]', async () => {
      // 준비 — 이 테스트만 제출 핸들러를 더한다.
      const postedBodies: Record<string, unknown>[] = [];
      server.use(
        http.post(`${BASE}/trips`, async ({ request }) => {
          postedBodies.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(CREATED_TRIP, { status: 201 });
        })
      );
      seedDestinations([1, 1]);
      renderPage();
      await openSheet('period');
      fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
      fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));
      fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));
      fireEvent.press(
        await screen.findByTestId('trip-wizard-destination-nights-inc-2')
      );
      fireEvent.press(screen.getByTestId('trip-wizard-destination-apply'));

      // 실행 — 프리필 도착(로딩 해제) 뒤 다음.
      const next = screen.getByTestId('trip-wizard-step1-next');
      await waitFor(() => expect(next).toBeEnabled());
      fireEvent.press(next);

      // 단언 — 요청 모양은 그대로, 끝 날짜만 파생값이다.
      await waitFor(() => expect(postedBodies).toHaveLength(1));
      const body = postedBodies[0] as {
        startDate: string;
        endDate: string;
        destinations: { seq: number; region: string; nights: number }[];
      };
      expect(body.startDate).toBe('2026-06-10');
      expect(body.endDate).toBe('2026-06-13');
      expect(body.destinations.map((one) => one.nights)).toEqual([1, 2]);
      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
      );
    });
  });
});

/**
 * TRIP-668 g01 동행 편집 시트 — **배선 승인 테스트**(요약 "동행" 행 → 시트 오픈 → 드래프트 전이 → 적용 → 스토어).
 *
 * 무엇을 보장하나: S1 이 남긴 동행 행 오픈 콜백(현 `openEditSheet` 스텁)에 이 시트가 배선돼
 *  ① 동행 행 탭 → 시트 마운트(트리 존재) ② 스테퍼·칩 탭 → 배선이 드래프트를 전이시켜 재렌더(값·표식 변화,
 *  무상태 시트라 이 전이는 여기서만 관측된다) ③ **적용 누르기 전엔 스토어 불변**, 누르면 `setParty`+
 *  `selectCompanion` 각 1회 커밋 + 닫힘(★ 드래프트 계약). ④ 혼자 선택 시 배선이 draftParty 를 1 로 고정.
 *  ⑤ 시트를 열면 드래프트가 스토어 현재값에서 초기화된다(D3 프리필).
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "탭→값/표식 변화"는 배선이 드래프트를 소유·갱신할 때만
 * 일어난다 — 스토어 실반영과 전이를 함께 관측해야 한다. 컴포넌트 단위(표식·콜백)는 별 파일이 잠근다.
 *
 * ⚠️ 회원(토큰 목 주입)으로 돈다 — 제출을 안 하고 요약 행만 여는지라 S3 harness 를 계승한다. 무조건 발화하는
 * `useGetMePreferences`(프리필)만 `/me/preferences` 핸들러로 받는다. `/regions`·`/saved-*` 핸들러는 **일부러 안
 * 준다**(남기면 신 배선이 그 훅을 물었다는 증거로 `onUnhandledRequest:'error'` 크래시 red). 제출 안 함 → POST /trips 불필요.
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 을 무조건 렌더한다 — 여기서 관측하는 "시트 오픈"은 **조건부
 * 마운트 트리 존재/부재**뿐이다. 실제 슬라이드업·딤·터치 차단은 jest 사각(6-b 실기).
 */
describe('동행 편집 시트 (C-1~C-6)', () => {
  afterEach(expectNoExitWizard);

  const { preferenceHandler, renderPage, openSheet, waitForPrefill } =
    wizardStep1Harness({
      baseDate: '2026-06-01',
    });

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    useTripWizardStore.getState().reset();

    server.use(preferenceHandler({ styles: { value: ['미식'] } }));
  });

  afterEach(() => {
    server.resetHandlers();
  });

  describe('C-1 · 동행 행 탭이 시트를 연다', () => {
    it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
      renderPage();
      expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull();

      fireEvent.press(screen.getByTestId('trip-wizard-summary-companion'));

      expect(
        await screen.findByTestId('trip-wizard-companion-sheet')
      ).toBeOnTheScreen();
    });
  });

  describe('C-2 · ★ 드래프트 계약 — 적용 전 store 불변, 적용에서만 커밋', () => {
    it('스테퍼·칩 전이는 store 를 안 건드리고, 적용에서만 setParty·selectCompanion 이 반영된다', async () => {
      renderPage();
      await openSheet('companion');

      // 친구 칩 먼저 → 활성 표식 전이. store companionType 은 아직 기본값 '혼자'.
      // (TRIP-1045: 드래프트가 '혼자'로 열려 스테퍼가 잠겨 있으므로 칩을 먼저 바꿔야 + 가 먹는다.)
      fireEvent.press(screen.getByTestId('trip-wizard-companion-chip-friend'));
      expect(
        await screen.findByTestId('trip-wizard-companion-chip-active-friend')
      ).toBeOnTheScreen();
      // TRIP-1423 — 친구는 2명 이상이라 칩을 고르는 순간 드래프트가 "2명"이 된다. store 는 아직 party 1.
      expect(screen.getByText('2명')).toBeOnTheScreen();
      expect(useTripWizardStore.getState().party).toBe(1);

      // 인원 + → 드래프트 값 전이("3명"). store 는 아직 party 1.
      fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
      expect(screen.getByText('3명')).toBeOnTheScreen();

      // 적용 전 — 즉시반영이 아니라 드래프트다(즉시커밋 뮤턴트가 이 둘로 red).
      expect(useTripWizardStore.getState().party).toBe(1);
      expect(useTripWizardStore.getState().companionType).toBe('혼자');

      // 적용 → 커밋(각 1회 반영) + 닫힘.
      fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));

      await waitFor(() => expect(useTripWizardStore.getState().party).toBe(3));
      expect(useTripWizardStore.getState().companionType).toBe('친구');
      await waitFor(() =>
        expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull()
      );
    });
  });

  describe('C-3 · ★ 혼자 → 배선이 draftParty 1 고정 + 커밋', () => {
    it('인원을 올린 뒤 혼자를 고르면 값이 1명으로 고정·스테퍼 비활성, 적용하면 party 1 커밋', async () => {
      renderPage();
      await openSheet('companion');

      // 기본 '혼자'로 열려 스테퍼가 잠겨 있다(TRIP-1045) — 친구로 풀면 "2명"(TRIP-1423), + 두 번 → "4명".
      fireEvent.press(screen.getByTestId('trip-wizard-companion-chip-friend'));
      expect(screen.getByText('2명')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
      fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
      expect(screen.getByText('4명')).toBeOnTheScreen();

      // 혼자 선택 → 배선이 draftParty 를 1 로 고정("1명") + 스테퍼 진짜 disabled.
      fireEvent.press(screen.getByTestId('trip-wizard-companion-chip-alone'));
      expect(await screen.findByText('1명')).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-companion-party-dec')
      ).toBeDisabled();
      expect(
        screen.getByTestId('trip-wizard-companion-party-inc')
      ).toBeDisabled();

      // 적용 → party 1 커밋(배선이 고정을 안 하면 4 가 남아 red).
      fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));
      await waitFor(() => expect(useTripWizardStore.getState().party).toBe(1));
      expect(useTripWizardStore.getState().companionType).toBe('혼자');
    });
  });

  describe('C-4 · D3 프리필 — 시트를 열면 드래프트가 store 현재값에서 초기화된다', () => {
    it('store party 3·가족 상태에서 열면 값 "3명" + 가족 활성 표식으로 시작한다', async () => {
      renderPage();

      // 시트 열기 전 store 를 선상태로 만든다.
      useTripWizardStore.getState().setParty(3);
      useTripWizardStore.getState().selectCompanion('가족');

      await openSheet('companion');

      // 프리필이 store 를 안 읽으면 "1명"·활성표식 없음으로 red.
      expect(screen.getByText('3명')).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-companion-chip-active-family')
      ).toBeOnTheScreen();
    });
  });

  describe('C-5 · TRIP-1045 기본 혼자 — 빈 드래프트로 열면 혼자 활성 + 스테퍼 잠김', () => {
    it('아무것도 안 고른 채 시트를 열면 혼자 칩이 켜져 있고, 인원은 1명에서 안 움직인다', async () => {
      // 준비 — beforeEach reset() = 새 드래프트.
      renderPage();

      // 실행
      await openSheet('companion');

      // 단언 — 기본값이 시트 드래프트(D3 프리필)까지 흐른다.
      expect(
        screen.getByTestId('trip-wizard-companion-chip-active-alone')
      ).toBeOnTheScreen();
      expect(screen.getByText('1명')).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-companion-party-dec')
      ).toBeDisabled();
      expect(
        screen.getByTestId('trip-wizard-companion-party-inc')
      ).toBeDisabled();
      // toBeDisabled 는 accessibilityState 만 본다 — press 가 실제로 안 먹는지 짝으로 확인.
      fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
      expect(screen.getByText('1명')).toBeOnTheScreen();
      expect(screen.queryByText('2명')).toBeNull();
    });
  });

  /**
   * TRIP-1423 (Q-059) — 칩을 고르는 순간 인원이 유형에 맞춰진다: 혼자 1 · 연인 2 고정, 친구·가족 2명 이상.
   * 값을 맞추는 것은 배선(`pickCompanion`), −·+ 를 잠그는 것은 시트(disabled 파생)다 — 두 층을 실제 칩 누름으로 함께 탄다.
   */
  describe('C-6 · TRIP-1423 동행 유형에 인원이 맞춰진다', () => {
    const DEC = 'trip-wizard-companion-party-dec';
    const INC = 'trip-wizard-companion-party-inc';
    const chip = (code: string) => `trip-wizard-companion-chip-${code}`;

    it('C-6a · 혼자에서 연인을 고르면 2명 · −·+ 잠김, 적용하면 store 연인 2 · 요약 "연인 2명"', async () => {
      renderPage();
      await openSheet('companion');

      fireEvent.press(screen.getByTestId(chip('partner')));

      expect(screen.getByText('2명')).toBeOnTheScreen();
      expect(screen.getByTestId(DEC)).toBeDisabled();
      expect(screen.getByTestId(INC)).toBeDisabled();
      // 진짜 disabled — + 를 눌러도 3명이 안 된다.
      fireEvent.press(screen.getByTestId(INC));
      expect(screen.queryByText('3명')).toBeNull();

      fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));

      await waitFor(() =>
        expect(useTripWizardStore.getState().companionType).toBe('연인')
      );
      expect(useTripWizardStore.getState().party).toBe(2);
      expect(
        within(screen.getByTestId('trip-wizard-summary-companion')).getByText(
          '연인 2명'
        )
      ).toBeOnTheScreen();
    });

    it('C-6b · 연인 2명에서 친구를 고르면 2명 그대로 · − 잠김 · + 살아 있음, + 로 3명이 되면 − 가 풀린다', async () => {
      renderPage();
      useTripWizardStore.getState().setParty(2);
      useTripWizardStore.getState().selectCompanion('연인');
      await openSheet('companion');

      fireEvent.press(screen.getByTestId(chip('friend')));

      expect(
        await screen.findByTestId('trip-wizard-companion-chip-active-friend')
      ).toBeOnTheScreen();
      expect(screen.getByText('2명')).toBeOnTheScreen();
      expect(screen.getByTestId(DEC)).toBeDisabled();
      expect(screen.getByTestId(INC)).not.toBeDisabled();

      fireEvent.press(screen.getByTestId(INC));

      expect(screen.getByText('3명')).toBeOnTheScreen();
      expect(screen.getByTestId(DEC)).not.toBeDisabled();

      fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));
      await waitFor(() => expect(useTripWizardStore.getState().party).toBe(3));
      expect(useTripWizardStore.getState().companionType).toBe('친구');
    });

    it.each([
      ['가족 4명 → 연인 (위에서도 2로 맞춘다)', '가족', 4, 'partner', '연인'],
      ['혼자 1명 → 가족 (아래에서 2로 올린다)', '혼자', 1, 'family', '가족'],
    ] as [string, CompanionType, number, string, CompanionType][])(
      'C-6c · %s — 칩을 고르면 2명, 적용하면 store 2',
      async (_label, fromType, fromParty, toCode, toType) => {
        renderPage();
        useTripWizardStore.getState().setParty(fromParty);
        useTripWizardStore.getState().selectCompanion(fromType);
        await openSheet('companion');

        fireEvent.press(screen.getByTestId(chip(toCode)));

        expect(screen.getByText('2명')).toBeOnTheScreen();
        fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));
        await waitFor(() =>
          expect(useTripWizardStore.getState().companionType).toBe(toType)
        );
        expect(useTripWizardStore.getState().party).toBe(2);
      }
    );

    /**
     * > *(개념)* **속성 테스트** — 무작위로 만든 누름 순서를 여러 번 돌려, 매번 [적용] 뒤 store 가 규칙을 지키는지 본다.
     * 페이지는 한 번만 그린다(회마다 그리면 프리필 대기가 회마다 붙는다). 회마다 store 를 규칙에 맞는 시작값으로 되돌리고
     * 시트를 다시 연다 — 시트는 열 때 store 에서 드래프트를 다시 채운다(C-4).
     * 오라클은 여기 손으로 적은 규칙이다(구현의 규칙 함수를 import 하지 않는다).
     */
    it('C-6p · 칩·−·+ 를 어떤 순서로 눌러도 [적용] 뒤 store 는 "혼자 1 · 연인 2 · 친구·가족 ≥2" 를 지킨다', async () => {
      renderPage();
      await waitForPrefill();

      type Start = { type: CompanionType; party: number };
      const startArb: fc.Arbitrary<Start> = fc.oneof(
        fc.constant<Start>({ type: '혼자', party: 1 }),
        fc.constant<Start>({ type: '연인', party: 2 }),
        fc.record({
          type: fc.constantFrom<CompanionType>('친구', '가족'),
          party: fc.integer({ min: 2, max: 5 }),
        })
      );
      const pressArb = fc.constantFrom(
        chip('alone'),
        chip('friend'),
        chip('partner'),
        chip('family'),
        DEC,
        INC
      );

      function expectFits(type: CompanionType | undefined, party: number) {
        if (type === '혼자') expect(party).toBe(1);
        else if (type === '연인') expect(party).toBe(2);
        else expect(party).toBeGreaterThanOrEqual(2);
      }

      fc.assert(
        fc.property(
          startArb,
          fc.array(pressArb, { maxLength: 8 }),
          (start, presses) => {
            resetPressGuard();
            act(() => {
              const store = useTripWizardStore.getState();
              store.reset();
              store.setParty(start.party);
              store.selectCompanion(start.type);
            });

            fireEvent.press(
              screen.getByTestId('trip-wizard-summary-companion')
            );
            // 시트가 실제로 열렸다 — 안 열려서 통과하는 길을 막는다.
            expect(
              screen.getByTestId('trip-wizard-companion-sheet')
            ).toBeOnTheScreen();

            for (const testID of presses) {
              fireEvent.press(screen.getByTestId(testID));
            }
            fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));

            expect(
              screen.queryByTestId('trip-wizard-companion-sheet')
            ).toBeNull();
            const { companionType, party } = useTripWizardStore.getState();
            expectFits(companionType, party);
          }
        ),
        { numRuns: 40 }
      );
    }, 30000);
  });
});

/**
 * TRIP-669 (S5) g01 취향 편집 시트 — **배선 승인 테스트**(요약 "취향" 행 → 시트 오픈 → 드래프트 전이
 * → 적용 → 스토어 → 제출 스냅숏). 자매 시트 통합(companion/period/destinationSheet)과 동형.
 *
 * 무엇을 보장하나:
 *  - PI-1 요약 취향 행 탭 → 시트 마운트(현 `openEditSheet` no-op 스텁 대체).
 *  - PI-2 초기 선택 = 온보딩 프리필(드래프트를 effective 에서 초기화, AC-2).
 *  - PI-3 칩 탭 → 배선이 드래프트를 전이시켜 재렌더(무상태 시트라 이 전이는 여기서만 관측, AC-1).
 *  - PI-4 적용 → `setPrefStyleOverride(draft)` 커밋 + 닫힘(AC-3).
 *  - PI-5 ★ 제출 `preferenceSnapshot.styles` = effective(오버라이드), `activities` = 활동 오버라이드가
 *        없으면(undefined) 프리필 원본(TRIP-1092 01b Q1), 계정 취향(`PUT /me/preferences`) 불변(BR-U1-38).
 *  - PI-6 ★ null-vs-empty: 전해제 → 적용 → store `[]` → 제출 styles `[]`(프리필로 안 돌아감, 맹점②).
 *  - PI-7 ★ hasOverride → 요약 "+ 온보딩" 제거(D4).
 *  - PA-1~9 (TRIP-1092) 활동 칩 — 행의 모든 값이 시트 칩으로 대응(A13)·활동 축 해제/적용/제출·
 *        같은 라벨(자연·쇼핑) 1회 표기와 축 분리. TRIP-669 D5("activities 는 시트가 안 건드림")는 뒤집혔다.
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "탭→선택 변화"는 배선이 드래프트를 소유·갱신할 때만
 * 일어난다 — 스토어 실반영·제출 바디를 함께 관측해야 한다(msw). 컴포넌트 단위(선택 표식·콜백)는
 * `PrefOverrideSheet.test.tsx`가, 스토어 필드는 `tripWizardStore.prefOverride.test.ts`가 잠근다.
 *
 * ⚠️ 게스트(토큰 없음)로 돈다 — 담은목록 조회가 `enabled:isAuthed` 라 안 나가고 `savedPlacesLoading`
 * 이 false 라 게이트를 안 막는다(비회원 예외, 기존 integration 선례). 그래서 /saved-places 핸들러가
 * 필요 없다. `/regions`·`/saved-stays` 핸들러도 따로 안 준다 — 다만 통합 버킷의 기본 핸들러(`mocks/handlers.ts`)가
 * 응답하므로 이 생략은 신 배선이 그 훅을 드롭했음을 강제하지 않는다.
 *
 * ⚠️ 매처 함정(02a §5-4·§5-5): preferenceSnapshot 배열은 `toEqual`(정확 배열), 요약 부분 텍스트는
 * 정규식(`toHaveTextContent('문자열')`은 완전 일치라 부분 매칭엔 정규식/`within`).
 *
 * ⚠️ 바텀시트 통과형 목: 관측하는 "시트 오픈"은 **조건부 마운트 트리 존재/부재**뿐이다. 실제
 * 슬라이드업·딤·터치 차단은 jest 사각(6-b 실기, 자율 세션 SKIP).
 */
describe('취향 편집 시트 (PI·PA)', () => {
  afterEach(expectNoExitWizard);

  const {
    tracker,
    preferenceHandler,
    createTripHandler,
    renderPage,
    next,
    seedValidDraft,
    openSheet,
    waitForPrefill,
  } = wizardStep1Harness();

  /** 프리필 — styles 2종은 전부 7칩 안의 값(미식·자연), activities 는 야경(TRIP-1092 전엔 시트 밖 값). */
  const PREF_NATURE = makePreference({ styles: { value: ['미식', '자연'] } });

  function createHits(): number {
    return tracker.hits.filter((hit) => hit === 'POST /api/v1/trips').length;
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    useTripWizardStore.getState().reset();

    server.use(preferenceHandler(PREF_NATURE), createTripHandler());
  });

  afterEach(() => {
    server.resetHandlers();
  });

  function summaryPreferenceRow() {
    return screen.getByTestId('trip-wizard-summary-preference');
  }

  function chip(slug: string) {
    return screen.getByTestId(`trip-wizard-pref-chip-${slug}`);
  }

  describe('PI-1 · AC-5 취향 행 탭이 시트를 연다', () => {
    it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
      renderPage();
      await waitForPrefill();
      expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();

      fireEvent.press(summaryPreferenceRow());

      expect(
        await screen.findByTestId('trip-wizard-pref-sheet')
      ).toBeOnTheScreen();
    });
  });

  describe('PI-2 · AC-2 초기 선택 = 온보딩 프리필', () => {
    it('시트를 열면 프리필 styles(미식·자연) 칩만 selected 로 시작한다', async () => {
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      expect(chip('gourmet')).toBeSelected();
      expect(chip('nature')).toBeSelected();
      // 나머지는 프리필 밖 — selected 아님(드래프트를 effective 에서 초기화 안 하면 red).
      for (const slug of [
        'rest',
        'art',
        'activity',
        'sightseeing',
        'shopping',
      ]) {
        expect(chip(slug)).not.toBeSelected();
      }
    });
  });

  describe('PI-3 · AC-1 칩 탭 → 배선이 드래프트를 전이시킨다 (무상태 시트)', () => {
    it('미식 해제 → 미식만 꺼지고 자연은 남고, 문화예술 추가 → 켜진다', async () => {
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      fireEvent.press(chip('gourmet'));
      await waitFor(() => expect(chip('gourmet')).not.toBeSelected());
      expect(chip('nature')).toBeSelected();

      fireEvent.press(chip('art'));
      await waitFor(() => expect(chip('art')).toBeSelected());
    });
  });

  describe('PI-4 · ★ AC-3 적용 → setPrefStyleOverride 커밋 + 닫힘', () => {
    it('오버라이드 드래프트를 만들고 적용하면 store 에 실리고 시트가 닫힌다', async () => {
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      // 프리필(미식·자연)에서 둘 다 끄고 휴양을 켜 → 드래프트 ['휴양'].
      fireEvent.press(chip('gourmet'));
      fireEvent.press(chip('nature'));
      fireEvent.press(chip('rest'));
      await waitFor(() => expect(chip('rest')).toBeSelected());

      // 적용 전 — store 는 아직 오버라이드 없음(undefined).
      expect(useTripWizardStore.getState().prefStyleOverride).toBeUndefined();

      fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));

      await waitFor(() =>
        expect(useTripWizardStore.getState().prefStyleOverride).toEqual([
          '휴양',
        ])
      );
      await waitFor(() =>
        expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull()
      );
    });
  });

  describe('PI-4b · 재오픈 — 고친 취향(styleOverride)부터 보인다', () => {
    it('적용해 닫은 뒤 다시 열면 프리필이 아니라 오버라이드 칩이 selected 로 시작한다', async () => {
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      // 프리필(미식·자연)에서 둘 다 끄고 휴양을 켜 → 적용 → 닫힘.
      fireEvent.press(chip('gourmet'));
      fireEvent.press(chip('nature'));
      fireEvent.press(chip('rest'));
      await waitFor(() => expect(chip('rest')).toBeSelected());
      fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));
      await waitFor(() =>
        expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull()
      );

      await openSheet('preference');

      // `styleOverride ?? prefillStyles` 에서 오버라이드 우선이 빠지면 미식·자연이 다시 켜진다.
      expect(chip('rest')).toBeSelected();
      expect(chip('gourmet')).not.toBeSelected();
      expect(chip('nature')).not.toBeSelected();
    });
  });

  describe('PI-5 · ★ 제출축 — styles=effective, 활동 오버라이드 없으면 activities=프리필, 계정취향 불변', () => {
    it('스타일 오버라이드만 있으면 POST 스냅숏 styles 는 override, activities 는 프리필 원본이고 PUT 은 없다', async () => {
      seedValidDraft();
      // 시트 UI 대신 오버라이드를 직접 심어 제출축만 잰다(오픈→적용 배선은 PI-4 가 잠금).
      useTripWizardStore.getState().setPrefStyleOverride(['휴양']);

      renderPage();
      await waitForPrefill();
      expect(next()).toBeEnabled();

      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      const snapshot = tracker.postedBodies[0].preferenceSnapshot as {
        styles: unknown;
        activities: unknown;
      };
      // styles = effective(오버라이드) — 프리필 ['미식','자연'] 이 아니라 ['휴양'].
      expect(snapshot.styles).toEqual(['휴양']);
      // activities = 프리필 원본 — 활동 오버라이드가 undefined 라서(01b Q1, TRIP-1092 전 D5 근거는 폐기).
      expect(snapshot.activities).toEqual(['야경']);

      // 계정 취향은 GET 으로만 읽는다 — PUT 이 나가면 BR-U1-38 위반.
      expect(
        tracker.hits.some((hit) => hit === 'PUT /api/v1/me/preferences')
      ).toBe(false);

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
      );
    });
  });

  describe('PI-6 · ★ null-vs-empty — 전해제 → 빈 오버라이드 저장 (프리필로 안 돌아감)', () => {
    it('전부 해제해 적용하면 store 는 [] 이고 제출 styles 도 [] 다 (프리필 아님)', async () => {
      seedValidDraft();
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      // 프리필 미식·자연 둘 다 해제 → toggleMulti 가 null → 배선이 [] 로 매핑해야 한다.
      fireEvent.press(chip('gourmet'));
      fireEvent.press(chip('nature'));
      await waitFor(() => expect(chip('gourmet')).not.toBeSelected());
      expect(chip('nature')).not.toBeSelected();

      fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));

      // store 는 [] (undefined 아님) — 매핑 누락이면 null 이 실려 제출에서 프리필로 폴백한다.
      await waitFor(() =>
        expect(useTripWizardStore.getState().prefStyleOverride).toEqual([])
      );

      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      const snapshot = tracker.postedBodies[0].preferenceSnapshot as {
        styles: unknown;
      };
      // 빈 오버라이드 — effectiveStyles = [] ?? prefill 이 [] 를 폴백하면(프리필 ['미식','자연']) red.
      expect(snapshot.styles).toEqual([]);
    });
  });

  describe('PI-8 · 프리필 조회 실패 — 오버라이드 없는 축은 스냅숏 키를 뺀다', () => {
    // BE 는 키가 있으면 빈 배열도 최종으로 쓴다(#995) — `[]` 를 실으면 온보딩 취향이 사라진다.
    it('조회 실패면 오버라이드 없는 축(activities)은 키가 없고, 오버라이드 있는 축(styles)은 실린다', async () => {
      server.use(
        http.get(`${BASE}/me/preferences`, () =>
          HttpResponse.json({}, { status: 500 })
        )
      );
      seedValidDraft();
      useTripWizardStore.getState().setPrefStyleOverride(['휴양']);
      renderPage();

      await waitFor(() => expect(next()).toBeEnabled());
      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      expect(tracker.postedBodies[0].preferenceSnapshot).toEqual({
        styles: ['휴양'],
      });
    });
  });

  describe('PI-7 · ★ D4 hasOverride → 요약 "+ 온보딩" 제거', () => {
    it('오버라이드 없으면 요약 취향 행에 "+ 온보딩"이 붙는다 (선제green 회귀 앵커)', async () => {
      renderPage();
      await waitForPrefill();

      await waitFor(() =>
        expect(summaryPreferenceRow()).toHaveTextContent(/미식/)
      );
      // TRIP-732: 옛 " + 온보딩" 문자열이 스파클+분홍 "온보딩" 배지로 바뀐다 → `\+`를 뗀 `/온보딩/`로
      // 검사(구·신 렌더 모두 "온보딩"을 담아 선제 green, 반전 후 `\+` 부재로 깨지는 것 예방).
      expect(summaryPreferenceRow()).toHaveTextContent(/내 취향/);
    });

    it('스타일 오버라이드가 있으면 요약이 effective(휴양)·activities(야경)를 담고 "내 취향" 배지가 사라진다', async () => {
      useTripWizardStore.getState().setPrefStyleOverride(['휴양']);
      renderPage();
      await waitForPrefill();

      await waitFor(() =>
        expect(summaryPreferenceRow()).toHaveTextContent(/휴양/)
      );
      // 활동 오버라이드 undefined → 프리필(야경) 그대로 — 이제 시트 활동 칩으로 끌 수 있는 값이다(TRIP-1092).
      expect(summaryPreferenceRow()).toHaveTextContent(/야경/);
      // 바꿨는데 "온보딩" 표식이 남으면 거짓 — 제거돼야 한다.
      expect(summaryPreferenceRow()).not.toHaveTextContent(/내 취향/);
    });
  });

  /**
   * TRIP-677 · S5G — 프리필 async 갭(취향 데이터 손실 봉합). `GET /me/preferences` 도착 전이면
   * `prefillStyles=[]` 라 시트가 빈 [] 드래프트로 열리고, 적용하면 `effectiveStyles=[] ?? prefill=[]`
   * (★2 `??` 는 빈 배열을 값으로 지켜 프리필로 안 돌아감)로 **온보딩 취향이 영구 유실**된다.
   *
   * 봉합: `openPrefSheet` 진입 가드 `if (preference.isPending) return;` — 미도착이면 시트를 아예 안 연다.
   * 신호는 `preference.isPending`(≠`isLoading`, ★3). 이 테스트는 그 커밋 경로를 **시트 미개봉**으로 차단한다.
   *
   * ⚠️ deferred(비해결) 프리필로 pending 을 재현한다(★1) — 응답을 영영 안 주는 msw 핸들러(02a §5-A 실검증).
   * `SummaryRow` 는 isLoading 이어도 onPress 가 살아 있다(값만 스켈레톤, S7 착시 — 02a §5-C).
   */
  describe('PI-8 · ★ AC-S5G-1 프리필 미해결 중 취향 행 탭은 시트를 안 연다', () => {
    it('preference 쿼리가 pending 이면 취향 요약 행을 눌러도 PrefOverrideSheet 가 안 열린다', () => {
      // 비해결 프리필 — 도착 전 상태를 영구 고정(deferred, 리포 pending 재현 idiom).
      server.use(
        http.get(`${BASE}/me/preferences`, () => new Promise(() => {}))
      );

      renderPage();

      // pending 확증 — 로딩 얼굴이라 취향 값 자리가 스켈레톤이다(가드 신호 preference.isPending 활성).
      expect(
        screen.getByTestId('trip-wizard-summary-skeleton-4')
      ).toBeOnTheScreen();

      // 값이 스켈레톤이어도 SummaryRow 의 onPress 는 살아 있다(S7 착시 — isLoading 은 값만 가림).
      fireEvent.press(summaryPreferenceRow());

      // 현행(결함): 가드가 없어 빈 [] 드래프트로 시트가 열린다 → 적용 시 온보딩 취향 유실.
      // 가드(if preference.isPending return) 후엔 시트가 안 열린다.
      expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();
    });
  });

  /**
   * TRIP-984 D10 · 취향 시트 하단 "내 취향을 가져왔어요" 는 온보딩 취향이 있을 때만.
   * TRIP-1092 01b Q2: 시트가 활동 축도 그리므로 조건이 styles **또는** activities 1개 이상으로 넓어진다 —
   * 온보딩 활동 칩이 켜진 채 열리는데 "온보딩에서" 를 빼면 출처를 숨긴다. 둘 다 없으면 뒤쪽 절만 남는다.
   */
  describe('PI-9 · AC-D3·D4 취향 시트 문구는 온보딩 취향(styles 또는 activities)이 있을 때만 "온보딩에서"', () => {
    it('D3 · 온보딩 styles·activities 가 모두 0개면 "프로필 취향은 바뀌지 않아요" 만 보이고 "온보딩에서" 는 없다', async () => {
      // TRIP-1092 개정: activities 도 비운다(Q2 — activities 만 있어도 "온보딩에서" 가 붙는다, D3b).
      server.use(
        http.get(`${BASE}/me/preferences`, () =>
          HttpResponse.json({
            ...PREF_NATURE,
            styles: { value: [] },
            activities: { value: [] },
          })
        )
      );
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      const sheet = screen.getByTestId('trip-wizard-pref-sheet');
      expect(
        within(sheet).getByText('프로필 취향은 바뀌지 않아요')
      ).toBeOnTheScreen();
      expect(within(sheet).queryByText(/온보딩에서/)).toBeNull();
    });

    it('D3b · TRIP-1092 Q2 — styles 가 0개여도 activities 가 있으면 "온보딩에서" 문구가 붙는다', async () => {
      server.use(
        http.get(`${BASE}/me/preferences`, () =>
          HttpResponse.json({ ...PREF_NATURE, styles: { value: [] } })
        )
      );
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      const sheet = screen.getByTestId('trip-wizard-pref-sheet');
      expect(
        within(sheet).getByText(
          '내 취향을 가져왔어요 · 프로필 취향은 바뀌지 않아요'
        )
      ).toBeOnTheScreen();
    });

    it('D4 · 온보딩 styles 가 있으면 기존 문구 그대로다 (무회귀)', async () => {
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      expect(
        screen.getByText('내 취향을 가져왔어요 · 프로필 취향은 바뀌지 않아요')
      ).toBeOnTheScreen();
    });
  });

  // ── TRIP-1092 · 취향 시트 활동 칩 (QA A13 · 결정 1·2) ─────────────────────────────────────
  //
  // 무엇을 보장하나: 요약 "취향" 행에 보이는 값은 전부 시트에서 끄고 켤 수 있고(A13), 활동 축도 스타일과
  // 똑같이 여행 단위로 덮어써 행·제출 스냅숏에 반영된다(BR-U1-38). 같은 라벨(자연·쇼핑)은 행에 한 번만
  // 보이고, 두 축은 라벨이 같아도 서로 따로 켜지고 꺼진다.
  //
  // ⚠️ 행 값은 `within(row).getByText('…')` **완전 일치**로 본다 — 값 Text 노드가 하나(`SummaryRow`
  // value.main)라 중복 라벨이면 문자열 자체가 달라 red. `toHaveTextContent(/자연/)` 는 두 번이어도 통과한다.

  /** A13 재현 — 온보딩 styles=[미식, 자연] · activities=[역사문화](역사문화는 스타일 7칩에 없다). */
  const PREF_A13: PreferenceView = {
    ...PREF_NATURE,
    styles: { value: ['미식', '자연'] },
    activities: { value: ['역사문화'] },
  };

  /** 결정 2 재현 — 자연이 두 축 모두에 있다. */
  const PREF_DUP: PreferenceView = {
    ...PREF_NATURE,
    styles: { value: ['미식', '자연'] },
    activities: { value: ['자연', '야경'] },
  };

  function servePreference(preference: PreferenceView): void {
    server.use(
      http.get(`${BASE}/me/preferences`, () => HttpResponse.json(preference))
    );
  }

  function activityChip(slug: string) {
    return screen.getByTestId(`trip-wizard-pref-activity-chip-${slug}`);
  }

  function applySheet(): void {
    fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));
  }

  /** 행 값(value.main) 노드 — 완전 일치로 찾는다(없으면 throw). */
  function preferenceValue(text: string) {
    return within(summaryPreferenceRow()).getByText(text);
  }

  async function waitForSheetClosed(): Promise<void> {
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull()
    );
  }

  /** A13 핵심 단언 — 행에 보이는 라벨 하나하나가 시트에서 **켜진 칩**으로 존재한다(축 무관). */
  function expectEveryRowLabelIsSelectedChip(rowMain: string): void {
    const sheet = screen.getByTestId('trip-wizard-pref-sheet');
    for (const label of rowMain.split(' · ')) {
      expect(
        within(sheet).getAllByRole('button', { name: label, selected: true })
          .length
      ).toBeGreaterThan(0);
    }
  }

  function putHits(): number {
    return tracker.hits.filter((hit) => hit === 'PUT /api/v1/me/preferences')
      .length;
  }

  function postedSnapshot(): { styles: unknown; activities: unknown } {
    return tracker.postedBodies[0].preferenceSnapshot as {
      styles: unknown;
      activities: unknown;
    };
  }

  describe('PA-1 · TRIP-1092 AC-1 (A13) — 행의 모든 값이 시트에서 켜진 칩으로 대응한다', () => {
    it('styles=[미식,자연]·activities=[역사문화] 면 시트에서 활동 역사문화가 켜져 있다', async () => {
      servePreference(PREF_A13);
      renderPage();
      await waitForPrefill();
      expect(preferenceValue('미식 · 자연 · 역사문화')).toBeOnTheScreen();

      await openSheet('preference');

      expect(activityChip('history')).toBeSelected();
      // 스타일 자연이 켜져 있어도 활동 자연은 꺼져 있다(라벨 공유 아님).
      expect(activityChip('nature')).not.toBeSelected();
      for (const slug of [
        'themepark',
        'foodtour',
        'cafe',
        'exhibition',
        'nightview',
        'shopping',
      ]) {
        expect(activityChip(slug)).not.toBeSelected();
      }
      expectEveryRowLabelIsSelectedChip('미식 · 자연 · 역사문화');
    });
  });

  describe('PA-2 · ★ TRIP-1092 AC-2·AC-3·AC-10 — 활동 해제 → 적용 → 행·스냅숏에서 사라진다', () => {
    it('역사문화를 끄고 적용하면 행에서 빠지고, 제출 activities 는 [] 이고 PUT 은 없다', async () => {
      servePreference(PREF_A13);
      seedValidDraft();
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      fireEvent.press(activityChip('history'));
      await waitFor(() => expect(activityChip('history')).not.toBeSelected());
      applySheet();
      await waitForSheetClosed();

      expect(preferenceValue('미식 · 자연')).toBeOnTheScreen();
      // 유일한 활동을 끄면 toggleMulti 가 null — 배선이 [] 로 담아야 프리필로 안 돌아간다(null-vs-empty).
      expect(useTripWizardStore.getState().prefActivityOverride).toEqual([]);

      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      expect(postedSnapshot().styles).toEqual(['미식', '자연']);
      expect(postedSnapshot().activities).toEqual([]);
      expect(putHits()).toBe(0);
    });
  });

  describe('PA-3 · TRIP-1092 AC-2 — 다시 열면 활동 칩이 적용한 값에서 시작한다', () => {
    it('역사문화를 끄고 적용한 뒤 다시 열면 역사문화가 꺼진 채다 (프리필로 되살아나지 않는다)', async () => {
      servePreference(PREF_A13);
      renderPage();
      await waitForPrefill();
      await openSheet('preference');
      fireEvent.press(activityChip('history'));
      await waitFor(() => expect(activityChip('history')).not.toBeSelected());
      applySheet();
      await waitForSheetClosed();

      await openSheet('preference');

      expect(activityChip('history')).not.toBeSelected();
    });
  });

  describe('PA-4 · TRIP-1092 AC-4 — 배지 정직성', () => {
    it('오버라이드 없으면 온보딩 배지가 있고, 활동을 바꿔 적용하면 배지가 사라지며 행 값은 전부 시트에서 켜진 칩이다', async () => {
      servePreference(PREF_A13);
      renderPage();
      await waitForPrefill();
      // 오버라이드 없음 → 배지.
      expect(
        screen.getByTestId('trip-wizard-preference-sparkle')
      ).toBeOnTheScreen();

      await openSheet('preference');
      fireEvent.press(activityChip('nightview'));
      await waitFor(() => expect(activityChip('nightview')).toBeSelected());
      applySheet();
      await waitForSheetClosed();

      expect(screen.queryByTestId('trip-wizard-preference-sparkle')).toBeNull();
      expect(
        preferenceValue('미식 · 자연 · 역사문화 · 야경')
      ).toBeOnTheScreen();

      // 배지를 뗀 행에 "여행에서 못 바꾼 온보딩 값"이 남지 않는다 — 다시 열어 전부 켜진 칩으로 확인.
      await openSheet('preference');
      expectEveryRowLabelIsSelectedChip('미식 · 자연 · 역사문화 · 야경');
    });
  });

  describe('PA-5 · TRIP-1092 AC-5 (결정 2) — 두 축에 같은 라벨이 있으면 행에 한 번만', () => {
    it('styles=[미식,자연]·activities=[자연,야경] 이면 행은 "미식 · 자연 · 야경" 이다', async () => {
      servePreference(PREF_DUP);
      renderPage();
      await waitForPrefill();

      // 완전 일치 — "미식 · 자연 · 자연 · 야경"(중복)이면 이 노드를 못 찾아 red.
      expect(preferenceValue('미식 · 자연 · 야경')).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-preference-sparkle')
      ).toBeOnTheScreen();
    });
  });

  describe('PA-6 · ★ TRIP-1092 AC-6 (결정 2) — 활동 쪽 자연만 끄면 스타일 자연은 남는다', () => {
    it('활동 자연을 끄고 적용·제출하면 행에 자연이 한 번 남고, activities 에서만 자연이 빠진다', async () => {
      servePreference(PREF_DUP);
      seedValidDraft();
      renderPage();
      await waitForPrefill();
      await openSheet('preference');
      expect(activityChip('nature')).toBeSelected();
      expect(chip('nature')).toBeSelected();

      fireEvent.press(activityChip('nature'));

      await waitFor(() => expect(activityChip('nature')).not.toBeSelected());
      // 교차 토글 금지 — 라벨이 같아도 스타일 자연은 그대로.
      expect(chip('nature')).toBeSelected();

      applySheet();
      await waitForSheetClosed();
      expect(preferenceValue('미식 · 자연 · 야경')).toBeOnTheScreen();

      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      expect(postedSnapshot().styles).toEqual(['미식', '자연']);
      expect(postedSnapshot().activities).toEqual(['야경']);
      expect(putHits()).toBe(0);
    });
  });

  describe('PA-7 · ★ TRIP-1092 축 분리 (쇼핑) — 한 축의 쇼핑을 눌러도 다른 축 쇼핑은 그대로', () => {
    it('활동 쇼핑 켬 → 스타일 쇼핑 켬 → 활동 쇼핑 끔, 매번 반대 축 상태가 안 바뀐다', async () => {
      servePreference(PREF_DUP);
      renderPage();
      await waitForPrefill();
      await openSheet('preference');
      expect(activityChip('shopping')).not.toBeSelected();
      expect(chip('shopping')).not.toBeSelected();

      fireEvent.press(activityChip('shopping'));
      await waitFor(() => expect(activityChip('shopping')).toBeSelected());
      expect(chip('shopping')).not.toBeSelected();

      fireEvent.press(chip('shopping'));
      await waitFor(() => expect(chip('shopping')).toBeSelected());
      expect(activityChip('shopping')).toBeSelected();

      fireEvent.press(activityChip('shopping'));
      await waitFor(() => expect(activityChip('shopping')).not.toBeSelected());
      expect(chip('shopping')).toBeSelected();
    });
  });

  describe('PA-8 · TRIP-1092 AC-7 — 활동 칩을 안 건드리면 activities 는 온보딩 프리필 그대로', () => {
    it('시트를 안 열고 제출하면 activities 는 프리필 [역사문화] 다 (선제 green 앵커)', async () => {
      servePreference(PREF_A13);
      seedValidDraft();
      renderPage();
      await waitForPrefill();

      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      expect(postedSnapshot().styles).toEqual(['미식', '자연']);
      expect(postedSnapshot().activities).toEqual(['역사문화']);
    });

    it('스타일만 바꿔 적용해도 활동은 프리필 그대로 함께 커밋되고, 제출 activities 는 [역사문화] 다', async () => {
      servePreference(PREF_A13);
      seedValidDraft();
      renderPage();
      await waitForPrefill();
      await openSheet('preference');

      fireEvent.press(chip('gourmet'));
      await waitFor(() => expect(chip('gourmet')).not.toBeSelected());
      applySheet();
      await waitForSheetClosed();

      // 적용은 두 축을 함께 커밋한다(01b Q1) — 활동 드래프트(=프리필)가 그대로 실린다.
      expect(useTripWizardStore.getState().prefActivityOverride).toEqual([
        '역사문화',
      ]);

      fireEvent.press(next());

      await waitFor(() => expect(createHits()).toBe(1));
      expect(postedSnapshot().styles).toEqual(['자연']);
      expect(postedSnapshot().activities).toEqual(['역사문화']);
    });
  });

  describe('PA-9 · TRIP-1092 AC-8 — 온보딩 취향 0개면 행은 플레이스홀더 (무회귀)', () => {
    it('styles·activities 모두 비면 행 값은 "취향 선택" 이고 온보딩 배지가 없다 (선제 green 앵커)', async () => {
      servePreference({
        ...PREF_NATURE,
        styles: { value: [] },
        activities: { value: [] },
      });
      renderPage();
      await waitForPrefill();

      expect(preferenceValue('취향 선택')).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-wizard-preference-sparkle')).toBeNull();
    });
  });
});

/**
 * TRIP-1113 결정 1 — 이미 만든 여행은 취향을 바꿀 수 없다(PATCH 계약에 취향 스냅숏이 없다).
 *
 * 무엇을 보장하나: `createdTripId` 가 있으면 요약 취향 행을 눌러도 시트가 열리지 않고, 그 이유를
 * 토스트 한 줄로 알린다(조용히 무시하면 INV-4). 없으면 지금처럼 시트가 열린다.
 *
 * ⚠️ 토스트는 모듈 싱글턴이다 — 파일 최상위 afterEach 에서 지우고, 누르기 전 "아직 없다"를 먼저 본다.
 */
describe('만든 여행의 취향 잠금 (AC-10)', () => {
  afterEach(expectNoExitWizard);

  const { preferenceHandler, renderPage, waitForPrefill } = wizardStep1Harness({
    Inner: WithToastHost,
  });

  const TOAST = 'trip-wizard-pref-locked-toast';

  beforeEach(() => {
    useTripWizardStore.getState().reset();
    server.use(preferenceHandler());
  });

  afterEach(() => {
    resetToast();
    server.resetHandlers();
  });

  function preferenceRow() {
    return screen.getByTestId('trip-wizard-summary-preference');
  }

  describe('AC-10 · 이미 만든 여행이면 취향 행이 잠긴다', () => {
    it('🔴 L-1 createdTripId 가 있으면 취향 행을 눌러도 시트가 안 열리고 안내 토스트가 뜬다', async () => {
      useTripWizardStore
        .getState()
        .setCreatedTripId('11111111-1111-1111-1111-111111111111');
      renderPage();
      await waitForPrefill();
      expect(screen.queryByTestId(TOAST)).toBeNull();

      fireEvent.press(preferenceRow());

      const toast = await screen.findByTestId(TOAST);
      expect(
        within(toast).getByText('이미 만든 여행은 취향을 바꿀 수 없어요')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();
    });

    it('🟢 L-2 createdTripId 가 없으면 지금처럼 시트가 열리고 토스트는 없다', async () => {
      renderPage();
      await waitForPrefill();
      expect(screen.queryByTestId(TOAST)).toBeNull();

      fireEvent.press(preferenceRow());

      expect(
        await screen.findByTestId('trip-wizard-pref-sheet')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(TOAST)).toBeNull();
    });
  });
});

/**
 * TRIP-1113 — 이미 만든 여행이 있으면 「다음」은 여행을 새로 만들지 않고 고친다(실 HTTP 심판).
 *
 * 무엇을 보장하나:
 *  - `createdTripId` 가 있으면 새로 마운트된 step1 이든 같은 화면이든 `POST /trips` 대신
 *    `PATCH /trips/{id}` 를 보내고, 서버 꼭 갈 곳을 화면 시드에 맞춘 뒤(추가·삭제) step2 로 간다.
 *  - PATCH·동기화·조회 실패는 각자 배너로 드러나고, 다시 시도가 여행을 또 만들지 않는다(INV-4).
 *  - `createdTripId` 가 없으면 지금 그대로 새로 만든다(가드 c 무회귀).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청의 종류·횟수·본문"이다(msw 만 관찰).
 * 가짜 서버의 꼭 갈 곳 목록은 상태를 가진다(POST 는 더하고 DELETE 는 뺀다) — 재시도가 다시 조회하든
 * 남은 목록을 기억하든 테스트는 나간 요청만 본다.
 *
 * ⚠️ 요청 수는 완전 일치로 센다 — must-visits 경로가 `/api/v1/trips` 를 접두로 품는다.
 * ⚠️ 게스트로 돈다(담은목록 조회 없음). 모든 핸들러를 beforeEach 에 건다 — `onUnhandledRequest:'error'`.
 */
describe('재진입 — 만든 여행 고치기 (AC-1~AC-11)', () => {
  afterEach(expectNoExitWizard);

  const {
    tracker,
    preferenceHandler,
    renderPage,
    next,
    seedValidDraft,
    waitForPrefill,
  } = wizardStep1Harness();

  const CREATE = 'POST /api/v1/trips';
  const PATCH = `PATCH /api/v1/trips/${TRIP_ID}`;
  const MV_PATH = `/api/v1/trips/${TRIP_ID}/must-visits`;
  const MV_GET = `GET ${MV_PATH}`;
  const MV_ADD = `POST ${MV_PATH}`;
  const mvDelete = (mustVisitId: string) => `DELETE ${MV_PATH}/${mustVisitId}`;

  let patchedBodies: Record<string, unknown>[] = [];
  let addedBodies: Record<string, unknown>[] = [];
  /** 가짜 서버에 등록된 꼭 갈 곳 — POST 가 더하고 DELETE 가 뺀다. */
  let registered: MustVisit[] = [];
  /** 실패 스위치 — 켠 것만 실패한다. 재시도 전에 끈다. */
  let patchFailure: null | 'network' | number = null;
  let failGet = false;
  let failDelete = false;
  let failAddFor = new Set<string>();
  let conflictAddFor = new Set<string>();
  /** push 가 불린 그 순간의 PATCH 수(AC-2b 순서 단언). */
  let pushSnapshots: number[] = [];

  const hits = tracker.count;
  const mustVisitHits = () =>
    tracker.hits.filter((hit) => /\/must-visits(\/|$)/.test(hit)).length;

  function mustVisit(poiId: string): MustVisit {
    return {
      mustVisitId: `mv-${poiId}`,
      poiSnapshotId: `snap-${poiId}`,
      sourcePoiId: poiId,
      type: 'ANYTIME',
    };
  }

  function seedItem(sourcePoiId: string): MustVisitSeedItem {
    return {
      sourcePoiId,
      name: `장소 ${sourcePoiId}`,
      imageUrl: null,
      region: null,
    };
  }

  const errorBody = (code: string) => ({ error: { code, message: code } });

  beforeEach(() => {
    patchedBodies = [];
    addedBodies = [];
    registered = [];
    patchFailure = null;
    failGet = false;
    failDelete = false;
    failAddFor = new Set();
    conflictAddFor = new Set();
    pushSnapshots = [];
    mockPush.mockReset();
    mockPush.mockImplementation(() => {
      pushSnapshots.push(hits(PATCH));
    });
    useTripWizardStore.getState().reset();

    server.use(
      preferenceHandler(),
      http.post(`${BASE}/trips`, () =>
        HttpResponse.json(TRIP, { status: 201 })
      ),
      http.patch(`${BASE}/trips/:tripId`, async ({ request }) => {
        patchedBodies.push((await request.json()) as Record<string, unknown>);
        if (patchFailure === 'network') return HttpResponse.error();
        if (patchFailure !== null) {
          return HttpResponse.json(errorBody('REJECTED'), {
            status: patchFailure,
          });
        }
        return HttpResponse.json(TRIP);
      }),
      http.get(`${BASE}/trips/:tripId/must-visits`, () =>
        failGet
          ? HttpResponse.json(errorBody('INTERNAL'), { status: 500 })
          : HttpResponse.json(registered)
      ),
      http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
        const body = (await request.json()) as { poiId: string };
        addedBodies.push(body);
        if (failAddFor.has(body.poiId)) {
          return HttpResponse.json(errorBody('INTERNAL'), { status: 500 });
        }
        if (conflictAddFor.has(body.poiId)) {
          return HttpResponse.json(errorBody('CONFLICT'), { status: 409 });
        }
        const row = mustVisit(body.poiId);
        registered = [...registered, row];
        return HttpResponse.json(row, { status: 201 });
      }),
      http.delete(
        `${BASE}/trips/:tripId/must-visits/:mustVisitId`,
        ({ params }) => {
          if (failDelete) {
            return HttpResponse.json(errorBody('INTERNAL'), { status: 500 });
          }
          registered = registered.filter(
            (row) => row.mustVisitId !== params.mustVisitId
          );
          return new HttpResponse(null, { status: 204 });
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
  });

  /** 이전 제출이 만든 여행이 남아 있는 재진입 상태. */
  function seedReentry(): void {
    seedValidDraft();
    useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
  }

  async function pressNextAfterPrefill(): Promise<void> {
    await waitForPrefill();
    fireEvent.press(next());
  }

  describe('🔴 AC-1 · 이미 만든 여행이 있으면 새로 마운트된 step1 도 여행을 또 만들지 않는다', () => {
    it('R-1 새 여행을 만든 뒤 step1 이 새로 쌓여 「다음」을 누르면 PATCH 1회뿐이고 POST /trips 는 그대로 1회다', async () => {
      // 준비 — 처음 제출로 여행이 하나 만들어지고 step2 로 갔다.
      seedValidDraft();
      const first = renderPage();
      await pressNextAfterPrefill();
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(hits(CREATE)).toBe(1);

      // 실행 — 꼭 갈 곳 고르기 완료처럼 새 step1 인스턴스가 쌓인다.
      first.unmount();
      renderPage();
      await pressNextAfterPrefill();

      // 단언
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
      expect(hits(CREATE)).toBe(1);
      expect(hits(PATCH)).toBe(1);
      expect(mockPush).toHaveBeenLastCalledWith('/trips/new/step2');
    });

    it('R-2 재진입 상태로 처음 그려진 step1 은 POST /trips 0회 · PATCH 1회 뒤 step2 로 간다', async () => {
      seedReentry();
      renderPage();

      await pressNextAfterPrefill();

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush.mock.calls).toEqual([['/trips/new/step2']]);
      expect(hits(CREATE)).toBe(0);
      expect(hits(PATCH)).toBe(1);
    });
  });

  describe('🔴 AC-2 · PATCH 본문은 화면 값 전체다(대체 의미)', () => {
    it('R-3 인원·동반을 바꾼 재진입이면 본문이 정확히 그 5개 키이고 예산·취향 스냅숏·제목은 없다', async () => {
      seedReentry();
      const store = useTripWizardStore.getState();
      store.setParty(3);
      store.selectCompanion('가족');
      renderPage();

      await pressNextAfterPrefill();

      await waitFor(() => expect(hits(PATCH)).toBe(1));
      expect(patchedBodies).toEqual([
        {
          startDate: '2026-06-10',
          endDate: '2026-06-13',
          destinations: [{ seq: 1, region: '부산', nights: 3 }],
          party: 3,
          companionType: '가족',
        },
      ]);
    });
  });

  describe('🔴 AC-2b · 같은 화면으로 돌아와 값을 바꾸면 요청 없이 넘어가지 않는다', () => {
    it('R-5 step2 에 한 번 갔다 온 화면에서 기간을 바꿔 「다음」을 누르면 PATCH 가 먼저 나가고 그 뒤에 이동한다', async () => {
      // 준비 — 같은 화면에서 새 여행을 만들고 step2 로 갔다.
      seedValidDraft();
      renderPage();
      await pressNextAfterPrefill();
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(hits(CREATE)).toBe(1);

      // 돌아와서 시작일을 바꾼다(끝은 3박에 맞춰 파생된다).
      act(() => {
        useTripWizardStore.getState().setStartDate('2026-06-20');
      });

      // 실행
      fireEvent.press(next());

      // 단언 — 바뀐 값이 서버로 가고, 이동은 그 뒤다.
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
      expect(hits(PATCH)).toBe(1);
      expect(patchedBodies[0]).toMatchObject({
        startDate: '2026-06-20',
        endDate: '2026-06-23',
      });
      expect(pushSnapshots).toEqual([0, 1]);
      expect(hits(CREATE)).toBe(1);
    });
  });

  describe('🔴 AC-3 · 서버 꼭 갈 곳을 화면 시드에 맞춘다', () => {
    it('R-6 서버 A·B, 시드 B·C 면 C 만 추가하고 A 만 지우며 B 는 건드리지 않는다', async () => {
      registered = [mustVisit('poi-A'), mustVisit('poi-B')];
      seedReentry();
      useTripWizardStore
        .getState()
        .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
      renderPage();

      await pressNextAfterPrefill();

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
      expect(addedBodies).toEqual([{ poiId: 'poi-C', type: 'ANYTIME' }]);
      expect(hits(MV_ADD)).toBe(1);
      expect(hits(mvDelete('mv-poi-A'))).toBe(1);
      expect(hits(mvDelete('mv-poi-B'))).toBe(0);
      // 동기화는 PATCH 성공 뒤다.
      expect(tracker.hits.indexOf(PATCH)).toBeGreaterThanOrEqual(0);
      expect(tracker.hits.indexOf(PATCH)).toBeLessThan(
        tracker.hits.indexOf(MV_GET)
      );
      expect(hits(CREATE)).toBe(0);
    });
  });

  describe('🔴 AC-4 · 추가가 409(이미 있음)면 실패로 세지 않는다', () => {
    it('R-7 C 추가가 409 여도 배너 없이 step2 로 간다', async () => {
      registered = [mustVisit('poi-A'), mustVisit('poi-B')];
      conflictAddFor = new Set(['poi-C']);
      seedReentry();
      useTripWizardStore
        .getState()
        .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
      renderPage();

      await pressNextAfterPrefill();

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
      expect(hits(MV_ADD)).toBe(1);
      expect(screen.queryByTestId('trip-wizard-mustvisit-banner')).toBeNull();
    });
  });

  describe('🔴 AC-5 · PATCH 실패는 제출 배너로 드러나고 여행을 새로 만들지 않는다', () => {
    it.each([
      ['400', 400],
      ['409 (종료·삭제된 여행)', 409],
      ['500', 500],
      ['네트워크', 'network' as const],
    ])(
      'R-8 PATCH 가 %s 로 실패하면 배너가 뜨고 POST /trips·동기화·이동이 0회다',
      async (_label, failure) => {
        patchFailure = failure;
        seedReentry();
        renderPage();

        await pressNextAfterPrefill();

        const banner = await screen.findByTestId('trip-wizard-submit-banner');
        expect(within(banner).getByText('저장하지 못했어요')).toBeOnTheScreen();
        expect(hits(PATCH)).toBe(1);
        expect(hits(CREATE)).toBe(0);
        expect(mustVisitHits()).toBe(0);
        expect(mockPush).not.toHaveBeenCalled();
      }
    );

    it('R-9 배너의 다시 시도는 PATCH 를 다시 보내고(POST 아님) 성공하면 step2 로 간다', async () => {
      patchFailure = 'network';
      seedReentry();
      renderPage();
      await pressNextAfterPrefill();
      const banner = await screen.findByTestId('trip-wizard-submit-banner');

      patchFailure = null;
      fireEvent.press(
        within(banner).getByTestId('trip-wizard-submit-banner-retry')
      );

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
      expect(hits(PATCH)).toBe(2);
      expect(hits(CREATE)).toBe(0);
    });
  });

  describe('🔴 AC-6 · 동기화 일부 실패는 꼭 갈 곳 배너로 드러나고 다시 시도는 남은 차이만 맞춘다', () => {
    it('R-10 A 삭제는 되고 C 추가가 실패하면 "2곳 중 1곳" 배너가 뜨고 이동하지 않는다', async () => {
      registered = [mustVisit('poi-A')];
      failAddFor = new Set(['poi-C']);
      seedReentry();
      useTripWizardStore.getState().initMustVisits([seedItem('poi-C')]);
      renderPage();

      await pressNextAfterPrefill();

      const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
      expect(
        within(banner).getByText('꼭 갈 곳 2곳 중 1곳을 등록하지 못했어요')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('R-0a 0박으로 되돌아와 [다음] → PATCH 한 번 뒤 방식 선택(h04)으로 가고 step2 는 안 간다', async () => {
      // 준비 — 이미 만든 여행(재진입)인데 화면에서 0박(당일치기)으로 고쳤다. 도시 하나라 0박이 합법이다.
      seedReentry();
      useTripWizardStore.getState().setNights(1, 0);
      renderPage();

      // 실행
      await pressNextAfterPrefill();

      // 단언 — 서버엔 PATCH 1회(POST 아님), 이동은 방식 선택 하나(PATCH 경로의 분기를 지킨다).
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/method',
        params: { tripId: TRIP_ID },
      });
      expect(mockPush).not.toHaveBeenCalledWith('/trips/new/step2');
      expect(hits(PATCH)).toBe(1);
      expect(hits(CREATE)).toBe(0);
    });

    it('R-0b 꼭 갈 곳 [다시 시도]는 PATCH 없이 등록만 다시 하므로, 그 사이 박수를 0으로 내려도 서버가 아는 박수(3박) 기준으로 step2 로 간다', async () => {
      // 준비 — 3박으로 PATCH 가 나갔고(서버 3박) 꼭 갈 곳 하나가 실패해 배너가 떴다.
      registered = [mustVisit('poi-A')];
      failAddFor = new Set(['poi-C']);
      seedReentry();
      useTripWizardStore.getState().initMustVisits([seedItem('poi-C')]);
      renderPage();
      await pressNextAfterPrefill();
      const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
      expect(hits(PATCH)).toBe(1);

      // 실행 — 배너가 떠 있는 동안 화면에서 박수를 0으로 내리고(서버는 모름) 재시도한다.
      act(() => useTripWizardStore.getState().setNights(1, 0));
      failAddFor = new Set();
      fireEvent.press(
        within(banner).getByTestId('trip-wizard-mustvisit-banner-retry')
      );

      // 단언 — 재시도는 PATCH 를 또 보내지 않았고, 판정은 서버 여행(3박) 기준이라 거점 단계(step2)로 간다.
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
      expect(hits(PATCH)).toBe(1);
    });

    it('R-11 다시 시도는 여행을 만들지 않고 실패한 C 만 다시 추가한 뒤 step2 로 간다', async () => {
      registered = [mustVisit('poi-A')];
      failAddFor = new Set(['poi-C']);
      seedReentry();
      useTripWizardStore.getState().initMustVisits([seedItem('poi-C')]);
      renderPage();
      await pressNextAfterPrefill();
      const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
      expect(hits(mvDelete('mv-poi-A'))).toBe(1);

      failAddFor = new Set();
      fireEvent.press(
        within(banner).getByTestId('trip-wizard-mustvisit-banner-retry')
      );

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
      expect(hits(CREATE)).toBe(0);
      expect(hits(MV_ADD)).toBe(2);
      expect(addedBodies.map((body) => body.poiId)).toEqual(['poi-C', 'poi-C']);
      expect(hits(mvDelete('mv-poi-A'))).toBe(1);
    });

    it('R-12 삭제 실패도 같은 배너로 센다 — 시드를 비웠는데 A 삭제가 실패하면 "1곳 중 1곳"', async () => {
      registered = [mustVisit('poi-A')];
      failDelete = true;
      seedReentry();
      renderPage();

      await pressNextAfterPrefill();

      const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
      expect(
        within(banner).getByText('꼭 갈 곳 1곳 중 1곳을 등록하지 못했어요')
      ).toBeOnTheScreen();
      expect(hits(mvDelete('mv-poi-A'))).toBe(1);
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('🟢 AC-7 · 이미 만든 여행이 없으면 지금처럼 새로 만든다 (가드 c 무회귀)', () => {
    it('R-13 새 여행이면 POST /trips 1회 · PATCH 0 · 꼭 갈 곳 조회 0 · 시드 C 등록 1회 뒤 step2 로 간다', async () => {
      seedValidDraft();
      useTripWizardStore.getState().initMustVisits([seedItem('poi-C')]);
      renderPage();

      await pressNextAfterPrefill();

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
      expect(hits(CREATE)).toBe(1);
      expect(tracker.hits.filter((hit) => hit.startsWith('PATCH '))).toEqual(
        []
      );
      expect(hits(MV_GET)).toBe(0);
      expect(addedBodies).toEqual([{ poiId: 'poi-C', type: 'ANYTIME' }]);
    });
  });

  describe('🔴 AC-9 · 고치는 중 다시 눌러도 요청이 늘지 않는다', () => {
    it('R-14 PATCH 응답 전 두 번째 press 는 PATCH·POST·must-visits 를 더 만들지 않는다', async () => {
      let release: () => void = () => {};
      let started = false;
      server.use(
        http.patch(`${BASE}/trips/:tripId`, async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
            started = true;
          });
          return HttpResponse.json(TRIP);
        })
      );
      seedReentry();
      renderPage();
      await pressNextAfterPrefill();
      await waitFor(() => expect(started).toBe(true));

      fireEvent.press(next());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(hits(PATCH)).toBe(1);
      expect(hits(CREATE)).toBe(0);
      expect(mustVisitHits()).toBe(0);

      await act(async () => {
        release();
      });
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(hits(PATCH)).toBe(1);
      expect(hits(CREATE)).toBe(0);
    });

    it('R-15 꼭 갈 곳 조회 응답 전 두 번째 press 도 요청을 더 만들지 않는다', async () => {
      let release: () => void = () => {};
      let started = false;
      server.use(
        http.get(`${BASE}/trips/:tripId/must-visits`, async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
            started = true;
          });
          return HttpResponse.json([]);
        })
      );
      seedReentry();
      renderPage();
      await pressNextAfterPrefill();
      await waitFor(() => expect(started).toBe(true));

      fireEvent.press(next());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(hits(PATCH)).toBe(1);
      expect(hits(MV_GET)).toBe(1);
      expect(hits(CREATE)).toBe(0);

      await act(async () => {
        release();
      });
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(hits(PATCH)).toBe(1);
      expect(hits(MV_GET)).toBe(1);
    });
  });

  describe('🔴 AC-11 · 꼭 갈 곳 조회 실패는 배너로 드러나고 다시 시도는 조회부터 한다', () => {
    it('R-16 조회가 실패하면 "2곳 중 2곳" 꼭 갈 곳 배너가 뜨고 이동·여행 생성이 0회다', async () => {
      failGet = true;
      seedReentry();
      useTripWizardStore
        .getState()
        .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
      renderPage();

      await pressNextAfterPrefill();

      const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
      expect(
        within(banner).getByText('꼭 갈 곳 2곳 중 2곳을 등록하지 못했어요')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
      expect(hits(CREATE)).toBe(0);
      expect(hits(MV_ADD)).toBe(0);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('R-17 다시 시도는 조회를 다시 하고 B·C 를 추가한 뒤 step2 로 간다', async () => {
      failGet = true;
      seedReentry();
      useTripWizardStore
        .getState()
        .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
      renderPage();
      await pressNextAfterPrefill();
      const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
      expect(hits(MV_GET)).toBe(1);

      failGet = false;
      fireEvent.press(
        within(banner).getByTestId('trip-wizard-mustvisit-banner-retry')
      );

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
      expect(hits(MV_GET)).toBe(2);
      expect(addedBodies.map((body) => body.poiId).sort()).toEqual([
        'poi-B',
        'poi-C',
      ]);
      expect(hits(CREATE)).toBe(0);
    });
  });
});

/**
 * TRIP-1114 — g01 ‹ 를 눌렀을 때, 이미 만든 여행이 있으면 바로 나가지 않고 묻는다(실 HTTP 심판).
 * 추적: US-TRIP-10(확정 전 아무것도 안 지움 · 실패 안내) · BR-U1-33(입력 보존) · INV-4.
 *
 * 무엇을 보장하나:
 *  - 여행을 안 만들었으면 지금처럼 바로 나간다(AC-1). 만들었으면 다이얼로그만 뜨고 아무것도 안 나간다(AC-2).
 *  - [계속 작성]은 닫기만, [저장하고 나가기]는 요청 없이 나가기, [삭제하고 나가기]는 DELETE 뒤 나가기.
 *  - 나가기는 `canGoBack() ? back() : replace('/(tabs)')` 이다(01b 결정 2).
 *  - 삭제 성공(204)·이미 없음(404)이면 `createdTripId` 만 비우고 드래프트는 그대로 둔다(결정 3).
 *  - 삭제 실패(500·네트워크)면 다이얼로그 안에 알리고 머문다. 다시 누르면 다시 보낸다(INV-4).
 *  - 삭제가 날아가는 동안에는 세 버튼이 모두 잠기고, 이동은 삭제 결과로 정확히 1번이다(Q3).
 *  - 삭제 뒤 `GET /trips`(내 여행 목록) 캐시를 무효화해 살아 있는 목록이 다시 받는다(Q4).
 *  - 화면이 사라진 뒤 도착한 응답은 이동을 일으키지 않는다(Q3 · AC-12).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청의 종류·횟수"와 "라우터 호출"이다(msw 관찰).
 * 훅 목 대신 실제 react-query 가 돈다 — 연타 잠금은 늦게 알려지는 실물 거동에서만 의미가 있다.
 *
 * "0번" 단언은 전부 `settle()` 뒤다. AC-5 가 같은 `settle()` 한 번 뒤 DELETE 1번을 바로 단언해
 * "settle 이면 요청이 나갈 시간은 충분하다"를 이 파일 안에서 증명한다(02a ★1).
 *
 * 사람 손 간격: 서로 다른 버튼을 누르는 사이엔 `tap()` 이 400ms 누름 가드(`guardPress`, 모듈 전역)를
 * 닫는다 — 구현이 어느 버튼을 가드로 감싸든 "사람이 따로 누른 것"이 가드에 먹히지 않게(02a ★2).
 * 같은 틱 연타는 `tap` 없이 `fireEvent.press` 를 두 번 부른다.
 *
 * ⚠️ 요청 수는 완전 일치로 센다 — must-visits 경로가 `/api/v1/trips` 를 접두로 품는다.
 * ⚠️ 게스트로 돈다(담은목록 조회 없음). 헤더 ‹ 만 가로챈다 — 스와이프·하드웨어 뒤로는 jest 밖(결정 1).
 * ⚠️ 딤이 실제로 덮는지·가운데 오는지·뒤 터치를 막는지는 jest 사각(repo-traps 오버레이 절) — 6-b.
 *
 * 라우터 목(push·back·replace·canGoBack)은 파일 최상위로 옮겼다 — 이 describe 의 beforeEach 가 그대로 되돌린다.
 */
describe('‹ 나가기 확인 (AC-1~AC-12)', () => {
  const { tracker, preferenceHandler, renderPage, seedValidDraft } =
    wizardStep1Harness({ Inner: WithTripsList });

  const HOME_FALLBACK = '/(tabs)';
  const ERROR_TEXT = '삭제하지 못했어요. 다시 시도해 주세요.';

  const DELETE_TRIP = `DELETE /api/v1/trips/${TRIP_ID}`;
  const LIST_TRIPS = 'GET /api/v1/trips';

  type DeleteMode = 204 | 404 | 500 | 'network' | 'gate';

  let deleteMode: DeleteMode = 204;
  /** `gate` 모드에서 붙잡힌 DELETE 를 풀어 줄 문들. */
  let gates: (() => void)[] = [];

  const hits = tracker.count;

  function openGates(): void {
    const pending = gates;
    gates = [];
    pending.forEach((resolve) => resolve());
  }

  beforeEach(() => {
    deleteMode = 204;
    gates = [];
    mockRouter.push.mockReset();
    mockRouter.back.mockReset();
    mockRouter.replace.mockReset();
    mockRouter.canGoBack.mockReset();
    mockRouter.canGoBack.mockImplementation(() => true);
    useTripWizardStore.getState().reset();

    server.use(
      preferenceHandler(),
      http.get(`${BASE}/trips`, () => HttpResponse.json([])),
      http.delete(`${BASE}/trips/:tripId`, async () => {
        if (deleteMode === 'network') return HttpResponse.error();
        if (deleteMode === 500) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        if (deleteMode === 404) {
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: '없음' } },
            { status: 404 }
          );
        }
        if (deleteMode === 'gate') {
          await new Promise<void>((resolve) => {
            gates.push(resolve);
          });
        }
        return new HttpResponse(null, { status: 204 });
      })
    );
  });

  // 모듈 싱글턴 리셋은 파일 최상위에 건다 — describe 안에만 걸면 앞 테스트의 가드 창이 새어 든다.
  afterEach(() => {
    // 단언이 문을 열기 전에 실패해도 붙잡힌 요청을 남기지 않는다(안 풀면 jest 가 red 대신 멈춘다).
    openGates();
    resetPressGuard();
    server.resetHandlers();
  });

  /** 살아 있는 "내 여행" 목록 흉내 — `GET /trips` 를 구독만 한다(무효화되면 다시 받는다, AC-11). */
  function TripsListObserver(): null {
    useGetTrips();
    return null;
  }

  /** 하네스 Provider 안쪽에 목록 관찰자를 함께 그린다. */
  function WithTripsList({ children }: { children: ReactNode }) {
    return (
      <>
        <TripsListObserver />
        {children}
      </>
    );
  }

  /** 요청이 출발할 시간을 준다(02a §5 실측 — 30ms 한 번이면 DELETE 가 이미 잡힌다). */
  async function settle(): Promise<void> {
    await act(() => new Promise((r) => setTimeout(r, 30)));
  }

  /** 사람이 따로 누른 탭 — 400ms 누름 가드 창을 닫고(=시간이 흐른 것과 같다) 누른다. */
  function tap(testID: string): void {
    resetPressGuard();
    fireEvent.press(screen.getByTestId(testID));
  }

  /** 이 위저드 세션에서 이미 여행을 만든 상태. */
  function seedCreated(): void {
    seedValidDraft();
    useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
  }

  function draftSnapshot() {
    const { destinations, startDate, endDate, party } =
      useTripWizardStore.getState();
    return { destinations, startDate, endDate, party };
  }

  /** 프리필·목록 첫 조회가 끝난 눈금 — 이 뒤로 "새로 나간 요청"만 센다. */
  async function renderSettled() {
    const view = renderPage();
    await waitFor(() =>
      expect(
        screen.getByTestId('trip-wizard-summary-preference')
      ).toHaveTextContent(/미식/)
    );
    await waitFor(() => expect(hits(LIST_TRIPS)).toBe(1));
    await settle();
    return view;
  }

  async function openLeaveDialog() {
    const view = await renderSettled();
    tap('trip-wizard-step1-back');
    expect(screen.getByTestId('trip-wizard-leave-dialog')).toBeOnTheScreen();
    return view;
  }

  function navCalls() {
    return {
      back: mockRouter.back.mock.calls.length,
      replace: mockRouter.replace.mock.calls.length,
      push: mockRouter.push.mock.calls.length,
    };
  }

  describe('AC-1 · 여행을 안 만들었으면 지금처럼 바로 나간다 (무회귀)', () => {
    it('createdTripId 가 없으면 ‹ 한 번에 back 1회, 다이얼로그도 DELETE 도 없다', async () => {
      // 준비
      seedValidDraft();
      await renderSettled();

      // 실행
      tap('trip-wizard-step1-back');
      await settle();

      // 단언
      expect(screen.queryByTestId('trip-wizard-leave-dialog')).toBeNull();
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      expect(hits(DELETE_TRIP)).toBe(0);
    });
  });

  describe('🔴 AC-2 · 이미 만든 여행이 있으면 ‹ 는 묻기만 한다 (US-TRIP-10 확정 전 아무것도 안 지움)', () => {
    it('다이얼로그가 세 버튼과 함께 뜨고, 이동 0 · DELETE 0 이다', async () => {
      // 준비
      seedCreated();
      await renderSettled();

      // 실행
      tap('trip-wizard-step1-back');
      await settle();

      // 단언
      const dialog = screen.getByTestId('trip-wizard-leave-dialog');
      for (const id of [
        'trip-wizard-leave-save',
        'trip-wizard-leave-delete',
        'trip-wizard-leave-stay',
      ]) {
        expect(within(dialog).getByTestId(id)).toBeOnTheScreen();
      }
      expect(screen.queryByTestId('trip-wizard-leave-error')).toBeNull();
      expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
      expect(hits(DELETE_TRIP)).toBe(0);
    });
  });

  describe('🔴 AC-3 · [계속 작성]은 닫기만 한다', () => {
    it('다이얼로그가 사라지고 이동 0 · 새 요청 0, createdTripId·드래프트는 그대로다', async () => {
      // 준비
      seedCreated();
      await openLeaveDialog();
      const before = draftSnapshot();
      const requestsBefore = tracker.hits.length;

      // 실행
      tap('trip-wizard-leave-stay');
      await settle();

      // 단언
      expect(screen.queryByTestId('trip-wizard-leave-dialog')).toBeNull();
      expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
      expect(tracker.hits.length).toBe(requestsBefore);
      expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
      expect(draftSnapshot()).toEqual(before);
    });
  });

  describe('🔴 AC-4 · [저장하고 나가기]는 요청 없이 나간다', () => {
    it('back 1회 · DELETE 0, createdTripId 는 그대로다', async () => {
      // 준비
      seedCreated();
      await openLeaveDialog();

      // 실행
      tap('trip-wizard-leave-save');
      await settle();

      // 단언
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      expect(hits(DELETE_TRIP)).toBe(0);
      expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
    });

    // TRIP-1282 — [저장]도 누름 가드로 감싸져, 같은 틱 둘째 누름은 가드가 먼저 막는다. 사람 간격(가드 창 닫힘)
    // 줄을 더해 잠금(lockedRef)이 따로 막는지도 본다(AC-8 의 spaced 줄과 같은 짝).
    it.each<[string, boolean]>([
      ['같은 틱에 두 번', false],
      ['사람 간격으로 두 번(누름 가드 창 닫힘)', true],
    ])(
      '%s 눌러도 back 은 1회다 (01b Q7 — 위저드 진입 전 화면까지 빠지지 않는다)',
      async (_label, spaced) => {
        // 준비
        seedCreated();
        await openLeaveDialog();

        // 실행 — 연달아 누른다(spaced 면 그 사이 가드 창을 닫는다).
        const save = screen.getByTestId('trip-wizard-leave-save');
        fireEvent.press(save);
        if (spaced) resetPressGuard();
        fireEvent.press(save);
        await settle();

        // 단언
        expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      }
    );
  });

  describe('🔴 AC-4b · 뒤로 갈 곳이 없으면 홈으로 replace 한다 (결정 2 · HOME_FALLBACK 선례)', () => {
    it('[저장하고 나가기] → replace("/(tabs)") 1회 · back 0', async () => {
      // 준비
      mockRouter.canGoBack.mockImplementation(() => false);
      seedCreated();
      await openLeaveDialog();

      // 실행
      tap('trip-wizard-leave-save');
      await settle();

      // 단언
      expect(mockRouter.replace.mock.calls).toEqual([[HOME_FALLBACK]]);
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('[삭제하고 나가기] 204 → replace("/(tabs)") 1회 · back 0', async () => {
      // 준비
      mockRouter.canGoBack.mockImplementation(() => false);
      seedCreated();
      await openLeaveDialog();

      // 실행
      tap('trip-wizard-leave-delete');

      // 단언
      await waitFor(() =>
        expect(mockRouter.replace.mock.calls).toEqual([[HOME_FALLBACK]])
      );
      await settle();
      expect(mockRouter.replace).toHaveBeenCalledTimes(1);
      expect(mockRouter.back).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-5 · [삭제하고 나가기] 204 — 그 여행을 지우고 id 만 비운 뒤 나간다 (결정 3)', () => {
    it('DELETE /trips/{id} 정확히 1회 → createdTripId 가 비고 드래프트는 그대로, back 1회', async () => {
      // 준비
      seedCreated();
      await openLeaveDialog();
      const before = draftSnapshot();

      // 실행
      tap('trip-wizard-leave-delete');
      await settle();

      // 단언 ① — settle 한 번 뒤 바로: DELETE 가 정확히 1번(이 줄이 ★1 "settle 이면 충분" 의 증명이다).
      expect(hits(DELETE_TRIP)).toBe(1);

      // 단언 ② — 응답 뒤: 나가기 1번, id 만 비고 드래프트는 그대로.
      await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      expect(useTripWizardStore.getState().createdTripId).toBeUndefined();
      expect(draftSnapshot()).toEqual(before);
      expect(hits(DELETE_TRIP)).toBe(1);
    });
  });

  describe('🔴 AC-6 · 삭제가 실패하면 다이얼로그 안에서 알리고 머문다 (INV-4)', () => {
    it.each<[string, DeleteMode]>([
      ['서버 오류(500)', 500],
      ['네트워크 실패', 'network'],
    ])(
      '%s → 실패 문구 · 이동 0 · createdTripId 그대로, 다시 누르면 DELETE 를 다시 보낸다',
      async (_label, mode) => {
        // 준비
        deleteMode = mode;
        seedCreated();
        await openLeaveDialog();

        // 실행
        tap('trip-wizard-leave-delete');

        // 단언 ① — 다이얼로그 안에 실패 문구(완전 일치), 머문다.
        await waitFor(() =>
          expect(
            within(screen.getByTestId('trip-wizard-leave-dialog')).getByTestId(
              'trip-wizard-leave-error'
            )
          ).toHaveTextContent(ERROR_TEXT)
        );
        await settle();
        expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
        expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
        expect(hits(DELETE_TRIP)).toBe(1);

        // 실행 ② — "다시 시도해 주세요" 대로 다시 누른다.
        tap('trip-wizard-leave-delete');
        await settle();

        // 단언 ② — 잠금이 풀려 두 번째 DELETE 가 나갔다.
        expect(hits(DELETE_TRIP)).toBe(2);
      }
    );
  });

  describe('🔴 AC-7 · 404 는 "이미 없음" — 실패 문구 없이 나간다 (TRIP-1055 ③ 선례)', () => {
    it('DELETE 404 → createdTripId 가 비고 back 1회, 실패 문구는 없다', async () => {
      // 준비
      deleteMode = 404;
      seedCreated();
      await openLeaveDialog();

      // 실행
      tap('trip-wizard-leave-delete');

      // 단언
      await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
      await settle();
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      expect(useTripWizardStore.getState().createdTripId).toBeUndefined();
      expect(screen.queryByTestId('trip-wizard-leave-error')).toBeNull();
    });
  });

  describe('🔴 AC-8 · 삭제가 날아가는 중 [삭제]를 다시 눌러도 DELETE 는 1번이다', () => {
    it.each<[string, boolean]>([
      ['같은 틱 연타', false],
      ['사람 간격으로 다시 누름(누름 가드 창 닫힘)', true],
    ])('%s → DELETE 1 · 응답 뒤 이동 정확히 1회', async (_label, spaced) => {
      // 준비 — DELETE 응답을 문 뒤에 붙잡아 "진행 중" 을 만든다.
      deleteMode = 'gate';
      seedCreated();
      await openLeaveDialog();

      // 실행
      const del = screen.getByTestId('trip-wizard-leave-delete');
      fireEvent.press(del);
      if (spaced) resetPressGuard();
      fireEvent.press(del);
      await settle();

      // 단언 ① — 진행 중에 나간 DELETE 는 1번, 아직 안 나갔다.
      expect(hits(DELETE_TRIP)).toBe(1);
      expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });

      // 실행 ② — 응답을 보낸다.
      await act(async () => {
        openGates();
      });

      // 단언 ② — 끝난 뒤에도 DELETE 1번, 이동 1번.
      await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
      await settle();
      expect(hits(DELETE_TRIP)).toBe(1);
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
    });
  });

  describe('🔴 AC-10 · 삭제가 날아가는 중엔 [저장]·[계속 작성]도 잠긴다 (01b Q3 — 이중 이동 방지)', () => {
    it.each([
      ['[저장하고 나가기]', 'trip-wizard-leave-save'],
      ['[계속 작성]', 'trip-wizard-leave-stay'],
    ])(
      '%s 를 눌러도 이동 0 · 다이얼로그 유지, 응답 뒤 이동은 삭제 결과로 정확히 1회',
      async (_label, testID) => {
        // 준비 — 삭제를 붙잡아 둔다.
        deleteMode = 'gate';
        seedCreated();
        await openLeaveDialog();
        tap('trip-wizard-leave-delete');
        await settle();
        expect(hits(DELETE_TRIP)).toBe(1);

        // 실행 — 사람이 따로 다른 버튼을 누른다(누름 가드가 아니라 진행 중 잠금이 막아야 한다).
        tap(testID);
        await settle();

        // 단언 ① — 아무 데도 안 갔고 다이얼로그는 그대로다.
        expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
        expect(
          screen.getByTestId('trip-wizard-leave-dialog')
        ).toBeOnTheScreen();

        // 실행 ② — 삭제 응답(204)을 보낸다.
        await act(async () => {
          openGates();
        });

        // 단언 ② — 이동은 삭제 결과 하나뿐이다.
        await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
        await settle();
        expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
        expect(hits(DELETE_TRIP)).toBe(1);
      }
    );
  });

  describe('🔴 AC-11 · 지우면 내 여행 목록 캐시를 무효화한다 (01b Q4)', () => {
    it.each<[string, DeleteMode]>([
      ['204', 204],
      ['404', 404],
    ])(
      'DELETE %s → 살아 있는 목록이 GET /trips 를 다시 받는다',
      async (_label, mode) => {
        // 준비 — 목록 구독자가 이미 한 번 받아 둔 상태(renderSettled 가 1회를 확인).
        deleteMode = mode;
        seedCreated();
        await openLeaveDialog();
        expect(hits(LIST_TRIPS)).toBe(1);

        // 실행
        tap('trip-wizard-leave-delete');

        // 단언
        await waitFor(() => expect(hits(LIST_TRIPS)).toBe(2));
      }
    );
  });

  // TRIP-1282 ⑤ — [삭제하고 나가기] 연타의 둘째 탭이 다이얼로그가 닫힌 뒤 홈 여행 카드에 떨어져 라이브로 갔다(QA B-15).
  // 표적 반쪽(홈 카드가 열린 창에서 무시된다)은 HomePage.test.tsx 에 있다 — 두 화면을 잇는 것은 모듈 전역 창 하나뿐이다.
  // 시계는 다이얼로그가 뜬 뒤에 멈춘다(그 전의 프리필·목록 응답은 waitFor 로 기다린다). settle 은 실제 setTimeout 이라
  // 멈춘 Date.now 와 무관하다.
  describe('🔴 연타 관통 트리거 — 나가기 버튼은 창을 연다', () => {
    const FROZEN_NOW = 1_790_000_000_000;
    let clock: jest.SpyInstance | undefined;
    afterEach(() => clock?.mockRestore());

    /** 다음 화면의 "가드로 감싼 버튼" 대역 — 창이 열려 있으면 안 불린다. 부르는 순간 창을 연다(닫혀 있었다면). */
    function tapGuardedElsewhere(): jest.Mock {
      const handler = jest.fn();
      guardPress(handler)();
      return handler;
    }

    /** 다이얼로그를 띄우고 시계를 멈춘 뒤, 창이 닫혀 있음을 확인하고 다시 닫아 둔다. */
    async function openDialogFrozen(): Promise<void> {
      seedCreated();
      await openLeaveDialog();
      clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
      // 앵커 — 아직 창이 닫혀 있다(대역이 불린다). 대역이 연 창은 바로 닫는다.
      expect(tapGuardedElsewhere()).toHaveBeenCalledTimes(1);
      resetPressGuard();
    }

    it('[삭제하고 나가기] 204 → 위저드를 나가고, 창이 열려 다음 화면의 가드 버튼은 무시된다', async () => {
      await openDialogFrozen();

      fireEvent.press(screen.getByTestId('trip-wizard-leave-delete'));
      await settle();

      // 앵커 — 첫 탭은 제 할 일을 했다(지우고 나갔다).
      expect(hits(DELETE_TRIP)).toBe(1);
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      // 단언 — 창이 열려 있다.
      expect(tapGuardedElsewhere()).not.toHaveBeenCalled();
    });

    it('[삭제하고 나가기] 응답이 누른 뒤 400ms 를 넘겨 와도, 나가는 순간 창을 다시 열어 다음 화면의 가드 버튼은 무시된다', async () => {
      deleteMode = 'gate';
      await openDialogFrozen();

      // 실행 ① — 누른다(시각 T). 요청은 문 앞에서 기다린다.
      fireEvent.press(screen.getByTestId('trip-wizard-leave-delete'));
      await settle();
      expect(hits(DELETE_TRIP)).toBe(1);
      expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });

      // 실행 ② — 응답 전에 시계를 T+500 으로 옮긴다(누름이 연 창은 이미 닫혔다). 그다음 응답을 보낸다.
      clock?.mockReturnValue(FROZEN_NOW + 500);
      await act(async () => {
        openGates();
      });
      await settle();

      // 앵커 — 응답 뒤 나갔다.
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      // 단언 — 나가는 그 순간 열린 창 안이다.
      expect(tapGuardedElsewhere()).not.toHaveBeenCalled();
    });

    it('[저장하고 나가기] → 위저드를 나가고, 창이 열려 다음 화면의 가드 버튼은 무시된다', async () => {
      await openDialogFrozen();

      fireEvent.press(screen.getByTestId('trip-wizard-leave-save'));
      await settle();

      // 앵커 — 첫 탭은 제 할 일을 했다(요청 없이 나갔다).
      expect(hits(DELETE_TRIP)).toBe(0);
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      // 단언 — 창이 열려 있다.
      expect(tapGuardedElsewhere()).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-12 · 화면이 사라진 뒤 도착한 삭제 응답은 이동을 일으키지 않는다 (01b Q3)', () => {
    it('삭제 대기 중 언마운트(스와이프 이탈 흉내) → 응답 204 뒤 back·replace 0', async () => {
      // 준비
      deleteMode = 'gate';
      seedCreated();
      const view = await openLeaveDialog();
      tap('trip-wizard-leave-delete');
      await settle();
      expect(hits(DELETE_TRIP)).toBe(1);

      // 실행 — 화면이 먼저 사라지고, 그다음 응답이 온다.
      view.unmount();
      await act(async () => {
        openGates();
      });
      await settle();
      await settle();

      // 단언
      expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
    });
  });
});

/**
 * TRIP-1210 — 도시가 둘 이상인 여행은 앱이 제목을 지어 생성(POST)·수정(PATCH) 본문에 싣는다(실 HTTP 심판).
 *
 * 무엇을 보장하나:
 *  - 서울+부산이면 `POST /trips` 본문에도, 이미 만든 여행을 고치는 `PATCH /trips/{id}` 본문에도
 *    `title: '서울·부산 여행'`이 실린다. 서버는 제목이 없으면 생성·수정 **둘 다** 첫 도시로 다시 만들므로
 *    (`Trip.kt` resolveTitle) 한쪽만 실으면 그 길에서 `서울특별시 여행`으로 돌아간다 — 그래서 두 길을 따로 잰다.
 *  - 도시가 한 곳이면 지금처럼 제목 키를 싣지 않는다(서버 기본 제목 그대로, 01b 결정 1).
 *  - 두 도시가 본문 `destinations`에 순서대로 다 실리고, 끝 날짜는 시작 + 박수 합이다(AC-2).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청 본문"이다(msw 만 관찰). 제목 글자 규칙 자체는
 * `model/createTripRequest.test.ts` 가 잠그고, 여기서는 "화면이 그 제목을 두 요청에 실제로 싣는가"만 본다.
 *
 * ⚠️ 게스트로 돈다(담은목록 조회 없음). 모든 핸들러를 beforeEach 에 건다 — `onUnhandledRequest:'error'`.
 * 응답 순서 경합은 없다 — 제목은 [다음]을 누른 순간의 목적지로 조립되고, 응답을 기다려 다시 읽는 값이 아니다.
 */
describe('TRIP-1210 · 다도시 여행 제목이 생성·수정 본문에 실린다', () => {
  afterEach(expectNoExitWizard);

  const { preferenceHandler, renderPage } = wizardStep1Harness();

  /** openapi `Trip.required` 필드를 채운 응답. 응답 제목은 단언에 쓰지 않는다(보낸 본문만 본다). */
  const SEOUL_BUSAN_TRIP: Trip = {
    tripId: TRIP_ID,
    title: '서울·부산 여행',
    startDate: '2026-10-10',
    endDate: '2026-10-12',
    party: 1,
    companionType: null,
    budgetTotal: 800000,
    preferenceSnapshot: {},
    destinations: [
      { seq: 1, region: '서울특별시', nights: 1, regionCode: '11' },
      { seq: 2, region: '부산광역시', nights: 1, regionCode: '26' },
    ],
    status: 'PLANNED',
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };

  let postedBodies: Record<string, unknown>[] = [];
  let patchedBodies: Record<string, unknown>[] = [];

  beforeEach(() => {
    postedBodies = [];
    patchedBodies = [];
    useTripWizardStore.getState().reset();

    server.use(
      preferenceHandler({ styles: { value: ['미식'] } }),
      http.post(`${BASE}/trips`, async ({ request }) => {
        postedBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(SEOUL_BUSAN_TRIP, { status: 201 });
      }),
      http.patch(`${BASE}/trips/:tripId`, async ({ request }) => {
        patchedBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(SEOUL_BUSAN_TRIP);
      }),
      http.get(`${BASE}/trips/:tripId/must-visits`, () => HttpResponse.json([]))
    );
  });

  afterEach(() => {
    server.resetHandlers();
  });

  /** 지역 피커가 담는 것과 같은 모양(이름 + 지역 코드, 1박)으로 도시를 담고 10/10 을 시작으로 고른다. */
  function seedCities(cities: [string, string][]): void {
    const store = useTripWizardStore.getState();
    // "아직 0곳" 앵커 — 앞 테스트의 드래프트가 새면 여기서 red.
    expect(store.destinations).toHaveLength(0);
    cities.forEach(([name, code]) => store.addDestination(name, 1, code));
    store.setStartDate('2026-10-10');
  }

  /** 프리필이 도착한 눈금(요약 취향 행에 칩) 뒤 [다음]. */
  async function pressNext(): Promise<void> {
    await waitFor(() =>
      expect(
        screen.getByTestId('trip-wizard-summary-preference')
      ).toHaveTextContent(/미식/)
    );
    const next = screen.getByTestId('trip-wizard-step1-next');
    expect(next).toBeEnabled();
    fireEvent.press(next);
  }

  it('T-1 · 서울+부산으로 처음 만들면 POST 본문에 title "서울·부산 여행"과 두 도시가 실린다', async () => {
    // 준비
    seedCities([
      ['서울특별시', '11'],
      ['부산광역시', '26'],
    ]);
    renderPage();

    // 실행
    await pressNext();

    // 단언
    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(patchedBodies).toHaveLength(0);
    const body = postedBodies[0];
    expect(body.title).toBe('서울·부산 여행');
    expect(body).toMatchObject({
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      destinations: [
        { seq: 1, region: '서울특별시', nights: 1, regionCode: '11' },
        { seq: 2, region: '부산광역시', nights: 1, regionCode: '26' },
      ],
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
  });

  it('T-2 · 이미 만든 서울+부산 여행을 고칠 때도 PATCH 본문에 title "서울·부산 여행"이 실린다', async () => {
    // 준비 — 재진입(꼭 갈 곳 고르기를 다녀온 뒤 같은) 상태.
    seedCities([
      ['서울특별시', '11'],
      ['부산광역시', '26'],
    ]);
    useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
    renderPage();

    // 실행
    await pressNext();

    // 단언 — 새로 만들지 않고 고친다. 고치는 본문에도 제목이 있다.
    await waitFor(() => expect(patchedBodies).toHaveLength(1));
    expect(postedBodies).toHaveLength(0);
    expect(patchedBodies[0].title).toBe('서울·부산 여행');
    expect(
      (patchedBodies[0].destinations as { region: string }[]).map(
        (one) => one.region
      )
    ).toEqual(['서울특별시', '부산광역시']);
  });

  it('T-3 · 서울 한 곳이면 POST 본문에 title 키가 없다 (서버 기본 제목 그대로)', async () => {
    seedCities([['서울특별시', '11']]);
    renderPage();

    await pressNext();

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(Object.keys(postedBodies[0])).not.toContain('title');
    // 짝(긍정) — 본문 자체는 나갔고 도시가 실렸다(빈 본문이 부재 단언을 공짜로 통과하지 않게).
    expect(postedBodies[0]).toMatchObject({
      destinations: [{ seq: 1, region: '서울특별시', nights: 1 }],
    });
  });

  it('T-4 · 같은 도시를 두 번 담은 서울+부산+서울이면 제목은 "서울·부산 여행"이다', async () => {
    seedCities([
      ['서울특별시', '11'],
      ['부산광역시', '26'],
      ['서울특별시', '11'],
    ]);
    renderPage();

    await pressNext();

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0].title).toBe('서울·부산 여행');
    expect(postedBodies[0].destinations).toHaveLength(3);
  });
});

/**
 * TRIP-1234 R3-02 — 담은 장소로 넘어온 꼭 갈 곳 중 **이 여행 지역 밖**이 있으면 보이고, 사용자가 고른 대로 등록된다.
 *
 * 무엇을 보장하나(01b 결정 1~3):
 *  - 지역 밖(BR-U1-58 접두사 판정 `regionCodeInTrip`)이 있으면 [다음] 위에 안내 줄이 뜬다. 판정 불가(장소 코드 없음 ·
 *    목적지 코드 없음 · 목적지 0곳)는 안으로 친다(fail-open) — 안내 0.
 *  - 조용히 빼지 않는다(INV-4): 아무것도 안 누르면 시드가 그대로 등록되고 안내도 계속 보인다.
 *  - [빼기]는 스토어 시드에서 그 장소만 뺀다 → 스트립 카드·등록 요청(새 여행 POST · 재진입 DELETE)에서 빠진다.
 *  - [그대로 두기]는 안내만 걷는다. 그 뒤 **새로** 지역 밖이 생기면 다시 뜨고, 숫자는 지역 밖 전체다.
 *  - 화면이 떠 있는 동안 여행지·꼭 갈 곳이 바뀌면 안내가 따라간다(마운트 시점 스냅샷 금지 — 직전 사이클 교훈).
 *  - 앱은 대체 후보를 만들지 않는다(INV-1): 등록 요청은 시드에 있던 poiId 만 나른다.
 *
 * 왜 통합 버킷인가: 판정의 재료가 스토어(시드·목적지)이고 결과가 실제로 나간 요청이다 — 훅을 목하면 둘 다 가정이 된다.
 *
 * ⚠️ 함정(02a §4):
 *  - ★3 시드는 `seedMustVisits(담은 장소)` 를 거쳐 넣는다 — 시드가 지역 코드를 실어 나르는지(AC-1)까지 한 사슬로 탄다.
 *  - ★1 상태 변경은 `act(() => store.…)` 로 감싼다. 그린 **뒤에** 바꾸는 것이 이 describe 의 핵심이다.
 *  - ★4 시트 안내문과 하단 안내 줄이 같은 문구일 수 있다 → `within(testID)` 로만 찾는다.
 *  - ★6 "없다" 단언마다 같은 화면의 카드·버튼 존재를 짝으로 건다(화면이 안 그려져도 부재는 참이다).
 *  - ★7 프리필(요약 취향 행 "미식") 도착 뒤에 단언한다 — 그 전엔 스트립이 스켈레톤이다.
 *  - ★8 게스트로 돈다(토큰 없음 → 담은 목록 조회 없음). 시드는 스토어에 직접 넣는다.
 *
 * 장소 코드: 경복궁 `11110`(서울 안) · 광한루원 `52190`(전북 남원) · 해운대 `26350`(부산).
 *
 * 3동작 뼈대: 준비=목적지·시드 주입 + MSW → 실행=화면 열기·버튼 press·스토어 변경 → 단언=안내 문구·카드·나간 요청.
 */
describe('지역 밖 꼭 갈 곳 — 보이고, 고르면 반영된다', () => {
  afterEach(expectNoExitWizard);

  const { tracker, preferenceHandler, renderPage, waitForPrefill } =
    wizardStep1Harness();

  /** openapi `Trip.required` 를 채운 응답(서울 1박). */
  const SEOUL_TRIP: Trip = {
    tripId: TRIP_ID,
    title: '서울특별시 여행',
    startDate: '2026-10-10',
    endDate: '2026-10-11',
    party: 1,
    companionType: null,
    budgetTotal: 800000,
    preferenceSnapshot: {},
    destinations: [
      { seq: 1, region: '서울특별시', nights: 1, regionCode: '11' },
    ],
    status: 'PLANNED',
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };

  const GYEONGBOK = 'poi-gyeongbok';
  const GWANGHALLU = 'poi-gwanghallu';
  const HAEUNDAE = 'poi-haeundae';
  const NOCODE = 'poi-nocode';

  const MV_PATH = `/api/v1/trips/${TRIP_ID}/must-visits`;
  const PATCH = `PATCH /api/v1/trips/${TRIP_ID}`;

  /** 계약 `Place.required` 를 채운 담은 장소 — 지역 코드만 케이스마다 다르다. */
  function saved(poiId: string, nameKo: string, regionCode: string | null) {
    const place: Place = {
      poiId,
      nameKo,
      category: '명소',
      lat: 37.57,
      lng: 126.97,
      region: null,
      regionCode,
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    };
    const entry: SavedPlace = {
      savedPlaceId: `sp-${poiId}`,
      savedAt: '2026-08-01T10:00:00.000Z',
      place,
    };
    return entry;
  }

  const PLACES = {
    [GYEONGBOK]: saved(GYEONGBOK, '경복궁', '11110'),
    [GWANGHALLU]: saved(GWANGHALLU, '광한루원', '52190'),
    [HAEUNDAE]: saved(HAEUNDAE, '해운대 해수욕장', '26350'),
    [NOCODE]: saved(NOCODE, '코드 없는 곳', null),
  };

  /** d02 CTA 와 같은 길 — 담은 장소 → `seedMustVisits` → `seedMustVisitsFromD02`(★3). */
  function seedFromSaved(poiIds: string[]): void {
    useTripWizardStore
      .getState()
      .seedMustVisitsFromD02(
        seedMustVisits(poiIds.map((id) => PLACES[id as keyof typeof PLACES]))
      );
  }

  /** 지역 피커와 같은 모양(이름 + 코드, 1박)으로 도시를 담는다. 코드 없이 담으면 판정 불가(fail-open). */
  function addCity(name: string, code?: string): void {
    useTripWizardStore.getState().addDestination(name, 1, code);
  }

  let mustVisitPosts: { poiId: string; type: string }[] = [];
  /** 재진입(P-11) 가짜 서버에 등록된 꼭 갈 곳 — POST 가 더하고 DELETE 가 뺀다(★11). */
  let registered: MustVisit[] = [];
  /** P-10 — 손으로 붙잡는 생성 응답. null 이면 바로 응답한다. */
  let holdCreate: null | { release: () => void; started: boolean } = null;

  const hits = tracker.count;

  function mustVisitRow(poiId: string): MustVisit {
    return {
      mustVisitId: `mv-${poiId}`,
      poiSnapshotId: `snap-${poiId}`,
      sourcePoiId: poiId,
      type: 'ANYTIME',
    };
  }

  beforeEach(() => {
    // "아직 없다" 앵커 — 앞 테스트의 시드·목적지가 새면 여기서 red(★9).
    const store = useTripWizardStore.getState();
    expect(store.mustVisits).toHaveLength(0);
    expect(store.destinations).toHaveLength(0);

    mustVisitPosts = [];
    registered = [];
    holdCreate = null;

    server.use(
      preferenceHandler({ styles: { value: ['미식'] } }),
      http.post(`${BASE}/trips`, async () => {
        if (holdCreate !== null) {
          const gate = holdCreate;
          await new Promise<void>((resolve) => {
            gate.release = resolve;
            gate.started = true;
          });
        }
        return HttpResponse.json(SEOUL_TRIP, { status: 201 });
      }),
      http.patch(`${BASE}/trips/:tripId`, () => HttpResponse.json(SEOUL_TRIP)),
      http.get(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json(registered)
      ),
      http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
        const body = (await request.json()) as { poiId: string; type: string };
        mustVisitPosts.push(body);
        const row = mustVisitRow(body.poiId);
        registered = [...registered, row];
        return HttpResponse.json(row, { status: 201 });
      }),
      http.delete(
        `${BASE}/trips/:tripId/must-visits/:mustVisitId`,
        ({ params }) => {
          registered = registered.filter(
            (row) => row.mustVisitId !== params.mustVisitId
          );
          return new HttpResponse(null, { status: 204 });
        }
      )
    );
  });

  afterEach(() => {
    // 붙잡아 둔 생성 응답을 반드시 푼다 — 케이스가 중간에 red 로 끝나도 MSW 핸들러가 영원히 매달려
    // jest 가 끝나지 않는 일을 막는다(★10).
    holdCreate?.release();
    holdCreate = null;
    server.resetHandlers();
  });

  function notice() {
    return screen.queryByTestId('trip-wizard-outside-notice');
  }

  /** 안내 줄 본문이 정확히 "꼭 갈 곳 중 N곳은 이 여행 지역 밖이에요"인가(★5 — 본문만 완전 일치). */
  function expectNotice(count: number): void {
    const box = screen.getByTestId('trip-wizard-outside-notice');
    expect(
      within(box).getByText(`꼭 갈 곳 중 ${count}곳은 이 여행 지역 밖이에요`)
    ).toBeOnTheScreen();
  }

  function card(poiId: string) {
    return screen.queryByTestId(`trip-wizard-mustvisit-${poiId}`);
  }

  /** 서울(11) + 시작일 — [다음]이 열리는 최소 드래프트 + 시드 [경복궁, 광한루원]. */
  function seedSeoulWithNamwon(): void {
    addCity('서울특별시', '11');
    useTripWizardStore.getState().setStartDate('2026-10-10');
    seedFromSaved([GYEONGBOK, GWANGHALLU]);
  }

  function pressNext(): void {
    const next = screen.getByTestId('trip-wizard-step1-next');
    expect(next).toBeEnabled();
    fireEvent.press(next);
  }

  // AC-2 · AC-3
  it('P-1 · 서울 여행에 남원 장소가 시드돼 있으면 안내 줄이 "1곳"을 말하고, 두 카드는 그대로 남아 있다', async () => {
    // 준비
    seedSeoulWithNamwon();

    // 실행
    renderPage();
    await waitForPrefill();

    // 단언 — 지역 밖이 보인다. 조용히 빠지지도 않는다(카드 둘 다).
    expectNotice(1);
    expect(card(GYEONGBOK)).toBeOnTheScreen();
    expect(card(GWANGHALLU)).toBeOnTheScreen();
  });

  // AC-2 음성 — 판정 불가는 안으로 친다(BR-U1-58 fail-open). 판정을 지운 구현이면 여기서 red(선제 green 트립와이어).
  it.each([
    {
      name: '시드가 전부 서울 안',
      setup: () => {
        addCity('서울특별시', '11');
        seedFromSaved([GYEONGBOK]);
      },
      anchor: GYEONGBOK,
    },
    {
      name: '장소 코드가 없음',
      setup: () => {
        addCity('서울특별시', '11');
        seedFromSaved([NOCODE]);
      },
      anchor: NOCODE,
    },
    {
      name: '목적지에 코드가 없음',
      setup: () => {
        addCity('서울특별시');
        seedFromSaved([GWANGHALLU]);
      },
      anchor: GWANGHALLU,
    },
  ])(
    'P-2 · $name 이면 안내 줄이 없다 (짝: 카드는 있다)',
    async ({ setup, anchor }) => {
      setup();

      renderPage();
      await waitForPrefill();

      expect(card(anchor)).toBeOnTheScreen();
      expect(notice()).toBeNull();
    }
  );

  // AC-3 · 01b 결정 1 — 고르지 않으면 '그대로 두기'로 취급하되 안내는 계속 보인다.
  it('P-3 · 아무것도 안 고르고 [다음]을 누르면 막지 않고 두 곳 다 등록되며, 안내는 계속 보인다', async () => {
    seedSeoulWithNamwon();
    renderPage();
    await waitForPrefill();

    pressNext();

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mustVisitPosts.map((body) => body.poiId).sort()).toEqual(
      [GWANGHALLU, GYEONGBOK].sort()
    );
    expectNotice(1);
  });

  // AC-4 · AC-7
  it('P-4 · [빼기]를 누르면 남원 장소가 시드·스트립에서 빠지고, [다음] 뒤 등록 요청은 경복궁 하나뿐이다', async () => {
    seedSeoulWithNamwon();
    renderPage();
    await waitForPrefill();
    expectNotice(1);

    // 실행 — [빼기]
    fireEvent.press(screen.getByTestId('trip-wizard-outside-notice-remove'));

    // 단언 — 안내가 걷히고, 남원 카드가 사라지고, 경복궁은 남는다.
    await waitFor(() => expect(notice()).toBeNull());
    expect(card(GWANGHALLU)).toBeNull();
    expect(card(GYEONGBOK)).toBeOnTheScreen();
    expect(
      useTripWizardStore.getState().mustVisits.map((one) => one.sourcePoiId)
    ).toEqual([GYEONGBOK]);

    // 실행 — [다음]
    pressNext();

    // 단언 — 시드에 있던 poiId 만, 경복궁 하나(앱이 대체 후보를 만들지 않는다 · INV-1).
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mustVisitPosts).toEqual([{ poiId: GYEONGBOK, type: 'ANYTIME' }]);
  });

  // AC-4 · 01b 결정 3
  it('P-5 · [그대로 두기]를 누르면 안내만 걷히고 두 카드가 남으며, [다음] 뒤 두 곳 다 등록된다', async () => {
    seedSeoulWithNamwon();
    renderPage();
    await waitForPrefill();
    expectNotice(1);

    fireEvent.press(screen.getByTestId('trip-wizard-outside-notice-keep'));

    await waitFor(() => expect(notice()).toBeNull());
    expect(card(GWANGHALLU)).toBeOnTheScreen();
    expect(card(GYEONGBOK)).toBeOnTheScreen();

    pressNext();

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mustVisitPosts.map((body) => body.poiId).sort()).toEqual(
      [GWANGHALLU, GYEONGBOK].sort()
    );
  });

  // 교훈① — R3-02 의 실제 순서: d02 CTA 는 여행지 없이 오고, 여행지는 step1 이 떠 있는 동안 정해진다(★2).
  it('P-6 · 여행지 없이 시드만 온 화면에서 서울을 고르면 안내가 뜨고, 전북을 더하면 걷히고, 전북을 빼면 다시 뜬다', async () => {
    // 준비 — 목적지 0곳 + 남원 시드. 판정 불가라 처음엔 안내 없음.
    seedFromSaved([GWANGHALLU]);
    renderPage();
    await waitForPrefill();
    expect(card(GWANGHALLU)).toBeOnTheScreen();
    expect(notice()).toBeNull();

    // 실행 — 서울을 고른다(지역 피커가 하는 것과 같은 스토어 호출).
    act(() => addCity('서울특별시', '11'));
    await waitFor(() => expectNotice(1));

    // 실행 — 전북을 더한다 → 남원은 이제 여행 지역 안.
    act(() => addCity('전북특별자치도', '52'));
    await waitFor(() => expect(notice()).toBeNull());
    expect(card(GWANGHALLU)).toBeOnTheScreen();

    // 실행 — 전북(seq 2)을 뺀다 → 다시 밖.
    act(() => useTripWizardStore.getState().removeDestination(2));
    await waitFor(() => expectNotice(1));
  });

  // 교훈① — 꼭 갈 곳이 바뀌어도 숫자가 따라간다.
  it('P-7 · 지역 밖 2곳 중 하나를 빼면 "1곳", 나머지도 빼면 안내가 사라진다 (경복궁 카드는 남는다)', async () => {
    addCity('서울특별시', '11');
    seedFromSaved([GWANGHALLU, HAEUNDAE, GYEONGBOK]);
    renderPage();
    await waitForPrefill();
    expectNotice(2);

    act(() => useTripWizardStore.getState().removeMustVisit(HAEUNDAE));
    await waitFor(() => expectNotice(1));

    act(() => useTripWizardStore.getState().removeMustVisit(GWANGHALLU));
    await waitFor(() => expect(notice()).toBeNull());
    expect(card(GYEONGBOK)).toBeOnTheScreen();
  });

  // 01b 결정 1 — 그대로 두기는 "지금 본 것"에 대한 답이다. 새로 지역 밖이 생기면 다시 묻는다.
  it('P-8 · [그대로 두기] 뒤 새 지역 밖 장소가 들어오면 안내가 다시 뜨고, 숫자는 지역 밖 전체("2곳")다', async () => {
    addCity('서울특별시', '11');
    seedFromSaved([GWANGHALLU]);
    renderPage();
    await waitForPrefill();
    expectNotice(1);

    fireEvent.press(screen.getByTestId('trip-wizard-outside-notice-keep'));
    await waitFor(() => expect(notice()).toBeNull());

    // 실행 — 꼭 갈 곳 고르기에서 해운대가 더해진 것과 같은 스토어 문.
    act(() =>
      useTripWizardStore
        .getState()
        .addMustVisits(seedMustVisits([PLACES[HAEUNDAE]]))
    );

    await waitFor(() => expectNotice(2));
    expect(card(HAEUNDAE)).toBeOnTheScreen();
  });

  // AC-5 · 교훈① — 시트가 열린 채 여행지를 빼도 시트 안내문이 따라간다.
  it('P-9 · 여행지 시트에서 전북을 지우면 시트 안내문이 "그대로 남아요"에서 "1곳은 이 여행 지역 밖"으로 바뀐다', async () => {
    // 준비 — 서울 + 전북, 시드 [남원, 경복궁] → 지역 밖 0.
    addCity('서울특별시', '11');
    addCity('전북특별자치도', '52');
    seedFromSaved([GWANGHALLU, GYEONGBOK]);
    renderPage();
    await waitForPrefill();
    expect(notice()).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));
    const sheetNote = await screen.findByTestId('trip-wizard-destination-note');
    expect(sheetNote).toHaveTextContent(
      '꼭 갈 곳 2곳은 여행지를 바꿔도 그대로 남아요'
    );

    // 실행 — 시트의 전북(seq 2) ×
    fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-2'));

    // 단언 — 시트 안내문(★4: testID 로만)과 하단 안내 줄이 같이 바뀐다.
    await waitFor(() =>
      expect(
        screen.getByTestId('trip-wizard-destination-note')
      ).toHaveTextContent('꼭 갈 곳 중 1곳은 이 여행 지역 밖이에요')
    );
    expectNotice(1);
  });

  // 응답 순서 gate — 여행 생성 응답을 기다리는 동안 [빼기]를 눌러도 등록은 마지막 선택을 따른다(★10).
  it('P-10 · [다음] 뒤 생성 응답이 오기 전에 [빼기]를 누르면, 응답 뒤 등록은 경복궁 하나뿐이다', async () => {
    seedSeoulWithNamwon();
    holdCreate = { release: () => {}, started: false };
    renderPage();
    await waitForPrefill();

    // 실행 — [다음], 생성 요청이 출발했지만 응답은 붙잡혀 있다.
    pressNext();
    await waitFor(() => expect(holdCreate?.started).toBe(true));
    expect(mustVisitPosts).toHaveLength(0);

    // 실행 — 대기 중 [빼기]. 공용 연타 가드 창이 있다면 닫아 둔다(엉뚱한 이유의 red 방지).
    resetPressGuard();
    fireEvent.press(screen.getByTestId('trip-wizard-outside-notice-remove'));
    await waitFor(() => expect(card(GWANGHALLU)).toBeNull());

    // 실행 — 응답을 푼다.
    await act(async () => {
      holdCreate?.release();
    });

    // 단언
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mustVisitPosts).toEqual([{ poiId: GYEONGBOK, type: 'ANYTIME' }]);
  });

  // AC-4 PATCH 재진입 경로 — 이미 만든 여행의 서버 꼭 갈 곳도 [빼기]를 따른다(★11).
  it('P-11 · 재진입에서 [빼기] 뒤 [다음]이면 남원 꼭 갈 곳만 DELETE 되고 새 등록은 없다', async () => {
    // 준비 — 서버에 경복궁·광한루원이 이미 등록돼 있고, 시드도 같다.
    registered = [mustVisitRow(GYEONGBOK), mustVisitRow(GWANGHALLU)];
    seedSeoulWithNamwon();
    useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
    renderPage();
    await waitForPrefill();
    expectNotice(1);

    // 실행
    fireEvent.press(screen.getByTestId('trip-wizard-outside-notice-remove'));
    await waitFor(() => expect(notice()).toBeNull());
    pressNext();

    // 단언
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(hits(PATCH)).toBe(1);
    expect(hits(`DELETE ${MV_PATH}/mv-${GWANGHALLU}`)).toBe(1);
    expect(hits(`DELETE ${MV_PATH}/mv-${GYEONGBOK}`)).toBe(0);
    expect(mustVisitPosts).toHaveLength(0);
  });
});

/**
 * TRIP-1308 — 일과 시간(하루 시작 · 첫날 시작 · 마지막 날 종료) 배선.
 *  - 안 정하면 요청에 세 키가 **없다**(빈 문자열·00:00 으로 채우지 않는다).
 *  - 행 → 시트 → 적용이 행 요약에 반영되고, 정한 값만 POST 에 실린다. 다시 열면 값이 보인다.
 *  - 이미 만든 여행의 PATCH(대체 의미)에도 같은 값이 실린다.
 *  - 깨진 창(당일치기 역전)은 [다음]을 막고 행이 이유를 알린다.
 * 시트 실제 개폐·휠 제스처는 jest 사각(6-b).
 */
describe('일과 시간 (TRIP-1308)', () => {
  afterEach(expectNoExitWizard);

  const {
    tracker,
    preferenceHandler,
    createTripHandler,
    renderPage,
    next,
    seedValidDraft,
    waitForPrefill,
    openSheet,
  } = wizardStep1Harness();

  let patched: Record<string, unknown>[] = [];

  beforeEach(() => {
    patched = [];
    mockPush.mockReset();
    useTripWizardStore.getState().reset();
    server.use(
      preferenceHandler(),
      createTripHandler(),
      http.patch(`${BASE}/trips/:tripId`, async ({ request }) => {
        patched.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(TRIP);
      }),
      http.get(`${BASE}/trips/:tripId/must-visits`, () => HttpResponse.json([]))
    );
  });

  afterEach(() => {
    server.resetHandlers();
  });

  const KEYS = ['dayStartAt', 'firstDayStartAt', 'lastDayEndAt'];

  it('안 건드리면 행은 "09:00 시작 · 기본"이고 POST 본문에 세 키가 없다', async () => {
    seedValidDraft();
    renderPage();
    await waitForPrefill();

    const row = screen.getByTestId('trip-wizard-summary-daywindow');
    expect(within(row).getByText('09:00 시작')).toBeTruthy();
    expect(
      screen.getByTestId('trip-wizard-summary-daywindow-sub')
    ).toHaveTextContent('기본');

    fireEvent.press(next());
    await waitFor(() => expect(tracker.postedBodies).toHaveLength(1));
    for (const key of KEYS) {
      expect(key in tracker.postedBodies[0]).toBe(false);
    }
  });

  it('첫날 14:00 을 적용하면 행이 바뀌고 POST 에는 그 값만 실리며, 다시 열면 값이 보인다', async () => {
    seedValidDraft();
    renderPage();
    await waitForPrefill();

    await openSheet('daywindow');
    fireEvent.press(screen.getByTestId('trip-wizard-daywindow-tab-first'));
    fireEvent.press(screen.getByTestId('trip-wizard-daywindow-wheel-h-14'));
    fireEvent.press(screen.getByTestId('trip-wizard-daywindow-apply'));

    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull()
    );
    expect(
      screen.getByTestId('trip-wizard-summary-daywindow-sub')
    ).toHaveTextContent('첫날 14:00부터');

    // 왕복 — 다시 열면 입력한 값이 그대로 보인다.
    await openSheet('daywindow');
    expect(
      screen.getByTestId('trip-wizard-daywindow-tab-first-value')
    ).toHaveTextContent('14:00');
    fireEvent.press(screen.getByTestId('trip-wizard-daywindow-apply'));

    fireEvent.press(next());
    await waitFor(() => expect(tracker.postedBodies).toHaveLength(1));
    expect(tracker.postedBodies[0].firstDayStartAt).toBe('14:00');
    expect('dayStartAt' in tracker.postedBodies[0]).toBe(false);
    expect('lastDayEndAt' in tracker.postedBodies[0]).toBe(false);
  });

  it('이미 만든 여행의 PATCH 에도 정한 값이 실린다', async () => {
    seedValidDraft();
    useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
    useTripWizardStore
      .getState()
      .setDayWindow({ dayStartAt: '11:00', lastDayEndAt: '16:00' });
    renderPage();
    await waitForPrefill();

    fireEvent.press(next());
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].dayStartAt).toBe('11:00');
    expect(patched[0].lastDayEndAt).toBe('16:00');
    expect('firstDayStartAt' in patched[0]).toBe(false);
    expect(tracker.postedBodies).toHaveLength(0);
  });

  // TRIP-1509 — 기간을 안 골랐으면(박수 0 은 기본값) 시트가 "당일치기라" 를 단정하지 않는다. 고른 뒤 당일이면 그대로.
  it('기간 미선택이면 일과 시간 시트 부제에 "당일치기라" 가 없다', async () => {
    useTripWizardStore.getState().addDestination('부산', 0);
    renderPage();
    await waitForPrefill();

    await openSheet('daywindow');
    expect(
      screen.queryByText('당일치기라 시작과 종료를 함께 정해요')
    ).toBeNull();
    expect(screen.getByText('시작과 종료 시각을 정해요')).toBeTruthy();
  });

  it('기간을 하루로 골랐으면 시트 부제는 "당일치기라 …" 그대로다', async () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 0);
    store.setPeriod(undefined, '2026-06-10', '2026-06-10');
    renderPage();
    await waitForPrefill();

    await openSheet('daywindow');
    expect(
      screen.getByText('당일치기라 시작과 종료를 함께 정해요')
    ).toBeTruthy();
  });

  it('당일치기에서 끝 ≤ 시작이면 [다음]이 닫히고 행이 확인 안내를 단다', async () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 0);
    store.setPeriod(undefined, '2026-06-10', '2026-06-10');
    store.setDayWindow({ firstDayStartAt: '18:00', lastDayEndAt: '10:00' });
    renderPage();
    await waitForPrefill();

    expect(next()).toBeDisabled();
    expect(
      screen.getByTestId('trip-wizard-summary-daywindow-sub')
    ).toHaveTextContent('시작·종료 시각을 확인해 주세요');

    // 고치면 풀린다 — 시트에서 끝을 늦춘다.
    await openSheet('daywindow');
    fireEvent.press(screen.getByTestId('trip-wizard-daywindow-end-h-20'));
    fireEvent.press(screen.getByTestId('trip-wizard-daywindow-apply'));
    await waitFor(() => expect(next()).toBeEnabled());
  });
});
