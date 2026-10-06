import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render as rtlRender,
  screen,
} from '@testing-library/react-native';

import { buildSlotKey } from '@/entities/itinerary-slot';
import { useItineraryEditStore } from '@/features/edit-itinerary';
import type {
  BaseAssignment,
  Itinerary,
  SavedStay,
} from '@/shared/api/index.schemas';
import { promptAndRegisterPush } from '@/shared/push';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-338 · h19 배선 + TRIP-601 가드 a → TRIP-797 묶음 C 재조립 — 페이지→화면을 실제로 태우는 심판.
 * `GeneratingPage.hookMock.test.tsx`(FULLY_AI) 와 **대칭**이다.
 *
 * TRIP-797: 소비 화면만 옛 `ManualPlanScreen` → 순수 뷰 `EditorView` 로 바뀐다(h12 편집기 통일). MANUAL
 * POST 가드(firedRef·`days.length>0` 보존·로딩 보류)는 **배선 계약이라 그대로**고, 셸 루트만
 * `itinerary-manual-root` → `map-sheet-shell-root`(EditorView 가 조립하는 MapSheetShell) 로 바뀐다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **G-a1 (AC-a1 · 보존)** 기존 초안(GET `days.length>0`)이 있으면 덮어쓰기 POST 가 **0건**이고
 *    기존 슬롯이 화면에 남는다(셸 루트+슬롯 이름). 직접 고르기 진입이 AI 초안을 빈 MANUAL 로 지우던
 *    데이터 오염을 막는다.
 *  - 🟢 **G-a2 (AC-a2 · 유일 방어선)** GET 이 아직 로딩 중(`isPending`)이면 POST 를 **보류**한다 — 도착할
 *    기존 초안을 못 보고 쏘면 그대로 덮어쓴다(콜드캐시 함정 동형, fail-safe). POST 가드는 재조립 무관.
 *  - 🟢 **G-a3 (AC-a3 · 신규 무회귀)** 기존 일정이 없으면(GET 정착·404) 종전대로 POST 를 **1회**,
 *    `{ generationMode:'MANUAL' }` 하나만 담아 쏜다(POST 가드는 재조립 무관, 계약 그대로 얼린다).
 *  - 🔴 **I2 (TRIP-338 AC-2)** `(MANUAL, MINIMAL, isFallback=false)` 일정이 와도 폴백·실패 배너를 안
 *    띄운다(셸 루트 짝 동반, 재조립 후에도 보존).
 *  - 🔴 **M1 (TRIP-926 AC1)** 빈 일자(핀 0개)면 지도 center = 서울 시청(null-island (0,0) 아님).
 *  - 🟢 **M2 (TRIP-926 AC2)** 핀이 있으면 center = 첫 핀 좌표(무회귀 짝).
 *  - 🟢 **V1·V2 (TRIP-590 AC1·AC2)** 서버가 `hasViolation:true` 로 준 슬롯에만 위반 배지가 사유 문구로
 *    뜬다 — 페이지→스토어→EditorView→SlotStopCard 전 구간 잠금(선제 green, 뮤테이션으로 red 실측).
 *
 * ⚠️ RED 트리거는 `map-sheet-shell-root`(EditorView 조립) — 현재 페이지는 `ManualPlanScreen` 을 물어
 * 이 testID 가 없다. G-a2·G-a3(POST 가드) 는 재조립과 무관해 선제 green 이다.
 *
 * 3동작 뼈대: 준비=목(GET 상태·mutate·router) → 실행=페이지 렌더 → 단언=나간 POST·보이는 표면.
 *
 * **TRIP-921**: 페이지가 위젯 편집 뷰를 소비하며 편집 배선(스토어 시드·저장 PUT·시각 시트)을 얻는다.
 * 이 파일의 단언은 **그대로**이고, 준비만 넓혔다 — 목에 저장 PUT 훅·쿼리키 함수를 더하고(없는 훅을
 * 부르면 무관한 G-a1~a3 가 먼저 깨진다, 02a ★9), QueryClientProvider 로 감싸고, 편집 스토어를 매
 * 케이스 비운다. **방문 조회 훅은 일부러 목에 없다** — MANUAL 초안엔 완료 개념이 없다(02a D-11).
 * 새 편집 배선 자체는 `ManualPlanPage.integration.test.tsx` 「편집 배선 — 순서·시각·저장·장소 추가」 describe 가
 * 잰다.
 *
 * 한 파일로 합친 기록(TRIP-1151): 생성 훅을 통째로 목으로 바꾼 두 파일(옛 `.integration` · `.push`)을 이
 * 파일로 합쳤다. 생성 POST 목은 옛 `.push` 모양(`mockPostPhase` 에 따라 훅 옵션·호출별 콜백을 태운다)이고,
 * 기본 'pending' 은 콜백을 하나도 안 태워 옛 본 파일의 기록만 하는 `mutate` 와 같다. MSW 를 안 쓰므로 node
 * 버킷이다(README 버킷 예외 — 실 훅 + MSW 는 `.integration.test.tsx`).
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙, GeneratingPage 선례).
let mockGet: {
  data: Itinerary | undefined;
  isPending: boolean;
  isError: boolean;
};

