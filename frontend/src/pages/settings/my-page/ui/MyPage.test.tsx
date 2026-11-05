import { act, fireEvent, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import type {
  Trip,
  TripRecordList,
  TripRecordSummary,
  StyleAnalysisEnvelope,
} from '@/shared/api/index.schemas';
import { useGetMe } from '@/shared/api/index.hooks';
import { useGetMeProfile } from '@/shared/api/index.hooks';
import { useGetMeStyle } from '@/shared/api/index.hooks';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetMeRecords,
  useGetTrips,
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import {
  CONFIRMED_COLS,
  DURING,
  FUTURE,
  PAST,
  PLANNED_COLS,
  myPageTrip,
} from '@/test-support/myPageItineraries';
import { renderWithQueryClient, settle } from '@/test-support/queryRender';
import { guardPress, resetPressGuard } from '@/shared/lib/pressGuard';
import { MyPage } from './MyPage';
import { ChevronRight24Glyph, ChevronRightGlyph } from '@/shared/ui/glyphs';
import {
  SettingsBookmarkGlyph,
  SettingsHeartGlyph,
} from '@/features/settings/ui/SettingsGlyphs';
import { routerSpies } from '@/test-support/expoRouterMock';
import { NO_ITINERARY } from '@/test-support/tripItineraryCols';

/**
 * l03 마이 — MyPage 배선을 생성 훅 목으로 보는 node 버킷 테스트(msw 없음).
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `MyPage.{counts,l03empty,l03parity}.test.tsx` 와 이름만 integration 이던
 * `MyPage.{integration,styleDetail.integration}.test.tsx`(msw 0)를 각자의 바깥 describe 로 옮겼다.
 *  - 생성 훅 목은 옛 순수 팩토리의 합집합이다. 옛 integration 2개는 `requireActual` 위에 덮었지만 여행 0건이라
 *    나머지 export 에 닿지 않는다.
 *  - expo-router 목은 push·replace 둘이다. 옛 `.styleDetail` 목엔 `replace` 가 없어 그 관점에서 replace 를 부르면
 *    TypeError 로 red 였다 — 그 그물을 그 describe 의 `afterEach` "replace 0회" 단언으로 옮겼다.
 *  - 목 함수의 구현은 `jest.clearAllMocks` 로 안 지워진다 — 최상위 `beforeEach` 가 생성 훅 목 전부를 비우고,
 *    각 관점이 자기 beforeEach 에서 다시 건다.
 *  - 옛 `.l03empty` 의 INV-3 "소요시간 0건" 렌더 it 은 남긴다 — 지난 여행 카드 VM 의 `nightsLabel` 은 자유
 *    문자열이라 페이지가 거기에 소요시간을 지어 넣는 길이 실재하고, 그 결함을 잡는 것은 이 it 뿐이다(실측).
 */

const { push: mockPush, replace: mockReplace } = routerSpies;
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace'],
  })
);

jest.mock('@/shared/api/generated/account/account', () => ({
  useGetMe: jest.fn(),
}));
jest.mock('@/shared/api/generated/profile/profile', () => ({
  useGetMeProfile: jest.fn(),
}));
jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  useGetMeStyle: jest.fn(),
}));
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetMeRecords: jest.fn(),
  getGetTripsTripIdItineraryQueryOptions: jest.fn(),
  // 카드별 훅 — 마이페이지는 부르지 않는다(부르면 옛 .counts·.l03empty 앵커가 잡는다).
  useGetTripsTripIdBases: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

const HOOK_MODULES = [
  '@/shared/api/generated/account/account',
  '@/shared/api/generated/profile/profile',
  '@/shared/api/generated/reflection/reflection',
  '@/shared/api/generated/trips/trips',
];

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  for (const modulePath of HOOK_MODULES) {
    for (const fn of Object.values(
      jest.requireMock<Record<string, jest.Mock>>(modulePath)
    )) {
      fn.mockReset();
    }
  }
});
// 연타 가드 창은 모듈 싱글턴 — 칸마다 한 번씩 누르는 테스트가 앞 테스트의 창에 먹히지 않게 닫는다(TRIP-1282).
afterEach(() => resetPressGuard());

// TRIP-1123
/** 조회 결과 모양(`{ data, isPending, isError }`)의 목 — 다섯 관점 describe 가 각자 복사해 쓰던 것(TRIP-1355). */
function asQuery<T>(data: T): never {
  return { data, isPending: false, isError: false } as never;
}

/** 정식 분석 envelope — 배선이 실제로 이 값을 카드까지 흘려보내는지 본다. 평균 값만 관점별로 갈린다. */
function officialEnvelope(
  over: { avgPlacesPerDay?: number; avgRadiusKm?: number } = {}
): StyleAnalysisEnvelope {
  return {
    official: true,
    progress: { current: 14, required: 10 },
    analysis: {
      descriptors: ['#바다', '#미식'],
      traitGauges: { easygoing: 4, foodAffinity: 4, activeness: 3 },
      categoryBreakdown: [],
      avgPlacesPerDay: over.avgPlacesPerDay ?? 3.2,
      avgRadiusKm: over.avgRadiusKm ?? 5.1,
      sampleTripCount: 6,
      updatedAt: '2026-08-28T09:00:00Z',
    },
    preview: null,
  };
}

function renderPage() {
  return renderWithQueryClient(<MyPage />);
}

