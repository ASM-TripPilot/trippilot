import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { Itinerary, ReplanDiff } from '@/shared/api/index.schemas';

import { seoulDate } from '@/shared/lib/seoulDate';

import { coverFor, FALLBACK_COVER } from '@/test-support/placeCoverFixtures';
import {
  mockExits,
  mockNavigation,
  mockRemove,
  resetFakeNavigator,
  type MockNavAction,
} from '@/test-support/fakePreventRemoveNavigator';
import { PlanbDraftPage } from './PlanbDraftPage';

/**
 * TRIP-751 · AC-9·AC-10 · E1·E3·E4 · Seed Q6·Q7·Q8 — i06 재계획안 페이지 배선판.
 * TRIP-1007 — DRAFT 의 빈 시트를 서버 초안(`GET …/diff`)으로 채운다(D1~D5).
 *
 * 무엇을 보장하나(세션 판정 1회 → 같은 뷰의 세 상태):
 *  - DRAFT → 초안(`after`) 순서대로 행을 그리고 [직접 수정]/[적용하기]. 초안이 아직 없거나(로딩·
 *    ready=false) 조회가 실패하면 안내를 띄우고 [적용하기]를 잠근다(TRIP-1007 — 옛 "제목만" 계약 반전).
 *  - [적용하기] → 확정 seam `useApplyReplan().mutate({tripId, sessionId}, { onSuccess })` 1회(E1 — diff
 *    확인 페이지를 거치지 않는다). onSuccess → 허브로 `router.dismissTo` + `applied=sessionId`(Q7 · TRIP-1418 —
 *    replace 면 스택 밑의 원래 허브 위에 허브가 한 장 더 쌓인다. 스택 모양 자체는 `planbApplyStack.integration`).
 *  - 확정 요청 중이면 [적용하기] 잠금, 실패면 같은 안내 자리에 "변경을 반영하지 못했어요"(Q6).
 *  - NO_SOLUTION·FAILED → 같은 뷰의 안내 상태. FAILED 에서 옛 manual?variant=error push 는 없다(E3).
 *    [조건 바꿔 다시 짜기] → 같은 입력을 시드로, 같은 트리거에 이은 i04(`/trips/{id}/planb` + 시드 쿼리),
 *    [다시 시도] → 같은 입력·같은 트리거로 바로 새 세션 → i05(사용자 결정 2026-10-20), [직접 수정] → planb/manual.
 *  - SOLVING·미도착 → 아무것도 안 그린다. data 없는 조회 실패만 오류 얼굴(TRIP-1277 AC12).
 *  - (TRIP-1289) 끝난 세션(APPLIED·CANCELED)은 종료 얼굴 + [나가기] — 빈 화면이면 침묵 실패다(INV-4).
 *  - (TRIP-1277) 초안 얼굴의 ‹·스와이프·하드웨어 뒤로는 이탈 확인부터 — [나가기]여야 나가고(확정·취소 0),
 *    replace·push 같은 앞으로 가는 이동은 가로채지 않는다. 대안 없음·실패 얼굴은 확인 없이 바로 뒤로,
 *    요청 대기 중엔 뒤로 자체가 잠긴다.
 *
 * ★ 뷰를 스텁하지 않고 실제로 그린다(02a ★6) — 잠금·실패 안내를 렌더 결과로 본다. 시트·지도는
 *   루트 `__mocks__` 통과형 목이 받는다.
 * ★ jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다(이름이 mock 으로 시작하는 것만
 *   예외). 그래서 세션·seam 상태를 mock 접두 홀더에 담고 목이 렌더 때 지연 읽기 한다.
 */

// TRIP-919 — 셸이 지도 실패(jest 엔 env 키가 없다)를 받으면 자기 폴백 바의 [다시 시도]를 띄워, 이 뷰의
// [다시 시도]와 `getByText` 가 두 개로 겹친다. 이 파일의 관심사는 지도가 아니라 뷰 액션이라 얇은 관찰
// 마커로 바꾼다(실패를 발화하지 않는다 — 페이지 통합 테스트 관례).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const TRIP_ID = 't1';
const SESSION_ID = 's9';

// TRIP-1277 — `error` 는 data 없는 조회 실패(AC12), `refetch` 는 [다시 시도]가 부를 재조회 seam.
// TRIP-1293 — `failures` 는 지금까지 실패로 끝난 조회 수(TanStack `errorUpdateCount`). data 가 없을 때 첫 로딩(0)과
// "실패 뒤 재조회 중"(1↑)을 가르는 유일한 결과 필드다 — 둘 다 status=pending·isError=false·isFetching=true(02a ★1).
// 결과 필드 값은 TanStack v5.101 실물을 옮겼다(02a §5 실측 1·2) — 실패 뒤 재조회는 isError 를 유지하지 않는다.
const mockSession: {
  data: Record<string, unknown> | undefined;
  error: boolean;
  failures: number;
} = {
  data: undefined,
  error: false,
  failures: 0,
};
const mockSessionRefetch = jest.fn();
const mockSessionFailure = new Error('세션 조회 실패');
jest.mock('../model/useReplanSession', () => ({
  useReplanSession: () => {
    const loading = mockSession.data === undefined && !mockSession.error;
    return {
      data: mockSession.data,
      status: mockSession.error ? 'error' : loading ? 'pending' : 'success',
      fetchStatus: loading ? 'fetching' : 'idle',
      isPending: loading,
      isLoading: loading,
      isFetching: loading,
      isError: mockSession.error,
      isLoadingError: mockSession.error && mockSession.data === undefined,
      isRefetchError: mockSession.error && mockSession.data !== undefined,
      error: mockSession.error ? mockSessionFailure : null,
      errorUpdateCount: mockSession.error
        ? Math.max(1, mockSession.failures)
        : mockSession.failures,
      failureCount: mockSession.error ? 1 : 0,
      refetch: mockSessionRefetch,
    };
  },
}));

const mockMutate = jest.fn();
// 상황 감지 FE-B — 확정 실패의 오류 객체(`error`)까지 싣는다: 409 EXPIRED·STALE 를 코드로 가른다(§3.6).
const mockApply: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};
jest.mock('@/features/apply-replan/model/useApplyReplan', () => ({
  useApplyReplan: () => ({
    mutate: mockMutate,
    isPending: mockApply.isPending,
    isError: mockApply.isError,
    error: mockApply.error,
  }),
}));

// 상황 감지 FE-B — 미포함 안내의 장소 이름 seam(`GET /places/{poiId}` 는 seam 자체의 통합 테스트가 본다).
// 기본은 아직(undefined). 페이지가 넘긴 인자(물을 POI — 없으면 null)를 기록한다.
const mockIncludedName: {
  value: string | null | undefined;
  calls: (string | null)[];
} = { value: undefined, calls: [] };
jest.mock('../model/useIncludedPlaceName', () => ({
  useIncludedPlaceName: (poiId: string | null) => {
    mockIncludedName.calls.push(poiId);
    return poiId === null ? undefined : mockIncludedName.value;
  },
}));

// 대안 없음 → [내일 일정 다시 짜기] — 세션 시작 seam(`useStartReplan`, 허브·i04 와 같은 래퍼).
// 페이지가 `{ tripId, data }` + onSuccess 로 부른다. 기본은 대기·실패 없음.
// 실패의 오류 객체(`error`)까지 싣는다 — 지난 날 세션의 재요청 409 를 상태 코드로 가른다.
const mockStartMutate = jest.fn();
const mockStart: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};
jest.mock('@/features/request-replan/model/useStartReplan', () => ({
  useStartReplan: () => ({
    mutate: mockStartMutate,
    isPending: mockStart.isPending,
    isError: mockStart.isError,
    error: mockStart.error,
  }),
}));

// TRIP-979 B — 출발 좌표 없는 세션의 지도 중심을 일정에서 고르려고 페이지가 일정을 읽는다.
// 기본은 미도착(undefined) — 기존 케이스는 세션 좌표가 있어 일정과 무관하다.
let mockItinerary: Itinerary | undefined;
jest.mock('@/features/execution/model/useLiveItinerary', () => ({
  useLiveItinerary: () => ({
    data: mockItinerary,
    isPending: mockItinerary === undefined,
    isError: false,
  }),
}));

// TRIP-1007 — 서버 초안 조회 seam. 기본은 "초안 도착"(beforeEach) — 적용·잠금 회귀 테스트가 활성
// [적용하기]를 전제로 하기 때문이다(02a ★8).
// 5-b 차단-1 — 목이 호출 인자를 기록하고(D6·P6~P8 이 단언), 꺼진 조회에는 데이터를 주지 않는다.
// 실제 react-query 에서 enabled:false 쿼리는 요청을 안 보내 data undefined·isPending true 로 머문다 —
// 이걸 흉내내지 않으면 대안 없음·실패 테스트가 실제로는 나올 수 없는 "초안 행이 섞인" 화면을 판정한다.
const mockDiff: {
  state: 'ok' | 'pending' | 'error';
  data: ReplanDiff | undefined;
  calls: [string, string, { enabled?: boolean } | undefined][];
} = { state: 'ok', data: undefined, calls: [] };
jest.mock('../model/useReplanDiff', () => ({
  useReplanDiff: (
    tripId: string,
    sessionId: string,
    options?: { enabled?: boolean }
  ) => {
    mockDiff.calls.push([tripId, sessionId, options]);
    if ((options?.enabled ?? true) === false || mockDiff.state === 'pending') {
      return { data: undefined, isPending: true, isError: false };
    }
    return mockDiff.state === 'error'
      ? { data: undefined, isPending: false, isError: true }
      : { data: mockDiff.data, isPending: false, isError: false };
  },
}));

// TRIP-1277 AC9 — 뒤로 가로채기(`usePreventRemove`)는 네비게이터 안에서만 돈다(실물은 밖에서 throw) → 가짜 네비게이터
// (`fakePreventRemoveNavigator` — 판정 규칙은 그 파일 머리). 여기선 `mockExits`(= 화면을 나감)로 센다.
const mockPush = jest.fn();
// ‹ 의 `router.back()` 도 실물처럼 가로채기를 거친다 — 켜진 채 부르면 콜백으로 되돌아온다.
const mockBack = jest.fn(() => mockRemove({ type: 'GO_BACK' }, 'back'));
const mockReplace = jest.fn();
// TRIP-1418 — 적용 성공의 허브 복귀. 실물 dismissTo 는 POP_TO 액션이라 가로채기를 거친다 — 맨 jest.fn() 이면
// "확인창 없이 나간다"(G1)가 공허하게 참이 된다(02a ★1).
const mockDismissTo = jest.fn((href: unknown) =>
  mockRemove({ type: 'POP_TO', payload: href }, 'dismissTo')
);
// 5-b 차단-1 — 뒤로 갈 화면이 있는가(false = 딥링크 착지). 가짜 back 은 이 값을 보지 않으므로
// false 케이스는 나감(mockExits)이 아니라 back·replace 호출 수로 판정한다(02a ★14).
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    canGoBack: () => mockCanGoBack,
  }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useNavigation: require('@/test-support/fakePreventRemoveNavigator')
    .useNavigation,
}));
jest.mock('@react-navigation/native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/fakePreventRemoveNavigator')
);

function session(
  status: string,
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    sessionId: SESSION_ID,
    tripId: TRIP_ID,
    itineraryId: 'it1',
    scope: 'PARTIAL_SLOTS',
    fromInstant: '2026-06-11T06:00:00Z',
    originKind: 'GPS',
    originLat: 35.1587,
    originLng: 129.1604,
    originEstimated: false,
    status,
    createdAt: '2026-06-11T05:59:00Z',
    ...over,
  };
}

// ── TRIP-1007 픽스처 ─────────────────────────────────────────────────────────────────────────
const DAY = '2026-06-11';
const key = (poiId: string) => `${DAY}#${poiId}`;

const cachedSlot = (poiId: string, nameKo: string, startAt: string) => ({
  poiId,
  nameKo,
  startAt,
  endAt: '18:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  tags: [],
  imageUrl: null,
  // 라이브 캐시의 거리는 "옛 순서의 바로 앞 슬롯"에서 잰 값이라 초안 행에 쓰면 거짓이다(01 맹점①).
  distanceRange: '9.9km',
  lat: null,
  lng: null,
});

/** 라이브 일정 — 6/11 이 2일차. px 는 여기 없다(이름 폴백 · 02a ★3). */
const DRAFT_ITINERARY = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'CONFIRMED',
  solveMode: 'FULL',
  generationMode: 'AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-10',
      slots: [cachedSlot('p0', '태종대', '10:00:00')],
    },
    {
      date: DAY,
      slots: [
        cachedSlot('p1', '감천문화마을', '09:30:00'),
        cachedSlot('p2', '광안리 해변', '11:00:00'),
        cachedSlot('p3', '부산시립미술관', '13:00:00'),
        cachedSlot('p4', '디키디키', '15:00:00'),
      ],
    },
  ],
} as unknown as Itinerary;