// TRIP-1022 — 동기 목이라 첫 렌더부터 확정된 거점·숙소를 준다(02a ★3). 기본값은 "거점 0곳".
let mockBases: {
  data: BaseAssignment[] | undefined;
  isPending: boolean;
  isError: boolean;
};
let mockStays: {
  data: SavedStay[] | undefined;
  isPending: boolean;
  isError: boolean;
};

const mockMutate = jest.fn();
const mockPut = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// TRIP-1264 — ‹ 와 뒤로 가로채기 콜백이 부르는 일정 탭 이동(이 파일은 그 전엔 ‹ 를 누르지 않아 없었다).
const mockDismissTo = jest.fn();

// TRIP-1264 — 뒤로 가로채기(`usePreventRemove`)를 목으로 바꿔 페이지가 넘긴 인자(켜짐 여부·콜백)를 잡는다.
// 콜백에 액션을 직접 넣어 "스와이프·하드웨어 뒤로가 오면 무엇을 하나"를 잰다. 실물 스택은
// `model/useItineraryTabBack.integration.test.tsx` 가 잰다.
type BlockedAction = { type: string; payload?: object };
type PreventRemoveCallback = (options: {
  data: { action: BlockedAction };
}) => void;
const mockUsePreventRemove = jest.fn<void, [boolean, PreventRemoveCallback]>();
const mockDispatch = jest.fn();
const mockNavigation = {
  dispatch: mockDispatch,
  addListener: jest.fn(() => () => {}),
};

// 생성 POST 결과 — 'pending' 은 어떤 콜백도 안 태운다(옛 본 파일 모양), success·error 는 훅 옵션 → 호출별
// 콜백 순으로 태운다(옛 `.push` 모양). 최상위 beforeEach 가 'pending' 으로 되돌린다.
let mockPostPhase: 'pending' | 'success' | 'error' = 'pending';
const mockPostMutate = jest.fn();

type MutationCallbacks = {
  onSuccess?: (data: unknown, variables: unknown, context: unknown) => void;
  onError?: (error: unknown, variables: unknown, context: unknown) => void;
};

// 페이지 모듈 그래프엔 push 가 없다 — `.push` describe 의 "0회" 단언이 jest.fn 을 세려고 둔다(옛 `.push` 목).
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: (hookOptions?: {
    mutation?: MutationCallbacks;
  }) => ({
    mutate: (variables: unknown, mutateOptions?: MutationCallbacks) => {
      mockMutate(variables, mutateOptions);
      mockPostMutate(variables);
      const data = {
        itineraryId: 'it1',
        tripId: 't1',
        status: 'PLANNED',
        solveMode: 'MINIMAL',
        generationMode: 'MANUAL',
        isFallback: false,
        generationState: 'COMPLETE',
        days: [{ date: '2026-06-10', slots: [] }],
      };
      if (mockPostPhase === 'success') {
        hookOptions?.mutation?.onSuccess?.(data, variables, undefined);
        mutateOptions?.onSuccess?.(data, variables, undefined);
      } else if (mockPostPhase === 'error') {
        const error = new Error('500');
        hookOptions?.mutation?.onError?.(error, variables, undefined);
        mutateOptions?.onError?.(error, variables, undefined);
      }
    },
    // 페이지는 생성 훅의 isPending 을 읽지 않는다(grep 0) — 옛 본 파일 값 그대로.
    isPending: false,
    isError: false,
  }),
  useGetTripsTripIdItinerary: () => mockGet,
  // TRIP-921 — 편집 배선의 저장 PUT(이 파일은 저장을 누르지 않는다, 0회 유지는 단언 대상 아님).
  usePutTripsTripIdItinerary: () => ({
    mutate: mockPut,
    isPending: false,
    isError: false,
  }),
  getGetTripsTripIdItineraryQueryKey: (tripId: string) => [
    `/trips/${tripId}/itinerary`,
  ],
  // TRIP-1022 — 빈 편집기 지도 중심을 거점 숙소로 잡으려고 페이지가 거점 조회를 부른다. 팩토리에 없는
  // 이름을 부르면 무관한 G-a1~V1 이 "is not a function" 으로 한꺼번에 죽는다(02a ★1).
  useGetTripsTripIdBases: () => mockBases,
  // TRIP-1038 B — 「저장하고 확정하기」가 확정 POST 훅을 부른다(이 파일은 저장을 누르지 않는다 · 단언 무관 준비).
  usePostTripsTripIdItineraryConfirm: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));

