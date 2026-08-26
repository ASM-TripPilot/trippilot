import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlanbDiffPage } from './PlanbDiffPage';

/**
 * TRIP-441 · AC-1·2·3·4 — planb-diff 배선을 **확정/취소/성공전이/실패/pending** 으로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 [확정] press → useApplyReplan 이 `{tripId,sessionId}` 로 mutate 1회(AC-1 · BR-U4-28).
 *  - 🔴 apply isSuccess → i19 얼굴(`새 일정이 반영됐어요`+[여행 계속하기]), [계속하기]→/trips/{id}/live(AC-2).
 *  - 🔴 [취소] → useCancelReplan `{tripId,sessionId}` mutate + 성공 시 live 복귀(AC-4 · BR-U4-28).
 *  - 🔴 apply/cancel 실패 → 단일 StateNotice error(`원래 일정은 그대로`) + i19 안 넘어감(AC-4 · BR-U4-32 · INV-4).
 *  - 🔴 apply/cancel pending → 해당 버튼 disabled + 눌러도 mutate 0(AC-3 · D3 · ★짝잠금).
 *
 * 왜 통합 버킷·seam 목인가: 페이지가 소비하는 얇은 래퍼(useApplyReplan/useCancelReplan)를 목해
 * "무엇을 부르고 어디로 가는가"만 잰다 — 그 아래 codegen POST·react-query 무효화는 계약/구조가드
 * 몫이다(무효화 correctness 는 T1 소스 스캔, 실전이·체크 픽셀은 6-b). 성공 얼굴은 목이 `isSuccess`
 * 를 **처음부터** true 로 세워 관측할 뿐, pending→settled 재렌더 전이는 목이 원리적으로 못 본다
 * (맹점②, GeneratingPage 계열).
 *
 * ★ jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
 *   변수만 예외다(리포 확립 규칙). 목 훅은 `mockApplyPhase`/`mockCancelPhase` 를 **렌더 시점**에
 *   읽어 flag 를 낸다 → render 전에 phase 를 세팅해야 그 얼굴이 뜬다.
 */

type Phase = 'idle' | 'pending' | 'success' | 'error';

let mockApplyPhase: Phase = 'idle';
let mockCancelPhase: Phase = 'idle';

// apply 는 성공 시 항법하지 않는다(조건부 렌더로 관측, D1) — 호출만 계수한다.
const mockApplyMutate = jest.fn();
// cancel 은 성공 시 페이지가 onSuccess(→live)를 건다 — success 국면에서만 그 콜백을 태운다.
const mockCancelMutate = jest.fn(
  (_variables: unknown, options?: { onSuccess?: () => void }) => {
    if (mockCancelPhase === 'success') options?.onSuccess?.();
  }
);

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@/features/planb/model/useApplyReplan', () => ({
  useApplyReplan: () => ({
    mutate: mockApplyMutate,
    isPending: mockApplyPhase === 'pending',
    isError: mockApplyPhase === 'error',
    isSuccess: mockApplyPhase === 'success',
  }),
}));

jest.mock('@/features/planb/model/useCancelReplan', () => ({
  useCancelReplan: () => ({
    mutate: mockCancelMutate,
    isPending: mockCancelPhase === 'pending',
    isError: mockCancelPhase === 'error',
    isSuccess: mockCancelPhase === 'success',
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    navigate: mockNavigate,
  }),
  router: {
    push: mockPush,
    replace: mockReplace,
    navigate: mockNavigate,
  },
}));

const TRIP_ID = 't1';
const SESSION_ID = 's1';

beforeEach(() => {
  mockApplyPhase = 'idle';
  mockCancelPhase = 'idle';
  mockApplyMutate.mockClear();
  mockCancelMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockNavigate.mockClear();
});

/** forward nav 의 목적지를 직렬화해 모은다 — 형태(문자열/객체)를 강요하지 않고 "어디로 갔나"만 본다. */
function forwardDestinations(): string[] {
  return [mockPush, mockReplace, mockNavigate]
    .flatMap((fn) => fn.mock.calls)
    .map((call) =>
      typeof call[0] === 'string' ? call[0] : JSON.stringify(call[0])
    );
}

function renderPage() {
  return render(<PlanbDiffPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

describe('🔴 I1 · AC-1 — [확정]은 useApplyReplan 을 {tripId,sessionId} 로 부른다', () => {
  it('confirm press 로 apply mutate 가 1회 나간다(일정 쓰기 유일 지점)', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('planb-diff-confirm'));

    expect(mockApplyMutate).toHaveBeenCalledTimes(1);
    expect(mockApplyMutate.mock.calls[0][0]).toEqual({
      tripId: TRIP_ID,
      sessionId: SESSION_ID,
    });
  });
});