/** 응답 슬롯 — TRIP-1060 이후 서버가 이름·사진·카테고리·좌표(표면)를 싣는다. 안 주면 null(서버가 못 채움). */
const diffSlot = (
  poiId: string,
  startAt: string,
  endAt: string,
  surface: {
    nameKo?: string | null;
    lat?: number | null;
    lng?: number | null;
    imageUrl?: string | null;
    category?: string | null;
  } = {}
) => ({
  slotKey: key(poiId),
  startAt,
  endAt,
  isFixed: false,
  endsNextDay: false,
  ...surface,
});

/**
 * 서버 초안. 시각은 초까지 온다(서버 LocalTime — 02a ★2). entries 는 일부러 순서를 뒤섞었다 —
 * REMOVED 가 맨 앞, 나머지는 after 역순. 행 순서의 정본은 `after` 다(02a ★1).
 * `returnTimeDeltaMinutes` 는 소요시간 표기를 유혹하는 값이다(D4).
 */
const READY_DIFF: ReplanDiff = {
  ready: true,
  status: 'DRAFT',
  date: DAY,
  before: [
    diffSlot('p1', '09:30:00', '10:30:00', { nameKo: '감천문화마을' }),
    diffSlot('p2', '11:00:00', '12:00:00', { nameKo: '광안리 해변' }),
    diffSlot('p3', '13:00:00', '14:30:00', { nameKo: '부산시립미술관' }),
    diffSlot('p4', '15:00:00', '16:30:00', { nameKo: '디키디키' }),
  ],
  after: [
    diffSlot('p1', '09:30:00', '10:30:00', { nameKo: '감천문화마을' }),
    diffSlot('p3', '11:00:00', '12:30:00', { nameKo: '부산시립미술관' }),
    // px — 재계획이 새로 넣은 장소: 현재 일정(캐시)에 없지만 서버 초안은 이름을 싣는다(TRIP-1044).
    diffSlot('px', '13:10:00', '14:00:00', { nameKo: '해운대 시장' }),
    diffSlot('p2', '15:00:00', '16:00:00', { nameKo: '광안리 해변' }),
  ],
  entries: [
    {
      slotKey: key('p4'),
      change: 'REMOVED',
      beforeStart: '15:00:00',
      afterStart: null,
    },
    {
      slotKey: key('p2'),
      change: 'MOVED',
      beforeStart: '11:00:00',
      afterStart: '15:00:00',
    },
    {
      slotKey: key('px'),
      change: 'ADDED',
      beforeStart: null,
      afterStart: '13:10:00',
    },
    {
      slotKey: key('p3'),
      change: 'MOVED',
      beforeStart: '13:00:00',
      afterStart: '11:00:00',
    },
    {
      slotKey: key('p1'),
      change: 'UNCHANGED',
      beforeStart: '09:30:00',
      afterStart: '09:30:00',
    },
  ],
  impact: {
    visitCountDelta: 0,
    returnTimeDeltaMinutes: 30,
    totalDistanceDeltaM: null,
    totalDistanceKm: 6.3,
  },
};

/** 초안이 아직 없을 때 서버는 404 가 아니라 ready=false 로 비워서 준다(openapi /diff). */
const NOT_READY_DIFF: ReplanDiff = {
  ready: false,
  status: 'DRAFT',
  date: null,
  before: [],
  after: [],
  entries: [],
  impact: null,
};

/** INV-3 표기 탐지기(planbReplanDraftStructure G3 와 같은 정규식). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

function textsOf(pattern: RegExp): string[] {
  return screen
    .queryAllByTestId(pattern)
    .map((node) => String(node.props.children));
}

function renderDraft(diff: ReplanDiff = READY_DIFF) {
  mockItinerary = DRAFT_ITINERARY;
  mockSession.data = session('DRAFT');
  mockDiff.data = diff;
  renderPage();
}

// TRIP-1233 — [직접 수정]은 세션이 다시 짜던 날(targetDate, 없으면 fromInstant 의 여행지 날짜)을 싣는다.
// 기본 세션은 targetDate 가 없고 fromInstant 가 2026-06-11T06:00Z(=KST 15시, 6월 11일)라 DAY 다.
const MANUAL_HREF = {
  pathname: '/trips/[tripId]/planb/manual',
  params: { tripId: TRIP_ID, date: DAY },
};
/** 대안 없음 [조건 바꿔 다시 짜기]의 i04 — 시드·트리거는 라우트 쿼리로 간다(라우트가 갈라 i04 에 내린다). */
const requestHref = (params: Record<string, string>) => ({
  pathname: '/trips/[tripId]/planb',
  params: { tripId: TRIP_ID, ...params },
});

beforeEach(() => {
  resetFakeNavigator();
  mockSession.error = false;
  mockSession.failures = 0;
  mockSessionRefetch.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockCanGoBack = true;
  mockMutate.mockClear();
  mockApply.isPending = false;
  mockApply.isError = false;
  mockApply.error = null;
  mockIncludedName.value = undefined;
  mockIncludedName.calls = [];
  mockStartMutate.mockClear();
  mockStart.isPending = false;
  mockStart.isError = false;
  mockStart.error = null;
  mockSession.data = undefined;
  mockItinerary = undefined;
  mockDiff.state = 'ok';
  mockDiff.data = READY_DIFF;
  mockDiff.calls = [];
});

/** 페이지가 초안 seam 을 마지막으로 부른 인자. 호출이 0 이면 undefined 라 단언이 공허하게 통과하지 않는다. */
function lastDiffCall() {
  return mockDiff.calls[mockDiff.calls.length - 1];
}

/** 이 얼굴에서는 조회가 한 번도 켜지지 않았다 — 호출은 있었고(앵커), 전부 enabled:false 다. */
function expectDiffNeverEnabled() {
  expect(mockDiff.calls.length).toBeGreaterThan(0);
  for (const [tripId, sessionId, options] of mockDiff.calls) {
    expect([tripId, sessionId]).toEqual([TRIP_ID, SESSION_ID]);
    expect(options).toEqual({ enabled: false });
  }
}