// TRIP-1022 — 거점 좌표는 등록 숙소(`SavedStay.lat/lng`)에 있다. 생성 모듈째 가로채야 `useSavedStays`
// 래퍼를 거쳐도 이 목에 닿고, 실 axios 요청이 새지 않는다(02a ★2).
jest.mock('@/shared/api/generated/saved-stays/saved-stays', () => ({
  useGetSavedStays: () => mockStays,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    dismissTo: mockDismissTo,
  }),
  router: {
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    dismissTo: mockDismissTo,
  },
  // TRIP-1264 — useNavigation 을 어느 쪽에서 가져오든 같은 가짜 navigation 이다(02a ★8).
  useNavigation: () => mockNavigation,
}));

// TRIP-1264 — 실물은 ESM 이라 이 버킷에서 require 하면 로드부터 죽는다 → 팩토리로만 바꾼다(02a ★7).
// 팩토리는 import 보다 먼저 돈다 — mock 변수는 화살표 안에서 늦게 읽는다(02a ★6).
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: (preventRemove: boolean, callback: PreventRemoveCallback) =>
    mockUsePreventRemove(preventRemove, callback),
  useNavigation: () => mockNavigation,
}));

// EditorView 가 조립하는 MapSheetShell → MapView 는 jest 에서 못 뜬다 — 관찰 목으로 대체(재조립 후 필요).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const TRIP_ID = 't1';

/** TRIP-921 — 편집 배선이 쿼리 클라이언트를 쓸 수 있게 감싼다(단언 무관 준비). */
function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper });
}

/** 정확한 `(MANUAL, MINIMAL, false)` 빈 일정 — 폴백 함정(§8①)의 급소 픽스처. */
const MANUAL_EMPTY: Itinerary = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'MINIMAL',
  generationMode: 'MANUAL',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [{ date: '2026-06-10', slots: [] }],
};

/** 기존 AI 초안 — day1 에 채워진 슬롯이 있다(`days.length>0` · 슬롯 보존 대상). 직접 고르기 진입이
 * 이걸 빈 MANUAL 로 지우면 안 된다. */
const EXISTING_DRAFT: Itinerary = {
  itineraryId: 'it2',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'FULL_AI',
  generationMode: 'FULLY_AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-10',
      slots: [
        {
          poiId: 'p1',
          nameKo: '경복궁',
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
  ],
};

beforeEach(() => {
  // 기본값 — 각 케이스가 자기 GET 상태를 명시로 덮어쓴다.
  mockGet = { data: undefined, isPending: true, isError: false };
  // TRIP-1022 — 기본은 거점 0곳(기존 M1 이 "거점 없음 → 서울시청" 갈래로 남는다, 01 AC-A5).
  mockBases = { data: [], isPending: false, isError: false };
  mockStays = { data: [], isPending: false, isError: false };
  mockMutate.mockClear();
  mockPostMutate.mockClear();
  mockPostPhase = 'pending';
  mockPut.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockDismissTo.mockClear();
  mockUsePreventRemove.mockClear();
  mockDispatch.mockClear();
  // 편집 스토어는 모듈 싱글턴 — 앞 케이스의 시드가 새지 않게 비운다(02a ★10).
  useItineraryEditStore.getState().reset();
});

describe('🔴 G-a1 · AC-a1 — 기존 초안이 있으면 덮어쓰기 POST 0건, 슬롯 보존', () => {
  it('기존 일정(days>0)이 있으면 mutate 는 0회이고 기존 슬롯이 화면에 남는다', () => {
    // 준비 — GET 이 정착해 기존 AI 초안(슬롯 있음)을 돌려준다.
    mockGet = { data: EXISTING_DRAFT, isPending: false, isError: false };

    // 실행 — h19(직접 고르기)에 진입.
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언 ① (금지) — 빈 MANUAL 생성 POST 가 나가지 않는다(보존).
    expect(mockMutate).toHaveBeenCalledTimes(0);

    // 단언 ② (짝·긍정) — 기존 초안이 실제로 EditorView 셸에 남는다(공허 통과 방지).
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByText('경복궁')).toBeOnTheScreen();
  });
});

describe('🟢 G-a2 · AC-a2 — GET 로딩 중이면 POST 보류(fail-safe, 유일 방어선)', () => {
  it('itinerary.isPending 이면 mutate 는 0회다 — 도착 전 덮어쓰기 금지', () => {
    // 준비 — GET 이 아직 안 왔다(기존 초안이 로딩 중일 수 있는 위험 창).
    mockGet = { data: undefined, isPending: true, isError: false };

    // 실행 — 이 창에서 무조건 POST 하면 도착할 기존 초안을 못 보고 지운다.
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언 — 서버는 재생성 POST 를 안 막으므로 이 보류가 유일한 그물이다.
    expect(mockMutate).toHaveBeenCalledTimes(0);
  });
});

