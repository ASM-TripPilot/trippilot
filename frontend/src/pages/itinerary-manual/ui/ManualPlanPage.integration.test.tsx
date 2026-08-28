import { render, screen } from '@testing-library/react-native';

import { ManualPlanPage } from './ManualPlanPage';
import type { Itinerary } from '@/shared/api/generated/schemas';

/**
 * TRIP-338 · h19 배선 + TRIP-601 가드 a — 페이지→화면을 실제로 태우는 심판.
 * `GeneratingPage.integration.test.tsx`(FULLY_AI) 와 **대칭**이다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **G-a1 (AC-a1 · 보존)** 기존 초안(GET `days.length>0`)이 있으면 덮어쓰기 POST 가 **0건**이고
 *    기존 슬롯이 화면에 남는다. 직접 고르기 진입이 AI 초안을 빈 MANUAL 로 지우던 데이터 오염을 막는다.
 *  - 🔴 **G-a2 (AC-a2 · 유일 방어선)** GET 이 아직 로딩 중(`isPending`)이면 POST 를 **보류**한다 — 도착할
 *    기존 초안을 못 보고 쏘면 그대로 덮어쓴다(콜드캐시 함정 동형, fail-safe).
 *  - 🟢 **G-a3 (AC-a3 · 신규 무회귀)** 기존 일정이 없으면(GET 정착·404) 종전대로 POST 를 **1회**,
 *    `{ generationMode:'MANUAL' }` 하나만 담아 쏜다. **구 I1(TRIP-338) 동결 계약**이다 — arrange 만 "GET
 *    정착·일정 없음"으로 바꿔 계약(신규면 POST 1건·여분 키 0)을 그대로 얼린다.
 *  - 🟢 **I2 (TRIP-338 AC-2)** `(MANUAL, MINIMAL, isFallback=false)` 일정이 와도 폴백·실패 배너를 안
 *    띄운다(가드 a 무관, 보존).
 *
 * ★ 목 재편(02a §1.2 · ★a-4): 구 목은 `isPending: data===undefined` 로 data·pending 을 한 변수에 묶어
 * 세 상태(로딩/기존있음/신규)를 못 갈랐다. 가드 a 는 셋을 구분해야 하므로 `data`·`isPending`·`isError` 를
 * **독립으로 세팅**하는 목으로 바꾼다 — 이는 `ManualPlanPage` 가 `itinerary.isPending` 을 **읽는다**는 훅
 * 계약이기도 하다.
 *
 * 3동작 뼈대: 준비=목(GET 상태·mutate·router) → 실행=페이지 렌더 → 단언=나간 POST·보이는 표면.
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙, GeneratingPage 선례).
let mockGet: {
  data: Itinerary | undefined;
  isPending: boolean;
  isError: boolean;
};

const mockMutate = jest.fn();
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
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
  }),
  router: { push: mockPush, replace: mockReplace, back: mockBack },
}));

const TRIP_ID = 't1';

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
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
});

describe('🔴 G-a1 · AC-a1 — 기존 초안이 있으면 덮어쓰기 POST 0건, 슬롯 보존', () => {
  it('기존 일정(days>0)이 있으면 mutate 는 0회이고 기존 슬롯이 화면에 남는다', () => {
    // 준비 — GET 이 정착해 기존 AI 초안(슬롯 있음)을 돌려준다.
    mockGet = { data: EXISTING_DRAFT, isPending: false, isError: false };

    // 실행 — h19(직접 고르기)에 진입.
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언 ① (금지) — 빈 MANUAL 생성 POST 가 나가지 않는다(보존).
    expect(mockMutate).toHaveBeenCalledTimes(0);

    // 단언 ② (짝·긍정) — 기존 초안이 실제로 화면에 남는다(공허 통과 방지).
    expect(screen.getByTestId('itinerary-manual-root')).toBeOnTheScreen();
    expect(screen.getByText('경복궁')).toBeOnTheScreen();
  });
});

describe('🔴 G-a2 · AC-a2 — GET 로딩 중이면 POST 보류(fail-safe, 유일 방어선)', () => {
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

describe('🟢 I2 · TRIP-338 AC-2 — (MANUAL, MINIMAL, false) 에 폴백·실패 배너가 없다 (INV-4)', () => {
  it('루트가 뜨고(짝) 폴백 배너 testID 는 어느 것도 없다', () => {
    // MANUAL_EMPTY 는 days.length===1 이라 가드 a 는 "기존"으로 보고 POST 안 함(I2 는 mutate 미단언).
    mockGet = { data: MANUAL_EMPTY, isPending: false, isError: false };
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 루트 존재 짝(★) — 화면이 그 픽스처로 실제 렌더됐다(오타 testID 로 공허 통과 방지).
    expect(screen.getByTestId('itinerary-manual-root')).toBeOnTheScreen();

    // 폴백/실패 배너는 어느 계약으로도 안 뜬다 — MANUAL 은 실패가 아니라 선택이다(§8①).
    [
      'itinerary-manual-fallback-banner',
      'itinerary-draft-fallback-banner',
    ].forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
  });
});
