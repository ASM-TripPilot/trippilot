import { render, screen, waitFor } from '@testing-library/react-native';

import type { Itinerary } from '@/shared/api/generated/schemas';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-462 → **TRIP-504 재작성**(462 동결분 개봉 — 새 사이클이라 정당, 안 (가) 흐름 확정).
 *
 * 무엇이 바뀌었나: h09 CO_PLAN 씨앗의 **완료 목적지**가 h16 허브(`copick`)에서 **첫 비고정 슬롯의
 * SlotFillPage(`copick/[slotKey]`)**로 바뀌었다(01b 순회 세부·AC-6). 허브를 버리고 h13→h14 선형
 * 순회로 대체하므로, 생성이 끝나면 곧장 첫 슬롯 채우기로 착지한다.
 *
 * 무엇을 보장하나:
 *  - 🔴 GC-1(선제green·무회귀): mode='CO_PLAN' 씨앗이면 마운트 시 POST 가 `{generationMode:'CO_PLAN'}`
 *    하나로 정확히 1회 나간다(여분 키 0, BR-U3-03). 이 배선은 462에서 이미 있어 green 유지.
 *  - 🔴 GC-2: 201(성공) 응답의 days 에서 **첫 비고정 슬롯**을 골라 그 SlotFillPage 로 replace 한다.
 *    허브(slotKey 없음)로 새거나, 첫 슬롯이 아닌 고정 슬롯(#hotel)을 고르면 red(목적지 값째 잠금).
 *
 * ⚠️ 목적지가 judge blind-spot 이다(462 gate②-2 실측). mode 만 맞고 목적지가 틀리면 사용자가 엉뚱한
 *    화면에 착지한다. 그래서 목적지 문자열에 **첫 슬롯 slotKey 값**(`2026-06-10#a`)이 실제로 들어
 *    있는지를 `.toContain` 으로 잰다 — 허브·고정슬롯과 갈라지는 급소.
 *
 * ⚠️ mock 이 `onSuccess` 에 **일정(days)을 실어** 넘긴다(462 는 무인자였다). `postTripsTripIdItinerary`
 *    가 생성된 `Itinerary` 를 그대로 반환하므로(customInstance<Itinerary>), 배선은 그 응답의 days 로
 *    첫 슬롯을 계산한다 — 별도 GET 불요. 이 데이터 배선이 없으면 AC-6 은 원리적으로 검증 불가.
 *
 * ⚠️ 기본값(mode·successRoute 미지정)의 full-AI 경로 무회귀는 이 파일이 아니라 동결
 *    `GeneratingPage.integration.test.tsx`(I1·I2)가 잠근다(ponytail, 중복 작성 금지).
 *
 * 3동작 뼈대: 준비 = 목 세팅(성공 응답 days) → 실행 = mode=CO_PLAN 으로 렌더 → 단언 = mutate·replace 목적지.
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙, GeneratingPage.integration.test.tsx 동형).
let mockPhase: 'pending' | 'success' | 'error' = 'pending';

/** 성공 응답으로 돌려줄 CO_PLAN 골격. 첫 비고정 슬롯 = 2026-06-10#a(앞에 고정 hotel 이 있어,
 * 배선이 `slots[0]` 을 맹목적으로 쓰면 #hotel 을 골라 GC-2 가 red 로 잡는다). */