describe('🟢 G-a3 · AC-a3 — 신규(기존 없음)면 종전대로 POST 1건 (구 I1 동결)', () => {
  it('GET 정착·일정 없음이면 POST 가 정확히 1회, { generationMode:"MANUAL" } 만 담아 나간다', () => {
    // 준비 — GET 이 정착했고 일정이 없다(404). 이때만 새로 만든다.
    mockGet = { data: undefined, isPending: false, isError: true };

    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 마운트 시 정확히 1회(firedRef — 재렌더로 두 번 쏘지 않는다).
    expect(mockMutate).toHaveBeenCalledTimes(1);

    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: unknown;
    };
    expect(vars.tripId).toBe(TRIP_ID);
    // ★ toEqual = 정확 일치 — deadlineMs 등 여분 키 0(BR-U3-03, FULLY_AI 심판 대칭).
    expect(vars.data).toEqual({ generationMode: 'MANUAL' });
  });
});

describe('🔴 I2 · TRIP-338 AC-2 — (MANUAL, MINIMAL, false) 에 폴백·실패 배너가 없다 (INV-4)', () => {
  it('루트가 뜨고(짝) 폴백 배너 testID 는 어느 것도 없다', () => {
    // MANUAL_EMPTY 는 days.length===1 이라 가드 a 는 "기존"으로 보고 POST 안 함(I2 는 mutate 미단언).
    mockGet = { data: MANUAL_EMPTY, isPending: false, isError: false };
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 루트 존재 짝(★) — EditorView 셸이 그 픽스처로 실제 렌더됐다(오타 testID 로 공허 통과 방지).
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();

    // 폴백/실패 배너는 어느 계약으로도 안 뜬다 — MANUAL 은 실패가 아니라 선택이다(§8①).
    [
      'itinerary-manual-fallback-banner',
      'itinerary-draft-fallback-banner',
    ].forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
  });
});

describe('TRIP-926 · M — 지도 중심 (핀 0개면 서울 시청, 있으면 첫 핀)', () => {
  // mapViewMock 이 center 를 map-root 텍스트 "lat,lng" 로 노출한다(toHaveTextContent 는 완전 일치).
  const SEOUL_CITY_HALL = '37.5665,126.978';

  it('🔴 M1 · 빈 일자(핀 0개) 일정이면 지도 중심이 서울 시청이다 (AC1)', () => {
    // 준비 — GET 이 정착해 빈 일자 1개짜리 MANUAL 일정을 돌려준다.
    mockGet = { data: MANUAL_EMPTY, isPending: false, isError: false };

    // 실행 — h19 진입.
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언 — 기니만(0,0)이 아니라 서울 시청을 비춘다.
    expect(screen.getByTestId('map-root')).toHaveTextContent(SEOUL_CITY_HALL);
  });

  it('M2 · 활성 일자에 핀이 있으면 지도 중심은 첫 핀 좌표다 (AC2 · 무회귀 선제 green)', () => {
    // 준비 — 기존 초안의 슬롯 2개에 좌표를 싣는다(첫 핀 ≠ 둘째 핀 ≠ 서울 시청).
    const [first] = EXISTING_DRAFT.days[0].slots;
    mockGet = {
      data: {
        ...EXISTING_DRAFT,
        days: [
          {
            date: '2026-06-10',
            slots: [
              { ...first, lat: 37.5796, lng: 126.977 },
              {
                ...first,
                poiId: 'p2',
                nameKo: '창덕궁',
                lat: 37.5794,
                lng: 126.991,
              },
            ],
          },
        ],
      },
      isPending: false,
      isError: false,
    };

    // 실행 — h19 진입.
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언 — 초안이 실제로 시드됐고(짝), 지도는 첫 핀(경복궁) 좌표를 비춘다.
    expect(screen.getByText('경복궁')).toBeOnTheScreen();
    expect(screen.getByTestId('map-root')).toHaveTextContent('37.5796,126.977');
  });
});

