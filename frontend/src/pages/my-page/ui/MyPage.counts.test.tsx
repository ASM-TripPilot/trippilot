import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetMeRecords,
  useGetTrips,
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import {
  CONFIRMED,
  DURING,
  FUTURE,
  PAST,
  PLANNED,
  deferred,
  myPageTrip,
  newTestQueryClient,
  renderWithQueryClient,
  scriptItineraryOptions,
  settle,
  type ItinScript,
} from '@/test-support/myPageItineraries';

import { MyPage } from './MyPage';

/**
 * TRIP-1123 · l03 마이페이지 — 목록·CTA 제거, 숫자 3칸 → 탭 이동, 집계에서 초안 제외(QA-2026-09-29 #28·#29).
 *
 * 규칙(01b 확정 결정): 숫자는 **일정이 확정된 여행만** 센다 — 서울 오늘 기준 시작 전 = 예정, 기간 안 = 진행 중,
 * 끝난 뒤 = 종료. 초안(미확정·일정 없음 404)은 어느 칸에도 안 센다. 서버 `Trip.status`(날짜 파생, 초안도 ACTIVE)는
 * 보지 않는다. 일정 조회를 기다리는 중이거나 404 가 아닌 실패면 판정할 수 없으니 **세 칸 모두 `–`**(INV-4).
 *
 * 무엇을 보장하나:
 *  - AC-1·AC-2 세그·여행 카드·[새 여행 만들기]·빈 문구가 없다(여행이 있든 없든). 지난 여행 섹션은 남는다(결정 2(b)).
 *  - AC-3 QA 재현: 기간 안 4건(확정 1·미확정 1·404 2) → 진행 중 1(4 아님).
 *  - AC-4 확정 미래·기간 안·과거 1건씩 + 같은 날짜의 초안 1건씩 → 1 · 1 · 1.
 *  - AC-5 모름(일정 대기·500·옛 데이터가 있는데 다시 받다 500·여행 목록 대기·실패·옛 목록이 있는데 다시 받다 실패) → 세 칸 모두 `–`.
 *    대기가 풀리면 정상 숫자가 뜬다.
 *  - AC-6 예정·진행 중 칸 → `router.replace('/itinerary')`, 종료 칸 → `router.replace('/records')`, 각 1회, push 0.
 *    모름(`–`)이어도 똑같이 이동한다.
 *  - AC-8 지난 여행 = 확정 && 종료, 예정 0건일 때만. 날짜 지난 초안 카드는 없고 카드 수 = 종료 숫자.
 *    모르면 섹션도 없고 `/me/records` 조회도 꺼 둔다. 캘린더 › 는 여전히 push('/records').
 *
 * 왜 이렇게 테스트하나: 조회 훅(계정·프로필·스타일·여행 목록·사진 수)은 목, 여행별 일정은 페이지 `useQueries` 가
 * 목 옵션 함수의 `queryFn` 을 **진짜로** 돈다(h06 선례, 실 QueryClient). 그래서 한 테스트 안에서 "모름 → 앎"을 본다.
 * 시계는 흉내 내지 않는다 — 기간 안 2020~2099 · 과거 2026-06 · 미래 2099-06.
 * 카드별 일정 훅(`useGetTripsTripIdItinerary`)은 목으로 두고 **안 불린다**를 본다 — 페이지는 옵션 함수만 쓴다.
 *
 * 탭 루트에서 부르는 replace 의 실제 탭 전환·hitSlop 효과는 jest 사각 — 6-b 몫.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

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
  // 카드별 훅 — 마이페이지는 부르지 않는다(부르면 아래 앵커가 잡는다).
  useGetTripsTripIdBases: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
const mockUseProfile = useGetMeProfile as jest.MockedFunction<
  typeof useGetMeProfile
>;
const mockUseStyle = useGetMeStyle as jest.MockedFunction<typeof useGetMeStyle>;
const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseRecords = useGetMeRecords as jest.MockedFunction<
  typeof useGetMeRecords
>;
const mockQueryOptions = getGetTripsTripIdItineraryQueryOptions as jest.Mock;
const mockUseBases = useGetTripsTripIdBases as jest.Mock;
const mockUseCardItinerary = useGetTripsTripIdItinerary as jest.Mock;

const EN_DASH = '–';
const BUCKETS = ['upcoming', 'active', 'ended'] as const;

function asQuery<T>(data: T) {
  return { data, isPending: false, isError: false } as unknown;
}

/** 여행 목록 + 여행별 일정 대본을 한 번에 건다. */
function script(trips: Trip[], itins: Record<string, ItinScript>): void {
  mockUseTrips.mockReturnValue(
    asQuery(trips) as ReturnType<typeof useGetTrips>
  );
  scriptItineraryOptions(mockQueryOptions, itins);
}

function renderPage() {
  return renderWithQueryClient(<MyPage />);
}

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
  script([], {});
});

