import type * as ReactModule from 'react';
import type * as SavedStaysApi from '@/shared/api/generated/saved-stays/saved-stays';
import type * as TripsApi from '@/shared/api/generated/trips/trips';
import {
  act,
  render,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  SavedStay,
  BaseAssignment,
  Trip,
} from '@/shared/api/index.schemas';
import {
  getGetSavedStaysQueryKey,
  getGetTripsQueryKey,
  useGetSavedStays,
  useGetTrips,
} from '@/shared/api/index.hooks';
import type { MyStayRowVM, MyStaysScreen } from './MyStaysScreen';
import { MyStaysPage } from './MyStaysPage';
import { http, HttpResponse } from 'msw';
import { newTestQueryClient } from '@/test-support/queryRender';
import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';
import { routerSpies } from '@/test-support/expoRouterMock';

/**
 * l04 등록 숙소 — MyStaysPage 배선 통합 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1148): 옛 `MyStaysPage.integration.test.tsx`(화면 캡처 스텁 + 조회 훅 목)·
 * `.release.integration.test.tsx`(실 화면 + msw) 를 각자의 바깥 describe 로 옮겼다. 두 관점이 화면 모듈과 생성
 * 훅 모듈을 다르게 다룬다 → `jest.mock` 팩토리 안에 스위치 `mockRealWiring` 하나를 두고, 화면·훅이 **불리는
 * 순간** 그 값을 읽는다(두 모듈은 늘 함께 바뀌므로 스위치를 둘로 나누지 않았다). 실 화면 위임은 JSX 없이
 * `createElement` 로 한다 — 팩토리 안 JSX 는 NativeWind babel 이 `_ReactNativeCSSInterop` 을 스코프 밖에서
 * 참조하게 만들어 죽는다.
 *  - 옛 스텁 관점의 라우터 목은 `push` 만 줬다(다른 메서드를 부르면 TypeError). 합친 목은 back·replace 도 주므로
 *    그 성질을 스텁 describe 의 `afterEach` 부재 단언으로 옮겼다.
 *  - 옛 스텁 관점의 거점 쓰기 훅 목(POST·DELETE)은 지웠다 — 페이지가 그 훅을 import 하지 않아 "0회" 단언이
 *    어떤 구현에도 통과했다(TRIP-1076). 거점을 안 쓴다는 사실은 실 화면 관점 AC-6 이 msw 로 나간 쓰기 요청 0건으로 본다.
 */

const { push: mockPush, back: mockBack, replace: mockReplace } = routerSpies;

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back'],
  })
);

// 토큰 저장소 — 기기 저장소를 건드리지 않게 배럴만 바꾼다(StayDetailPage 통합 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

interface MyStaysScreenPropsShape {
  rows: MyStayRowVM[];
  isEmpty: boolean;
  onConfirmBaseToggle?: (row: MyStayRowVM) => void;
  onPressChangeBase?: (row: MyStayRowVM) => void;
  onPressExplore: () => void;
}

// 관점 스위치 — false(스텁): 화면은 props 만 붙잡고 null, 조회 훅은 아래 jest.fn 이 답한다.
// true(실물): 실 화면 + 실 생성 훅(msw). 실 화면 관점 describe 의 beforeEach 만 켠다.
let mockRealWiring = false;
const mockScreenProps: { current: MyStaysScreenPropsShape | null } = {
  current: null,
};
const mockStubSavedStays = jest.fn();
const mockStubTrips = jest.fn();

jest.mock('./MyStaysScreen', () => {
  const actual = jest.requireActual<{ MyStaysScreen: typeof MyStaysScreen }>(
    './MyStaysScreen'
  );
  const { createElement } = jest.requireActual<typeof ReactModule>('react');
  return {
    ...actual,
    MyStaysScreen: (props: MyStaysScreenPropsShape) => {
      if (mockRealWiring) {
        return createElement(actual.MyStaysScreen, props);
      }
      mockScreenProps.current = props;
      return null;
    },
  };
});

jest.mock('@/shared/api/generated/saved-stays/saved-stays', () => {
  const actual = jest.requireActual<typeof SavedStaysApi>(
    '@/shared/api/generated/saved-stays/saved-stays'
  );
  return {
    ...actual,
    useGetSavedStays: (...args: Parameters<typeof actual.useGetSavedStays>) =>
      mockRealWiring
        ? actual.useGetSavedStays(...args)
        : mockStubSavedStays(...args),
  };
});

jest.mock('@/shared/api/generated/trips/trips', () => {
  const actual = jest.requireActual<typeof TripsApi>(
    '@/shared/api/generated/trips/trips'
  );
  return {
    ...actual,
    useGetTrips: (...args: Parameters<typeof actual.useGetTrips>) =>
      mockRealWiring ? actual.useGetTrips(...args) : mockStubTrips(...args),
  };
});

const mockUseSaved = mockStubSavedStays as jest.MockedFunction<
  typeof useGetSavedStays
>;
const mockUseTrips = mockStubTrips as jest.MockedFunction<typeof useGetTrips>;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
});
afterEach(() => {
  server.resetHandlers();
  mockRealWiring = false;
});
afterAll(() => server.close());