describe('TRIP-590 · V — 서버 위반 슬롯에 배지 (h19 직접 짜기, 선제 green)', () => {
  const DAY = '2026-06-10';
  const REASON = '숙소 고정 충돌';

  it('🟢 V1·V2 · 위반 슬롯엔 사유 문구 배지가, 위반 없는 슬롯엔 배지가 없다 (AC1·AC2)', () => {
    // 준비 — GET 이 슬롯 2곳을 돌려준다: p1 은 서버가 위반 판정(사유 동봉), p2 는 위반 없음.
    const [first] = EXISTING_DRAFT.days[0].slots;
    mockGet = {
      data: {
        ...EXISTING_DRAFT,
        days: [
          {
            date: DAY,
            slots: [
              { ...first, hasViolation: true, violationReason: REASON },
              { ...first, poiId: 'p2', nameKo: '창덕궁' },
            ],
          },
        ],
      },
      isPending: false,
      isError: false,
    };

    // 실행 — h19 진입.
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언 ① (AC1) — 위반 슬롯의 배지가 서버 사유 문구 그대로 뜬다(toHaveTextContent 문자열 = 완전 일치).
    expect(
      screen.getByTestId(`slot-stopcard-violation-${buildSlotKey(DAY, 'p1')}`)
    ).toHaveTextContent(REASON);

    // 단언 ② (AC2) — 위반 없는 슬롯은 카드는 있고(짝) 배지는 없다.
    const cleanKey = buildSlotKey(DAY, 'p2');
    expect(screen.getByTestId(`slot-stopcard-${cleanKey}`)).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`slot-stopcard-violation-${cleanKey}`)
    ).toBeNull();

    // 단언 ③ — 화면 전체의 위반 배지는 정확히 1개(엉뚱한 카드에 번지지 않는다).
    expect(screen.queryAllByTestId(/^slot-stopcard-violation-/)).toHaveLength(
      1
    );
  });
});

/**
 * TRIP-1022 #075 · 결정 1 — 빈 편집기(핀 0개) 지도 중심을 거점 숙소로.
 *
 * 무엇을 보장하나(01 AC-A4~A6 · 01b Q1):
 *  - 🔴 C1 그날을 덮는 거점(`dateFrom ≤ date < dateTo`)이 있고 숙소 좌표가 온전하면 그 좌표를 비춘다.
 *  - 🔴 C2 체크아웃 날(2일차)은 어느 거점도 덮지 않지만, 가장 이른 거점 숙소를 비춘다(Q1②) —
 *    QA 사례(강릉 1박 2일)의 2일차가 다시 서울로 튀지 않는다.
 *  - 🟢 C3 숙소 좌표가 반쪽(lat null)이면 서울시청(기존 폴백 유지, C1 과 같은 메커니즘의 짝).
 *  - 🟢 C4 핀이 있으면 거점이 있어도 첫 핀이 이긴다(기존 M2 우선순위 유지).
 *  - 🟢 C5 (5-c 보강, 03b 경고-2) 거점이 둘이면 **누른 날**을 덮는 거점을 비춘다 — 페이지가 활성
 *    날짜를 판정에 넘기는지를 가른다. 거점 하나짜리(C1·C2)는 "그날 거점"과 "가장 이른 거점"이 같은
 *    답이라 이걸 못 가른다.
 *
 * 거점·숙소는 동기 목이라 첫 렌더부터 확정된 입력이다 — "서울" 단언이 "아직 안 왔다"로 공허하게
 * 통과하지 않는다(02a ★3). 좌표 비교는 mapViewMock 의 `map-root` 텍스트(완전 일치).
 */
