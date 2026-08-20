import { render, screen, waitFor } from '@testing-library/react-native';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-462 · h09 GeneratingPage 를 **copick 씨앗**으로 재사용하는 심판(01b Q1 안 B).
 *
 * 무엇을 보장하나:
 *  - 🔴 mode='CO_PLAN' 씨앗이면 마운트 시 POST 가 `{ generationMode:'CO_PLAN' }` 하나로 1회 나간다
 *    (여분 키 0, BR-U3-03). FULLY_AI 하드코딩이 남아 있으면 red.
 *  - 🔴 201(성공)이면 draft(h11)가 아니라 **copick 허브(h16)로 replace** 한다 — successRoute 주입 존중.
 *    successRoute 를 무시하고 draft 로 새면 red.
 *
 * ⚠️ 기본값(mode·successRoute 미지정)의 full-AI 경로(AC-4b 무회귀)는 이 파일이 아니라 **동결
 *    `GeneratingPage.integration.test.tsx`(I1·I2)** 가 잠근다 — 파라미터화가 기본값을 지우거나 뒤집으면
 *    그 파일이 red(뮤테이션 앵커). 여기서 중복 작성하지 않는다(ponytail).
 *
 * ⚠️ POST "정확히 1회"는 `toHaveBeenCalledTimes(1)` 로 잰다 — 단, 목이 컴포넌트를 pending→settled 로
 *    재렌더시키지 않아 **firedRef 제거 자체는 이 층에서 못 잡는다**(h09 무심판 #1, repo-traps 계열).
 *    실 react-query 재렌더의 이중 POST(=일정 2개)는 6-b 실기 몫이다. 여기 1회 단언은 "렌더 중/effect
 *    이중 호출"만 막는 것이며 full-AI 경로와 같은 사각을 공유한다.
 *
 * 3동작 뼈대: 준비 = 목 세팅 → 실행 = mode=CO_PLAN 으로 렌더 → 단언 = 나간 mutate·replace 목적지.
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙, GeneratingPage.integration.test.tsx 동형).
let mockPhase: 'pending' | 'success' | 'error' = 'pending';

const mockMutate = jest.fn(
  (
    _variables: unknown,
    options?: {
      onSuccess?: () => void;
      onError?: () => void;
      onSettled?: () => void;
    }
  ) => {
    if (mockPhase === 'success') {
      options?.onSuccess?.();
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
const COPICK_HUB = '/trips/[tripId]/itinerary/copick' as const;

beforeEach(() => {
  mockPhase = 'pending';
  mockMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockNavigate.mockClear();
});

describe('🔴 CO_PLAN 씨앗 — 마운트 시 CO_PLAN POST 1회 (AC-4)', () => {
  it('POST 가 { generationMode: "CO_PLAN" } 하나로 정확히 1회 나가고 아직 이동하지 않는다', () => {
    mockPhase = 'pending';
    render(
      <GeneratingPage
        tripId={TRIP_ID}
        mode="CO_PLAN"
        successRoute={COPICK_HUB}
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
    // toEqual = 정확 일치 — 여분 키 0(BR-U3-03) + FULLY_AI 하드코딩이면 red.
    expect(vars.data).toEqual({ generationMode: 'CO_PLAN' });

    // 아직 도는 중이라 어디로도 안 갔다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 CO_PLAN 씨앗 — 성공이면 copick 허브(h16)로 replace (AC-4)', () => {
  it('201 성공 시 draft 가 아니라 copick 허브로 replace 하고(push 아님) tripId 를 싣는다', async () => {
    mockPhase = 'success';
    render(
      <GeneratingPage
        tripId={TRIP_ID}
        mode="CO_PLAN"
        successRoute={COPICK_HUB}
      />
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    // 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다.
    const destination = mockReplace.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    // 씨앗 완료 = copick 허브. successRoute 를 무시하고 draft(h11)로 새면 두 단언이 함께 red.
    expect(asText).toContain('copick');
    expect(asText).not.toContain('draft');
    expect(asText).toContain(TRIP_ID);

    // 뒤로 못 돌아오게 replace 여야 한다 — push 로 가면 back 이 생성 화면으로 되돌아온다.
    expect(mockPush).not.toHaveBeenCalled();
  });
});
