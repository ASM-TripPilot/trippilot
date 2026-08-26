import { fireEvent, render, screen } from '@testing-library/react-native';

import { useReplanFormStore } from '@/features/planb/model/replanFormStore';

import { PlanbRequestPage } from './PlanbRequestPage';

/**
 * TRIP-439 · AC-1·2·3·4 — i10 배선을 **폼→조립→POST/분기**로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 [AI가 다시 짜기] 제출 시 store 선택값이 `replanRequest` 를 타 조립되어 그 body 로 POST 가
 *    나가고(originKind:null 포함), 성공하면 solving 흐름으로 push 한다(AC-1).
 *  - 🔴 [직접 고르기]는 **API 오류가 아니어도** manual 로 push 하고 **POST 가 0건**이다(AC-2 · BR-U4-16).
 *  - 🔴 아무것도 안 골라도 제출된다(빈 배열·freeText null, AC-3).
 *  - 🔴 outOfScope 면 안내를 **표시만** 하고 CTA 가 비활성이며 **눌러도 POST 0**(AC-4 · ★4 짝잠금).
 *
 * 왜 통합 버킷 · 목 seam 인가: 바텀시트 목(★1)이 children 을 통과 렌더해 시트 안 칩·CTA 를 실제로
 * 누를 수 있다 — 시트 열림은 못 보지만 "제출→나간 body / 이동 / 미이동"은 잰다. POST 는 페이지가
 * 소비하는 `useStartReplan` seam 을 목해 계수한다(GeneratingPage 선례 동형, msw·provider 불요).
 *
 * jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
 * 변수만 예외다(리포 확립 규칙).
 */

let mockPhase: 'idle' | 'success' = 'idle';

const mockMutate = jest.fn(
  (_variables: unknown, options?: { onSuccess?: () => void }) => {
    // 성공 케이스만 성공 콜백을 태운다(항법 확인용). idle 은 in-flight 로 둔다.
    if (mockPhase === 'success') options?.onSuccess?.();
  }
);

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();

// 페이지가 소비하는 얇은 래퍼 seam 을 목한다(그 아래 codegen POST 는 계약 테스트 몫).
jest.mock('@/features/planb/model/useStartReplan', () => ({
  useStartReplan: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
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

beforeEach(() => {
  mockPhase = 'idle';
  mockMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockNavigate.mockClear();
  // store 는 모듈 싱글턴 — 이전 케이스의 칩 선택이 새지 않게 초기화한다(★8).
  useReplanFormStore.getState().reset();
});

/** 모든 forward nav 의 목적지를 직렬화해 모은다 — 형태(문자열/객체)를 강요하지 않고 "어디로 갔나"만 본다. */
function forwardDestinations(): string[] {
  return [mockPush, mockReplace, mockNavigate]
    .flatMap((fn) => fn.mock.calls)
    .map((call) =>
      typeof call[0] === 'string' ? call[0] : JSON.stringify(call[0])
    );
}

describe('🔴 I1 · AC-1 — 제출하면 조립된 body 로 POST + solving push', () => {
  it('선택값이 originKind:null 과 함께 POST 되고 성공 시 solving 으로 간다', () => {
    mockPhase = 'success';
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    // 실행 — 사유 1개 + 자유텍스트 + 제출.
    fireEvent.press(screen.getByTestId('planb-request-reason-WEATHER'));
    fireEvent.changeText(
      screen.getByTestId('planb-request-freetext'),
      '광안리 야경'
    );
    fireEvent.press(screen.getByTestId('planb-request-submit'));

    // POST 가 조립된 body 로 1회 나간다.
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data: unknown;
    };
    expect(vars.tripId).toBe(TRIP_ID);
    expect(vars.data).toEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: null,
      reasons: ['WEATHER'],
      directives: [],
      freeText: '광안리 야경',
      excludedPoiIds: [],
      triggerId: null,
    });

    // 성공하면 solving 흐름으로 이동(목적지 형태 불강요, tripId 동반).
    const destinations = forwardDestinations();
    expect(destinations.some((d) => d.includes('solving'))).toBe(true);
    expect(destinations.some((d) => d.includes(TRIP_ID))).toBe(true);
  });
});

describe('🔴 I2 · AC-2 — [직접 고르기]는 push 만·POST 0 (BR-U4-16)', () => {
  it('세션을 안 열고 manual 로만 이동한다', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-manual'));

    // 세션을 안 연다(POST 0).
    expect(mockMutate).not.toHaveBeenCalled();
    // manual 로 이동했다.
    expect(forwardDestinations().some((d) => d.includes('manual'))).toBe(true);
  });
});

describe('🔴 I3 · AC-3 — 미선택 제출도 나간다 (BR-U4-12)', () => {
  it('빈 배열·freeText null 로 조립되어 POST 된다', () => {
    mockPhase = 'success';
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-submit'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as { data: unknown };
    expect(vars.data).toEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: null,
      reasons: [],
      directives: [],
      freeText: null,
      excludedPoiIds: [],
      triggerId: null,
    });
  });
});

describe('🔴 I4 · AC-4 — OutOfScope 표시만 + 제출잠금 (BR-U4-14 · ★4)', () => {
  it('안내가 뜨고 CTA 가 비활성이며 눌러도 POST 0 · 이동 0', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} outOfScope />);

    // ① 인라인 안내가 표시만 된다.
    expect(screen.getByTestId('planb-request-out-of-scope')).toBeOnTheScreen();

    // ② 비활성 — 단독으로는 "회색인데 눌리는" 가짜 비활성을 통과시키므로(★4) ③과 짝을 이룬다.
    const cta = screen.getByTestId('planb-request-submit');
    expect(cta).toBeDisabled();

    // ③ ★ 핵심 — 눌러도 POST 가 한 건도 안 나가고 어디로도 안 간다.
    fireEvent.press(cta);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });
});