// 옛 MyStaysPage.integration — BR-U6-20·TRIP-1017·TRIP-1076·US-NOTIF-06
describe('화면 캡처 스텁 — 행 VM·콜백 배선 (옛 본 파일)', () => {
  beforeEach(() => {
    mockRealWiring = false;
  });
  // 옛 목은 push 만 줬다 — 다른 항법을 부르면 TypeError 로 red 였던 그물을 단언으로 옮긴다.
  afterEach(() => {
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * TRIP-605 · l04 페이지 배선 — 화면이 못 보는 **콜백→router/mutate 목적지**와 **미연결 행 VM 생산**을 잠근다.
   *
   * 무엇을 보장하나:
   *  - 🔴 AC-4(US-NOTIF-06) empty 의 탐색 콜백이 `router.push('/stays')` 로 배선된다.
   *  - 🔴 AC-6(TRIP-1076 결정 2(A) · 반전) 「거점 변경」 콜백에 등록 행이 오면 그 여행의 거점 화면
   *    (`/trips/[tripId]/bases`)으로 push 1회. 거점을 쓰지 않는다는 사실은 아래 실 화면 관점이 msw 로 본다
   *    (TRIP-1148 — 이 관점의 쓰기 훅 목은 페이지가 import 하지 않아 단언이 실패할 수 없어 지웠다).
   *  - 🔴 AC-1(BR-U6-20) 여행 0건이면 저장 숙소가 미연결 → 행 VM 이 정확히 '연결된 여행 없음'·unassigned 로 조립된다.
   *
   * 왜 이렇게 테스트하나(02a ★3):
   *  - 화면(`MyStaysScreen`)을 **props 캡처 목**으로 치환하고 페이지를 렌더한다(route 위임 선례).
   *    콜백은 캡처해 직접 호출하고, VM 은 캡처된 `rows` 를 읽는다 — 페이지 내부 fetch/N+1 기전에 무의존
   *    (trips 0건 시나리오라 bases 조회가 발화하지 않아 mechanism-agnostic).
   *  - push 인자는 리포 선례(`ItineraryMethodPage` onPressRebase)와 같은 객체 모양으로 완전 잠금(02a ★11).
   */

  function savedResult(stays: SavedStay[]) {
    return {
      data: stays,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useGetSavedStays>;
  }

  function tripsResult() {
    return {
      data: [],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useGetTrips>;
  }

  function stay(savedStayId: string): SavedStay {
    return {
      savedStayId,
      name: `숙소 ${savedStayId}`,
      coordConfirmed: true,
      linkedTripIds: [],
      registerRoute: 'MAP_SEARCH',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  function renderPage() {
    const client = newTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <MyStaysPage />
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    mockScreenProps.current = null;
    mockUseSaved.mockReturnValue(savedResult([]));
    mockUseTrips.mockReturnValue(tripsResult());
  });

  describe('🔴 AC-4 · empty 탐색 → /stays', () => {
    it('탐색 콜백이 router.push("/stays") 로 배선된다', () => {
      mockUseSaved.mockReturnValue(savedResult([]));

      renderPage();
      act(() => {
        mockScreenProps.current?.onPressExplore();
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe('/stays');
    });
  });

  describe('🔴 AC-6 · 「거점 변경」 → 거점 화면 push (TRIP-1076 결정 2(A) · 반전)', () => {
    it('등록 행으로 onPressChangeBase 가 오면 /trips/[tripId]/bases 로 push 1회', () => {
      renderPage();

      const row: MyStayRowVM = {
        savedStayId: 's1',
        name: '해운대 오션뷰',
        location: '부산 해운대구 우동',
        dateRangeLabel: '6.10 ~ 6.13',
        sourceLabel: '예약 사이트',
        memoLabel: null,
        linkedTripLabel: '연결 여행 · 부산 여행',
        baseState: 'assigned',
        canAssignBase: true,
        tripId: 't1',
        baseAssignmentId: 'ba1',
      };

      // 실행 — 화면이 넘겨받은 콜백을 직접 부른다(화면은 캡처 목).
      act(() => {
        mockScreenProps.current?.onPressChangeBase?.(row);
      });

      // 단언 ① — 그 여행의 거점 화면으로 한 번(push 라서 거점 화면 CTA 의 back() 이 이 화면으로 돌아온다).
      // TRIP-1082 — l04 입구는 거점 **편집 모드**로 연다(진행바·생성 CTA 없이 [완료] 하나). h04 입구는 mode 없음.
      expect(mockPush.mock.calls).toEqual([
        [
          {
            pathname: '/trips/[tripId]/bases',
            params: { tripId: 't1', mode: 'edit' },
          },
        ],
      ]);
      // 거점 쓰기 0 은 실 화면 관점 AC-6 이 msw 로 본다(이 관점은 쓰기 훅을 볼 수 없다 — 페이지가 import 하지 않는다).
    });
  });

  describe('🔴 AC-1 · 여행 0건 → 미연결 행 VM 생산', () => {
    it('저장 숙소가 어느 여행에도 안 연결되면 rows[0] 이 unassigned·"연결된 여행 없음" 으로 조립된다', () => {
      mockUseSaved.mockReturnValue(savedResult([stay('s9')]));
      mockUseTrips.mockReturnValue(tripsResult()); // 여행 0건 → 역참조 공집합

      renderPage();

      const rows = mockScreenProps.current?.rows ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0].baseState).toBe('unassigned');
      expect(rows[0].linkedTripLabel).toBe('연결된 여행 없음');
    });
  });

  // ─── 5-c 심판 강화 (03b 경고-1 · 경고-3a) ──────────────────────────────────
  // 기존 케이스는 라벨을 하드코딩 VM 으로 주입/단언해 파생 함수(sourceLabel·dateRangeLabel·monthDay)를
  // 실제 SavedStay 로 실행하는 심판이 0이었다(경고-1). 확정 후 무효화도 무심판이었다(경고-3a).

  /** 실 SavedStay — 체크인/아웃 세팅(파생 라벨을 실제로 실행시키는 픽스처). */
  function datedStay(): SavedStay {
    return {
      savedStayId: 's-dated',
      name: '해운대 오션뷰',
      coordConfirmed: true,
      linkedTripIds: [],
      registerRoute: 'MAP_SEARCH',
      externalSource: 'LOCALDATA',
      checkIn: '2026-06-10',
      checkOut: '2026-06-13',
      memo: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  describe('🔴 경고-1 · 실 SavedStay 로 날짜 범위(monthDay)를 조립한다', () => {
    it('체크인/아웃이 있으면 dateRangeLabel="6.10 ~ 6.13" 으로 파생된다', () => {
      // Arrange: 하드코딩 VM 이 아니라 실 SavedStay 를 조회 결과로 주입해 파생 함수를 실제로 태운다.
      mockUseSaved.mockReturnValue(savedResult([datedStay()]));

      // Act: 페이지를 렌더하면 dateRangeLabel·monthDay 가 이 숙소로 실행된다.
      renderPage();

      // Assert: monthDay('2026-06-10') → '6.10' (뒤집힌 `${day}.${month}` 면 '10.6' → 이 단언이 red).
      const rows = mockScreenProps.current?.rows ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0].dateRangeLabel).toBe('6.10 ~ 6.13');
    });

    it('체크인/아웃이 없으면 dateRangeLabel=null 이다(짝)', () => {
      mockUseSaved.mockReturnValue(savedResult([stay('s-nodate')]));

      renderPage();

      const rows = mockScreenProps.current?.rows ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0].dateRangeLabel).toBeNull();
    });
  });

  /**
   * TRIP-1017 (C) #090 — 등록 출처 라벨은 `externalSource` 로 가른다(01b 결정2 · Q5).
   *
   * `registerRoute` 로는 못 가른다: ♥ 저장도 `MAP_SEARCH` 로 들어온다(브리프 §3-C). 그래서 판정 키는
   * `externalSource` 하나다 — OTA 사전(NAVER·AGODA) 코드면 "OTA 예약", 그 밖의 값이 있으면 "탐색에서 저장",
   * 없으면(null·필드 없음) "직접 등록". "예약번호 미입력"은 **OTA 일 때만** 붙는다.
   * 옛 계약(AIRBNB → "OTA 예약", 출처 없음 → "앱 저장")은 이 표로 대체했다.
   */
  type SourceCase = {
    title: string;
    externalSource?: string | null;
    memo?: string | null;
    sourceLabel: string;
    memoLabel: string | null;
  };

  const SOURCE_CASES: SourceCase[] = [
    // AC-C1 — 지자체 인허가 데이터(탐색 카탈로그)는 예약이 아니다.
    {
      title: 'LOCALDATA · 메모 null',
      externalSource: 'LOCALDATA',
      memo: null,
      sourceLabel: '탐색에서 저장',
      memoLabel: null,
    },
    {
      title: 'LOCALDATA · 메모 빈 문자열',
      externalSource: 'LOCALDATA',
      memo: '',
      sourceLabel: '탐색에서 저장',
      memoLabel: null,
    },
    // AC-C2 — 직접 등록(핀 지정)은 외부 원천이 없다. 필드가 아예 빠진 응답도 같은 뜻이다.
    {
      title: 'null · 메모 null',
      externalSource: null,
      memo: null,
      sourceLabel: '직접 등록',
      memoLabel: null,
    },
    { title: '필드 없음', sourceLabel: '직접 등록', memoLabel: null },
    // AC-C3 — 사전에 있는 OTA 코드만 예약으로 말한다. 메모(예약번호)가 비면 안내를 붙인다.
    {
      title: 'NAVER · 메모 null',
      externalSource: 'NAVER',
      memo: null,
      sourceLabel: '예약 사이트',
      memoLabel: '예약번호 미입력',
    },
    {
      title: 'AGODA · 메모 빈 문자열',
      externalSource: 'AGODA',
      memo: '',
      sourceLabel: '예약 사이트',
      memoLabel: '예약번호 미입력',
    },
    {
      title: 'NAVER · 메모 있음',
      externalSource: 'NAVER',
      memo: 'NV-20260610',
      sourceLabel: '예약 사이트',
      memoLabel: null,
    },
    // AC-C4 — 사전에 없는 코드는 예약이라고 지어내지 않는다(Q5: 탐색 원천으로 본다).
    {
      title: 'STUB',
      externalSource: 'STUB',
      memo: null,
      sourceLabel: '탐색에서 저장',
      memoLabel: null,
    },
    {
      title: 'TOURAPI',
      externalSource: 'TOURAPI',
      memo: null,
      sourceLabel: '탐색에서 저장',
      memoLabel: null,
    },
    {
      title: 'AIRBNB',
      externalSource: 'AIRBNB',
      memo: null,
      sourceLabel: '탐색에서 저장',
      memoLabel: null,
    },
  ];

  describe('🔴 TRIP-1017 AC-C1~C4 · 등록 출처·메모 칩은 externalSource 로 가른다 (BR-U6-20)', () => {
    it.each(SOURCE_CASES)(
      '$title → 출처 "$sourceLabel" · 메모 칩 $memoLabel',
      ({ externalSource, memo, sourceLabel, memoLabel }) => {
        // Arrange: 판정 입력만 바꾼 실 SavedStay. 'externalSource' in 을 지키려고 undefined 는 키째 뺀다.
        const base = stay('s-src');
        const input: SavedStay = {
          ...base,
          ...(externalSource === undefined ? {} : { externalSource }),
          ...(memo === undefined ? {} : { memo }),
        };
        mockUseSaved.mockReturnValue(savedResult([input]));

        // Act
        renderPage();

        // Assert: 페이지가 화면에 넘긴 행 VM 의 두 라벨이 표와 완전일치한다.
        const rows = mockScreenProps.current?.rows ?? [];
        expect(rows).toHaveLength(1);
        expect(rows[0].sourceLabel).toBe(sourceLabel);
        expect(rows[0].memoLabel).toBe(memoLabel);
      }
    );
  });
});

// 옛 MyStaysPage.release — TRIP-1076 AC-6·TRIP-1017 C1
describe('실 화면 + msw — 거점 변경·출처 칩 (옛 .release)', () => {
  beforeEach(() => {
    mockRealWiring = true;
  });

  /**
   * l04 출발점 버튼을 **실 페이지 + 실 화면 + 실 react-query + MSW** 로 잰다.
   *
   * TRIP-1076 결정 2(A)로 이 파일의 대상이 바뀌었다. TRIP-1017 은 버튼을 「출발점 해제」(다이얼로그 → DELETE)로
   * 잠갔는데, 사용자 결정으로 Figma l04 대로 「거점 변경」 → 그 여행의 거점 화면 이동이 됐다. 그래서
   *  - 옛 AC-B1(해제 다이얼로그 문구) → **반전**: 누르면 다이얼로그 없이 거점 화면으로 push, 쓰기 요청 0.
   *  - 옛 AC-B2·B3(확정 → DELETE 성공·취소)·AC-B4(DELETE 실패 토스트) → **삭제**: 이 화면에 DELETE 경로 자체가 없다.
   *    "쓰기 0" 은 새 AC-6 케이스가 서버에 나간 요청 목록으로 잰다.
   *  - AC-C1(렌더): LOCALDATA 저장 숙소 행은 "탐색에서 저장"이고 "OTA 예약"·"예약번호 미입력"이 없다 — 유지.
   * 파일 이름(release)은 이력 연속을 위해 그대로 둔다.
   *
   * ★ DELETE 핸들러는 남겨 둔다(02a ★12) — 잘못 나간 DELETE 가 `onUnhandledRequest` 에러가 아니라
   *   "쓰기 목록 불일치"로 읽혀야 원인이 바로 보인다.
   * ★ 토스트는 모듈 싱글턴이다 — 리셋은 파일 최상위 afterEach(케이스를 지워도 장치는 둔다).
   *
   * 3동작 뼈대: 준비(서버: 저장 숙소 1 · 여행 1 · 거점 1 → 등록 행 도착 대기) → 실행(「거점 변경」 press) →
   *  단언(서버로 나간 쓰기 요청 목록 · push 인자 · 행 글자).
   */

  const BASE = `${
    process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
  }/api/v1`;

  const STAY: SavedStay = {
    savedStayId: 's1',
    name: '해운대 오션뷰',
    lat: 35.1587,
    lng: 129.1604,
    coordConfirmed: true,
    linkedTripIds: ['t1'],
    checkIn: '2026-06-10',
    checkOut: '2026-06-13',
    // ♥ 저장(탐색 카탈로그) 숙소 — #090 의 실제 재현 데이터(지자체 인허가 원천).
    externalSource: 'LOCALDATA',
    externalId: 'L-0001',
    registerRoute: 'MAP_SEARCH',
    memo: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const TRIP = {
    tripId: 't1',
    title: '부산 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    baseCount: 1,
    itineraryDayCount: 3,
  } as unknown as Trip;

  const BASE_ROW: BaseAssignment = {
    baseAssignmentId: 'ba1',
    savedStayId: 's1',
    dateFrom: '2026-06-10',
    dateTo: '2026-06-13',
  };

  // ── 서버 상태 ─────────────────────────────────────────────────────────────
  let serverBases: BaseAssignment[] = [];
  /** GET 이 아닌 요청 전부 — "`METHOD /path`". 재생성·생성 세션 같은 쓰기가 끼면 목록이 달라진다. */
  let writes: string[] = [];
  let started = 0;
  let ended = 0;
  let queryClient: QueryClient;

  function installServer(): void {
    server.use(
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([STAY])),
      http.get(`${BASE}/trips`, () => HttpResponse.json([TRIP])),
      // 상태형 — DELETE 가 성공하면 재조회는 빈 거점 목록을 받는다.
      http.get(`${BASE}/trips/t1/bases`, () => HttpResponse.json(serverBases)),
      // 이 화면은 DELETE 를 쏘지 않는다 — 잘못 나가면 writes 에 찍혀 단언이 가른다.
      http.delete(`${BASE}/trips/t1/bases/ba1`, () => {
        serverBases = [];
        return new HttpResponse(null, { status: 204 });
      })
    );
  }

  const newClient = (): QueryClient => newTestQueryClient({ gcTime: 0 });

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <WithToastHost>
          <MyStaysPage />
        </WithToastHost>
      </QueryClientProvider>
    );
  }

  /** 시작한 요청이 모두 끝나고 그 결과가 화면에 반영될 때까지 흘린다. */
  async function settleNetwork(): Promise<void> {
    await waitFor(() => expect(ended).toBe(started));
    await act(async () => {});
  }

  const row = () => screen.getByTestId('my-stays-row-s1');

  /** 거점 조회가 도착해 s1 이 등록(출발점) 행으로 그려질 때까지 기다린다. */
  async function waitAssignedRow(): Promise<void> {
    await waitFor(() =>
      expect(screen.getByTestId('my-stays-base-toggle-s1')).toBeOnTheScreen()
    );
    await settleNetwork();
    // 앵커 — 등록 행의 두 표지(배지·연결 여행)가 있다(아래 "사라진다"가 공허하지 않게).
    expect(within(row()).getByText('거점')).toBeOnTheScreen();
    expect(within(row()).getByText('연결 여행 · 부산 여행')).toBeOnTheScreen();
  }

  function onRequestStart({ request }: { request: Request }): void {
    started += 1;
    if (request.method !== 'GET') {
      writes.push(`${request.method} ${new URL(request.url).pathname}`);
    }
  }
  function onRequestEnd(): void {
    ended += 1;
  }

  beforeAll(() => {
    server.events.on('request:start', onRequestStart);
    server.events.on('request:end', onRequestEnd);
  });
  afterAll(() => {
    server.events.removeListener('request:start', onRequestStart);
    server.events.removeListener('request:end', onRequestEnd);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    serverBases = [BASE_ROW];
    writes = [];
    started = 0;
    ended = 0;
    queryClient = newClient();
    setAccessToken('valid-access');
  });

  // 토스트 스토어는 모듈 싱글턴이라 테스트 사이로 샌다 — 파일 최상위에서 비운다(02a ★4).
  afterEach(() => {
    resetToast();
    server.resetHandlers();
    clearAccessToken();
    queryClient.clear();
  });

  describe('🔴 TRIP-1076 AC-6 · 「거점 변경」 → 거점 화면, 이 화면은 거점을 쓰지 않는다 (결정 2(A))', () => {
    it('누르면 다이얼로그 없이 /trips/[tripId]/bases 로 push 1회, 서버 쓰기 요청 0, 행은 출발점 그대로', async () => {
      // 준비
      installServer();
      renderPage();
      await waitAssignedRow();

      // 실행 — 버튼은 역할·이름으로 찾는다(글자 반전이 함께 잠긴다).
      fireEvent.press(screen.getByRole('button', { name: '거점 변경' }));
      await settleNetwork();

      // 단언 ① — 그 여행의 거점 화면으로 한 번.
      // TRIP-1082 — l04 입구는 거점 **편집 모드**로 연다(진행바·생성 CTA 없이 [완료] 하나). h04 입구는 mode 없음.
      expect(mockPush.mock.calls).toEqual([
        [
          {
            pathname: '/trips/[tripId]/bases',
            params: { tripId: 't1', mode: 'edit' },
          },
        ],
      ]);
      // 단언 ② — 확인 없이 거점을 바꾸거나 재생성하지 않는다(BR-U6-21 금지 조항): 쓰기 요청이 하나도 없다.
      expect(writes).toEqual([]);
      expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
      // 단언 ③ — 행은 그대로 등록 상태다.
      expect(within(row()).getByText('거점')).toBeOnTheScreen();
      expect(
        within(row()).getByText('연결 여행 · 부산 여행')
      ).toBeOnTheScreen();
    });
  });

  describe('🔴 TRIP-1017 AC-C1 · 탐색에서 저장한 숙소는 예약이라고 말하지 않는다 (렌더)', () => {
    it('LOCALDATA 저장 숙소 행에 "탐색에서 저장"이 있고 "OTA 예약"·"예약번호 미입력"은 없다', async () => {
      installServer();
      renderPage();
      await waitAssignedRow();

      expect(within(row()).getByText('탐색에서 저장')).toBeOnTheScreen();
      expect(within(row()).queryByText('예약 사이트')).toBeNull();
      expect(within(row()).queryByText('예약번호 미입력')).toBeNull();
    });
  });

  // TRIP-1637 · `GET /saved-stays`·`GET /trips` 조회 실패가 "숙소를 탐색하고 등록하면…"(empty)으로 접히던 문제(INV-4).
  // 테스트 클라이언트는 재시도 0 이라 실패 응답 1개 = 실패 1회다(앱 전역은 자동 재시도 3회 ≈7초 뒤 — jest 사각, 6-b).
  // *(개념 — 응답 큐)* 요청마다 줄 맨 앞 응답을 꺼내 돌려주고, 줄이 비면 평소 응답. 'hold' 는 열쇠(gate)가 풀릴 때까지 답을 미룬다.
  describe('TRIP-1637 · 조회 실패 — empty 로 접지 않고 실패 얼굴 + 다시 시도', () => {
    const ERROR = 'my-stays-error';
    const RETRY = 'my-stays-retry';
    const EMPTY = 'my-stays-empty';
    const EXPLORE = 'my-stays-explore';
    const TITLE = '등록 숙소를 불러올 수 없어요';
    const DESCRIPTION = '잠시 후 다시 시도해 주세요';

    type Reply = 'ok' | 500 | 'network' | 'hold';
    let savedReplies: Reply[] = [];
    let tripsReplies: Reply[] = [];
    let savedBody: SavedStay[] = [];
    /** 경로별 GET 횟수 — 핸들러 안에서 센다(바깥 `started` 는 bases 까지 합산이라 경로를 못 가른다). */
    let hits = { saved: 0, trips: 0 };
    let release: () => void = () => {};
    let gate: Promise<void> = Promise.resolve();

    function failure(): Response {
      return HttpResponse.json(
        { error: { code: 'INTERNAL', message: '서버 오류' } },
        { status: 500 }
      );
    }

    beforeEach(() => {
      savedReplies = [];
      tripsReplies = [];
      savedBody = [STAY];
      hits = { saved: 0, trips: 0 };
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      // 평소 서버(bases 포함)를 깔고, 같은 경로 큐 핸들러를 그 위에 얹는다(server.use 는 앞에 끼운다).
      installServer();
      server.use(
        http.get(`${BASE}/saved-stays`, async () => {
          hits.saved += 1;
          const reply = savedReplies.shift() ?? 'ok';
          if (reply === 'network') return HttpResponse.error();
          if (reply === 500) return failure();
          if (reply === 'hold') await gate;
          return HttpResponse.json(savedBody);
        }),
        http.get(`${BASE}/trips`, async () => {
          hits.trips += 1;
          const reply = tripsReplies.shift() ?? 'ok';
          if (reply === 'network') return HttpResponse.error();
          if (reply === 500) return failure();
          if (reply === 'hold') await gate;
          return HttpResponse.json([TRIP]);
        })
      );
    });

    // 실패해 중간에 죽은 케이스가 보류 요청을 남기지 않게(02a ★8).
    afterEach(() => {
      release();
    });

    /** react-query 는 상태 변화를 setTimeout 0 으로 구독자에게 알린다 — 그 뒤까지 흘려 화면에 반영시킨다(02a ★2). */
    async function pause(ms = 30): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    const rowTestIds = () => screen.queryAllByTestId(/^my-stays-row-/);

    it.each<[string, Reply]>([
      ['서버 오류(500)', 500],
      ['네트워크 실패', 'network'],
    ])(
      '저장 숙소 첫 조회가 %s 이면 실패 얼굴과 다시 시도가 보이고 empty·숙소 탐색·행은 없다',
      async (_label, reply) => {
        // 준비
        savedReplies = [reply];

        // 실행
        renderPage();

        // 단언 — 얼굴이 먼저 도착해야 "empty 없음"이 의미가 있다(02a ★1).
        const face = await screen.findByTestId(ERROR);
        expect(within(face).getByText(TITLE)).toBeOnTheScreen();
        expect(within(face).getByText(DESCRIPTION)).toBeOnTheScreen();
        expect(
          within(screen.getByTestId(RETRY)).getByText('다시 시도')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId(EMPTY)).toBeNull();
        expect(screen.queryByTestId(EXPLORE)).toBeNull();
        expect(rowTestIds()).toHaveLength(0);
        expect(screen.getByTestId('my-stays-back')).toBeOnTheScreen();
        await settleNetwork();
      }
    );

    it('다시 시도를 누르면 저장 숙소만 한 번 더 받아 행이 나타나고 실패 얼굴은 사라진다', async () => {
      // 준비 — 첫 GET 만 실패. 실패 얼굴이 뜬 상태가 출발점이다(앵커).
      savedReplies = [500, 'ok'];
      renderPage();
      await screen.findByTestId(ERROR);
      expect(hits.saved).toBe(1);

      // 실행
      fireEvent.press(screen.getByTestId(RETRY));

      // 단언 — 행이 뜨고 얼굴·버튼이 사라진다. 실패하지 않은 /trips 는 다시 부르지 않았다(02a ★5).
      expect(await screen.findByTestId('my-stays-row-s1')).toBeOnTheScreen();
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryByTestId(RETRY)).toBeNull();
      await settleNetwork();
      expect(hits.saved).toBe(2);
      expect(hits.trips).toBe(1);
    });

    it('다시 시도도 실패하면 실패 얼굴로 돌아오고 버튼이 다시 눌리며 empty 로 접히지 않는다', async () => {
      // 준비 — 두 번 다 실패.
      savedReplies = [500, 500];
      renderPage();
      await screen.findByTestId(ERROR);

      // 실행 — 누르고, 두 번째 요청이 도착해 끝날 때까지 기다린다. 누른 직후엔 옛 얼굴이 아직 화면에 있어서
      // 바로 단언하면 버튼이 아무것도 안 해도 통과한다(02a ★2·★4).
      fireEvent.press(screen.getByTestId(RETRY));
      await waitFor(() => expect(hits.saved).toBe(2));
      await settleNetwork();
      await pause();

      // 단언 — 앵커: 재시도가 실제로 실패로 끝났다.
      const state = queryClient.getQueryState(getGetSavedStaysQueryKey());
      expect(state?.status).toBe('error');
      expect(state?.fetchStatus).toBe('idle');
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
      expect(screen.getByTestId(RETRY)).not.toBeDisabled();
      expect(screen.queryByTestId(EMPTY)).toBeNull();
      expect(rowTestIds()).toHaveLength(0);
      expect(hits.saved).toBe(2);
    });

    it('재시도 응답이 오기 전에도 실패 얼굴이 그대로이고 버튼은 비활성이며, 연타해도 요청은 늘지 않는다', async () => {
      // 준비 — 두 번째 응답을 붙들어 둔다. 데이터 없는 쿼리를 refetch 하면 status 가 pending 으로 돌아가
      // `isError` 가 꺼진다 — "1615 복제" 구현은 여기서 앱바만 남은 빈 화면이 된다(02a ★2).
      savedReplies = [500, 'hold'];
      renderPage();
      await screen.findByTestId(ERROR);
      expect(hits.saved).toBe(1);

      // 실행 ① — 누르고, 재조회 요청이 서버에 도착한 뒤 화면에 반영될 시간을 준다.
      fireEvent.press(screen.getByTestId(RETRY));
      await waitFor(() => expect(hits.saved).toBe(2));
      await pause();

      // 단언 ① — 보류 중: 얼굴 유지 · 버튼 비활성 · 다른 얼굴이 끼어들지 않는다.
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
      expect(screen.getByTestId(RETRY)).toBeDisabled();
      expect(screen.queryByTestId(EMPTY)).toBeNull();
      expect(screen.queryByTestId(EXPLORE)).toBeNull();

      // 실행 ② — 연타. refetch 는 진행 중 요청을 취소하고 새로 쏘므로 가드가 새면 hits 가 늘어난다(02a ★3).
      fireEvent.press(screen.getByTestId(RETRY));
      fireEvent.press(screen.getByTestId(RETRY));
      await pause();

      // 단언 ②
      expect(hits.saved).toBe(2);

      // 열쇠를 풀면 응답이 오고 행이 나타난다.
      release();
      expect(await screen.findByTestId('my-stays-row-s1')).toBeOnTheScreen();
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryByTestId(RETRY)).toBeNull();
      await settleNetwork();
    });

    it('서버가 준 진짜 0건은 실패가 아니라 기존 empty 얼굴이다 (선제 green)', async () => {
      // 준비
      savedBody = [];

      // 실행
      renderPage();

      // 단언
      expect(await screen.findByTestId(EMPTY)).toBeOnTheScreen();
      expect(screen.getByTestId(EXPLORE)).toBeOnTheScreen();
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryByTestId(RETRY)).toBeNull();
      await settleNetwork();
      expect(hits.saved).toBe(1);
    });

    it('/trips 가 실패하면 저장 숙소는 받았어도 같은 실패 얼굴이고 "연결된 여행 없음" 행을 그리지 않는다', async () => {
      // 준비 — 저장 숙소 정상(1건), 여행 목록만 실패. 지금은 모든 행이 "연결된 여행 없음"으로 거짓 표시된다.
      tripsReplies = [500];

      // 실행
      renderPage();

      // 단언 — 얼굴 먼저, 그다음 저장 숙소 응답까지 가라앉은 뒤에 "행 없음"을 본다(02a ★1).
      const face = await screen.findByTestId(ERROR);
      expect(within(face).getByText(TITLE)).toBeOnTheScreen();
      await settleNetwork();
      await pause();
      expect(hits.saved).toBe(1);
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
      expect(screen.queryByTestId(EMPTY)).toBeNull();
      expect(rowTestIds()).toHaveLength(0);
      expect(screen.queryByText('연결된 여행 없음')).toBeNull();
    });

    it('/trips 실패 뒤 다시 시도하면 실패한 /trips 만 다시 받아 행과 연결 여행이 나타난다', async () => {
      // 준비
      tripsReplies = [500, 'ok'];
      renderPage();
      await screen.findByTestId(ERROR);
      await settleNetwork();

      // 실행
      fireEvent.press(screen.getByTestId(RETRY));

      // 단언 — 등록 행 + 「연결 여행 · 부산 여행」(waitAssignedRow 가 앵커 포함). 저장 숙소는 다시 받지 않았다(02a ★5).
      await waitAssignedRow();
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryByTestId(RETRY)).toBeNull();
      expect(hits.trips).toBe(2);
      expect(hits.saved).toBe(1);
    });

    it('/trips 재시도 응답이 오기 전에도 실패 얼굴이 그대로이고 버튼은 비활성이며, 저장 숙소 행을 "연결된 여행 없음"으로 그리지 않는다', async () => {
      // 준비 — 저장 숙소는 정상, 여행 목록의 두 번째 응답을 붙들어 둔다. /trips 도 데이터가 없어 refetch 하면
      // pending 으로 돌아가므로, 판정이 isError 만 보거나 retrying 이 trips 를 빼먹으면 이 구간에서 거짓 행이 되살아난다.
      tripsReplies = [500, 'hold'];
      renderPage();
      await screen.findByTestId(ERROR);
      await settleNetwork();
      expect(hits.trips).toBe(1);

      // 실행 ① — 누르고, 재조회 요청이 서버에 도착한 뒤 화면에 반영될 시간을 준다.
      fireEvent.press(screen.getByTestId(RETRY));
      await waitFor(() => expect(hits.trips).toBe(2));
      await pause();

      // 단언 ① — 보류 중: 얼굴 유지 · 버튼 비활성 · 거짓 행 없음.
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
      expect(screen.getByTestId(RETRY)).toBeDisabled();
      expect(screen.queryByTestId(EMPTY)).toBeNull();
      expect(rowTestIds()).toHaveLength(0);
      expect(screen.queryByText('연결된 여행 없음')).toBeNull();

      // 실행 ② — 연타. 요청이 늘지 않고, 실패하지 않은 저장 숙소도 다시 부르지 않는다.
      fireEvent.press(screen.getByTestId(RETRY));
      fireEvent.press(screen.getByTestId(RETRY));
      await pause();

      // 단언 ②
      expect(hits.trips).toBe(2);
      expect(hits.saved).toBe(1);

      // 열쇠를 풀면 응답이 오고 연결 여행까지 나타난다.
      release();
      await waitAssignedRow();
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryByTestId(RETRY)).toBeNull();
    });

    it('저장 숙소만 실패했고 /trips 는 아직 응답 전이면, 다시 시도는 눌린다 — 비활성은 실패한 쿼리가 다시 받는 중일 때만', async () => {
      // 준비 — saved 는 500, trips 는 응답을 붙든다(첫 요청부터 진행 중). 실패한 쪽(saved)은 쉬고 있다.
      savedReplies = [500];
      tripsReplies = ['hold'];
      renderPage();
      await screen.findByTestId(ERROR);
      await waitFor(() => expect(hits.trips).toBe(1));
      await pause();

      // 단언 ① — trips 가 진행 중이어도 버튼은 활성이다(retrying 이 "아무 쿼리의 isFetching" 이면 red).
      expect(screen.getByTestId(RETRY)).not.toBeDisabled();

      // 실행 — 누른다. 실패한 saved 만 다시 받고 trips 는 건드리지 않는다.
      fireEvent.press(screen.getByTestId(RETRY));
      await waitFor(() => expect(hits.saved).toBe(2));
      await pause();

      // 단언 ②
      expect(hits.trips).toBe(1);

      // 마무리 — trips 응답이 오면 등록 행이 선다.
      release();
      await waitAssignedRow();
      expect(screen.queryByTestId(ERROR)).toBeNull();
    });

    it.each<[string, boolean, () => readonly unknown[]]>([
      ['저장 숙소', true, getGetSavedStaysQueryKey],
      ['여행 목록', false, getGetTripsQueryKey],
    ])(
      '%s 를 이미 받은 뒤 재조회가 실패해도 행은 그대로고 실패 얼굴은 없다 — 판정은 "데이터가 없다"',
      async (_label, isSaved, queryKey) => {
        // 준비 — 첫 GET 성공(등록 행이 뜬다), 다음 GET 은 500.
        if (isSaved) savedReplies = ['ok', 500];
        else tripsReplies = ['ok', 500];
        renderPage();
        await waitAssignedRow();

        // 실행 — 외부 무효화(다른 화면의 저장·삭제 성공 등이 하는 일)로 재조회를 일으킨다.
        await act(async () => {
          await queryClient.invalidateQueries({ queryKey: queryKey() });
        });

        // 단언 ① — 앵커: 재조회가 실제로 실패했고(error) 받아 둔 데이터는 남았다(02a ★6).
        expect(isSaved ? hits.saved : hits.trips).toBe(2);
        expect(queryClient.getQueryState(queryKey())?.status).toBe('error');
        expect(queryClient.getQueryData(queryKey())).toHaveLength(1);
        await pause();

        // 단언 ② — 그 위에서 화면은 목록을 유지한다.
        expect(screen.getByTestId('my-stays-row-s1')).toBeOnTheScreen();
        expect(
          within(row()).getByText('연결 여행 · 부산 여행')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId(ERROR)).toBeNull();
        expect(screen.queryByTestId(RETRY)).toBeNull();
        expect(screen.queryByTestId(EMPTY)).toBeNull();
      }
    );
  });

  // B안(2026-11-01) — 지운 MyStaysScreen.test.tsx 가 props 로 만들던 얼굴을 응답 모양으로 만든다.
  // 주소 줄(location) 단언은 옮기지 않았다 — 페이지가 늘 빈 주소를 내려(SavedStay 에 주소 필드가 없다) 실앱에 없는 길이다.
  describe('화면 얼굴 — 응답 모양마다 무엇을 그리나', () => {
    /** 미등록(거점 없음)·날짜 없음·OTA 출처·예약번호 비어 있음. */
    const OTA_STAY: SavedStay = {
      ...STAY,
      savedStayId: 's2',
      name: '남포동 게스트하우스',
      linkedTripIds: [],
      checkIn: null,
      checkOut: null,
      externalSource: 'NAVER',
      externalId: 'N-2',
      memo: null,
    };

    function serveStays(stays: SavedStay[]): void {
      installServer();
      server.use(
        http.get(`${BASE}/saved-stays`, () => HttpResponse.json(stays))
      );
    }

    it('등록 행은 이름·날짜·배지·"거점 변경"을, 미등록 행은 날짜·배지·버튼 없이 출처·메모·"연결된 여행 없음"을 그린다', async () => {
      // 준비
      serveStays([STAY, OTA_STAY]);

      // 실행
      renderPage();
      await waitAssignedRow();

      // 단언 ① — 등록 행(s1). 버튼 글자는 정확히 "거점 변경"이고 "›" 조각이 따로 없다.
      expect(within(row()).getByText('해운대 오션뷰')).toBeOnTheScreen();
      expect(within(row()).getByText('6.10 ~ 6.13')).toBeOnTheScreen();
      expect(
        within(screen.getByRole('button', { name: '거점 변경' })).getByText(
          '거점 변경'
        )
      ).toBeOnTheScreen();
      expect(screen.queryAllByText(/›/)).toHaveLength(0);

      // 단언 ② — 미등록 행(s2). 행은 있고, 배지·버튼·날짜(대체 문구 포함)는 없다.
      const other = screen.getByTestId('my-stays-row-s2');
      expect(within(other).getByText('남포동 게스트하우스')).toBeOnTheScreen();
      expect(within(other).getByText('예약 사이트')).toBeOnTheScreen();
      expect(within(other).getByText('예약번호 미입력')).toBeOnTheScreen();
      expect(within(other).getByText('연결된 여행 없음')).toBeOnTheScreen();
      expect(within(other).queryByText('거점')).toBeNull();
      expect(within(other).queryAllByRole('button')).toHaveLength(0);
      expect(
        within(other).queryAllByText(/\d+\.\d+\s*~|날짜 없음|날짜 미입력/)
      ).toHaveLength(0);
    });

    it('좌표 미확정 숙소의 "거점 변경"은 잠겨 있고 눌러도 거점 화면으로 가지 않는다 (INV-U1-08)', async () => {
      // 준비
      serveStays([{ ...STAY, coordConfirmed: false }]);
      renderPage();
      await waitAssignedRow();

      // 실행
      const toggle = screen.getByTestId('my-stays-base-toggle-s1');
      fireEvent.press(toggle);

      // 단언 — 짝(확정이면 push 1회)은 위 AC-6 이 본다.
      expect(toggle).toBeDisabled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('저장 숙소가 0건이면 제목 없는 안내와 "숙소 탐색"을 그리고, 누르면 숙소 탐색으로 간다 (US-NOTIF-06)', async () => {
      // 준비
      serveStays([]);

      // 실행
      renderPage();
      const empty = await screen.findByTestId('my-stays-empty');
      await settleNetwork();

      // 단언 — 문구는 완전 일치, 옛 제목은 없다.
      expect(
        within(empty).getByText(
          '숙소를 탐색하고 등록하면\n일정을 만들 수 있어요'
        )
      ).toBeOnTheScreen();
      expect(screen.queryByText('아직 등록된 숙소가 없어요')).toBeNull();
      const explore = screen.getByTestId('my-stays-explore');
      expect(within(explore).getByText('숙소 탐색')).toBeOnTheScreen();

      fireEvent.press(explore);
      expect(mockPush.mock.calls).toEqual([['/stays']]);
    });

    it('앱바 뒤로는 "뒤로" 버튼으로 읽히고 누르면 이전 화면으로 간다 (TRIP-991)', async () => {
      // 준비
      installServer();
      renderPage();
      await waitAssignedRow();

      // 실행
      fireEvent.press(screen.getByRole('button', { name: '뒤로' }));

      // 단언
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });
});