describe('🔴 I2 · AC-2 — apply isSuccess 면 i19 얼굴이 뜬다', () => {
  it('반영 완료 문구·[여행 계속하기]가 뜨고 pre-apply 얼굴이 아니다', () => {
    mockApplyPhase = 'success';
    renderPage();

    // i19 얼굴(실 ReplanAppliedScreen 렌더).
    expect(screen.getByText('새 일정이 반영됐어요')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-applied-continue')).toBeOnTheScreen();
    // 짝(부정) — 확정 전 얼굴로 남지 않았다.
    expect(screen.queryByTestId('planb-diff-confirm')).toBeNull();
  });
});

describe('🔴 I3 · AC-2 배선 — [여행 계속하기] → /trips/{tripId}/live', () => {
  it('i19 에서 계속하기 press 시 live 로 이동한다', () => {
    mockApplyPhase = 'success';
    renderPage();

    fireEvent.press(screen.getByTestId('planb-applied-continue'));

    const destinations = forwardDestinations();
    expect(destinations.some((d) => d.includes('live'))).toBe(true);
    expect(destinations.some((d) => d.includes(TRIP_ID))).toBe(true);
  });
});

describe('🔴 I4 · AC-4 — [취소]는 useCancelReplan 을 부르고 성공 시 live 로 복귀', () => {
  it('cancel mutate 가 {tripId,sessionId} 로 1회 + live 로 이동(원 일정 불변)', () => {
    mockCancelPhase = 'success';
    renderPage();

    fireEvent.press(screen.getByTestId('planb-diff-cancel'));

    expect(mockCancelMutate).toHaveBeenCalledTimes(1);
    expect(mockCancelMutate.mock.calls[0][0]).toEqual({
      tripId: TRIP_ID,
      sessionId: SESSION_ID,
    });
    const destinations = forwardDestinations();
    expect(destinations.some((d) => d.includes('live'))).toBe(true);
    expect(destinations.some((d) => d.includes(TRIP_ID))).toBe(true);
  });
});

describe('🔴 I5 · AC-4 — apply 실패는 StateNotice error + 원 일정 유지', () => {
  it('오류 안내가 뜨고 i19 로 안 넘어가며 [다시 시도]가 apply 를 재발화한다', () => {
    mockApplyPhase = 'error';
    renderPage();

    // 오류 표면 + 정직한 "원 일정 그대로" 문구(부분·정규식).
    expect(screen.getByTestId('planb-diff-error')).toBeOnTheScreen();
    expect(screen.getByText(/원래 일정은 그대로/)).toBeOnTheScreen();
    // 짝(부정) — 실패했으므로 i19(성공)로 넘어가지 않았다(부분 반영 금지, BR-U4-32).
    expect(screen.queryByText('새 일정이 반영됐어요')).toBeNull();

    // 침묵하지 않고 회복 가능하다(INV-4) — 재시도가 apply 를 다시 부른다.
    fireEvent.press(screen.getByTestId('planb-diff-retry'));
    expect(mockApplyMutate).toHaveBeenCalledTimes(1);
    expect(mockApplyMutate.mock.calls[0][0]).toEqual({
      tripId: TRIP_ID,
      sessionId: SESSION_ID,
    });
  });
});

describe('🔴 I6 · AC-4 — cancel 실패도 공용 StateNotice error 를 띄운다(대칭)', () => {
  it('오류 표면이 뜨고 i19 로 안 넘어간다', () => {
    mockCancelPhase = 'error';
    renderPage();

    expect(screen.getByTestId('planb-diff-error')).toBeOnTheScreen();
    // 짝(부정) — 취소 실패는 성공 얼굴이 아니다.
    expect(screen.queryByText('새 일정이 반영됐어요')).toBeNull();
  });
});

describe('🔴 I7 · AC-3 — apply pending 이면 [확정] disabled + 눌러도 무동작', () => {
  it('회색이면서 실제로도 안 눌린다(가짜 비활성 방지 · 중복 쓰기 차단)', () => {
    mockApplyPhase = 'pending';
    renderPage();

    const confirm = screen.getByTestId('planb-diff-confirm');
    expect(confirm).toBeDisabled();

    fireEvent.press(confirm);
    expect(mockApplyMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 I8 · AC-3 — cancel pending 이면 [취소] disabled + 눌러도 무동작', () => {
  it('취소도 대칭으로 잠긴다(D5)', () => {
    mockCancelPhase = 'pending';
    renderPage();

    const cancel = screen.getByTestId('planb-diff-cancel');
    expect(cancel).toBeDisabled();

    fireEvent.press(cancel);
    expect(mockCancelMutate).not.toHaveBeenCalled();
  });
});