describe('TRIP-1022 · C — 빈 편집기 지도 중심 = 거점 숙소 (결정 1)', () => {
  const GANGNEUNG = '37.7519,128.8761';
  const SEOUL_CITY_HALL = '37.5665,126.978';

  /** 1박 2일 직접 짜기 — 두 날 모두 슬롯 0(핀 0). 칩이 뜨는 조건은 "2일 이상"(01 드리프트). */
  const MANUAL_TWO_DAYS: Itinerary = {
    ...MANUAL_EMPTY,
    days: [
      { date: '2026-10-20', slots: [] },
      { date: '2026-10-21', slots: [] },
    ],
  };

  const GN_BASE: BaseAssignment = {
    baseAssignmentId: 'ba-gn',
    savedStayId: 's-gn',
    dateFrom: '2026-10-20',
    dateTo: '2026-10-21',
  };

  function gangneungStay(over: Partial<SavedStay> = {}): SavedStay {
    return {
      savedStayId: 's-gn',
      name: '강릉 바다 스테이',
      lat: 37.7519,
      lng: 128.8761,
      coordConfirmed: true,
      linkedTripIds: [TRIP_ID],
      registerRoute: 'MAP_SEARCH',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      ...over,
    };
  }

  function withBase(stay: SavedStay): void {
    mockBases = { data: [GN_BASE], isPending: false, isError: false };
    mockStays = { data: [stay], isPending: false, isError: false };
  }

  it('🔴 C1 (AC-A4) 핀 0개 · 1일차를 덮는 거점이 있으면 지도 중심이 그 숙소다', () => {
    // 준비
    mockGet = { data: MANUAL_TWO_DAYS, isPending: false, isError: false };
    withBase(gangneungStay());

    // 실행
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언 — 서울이 아니라 강릉.
    expect(screen.getByTestId('map-root')).toHaveTextContent(GANGNEUNG);
  });

  it('🔴 C2 (Q1②) 2일차(체크아웃 날)로 바꿔도 가장 이른 거점 숙소를 비춘다', () => {
    mockGet = { data: MANUAL_TWO_DAYS, isPending: false, isError: false };
    withBase(gangneungStay());
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 실행 — 2일차 칩(1박 2일이라 칩이 뜬다).
    fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));

    // 단언 — 날짜는 바뀌었고(짝), 지도는 여전히 강릉.
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '10월 21일(수)'
    );
    expect(screen.getByTestId('map-root')).toHaveTextContent(GANGNEUNG);
  });

  it('C3 (AC-A5) 숙소 좌표가 반쪽(lat null)이면 서울시청이다 (선제 green)', () => {
    mockGet = { data: MANUAL_TWO_DAYS, isPending: false, isError: false };
    withBase(gangneungStay({ lat: null }));

    render(<ManualPlanPage tripId={TRIP_ID} />);

    expect(screen.getByTestId('map-root')).toHaveTextContent(SEOUL_CITY_HALL);
  });

  it('C4 (AC-A6) 핀이 있으면 거점이 있어도 첫 핀이 중심이다 (선제 green)', () => {
    const [first] = EXISTING_DRAFT.days[0].slots;
    mockGet = {
      data: {
        ...EXISTING_DRAFT,
        days: [
          {
            date: '2026-10-20',
            slots: [{ ...first, lat: 37.5796, lng: 126.977 }],
          },
        ],
      },
      isPending: false,
      isError: false,
    };
    withBase(gangneungStay());

    render(<ManualPlanPage tripId={TRIP_ID} />);

    expect(screen.getByText('경복궁')).toBeOnTheScreen(); // 짝 — 슬롯이 시드됐다
    expect(screen.getByTestId('map-root')).toHaveTextContent('37.5796,126.977');
  });

  it('C5 (Q1①) 거점이 둘이면 3일차를 누를 때 그날을 덮는 속초 숙소로 옮겨 간다 (5-c 보강)', () => {
    // 준비 — 2박 3일: 강릉 1박(10-20~10-21) → 속초 2박(10-21~10-23). 세 날 모두 핀 0.
    const SOKCHO = '38.207,128.5918';
    mockGet = {
      data: {
        ...MANUAL_EMPTY,
        days: [
          { date: '2026-10-20', slots: [] },
          { date: '2026-10-21', slots: [] },
          { date: '2026-10-22', slots: [] },
        ],
      },
      isPending: false,
      isError: false,
    };
    mockBases = {
      data: [
        GN_BASE,
        {
          baseAssignmentId: 'ba-sc',
          savedStayId: 's-sc',
          dateFrom: '2026-10-21',
          dateTo: '2026-10-23',
        },
      ],
      isPending: false,
      isError: false,
    };
    mockStays = {
      data: [
        gangneungStay(),
        gangneungStay({
          savedStayId: 's-sc',
          name: '속초 항구 스테이',
          lat: 38.207,
          lng: 128.5918,
        }),
      ],
      isPending: false,
      isError: false,
    };
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 앵커 — 1일차는 강릉(가장 이른 거점과 그날 거점이 같다). 처음부터 속초면 아래 단언이 공허하다.
    expect(screen.getByTestId('map-root')).toHaveTextContent(GANGNEUNG);

    // 실행 — 3일차 칩.
    fireEvent.press(screen.getByTestId('itinerary-edit-day-3'));

    // 단언 — 날짜가 바뀌었고(짝), 지도는 그날을 덮는 속초. 날짜를 안 넘기면(가장 이른 거점) 강릉에 남아 red.
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '10월 22일(목)'
    );
    expect(screen.getByTestId('map-root')).toHaveTextContent(SOKCHO);
  });
});