// ── AC-1·AC-2 제거 ─────────────────────────────────────────────────────

describe('🔴 AC-1 · 여행이 있어도 세그·여행 카드·CTA 가 없다', () => {
  it('확정 미래 여행 2건 → 세그 0 · 여행 카드 0 · [새 여행 만들기] 없음, 숫자는 예정 2', async () => {
    // 준비
    script([myPageTrip('u1', FUTURE), myPageTrip('u2', FUTURE)], {
      u1: CONFIRMED,
      u2: CONFIRMED,
    });

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
});

describe('🔴 AC-2 · 여행 0건이어도 CTA·빈 문구가 없고 지난 여행 안내는 남는다', () => {
  it('여행 0건 → CTA·"예정된 여행이 없어요" 없음, "지난 여행" + "아직 종료된 여행이 없습니다"는 있다', async () => {
    script([], {});

    renderPage();
    await settle();

    expect(screen.queryByTestId('my-create-trip')).toBeNull();
    expect(screen.queryAllByText(/예정된 여행이 없어요/)).toHaveLength(0);
    expect(screen.getByText('지난 여행')).toBeOnTheScreen();
    expect(screen.getByText('아직 종료된 여행이 없습니다')).toBeOnTheScreen();
    expect(values()).toEqual(['0', '0', '0']);
  });
});

// ── AC-3·AC-4 집계 ─────────────────────────────────────────────────────

describe('🔴 AC-3 · QA 재현 — 초안은 진행 중에 안 센다', () => {
  it('기간 안 4건(확정 1 · 미확정 1 · 404 2) → 예정 0 · 진행 중 1 · 종료 0 (4 아님)', async () => {
    // 준비 — 서버 status 는 넷 다 ACTIVE(날짜 파생). 옛 사영이면 진행 중 4.
    script(
      [
        myPageTrip('a', DURING, { status: 'ACTIVE' }),
        myPageTrip('b', DURING, { status: 'ACTIVE' }),
        myPageTrip('c', DURING, { status: 'ACTIVE' }),
        myPageTrip('d', DURING, { status: 'ACTIVE' }),
      ],
      { a: CONFIRMED, b: PLANNED, c: 'notFound', d: 'notFound' }
    );

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
    script(
      [
        myPageTrip('cf', FUTURE, { status: 'CONFIRMED' }),
        myPageTrip('cd', DURING, { status: 'ACTIVE' }),
        myPageTrip('cp', PAST, { status: 'ENDED' }),
        myPageTrip('df', FUTURE, { status: 'PLANNED' }),
        myPageTrip('dd', DURING, { status: 'ACTIVE' }),
        myPageTrip('dp', PAST, { status: 'ENDED' }),
      ],
      {
        cf: CONFIRMED,
        cd: CONFIRMED,
        cp: CONFIRMED,
        df: PLANNED,
        dd: 'notFound',
        dp: PLANNED,
      }
    );

    renderPage();
    await settle();

    expect(values()).toEqual(['1', '1', '1']);
    // 페이지는 카드별 훅을 부르지 않는다(옵션 함수 + useQueries 만).
    expect(mockUseCardItinerary).not.toHaveBeenCalled();
    expect(mockUseBases).not.toHaveBeenCalled();
    expect(mockQueryOptions).toHaveBeenCalled();
  });
});

// ── AC-5 모름 ──────────────────────────────────────────────────────────

describe('🔴 AC-5 · 모르면 세 칸 모두 – (INV-4)', () => {
  it('ⓐ 한 여행의 일정이 아직 안 왔으면 – · – · – (확정 1건을 0 으로 빼지 않는다)', async () => {
    script([myPageTrip('ok', DURING), myPageTrip('wait', PAST)], {
      ok: CONFIRMED,
      wait: 'never',
    });

    renderPage();
    await settle();

    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
  });

  it('ⓐ 풀림 — 대기하던 일정이 도착하면 그 순간 정상 숫자가 뜬다', async () => {
    // 준비 — 손으로 푸는 약속.
    const late = deferred<Itinerary>();
    script([myPageTrip('ok', DURING), myPageTrip('late', PAST)], {
      ok: CONFIRMED,
      late: late.promise,
    });

    // 실행 ① — 아직 모름
    renderPage();
    await settle();
    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);

    // 실행 ② — 도착
    late.resolve(CONFIRMED);
    await settle();

    // 단언 — 진행 중 1 · 종료 1
    expect(values()).toEqual(['0', '1', '1']);
  });

  it('ⓑ 한 여행의 일정 조회가 500 이면 – · – · – (404 가 아니면 "없음"이 아니라 "모름")', async () => {
    script([myPageTrip('ok', FUTURE), myPageTrip('bad', DURING)], {
      ok: CONFIRMED,
      bad: 'serverError',
    });

    renderPage();
    await settle();

    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
  });

  it("ⓑ' 받아 둔 확정 일정이 있어도 다시 받다 500 이면 – (남은 데이터를 믿지 않는다)", async () => {
    // 준비 — 캐시에 확정 일정을 넣어 두고(같은 키), 다시 받기는 500 으로 실패하게 한다.
    script([myPageTrip('stale', DURING)], { stale: 'serverError' });
    const client = newTestQueryClient();
    client.setQueryData(['/trips/stale/itinerary'], CONFIRMED);

    // 실행 — 마운트하면 오래된 캐시를 다시 받는다(staleTime 0).
    renderWithQueryClient(<MyPage />, client);
    await settle();

    // 단언 — 실패가 확정됐고 데이터는 남아 있어도 모름.
    expect(client.getQueryState(['/trips/stale/itinerary'])?.status).toBe(
      'error'
    );
    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
  });

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

  it("ⓒ' 여행 목록 조회가 실패했으면 – · – · –", async () => {
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

  it("ⓒ'' 여행 목록을 다시 받다 실패하면 옛 목록이 남아 있어도 – · – · –", async () => {
    // 준비 — 옛 목록(확정 미래 1)이 남은 채 다시 받기가 실패했다. 그 여행의 일정은 확정으로 받는다.
    scriptItineraryOptions(mockQueryOptions, { u1: CONFIRMED });
    mockUseTrips.mockReturnValue({
      data: [myPageTrip('u1', FUTURE)],
      isPending: false,
      isError: true,
      error: { isAxiosError: true, response: { status: 500 } },
    } as unknown as ReturnType<typeof useGetTrips>);
    const client = newTestQueryClient();

    // 실행
    renderWithQueryClient(<MyPage />, client);
    await settle();

    // 단언 — 일정은 받았다(앵커). 그래도 목록이 실패했으니 옛 목록으로 세지 않는다('1' · '0' · '0' 아님).
    expect(client.getQueryState(['/trips/u1/itinerary'])?.status).toBe(
      'success'
    );
    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
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
      script([myPageTrip('u1', FUTURE)], { u1: CONFIRMED });
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

// ── AC-8 지난 여행 ─────────────────────────────────────────────────────

describe('🔴 AC-8 · 지난 여행 = 확정 && 종료, 예정 0건일 때만', () => {
  it('ⓐ 확정 미래 여행이 1건이면 지난 여행 섹션이 없다(확정 종료가 있어도)', async () => {
    script([myPageTrip('u1', FUTURE), myPageTrip('e1', PAST)], {
      u1: CONFIRMED,
      e1: CONFIRMED,
    });

    renderPage();
    await settle();

    expect(screen.queryByText('지난 여행')).toBeNull();
    expect(pastCardRoots()).toHaveLength(0);
    // 짝 앵커 — 숫자는 떴다(판정이 끝났다).
    expect(values()).toEqual(['1', '0', '1']);
    // 섹션이 닫혔으니 사진 수 조회도 꺼져 있다.
    expect(lastRecordsEnabled()).toBe(false);
  });

  it('ⓑ 예정 0 · 확정 종료 2 · 날짜 지난 초안 1 → 카드 2장(종료일 최근순), 초안 카드 없음, 종료 숫자와 같다', async () => {
    // 준비 — 초안의 서버 status 는 ENDED(날짜 파생). 옛 기준이면 카드 3장.
    script(
      [
        myPageTrip(
          'old',
          { startDate: '2025-10-03', endDate: '2025-10-05' },
          {
            status: 'ENDED',
          }
        ),
        myPageTrip('draft', PAST, { status: 'ENDED' }),
        myPageTrip('recent', PAST, { status: 'ENDED' }),
      ],
      { old: CONFIRMED, draft: PLANNED, recent: CONFIRMED }
    );

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
    script([myPageTrip('df', FUTURE), myPageTrip('e1', PAST)], {
      df: PLANNED,
      e1: CONFIRMED,
    });

    renderPage();
    await settle();

    expect(screen.getByText('지난 여행')).toBeOnTheScreen();
    expect(pastCardRoots()).toHaveLength(1);
  });

  it('ⓒ 모름이면 섹션이 없고 /me/records 조회도 꺼져 있다', async () => {
    script([myPageTrip('e1', PAST), myPageTrip('wait', FUTURE)], {
      e1: CONFIRMED,
      wait: 'never',
    });

    renderPage();
    await settle();

    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
    expect(screen.queryByText('지난 여행')).toBeNull();
    expect(pastCardRoots()).toHaveLength(0);
    expect(lastRecordsEnabled()).toBe(false);
  });

  it('캘린더 › 는 여전히 push("/records") 1회, 회고 카드는 /trips/{id}/records (기존 계약)', async () => {
    script([myPageTrip('e1', PAST)], { e1: CONFIRMED });
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