describe('숫자 3칸 → 탭 · 지난 여행 열림 (옛 .counts)', () => {
  /**
   * TRIP-1123 · l03 마이페이지 — 목록·CTA 제거, 숫자 3칸 → 탭 이동, 집계에서 초안 제외(QA-2026-09-29 #28·#29).
   *
   * 규칙(01b 확정 결정): 숫자는 **일정이 확정된 여행만** 센다 — 서울 오늘 기준 시작 전 = 예정, 기간 안 = 진행 중,
   * 끝난 뒤 = 종료. 초안(미확정·일정 없음 404)은 어느 칸에도 안 센다. 서버 `Trip.status`(날짜 파생, 초안도 ACTIVE)는
   * 보지 않는다. 일정 상태는 `GET /trips` 목록의 네 칸(`itineraryStatus` 등)에서 읽는다(TRIP-1677 — 여행별 일정 조회 없음).
   * 목록을 기다리는 중이거나 받아 둔 목록이 없는데 실패했으면 판정할 수 없으니 **세 칸 모두 `–`**(INV-4).
   *
   * 무엇을 보장하나:
   *  - AC-1·AC-2 세그·여행 카드·[새 여행 만들기]·빈 문구가 없다(여행이 있든 없든). 지난 여행 섹션은 남는다(결정 2(b)).
   *  - AC-3 QA 재현: 기간 안 4건(확정 1·미확정 1·404 2) → 진행 중 1(4 아님).
   *  - AC-4 확정 미래·기간 안·과거 1건씩 + 같은 날짜의 초안 1건씩 → 1 · 1 · 1.
   *  - AC-1(TRIP-1677) 진입에서 여행별 일정 조회 옵션을 만들지 않는다(= 일정 GET 0회).
   *  - AC-5 모름(여행 목록 대기 · 받아 둔 목록 없이 실패) → 세 칸 모두 `–`. **받아 둔 목록이 있는데 다시 받다(폴링 틱) 실패하면 숫자를 그대로 둔다**
   *    (옛 "다시 받다 실패하면 –" 는 뒤집혔다 — 오류는 data 가 없을 때만 오류).
   *  - AC-6 예정·진행 중 칸 → `router.replace('/itinerary')`, 종료 칸 → `router.replace('/records')`, 각 1회, push 0.
   *    모름(`–`)이어도 똑같이 이동한다.
   *  - AC-8 지난 여행 = 확정 && 종료, 예정 0건일 때만. 날짜 지난 초안 카드는 없고 카드 수 = 종료 숫자.
   *    모르면 섹션도 없고 `/me/records` 조회도 꺼 둔다. 캘린더 › 는 여전히 push('/records').
   *
   * 왜 이렇게 테스트하나: 조회 훅(계정·프로필·스타일·여행 목록·사진 수)은 목이고, 목록의 `Trip` 이 일정 네 칸을 직접 들고 있다.
   * 시계는 흉내 내지 않는다 — 기간 안 2020~2099 · 과거 2026-06 · 미래 2099-06.
   * 일정 단건 조회(`useGetTripsTripIdItinerary`·`getGetTripsTripIdItineraryQueryOptions`)는 목으로 두고 **안 불린다**를 본다(훅 목 파일이라
   * 요청 로그로는 못 센다 — 호출 0 이 앵커다).
   *
   * 탭 루트에서 부르는 replace 의 실제 탭 전환·hitSlop 효과는 jest 사각 — 6-b 몫.
   */

  const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
  const mockUseProfile = useGetMeProfile as jest.MockedFunction<
    typeof useGetMeProfile
  >;
  const mockUseStyle = useGetMeStyle as jest.MockedFunction<
    typeof useGetMeStyle
  >;
  const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
  const mockUseRecords = useGetMeRecords as jest.MockedFunction<
    typeof useGetMeRecords
  >;
  const mockQueryOptions = getGetTripsTripIdItineraryQueryOptions as jest.Mock;
  const mockUseBases = useGetTripsTripIdBases as jest.Mock;
  const mockUseCardItinerary = useGetTripsTripIdItinerary as jest.Mock;

  const EN_DASH = '–';
  const BUCKETS = ['upcoming', 'active', 'ended'] as const;

  /** 여행 목록을 건다 — 일정 상태는 각 `Trip` 의 네 칸(`CONFIRMED_COLS`/`PLANNED_COLS`/기본 없음)이 말한다. */
  function script(trips: Trip[]): void {
    mockUseTrips.mockReturnValue(
      asQuery(trips) as ReturnType<typeof useGetTrips>
    );
  }
  /** 확정 일정이 있는 여행 / 확정 전 초안 일정이 있는 여행 / 일정 없음(기본). */
  const withConfirmed = (over: Partial<Trip> = {}): Partial<Trip> => ({
    ...CONFIRMED_COLS,
    ...over,
  });
  const withDraft = (over: Partial<Trip> = {}): Partial<Trip> => ({
    ...PLANNED_COLS,
    ...over,
  });

  /** 세 칸 숫자 자리 글자 — [예정, 진행 중, 종료]. */
  function values(): string[] {
    return BUCKETS.map((bucket) => {
      const node = screen.getByTestId(`my-profile-count-${bucket}-value`);
      return String(node.props.children);
    });
  }

  /** 지난 여행 카드 루트 — `my-trip-reflection-{id}` 이되 썸네일·사진 하위 testID 는 뺀다. */
  function pastCardRoots(): ReactTestInstance[] {
    return screen
      .queryAllByTestId(/^my-trip-reflection-/)
      .filter((node) => !/-(thumb|photo)$/.test(String(node.props.testID)));
  }

  /** 페이지가 마지막으로 `/me/records` 훅에 넘긴 enabled 값. */
  function lastRecordsEnabled(): unknown {
    const calls = mockUseRecords.mock.calls;
    const options = calls[calls.length - 1]?.[1] as
      { query?: { enabled?: unknown } } | undefined;
    return options?.query?.enabled;
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockUseBases.mockClear();
    mockUseCardItinerary.mockClear();
    mockQueryOptions.mockReset();
    mockUseRecords.mockReset();
    mockUseMe.mockReturnValue(
      asQuery({ email: 'a@b.c' }) as ReturnType<typeof useGetMe>
    );
    mockUseProfile.mockReturnValue(
      asQuery({ nickname: '테스터' }) as ReturnType<typeof useGetMeProfile>
    );
    mockUseStyle.mockReturnValue(
      asQuery(undefined) as ReturnType<typeof useGetMeStyle>
    );
    mockUseRecords.mockReturnValue(
      asQuery(undefined) as ReturnType<typeof useGetMeRecords>
    );
    script([]);
  });

  // ── AC-1·AC-2 제거 ─────────────────────────────────────────────────────

  describe('🔴 AC-1 · 여행이 있어도 세그·여행 카드·CTA 가 없다', () => {
    it('확정 미래 여행 2건 → 세그 0 · 여행 카드 0 · [새 여행 만들기] 없음, 숫자는 예정 2', async () => {
      // 준비
      script([
        myPageTrip('u1', FUTURE, withConfirmed()),
        myPageTrip('u2', FUTURE, withConfirmed()),
      ]);

      // 실행
      renderPage();
      await settle();

      // 단언(부재)
      expect(screen.queryAllByTestId(/^my-trip-segment/)).toHaveLength(0);
      expect(screen.queryAllByTestId(/^my-trip-card-/)).toHaveLength(0);
      expect(screen.queryByTestId('my-create-trip')).toBeNull();
      expect(screen.queryByTestId('my-create-trip-plus')).toBeNull();
      expect(screen.queryByText('새 여행 만들기')).toBeNull();
      // 단언(존재 짝) — 숫자는 실제로 셌다.
      expect(values()).toEqual(['2', '0', '0']);
    });

    it('🔴 TRIP-1677 AC-1 · 진입해도 여행별 일정 조회를 만들지 않는다(여행 3건, 일정 단건 옵션·훅 호출 0)', async () => {
      // 준비 — 상태가 다른 여행 셋. 일정 상태는 목록의 네 칸에 이미 실려 있다.
      script([
        myPageTrip('u1', FUTURE, withConfirmed()),
        myPageTrip('d1', DURING, withDraft()),
        myPageTrip('n1', PAST),
      ]);

      // 실행
      renderPage();
      await settle();

      // 단언 — 앵커: 숫자는 목록 칸만으로 셌다(예정 1 · 진행 0 · 종료 0). 그리고 일정 단건 조회는 한 번도 안 만들었다.
      expect(values()).toEqual(['1', '0', '0']);
      expect(mockQueryOptions).not.toHaveBeenCalled();
      expect(mockUseCardItinerary).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-2 · 여행 0건이어도 CTA·빈 문구가 없고 지난 여행 안내는 남는다', () => {
    it('여행 0건 → CTA·"예정된 여행이 없어요" 없음, "지난 여행" + "아직 종료된 여행이 없어요"는 있다', async () => {
      script([]);

      renderPage();
      await settle();

      expect(screen.queryByTestId('my-create-trip')).toBeNull();
      expect(screen.queryAllByText(/예정된 여행이 없어요/)).toHaveLength(0);
      expect(screen.getByText('지난 여행')).toBeOnTheScreen();
      expect(screen.getByText('아직 종료된 여행이 없어요')).toBeOnTheScreen();
      expect(values()).toEqual(['0', '0', '0']);
    });
  });

  // ── AC-3·AC-4 집계 ─────────────────────────────────────────────────────

  describe('🔴 AC-3 · QA 재현 — 초안은 진행 중에 안 센다', () => {
    it('기간 안 4건(확정 1 · 미확정 1 · 404 2) → 예정 0 · 진행 중 1 · 종료 0 (4 아님)', async () => {
      // 준비 — 서버 status 는 넷 다 ACTIVE(날짜 파생). 옛 사영이면 진행 중 4.
      script([
        myPageTrip('a', DURING, withConfirmed({ status: 'ACTIVE' })),
        myPageTrip('b', DURING, withDraft({ status: 'ACTIVE' })),
        myPageTrip('c', DURING, { status: 'ACTIVE' }),
        myPageTrip('d', DURING, { status: 'ACTIVE' }),
      ]);

      // 실행
      renderPage();
      await settle();

      // 단언
      expect(values()).toEqual(['0', '1', '0']);
    });
  });

  describe('🔴 AC-4 · 세 칸 — 확정만, 서버 status 무시', () => {
    it('확정 미래·기간 안·과거 1건씩 + 같은 날짜 초안 1건씩 → 1 · 1 · 1', async () => {
      // 준비 — 초안의 서버 status 는 날짜대로(PLANNED·ACTIVE·ENDED) 둔다: status 로 세면 2 · 2 · 2.
      script([
        myPageTrip('cf', FUTURE, withConfirmed({ status: 'CONFIRMED' })),
        myPageTrip('cd', DURING, withConfirmed({ status: 'ACTIVE' })),
        myPageTrip('cp', PAST, withConfirmed({ status: 'ENDED' })),
        myPageTrip('df', FUTURE, withDraft({ status: 'PLANNED' })),
        myPageTrip('dd', DURING, { status: 'ACTIVE' }), // 일정 없음(옛 404)
        myPageTrip('dp', PAST, withDraft({ status: 'ENDED' })),
      ]);

      renderPage();
      await settle();

      expect(values()).toEqual(['1', '1', '1']);
      // 페이지는 카드별 훅도, 일정 단건 조회도 만들지 않는다(목록 칸만 읽는다).
      expect(mockUseCardItinerary).not.toHaveBeenCalled();
      expect(mockUseBases).not.toHaveBeenCalled();
      expect(mockQueryOptions).not.toHaveBeenCalled();
    });
  });

  // ── AC-5 모름 ──────────────────────────────────────────────────────────

  describe('🔴 AC-5 · 모르면 세 칸 모두 – (INV-4) — 모름은 "목록 자체를 모름" 하나다', () => {
    // 일정 상태가 목록에 실려 한꺼번에 오므로 옛 "여행별 일정 대기·500" 모름(ⓐ ⓑ)은 사라졌다 — 삭제한 케이스 4개:
    // 일정 대기 / 대기 풀림 / 일정 500 / 받아 둔 일정이 있는데 다시 받다 500.

    it('ⓒ 여행 목록(GET /trips)이 아직 안 왔으면 – · – · – (0 · 0 · 0 아님)', async () => {
      mockUseTrips.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      } as unknown as ReturnType<typeof useGetTrips>);

      renderPage();
      await settle();

      expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
    });

    it("ⓒ' 받아 둔 목록 없이 조회가 실패했으면 – · – · –", async () => {
      mockUseTrips.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        error: { isAxiosError: true, response: { status: 500 } },
      } as unknown as ReturnType<typeof useGetTrips>);

      renderPage();
      await settle();

      expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
    });

    it("🔴 ⓒ'' 폴링 틱 오류 — 받아 둔 목록이 있는데 다시 받다 실패해도 숫자를 그대로 둔다 (오류는 data 가 없을 때만)", async () => {
      // 준비 — 옛 목록(확정 미래 1 · 확정 종료 1)이 남은 채 다시 받기가 500 으로 실패했다(셸의 목록 폴링 틱이 실패한 상황).
      // 개념: TanStack 은 재조회가 실패해도 마지막 성공 data 를 남긴 채 isError=true 로 알린다.
      mockUseTrips.mockReturnValue({
        data: [
          myPageTrip('u1', FUTURE, withConfirmed()),
          myPageTrip('e1', PAST, withConfirmed()),
        ],
        isPending: false,
        isError: true,
        error: { isAxiosError: true, response: { status: 500 } },
      } as unknown as ReturnType<typeof useGetTrips>);

      // 실행
      renderPage();
      await settle();

      // 단언 — 세 칸이 `–` 로 뒤집히지 않는다(예정 1 · 진행 0 · 종료 1).
      expect(values()).toEqual(['1', '0', '1']);
    });
  });

  // ── AC-6 이동 ──────────────────────────────────────────────────────────

  describe('🔴 AC-6 · 숫자 칸 → 탭 이동 (replace, push 0)', () => {
    it.each([
      ['upcoming', '/itinerary'],
      ['active', '/itinerary'],
      ['ended', '/records'],
    ] as const)(
      '%s 칸을 누르면 router.replace(%p) 정확히 1회, push 0회',
      async (bucket, href) => {
        // 준비 — 숫자를 아는 상태(확정 미래 1).
        script([myPageTrip('u1', FUTURE, withConfirmed())]);
        renderPage();
        await settle();

        // 실행
        fireEvent.press(screen.getByTestId(`my-profile-count-${bucket}`));

        // 단언
        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledWith(href);
        expect(mockPush).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['upcoming', '/itinerary'],
      ['active', '/itinerary'],
      ['ended', '/records'],
    ] as const)(
      '모름(–)이어도 %s 칸은 같은 곳(%p)으로 간다',
      async (bucket, href) => {
        mockUseTrips.mockReturnValue({
          data: undefined,
          isPending: true,
          isError: false,
        } as unknown as ReturnType<typeof useGetTrips>);
        renderPage();
        await settle();
        // 앵커 — 정말 모름 상태다.
        expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);

        fireEvent.press(screen.getByTestId(`my-profile-count-${bucket}`));

        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledWith(href);
        expect(mockPush).not.toHaveBeenCalled();
      }
    );
  });

  // TRIP-1282 ④ — 마이 "예정" 연타의 둘째 탭이 일정 탭 여행 카드에 떨어진다(QA A-02). 표적 반쪽(카드가 열린 창에서
  // 무시된다)은 TripCardContainer.test.tsx 에 있다 — 두 화면을 잇는 것은 모듈 전역 창 하나뿐이다.
  describe('연타 관통 트리거 — 숫자 칸은 창을 연다', () => {
    const FROZEN_NOW = 1_790_000_000_000;
    let clock: jest.SpyInstance | undefined;
    afterEach(() => clock?.mockRestore());

    /** 다음 화면의 "가드로 감싼 버튼" 대역 — 창이 열려 있으면 안 불린다. 부르는 순간 창을 연다(닫혀 있었다면). */
    function tapGuardedElsewhere(): jest.Mock {
      const handler = jest.fn();
      guardPress(handler)();
      return handler;
    }

    it('"예정" 칸을 누르면 일정 탭으로 1회 replace 하고, 창이 열려 다음 화면의 가드 버튼은 무시된다', async () => {
      script([myPageTrip('u1', FUTURE, withConfirmed())]);
      renderPage();
      await settle();
      clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
      // 앵커 — 아직 창이 닫혀 있다(대역이 불린다). 대역이 연 창은 바로 닫는다.
      expect(tapGuardedElsewhere()).toHaveBeenCalledTimes(1);
      resetPressGuard();

      fireEvent.press(screen.getByTestId('my-profile-count-upcoming'));

      // 앵커 — 첫 탭은 제 할 일을 했다.
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/itinerary');
      // 단언 — 창이 열려 있다.
      expect(tapGuardedElsewhere()).not.toHaveBeenCalled();
    });
  });

  // ── AC-8 지난 여행 ─────────────────────────────────────────────────────

  describe('🔴 AC-8 · 지난 여행 = 확정 && 종료, 예정 0건일 때만', () => {
    it('ⓐ 확정 미래 여행이 1건이면 지난 여행 섹션이 없다(확정 종료가 있어도)', async () => {
      script([
        myPageTrip('u1', FUTURE, withConfirmed()),
        myPageTrip('e1', PAST, withConfirmed()),
      ]);

      renderPage();
      await settle();

      expect(screen.queryByText('지난 여행')).toBeNull();
      expect(pastCardRoots()).toHaveLength(0);
      // 짝 앵커 — 숫자는 떴다(판정이 끝났다).
      expect(values()).toEqual(['1', '0', '1']);
      // TRIP-1790 개정 — 섹션이 닫혀도 records 조회는 켜 둔다(누적 통계가 같은 응답을 쓴다). 옛 단언은 `false`(섹션과 같이 꺼짐)였다.
      // 켜는 기준은 섹션이 아니라 "여행 목록을 받았나"다 — 모르는 상태에서 꺼지는 쪽은 아래 ⓒ 가 지킨다.
      expect(lastRecordsEnabled()).toBe(true);
    });

    it('ⓑ 예정 0 · 확정 종료 2 · 날짜 지난 초안 1 → 카드 2장(종료일 최근순), 초안 카드 없음, 종료 숫자와 같다', async () => {
      // 준비 — 초안의 서버 status 는 ENDED(날짜 파생). 옛 기준이면 카드 3장.
      script([
        myPageTrip(
          'old',
          { startDate: '2025-10-03', endDate: '2025-10-05' },
          withConfirmed({ status: 'ENDED' })
        ),
        myPageTrip('draft', PAST, withDraft({ status: 'ENDED' })),
        myPageTrip('recent', PAST, withConfirmed({ status: 'ENDED' })),
      ]);

      renderPage();
      await settle();

      expect(screen.getByText('지난 여행')).toBeOnTheScreen();
      expect(pastCardRoots().map((n) => String(n.props.testID))).toEqual([
        'my-trip-reflection-recent',
        'my-trip-reflection-old',
      ]);
      expect(screen.queryByTestId('my-trip-reflection-draft')).toBeNull();
      expect(values()).toEqual(['0', '0', '2']);
      // 섹션이 열렸으니 사진 수 조회는 켜져 있다.
      expect(lastRecordsEnabled()).toBe(true);
    });

    it("ⓑ' 미래 초안(미확정)만 있으면 예정 0 이라 지난 여행 섹션이 열린다", async () => {
      script([
        myPageTrip('df', FUTURE, withDraft()),
        myPageTrip('e1', PAST, withConfirmed()),
      ]);

      renderPage();
      await settle();

      expect(screen.getByText('지난 여행')).toBeOnTheScreen();
      expect(pastCardRoots()).toHaveLength(1);
    });

    it('ⓒ 모름(여행 목록 대기)이면 섹션이 없고 /me/records 조회도 꺼져 있다', async () => {
      // 준비 — 목록이 아직 안 왔다(여행별 일정 대기는 사라졌고, 모름은 목록 대기·받아 둔 목록 없는 실패뿐이다).
      mockUseTrips.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      } as unknown as ReturnType<typeof useGetTrips>);

      renderPage();
      await settle();

      expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
      expect(screen.queryByText('지난 여행')).toBeNull();
      expect(pastCardRoots()).toHaveLength(0);
      expect(lastRecordsEnabled()).toBe(false);
    });

    it('캘린더 › 는 여전히 push("/records") 1회, 회고 카드는 /trips/{id}/records (기존 계약)', async () => {
      script([myPageTrip('e1', PAST, withConfirmed())]);
      renderPage();
      await settle();

      fireEvent.press(screen.getByTestId('my-past-calendar'));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/records');
      expect(mockReplace).not.toHaveBeenCalled();

      mockPush.mockClear();
      fireEvent.press(screen.getByTestId('my-trip-reflection-e1'));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe('/trips/e1/records');
    });
  });

  // TRIP-1639
  describe('🔴 마이 탭을 연 채 자정(KST)을 넘기면 숫자 3칸이 새 날로 바뀐다', () => {
    /** 가짜 시계를 ms 만큼 흘리고 그 사이 약속(일정 조회)을 함께 푼다 — settle() 은 진짜 setTimeout 이라 가짜 시계 아래선 멈춘다. */
    async function advance(ms: number): Promise<void> {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    }

    it('10-13 23:59 에 진행 중 1이던 확정 여행이 61초 뒤(10-14)엔 종료 1이 되고, 지난 여행 섹션이 열린다', async () => {
      // 준비 — KST 2026-10-13 23:59:00 (= UTC 14:59). 확정 여행 하나가 오늘(10-13)까지 진행 중.
      jest.useFakeTimers({ now: new Date('2026-10-13T14:59:00Z') });
      try {
        mockUseTrips.mockReturnValue(
          asQuery([
            myPageTrip(
              'night',
              { startDate: '2026-10-11', endDate: '2026-10-13' },
              withConfirmed()
            ),
          ]) as ReturnType<typeof useGetTrips>
        );
        renderPage();
        await advance(100);

        // 앵커 — 자정 전: [예정, 진행 중, 종료] = 0·1·0 이고 지난 여행 섹션은 닫혀 있다.
        expect(values()).toEqual(['0', '1', '0']);
        expect(pastCardRoots()).toHaveLength(0);

        // 실행 — 자정을 넘긴다.
        await advance(61_000);

        // 단언 ① 같은 여행이 진행 중에서 종료로 옮겨 간다.
        expect(values()).toEqual(['0', '0', '1']);
        // 단언 ② 종료 숫자와 같은 "지난 여행" 카드가 열린다(예정 0건이라 섹션이 열리는 규칙).
        expect(pastCardRoots().map((n) => String(n.props.testID))).toEqual([
          'my-trip-reflection-night',
        ]);
        // 단언 ③ — 오늘이 바뀌어도 일정 단건 조회는 만들어지지 않는다(목록 칸만 읽는다).
        expect(mockQueryOptions).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

// TRIP-776
describe('지난 여행 카드 (옛 .l03empty)', () => {
  /**
   * TRIP-776 · l03 마이페이지 empty(Figma 1603:2414) — 실 MyPage 를 그려 "지난 여행" 섹션의 썸네일 카드를 본다.
   *
   * 무엇을 보장하나:
   *  - AC-3 예정 0건일 때 "지난 여행" 섹션의 종료 여행은 **썸네일형 카드**다: 제목(`trip.title`) · 날짜
   *    `2026.5.1–5.3`(연도·en dash) · 썸네일 자리 · chevron. 옛 칩 카드(`my-trip-card-*`, 숙소·일정 칩,
   *    `5.1~5.3`)는 이 섹션에 없다. 소요시간 글자 0(INV-3).
   *  - AC-3b "사진 N" 은 `GET /me/records` 의 `photoCount` 를 **tripId 로** 붙인 실데이터다. 응답 전·실패·
   *    그 여행이 목록에 없음·0장이면 사진 글자 없이 날짜만 보인다(가짜 숫자 0, INV-4).
   *  - AC-4 카드 전체가 회고 진입 버튼(`my-trip-reflection-{id}`)이고 누르면 `/trips/{id}/records` 로 1회.
   *  - AC-5 지난 여행 카드는 카드마다 숙소·일정 **카드 훅**을 부르지 않는다(썸네일 카드엔 두 값이 없다).
   *    (TRIP-1677 부터는 집계용 여행별 일정 조회도 없다 — 목록 칸만 읽는다.)
   *  - (옛 Q3=A '종료' 탭 목록과 1012-B1 [새 여행 만들기]는 TRIP-1123 에서 세그·CTA 가 사라져 지웠다 —
   *    부재는 `MyPage.counts.test.tsx` AC-1·AC-2 가 잰다.)
   *
   * 왜 이렇게 테스트하나: 조회 훅만 목으로 응답을 넣고 모델·화면·카드는 실물이 돈다(775 l03parity 와 같은
   * 장치). `jest.mock` 팩토리는 파일 맨 위로 끌어올려져 먼저 실행되므로 바깥 변수를 못 쓴다 — 이름이
   * `mock` 으로 시작하는 `mockPush` 만 예외로 허용된다.
   * TRIP-1123: 지난 여행 = **일정 확정** && 종료라, 픽스처 여행마다 확정 일정 네 칸을 싣는다(`setTrips` 가 `CONFIRMED_COLS` 를 펼친다).
   *
   * ⚠️ `useGetMeRecords` 목은 **가공 전 응답**(`TripRecordList`)을 그대로 돌려준다. 훅 옵션 `select` 로
   *    모양을 바꾸는 구현은 목에서 `select` 가 안 돌아 깨진다 — 페이지가 `data.items` 를 직접 읽어야 한다.
   */

  const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
  const mockUseProfile = useGetMeProfile as jest.MockedFunction<
    typeof useGetMeProfile
  >;
  const mockUseStyle = useGetMeStyle as jest.MockedFunction<
    typeof useGetMeStyle
  >;
  const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
  const mockUseBases = useGetTripsTripIdBases as jest.MockedFunction<
    typeof useGetTripsTripIdBases
  >;
  const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
    typeof useGetTripsTripIdItinerary
  >;
  const mockUseRecords = useGetMeRecords as jest.MockedFunction<
    typeof useGetMeRecords
  >;
  type RecordsResult = ReturnType<typeof useGetMeRecords>;

  /** 소요시간 탐지기(TripCardContainer.test 와 같은 식) — 일수·거리는 안 걸리고 "분·시간·소요"만 걸린다. */
  const DURATION = /소요|\d+\s*분|\d+\s*시간/;

  function ended(tripId: string, over: Partial<Trip> = {}): Trip {
    return {
      tripId,
      title: '제주 여행',
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'ENDED',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
      ...NO_ITINERARY,
      ...over,
    };
  }

  const JEJU = ended('e-jeju');
  const GANGNEUNG = ended('e-gn', {
    title: '강릉 여행',
    startDate: '2026-04-18',
    endDate: '2026-04-20',
  });
  const BUSAN = ended('e-bs', {
    title: '부산 여행',
    startDate: '2025-10-03',
    endDate: '2025-10-05',
  });

  function summary(trip: Trip, photoCount: number): TripRecordSummary {
    return {
      tripId: trip.tripId,
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      regions: trip.destinations.map((d) => d.region),
      visitCount: 5,
      photoCount,
    };
  }

  /** 여행 목록 + 여행마다 **확정** 일정 네 칸(지난 여행 기준 = 확정 && 종료, TRIP-1123). */
  function setTrips(data: Trip[]): void {
    mockUseTrips.mockReturnValue(
      asQuery(
        data.map((trip) => ({ ...trip, ...CONFIRMED_COLS }))
      ) as ReturnType<typeof useGetTrips>
    );
  }

  /** 그리고 여행별 일정 조회가 끝날 때까지 기다린다. */
  async function renderPage(): Promise<void> {
    renderWithQueryClient(<MyPage />);
    await settle();
  }

  function setRecords(result: {
    data: TripRecordList | undefined;
    isPending: boolean;
    isError: boolean;
  }): void {
    mockUseRecords.mockReturnValue(result as unknown as RecordsResult);
  }

  function recordsOf(items: TripRecordSummary[]) {
    return { data: { items }, isPending: false, isError: false };
  }

  /** 지난 여행 카드 루트 — `my-trip-reflection-{id}` 이되 썸네일·사진 하위 testID 는 뺀다. */
  function pastCardRoots(): ReactTestInstance[] {
    return screen
      .queryAllByTestId(/^my-trip-reflection-/)
      .filter((node) => !/-(thumb|photo)$/.test(String(node.props.testID)));
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockUseBases.mockClear();
    mockUseItinerary.mockClear();
    mockUseMe.mockReturnValue(
      asQuery({ email: 'a@b.c' }) as ReturnType<typeof useGetMe>
    );
    mockUseProfile.mockReturnValue(
      asQuery({ nickname: '테스터' }) as ReturnType<typeof useGetMeProfile>
    );
    mockUseStyle.mockReturnValue(
      asQuery(undefined) as ReturnType<typeof useGetMeStyle>
    );
    setTrips([]);
    mockUseBases.mockReturnValue(
      asQuery([]) as ReturnType<typeof useGetTripsTripIdBases>
    );
    mockUseItinerary.mockReturnValue(
      asQuery({ days: [{ date: '2026-05-01', slots: [] }] }) as ReturnType<
        typeof useGetTripsTripIdItinerary
      >
    );
    // 기본 = 응답 전(사진 수 모름).
    setRecords({ data: undefined, isPending: true, isError: false });
  });

  describe('🔴 AC-3 · 지난 여행은 썸네일형 카드', () => {
    it('제목 · 날짜 2026.5.1–5.3 · 썸네일 자리 · chevron 이 있고, 옛 칩 카드는 없다', async () => {
      // 준비: 예정 0 · 종료 1 → "지난 여행" 섹션이 보이는 조건(775 §F-3 A안).
      setTrips([JEJU]);

      // 실행
      await renderPage();

      // 단언(긍정)
      expect(screen.getByText('지난 여행')).toBeOnTheScreen();
      const card = screen.getByTestId('my-trip-reflection-e-jeju');
      expect(within(card).getByText('제주 여행')).toBeOnTheScreen();
      expect(within(card).getByText('2026.5.1–5.3')).toBeOnTheScreen();
      expect(
        within(card).getByTestId('my-trip-reflection-e-jeju-thumb')
      ).toBeOnTheScreen();
      // chevron — 어느 층의 ChevronRightGlyph 든 하나 이상(글리프 선택은 구현 자유).
      const chevrons =
        card.findAllByType(ChevronRightGlyph).length +
        card.findAllByType(ChevronRight24Glyph).length;
      expect(chevrons).toBeGreaterThanOrEqual(1);

      // 단언(부정): 옛 칩 카드 · 숙소/일정 칩 · M.D~M.D 표기가 이 섹션에 없다.
      expect(screen.queryByTestId('my-trip-card-e-jeju')).toBeNull();
      expect(within(card).queryAllByText(/숙소|일정/)).toHaveLength(0);
      expect(within(card).queryAllByText(/~/)).toHaveLength(0);
    });

    it('실제 페이지 조립이 compact 변형을 고른다 — 썸네일 64, j07 의 72 아님', async () => {
      // 준비: 예정 0 · 종료 1. 프리뷰는 카드를 따로 조립하므로 MyPage 경로는 여기서만 본다.
      setTrips([JEJU]);

      // 실행
      await renderPage();

      // 단언: className 을 공백으로 쪼갠 배열에 대한 toContain 은 원소 완전 일치다.
      const thumb = String(
        screen.getByTestId('my-trip-reflection-e-jeju-thumb').props.className
      ).split(/\s+/);
      expect(thumb).toContain('h-[64px]');
      expect(thumb).toContain('w-[64px]');
      expect(thumb).not.toContain('h-[72px]');
    });

    it('INV-3 — 카드 글자에 소요시간(분·시간·소요) 표기가 0건이다', async () => {
      setTrips([JEJU]);
      setRecords(recordsOf([summary(JEJU, 24)]));

      await renderPage();

      // 탐지기 자가검사(짝) — 실제 소요시간은 잡히고, 날짜·사진 수는 안 잡힌다.
      expect('도보 15분').toMatch(DURATION);
      expect('2026.5.1–5.3').not.toMatch(DURATION);
      expect('사진 24').not.toMatch(DURATION);

      const card = screen.getByTestId('my-trip-reflection-e-jeju');
      expect(within(card).queryAllByText(DURATION)).toHaveLength(0);
      // 짝 앵커 — 카드 글자는 실제로 있다.
      expect(within(card).getByText('제주 여행')).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-3b · "사진 N" = /me/records photoCount 를 tripId 로 붙인다', () => {
    it('카드마다 제 여행의 사진 수가 뜬다(응답 순서가 카드 순서와 달라도)', async () => {
      // 준비: 응답 items 순서를 카드 순서(종료일 최근순: 제주·강릉·부산)와 일부러 어긋나게 둔다.
      setTrips([BUSAN, JEJU, GANGNEUNG]);
      setRecords(
        recordsOf([
          summary(BUSAN, 30),
          summary(JEJU, 24),
          summary(GANGNEUNG, 16),
        ])
      );

      await renderPage();

      (
        [
          ['e-jeju', '사진 24'],
          ['e-gn', '사진 16'],
          ['e-bs', '사진 30'],
        ] as const
      ).forEach(([tripId, label]) => {
        const card = screen.getByTestId(`my-trip-reflection-${tripId}`);
        expect(within(card).getByText(label)).toBeOnTheScreen();
        // 카드마다 사진 글자는 딱 하나(남의 수가 섞이지 않는다).
        expect(within(card).queryAllByText(/사진/)).toHaveLength(1);
      });
    });

    it.each([
      ['응답 전', { data: undefined, isPending: true, isError: false }],
      ['조회 실패', { data: undefined, isPending: false, isError: true }],
      ['그 여행이 목록에 없음', recordsOf([summary(BUSAN, 30)])],
      ['사진 0장', recordsOf([summary(JEJU, 0)])],
    ] as const)(
      '%s 이면 사진 글자 없이 날짜만 보인다(가짜 숫자 0)',
      async (_label, result) => {
        setTrips([JEJU]);
        setRecords(result);

        await renderPage();

        const card = screen.getByTestId('my-trip-reflection-e-jeju');
        expect(within(card).queryAllByText(/사진/)).toHaveLength(0);
        // 짝 앵커 — 카드와 날짜는 그대로다.
        expect(within(card).getByText('2026.5.1–5.3')).toBeOnTheScreen();
      }
    );
  });

  describe('🔴 AC-4 · 회고 진입 계약 유지(새 카드 경로로 재조준)', () => {
    it('카드 전체가 회고 진입 버튼이고, 누르면 /trips/{id}/records 로 정확히 1회', async () => {
      setTrips([JEJU]);
      await renderPage();

      const card = screen.getByTestId('my-trip-reflection-e-jeju');
      expect(card.props.accessibilityRole).toBe('button');
      // 썸네일형 카드다(옛 칩 카드의 작은 chevron 버튼이 아니다).
      expect(
        within(card).getByTestId('my-trip-reflection-e-jeju-thumb')
      ).toBeOnTheScreen();

      fireEvent.press(card);

      // String() — 목적지는 문자열 href 여야 한다(객체면 [object Object] 로 red).
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe('/trips/e-jeju/records');
    });
  });

  describe('🔴 AC-5 · 지난 여행 카드는 숙소·일정 카드 훅을 부르지 않는다', () => {
    it('종료 3건을 그려도 카드별 숙소·일정 훅이 한 번도 불리지 않는다', async () => {
      // 준비: 예정 0 · 종료 3(모두 확정) — 카드는 지난 여행 섹션에만 있다.
      setTrips([JEJU, GANGNEUNG, BUSAN]);

      await renderPage();

      // 짝 앵커 — 카드 3장이 실제로 그려졌다(안 그려져서 조회가 0인 것을 막는다).
      expect(pastCardRoots()).toHaveLength(3);
      expect(mockUseBases).not.toHaveBeenCalled();
      expect(mockUseItinerary).not.toHaveBeenCalled();
    });
  });
});

// TRIP-775
describe('Figma 배선 결과 (옛 .l03parity)', () => {
  /**
   * TRIP-775 · l03 마이페이지 배선 ↔ Figma 1602:2388 — 실 MyPage 를 그려 조회→화면 결과를 본다.
   *
   * 무엇을 보장하나:
   *  - AC-1 프로필 태그 출처: 정식이면 `analysis.descriptors`, 미달이면 온보딩 취향 미리보기
   *    (`preview.descriptors`)만 쓴다. **TRIP-1076 결정 1(A)로 TRIP-775 Seed Q4=A 를 뒤집었다** — Figma l03
   *    style-insufficient(4533:2424)가 미달에도 태그를 보인다. '정식 아님'(BR-U5-40)은 스타일 카드가 계속
   *    미달 얼굴(안내 한 줄, 칩·게이지 없음)로 말한다.
   *  - AC-4 페이지는 스타일 헤드라인을 주입하지 않는다(서버 필드 없음, 계약 공백).
   *  - (AC-6 "지난 여행" 노출 규칙은 TRIP-1123 에서 확정 && 종료 기준으로 바뀌어 `MyPage.counts.test.tsx` AC-8 로 옮겼다.)
   *  - AC-7 메뉴는 정확히 3행(등록 숙소 / 여행 스타일 분석 / 설정)이고, 첫 행 아이콘은
   *    북마크가 아니다(침대). 행 배선은 `MyPage.integration.test.tsx` B-1 이 진다.
   *
   * 왜 이렇게 테스트하나: 조회 훅(계정·프로필·스타일·여행 목록·카드별 숙소/일정)만 목으로 응답을 넣고
   * 나머지(모델·화면·카드)는 실물이 돈다. `jest.mock` 팩토리는 파일 맨 위로 끌어올려져 먼저 실행되므로
   * 바깥 변수를 참조하지 않고 `jest.fn()` 만 만든 뒤, import 한 훅을 캐스팅해서 값을 넣는다.
   * TRIP-1123: 페이지가 여행별 일정을 `useQueries` 로 부르므로 `QueryClientProvider` 가 필요하다(여행 0건이어도
   * `useQueries` 는 Provider 없이 던진다). 이 파일은 여행 0건만 쓰므로 일정 옵션 함수는 불리지 않는다.
   */

  const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
  const mockUseProfile = useGetMeProfile as jest.MockedFunction<
    typeof useGetMeProfile
  >;
  const mockUseStyle = useGetMeStyle as jest.MockedFunction<
    typeof useGetMeStyle
  >;
  const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
  const mockUseBases = useGetTripsTripIdBases as jest.MockedFunction<
    typeof useGetTripsTripIdBases
  >;
  const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
    typeof useGetTripsTripIdItinerary
  >;
  const mockUseRecords = useGetMeRecords as jest.MockedFunction<
    typeof useGetMeRecords
  >;

  /** 미달 — 정식 분석 없음, 온보딩 취향 미리보기만 있다. */
  function insufficientEnvelope(): StyleAnalysisEnvelope {
    return {
      official: false,
      progress: { current: 5, required: 10 },
      analysis: null,
      preview: { descriptors: ['#바다', '#미식', '#느긋'] },
    };
  }

  function setStyle(data: StyleAnalysisEnvelope | undefined): void {
    mockUseStyle.mockReturnValue(
      asQuery(data) as ReturnType<typeof useGetMeStyle>
    );
  }

  function setTrips(data: Trip[]): void {
    mockUseTrips.mockReturnValue(
      asQuery(data) as ReturnType<typeof useGetTrips>
    );
  }

  beforeEach(() => {
    mockUseMe.mockReturnValue(
      asQuery({ email: 'a@b.c' }) as ReturnType<typeof useGetMe>
    );
    mockUseProfile.mockReturnValue(
      asQuery({ nickname: '테스터' }) as ReturnType<typeof useGetMeProfile>
    );
    setStyle(undefined);
    setTrips([]);
    mockUseBases.mockReturnValue(
      asQuery([]) as ReturnType<typeof useGetTripsTripIdBases>
    );
    mockUseItinerary.mockReturnValue(
      asQuery({ days: [{ date: '2026-06-10', slots: [] }] }) as ReturnType<
        typeof useGetTripsTripIdItinerary
      >
    );
    mockUseRecords.mockReturnValue(
      asQuery(undefined) as ReturnType<typeof useGetMeRecords>
    );
  });

  describe('AC-1 · 프로필 태그 출처(TRIP-1076 결정 1(A) — 미달이면 preview)', () => {
    it('정식 분석이면 analysis.descriptors 가 프로필 카드 안 태그로 순서대로 뜬다', () => {
      // 준비
      setStyle(officialEnvelope());

      // 실행
      renderWithQueryClient(<MyPage />);

      // 단언: 스타일 카드 칩에도 같은 글자가 있으므로 프로필 카드 안에서만 찾는다.
      const profile = screen.getByTestId('my-profile-card');
      const tags = within(profile).getAllByTestId('my-profile-tag');
      expect(tags).toHaveLength(2);
      expect(tags[0]).toHaveTextContent('#바다');
      expect(tags[1]).toHaveTextContent('#미식');
    });

    it('🔴 미달이면 preview.descriptors 가 프로필 태그로 뜨고, 스타일 카드는 여전히 미달 얼굴이다 (AC-5)', () => {
      // 준비: 미달 — 정식 분석 없음, 온보딩 취향 미리보기 3개.
      setStyle(insufficientEnvelope());

      // 실행
      renderWithQueryClient(<MyPage />);

      // 단언 ①: 프로필 카드 안 태그 3개, 순서 그대로.
      const profile = screen.getByTestId('my-profile-card');
      const tags = within(profile).getAllByTestId('my-profile-tag');
      expect(tags).toHaveLength(3);
      expect(tags[0]).toHaveTextContent('#바다');
      expect(tags[1]).toHaveTextContent('#미식');
      expect(tags[2]).toHaveTextContent('#느긋');

      // 단언 ②(금지 — BR-U5-40): 스타일 카드는 '정식 아님' 얼굴 그대로 — 안내 한 줄, 칩·게이지 없음.
      const card = screen.getByTestId('my-style-card');
      expect(
        within(card).getByText('10곳 이상 쌓이면 분석을 제공해요 (현재 5곳)')
      ).toBeOnTheScreen();
      expect(within(card).queryAllByTestId('my-style-chip')).toHaveLength(0);
      expect(within(card).queryAllByTestId('my-style-gauge')).toHaveLength(0);
    });

    it('🔴 미달(official:false)이면 analysis.descriptors 가 차 있어도 그 값은 안 쓰고 preview 만 쓴다', () => {
      // 준비: 계약상 official·analysis 는 서로 독립 nullable 이라 이 조합이 올 수 있다(BR-U5-40).
      // analysis 쪽 글자를 preview 와 다르게 둬야 "어느 출처에서 왔나"가 갈린다(02a ★10).
      const official = officialEnvelope();
      setStyle({
        ...insufficientEnvelope(),
        analysis: official.analysis
          ? { ...official.analysis, descriptors: ['#도심', '#쇼핑'] }
          : null,
      });

      // 실행
      renderWithQueryClient(<MyPage />);

      // 단언: 태그는 preview 3개(순서 그대로), analysis 글자는 화면 어디에도 없다.
      const tags = within(screen.getByTestId('my-profile-card')).getAllByTestId(
        'my-profile-tag'
      );
      expect(tags).toHaveLength(3);
      expect(tags[0]).toHaveTextContent('#바다');
      expect(tags[1]).toHaveTextContent('#미식');
      expect(tags[2]).toHaveTextContent('#느긋');
      expect(screen.queryByText('#도심')).toBeNull();
      expect(screen.queryByText('#쇼핑')).toBeNull();
    });

    it('미달이고 preview 가 null 이면 태그 줄이 없다', () => {
      setStyle({ ...insufficientEnvelope(), preview: null });

      renderWithQueryClient(<MyPage />);

      // 단언: 태그 0. 짝 앵커 = 프로필 카드는 그려졌다(카드째 사라져 공짜 통과하는 것을 막는다).
      expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
      expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    });

    it('스타일 응답이 없으면 태그 줄이 없다', () => {
      setStyle(undefined);

      renderWithQueryClient(<MyPage />);

      expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
      expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    });
  });

  describe('AC-4 · 헤드라인은 주입하지 않는다(계약 공백)', () => {
    it('정식 스타일 카드를 그려도 헤드라인 문장 자리가 없다', () => {
      setStyle(officialEnvelope());

      renderWithQueryClient(<MyPage />);

      expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-style-headline')).toBeNull();
    });
  });

  describe('AC-7 · 메뉴 3행(Seed Q1=A)', () => {
    it('메뉴 카드의 글자는 정확히 [등록 숙소, 여행 스타일 분석, 설정] 이다', () => {
      renderWithQueryClient(<MyPage />);

      const menu = screen.getByTestId('my-menu-card');
      // 호스트 Text 만 센다(합성 Text 는 type 이 객체라 'Text' 문자열과 같지 않다).
      const labels = menu
        .findAll((node) => (node.type as string) === 'Text')
        .map((node) => String(node.props.children));

      expect(labels).toEqual(['등록 숙소', '여행 스타일 분석', '설정']);
    });

    it('첫 행 아이콘은 북마크가 아니다(Figma 침대)', () => {
      renderWithQueryClient(<MyPage />);

      expect(screen.UNSAFE_queryAllByType(SettingsBookmarkGlyph)).toHaveLength(
        0
      );
      // 짝 앵커: 첫 행은 그려졌다.
      expect(screen.getByTestId('my-stays-row')).toBeOnTheScreen();
    });
  });
});

// TRIP-606 · TRIP-618 · TRIP-939
describe('조회 → 모델 → 배치 (옛 .integration)', () => {
  /**
   * TRIP-606 · l03 마이페이지 배선(AC-I1) — 화면 단위 테스트가 못 보는 **조회→모델→배치**를 real-render 로 잠근다.
   *
   * 무엇을 보장하나:
   *  - 🔴 AC-I1 배선: MyPage 가 `useGetMeStyle()` envelope 를 `buildStyleCardModel` 에 태워 `StyleSummaryCard` 로
   *    그린다(칩·게이지가 envelope 값을 관통해 실제로 렌더).
   *  - 🔴 AC-I1 배치: 그 카드가 **ProfileCard(`my-profile-card`) 뒤, 메뉴 카드(`my-menu-card`) 앞**에 놓이고,
   *    기존 testID 는 무변경이다. (TRIP-1123 에서 세그 `my-trip-segment` 가 사라져 뒤 기준을 메뉴 카드로 바꿨다.)
   *
   * 왜 이렇게 테스트하나(02a ★9):
   *  - 화면 목(props-capture)이 아니라 **real MyPage 렌더** — 배치는 MyPageScreen 몫이라 목으로는 못 본다.
   *    조회 훅만 목으로 고정(envelope 주입)하고, 나머지(모델·카드·화면)는 실물이 돌아 두 반쪽을 함께 관통한다.
   *  - 이 파일은 비존재 모듈을 직접 import 하지 않아 **suite 는 로드되고**, red 는 `my-style-card` testID 부재
   *    (깨끗한 assertion red) — MyPage 배선 + MyPageScreen additive slot 둘 다 되어야 green.
   *
   * (개념) `getByTestId(id).findAll(pred)` = react-test-renderer DFS pre-order → 이 선형 레이아웃의 문서 순서
   *   (02a §5-D). 그 순서 배열에서 profile < style < menu 로 "사이" 배치를 잰다.
   */

  const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
  const mockUseProfile = useGetMeProfile as jest.MockedFunction<
    typeof useGetMeProfile
  >;
  const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
  const mockUseRecords = useGetMeRecords as jest.MockedFunction<
    typeof useGetMeRecords
  >;
  const mockUseStyle = useGetMeStyle as jest.MockedFunction<
    typeof useGetMeStyle
  >;

  beforeEach(() => {
    mockPush.mockClear();
    resetPressGuard();
    mockUseMe.mockReturnValue(asQuery({ email: 'a@b.c' }));
    mockUseProfile.mockReturnValue(asQuery({ nickname: '테스터' }));
    mockUseTrips.mockReturnValue(asQuery([])); // 여행 0건 → 카드 목록 비어 배치 확인에 집중
    mockUseStyle.mockReturnValue(asQuery(officialEnvelope()));
    mockUseRecords.mockReturnValue(
      asQuery(undefined) as unknown as ReturnType<typeof useGetMeRecords>
    );
  });

  describe('🔴 AC-I1 · 조회→모델→배치', () => {
    it('useGetMeStyle envelope 가 buildStyleCardModel 을 거쳐 StyleSummaryCard 로 렌더된다', () => {
      renderPage();

      // 배선 — envelope 값이 카드까지 관통해 실제로 그려진다.
      expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
      expect(screen.getAllByTestId('my-style-chip')).toHaveLength(2);
      expect(screen.getAllByTestId('my-style-gauge')).toHaveLength(3);
    });

    it('카드는 ProfileCard 와 메뉴 카드 사이에 놓이고 기존 testID 는 그대로다(세그는 없다)', () => {
      renderPage();

      // 기존 testID 무변경(additive prop 이 헐지 않았다). 헤더 설정 아이콘은 TRIP-775 로 복원(→ /settings).
      expect(screen.getByTestId('my-page-root')).toBeOnTheScreen();
      expect(screen.getByTestId('my-header-settings')).toBeOnTheScreen();
      expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
      expect(screen.getByTestId('my-menu-card')).toBeOnTheScreen();
      // TRIP-1123 — 세그는 사라졌다.
      expect(screen.queryAllByTestId(/^my-trip-segment/)).toHaveLength(0);

      // 배치 — DFS 문서 순서에서 profile < style < menu.
      const root = screen.getByTestId('my-page-root');
      const order = root
        .findAll((node) => typeof node.props.testID === 'string')
        .map((node) => node.props.testID as string);

      const idxProfile = order.indexOf('my-profile-card');
      const idxStyle = order.indexOf('my-style-card');
      const idxMenu = order.indexOf('my-menu-card');

      expect(idxProfile).toBeGreaterThanOrEqual(0);
      expect(idxStyle).toBeGreaterThan(idxProfile);
      expect(idxMenu).toBeGreaterThan(idxStyle);
    });

    // TRIP-1790 O1 — 「지금까지」 카드는 프로필과 스타일 카드 사이다(Figma E9).
    it('종료 여행이 있으면 통계 카드가 프로필 카드 < 통계 카드 < 스타일 카드 < 메뉴 카드 순서로 놓인다', () => {
      // 준비 — 종료(확정 + 지난 날짜) 여행 1건과 그 방문 기록.
      mockUseTrips.mockReturnValue(
        asQuery([myPageTrip('e1', PAST, { ...CONFIRMED_COLS })]) as ReturnType<
          typeof useGetTrips
        >
      );
      mockUseRecords.mockReturnValue({
        data: {
          items: [
            {
              tripId: 'e1',
              title: 'e1 여행',
              startDate: PAST.startDate,
              endDate: PAST.endDate,
              regions: ['부산'],
              visitCount: 2,
              photoCount: 0,
            },
          ],
        },
        isPending: false,
        isError: false,
      } as unknown as ReturnType<typeof useGetMeRecords>);

      // 실행
      renderPage();

      // 단언 — 문서 순서(DFS)로 네 카드의 위치를 비교한다.
      const order = screen
        .getByTestId('my-page-root')
        .findAll((node) => typeof node.props.testID === 'string')
        .map((node) => node.props.testID as string);
      const profile = order.indexOf('my-profile-card');
      const stats = order.indexOf('my-stats-card');
      const style = order.indexOf('my-style-card');
      const menu = order.indexOf('my-menu-card');

      expect(profile).toBeGreaterThanOrEqual(0);
      expect(stats).toBeGreaterThan(profile);
      expect(style).toBeGreaterThan(stats);
      expect(menu).toBeGreaterThan(style);
    });
  });

  describe('🔴 TRIP-618 AC-1 · 하단 설정 행 진입 배선', () => {
    it('하단 "설정" 행 press → router.push("/settings") 정확히 1회', () => {
      renderPage();

      // 실행: 설정 메뉴 하단 '설정' 행을 누른다(trips=[]라 카드는 없고 설정 메뉴는 상시 렌더).
      fireEvent.press(screen.getByTestId('my-settings-row'));

      // 단언: l05 설정 라우트로, 정확히 한 번.
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });

    it('TRIP-775(구 TRIP-939 B-2): 헤더 설정 아이콘을 누르면 router.push("/settings") 정확히 1회', () => {
      // 준비·실행: 헤더 톱니(Figma 1602:2388 우측 24)를 누른다. 목적지가 생겨 되살렸다(Seed Q2=a).
      renderPage();
      fireEvent.press(screen.getByTestId('my-header-settings'));

      // 단언: 반응 없는 버튼이 아니다 — 설정으로, 한 번만.
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });
  });

  describe('🔴 TRIP-1222 · 등록 숙소·스타일 분석 행 연타 관통', () => {
    it('등록 숙소 행을 연달아 두 번 눌러도 /my/stays 는 한 번만 push 된다', () => {
      renderPage();
      const row = screen.getByTestId('my-stays-row');
      fireEvent.press(row);
      fireEvent.press(row);
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/my/stays');
    });

    it('스타일 분석 행도 연타하면 한 번만 push 된다', () => {
      renderPage();
      const row = screen.getByTestId('my-style-analysis-row');
      fireEvent.press(row);
      fireEvent.press(row);
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 TRIP-939 B-1·B-3·B-4 · 마이 탭에 눌러도 반응 없는 것이 없다 (심사 2.1)', () => {
    it('B-1(TRIP-775 Q1=A): 목적지가 선 메뉴 3행은 누르면 각자 이동하고, 커뮤니티 3행은 없다', () => {
      // 준비·실행: 실 마이페이지를 그린다(여행 0건).
      renderPage();

      // 단언(부재): U7 전이라 목적지가 없는 커뮤니티 3행.
      [
        '내 일정 공개/공유 설정',
        '내가 공유한 일정',
        '숨긴 사용자 관리',
      ].forEach((label) => {
        expect(screen.queryByText(label)).toBeNull();
      });

      // 단언(존재 + 배선): 보이는 행은 전부 눌러서 이동한다 — 행마다 정확히 1회, 경로 완전일치.
      (
        [
          ['my-stays-row', '등록 숙소', '/my/stays'],
          ['my-style-analysis-row', '여행 스타일 분석', '/records/style'],
          ['my-settings-row', '설정', '/settings'],
        ] as const
      ).forEach(([testID, label, href]) => {
        mockPush.mockClear();
        resetPressGuard(); // 행마다 창 밖에서 누른다(TRIP-1222 — 가드는 모듈 전역 400ms).
        const row = screen.getByTestId(testID);
        expect(row).toHaveTextContent(label);

        fireEvent.press(row);

        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith(href);
      });
    });

    it('B-3(TRIP-1436 Q-118 결정 1=B): 프로필 카드에 [편집]이 없다 — 설정 진입은 헤더 톱니·메뉴 행 둘뿐', () => {
      renderPage();

      expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-profile-edit')).toBeNull();
    });

    it('B-4(TRIP-776 Q1=A): 지난 여행의 "캘린더 ›"를 누르면 router.push("/records") 정확히 1회 — 회고 하트 floating 은 여전히 없다', () => {
      // 준비·실행: 여행 0건 → 예정 0이라 '지난 여행' 섹션이 보인다(종료 0건이어도 캘린더 링크는 남는다).
      renderPage();

      // 짝 앵커: 지난 여행 섹션이 실제로 그려졌다.
      expect(screen.getByText('지난 여행')).toBeOnTheScreen();

      // 단언(존재 + 배선): 목적지(/records, j07 캘린더)가 선 링크 — 반응 없는 링크가 아니다(TRIP-939 원칙 유지).
      const calendar = screen.getByTestId('my-past-calendar');
      expect(calendar).toHaveTextContent(/캘린더/);
      fireEvent.press(calendar);
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/records');

      // 단언(부재): 장식 하트 버튼은 여전히 없다.
      expect(screen.UNSAFE_queryAllByType(SettingsHeartGlyph)).toHaveLength(0);
    });
  });
});

// TRIP-573
describe('스타일 카드 상세 진입 (옛 .styleDetail.integration)', () => {
  /**
   * TRIP-573 · AC-7(Q4) — 요약카드 상세진입 활성화 배선.
   *
   * 무엇을 보장하나:
   *  - 🔴 j05 라우트(`records/style`)가 생겼으니 TRIP-606 이 `disabled` 로 둔 `my-style-detail`
   *    Pressable 을 활성화해 press → `router.push('/records/style')`(완전일치, 오타·교차 배선 검출).
   *
   * 왜 real MyPage 렌더인가:
   *  - 배선(StyleSummaryCard onPressDetail prop 활성화 + MyPage 가 라우트 문자열 주입)을 한 번에 관통.
   *    조회 훅만 목(official envelope 주입)하고 나머지는 실물이 돈다(`MyPage.integration.test.tsx` 선례).
   *  - **backward-compat**: prop 미주입이던 기존 `StyleSummaryCard.test.tsx` AC-S6(`toBeDisabled()`)·
   *    기존 `MyPage.integration.test.tsx`(배선·배치)는 무회귀여야 한다(implementer 는 prop-gated 로 활성화).
   *
   * (별 파일 신설 — 기존 `MyPage.integration.test.tsx` 는 수정하지 않는다. `DailyReflectionScreen.test.tsx` 공유 묶음
   *  선례 동형: 동결 테스트를 안 건드리고 새 배선만 별 파일에 잠근다.)
   */

  const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
  const mockUseProfile = useGetMeProfile as jest.MockedFunction<
    typeof useGetMeProfile
  >;
  const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
  const mockUseRecords = useGetMeRecords as jest.MockedFunction<
    typeof useGetMeRecords
  >;
  const mockUseStyle = useGetMeStyle as jest.MockedFunction<
    typeof useGetMeStyle
  >;

  // 옛 목엔 replace 가 없어 부르면 TypeError 였다 — 합친 목은 replace 를 주므로 그 그물을 단언으로 옮긴다.
  afterEach(() => {
    expect(mockReplace).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    mockPush.mockClear();
    mockUseMe.mockReturnValue(asQuery({ email: 'a@b.c' }));
    mockUseProfile.mockReturnValue(asQuery({ nickname: '테스터' }));
    mockUseTrips.mockReturnValue(asQuery([]));
    mockUseStyle.mockReturnValue(
      asQuery(officialEnvelope({ avgPlacesPerDay: 4, avgRadiusKm: 1.2 }))
    );
    mockUseRecords.mockReturnValue(
      asQuery(undefined) as unknown as ReturnType<typeof useGetMeRecords>
    );
  });

  describe('🔴 TRIP-573 AC-7 · 요약카드 상세진입 활성화', () => {
    it('my-style-detail press → router.push("/records/style") 정확히 1회', () => {
      renderPage();

      fireEvent.press(screen.getByTestId('my-style-detail'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/records/style');
    });
  });
});

// TRIP-1790
describe('누적 통계 (TRIP-1790 · 마이 탭 「지금까지」)', () => {
  /**
   * TRIP-1790 · 마이 탭 「지금까지」 — 종료한 여행의 여행·도시·방문 수를 프로필 카드 아래 별도 카드로 보인다(Figma E9).
   *
   * 무엇을 보장하나:
   *  - AC-1 종료 3건(부산·부산 시군구·제주) + 방문 4·5·3 → 여행 3 · 도시 2 · 방문 12. records 에는 예정 여행(7)·작성중 지난 여행(6)·
   *    목록에 없는 여행(9)의 방문도 함께 오지만 **종료 칸과 같은 판정**(확정 ∧ 종료)만 센다 — 프로필 「종료」 칸 숫자와 항상 같다.
   *  - AC-6 예정 여행이 있어도 records 조회가 켜진다. 첫 인자는 `{ limit: 100 }`(서버 상한) — 지난 여행 카드의 「사진 N」도 같은 응답을 쓴다.
   *  - AC-4 종료 0건(알고 0)이면 카드를 그리지 않는다. 모르는 상태(여행 목록 대기)는 카드가 `–` 로 선다.
   *  - AC-2 records 실패 → 세 값 `–` + 「다시 시도」(0 으로 접지 않는다). 누르면 records 만 다시 받고, 성공하면 숫자가 나온다.
   *    조회 중 → `–`·버튼 없음. 실패 이력 + 재조회 중 → 버튼 disabled. 받아 둔 데이터가 있으면 재조회 실패에도 숫자 유지.
   *    여행 목록 실패 → `–` + 「다시 시도」(Seed D6), 누르면 여행 목록만 다시 받는다.
   *  - AC-5 records 100건이면 세 값 `+`, 99건이면 `+` 없음.  AC-3 카드 안에 분·시간·소요·km·이동 글자 없음(INV-3).
   *
   * 왜 이렇게 테스트하나: 조회 훅만 목이고 모델·화면·카드는 실물이다. 훅 목은 가공 전 응답(`data.items`)을 그대로 주므로(`select` 미실행)
   * 필요한 필드(`isError`·`errorUpdateCount`·`isFetching`·`refetch`)를 `recordsQuery`/`tripsQuery` 가 명시해 준다.
   * 종료 판정은 시계를 흉내 내지 않는다 — PAST(2026-06) 확정 = 종료, FUTURE(2099) 확정 = 예정, 일정 없음 = 작성중(초안).
   *
   * 커버하지 않는 것: 카드 생김새(칸 사이 세로선·간격·그림자·재시도 버튼 모양)·실제 재조회 응답 도착 — 실화면 QA(6-b) 몫.
   */

  const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
  const mockUseProfile = useGetMeProfile as jest.MockedFunction<
    typeof useGetMeProfile
  >;
  const mockUseStyle = useGetMeStyle as jest.MockedFunction<
    typeof useGetMeStyle
  >;
  const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
  const mockUseRecords = useGetMeRecords as jest.MockedFunction<
    typeof useGetMeRecords
  >;

  const EN_DASH = '–';

  type QueryShape = {
    data: unknown;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    errorUpdateCount: number;
    refetch: jest.Mock;
  };

  /** 조회 결과 목 — 실패·재시도 판정에 쓰이는 필드를 전부 명시한다(기본 = 응답 전). */
  function query(over: Partial<QueryShape> = {}): QueryShape {
    return {
      data: undefined,
      isPending: true,
      isError: false,
      isFetching: false,
      errorUpdateCount: 0,
      refetch: jest.fn(),
      ...over,
    };
  }
  const loaded = (data: unknown, over: Partial<QueryShape> = {}) =>
    query({ data, isPending: false, ...over });

  function setTrips(q: QueryShape): void {
    mockUseTrips.mockReturnValue(
      q as unknown as ReturnType<typeof useGetTrips>
    );
  }
  function setRecords(q: QueryShape): void {
    mockUseRecords.mockReturnValue(
      q as unknown as ReturnType<typeof useGetMeRecords>
    );
  }

  /** 목적지 한 곳 짜리 여행. 일정 네 칸이 종료·예정을 가른다 — 확정이면 날짜로, 없으면 작성중. */
  function tripOf(
    tripId: string,
    period: { startDate: string; endDate: string },
    destinations: { region: string; regionCode?: string }[],
    confirmed = true
  ): Trip {
    return myPageTrip(tripId, period, {
      ...(confirmed ? CONFIRMED_COLS : {}),
      destinations: destinations.map((dest, i) => ({
        seq: i + 1,
        nights: 1,
        ...dest,
      })),
    });
  }

  function rec(tripId: string, visitCount: number): TripRecordSummary {
    return {
      tripId,
      title: `${tripId} 기록`,
      startDate: PAST.startDate,
      endDate: PAST.endDate,
      regions: [],
      visitCount,
      photoCount: 0,
    };
  }

  /** 종료 여행 하나(부산 `'26'`)와 그 방문 기록 — 단순한 장면용. */
  const ONE_ENDED = [
    tripOf('t1', PAST, [{ region: '부산광역시', regionCode: '26' }]),
  ];

  function stat(cell: 'trips' | 'cities' | 'visits'): string {
    return [screen.getByTestId(`my-stats-${cell}-value`).props.children]
      .flat()
      .join('');
  }
  function statValues(): string[] {
    return (['trips', 'cities', 'visits'] as const).map(stat);
  }

  /** records 훅이 받은 모든 호출의 첫 인자. */
  function recordsArgs(): unknown[] {
    return mockUseRecords.mock.calls.map((call) => call[0]);
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockUseMe.mockReturnValue(
      asQuery({ email: 'a@b.c' }) as ReturnType<typeof useGetMe>
    );
    mockUseProfile.mockReturnValue(
      asQuery({ nickname: '테스터' }) as ReturnType<typeof useGetMeProfile>
    );
    mockUseStyle.mockReturnValue(
      asQuery(undefined) as ReturnType<typeof useGetMeStyle>
    );
    setTrips(loaded([]));
    setRecords(query());
  });

  describe('🔴 AC-1·AC-6 · 종료 여행만 세고, 예정 여행이 있어도 조회한다', () => {
    /** 종료 3 + 예정 1(서울) + 작성중 지난 여행 1(경기) — 오염 입력. */
    function scenario() {
      setTrips(
        loaded([
          tripOf('t1', PAST, [{ region: '부산광역시', regionCode: '26' }]),
          tripOf('t2', PAST, [{ region: '해운대구', regionCode: '26350' }]),
          tripOf('t3', PAST, [{ region: '제주시', regionCode: '50110' }]),
          tripOf('u1', FUTURE, [{ region: '서울특별시', regionCode: '11' }]),
          tripOf('d1', PAST, [{ region: '경기도', regionCode: '41' }], false),
        ])
      );
      setRecords(
        loaded({
          items: [
            rec('t1', 4),
            rec('t2', 5),
            rec('t3', 3),
            rec('u1', 7),
            rec('d1', 6),
            rec('stranger', 9),
          ],
        })
      );
    }

    it('M1 · 종료 3건 → 여행 3 · 도시 2 · 방문 12 (예정·작성중·모르는 여행의 방문·도시는 안 센다), 프로필 「종료」 칸과 같은 숫자', async () => {
      scenario();

      renderPage();
      await settle();

      // 단언 — 합산 구현이면 방문 34, 작성중을 세면 여행 4 · 도시 4.
      expect(statValues()).toEqual(['3', '2', '12']);
      // 짝 — 같은 모집단: 프로필 카드 「종료」 칸(3)·「예정」 칸(1).
      expect(
        screen.getByTestId('my-profile-count-ended-value')
      ).toHaveTextContent(stat('trips'));
      expect(
        screen.getByTestId('my-profile-count-upcoming-value')
      ).toHaveTextContent('1');
    });

    it('M2 · 예정 여행이 있어도 통계 카드가 뜨고 records 조회는 켜져 있으며 첫 인자는 { limit: 100 } 이다', async () => {
      scenario();

      renderPage();
      await settle();

      expect(screen.getByTestId('my-stats-card')).toBeOnTheScreen();
      // 예정 1건 → 지난 여행 섹션은 닫혀 있다(옛 규칙에선 이때 조회도 꺼졌다).
      expect(screen.queryByText('지난 여행')).toBeNull();
      expect(lastRecordsEnabled()).toBe(true);
      expect(mockUseRecords).toHaveBeenCalled();
      expect(recordsArgs()).toEqual(recordsArgs().map(() => ({ limit: 100 })));
    });

    /** 페이지가 마지막으로 `/me/records` 훅에 넘긴 enabled 값. */
    function lastRecordsEnabled(): unknown {
      const calls = mockUseRecords.mock.calls;
      const options = calls[calls.length - 1]?.[1] as
        { query?: { enabled?: unknown } } | undefined;
      return options?.query?.enabled;
    }
  });

  describe('🔴 AC-4 · 종료 0건이면 카드가 없고, 모르는 상태는 `–` 로 선다', () => {
    it.each<[string, Trip[]]>([
      [
        '예정 여행만 있다',
        [tripOf('u1', FUTURE, [{ region: '부산', regionCode: '26' }])],
      ],
      ['여행이 0건이다', []],
      [
        '작성중(초안) 지난 여행만 있다',
        [tripOf('d1', PAST, [{ region: '부산', regionCode: '26' }], false)],
      ],
    ])('M4 · %s → 통계 카드 없음', async (_name, trips) => {
      setTrips(loaded(trips));
      setRecords(loaded({ items: [rec('u1', 7)] }));

      renderPage();
      await settle();

      expect(screen.queryByTestId('my-stats-card')).toBeNull();
      // 짝 — 판정이 끝난 화면이고(프로필 카드 있음), 새 호출 모양으로 조회가 이뤄졌다(선제 green 방지).
      expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
      expect(mockUseRecords).toHaveBeenCalled();
      expect(recordsArgs()).toEqual(recordsArgs().map(() => ({ limit: 100 })));
    });
  });

  describe('🔴 AC-2 · 못 받았을 때 0 으로 접지 않는다', () => {
    it('M5 · records 실패 → 세 값 `–` + 다시 시도. 누르면 records 만 다시 받고(여행 목록 0회), 성공하면 숫자가 나온다', async () => {
      // 준비 — 종료 1건, records 는 데이터 없이 실패.
      const trips = loaded(ONE_ENDED);
      const failedRecords = query({ isPending: false, isError: true });
      setTrips(trips);
      setRecords(failedRecords);

      const view = renderPage();
      await settle();

      // 단언 — 0 이 아니라 `–`, 버튼 하나.
      expect(statValues()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
      const retry = screen.getByTestId('my-stats-retry');
      expect(retry).toHaveTextContent('다시 시도');

      // 실행 — 누른다.
      fireEvent.press(retry);

      // 단언 — records 만 다시 부른다.
      expect(failedRecords.refetch).toHaveBeenCalledTimes(1);
      expect(trips.refetch).not.toHaveBeenCalled();

      // 실행 — 재조회가 성공해 응답이 도착한 다음 렌더.
      setRecords(loaded({ items: [rec('t1', 2)] }));
      view.rerender(<MyPage />);
      await settle();

      // 단언 — 짝: 성공 뒤 숫자, 버튼은 사라진다.
      expect(statValues()).toEqual(['1', '1', '2']);
      expect(screen.queryByTestId('my-stats-retry')).toBeNull();
    });

    it('M6 · records 조회 중 → 세 값 `–` 이고 버튼은 없다', async () => {
      setTrips(loaded(ONE_ENDED));
      setRecords(query({ isPending: true }));

      renderPage();
      await settle();

      expect(screen.getByTestId('my-stats-card')).toBeOnTheScreen();
      expect(statValues()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
      expect(screen.queryByTestId('my-stats-retry')).toBeNull();
    });

    it('M7 · 실패 이력이 있는 채 재조회 중(isError 는 꺼짐)이면 실패 얼굴을 유지하고 버튼은 disabled 다', async () => {
      // 준비 — TanStack v5 는 데이터 없이 실패한 쿼리를 다시 받는 동안 isError 를 끄고 errorUpdateCount 만 남긴다.
      const refetching = query({
        isPending: true,
        isError: false,
        errorUpdateCount: 1,
        isFetching: true,
      });
      setTrips(loaded(ONE_ENDED));
      setRecords(refetching);

      renderPage();
      await settle();

      expect(statValues()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
      const retry = screen.getByTestId('my-stats-retry');
      expect(retry).toBeDisabled();

      fireEvent.press(retry);

      expect(refetching.refetch).not.toHaveBeenCalled();
    });

    it('M8 · 받아 둔 records 가 있으면 재조회가 실패해도 숫자를 그대로 두고 버튼은 없다', async () => {
      setTrips(loaded(ONE_ENDED));
      setRecords(loaded({ items: [rec('t1', 2)] }, { isError: true }));

      renderPage();
      await settle();

      expect(statValues()).toEqual(['1', '1', '2']);
      expect(screen.queryByTestId('my-stats-retry')).toBeNull();
    });

    it('M9 · 여행 목록 조회 중이면 `–`·버튼 없음, 여행 목록 실패면 `–` + 다시 시도(여행 목록만 다시 받는다)', async () => {
      // 준비 — 목록 대기.
      setTrips(query({ isPending: true }));
      const view = renderPage();
      await settle();

      expect(screen.getByTestId('my-stats-card')).toBeOnTheScreen();
      expect(statValues()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
      expect(screen.queryByTestId('my-stats-retry')).toBeNull();

      // 준비 — 목록 실패(받아 둔 목록 없음).
      const failedTrips = query({ isPending: false, isError: true });
      const records = query({ isPending: true });
      setTrips(failedTrips);
      setRecords(records);
      view.rerender(<MyPage />);
      await settle();

      expect(statValues()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
      const retry = screen.getByTestId('my-stats-retry');

      // 실행
      fireEvent.press(retry);

      // 단언
      expect(failedTrips.refetch).toHaveBeenCalledTimes(1);
      expect(records.refetch).not.toHaveBeenCalled();
    });
  });

  describe('🔴 AC-5 · 100건이면 잘렸을 수 있어 `+`', () => {
    const filler = (n: number) =>
      Array.from({ length: n }, (_, i) => rec(`filler-${i}`, 1));

    it('M10 · records 100건 → 세 값 뒤 `+`, 99건 → `+` 없음', async () => {
      setTrips(loaded(ONE_ENDED));
      setRecords(loaded({ items: [rec('t1', 4), ...filler(99)] }));

      const view = renderPage();
      await settle();

      // 100건 — 방문 4 만 센다(필러 99는 종료 여행이 아니다).
      expect(statValues()).toEqual(['1+', '1+', '4+']);

      setRecords(loaded({ items: [rec('t1', 4), ...filler(98)] }));
      view.rerender(<MyPage />);
      await settle();

      expect(statValues()).toEqual(['1', '1', '4']);
    });
  });

  describe('🔴 AC-3 · 시간·거리 글자가 없다 (INV-3)', () => {
    it('M11 · 통계 카드 안에 분·시간·소요·km·이동 글자가 없고 값은 그려져 있다', async () => {
      setTrips(loaded(ONE_ENDED));
      // 응답에 시간 같은 문자열이 섞여 와도(제목 등) 카드는 그것을 쓰지 않는다.
      setRecords(
        loaded({
          items: [
            {
              ...rec('t1', 4),
              title: '3시간 이동 · 40분 소요',
              regions: ['120km'],
            },
          ],
        })
      );

      renderPage();
      await settle();

      const card = screen.getByTestId('my-stats-card');
      expect(statValues()).toEqual(['1', '1', '4']);
      expect(within(card).queryAllByText(/분|시간|소요|km|이동/)).toHaveLength(
        0
      );
    });
  });

  describe('🔴 AC-1 · 진행 중 여행은 통계 모집단 밖 (5-b 보강 W1)', () => {
    it('M12 · 종료 2 + 진행 중 1 + 예정 1 → 여행 2 · 도시는 종료 여행 시도만 · 방문은 종료 여행 합이고, 프로필 「종료」 칸과 같은 숫자', async () => {
      // 준비 — 종료 둘(부산 '26' · 제주 '50') + 진행 중(서울 '11', 방문 7) + 예정(강원 '51', 방문 5).
      setTrips(
        loaded([
          tripOf('e1', PAST, [{ region: '부산광역시', regionCode: '26' }]),
          tripOf('e2', PAST, [{ region: '제주시', regionCode: '50110' }]),
          tripOf('a1', DURING, [{ region: '서울특별시', regionCode: '11' }]),
          tripOf('u1', FUTURE, [{ region: '강릉시', regionCode: '51150' }]),
        ])
      );
      setRecords(
        loaded({
          items: [rec('e1', 4), rec('e2', 3), rec('a1', 7), rec('u1', 5)],
        })
      );

      // 실행 — 마이 탭을 연다.
      renderPage();
      await settle();

      // 단언 — 진행 중을 섞으면 여행 3 · 도시 3 · 방문 14.
      expect(statValues()).toEqual(['2', '2', '7']);
      // 짝 — 판정이 갈린 화면이다: 프로필 칸은 종료 2 · 진행 중 1 · 예정 1, 통계 「여행」은 「종료」 칸과 같다.
      expect(
        screen.getByTestId('my-profile-count-ended-value')
      ).toHaveTextContent(stat('trips'));
      expect(
        screen.getByTestId('my-profile-count-active-value')
      ).toHaveTextContent('1');
      expect(
        screen.getByTestId('my-profile-count-upcoming-value')
      ).toHaveTextContent('1');
    });
  });
});