const mockItinerary: Itinerary = {
  itineraryId: 'itin-coplan',
  tripId: 't1',
  status: 'PLANNED',
  solveMode: 'FULL_AI',
  generationMode: 'CO_PLAN',
  generationState: 'PARTIAL',
  isFallback: false,
  days: [
    {
      date: '2026-06-10',
      slots: [
        {
          poiId: 'hotel',
          startAt: '00:00:00',
          endAt: '00:00:00',
          isFixed: true,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
        {
          poiId: 'a',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
        {
          poiId: 'b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
  ],
};

const mockMutate = jest.fn(
  (
    _variables: unknown,
    options?: {
      onSuccess?: (data: Itinerary) => void;
      onError?: () => void;
      onSettled?: () => void;
    }
  ) => {
    if (mockPhase === 'success') {
      options?.onSuccess?.(mockItinerary);
      options?.onSettled?.();
    } else if (mockPhase === 'error') {
      options?.onError?.();
      options?.onSettled?.();
    }
  }
);

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: mockPhase === 'pending',
    isError: mockPhase === 'error',
  }),
  usePostTripsTripIdGenerationSessionsSessionIdCancel: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    navigate: mockNavigate,
  }),
  router: {
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    navigate: mockNavigate,
  },
}));

const TRIP_ID = 't1';
/** h05 가 실어 보내는 successRoute — 첫 슬롯 라우트 템플릿. slotKey 는 h09 가 채운다(01b 순회 세부). */
const COPICK_SLOT_ROUTE = '/trips/[tripId]/itinerary/copick/[slotKey]' as const;
/** 첫 비고정 슬롯의 키(고정 hotel 건너뜀) — 목적지에 이 값이 있어야 첫 슬롯으로 갔다는 뜻. */
const FIRST_SLOT_KEY = '2026-06-10#a';

beforeEach(() => {
  mockPhase = 'pending';
  mockMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockNavigate.mockClear();
});

describe('GC-1 · CO_PLAN 씨앗 — 마운트 시 CO_PLAN POST 1회 (선제green·무회귀)', () => {
  it('POST 가 { generationMode: "CO_PLAN" } 하나로 정확히 1회 나가고 아직 이동하지 않는다', () => {
    mockPhase = 'pending';
    render(
      <GeneratingPage
        tripId={TRIP_ID}
        mode="CO_PLAN"
        successRoute={COPICK_SLOT_ROUTE}
      />
    );

    // 진행 표면이 실제로 그려진다(full-AI 씨앗과 같은 h09 화면 재사용).
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // POST 는 마운트 시 정확히 1회, tripId 와 CO_PLAN 하나만 담아 나간다.
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: unknown;
    };
    expect(vars.tripId).toBe(TRIP_ID);
    // toEqual = 재귀 정확 일치 — 여분 키 0(BR-U3-03) + FULLY_AI 하드코딩이면 red.
    expect(vars.data).toEqual({ generationMode: 'CO_PLAN' });

    // 아직 도는 중이라 어디로도 안 갔다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 GC-2 · CO_PLAN 완료 — 첫 비고정 슬롯 SlotFillPage 로 replace (AC-6)', () => {
  it('201 성공 시 허브가 아니라 첫 비고정 슬롯(2026-06-10#a)으로 replace 하고(push 아님) tripId 를 싣는다', async () => {
    mockPhase = 'success';
    render(
      <GeneratingPage
        tripId={TRIP_ID}
        mode="CO_PLAN"
        successRoute={COPICK_SLOT_ROUTE}
      />
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    // 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다.
    const destination = mockReplace.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);

    // copick 영역이다.
    expect(asText).toContain('copick');
    // ★ 첫 비고정 슬롯의 slotKey 값이 실제로 목적지에 있어야 한다 — 허브(slotKey 없음)로 새거나
    //   고정 hotel(#hotel)을 고르면 이 단언이 red. AC-6 의 급소(목적지 값째 잠금).
    expect(asText).toContain(FIRST_SLOT_KEY);
    // ★ CO_PLAN 이 완전AI 초안(draft/h11)으로 새지 않는다(462 회귀 앵커 계승).
    expect(asText).not.toContain('draft');
    expect(asText).toContain(TRIP_ID);

    // 뒤로 못 돌아오게 replace 여야 한다 — push 로 가면 back 이 생성 화면으로 되돌아온다.
    expect(mockPush).not.toHaveBeenCalled();
  });
});
