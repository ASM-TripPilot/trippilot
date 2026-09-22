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
 *  - 🔴 앱바 뒤로 셰브론이 **백그라운드 이탈**(여행/홈 forward)이지 뒤로가기(router.back)·세션 cancel 이 아니다.
 *
 * ⚠️ **TRIP-789 정합**: footer·[생성 취소]·[백그라운드로 전환] 2버튼이 제거되고 앱바 뒤로 셰브론이
 * onBackground(백그라운드 이탈)를 흡수한다(Q2). 옛 [취소](reset+router.back)는 소멸했다 — 그래서
 * 옛 I4([취소])·I5([백그라운드 버튼])는 앱바 뒤로 하나로 합쳐 다시 쓴다(제거된 testID 를 누르는 형제
 * 테스트를 방치하면 엉뚱한 red — 02a ★2). in-flight POST 는 여전히 진짜로 못 끊는다(orval customInstance
 * 가 signal 을 안 받음 ⚑D) — 이탈해도 서버는 일정을 만들 수 있다. I4 는 **관측 가능한 이탈**(forward+
 * 미전진+서버 cancel 0)만 잰다.
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

describe('🔴 I4 · AC-4 — 앱바 뒤로 = 백그라운드 이탈 (취소 개념 소멸)', () => {
  it('앱바 뒤로 press → 앞으로 이탈(여행/홈, draft·generating 아님)하고 뒤로가기·세션 cancel 이 아니다', () => {
    mockPhase = 'pending';
    renderPage();

    // TRIP-789: footer·[취소]·[백그라운드로] 2버튼 제거 후 유일한 이탈구는 앱바 뒤로 셰브론이다(Q2).
    fireEvent.press(screen.getByTestId('itinerary-generating-back'));

    // 뒤로가기(router.back)가 아니다 — 옛 [취소](reset+back)가 사라졌음을 잠근다(급소).
    expect(mockBack).not.toHaveBeenCalled();

    // 앞으로 이탈이 실제로 일어났고(뮤테이션은 살린 채 화면만 이탈), 그 목적지가
    // draft 도 generating 자기 자신도 아니다(⚑A 기본 = 여행/홈).
    const destinations = forwardDestinations();
    expect(destinations.length).toBeGreaterThanOrEqual(1);
    expect(destinations.some((d) => d.includes('draft'))).toBe(false);
    expect(destinations.some((d) => d.includes('generating'))).toBe(false);
    // 유일 이탈구가 됐으므로 목적지를 정확일치로 잠근다(5-b 참고-1) — 일정 탭이어야 한다.
    // (`/(tabs)/itinerary` 는 trips[0] 리다이렉트가 있지만 백그라운드 복귀의 정본 목적지다.)
    expect(destinations).toContain('/(tabs)/itinerary');

    // 서버 오퍼레이션 없음(openapi 767) — 취소를 안 쏜다.
    expect(mockCancelMutate).not.toHaveBeenCalled();
  });
});