// TRIP-1108 AC-7 · 옛 ManualPlanPage.push.integration.test.tsx — 생성·조회 목은 최상위(옛 `.push` 모양)를 쓴다.
describe('빈 일정이 처음 생겨도 알림 권한을 묻지 않는다', () => {
  /**
   * TRIP-1108 AC-7(직접 짜기) — 빈 MANUAL 일정이 처음 만들어져도 알림 권한을 **묻지 않는다**.
   *
   * 역사: TRIP-835 는 빈 일정이 처음 생긴 순간 권한을 묻게 했다(M1 이 1회를 단언했다). TRIP-1108 이 묻는 자리를
   * 온보딩 사전 안내 카드로 옮겼으므로 M1 을 **0회로 뒤집어** 금지 그물로 남긴다(파일은 지우지 않는다).
   *
   * 무엇을 보장하나:
   *  - MANUAL 생성 POST 가 성공해도 `promptAndRegisterPush()` 0회 — 성공 콜백이 실제로 돌았다는 앵커는
   *    그 콜백이 하는 재조회(`invalidateQueries`)다.
   *  - POST 실패·기존 초안으로 건너뜀·조회 로딩 중 보류에도 0회(원래부터).
   *
   * `GeneratingPage.hookMock.test.tsx` 「생성 중 알림 권한을 묻지 않는다」 와 대칭이다(같은 루틴, 같은 뮤테이션 목 모양).
   *
   * 3동작 뼈대: 준비=GET 상태·POST 결과 → 실행=페이지 렌더 → 단언=루틴 호출 횟수.
   */

  const mockPrompt = promptAndRegisterPush as jest.Mock;
  const TRIP_ID = 't1';

  /** 기존 AI 초안 — 이게 있으면 페이지는 POST 를 건너뛴다. */
  const EXISTING_DRAFT: Itinerary = {
    itineraryId: 'it2',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: '2026-06-10',
        slots: [
          {
            poiId: 'p1',
            nameKo: '경복궁',
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
    ],
  };

  function render(ui: ReactElement) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return rtlRender(ui, { wrapper: Wrapper });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet = { data: undefined, isPending: true, isError: false };
    mockPostPhase = 'pending';
    // 편집 스토어는 모듈 싱글턴 — 앞 케이스의 시드가 새지 않게 비운다.
    useItineraryEditStore.getState().reset();
  });

  describe('🔴 TRIP-1108 AC-7 · 직접 짜기 — 빈 일정이 처음 생겨도 묻지 않는다', () => {
    it('M1 일정이 없어(GET 404) MANUAL POST 가 성공해도 루틴 0회', () => {
      // 준비 — 성공 콜백의 재조회를 엿본다(= onSuccess 가 실제로 돌았다는 앵커)
      const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
      mockGet = { data: undefined, isPending: false, isError: true };
      mockPostPhase = 'success';

      try {
        // 실행
        render(<ManualPlanPage tripId={TRIP_ID} />);

        // 단언 — 앵커(POST 1회 + 성공 콜백 실행) + 부정(루틴 0회)
        expect(mockPostMutate).toHaveBeenCalledTimes(1);
        expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(mockPrompt).toHaveBeenCalledTimes(0);
      } finally {
        invalidate.mockRestore();
      }
    });
  });

  describe('TRIP-1108 AC-7 · 직접 짜기 — 처음 만든 게 아니어도 묻지 않는다(원래부터)', () => {
    it('M2 MANUAL POST 가 실패하면 루틴 0회', () => {
      mockGet = { data: undefined, isPending: false, isError: true };
      mockPostPhase = 'error';

      render(<ManualPlanPage tripId={TRIP_ID} />);

      expect(mockPostMutate).toHaveBeenCalledTimes(1);
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('M3 기존 초안이 있어 POST 를 건너뛰면 루틴 0회', () => {
      mockGet = { data: EXISTING_DRAFT, isPending: false, isError: false };
      mockPostPhase = 'success';

      render(<ManualPlanPage tripId={TRIP_ID} />);

      // 짝: POST 자체가 안 나갔다(건너뛴 경로를 실제로 탔다).
      expect(mockPostMutate).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('M4 조회가 아직 로딩 중이라 POST 를 보류하는 동안 루틴 0회', () => {
      mockGet = { data: undefined, isPending: true, isError: false };
      mockPostPhase = 'success';

      render(<ManualPlanPage tripId={TRIP_ID} />);

      expect(mockPostMutate).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });
});

// TRIP-1264 · QA F2 — 직접 짜기 편집기의 ‹ 와 iOS 스와이프·Android 하드웨어 뒤로가 같은 곳(일정 탭)에 닿는다.
describe('뒤로 제스처·하드웨어 뒤로도 일정 탭으로', () => {
  /**
   * 스와이프·하드웨어 뒤로는 ‹(onBack)를 거치지 않고 네비게이터가 바로 한 칸 뒤(방식 선택)로 보낸다. 그래서
   * 페이지가 "이 화면이 빠지려는 이동"을 가로채(`usePreventRemove`), 뒤로 계열이면 ‹ 와 같은 곳으로 보내고
   * 그 밖의 이동(확정 뒤 h16 replace·로그아웃 dismissAll·‹ 자신의 dismissTo)은 받은 그대로 다시 보낸다.
   *
   * 무엇을 보장하나:
   *  - 🔴 N1 페이지가 가로채기를 **실제로 등록**하고, 어떤 상태에서도 켜 둔다(AC-7). 실물 라우터 테스트는 탐침
   *    화면으로 훅만 재므로 "페이지가 훅을 부르는가"는 여기만 본다(02a ★1).
   *  - 🔴 N2·N3 뒤로 계열(GO_BACK·POP)이면 ‹ 와 같은 `dismissTo('/(tabs)/itinerary')` 1회(AC-1).
   *  - 🔴 N4 그 밖의 액션은 받은 **그 객체** 그대로 다시 보낸다(AC-4·5·6) — 다시 만든 객체는 또 막혀 끝없이 돈다.
   *
   * 3동작 뼈대: 준비 = 정착한 빈 MANUAL 일정으로 페이지 렌더 → 실행 = 가로챈 콜백에 액션 넣기 → 단언 = 라우터·dispatch.
   */

  /** 페이지가 마지막 렌더에 넘긴 가로채기 콜백에 액션을 넣는다(스와이프·하드웨어 뒤로가 막힌 순간). */
  function blockRemove(action: BlockedAction): void {
    const callback = mockUsePreventRemove.mock.lastCall?.[1];
    // 앵커 — 페이지가 가로채기를 등록했다(없으면 이 아래 단언이 공허해진다).
    expect(callback).toBeDefined();
    callback?.({ data: { action } });
  }

  function renderSettled(): void {
    mockGet = { data: MANUAL_EMPTY, isPending: false, isError: false };
    render(<ManualPlanPage tripId={TRIP_ID} />);
  }

  describe('🔴 N1 · AC-7 — 가로채기는 항상 켜져 있다', () => {
    it.each<[string, () => void]>([
      [
        '조회 로딩 중',
        () => {
          mockGet = { data: undefined, isPending: true, isError: false };
          render(<ManualPlanPage tripId={TRIP_ID} />);
        },
      ],
      ['조회 정착(빈 MANUAL)', renderSettled],
      [
        '새로 짜기로 비우는 중(startFresh)',
        () => {
          mockGet = { data: MANUAL_EMPTY, isPending: false, isError: false };
          render(<ManualPlanPage tripId={TRIP_ID} startFresh />);
        },
      ],
    ])(
      '%s — 페이지가 usePreventRemove 를 부르고 첫 인자는 모두 true',
      (_label, arrange) => {
        // 준비 · 실행
        arrange();

        // 단언 — 호출 0회면 "모두 true"가 공허하게 참이다(02a ★12).
        const flags = mockUsePreventRemove.mock.calls.map(
          ([prevent]) => prevent
        );
        expect(flags.length).toBeGreaterThan(0);
        expect(flags).toEqual(flags.map(() => true));
      }
    );
  });

  describe('🔴 N2 · AC-1 — 뒤로 계열은 ‹ 와 같은 일정 탭으로 간다', () => {
    it.each<[string, BlockedAction]>([
      ['하드웨어 뒤로(GO_BACK)', { type: 'GO_BACK' }],
      ['iOS 스와이프(POP)', { type: 'POP', payload: { count: 1 } }],
    ])('%s → dismissTo(일정 탭) 1회, 다른 이동 0회', (_label, action) => {
      // 준비
      renderSettled();
      // 앵커 — 실행 전엔 이동 0회.
      expect(mockDismissTo).not.toHaveBeenCalled();

      // 실행
      blockRemove(action);

      // 단언
      expect(mockDismissTo).toHaveBeenCalledTimes(1);
      expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/itinerary');
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('🔴 N3 · AC-1 — ‹ 와 스와이프는 같은 인자로 같은 곳에 간다', () => {
    it('‹ 를 누른 이동과 가로챈 뒤로의 이동이 똑같다', () => {
      // 준비
      renderSettled();

      // 실행 — ‹ 한 번, 하드웨어 뒤로 한 번.
      fireEvent.press(screen.getByTestId('itinerary-edit-back'));
      blockRemove({ type: 'GO_BACK' });

      // 단언
      expect(mockDismissTo.mock.calls).toEqual([
        ['/(tabs)/itinerary'],
        ['/(tabs)/itinerary'],
      ]);
    });
  });

  describe('🔴 N4 · AC-4·5·6 — 뒤로가 아닌 이동은 받은 그대로 통과시킨다', () => {
    it.each<[string, BlockedAction]>([
      [
        '확정 뒤 h16 으로 교체(REPLACE)',
        {
          type: 'REPLACE',
          payload: { name: 'trips/[tripId]/itinerary/index' },
        },
      ],
      ['계정 경계 dismissAll(POP_TO_TOP)', { type: 'POP_TO_TOP' }],
      [
        '‹ 자신이 보낸 dismissTo(POP_TO)',
        { type: 'POP_TO', payload: { name: '(tabs)' } },
      ],
    ])('%s → 그 액션 객체로 dispatch 1회, dismissTo 0회', (_label, action) => {
      // 준비
      renderSettled();

      // 실행
      blockRemove(action);

      // 단언 — 같은 내용이 아니라 같은 객체(02a ★4). dismissTo 를 또 부르면 ‹ 가 끝없이 돈다.
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch.mock.calls[0][0]).toBe(action);
      expect(mockDismissTo).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});
