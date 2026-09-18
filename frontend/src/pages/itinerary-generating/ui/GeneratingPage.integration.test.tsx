import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-305 · h09 배선을 **실제 페이지→화면**으로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 마운트 시 생성 POST 를 **1회** 쏜다(`{ generationMode:'FULLY_AI' }` 하나뿐, 여분 키 0).
 *  - 🔴 201(성공)이면 draft 로 **`router.replace` 1회**(뒤로가면 생성 화면으로 안 돌아온다).
 *  - 🔴 오류면 실패 표면을 띄우고(침묵 금지·INV-4) draft 로 안 가며, [다시 시도]가 POST 를 재발화한다.
 *  - 🔴 [취소]는 **뒤로 이탈**하고 draft 로 안 가며 **세션 cancel 을 안 쏜다**(sessionId 부재, Seed 결정 3).
 *  - 🔴 [백그라운드로]는 **앞으로 이탈**(여행/홈)하되 뒤로가기가 아니고 세션 cancel 도 안 쏜다.
 *
 * ⚠️ **취소는 "중단"이 아니다.** orval `customInstance` 는 `signal` 을 안 받고(02a §5-5) react-query
 * mutationFn 도 AbortSignal 을 안 줘 in-flight POST 를 진짜로 끊을 길이 없다 — 구현은 `mutation.reset()`
 * +이탈이고 서버는 일정을 만들 수 있다(⚑D). 그래서 I4 는 **관측 가능한 폐기**(이탈+미전진+서버 cancel 0)만
 * 잰다.
 *
 * ⚠️ **[취소]=뒤로 · [백그라운드로]=여행/홈 forward** 는 ⚑A/Seed 기본값이다(게이트① 종속). cancel↔background
 * 구별의 급소는 `mockBack` 호출 여부.
 *
 * 3동작 뼈대: 준비 = `mockPhase`·목 세팅 → 실행 = 페이지 렌더/버튼 press → 단언 = 나간 mutate·불린 router.
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙). 이 이름들을 바꾸지 마라.
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
    // 목이 배선의 콜백을 phase 에 맞춰 태운다 — pending 은 어떤 콜백도 안 부른다(in-flight 유지).
    // success/error 만 결과 콜백 + onSettled 를 부른다("아직 도는데 정산됨"의 거짓 방지, 02a ★7).
    if (mockPhase === 'success') {
      options?.onSuccess?.();
      options?.onSettled?.();
    } else if (mockPhase === 'error') {
      options?.onError?.();
      options?.onSettled?.();
    }
  }
);
/** 세션 cancel(서버 취소) — h09 는 안 써야 한다. 목에 심어 두고 "0 호출"을 잰다(02a ★8). */
const mockCancelMutate = jest.fn();

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
    mutate: mockCancelMutate,
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

beforeEach(() => {
  mockPhase = 'pending';
  mockMutate.mockClear();
  mockCancelMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockNavigate.mockClear();
});

function renderPage() {
  return render(<GeneratingPage tripId={TRIP_ID} />);
}

/** 모든 forward nav(push/replace/navigate)의 목적지를 직렬화해 모은다 — 형태(문자열/객체)를
 * 강요하지 않고 "어디로 갔나"만 본다(02a ★4). */
function forwardDestinations(): string[] {
  return [mockPush, mockReplace, mockNavigate]
    .flatMap((fn) => fn.mock.calls)
    .map((call) =>
      typeof call[0] === 'string' ? call[0] : JSON.stringify(call[0])
    );
}

describe('🔴 I1 · AC-1 — pending 이면 진행 표면 + 마운트 POST 1회', () => {
  it('진행 표면이 뜨고 POST 가 generationMode 하나로 1회 나가며 draft 로 안 간다', () => {
    mockPhase = 'pending';
    renderPage();

    // 진행 표면이 실제로 그려진다.
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // POST 는 마운트 시 정확히 1회, tripId 와 mode 하나만 담아 나간다.
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: unknown;
    };
    expect(vars.tripId).toBe(TRIP_ID);
    // toEqual = 정확 일치 — deadlineMs 등 여분 키 0 을 잠근다(BR-U3-03).
    expect(vars.data).toEqual({ generationMode: 'FULLY_AI' });

    // 아직 도는 중이라 draft 로 안 갔다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 I2 · AC-5 — 201 성공이면 draft 로 replace 가 1회', () => {
  it('성공 시 draft 라우트로 replace 하고(push 아님) tripId 를 싣는다', async () => {
    mockPhase = 'success';
    renderPage();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    // 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다(02a ★4).
    const destination = mockReplace.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('/itinerary/draft');
    expect(asText).toContain(TRIP_ID);

    // 뒤로 못 돌아오게 replace 여야 한다 — push 로 가면 back 이 생성 화면으로 되돌아온다.
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 I3 · AC-6 — 오류면 실패 표면 + 재시도가 POST 를 다시 쏜다 (INV-4)', () => {
  it('실패 표면이 뜨고 draft 로 안 가며, [다시 시도]가 POST 를 재발화한다', () => {
    mockPhase = 'error';
    renderPage();

    // 침묵하지 않는다 — 실패 표면이 실제로 그려진다.
    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();
    // 실패했으니 draft 로 안 갔다.
    expect(mockReplace).not.toHaveBeenCalled();

    // 재시도 — 존재 확인이 아니라 실제 press 로 POST 재발화를 증명한다(02a ★5).
    const before = mockMutate.mock.calls.length;
    fireEvent.press(screen.getByTestId('itinerary-generating-retry'));
    expect(mockMutate.mock.calls.length).toBe(before + 1);
  });
});

describe('🔴 I4 · AC-3 — [취소]는 뒤로 이탈 · 결과 미반영 · 세션 cancel 미호출', () => {
  it('[취소] press → 뒤로 가고 draft 로 안 가며 서버 취소를 안 쏜다', () => {
    mockPhase = 'pending';
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-generating-cancel'));

    // 뒤로 이탈(생성 폐기).
    expect(mockBack).toHaveBeenCalledTimes(1);
    // 결과 미반영 — 앞으로(draft)로 전진하지 않았다.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(forwardDestinations().some((d) => d.includes('draft'))).toBe(false);
    // sessionId 가 없어 서버 cancel 은 애초에 못/안 쏜다(Seed 결정 3).
    expect(mockCancelMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 I5 · AC-4 — [백그라운드로]는 앞으로 이탈 · 뒤로 아님 · 세션 cancel 미호출', () => {
  it('[백그라운드로] press → 여행/홈으로 이동(draft·generating 아님)하고 뒤로가기가 아니다', () => {
    mockPhase = 'pending';
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-generating-background'));

    // 뒤로가기가 아니다 — 이게 [취소]와 구별되는 급소다.
    expect(mockBack).not.toHaveBeenCalled();

    // 앞으로 이탈이 실제로 일어났고(뮤테이션은 살린 채 화면만 이탈), 그 목적지가
    // draft 도 generating 자기 자신도 아니다(⚑A 기본 = 여행/홈).
    const destinations = forwardDestinations();
    expect(destinations.length).toBeGreaterThanOrEqual(1);
    expect(destinations.some((d) => d.includes('draft'))).toBe(false);
    expect(destinations.some((d) => d.includes('generating'))).toBe(false);

    // 서버 오퍼레이션 없음(openapi 767) — 취소를 안 쏜다.
    expect(mockCancelMutate).not.toHaveBeenCalled();
  });
});