function renderPage() {
  render(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

// TRIP-1007 — 옛 P1("DRAFT 는 제목만: 곳 수 빈칸·행 없음")은 QA #061 의 버그(빈 시트 + 활성 [적용하기])를
// 계약으로 굳혀 두었던 테스트라 D1~D5 로 교체했다. 버튼 두 개·렌더만으로 라우터·확정 0 은 D1 이 이어받는다.

describe('🔴 D1 · TRIP-1007 AC-1·AC-4 · US-PLANB-08 · INV-2 — 초안 행은 after 순서, 시각은 서버 값을 잘라 쓴다', () => {
  it('이름은 [감천문화마을, 부산시립미술관, 해운대 시장, 광안리 해변], 시각은 HH:mm–HH:mm, 전부 예정 톤, 커넥터 없음', () => {
    renderDraft();

    // after 순서(entries 순서도, 원 일정 순서도 아니다). px(새 장소)도 서버 응답의 이름으로 그려진다.
    expect(textsOf(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '부산시립미술관',
      '해운대 시장',
      '광안리 해변',
    ]);
    // 초까지 온 서버 시각을 분까지만 잘라 쓴다 — 다시 계산하지 않는다(INV-2).
    const times = screen.getAllByTestId(/^planb-draft-slot-time-/);
    expect(times).toHaveLength(4);
    expect(times[0]).toHaveTextContent('09:30–10:30');
    expect(times[1]).toHaveTextContent('11:00–12:30');
    expect(times[2]).toHaveTextContent('13:10–14:00');
    expect(times[3]).toHaveTextContent('15:00–16:00');
    // diff 엔 방문 여부가 없다 — 전 행 예정 톤(Seed Q6).
    const numbers = screen.getAllByTestId(/^planb-draft-slot-number-/);
    expect(numbers).toHaveLength(4);
    numbers.forEach((node) =>
      expect(String(node.props.className).split(/\s+/)).toContain('bg-primary')
    );
    // 행 사이 거리는 계약에 없다 — 캐시의 옛 순서 거리(9.9km)도, "계산 중"도 그리지 않는다(Seed Q2).
    expect(screen.queryAllByTestId(/^sheet-connector-/)).toHaveLength(0);

    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '적용하기'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).not.toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

const SLOT_NAMES = /^planb-draft-slot-name-/;

describe('🔴 D1b · TRIP-1044 — 행의 이름·사진은 일정 캐시가 아니라 응답 슬롯에서 온다', () => {
  it('일정 조회가 아직 비어 있어도(캐시 없음) 초안 행과 빠지는 곳 이름이 그려진다', () => {
    // 준비 — renderDraft 는 일정을 채우므로 쓰지 않고, 일정 미도착으로 직접 세운다.
    mockItinerary = undefined;
    mockSession.data = session('DRAFT');
    mockDiff.data = READY_DIFF;

    // 실행
    renderPage();

    // 단언 — 초안 행 4개 + REMOVED 1개 모두 이름이 있다(캐시 의존이면 전부 "이름 준비 중").
    expect(textsOf(SLOT_NAMES)).toEqual([
      '감천문화마을',
      '부산시립미술관',
      '해운대 시장',
      '광안리 해변',
    ]);
    expect(
      screen.getByTestId(`planb-draft-removed-${key('p4')}`)
    ).toHaveTextContent(/디키디키/);
  });

  it('응답 이름과 캐시 이름이 다르면 응답이 이긴다', () => {
    // 준비 — 캐시에는 같은 poiId 가 전혀 다른 이름으로 들어 있다.
    mockItinerary = {
      ...DRAFT_ITINERARY,
      days: DRAFT_ITINERARY.days.map((day) => ({
        ...day,
        slots: day.slots.map((slot) => ({
          ...slot,
          nameKo: `캐시-${slot.poiId}`,
        })),
      })),
    } as unknown as Itinerary;
    mockSession.data = session('DRAFT');
    mockDiff.data = READY_DIFF;

    renderPage();

    expect(textsOf(SLOT_NAMES)).toEqual([
      '감천문화마을',
      '부산시립미술관',
      '해운대 시장',
      '광안리 해변',
    ]);
    expect(
      screen.getByTestId(`planb-draft-removed-${key('p4')}`)
    ).toHaveTextContent(/디키디키/);
  });

  it('서버가 이름을 못 채운 행(nameKo null)은, 캐시에 같은 장소가 있어도 "이름 준비 중"이다', () => {
    // 준비 — p3 의 nameKo 만 null. 캐시에는 p3 가 '부산시립미술관' 으로 있다(캐시 폴백이면 이름이 나온다).
    renderDraft({
      ...READY_DIFF,
      after: READY_DIFF.after.map((slot) =>
        slot.slotKey === key('p3') ? { ...slot, nameKo: null } : slot
      ),
    });

    expect(textsOf(SLOT_NAMES)).toEqual([
      '감천문화마을',
      '이름 준비 중',
      '해운대 시장',
      '광안리 해변',
    ]);
  });

  it('imageUrl 이 온 행은 그 사진을, 나머지는 응답의 category·poiId 로 고른 생성 이미지를 같은 칸에 그린다', () => {
    // 준비 — p1 은 사진(+카테고리), p3 미술·p2 술집, px 는 카테고리 없음.
    const withSurface = (poiId: string) => {
      if (poiId === 'p1')
        return { imageUrl: 'https://example.test/a.jpg', category: '맛집' };
      if (poiId === 'p3') return { category: '미술' };
      if (poiId === 'p2') return { category: '술집' };
      return {};
    };
    renderDraft({
      ...READY_DIFF,
      after: READY_DIFF.after.map((slot) => ({
        ...slot,
        ...withSurface(slot.slotKey.split('#')[1]),
      })),
    });

    const sourceOf = (poiId: string) =>
      screen.getByTestId(`planb-draft-slot-photo-${key(poiId)}`).props.source;
    expect(screen.getAllByTestId(/^planb-draft-slot-photo-/)).toHaveLength(4);
    // p1: 서버 사진이 카테고리를 이긴다(맛집 그림이 아니다).
    expect(sourceOf('p1')).toEqual([{ uri: 'https://example.test/a.jpg' }]);
    // p3(미술, 변형 1)·p2(술집, 변형 3) — 행마다 자기 카테고리·자기 poiId. px 는 카테고리 없음 → 폴백.
    expect(sourceOf('p3')).toEqual([coverFor('미술', 'p3')]);
    expect(sourceOf('p2')).toEqual([coverFor('술집', 'p2')]);
    expect(sourceOf('px')).toEqual([FALLBACK_COVER]);
  });

  // 5-b 경고-1 — 값이 비었을 때 가는 길. 빠지는 곳 이름이 before 에도 없으면 장소 ID·캐시 이름이 아니라 폴백 문구.
  it('빠지는 곳의 before 이름이 null 이면(캐시에 있어도) "이름 준비 중"이고 slotKey·캐시 이름을 쓰지 않는다', () => {
    // 준비 — p4 의 before.nameKo 만 null. 캐시에는 p4 가 '디키디키' 로 있다.
    renderDraft({
      ...READY_DIFF,
      before: READY_DIFF.before.map((slot) =>
        slot.slotKey === key('p4') ? { ...slot, nameKo: null } : slot
      ),
    });

    const removed = screen.getByTestId(`planb-draft-removed-${key('p4')}`);
    expect(removed).toHaveTextContent(/이름 준비 중/);
    expect(removed).not.toHaveTextContent(/디키디키/);
    expect(removed).not.toHaveTextContent(/p4/);
  });

  // 5-b 참고-1 — 사진도 이름과 같은 규칙(응답에 없으면 캐시 사진으로 채우지 않는다).
  it('응답에 imageUrl 이 없으면 캐시에 사진이 있어도 그 사진을 그리지 않고 생성 이미지(폴백)를 그린다', () => {
    // 준비 — 캐시의 모든 슬롯에 사진이 있다. 응답(READY_DIFF)에는 imageUrl 도 category 도 하나도 없다.
    mockItinerary = {
      ...DRAFT_ITINERARY,
      days: DRAFT_ITINERARY.days.map((day) => ({
        ...day,
        slots: day.slots.map((slot) => ({
          ...slot,
          imageUrl: 'https://example.test/cache.jpg',
        })),
      })),
    } as unknown as Itinerary;
    mockSession.data = session('DRAFT');
    mockDiff.data = READY_DIFF;

    renderPage();

    const rows = screen.getAllByTestId(/^planb-draft-slot-photo-/);
    expect(rows).toHaveLength(4);
    // 캐시 사진 URL 이 어느 칸에도 안 새고, 카테고리가 없으니 모두 중립 폴백이다.
    rows.forEach((row) => expect(row.props.source).toEqual([FALLBACK_COVER]));
  });

  // 5-b 경고-2 — 카테고리는 사진 없는 행의 그림을 정한다. null 이면 중립 폴백 그림.
  it('사진 없는 행의 그림은 응답의 category 가 정한다(맛집 → food, 없음 → place.webp)', () => {
    renderDraft({
      ...READY_DIFF,
      after: READY_DIFF.after.map((slot) =>
        slot.slotKey === key('p1') ? { ...slot, category: '맛집' } : slot
      ),
    });

    const sourceOf = (poiId: string) =>
      screen.getByTestId(`planb-draft-slot-photo-${key(poiId)}`).props.source;
    // p1 은 변형 2 → food-2.
    expect(sourceOf('p1')).toEqual([coverFor('맛집', 'p1')]);
    expect(sourceOf('p3')).toEqual([FALLBACK_COVER]);
  });
});

// TRIP-1044 — 지도: 초안 슬롯 핀(전부 예정 톤) + 중심은 초안의 첫 좌표.
const withCoords = (
  pairs: Record<string, { lat: number; lng: number } | null>
): ReplanDiff => ({
  ...READY_DIFF,
  after: READY_DIFF.after.map((slot) => {
    const poiId = slot.slotKey.split('#')[1];
    const c = pairs[poiId];
    return c ? { ...slot, lat: c.lat, lng: c.lng } : slot;
  }),
});

describe('🔴 M1 · TRIP-1044 — 초안 슬롯이 지도 핀이 된다', () => {
  it('좌표가 있는 행만 핀이 되고, 좌표 없는 행이 있어도 번호는 행 자리를 지킨다(전부 예정 톤)', () => {
    // after 순서: p1(1번) · p3(2번, 좌표 없음) · px(3번) · p2(4번)
    renderDraft(
      withCoords({
        p1: { lat: 35.1, lng: 129.1 },
        px: { lat: 35.2, lng: 129.2 },
        p2: { lat: 35.3, lng: 129.3 },
      })
    );

    expect(screen.getByTestId('map-root').props.pins).toEqual([
      { number: 1, lat: 35.1, lng: 129.1, state: 'upcoming' },
      { number: 3, lat: 35.2, lng: 129.2, state: 'upcoming' },
      { number: 4, lat: 35.3, lng: 129.3, state: 'upcoming' },
    ]);
  });

  it('초안이 아직 없으면(로딩) 핀을 넘기지 않는다', () => {
    mockItinerary = DRAFT_ITINERARY;
    mockSession.data = session('DRAFT');
    mockDiff.state = 'pending';
    renderPage();

    expect(screen.getByTestId('map-root').props.pins).toBeUndefined();
  });
});

describe('🔴 M2 · TRIP-1044 — 지도 중심은 초안의 첫 좌표가 먼저다', () => {
  it('세션 출발 좌표가 있어도 초안의 첫 좌표(좌표 있는 첫 행)가 중심이다', () => {
    // 세션 기본값은 originLat 35.1587 — 이것을 이겨야 한다.
    renderDraft(
      withCoords({
        p3: { lat: 37.1, lng: 127.1 },
        px: { lat: 37.2, lng: 127.2 },
      })
    );

    expect(screen.getByTestId('map-root')).toHaveTextContent('37.1,127.1');
  });

  it('초안에 좌표가 하나도 없으면 기존 순서(세션 출발 좌표)로 내려간다', () => {
    renderDraft();

    expect(screen.getByTestId('map-root')).toHaveTextContent(
      '35.1587,129.1604'
    );
  });
});

describe('🔴 D2 · TRIP-1007 AC-6 — 헤더는 일차·날짜·{곳 수} · {총거리}km', () => {
  it('diff date 가 일정의 두 번째 날이면 2일차 · 6월 11일(목), meta 는 4곳 · 6.3km', () => {
    renderDraft();

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '4곳 · 6.3km'
    );
  });

  it.each([
    [
      'totalDistanceKm 이 null',
      {
        visitCountDelta: 0,
        returnTimeDeltaMinutes: 30,
        totalDistanceDeltaM: null,
        totalDistanceKm: null,
      },
    ],
    ['impact 자체가 null', null],
  ])('%s 이면 meta 는 곳 수만(0km 로 채우지 않는다)', (_label, impact) => {
    renderDraft({ ...READY_DIFF, impact });

    // 완전 일치 — "4곳 · 0km"·"4곳 · km" 가 여기서 red 다(02a ★7).
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('4곳');
  });
});

describe('🔴 D3 · TRIP-1007 AC-3 · BR-U4-25 — 빠지는 곳은 확정 전에 따로 보인다', () => {
  it('"이번 계획에서 빠지는 곳 1곳" 아래 디키디키 · 원래 15:00, 초안 행(번호 원)으로는 그리지 않는다', () => {
    renderDraft();

    expect(screen.getByText('이번 계획에서 빠지는 곳 1곳')).toBeOnTheScreen();
    const removed = screen.getByTestId(`planb-draft-removed-${key('p4')}`);
    expect(removed).toHaveTextContent(/디키디키/);
    expect(removed).toHaveTextContent(/원래 15:00/);
    expect(screen.queryAllByTestId(/^planb-draft-removed-/)).toHaveLength(1);

    // 초안 행과 구분 — 같은 키의 초안 행·번호 원이 없고, 초안 이름 목록에도 없다.
    expect(screen.queryByTestId(`planb-draft-slot-${key('p4')}`)).toBeNull();
    expect(textsOf(/^planb-draft-slot-name-/)).not.toContain('디키디키');
  });

  it('REMOVED 가 없으면 빠지는 곳 영역을 그리지 않는다', () => {
    renderDraft({
      ...READY_DIFF,
      entries: READY_DIFF.entries.filter((entry) => entry.change !== 'REMOVED'),
    });

    expect(screen.queryAllByTestId(/^planb-draft-removed-/)).toHaveLength(0);
    expect(screen.queryAllByText(/빠지는 곳/)).toHaveLength(0);
    expect(textsOf(/^planb-draft-slot-name-/)).toHaveLength(4);
  });
});

describe('🔴 D4 · TRIP-1007 AC-5 · INV-3 — 초안 화면 어디에도 소요시간 표기가 없다', () => {
  it('복귀 +30분 값이 와도 화면 글자에 N분·N시간·소요가 0건이다(+ 탐지기가 실제 글자를 본다는 앵커)', () => {
    renderDraft();

    // 앵커 — 같은 쿼리가 행 시각을 실제로 잡는다(빈 화면에서 공허하게 통과하지 않게).
    expect(screen.queryAllByText(/09:30–10:30/)).toHaveLength(1);
    // 한 Text 의 자식을 이어 붙여 판정한다 — {30}{'분'} 처럼 쪼개 써도 잡힌다(02a ★5).
    expect(screen.queryAllByText(DURATION_TEXT)).toHaveLength(0);
  });
});

describe('🔴 D5 · TRIP-1007 AC-2 · INV-4 — 초안이 안 왔거나 못 불러오면 안내 + [적용하기] 잠금', () => {
  it.each([
    ['조회 중', 'pending', undefined, '재계획안을 불러오는 중이에요'],
    [
      'ready=false(아직 산출 전)',
      'ok',
      NOT_READY_DIFF,
      '재계획안을 불러오는 중이에요',
    ],
    ['조회 실패', 'error', undefined, '재계획안을 불러오지 못했어요'],
  ] as const)(
    '%s — 안내 제목이 뜨고, 행이 없고, [적용하기]는 disabled 라 눌러도 확정 0회',
    (_label, state, diff, title) => {
      mockItinerary = DRAFT_ITINERARY;
      mockSession.data = session('DRAFT');
      mockDiff.state = state;
      mockDiff.data = diff;
      renderPage();

      expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
        title
      );
      expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(
        0
      );
      const apply = screen.getByTestId('sheet-cta-button-1');
      expect(apply).toHaveTextContent('적용하기');
      expect(apply).toBeDisabled();
      fireEvent.press(apply);
      expect(mockMutate).not.toHaveBeenCalled();
    }
  );

  it('조회 실패의 설명은 "잠시 후 다시 시도해 주세요"', () => {
    mockItinerary = DRAFT_ITINERARY;
    mockSession.data = session('DRAFT');
    mockDiff.state = 'error';
    renderPage();

    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('잠시 후 다시 시도해 주세요');
  });
});

describe('🔴 D6 · TRIP-1007 AC-1 · 5-b 차단-1 — 초안 얼굴은 이 세션의 diff 를 켜서 조회한다', () => {
  it('DRAFT 면 seam 을 (tripId, sessionId, { enabled: true }) 순서로 부른다', () => {
    renderDraft();

    // 앵커 — 초안이 실제로 그려졌다(가짜가 enabled 를 존중하므로 꺼졌으면 행이 0 이다).
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(4);
    expect(lastDiffCall()).toEqual([TRIP_ID, SESSION_ID, { enabled: true }]);
  });
});

// TRIP-1418 — 성공 뒤 이동이 replace 에서 dismissTo 로 바뀌었다(스택의 원래 허브로 돌아간다, QA Q-106).
describe('🔴 P2·P3 · AC-9(b)(c) · E1·Q7 — [적용하기]는 바로 확정하고 성공하면 원래 허브로 돌아간다', () => {
  it('누르면 seam mutate 가 {tripId, sessionId} + onSuccess 로 1회, diff 로 가는 push 는 없다', () => {
    mockSession.data = session('DRAFT');
    renderPage();

    fireEvent.press(screen.getByText('적용하기'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(
      { tripId: TRIP_ID, sessionId: SESSION_ID },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    expect(mockPush).not.toHaveBeenCalled();
    // 5-b 차단-1 — 성공 콜백 전에는 이동하지 않는다(P3 와 짝: "성공 뒤에만" 이동). 이동 수단 둘 다 본다(02a ★3).
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('onSuccess 가 불리면 router.dismissTo 가 허브 + applied=sessionId 로 1회 — replace·push 0', () => {
    mockSession.data = session('DRAFT');
    renderPage();
    fireEvent.press(screen.getByText('적용하기'));

    const options = mockMutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/live',
      params: { tripId: TRIP_ID, applied: SESSION_ID },
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('G1 적용 성공의 허브 복귀(POP_TO)는 이탈 확인 없이 1회 나간다 — 가로채기가 켜진 초안 얼굴에서도 (TRIP-1418 AC-3)', () => {
    renderDraft();
    // 앵커 — 이 얼굴은 가로채기가 켜져 있다(뒤로는 확인으로 붙잡힌다). 없으면 아래 "확인 0"이 공허하다(02a ★2).
    attemptRemove({ type: 'GO_BACK' });
    expect(screen.getByTestId(DRAFT_LEAVE)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId(`${DRAFT_LEAVE}-stay`));
    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();

    fireEvent.press(screen.getByText('적용하기'));
    const options = mockMutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
    expect(mockExits).toHaveLength(1);
  });
});

describe('🔴 TRIP-1195 결정 5 · 확정 뒤 허브는 확정한 날로 돌아간다', () => {
  function applyAndSucceed(): void {
    renderPage();
    fireEvent.press(screen.getByText('적용하기'));
    const options = mockMutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());
  }

  // TRIP-1418 — dismissTo 는 원래 허브의 params 를 통째로 바꾼다(병합 없음) — day 를 다시 실어야 그 일차로 열린다.
  it('C1 오늘이 아닌 날 세션을 확정하면 허브 params 에 day=그 날짜가 실린다', () => {
    mockSession.data = session('DRAFT', { targetDate: '2999-01-02' });
    applyAndSucceed();

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/live',
      params: { tripId: TRIP_ID, applied: SESSION_ID, day: '2999-01-02' },
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('C2 무회귀 — 오늘 세션을 확정하면 종전과 같은 params(day 없음)다', () => {
    mockSession.data = session('DRAFT', { targetDate: seoulDate(new Date()) });
    applyAndSucceed();

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/live',
      params: { tripId: TRIP_ID, applied: SESSION_ID },
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 P4 · AC-9(d) — 확정 요청 중에는 [적용하기]가 잠긴다', () => {
  it('seam isPending 이면 버튼이 disabled 이고 눌러도 mutate 가 안 불린다(이중 POST → 409 차단)', () => {
    mockSession.data = session('DRAFT');
    mockApply.isPending = true;
    renderPage();

    const apply = screen.getByTestId('sheet-cta-button-1');
    expect(apply).toHaveTextContent('적용하기');
    expect(apply).toBeDisabled();
    fireEvent.press(apply);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 P4b · 5-b 경고-1 — 확정 요청 중에는 [직접 수정]도 잠긴다(교차 잠금)', () => {
  it('seam isPending 이면 [직접 수정]이 disabled 이고 눌러도 push 가 없다(밑에 남은 초안의 onSuccess 가 편집 화면을 갈아 끼우는 경로 차단)', () => {
    mockSession.data = session('DRAFT');
    mockApply.isPending = true;
    renderPage();

    const manual = screen.getByTestId('sheet-cta-button-0');
    expect(manual).toHaveTextContent('직접 수정');
    expect(manual).toBeDisabled();
    fireEvent.press(manual);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 P5 · AC-9(e) · Q6 — 확정 실패는 같은 안내 자리에', () => {
  it('seam isError 면 실패 안내가 뜨고 replace 는 없으며, [적용하기]가 그대로 재시도다', () => {
    mockSession.data = session('DRAFT');
    mockApply.isError = true;
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '변경을 반영하지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '원래 일정은 그대로 있어요. 잠시 후 다시 시도해 주세요.'
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('적용하기'));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    // 5-b 차단-1 — 재시도를 눌러도 성공 전에는 이동하지 않는다.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });
});

describe('🔴 P6 · AC-10 · Q4 — NO_SOLUTION 은 같은 뷰의 대안 없음 상태', () => {
  it('안내 2줄(사유를 지어내지 않는 뒤 절만), 렌더만으로 push 0, 두 버튼이 i04·manual 로 간다', () => {
    mockSession.data = session('NO_SOLUTION');
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '대안을 찾지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('조건을 줄이거나 직접 고쳐 주세요');
    expect(mockPush).not.toHaveBeenCalled();
    // 5-b 차단-1 — 대안 없음 얼굴에서는 초안을 조회하지 않고, 그래서 초안 행도 없다.
    expectDiffNeverEnabled();
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);

    fireEvent.press(screen.getByText('조건 바꿔 다시 짜기'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    // 입력이 비어 있어도 시드로 연다(빈 시드) — 트리거 없는 세션이라 트리거 키도 없다.
    expect(mockPush).toHaveBeenLastCalledWith(
      requestHref({
        seedReasons: '',
        seedDirectives: '',
        seedExcludedPoiIds: '',
        scope: 'PARTIAL_SLOTS',
      })
    );

    fireEvent.press(screen.getByText('직접 수정'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenLastCalledWith(MANUAL_HREF);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });
});

/**
 * 사용자 결정(2026-10-20) — 대안 없음 [조건 바꿔 다시 짜기]는 조건을 바꾸라는 뜻이라 바로 다시 짜지 않는다. 대신 알림과
 * 끊긴 빈 요청 화면이 아니라, 이 세션의 입력을 시드로 채우고 같은 트리거에 이은 요청 화면을 연다(사유를 다시 고르지 않고,
 * 적용하면 그 알림이 소비되고, 전날 창에서도 막히지 않게).
 */
describe('🔴 대안 없음 [조건 바꿔 다시 짜기] — 같은 입력을 시드로, 같은 알림에 이은 요청 화면 (사용자 결정)', () => {
  it('Q1 알림으로 들어온 세션이면 사유·지시·제외·자유 입력·범위와 그 트리거를 실어 i04 를 연다 — 세션 시작 0', () => {
    mockSession.data = session('NO_SOLUTION', {
      targetDate: seoulDate(new Date()),
      triggerId: 'trg-1',
      reasons: ['WEATHER', 'TIRED'],
      directives: ['INDOOR'],
      excludedPoiIds: ['poi-out'],
      freeText: '카페로만',
    });
    renderPage();

    fireEvent.press(screen.getByText('조건 바꿔 다시 짜기'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      requestHref({
        seedReasons: 'WEATHER,TIRED',
        seedDirectives: 'INDOOR',
        seedExcludedPoiIds: 'poi-out',
        triggerId: 'trg-1',
        scope: 'PARTIAL_SLOTS',
        prefill: '카페로만',
      })
    );
    expect(mockStartMutate).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Q2 넣으려던 POI 가 있으면 그것도 잇는다(i04 → i05 → i06 미포함 안내)', () => {
    mockSession.data = session('NO_SOLUTION', {
      targetDate: seoulDate(new Date()),
    });
    render(
      <PlanbDraftPage
        tripId={TRIP_ID}
        sessionId={SESSION_ID}
        includePoiId="poi-sky"
      />
    );

    fireEvent.press(screen.getByText('조건 바꿔 다시 짜기'));

    expect(mockPush).toHaveBeenCalledWith(
      requestHref({
        seedReasons: '',
        seedDirectives: '',
        seedExcludedPoiIds: '',
        scope: 'PARTIAL_SLOTS',
        includePoiId: 'poi-sky',
      })
    );
  });
});

describe('🔴 TRIP-1195 · 다시 요청은 그 세션이 다시 짜던 날로 간다 (INV-4 — 오늘로 조용히 바뀌면 위반)', () => {
  it('R1 오늘이 아닌 날 세션이 NO_SOLUTION 이면 [조건 바꿔 다시 짜기]가 같은 targetDate 를 싣는다(범위는 i04 가 고정)', () => {
    mockSession.data = session('NO_SOLUTION', { targetDate: '2999-01-02' });
    renderPage();

    fireEvent.press(screen.getByText('조건 바꿔 다시 짜기'));

    expect(mockPush).toHaveBeenLastCalledWith(
      requestHref({
        seedReasons: '',
        seedDirectives: '',
        seedExcludedPoiIds: '',
        targetDate: '2999-01-02',
      })
    );
  });

  it('R2 무회귀 — 오늘 세션이면 날짜 키 없이 세션 범위로 연다', () => {
    mockSession.data = session('NO_SOLUTION', {
      targetDate: seoulDate(new Date()),
      scope: 'FULL_DAY',
    });
    renderPage();

    fireEvent.press(screen.getByText('조건 바꿔 다시 짜기'));

    const [href] = mockPush.mock.calls[0] as [
      { params: Record<string, string> },
    ];
    expect(href.params).toMatchObject({ scope: 'FULL_DAY' });
    expect(href.params).not.toHaveProperty('targetDate');
  });
});

// ── 오늘 밤 대안 없음 → 내일 일정 다시 짜기 ─────────────────────────────────────────────────────────
// 밤(KST 20:54)에 오늘을 다시 짜면 하루 창이 거의 안 남아 NO_SOLUTION 으로 끝난다. 그때 내일이 일정에
// 있으면 같은 조건으로 내일 하루 전체를 다시 짜는 보조 버튼을 준다. "오늘·내일"은 KST 날짜다.
// ★ 시계를 고정한다 — 실제 시계면 오늘·내일을 테스트도 같은 식으로 계산하게 돼 구현과 같이 틀린다.

const NEXT_DAY_TESTID = 'planb-draft-next-day';
// KST 2026-06-11 20:54 (UTC 11:54).
const TONIGHT = new Date('2026-06-11T11:54:00Z');

function itineraryOf(dates: string[]): Itinerary {
  return {
    ...DRAFT_ITINERARY,
    days: dates.map((date) => ({ date, slots: [] })),
  } as unknown as Itinerary;
}

/** 원 요청 값 — 내일 요청에 그대로 실려야 하는 것(사유·방향·자유 입력)과 실리면 안 되는 것(트리거·범위). */
const TONIGHT_REQUEST = {
  scope: 'PARTIAL_SLOTS',
  targetDate: '2026-06-11',
  reasons: ['WEATHER'],
  directives: ['INDOOR'],
  freeText: '비가 와요',
  triggerId: 'trg-1',
};

describe('🔴 N · 오늘 대안 없음 → [내일 일정 다시 짜기] (targetDate=내일 · FULL_DAY)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('N1 오늘 세션이 대안 없음이고 내일이 일정에 있으면 버튼이 보이고, 그리기만으로는 요청하지 않는다(기존 두 버튼·문구 유지)', () => {
    jest.useFakeTimers({ now: TONIGHT });
    mockItinerary = itineraryOf(['2026-06-11', '2026-06-12']);
    mockSession.data = session('NO_SOLUTION', TONIGHT_REQUEST);
    renderPage();

    expect(screen.getByTestId(NEXT_DAY_TESTID)).toHaveTextContent(
      '내일 일정 다시 짜기'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('조건을 줄이거나 직접 고쳐 주세요');
    expect(screen.getByText('조건 바꿔 다시 짜기')).toBeOnTheScreen();
    expect(screen.getByText('직접 수정')).toBeOnTheScreen();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });

  it('N2 누르면 세션 시작 1회 — targetDate=내일·scope=FULL_DAY, 사유·방향·자유 입력은 원 요청 그대로, 트리거는 null', () => {
    jest.useFakeTimers({ now: TONIGHT });
    mockItinerary = itineraryOf(['2026-06-11', '2026-06-12']);
    mockSession.data = session('NO_SOLUTION', TONIGHT_REQUEST);
    renderPage();

    fireEvent.press(screen.getByTestId(NEXT_DAY_TESTID));

    expect(mockStartMutate).toHaveBeenCalledTimes(1);
    const [vars] = mockStartMutate.mock.calls[0];
    expect(vars).toEqual({
      tripId: TRIP_ID,
      data: {
        scope: 'FULL_DAY',
        targetDate: '2026-06-12',
        originKind: null,
        reasons: ['WEATHER'],
        directives: ['INDOOR'],
        freeText: '비가 와요',
        excludedPoiIds: [],
        triggerId: null,
      },
    });
    // 성공 전에는 이동하지 않는다.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('N3 시작에 성공하면 새 세션의 "다시 짜는 중"으로 replace 한다(i04 와 같은 착지)', () => {
    jest.useFakeTimers({ now: TONIGHT });
    mockItinerary = itineraryOf(['2026-06-11', '2026-06-12']);
    mockSession.data = session('NO_SOLUTION', TONIGHT_REQUEST);
    renderPage();

    fireEvent.press(screen.getByTestId(NEXT_DAY_TESTID));
    const [, callbacks] = mockStartMutate.mock.calls[0];
    act(() => {
      callbacks.onSuccess({ sessionId: 's10' });
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenLastCalledWith({
      pathname: '/trips/[tripId]/planb/solving',
      params: { tripId: TRIP_ID, sessionId: 's10' },
    });
  });

  it('N4 "오늘·내일"은 기기 시간대가 아니라 KST 날짜다(UTC 6/11 15:30 = KST 6/12 00:30 → 내일은 6/13)', () => {
    jest.useFakeTimers({ now: new Date('2026-06-11T15:30:00Z') });
    mockItinerary = itineraryOf(['2026-06-11', '2026-06-12', '2026-06-13']);
    mockSession.data = session('NO_SOLUTION', {
      ...TONIGHT_REQUEST,
      targetDate: '2026-06-12',
    });
    renderPage();

    fireEvent.press(screen.getByTestId(NEXT_DAY_TESTID));

    expect(mockStartMutate.mock.calls[0][0].data.targetDate).toBe('2026-06-13');
  });

  it.each([
    [
      '마지막 날(내일이 일정에 없다)',
      'NO_SOLUTION',
      TONIGHT_REQUEST.targetDate,
      ['2026-06-10', '2026-06-11'],
    ],
    [
      '오늘이 아닌 날을 다시 짜던 세션',
      'NO_SOLUTION',
      '2026-06-12',
      ['2026-06-11', '2026-06-12', '2026-06-13'],
    ],
    [
      '대안 없음이 아니라 실패(FAILED)',
      'FAILED',
      TONIGHT_REQUEST.targetDate,
      ['2026-06-11', '2026-06-12'],
    ],
    ['일정이 아직 안 왔다', 'NO_SOLUTION', TONIGHT_REQUEST.targetDate, null],
  ])(
    'N5 %s 이면 버튼이 없다(안내는 그대로 뜬다)',
    (_label, status, targetDate, dates) => {
      jest.useFakeTimers({ now: TONIGHT });
      mockItinerary = dates === null ? undefined : itineraryOf(dates);
      mockSession.data = session(status, { ...TONIGHT_REQUEST, targetDate });
      renderPage();

      // 앵커 — 화면은 그려졌다(빈 렌더라서 버튼이 없는 게 아니다).
      expect(screen.getByTestId('planb-draft-notice-title')).toBeOnTheScreen();
      expect(screen.queryByTestId(NEXT_DAY_TESTID)).toBeNull();
    }
  );

  it('N6 시작 요청 중에는 버튼이 잠겨 눌러도 다시 요청하지 않는다(이중 POST 차단)', () => {
    jest.useFakeTimers({ now: TONIGHT });
    mockStart.isPending = true;
    mockItinerary = itineraryOf(['2026-06-11', '2026-06-12']);
    mockSession.data = session('NO_SOLUTION', TONIGHT_REQUEST);
    renderPage();

    const button = screen.getByTestId(NEXT_DAY_TESTID);
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(mockStartMutate).not.toHaveBeenCalled();
  });

  it('N6b 시작 요청 중에는 [직접 수정]·[조건 바꿔 다시 짜기]도 잠긴다(교차 잠금 — 밑에 남은 이 화면의 onSuccess 가 새로 쌓인 화면을 solving 으로 갈아 끼우는 경로 차단, P4b 와 같은 이유)', () => {
    jest.useFakeTimers({ now: TONIGHT });
    mockStart.isPending = true;
    mockItinerary = itineraryOf(['2026-06-11', '2026-06-12']);
    mockSession.data = session('NO_SOLUTION', TONIGHT_REQUEST);
    renderPage();

    const manual = screen.getByTestId('sheet-cta-button-0');
    const reopen = screen.getByTestId('sheet-cta-button-1');
    expect(manual).toHaveTextContent('직접 수정');
    expect(reopen).toHaveTextContent('조건 바꿔 다시 짜기');
    expect(manual).toBeDisabled();
    expect(reopen).toBeDisabled();
    fireEvent.press(manual);
    fireEvent.press(reopen);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('N7 시작에 실패하면 같은 안내 자리에 실패 문구를 띄우고(INV-4), 버튼은 남아 재시도다', () => {
    jest.useFakeTimers({ now: TONIGHT });
    mockStart.isError = true;
    mockItinerary = itineraryOf(['2026-06-11', '2026-06-12']);
    mockSession.data = session('NO_SOLUTION', TONIGHT_REQUEST);
    renderPage();

    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '내일 일정을 다시 짜지 못했어요. 잠시 후 다시 시도해 주세요'
    );
    fireEvent.press(screen.getByTestId(NEXT_DAY_TESTID));
    expect(mockStartMutate).toHaveBeenCalledTimes(1);
  });
});

// TRIP-1233 · i13 — 편집기는 날짜가 없으면 1일차로 연다. 오늘이 아닌 날을 다시 짜던 세션에서 [직접 수정]을
// 누르면 그 날로 열려야 한다. 대안 없음·실패 얼굴엔 초안(diff)이 없으므로 초안 날짜가 아니라 세션에서 읽는다.
describe('🔴 TRIP-1233 · [직접 수정]은 세션이 다시 짜던 날로 편집기를 연다', () => {
  it('M1 대안 없음 세션의 targetDate 가 6/10 이면 [직접 수정] push params.date 가 6/10 이다', () => {
    mockSession.data = session('NO_SOLUTION', { targetDate: '2026-06-10' });
    renderPage();

    fireEvent.press(screen.getByText('직접 수정'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/manual',
      params: { tripId: TRIP_ID, date: '2026-06-10' },
    });
  });

  it('M2 초안 얼굴에서도 [직접 수정]이 그 날 날짜를 싣는다', () => {
    renderDraft();

    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(MANUAL_HREF);
  });
});

describe('🔴 P7 · AC-10 · E3 — FAILED 도 같은 뷰에 착지한다(옛 variant=error push 반전)', () => {
  it('안내 "다시 짜지 못했어요", 렌더만으로 push·세션 시작 0, [다시 시도]는 화면을 옮기지 않고 다시 짠다 · [직접 수정]→manual(variant 없음)', () => {
    mockSession.data = session('FAILED');
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '다시 짜지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('잠시 후 다시 시도하거나 직접 고쳐 주세요');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
    // 5-b 차단-1 — 실패 얼굴에서도 초안 조회는 꺼져 있고 초안 행이 없다.
    expectDiffNeverEnabled();
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);

    fireEvent.press(screen.getByText('다시 시도'));
    expect(mockStartMutate).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('직접 수정'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenLastCalledWith(MANUAL_HREF);
  });
});

/**
 * 사용자 결정(2026-10-20) — 실패(FAILED) [다시 시도]는 알림과 끊긴 빈 요청 화면을 열지 않고, 같은 입력·같은 알림으로 바로
 * 다시 짠다(낡음 얼굴 [새 대안 보기]와 같은 봉투). 화면 구성은 그대로다 — 요청 중엔 버튼 잠금, 실패면 부제가 시작 실패 문장.
 */
describe('🔴 실패 [다시 시도] — 같은 입력·같은 알림으로 바로 다시 짠다 (사용자 결정)', () => {
  const FAILED_INPUTS = {
    targetDate: '2999-01-02',
    scope: 'FULL_DAY',
    triggerId: 'trg-1',
    reasons: ['WEATHER'],
    directives: ['AVOID_OUTDOOR'],
    excludedPoiIds: ['poi-out'],
    freeText: '실내로 바꿔 줘',
  };

  it('K1 사유·지시·제외·자유 입력·날짜와 그 트리거로 세션을 열고, 성공하면 새 세션의 i05 로 replace — i04 push 0', () => {
    mockSession.data = session('FAILED', FAILED_INPUTS);
    renderPage();

    fireEvent.press(screen.getByText('다시 시도'));

    expect(mockStartMutate).toHaveBeenCalledTimes(1);
    const [variables, options] = mockStartMutate.mock.calls[0] as [
      { tripId: string; data: unknown },
      { onSuccess: (next: { sessionId: string }) => void },
    ];
    expect(variables).toEqual({
      tripId: TRIP_ID,
      data: {
        scope: 'FULL_DAY',
        targetDate: '2999-01-02',
        originKind: null,
        reasons: ['WEATHER'],
        directives: ['AVOID_OUTDOOR'],
        freeText: '실내로 바꿔 줘',
        excludedPoiIds: ['poi-out'],
        triggerId: 'trg-1',
      },
    });
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => options.onSuccess({ sessionId: 's10' }));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/solving',
      params: { tripId: TRIP_ID, sessionId: 's10' },
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('K2 같은 틱에 두 번 눌러도 세션 시작은 1회다', () => {
    mockSession.data = session('FAILED', FAILED_INPUTS);
    renderPage();
    const retry = screen.getByText('다시 시도');

    fireEvent.press(retry);
    fireEvent.press(retry);

    expect(mockStartMutate).toHaveBeenCalledTimes(1);
  });

  it('K3 요청 중엔 [다시 시도]·[직접 수정]이 잠기고, 실패하면 같은 안내 자리의 부제가 시작 실패 문장이 된다', () => {
    mockSession.data = session('FAILED', FAILED_INPUTS);
    // 다시 그릴 때마다 새 엘리먼트 — 같은 엘리먼트를 다시 넘기면 React 가 그리기를 건너뛴다.
    const page = () => (
      <PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />
    );
    const { rerender } = render(page());
    fireEvent.press(screen.getByText('다시 시도'));
    const [, options] = mockStartMutate.mock.calls[0] as [
      unknown,
      { onError: (error: unknown) => void },
    ];

    mockStart.isPending = true;
    rerender(page());
    const manual = screen.getByTestId('sheet-cta-button-0');
    const retry = screen.getByTestId('sheet-cta-button-1');
    expect(manual).toHaveTextContent('직접 수정');
    expect(retry).toHaveTextContent('다시 시도');
    expect(manual).toBeDisabled();
    expect(retry).toBeDisabled();

    mockStart.isPending = false;
    mockStart.isError = true;
    act(() => options.onError(new Error('500')));
    rerender(page());

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '다시 짜지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toBeEnabled();
  });

  it('K4 재요청이 실패하면 잠금이 풀려 다시 누를 수 있다', () => {
    mockSession.data = session('FAILED', FAILED_INPUTS);
    renderPage();

    fireEvent.press(screen.getByText('다시 시도'));
    const [, options] = mockStartMutate.mock.calls[0] as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    act(() => options.onError(new Error('500')));
    fireEvent.press(screen.getByText('다시 시도'));

    expect(mockStartMutate).toHaveBeenCalledTimes(2);
  });

  it('K5 넣으려던 POI 는 새 세션의 i05 까지 잇는다(서버엔 안 보낸다)', () => {
    mockSession.data = session('FAILED', FAILED_INPUTS);
    render(
      <PlanbDraftPage
        tripId={TRIP_ID}
        sessionId={SESSION_ID}
        includePoiId="poi-sky"
      />
    );

    fireEvent.press(screen.getByText('다시 시도'));
    const [variables, options] = mockStartMutate.mock.calls[0] as [
      { data: unknown },
      { onSuccess: (next: { sessionId: string }) => void },
    ];
    expect(JSON.stringify(variables.data)).not.toContain('poi-sky');
    act(() => options.onSuccess({ sessionId: 's10' }));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/solving',
      params: { tripId: TRIP_ID, sessionId: 's10', includePoiId: 'poi-sky' },
    });
  });
});

/**
 * 지난 날 세션(날짜 < 오늘 KST)의 실패 [다시 시도]는 같은 날짜로 다시 열어 서버가 늘 409(지난 날짜는 다시 짤 수 없다)다.
 * 그때 "잠시 후 다시 시도해 주세요"는 사실과 다르다 — 종전 i04 경로가 같은 409 에 보이던 날짜 안내로 가른다.
 * 버튼·얼굴 구성은 그대로다. 오늘 세션의 409(경합)·지난 날의 5xx 는 종전 시작 실패 문장이다.
 * 닿는 길: 실패 얼굴을 자정 넘겨 열어 둔 채 [다시 시도].
 */
describe('🔴 지난 날 세션의 실패 [다시 시도] — 409 면 i04 와 같은 날짜 안내 (다시 눌러도 같은 거절)', () => {
  // KST 2026-06-12 10:00 — 세션 날짜 06-11 은 어제다.
  const NEXT_MORNING = new Date('2026-06-12T01:00:00Z');
  // 서버가 실제로 내는 모양(ErrorResponse 봉투 · ReplanSessionService) — 둘 다 일반 CONFLICT 다(코드로는 못 가른다).
  const conflict409 = (message: string) => ({
    isAxiosError: true,
    response: { status: 409, data: { error: { code: 'CONFLICT', message } } },
  });
  const PAST_DAY_409 = conflict409('지난 날짜는 다시 짤 수 없습니다.');
  const RACE_409 = conflict409(
    '다른 재계획이 막 시작됐어요. 다시 시도해 주세요.'
  );
  const page = () => <PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />;

  afterEach(() => {
    jest.useRealTimers();
  });

  /** 실패 세션에서 [다시 시도] → 서버가 `error` 로 거절 → 다시 그린다. */
  function retryRejectedWith(targetDate: string, error: unknown): void {
    jest.useFakeTimers({ now: NEXT_MORNING });
    mockSession.data = session('FAILED', { targetDate, scope: 'FULL_DAY' });
    const { rerender } = render(page());
    fireEvent.press(screen.getByText('다시 시도'));
    const [, options] = mockStartMutate.mock.calls[0] as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    mockStart.isError = true;
    mockStart.error = error;
    act(() => options.onError(error));
    rerender(page());
  }

  it('K6 어제 세션이 409 면 부제가 i04 날짜 안내다 — "잠시 후 다시 시도" 없음 · 버튼 둘은 그대로', () => {
    retryRejectedWith('2026-06-11', PAST_DAY_409);

    // 앵커 — 그 날짜 그대로 다시 열었다(오늘로 바꿔 보내지 않는다, INV-4). 서버가 지난 날로 거절하는 요청이다.
    const [variables] = mockStartMutate.mock.calls[0] as [
      { data: { targetDate?: string } },
    ];
    expect(variables.data.targetDate).toBe('2026-06-11');
    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '다시 짜지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '아직 일정이 없는 날이거나 여행 기간이 아니라서 AI가 다시 짤 수 없어요'
    );
    expect(screen.queryByText(/잠시 후 다시 시도/)).toBeNull();
    // 얼굴 구성은 그대로 — [직접 수정]·[다시 시도] 두 버튼, 새 버튼·이동 없음.
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '다시 시도'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toBeEnabled();
    expect(screen.queryByTestId('sheet-cta-button-2')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each([
    ['오늘 세션의 409(경합)', '2026-06-12', RACE_409],
    [
      '어제 세션의 500',
      '2026-06-11',
      { isAxiosError: true, response: { status: 500, data: {} } },
    ],
  ])(
    'K7 %s → 종전 시작 실패 문장이다 — 날짜 탓으로 돌리지 않는다',
    (_name, targetDate, error) => {
      retryRejectedWith(targetDate, error);

      expect(
        screen.getByTestId('planb-draft-notice-description')
      ).toHaveTextContent(
        '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요'
      );
      expect(screen.queryByText(/아직 일정이 없는 날/)).toBeNull();
    }
  );
});

// TRIP-1289 — 옛 P8 은 APPLIED·CANCELED 도 "렌더 없음"으로 굳혀 두었다(실기 빈 화면의 원인, 01b). 두 행을 빼고
// 종료 얼굴 케이스(맨 아래 TRIP-1289 블록)로 옮겼다. SOLVING·미도착 null 은 이 칸 범위 밖이라 그대로 둔다.
describe('🔴 P8 · AC-10 — SOLVING·미도착은 아무것도 그리지 않는다', () => {
  it.each([['SOLVING']])('%s 이면 렌더 없음 + 라우터·확정 호출 0', (status) => {
    mockSession.data = session(status);
    renderPage();

    expect(screen.toJSON()).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expectDiffNeverEnabled();
  });

  it('세션 미도착(data undefined)이면 렌더 없음 + 라우터 호출 0', () => {
    renderPage();

    expect(screen.toJSON()).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expectDiffNeverEnabled();
  });
});

// TRIP-1277 — 옛 P9("지도 위 ‹ 는 router.back 1회")는 확인 없이 바로 나가는 동작을 굳혀 두었다(결정2 와 충돌).
// 지우지 않고 "확인 → [나가기] 뒤에 나감 1회"로 바꿨다. 나감은 `mockExits` 로 센다 — ‹ 가 back 을 부르든
// 가로채기를 거쳐 받은 액션을 다시 보내든 실제로 화면을 빠져나간 횟수만 본다(02a ★1).
const DRAFT_LEAVE = 'planb-draft-leave-confirm';

describe('🔴 P9 · Q8 · TRIP-1277 AC3·AC4 — 지도 위 뒤로가기는 확인 → [나가기] 뒤에만 나간다', () => {
  it('‹ 를 눌러도 바로 나가지 않고, [나가기]를 눌러야 1회 나간다 — 확정·세션 시작·push·replace 0', () => {
    renderDraft();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    expect(mockExits).toEqual([]);

    fireEvent.press(screen.getByTestId(`${DRAFT_LEAVE}-leave`));

    expect(mockExits).toHaveLength(1);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// ── TRIP-979 B · AC-B4 — 세션 좌표가 없으면 지도 중심을 이 여행에서 고른다(부산 상수 제거) ──────────

const seoulSlot = (
  poiId: string,
  nameKo: string,
  coords: { lat: number; lng: number } | null
) => ({
  poiId,
  nameKo,
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  tags: [],
  lat: coords?.lat ?? null,
  lng: coords?.lng ?? null,
});

// fromInstant '2026-06-11T06:00:00Z' = KST 6/11 15시. 그날 첫 슬롯은 좌표가 없고 그 뒤가 경복궁,
// 일정 전체 첫 좌표는 남산(6/10).
const SEOUL_ITINERARY = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'CONFIRMED',
  solveMode: 'FULL',
  generationMode: 'AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-10',
      slots: [seoulSlot('s0', '남산서울타워', { lat: 37.5512, lng: 126.9882 })],
    },
    {
      date: '2026-06-11',
      slots: [
        seoulSlot('s1', '좌표 없는 곳', null),
        seoulSlot('s2', '경복궁', { lat: 37.5796, lng: 126.977 }),
      ],
    },
  ],
} as unknown as Itinerary;

const NO_ORIGIN = {
  originKind: 'STAY_ANCHOR',
  originLat: null,
  originLng: null,
  originEstimated: true,
};

describe('🔴 B4 · AC-B4 · Q5 — 출발 좌표 없는 세션의 지도 중심은 여행에서 유도한다', () => {
  it.each([['DRAFT'], ['NO_SOLUTION'], ['FAILED']])(
    '%s — fromInstant 날(KST 6/11)의 첫 좌표 슬롯(좌표 없는 앞 슬롯은 건너뜀)',
    (status) => {
      mockItinerary = SEOUL_ITINERARY;
      mockSession.data = session(status, NO_ORIGIN);
      renderPage();

      expect(screen.getByTestId('map-root')).toHaveTextContent(
        '37.5796,126.977'
      );
    }
  );

  // '그날이 일정에 없으면 일정 전체 첫 좌표' · '일정 전혀 없으면 서울시청' 은 같은 `deriveReplanMapAnchor` 를 타는
  // PlanbSolvingPage B4 가 정본이다(TRIP-1354 — 소스 두 줄 뒤집어 확인). 여기엔 이 화면 고유 배선(세션 날짜·출발 좌표)만 남긴다.

  it('세션 좌표가 있으면 일정보다 세션 좌표가 먼저다(무회귀)', () => {
    mockItinerary = SEOUL_ITINERARY;
    mockSession.data = session('DRAFT', {
      originLat: 37.4979,
      originLng: 127.0276,
    });
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent(
      '37.4979,127.0276'
    );
  });
});

// ── TRIP-1277 · 결정2 — 초안 얼굴에서 나갈 땐 "적용 안 하고 나간다"를 한 번 확인받는다 ──────────────────
// 근거: 01 브리프 AC3·4·5·6·9·10·11·12, 01b Q7~Q13. 다이얼로그 문구는 Seed Q8 확정값(02a §3).

const DRAFT_ERROR = 'planb-draft-error';
const DRAFT_RETRY = 'planb-draft-retry';
const LEAVE_TITLE = '재계획안을 적용하지 않고 나갈까요?';
const LEAVE_BODY =
  '나가면 이 재계획안은 다시 볼 수 없어요. 원래 일정은 그대로예요';

/** 스와이프·Android 하드웨어 뒤로처럼 네비게이터 쪽에서 "이 화면을 빼려는" 액션을 보낸다(가짜 네비게이터). */
function attemptRemove(action: MockNavAction): void {
  act(() => mockRemove(action, 'gesture'));
}

/** 같은 틱 연타 — 두 누름 사이에 다시 그리기가 없다(state 잠금은 2회, ref 잠금만 1회 — 02a §5 실측). */
function pressTwiceSameTick(testID: string): void {
  const target = screen.getByTestId(testID);
  act(() => {
    fireEvent.press(target);
    fireEvent.press(target);
  });
}

describe('🔴 TRIP-1277 AC3 · Q7·Q8 — ‹ 는 이탈 확인을 띄우고 아무 데도 가지 않는다', () => {
  it('L1 누르기 전엔 없고, 누르면 확인(제목·본문·[계속 보기]·[나가기])이 뜬다 — 나감·확정 0, i05 문구 아님', () => {
    renderDraft();
    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    const dialog = screen.getByTestId(DRAFT_LEAVE);
    expect(within(dialog).getByText(LEAVE_TITLE)).toBeOnTheScreen();
    expect(within(dialog).getByText(LEAVE_BODY)).toBeOnTheScreen();
    expect(screen.getByTestId(`${DRAFT_LEAVE}-stay`)).toHaveTextContent(
      '계속 보기'
    );
    expect(screen.getByTestId(`${DRAFT_LEAVE}-leave`)).toHaveTextContent(
      '나가기'
    );
    // 기본값(i05 짜는 중 문구·testID)이 새지 않았다.
    expect(screen.queryByTestId('planb-solving-leave-confirm')).toBeNull();
    expect(screen.queryByText('계속 기다리기')).toBeNull();
    expect(mockExits).toEqual([]);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });

  it('L2 [계속 보기]는 확인만 닫는다 — 초안 행은 그대로, 나감·확정·이동 0', () => {
    renderDraft();
    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    fireEvent.press(screen.getByTestId(`${DRAFT_LEAVE}-stay`));

    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
    expect(screen.queryAllByTestId(SLOT_NAMES)).toHaveLength(4);
    expect(mockExits).toEqual([]);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1277 AC9 · Q9 — 스와이프·하드웨어 뒤로도 같은 확인을 거친다', () => {
  it.each([['GO_BACK'], ['POP']])(
    'L3 %s 액션이 오면 확인이 뜨고 화면은 그대로다 — [나가기]를 눌러야 1회 나간다',
    (type) => {
      renderDraft();

      attemptRemove({ type });

      expect(screen.getByTestId(DRAFT_LEAVE)).toBeOnTheScreen();
      expect(mockExits).toEqual([]);

      fireEvent.press(screen.getByTestId(`${DRAFT_LEAVE}-leave`));

      expect(mockExits).toHaveLength(1);
      expect(mockMutate).not.toHaveBeenCalled();
    }
  );

  // TRIP-1418 — 적용 성공의 허브 복귀가 replace 에서 dismissTo(POP_TO)로 바뀌어 목록에 POP_TO 를 더했다.
  it.each([['POP_TO'], ['REPLACE'], ['NAVIGATE'], ['PUSH']])(
    'L4 %s 액션(적용 성공의 허브 dismissTo·내일 재계획의 solving replace·직접 수정 push)은 확인 없이 받은 그 객체로 통과한다',
    (type) => {
      renderDraft();
      // 앵커 — 이 얼굴은 가로채기가 켜져 있다(뒤로는 확인으로 붙잡힌다). 이게 없으면 아래 통과가 공허하다.
      attemptRemove({ type: 'GO_BACK' });
      expect(screen.getByTestId(DRAFT_LEAVE)).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId(`${DRAFT_LEAVE}-stay`));
      const action = { type, payload: { name: 'next' } };

      attemptRemove(action);

      expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
      expect(mockExits).toHaveLength(1);
      // 다시 보낼 땐 새로 만들지 않고 받은 객체 그대로(새 객체면 가짜가 다시 물어 무한 반복 — 실물과 같다).
      for (const [sent] of mockNavigation.dispatch.mock.calls) {
        expect(sent).toBe(action);
      }
    }
  );
});

describe('🔴 TRIP-1277 AC10 · Q11 — 잃을 초안이 없는 얼굴은 확인 없이 바로 뒤로', () => {
  it.each([['NO_SOLUTION'], ['FAILED']])(
    'L5 %s 에서 ‹ 는 확인 없이 1회 나간다',
    (status) => {
      mockSession.data = session(status);
      renderPage();

      fireEvent.press(screen.getByTestId('sheet-daychip-back'));

      expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
      expect(mockExits).toHaveLength(1);
    }
  );

  it.each([['NO_SOLUTION'], ['FAILED']])(
    'L6 %s 에서 스와이프 뒤로도 확인 없이 1회 나간다',
    (status) => {
      mockSession.data = session(status);
      renderPage();

      attemptRemove({ type: 'GO_BACK' });

      expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
      expect(mockExits).toHaveLength(1);
    }
  );
});

describe('🔴 TRIP-1277 AC11 — 요청 대기 중엔 확인도 이동도 없다(교차 잠금 · 대기 중 언마운트 차단)', () => {
  it('L7 [적용하기] 대기 중 ‹ — 확인 0 · 나감 0', () => {
    mockApply.isPending = true;
    renderDraft();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
    expect(mockExits).toEqual([]);
  });

  it('L8 [적용하기] 대기 중 스와이프 뒤로 — 가로채서 삼킨다(확인 0 · 나감 0)', () => {
    mockApply.isPending = true;
    renderDraft();

    attemptRemove({ type: 'GO_BACK' });

    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
    expect(mockExits).toEqual([]);
  });

  it('L9 [적용하기] 대기 중에도 REPLACE(적용 성공의 허브 이동)는 막지 않는다 — 받은 객체로 1회 통과', () => {
    mockApply.isPending = true;
    renderDraft();
    // 앵커 — 같은 상태에서 뒤로는 삼켜진다(L8). 가로채기를 아예 끈 구현이면 여기서 나감 1 이 먼저 생긴다.
    attemptRemove({ type: 'GO_BACK' });
    expect(mockExits).toEqual([]);
    const action = { type: 'REPLACE', payload: { name: 'live' } };

    attemptRemove(action);

    expect(mockExits).toHaveLength(1);
    for (const [sent] of mockNavigation.dispatch.mock.calls) {
      expect(sent).toBe(action);
    }
  });

  // TRIP-1418 AC-3 — 적용 성공의 허브 복귀는 이제 dismissTo(POP_TO)다. 대기 중에도 뒤로(GO_BACK·POP)만 삼킨다.
  it('L9b [적용하기] 대기 중에도 POP_TO(적용 성공의 허브 복귀)는 막지 않는다 — 받은 객체로 1회 통과', () => {
    mockApply.isPending = true;
    renderDraft();
    // 앵커 — 같은 상태에서 뒤로는 삼켜진다(L8).
    attemptRemove({ type: 'GO_BACK' });
    expect(mockExits).toEqual([]);
    const action = { type: 'POP_TO', payload: { name: 'live' } };

    attemptRemove(action);

    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
    expect(mockExits).toHaveLength(1);
    for (const [sent] of mockNavigation.dispatch.mock.calls) {
      expect(sent).toBe(action);
    }
  });

  it('L10 [내일 일정 다시 짜기] 대기 중(대안 없음) ‹·스와이프 뒤로 — 나감 0', () => {
    mockStart.isPending = true;
    mockSession.data = session('NO_SOLUTION');
    renderPage();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    attemptRemove({ type: 'POP' });

    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
    expect(mockExits).toEqual([]);
  });
});

describe('🔴 TRIP-1348 · INV-4 — 짜는 중(SOLVING) data 가 남은 채 조회가 실패로 서면 오류 얼굴이다', () => {
  it('L11b SOLVING data + isError → 오류 얼굴 · [다시 시도]=재조회 1회 — 확정·세션 시작 0', () => {
    mockSession.data = session('SOLVING');
    mockSession.error = true;
    renderPage();

    expect(screen.getByTestId(DRAFT_ERROR)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(DRAFT_RETRY));

    expect(mockSessionRefetch).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1277 AC12 · Q12 — data 없이 세션 조회가 실패하면 오류 얼굴(재시도 = 재조회)', () => {
  it('L11 오류 얼굴과 [다시 시도]가 보이고, 누르면 refetch 1회 — 확정·세션 시작·이동 0', () => {
    mockSession.error = true;
    renderPage();

    expect(screen.getByTestId(DRAFT_ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(DRAFT_RETRY)).toHaveTextContent('다시 시도');
    expect(mockSessionRefetch).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(DRAFT_RETRY));

    expect(mockSessionRefetch).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockExits).toEqual([]);
  });
});

describe('🔴 TRIP-1277 AC6 · Q13 — 이번에 만든 버튼은 연타해도 한 번만', () => {
  it('L12 확인의 [나가기] 같은 틱 2연타 — 나감 정확히 1회', () => {
    renderDraft();
    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    pressTwiceSameTick(`${DRAFT_LEAVE}-leave`);

    expect(mockExits).toHaveLength(1);
  });

  it('L13 오류 얼굴 [다시 시도] 같은 틱 2연타 — 확정·세션 시작(POST) 0', () => {
    mockSession.error = true;
    renderPage();

    pressTwiceSameTick(DRAFT_RETRY);

    expect(mockSessionRefetch).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });
});

// ── TRIP-1277 5-b 차단 수정 루프 — 03b B-1·W-1·W-2 의 심판 공백을 메운다 ─────────────────────────
// 근거: 01 브리프 AC4·AC6·AC12 · INV-4. 모양은 solving 의 E3·E4·R2 를 옮겼다(02a ★14~16).

const DRAFT_ERROR_LEAVE = 'planb-draft-error-leave';
const HUB_HREF = `/trips/${TRIP_ID}/live`;

describe('🔴 TRIP-1277 5-b 차단-1 · AC6·AC12 — 초안 오류 얼굴 [나가기]는 서버 호출 없이 한 번 나간다', () => {
  it('L16 [나가기]가 보이고, 누르면 뒤로 1회 — replace·push·확정·세션 시작·재조회 0', () => {
    mockSession.error = true;
    renderPage();
    expect(screen.getByTestId(DRAFT_ERROR_LEAVE)).toHaveTextContent('나가기');

    fireEvent.press(screen.getByTestId(DRAFT_ERROR_LEAVE));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockExits).toEqual(['back']);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
    expect(mockSessionRefetch).not.toHaveBeenCalled();
  });

  it('L17 뒤로 갈 곳이 없으면(딥링크 착지) 허브로 replace 1회 — back·확정·세션 시작 0', () => {
    mockCanGoBack = false;
    mockSession.error = true;
    renderPage();

    fireEvent.press(screen.getByTestId(DRAFT_ERROR_LEAVE));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(HUB_HREF);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });

  // L18(오류 얼굴) + TRIP-1289 C4(종료 얼굴) — 같은 틱 2연타의 기대값이 같아 한 표로 합쳤다(TRIP-1354).
  it.each([
    [
      'L18 오류 얼굴',
      () => {
        mockSession.error = true;
      },
      () => DRAFT_ERROR_LEAVE,
    ],
    [
      'C4 종료 얼굴',
      () => {
        mockSession.data = session('CANCELED');
      },
      () => CLOSED_LEAVE,
    ],
  ])(
    '%s [나가기] 같은 틱 2연타 — 이동 정확히 1회(back 1 · replace 0)',
    (_label, arrange, leaveId) => {
      arrange();
      renderPage();

      pressTwiceSameTick(leaveId());

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    }
  );
});

describe('🔴 TRIP-1277 5-b 경고-1 · AC12 — 초안을 이미 받았으면 재조회가 실패해도 오류 얼굴로 덮지 않는다', () => {
  it('L19 DRAFT data + isError 면 오류 얼굴 0 · 초안 행 4 · [적용하기] 그대로 — 재조회·이동 0', () => {
    mockSession.error = true;
    renderDraft();

    expect(screen.queryByTestId(DRAFT_ERROR)).toBeNull();
    expect(screen.queryAllByTestId(SLOT_NAMES)).toHaveLength(4);
    expect(screen.getByText('적용하기')).toBeOnTheScreen();
    expect(mockSessionRefetch).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockExits).toEqual([]);
  });
});

describe('🔴 TRIP-1277 5-b 경고-2 · AC4 · INV-4 — 이탈 확인 [나가기]도 뒤로 갈 곳이 없으면 허브로', () => {
  it('L20 딥링크 착지(canGoBack false)에서 ‹ → [나가기] — 허브로 replace 1회 · back·확정·세션 시작 0', () => {
    mockCanGoBack = false;
    renderDraft();
    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    expect(screen.getByTestId(DRAFT_LEAVE)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(`${DRAFT_LEAVE}-leave`));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(HUB_HREF);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });
});

// ── TRIP-1289 · INV-4 — 끝난 세션(APPLIED·CANCELED)은 빈 화면 대신 종료 얼굴 ─────────────────────────
// 근거: 01 브리프 AC1~AC5 · 01b(INV-U4-05·06). 문구는 진행 화면 종료 얼굴(solving K1)과 같은 값, testID 만
// 이 화면 것(결정 A). 기존 케이스는 P8 만 바꿨다 — AC6 무회귀는 이 파일 나머지가 맡는다.

const CLOSED_FACE = 'planb-draft-closed';
const CLOSED_LEAVE = 'planb-draft-closed-leave';

describe('🔴 TRIP-1289 AC1·AC2 — 끝난 세션은 "이미 끝난 재계획이에요" 얼굴과 [나가기]', () => {
  it.each([['CANCELED'], ['APPLIED']])(
    'C1 %s 면 종료 얼굴(제목·부제·채운 [나가기])이 보이고 "원래 일정은 그대로"는 없다 — 그리기만으로 이동·확정·세션 시작·초안 조회 0',
    (status) => {
      mockSession.data = session(status);
      renderPage();

      const face = screen.getByTestId(CLOSED_FACE);
      expect(
        within(face).getByText('이미 끝난 재계획이에요')
      ).toBeOnTheScreen();
      expect(
        within(face).getByText('나가서 지금 일정을 확인해 주세요')
      ).toBeOnTheScreen();
      const leave = screen.getByTestId(CLOSED_LEAVE);
      expect(leave).toHaveTextContent('나가기');
      expect(String(leave.props.className).split(/\s+/)).toContain(
        'bg-primary'
      );
      // 적용된 세션일 수 있어 "원래 일정은 그대로"라고 말하지 않는다(오류 얼굴 문구가 새지 않았다).
      expect(screen.queryByText(/원래 일정은 그대로/)).toBeNull();
      // 진행 화면의 testID·초안 오류 얼굴이 아니다(결정 A — 어느 화면인지 testID 로 가른다).
      expect(screen.queryByTestId('planb-solving-closed')).toBeNull();
      expect(screen.queryByTestId(DRAFT_ERROR)).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockMutate).not.toHaveBeenCalled();
      expect(mockStartMutate).not.toHaveBeenCalled();
      expectDiffNeverEnabled();
    }
  );
});

describe('🔴 TRIP-1289 AC3 · INV-U4-05 — 종료 얼굴 [나가기]는 서버 호출 없이 나간다', () => {
  it('C2 뒤로 갈 곳이 있으면 뒤로 1회 — replace·push·확정·세션 시작·재조회 0', () => {
    mockSession.data = session('CANCELED');
    renderPage();

    fireEvent.press(screen.getByTestId(CLOSED_LEAVE));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockExits).toEqual(['back']);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
    expect(mockSessionRefetch).not.toHaveBeenCalled();
  });

  it('C3 뒤로 갈 곳이 없으면(딥링크 착지) 허브로 replace 1회 — back·확정·세션 시작 0', () => {
    mockCanGoBack = false;
    mockSession.data = session('APPLIED');
    renderPage();

    fireEvent.press(screen.getByTestId(CLOSED_LEAVE));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(HUB_HREF);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1289 AC5 — 종료 얼굴은 잃을 초안이 없어 뒤로가 확인 없이 나간다', () => {
  it.each([['GO_BACK'], ['POP']])(
    'C5 종료 얼굴에서 %s 액션이 오면 이탈 확인 없이 1회 나간다',
    (type) => {
      mockSession.data = session('CANCELED');
      renderPage();
      // 앵커 — 종료 얼굴이 실제로 떠 있다(빈 화면에서의 "확인 없음"은 공허하다).
      expect(screen.getByTestId(CLOSED_FACE)).toBeOnTheScreen();

      attemptRemove({ type });

      expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
      expect(mockExits).toEqual(['gesture']);
      expect(mockMutate).not.toHaveBeenCalled();
    }
  );
});

// ── TRIP-1293 · INV-4 — 초안 화면 오류 얼굴 [다시 시도]도 재조회 중 잠기고, 실패로 끝나면 풀린다 ─────────────
// 근거: 01 브리프 AC2·AC3·AC5·AC6. 재조회 중 모양은 TanStack 실물(데이터 없으면 isError 가 풀리고 pending 복귀)이다
// — 지금 페이지는 그 순간 아무것도 안 그린다(P8 의 "미도착 = 렌더 없음" 갈래로 빠진다, 02a ★1).

function renderDraftError() {
  mockSession.error = true;
  mockSession.failures = 1;
  return render(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

/** [다시 시도]를 누르고, TanStack 이 내놓는 "실패 뒤 재조회 중"(pending · isFetching · 실패 이력 1↑)으로 다시 그린다. */
function pressDraftRetryThenRefetching(
  rerender: (ui: ReactElement) => void
): void {
  fireEvent.press(screen.getByTestId(DRAFT_RETRY));
  mockSession.error = false;
  rerender(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

describe('🔴 TRIP-1293 AC2·AC3·AC6 — 초안 오류 얼굴 [다시 시도]는 재조회 중 잠기고, 실패로 끝나면 풀린다', () => {
  it('Z1 누르면 재조회 동안에도 오류 얼굴이 남고 [다시 시도]만 잠긴다 — [나가기]는 그대로 눌린다 (AC2)', () => {
    const { rerender } = renderDraftError();
    expect(screen.getByTestId(DRAFT_RETRY)).toBeEnabled();

    pressDraftRetryThenRefetching(rerender);

    expect(screen.getByTestId(DRAFT_ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(DRAFT_RETRY)).toBeDisabled();
    expect(screen.getByTestId(DRAFT_ERROR_LEAVE)).toBeEnabled();
  });

  it('Z2 재조회가 또 실패로 끝나면 [다시 시도]가 다시 눌리고, 누르면 재조회가 한 번 더 나간다 (AC3)', () => {
    const { rerender } = renderDraftError();
    pressDraftRetryThenRefetching(rerender);
    expect(screen.getByTestId(DRAFT_RETRY)).toBeDisabled();

    mockSession.failures = 2;
    mockSession.error = true;
    rerender(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

    expect(screen.getByTestId(DRAFT_ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(DRAFT_RETRY)).toBeEnabled();
    fireEvent.press(screen.getByTestId(DRAFT_RETRY));
    expect(mockSessionRefetch).toHaveBeenCalledTimes(2);
  });

  it('Z3 재조회 중 [다시 시도]를 세 번 더 눌러도 재조회는 처음 1회뿐 — 확정·세션 시작(POST)·이동 0 (AC6)', () => {
    const { rerender } = renderDraftError();
    pressDraftRetryThenRefetching(rerender);

    for (let i = 0; i < 3; i += 1) {
      fireEvent.press(screen.getByTestId(DRAFT_RETRY));
    }

    expect(mockSessionRefetch).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockStartMutate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockExits).toEqual([]);
  });
});

/**
 * 상황 감지 FE-B · frontend-components §3.6 — i06 최소 변경의 배선.
 *
 * 무엇을 보장하나:
 *  - 세션 `initiatedBy = SYSTEM` 이면 `미리 준비한 대안` 표식(USER·필드 없음이면 없다).
 *  - 적용이 409 + `EXPIRED`·`STALE` 이면 낡음 얼굴 — 일반 실패 문구로 접지 않고 [적용하기]를 잠근다. 코드 없는 409·5xx 는 종전 실패.
 *  - [새 대안 보기] = 같은 입력(사유·지시·제외·범위·트리거, 날짜는 오늘이면 생략)으로 세션 시작 → 성공하면 i05 로 replace.
 *    같은 틱 연타도 POST 1회(새 POST 는 방금 연 세션을 닫는다 — INV-U4-06).
 *  - `includePoiId` 가 초안 after 에 없으면 그 장소 이름으로 미포함 안내, 이름 조회가 실패하면 이름 없는 문장. 있으면 안내 없음.
 */
const STALE_409 = (code: string) => ({
  isAxiosError: true,
  response: { status: 409, data: { error: { code, message: '…' } } },
});

function renderStaleDraft(
  code = 'STALE',
  sessionOver: Record<string, unknown> = {}
) {
  mockApply.isError = true;
  mockApply.error = STALE_409(code);
  mockItinerary = DRAFT_ITINERARY;
  mockSession.data = session('DRAFT', {
    initiatedBy: 'SYSTEM',
    triggerId: 'trg-1',
    reasons: ['TEMP_CLOSED'],
    directives: ['AVOID_OUTDOOR'],
    excludedPoiIds: ['poi-closed'],
    freeText: null,
    ...sessionOver,
  });
  mockDiff.data = READY_DIFF;
}

describe('🔴 상황 감지 FE-B · i06 미리 준비한 대안 표식 · 낡음 얼굴 · 미포함 안내 (§3.6)', () => {
  it('F1 SYSTEM 세션이면 "미리 준비한 대안" 표식, USER 면 없다', () => {
    mockItinerary = DRAFT_ITINERARY;
    mockSession.data = session('DRAFT', { initiatedBy: 'SYSTEM' });
    mockDiff.data = READY_DIFF;
    const { rerender } = render(
      <PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />
    );
    expect(screen.getByTestId('planb-draft-prepared')).toHaveTextContent(
      '미리 준비한 대안'
    );

    mockSession.data = session('DRAFT', { initiatedBy: 'USER' });
    rerender(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
    expect(screen.queryByTestId('planb-draft-prepared')).toBeNull();

    // 옛 서버(필드 없음)는 기존 화면 그대로다(§0) — "USER 가 아니면 SYSTEM" 으로 읽지 않는다.
    mockSession.data = session('DRAFT');
    rerender(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
    expect(screen.queryByTestId('planb-draft-prepared')).toBeNull();
    // 짝 앵커 — 초안 얼굴은 그려졌다.
    expect(screen.getByTestId('sheet-cta-button-1')).toBeTruthy();
  });

  it.each(['NO_SOLUTION', 'FAILED'])(
    'F1b SYSTEM 세션이어도 %s 얼굴엔 표식이 없다 — 대안이 없는데 "미리 준비한 대안"이라 말하지 않는다(BR-SA-23 표는 DRAFT 행에만 단다)',
    (status) => {
      mockItinerary = DRAFT_ITINERARY;
      mockSession.data = session(status, { initiatedBy: 'SYSTEM' });
      renderPage();

      expect(screen.queryByTestId('planb-draft-prepared')).toBeNull();
      // 짝 앵커 — 대안 없음·실패 얼굴은 그려졌다.
      expect(screen.getByTestId('planb-draft-notice-title')).toBeTruthy();
    }
  );

  it.each(['EXPIRED', 'STALE'])(
    'F2 적용이 409 %s 면 낡음 얼굴 — 일반 실패 문구 없음 · [적용하기] 잠금',
    (code) => {
      renderStaleDraft(code);
      renderPage();

      expect(screen.getByTestId('planb-draft-stale')).toHaveTextContent(
        /시간이 지나 이 대안은 지금 일정과 맞지 않아요/
      );
      expect(screen.queryByText('변경을 반영하지 못했어요')).toBeNull();
      expect(screen.getByTestId('sheet-cta-button-1')).toBeDisabled();
    }
  );

  it('F3 코드 없는 409·500 은 낡음이 아니라 종전 실패 안내다', () => {
    for (const error of [
      { isAxiosError: true, response: { status: 409, data: {} } },
      { isAxiosError: true, response: { status: 500, data: {} } },
    ]) {
      mockApply.isError = true;
      mockApply.error = error;
      mockItinerary = DRAFT_ITINERARY;
      mockSession.data = session('DRAFT');
      mockDiff.data = READY_DIFF;
      const { unmount } = render(
        <PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />
      );

      expect(screen.queryByTestId('planb-draft-stale')).toBeNull();
      expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
        '변경을 반영하지 못했어요'
      );
      unmount();
    }
  });

  it('F4 [새 대안 보기] → 같은 입력으로 세션을 열고, 성공하면 i05 로 replace 한다', () => {
    renderStaleDraft();
    renderPage();

    fireEvent.press(screen.getByTestId('planb-draft-stale-retry'));

    expect(mockStartMutate).toHaveBeenCalledTimes(1);
    const [variables, options] = mockStartMutate.mock.calls[0] as [
      { tripId: string; data: unknown },
      { onSuccess: (next: { sessionId: string }) => void },
    ];
    expect(variables).toEqual({
      tripId: TRIP_ID,
      data: {
        scope: 'PARTIAL_SLOTS',
        originKind: null,
        reasons: ['TEMP_CLOSED'],
        directives: ['AVOID_OUTDOOR'],
        freeText: null,
        excludedPoiIds: ['poi-closed'],
        triggerId: 'trg-1',
      },
    });
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => options.onSuccess({ sessionId: 's10' }));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/solving',
      params: { tripId: TRIP_ID, sessionId: 's10' },
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('F5 [새 대안 보기]를 같은 틱에 두 번 눌러도 세션 시작은 1회다', () => {
    renderStaleDraft();
    renderPage();
    const retry = screen.getByTestId('planb-draft-stale-retry');

    fireEvent.press(retry);
    fireEvent.press(retry);

    expect(mockStartMutate).toHaveBeenCalledTimes(1);
  });

  it('F6 재요청이 실패하면 다시 누를 수 있다(잠금은 실패에서 풀린다)', () => {
    renderStaleDraft();
    renderPage();

    fireEvent.press(screen.getByTestId('planb-draft-stale-retry'));
    const [, options] = mockStartMutate.mock.calls[0] as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    act(() => options.onError(new Error('500')));
    fireEvent.press(screen.getByTestId('planb-draft-stale-retry'));

    expect(mockStartMutate).toHaveBeenCalledTimes(2);
  });

  it('F7 넣으려던 POI 가 초안에 없으면 그 장소 이름으로 미포함 안내가 뜬다', () => {
    mockIncludedName.value = '하늘공원';
    mockItinerary = DRAFT_ITINERARY;
    mockSession.data = session('DRAFT');
    mockDiff.data = READY_DIFF;
    render(
      <PlanbDraftPage
        tripId={TRIP_ID}
        sessionId={SESSION_ID}
        includePoiId="poi-sky"
      />
    );

    expect(screen.getByTestId('planb-draft-include-missing')).toHaveTextContent(
      '‘하늘공원’은 이번 안에 넣지 못했어요.'
    );
    expect(mockIncludedName.calls).toContain('poi-sky');
  });

  it('F8 넣으려던 POI 가 초안에 있으면 안내가 없고 이름을 묻지 않는다', () => {
    mockIncludedName.value = '해운대 시장';
    mockItinerary = DRAFT_ITINERARY;
    mockSession.data = session('DRAFT');
    mockDiff.data = READY_DIFF;
    render(
      <PlanbDraftPage
        tripId={TRIP_ID}
        sessionId={SESSION_ID}
        includePoiId="px"
      />
    );

    expect(screen.queryByTestId('planb-draft-include-missing')).toBeNull();
    // 앵커 — 페이지는 seam 을 부르되(훅은 늘 호출) 물을 POI 를 주지 않는다.
    expect(mockIncludedName.calls.length).toBeGreaterThan(0);
    expect(mockIncludedName.calls.every((poiId) => poiId === null)).toBe(true);
    // 짝 앵커 — 초안은 그려졌다.
    expect(textsOf(SLOT_NAMES)).toContain('해운대 시장');
  });

  it('F9 이름 조회가 실패하면(null) 이름 없는 미포함 안내다 — 조용히 넘기지 않는다', () => {
    mockIncludedName.value = null;
    mockItinerary = DRAFT_ITINERARY;
    mockSession.data = session('DRAFT');
    mockDiff.data = READY_DIFF;
    render(
      <PlanbDraftPage
        tripId={TRIP_ID}
        sessionId={SESSION_ID}
        includePoiId="poi-sky"
      />
    );

    expect(screen.getByTestId('planb-draft-include-missing')).toHaveTextContent(
      '넣으려던 장소는 이번 안에 넣지 못했어요.'
    );
  });
});

/**
 * 상황 감지 FE-B — 리뷰 반영: 지난 날의 낡은 초안(BR-SA-19 ① targetDate < 오늘 → EXPIRED).
 * 같은 입력의 '같은 날짜'는 서버가 늘 409(지난 날짜는 다시 짤 수 없다 — TRIP-1182)라 [새 대안 보기]는 누를 때마다
 * "잠시 후 다시 시도해 주세요"로 실패한다. 낡음 문구는 그대로 두고 그 버튼만 두지 않는다. 오늘·앞날은 종전대로 있다.
 * 닿는 길: i06 을 자정 넘겨 열어 둔 채 [적용하기](게이트는 낡은 세션을 i06 으로 보내지 않는다).
 */
describe('🔴 상황 감지 FE-B · 지난 날 낡은 초안엔 [새 대안 보기]가 없다', () => {
  // KST 2026-06-12 10:00 — 세션 날짜 06-11 은 어제다.
  const NEXT_MORNING = new Date('2026-06-12T01:00:00Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  it('F10 어제 날짜의 초안이 409 EXPIRED 면 낡음 문구만 있고 [새 대안 보기]는 없다 · 세션 시작 0', () => {
    jest.useFakeTimers({ now: NEXT_MORNING });
    renderStaleDraft('EXPIRED', { targetDate: '2026-06-11' });
    renderPage();

    expect(screen.getByTestId('planb-draft-stale')).toHaveTextContent(
      '시간이 지나 이 대안은 지금 일정과 맞지 않아요'
    );
    expect(screen.queryByTestId('planb-draft-stale-retry')).toBeNull();
    expect(screen.getByTestId('sheet-cta-button-1')).toBeDisabled();
    expect(mockStartMutate).not.toHaveBeenCalled();
  });

  it.each(['2026-06-12', '2026-06-13'])(
    'F10b 오늘·앞날(%s) 초안이면 [새 대안 보기]가 있다(같은 날짜로 다시 짤 수 있다)',
    (targetDate) => {
      jest.useFakeTimers({ now: NEXT_MORNING });
      renderStaleDraft('STALE', { targetDate });
      renderPage();

      fireEvent.press(screen.getByTestId('planb-draft-stale-retry'));
      expect(mockStartMutate).toHaveBeenCalledTimes(1);
    }
  );
});
