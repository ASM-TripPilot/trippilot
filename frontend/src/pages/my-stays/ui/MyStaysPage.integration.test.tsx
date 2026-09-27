import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SavedStay } from '@/shared/api/generated/schemas';
import { useGetSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';
import { useGetTrips } from '@/shared/api/generated/trips/trips';
import type { MyStayRowVM } from '@/features/settings/ui/MyStaysScreen';

import { MyStaysPage } from './MyStaysPage';

/**
 * TRIP-605 · l04 페이지 배선 — 화면이 못 보는 **콜백→router/mutate 목적지**와 **미연결 행 VM 생산**을 잠근다.
 *
 * 무엇을 보장하나:
 *  - 🔴 AC-4(US-NOTIF-06) empty 의 탐색 콜백이 `router.push('/stays')` 로 배선된다.
 *  - 🔴 AC-2(BR-U6-21) 확정 콜백에 assigned 행이 오면 `DELETE /trips/{tripId}/bases/{baseAssignmentId}` mutate 가
 *    정확한 인자로 1회, POST 는 0회(연결 숙소 해제 = 이 티켓 코어, 미등록 지정 POST 완주는 범위 밖).
 *  - 🔴 AC-1(BR-U6-20) 여행 0건이면 저장 숙소가 미연결 → 행 VM 이 정확히 '연결된 여행 없음'·unassigned 로 조립된다.
 *
 * 왜 이렇게 테스트하나(02a ★3):
 *  - 화면(`MyStaysScreen`)을 **props 캡처 목**으로 치환하고 페이지를 렌더한다(route 위임 선례 `liveLocationRoute`).
 *    콜백은 캡처해 직접 호출하고, VM 은 캡처된 `rows` 를 읽는다 — 페이지 내부 fetch/N+1 기전에 무의존
 *    (trips 0건 시나리오라 bases 조회가 발화하지 않아 mechanism-agnostic).
 *  - DELETE 인자는 generated 훅 mutate 변수 shape `{tripId, baseAssignmentId}`(trips.ts 실측) 완전 잠금.
 */

const mockPush = jest.fn();
const mockPostMutate = jest.fn();

/**
 * 확정(DELETE) 성공 후 bases 쿼리 무효화(경고-3a)를 관측하기 위한 이음매.
 * react-query 는 DELETE 성공 시 onSuccess 를 부르지만, mutate 를 목으로 치환하면 그 호출이 사라진다 —
 * 그래서 목 mutate 가 서버 성공을 흉내내 onSuccess 를 직접 발화한다. 훅-레벨(`{mutation:{onSuccess}}`)·
 * 호출-레벨(`mutate(vars,{onSuccess})`) 어느 배선이든 관측되도록 둘 다 부른다(구현 설계를 강요하지 않는다).
 */
type DeleteHookOptions = {
  mutation?: { onSuccess?: (...args: unknown[]) => void };
};
const mockDeleteHolder: { options?: DeleteHookOptions } = {};
const mockDeleteMutate = jest.fn(
  (
    variables: { tripId: string; baseAssignmentId: string },
    perCallOptions?: { onSuccess?: (...args: unknown[]) => void }
  ) => {
    mockDeleteHolder.options?.mutation?.onSuccess?.(
      undefined,
      variables,
      undefined
    );
    perCallOptions?.onSuccess?.(undefined, variables, undefined);
  }
);
const mockScreenProps: { current: MyStaysScreenPropsShape | null } = {
  current: null,
};

interface MyStaysScreenPropsShape {
  rows: MyStayRowVM[];
  isEmpty: boolean;
  onConfirmBaseToggle: (row: MyStayRowVM) => void;
  onPressExplore: () => void;
}

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 화면을 props 캡처 스텁으로 치환한다. **null 을 반환**한다 — 팩토리 안에서 RN 엘리먼트를
// 만들면 NativeWind babel 이 `_ReactNativeCSSInterop` 를 스코프 밖 참조로 주입해 죽는다
// (`react-native-draggable-flatlist` 목 헤더가 경고하는 그 함정, layer-test.md).
jest.mock('@/features/settings/ui/MyStaysScreen', () => ({
  MyStaysScreen: (props: MyStaysScreenPropsShape) => {
    mockScreenProps.current = props;
    return null;
  },
}));

jest.mock('@/shared/api/generated/saved-stays/saved-stays', () => ({
  ...jest.requireActual('@/shared/api/generated/saved-stays/saved-stays'),
  useGetSavedStays: jest.fn(),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  ...jest.requireActual('@/shared/api/generated/trips/trips'),
  useGetTrips: jest.fn(),
  usePostTripsTripIdBases: jest.fn(() => ({ mutate: mockPostMutate })),
  useDeleteTripsTripIdBasesBaseAssignmentId: jest.fn(
    (options?: DeleteHookOptions) => {
      mockDeleteHolder.options = options;
      return { mutate: mockDeleteMutate };
    }
  ),
}));

const mockUseSaved = useGetSavedStays as jest.MockedFunction<
  typeof useGetSavedStays
>;
const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;

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
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MyStaysPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockPostMutate.mockClear();
  mockDeleteMutate.mockClear();
  mockDeleteHolder.options = undefined;
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

describe('🔴 AC-2 · 확정(assigned) → DELETE', () => {
  it('확정 콜백에 assigned 행이 오면 DELETE 를 {tripId, baseAssignmentId} 로 1회 부르고 POST 는 0회', () => {
    renderPage();

    const row: MyStayRowVM = {
      savedStayId: 's1',
      name: '해운대 오션뷰',
      location: '부산 해운대구 우동',
      dateRangeLabel: '6.10 ~ 6.13',
      sourceLabel: 'OTA 예약',
      memoLabel: null,
      linkedTripLabel: '연결 여행 · 부산 여행',
      baseState: 'assigned',
      canAssignBase: true,
      tripId: 't1',
      baseAssignmentId: 'ba1',
    };

    act(() => {
      mockScreenProps.current?.onConfirmBaseToggle(row);
    });

    expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
    expect(mockDeleteMutate.mock.calls[0][0]).toEqual({
      tripId: 't1',
      baseAssignmentId: 'ba1',
    });
    expect(mockPostMutate).not.toHaveBeenCalled();
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
    sourceLabel: 'OTA 예약',
    memoLabel: '예약번호 미입력',
  },
  {
    title: 'AGODA · 메모 빈 문자열',
    externalSource: 'AGODA',
    memo: '',
    sourceLabel: 'OTA 예약',
    memoLabel: '예약번호 미입력',
  },
  {
    title: 'NAVER · 메모 있음',
    externalSource: 'NAVER',
    memo: 'NV-20260610',
    sourceLabel: 'OTA 예약',
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

describe('🔴 경고-3a · 확정(DELETE) 성공 후 bases 쿼리 무효화', () => {
  it('확정 콜백에 assigned 행이 오면 DELETE 성공 후 useGetTripsTripIdBases 를 무효화한다', () => {
    // Arrange: 무효화를 관측할 수 있게 이 테스트 전용 client 로 렌더하고 invalidateQueries 를 감시한다.
    //   (invalidateQueries = 조회 캐시를 낡음으로 표시해 재조회를 유발한다 — 안 하면 해제해도 화면이 stale.)
    const client = new QueryClient();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <MyStaysPage />
      </QueryClientProvider>
    );

    const row: MyStayRowVM = {
      savedStayId: 's1',
      name: '해운대 오션뷰',
      location: '',
      dateRangeLabel: '6.10 ~ 6.13',
      sourceLabel: 'OTA 예약',
      memoLabel: null,
      linkedTripLabel: '연결 여행 · 부산 여행',
      baseState: 'assigned',
      canAssignBase: true,
      tripId: 't1',
      baseAssignmentId: 'ba1',
    };

    // Act: 출발점 해제 확정.
    act(() => {
      mockScreenProps.current?.onConfirmBaseToggle(row);
    });

    // Assert: DELETE 는 발화한다(경고-3 은 무효화 누락이지 mutate 누락이 아니다).
    expect(mockDeleteMutate).toHaveBeenCalledTimes(1);

    // 급소: 성공 후 bases 쿼리 무효화가 발화한다(현재 구현엔 onSuccess 무효화가 없어 red).
    expect(invalidateSpy).toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) =>
      JSON.stringify(call[0] ?? {})
    );
    expect(invalidatedKeys.some((key) => key.includes('/bases'))).toBe(true);

    invalidateSpy.mockRestore();
  });
});
