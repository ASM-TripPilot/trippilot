import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen } from '@testing-library/react-native';

import { ManualPlanPage } from './ManualPlanPage';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import type { Itinerary } from '@/shared/api/generated/schemas';

/**
 * TRIP-338 · h19 배선 + TRIP-601 가드 a → TRIP-797 묶음 C 재조립 — 페이지→화면을 실제로 태우는 심판.
 * `GeneratingPage.integration.test.tsx`(FULLY_AI) 와 **대칭**이다.
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
 * 새 편집 배선 자체는 `ManualPlanPage.edit.integration.test.tsx` 가 잰다.
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙, GeneratingPage 선례).
let mockGet: {
  data: Itinerary | undefined;
  isPending: boolean;
  isError: boolean;
};

const mockMutate = jest.fn();
const mockPut = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: mockMutate,
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
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
  }),
  router: { push: mockPush, replace: mockReplace, back: mockBack },
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
          tags: [],
        },
      ],
    },
  ],
};

beforeEach(() => {
  // 기본값 — 각 케이스가 자기 GET 상태를 명시로 덮어쓴다.
  mockGet = { data: undefined, isPending: true, isError: false };
  mockMutate.mockClear();
  mockPut.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
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
