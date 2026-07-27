import { fireEvent, render, screen } from '@testing-library/react-native';

import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';
import { PrefStep2Page } from './PrefStep2Page';

/**
 * AC2 · AC3 · AC4 — 취향 2/2 배선(스토어 ↔ 화면 ↔ 라우터).
 *
 * 무엇을 보장하나: 1/2에서 고른 값이 2/2를 거쳐도(unmount→재마운트) 스토어 싱글턴
 * 덕분에 그대로 남고(back()으로 되돌아왔을 때도 마찬가지), '완료'·일괄 탈출 모두
 * 0개 선택에도 홈으로 replace한다(AC-done-1 · AC4).
 *
 * 3동작: 준비(스토어 선주입/reset) → 실행(마운트·언마운트·탭) → 단언(화면 반영/라우터 호출).
 */

jest.mock('expo-router', () => {
  const replace = jest.fn();
  const push = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push, back }),
    router: { replace, push, back },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  replace: jest.Mock;
  push: jest.Mock;
  back: jest.Mock;
};

beforeEach(() => {
  usePreferenceStore.getState().reset();
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
});

describe('PrefStep2Page — 복귀 시 선택값 보존 (AC2 · AC3 · 5-4)', () => {
  it('1/2에서 고른 값이 2/2를 언마운트·재마운트해도 남고, back은 router.back()을 부른다', () => {
    // 준비 — 1/2에서 이미 골랐다고 가정하고 스토어에 직접 선주입(스토어는 화면과 독립된
    // 모듈 싱글턴이라 이렇게 미리 채워도 된다 — §1 개념 박스).
    usePreferenceStore.getState().toggleStyle('rest');
    usePreferenceStore.getState().toggleFood('seafood');

    // 실행 — 렌더 후 언마운트, 다시 렌더(1/2↔2/2 왕복의 등가).
    const { unmount } = render(<PrefStep2Page />);
    unmount();
    render(<PrefStep2Page />);

    // 단언 — seafood 칩이 여전히 선택 상태(스토어가 화면 수명과 무관함을 증명).
    expect(screen.getByTestId('onboarding-pref2-food-seafood')).toBeSelected();

    // 실행 — back chevron 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-back'));

    // 단언 — router.back() 호출(1/2로 복귀 — 스토어는 그대로 살아있다).
    expect(routerMock.back).toHaveBeenCalled();
  });
});

describe('PrefStep2Page — 완료 내비게이션 (AC3 · AC-done-1 · 5-5)', () => {
  it('0개 선택에도 완료를 탭하면 홈으로 replace한다', () => {
    // 준비 — 아무 것도 고르지 않은 채 렌더.
    render(<PrefStep2Page />);

    // 실행 — CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — replace('/') (서버 미전송은 F6 6-3 구조 가드가 별도로 잠근다).
    expect(routerMock.replace).toHaveBeenCalledWith('/');
  });
});

describe('PrefStep2Page — 일괄 탈출 (AC4 · 5-6)', () => {
  it('skip-bottom을 탭하면 홈으로 replace하고, 이미 고른 styles는 그대로 남는다', () => {
    // 준비 — styles만 미리 선택된 상태.
    usePreferenceStore.getState().toggleStyle('rest');
    render(<PrefStep2Page />);

    // 실행 — 하단 skip 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-skip-bottom'));

    // 단언 — 홈으로 replace.
    expect(routerMock.replace).toHaveBeenCalledWith('/');
    // 단언 — 나머지 5축은 null 유지, styles는 그대로(01b: 고른 값 폐기 안 함 — 관찰 가능
    // 차이 없음 결정의 표면).
    const state = usePreferenceStore.getState();
    expect(state.styles).toEqual(['rest']);
    expect(state.pace).toBeNull();
    expect(state.budget).toBeNull();
    expect(state.companions).toBeNull();
    expect(state.foods).toBeNull();
    expect(state.transports).toBeNull();
  });
});

describe('PrefStep2Page — 예산 축 탭↔스토어 왕복 (AC2 · US-ONB-06 · 5-7)', () => {
  it('예산 구간을 탭하면 그 타일이 선택 표시되고 스토어 budget이 그 slug가 된다', () => {
    // 준비 — 렌더(스토어는 beforeEach가 이미 reset해서 4축 모두 null).
    render(<PrefStep2Page />);

    // 실행 — 'low' 예산 타일을 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-budget-low'));

    // 단언 ① — 읽기 경로: 스토어 값이 selectedBudget으로 내려가 화면이 다시 그려졌다.
    expect(screen.getByTestId('onboarding-pref2-budget-low')).toBeSelected();
    // 단언 ② — 쓰기 경로: 탭이 toggleBudget 액션에 연결돼 있다(budget은 단일 축이라
    // toBe로 원시값 동일성을 본다 — 배열이 아니다).
    expect(usePreferenceStore.getState().budget).toBe('low');
  });
});

describe('PrefStep2Page — 동행 축 탭↔스토어 왕복 (AC2 · US-ONB-07 · 5-8)', () => {
  it('동행 항목을 탭하면 그 타일이 선택 표시되고 스토어 companions에 담긴다', () => {
    // 준비 — 렌더.
    render(<PrefStep2Page />);

    // 실행 — '혼자' 동행 타일을 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-companion-solo'));

    // 단언 ① — 읽기 경로: 타일이 선택 표시된다.
    expect(
      screen.getByTestId('onboarding-pref2-companion-solo')
    ).toBeSelected();
    // 단언 ② — 쓰기 경로: companions는 복수 축이라 배열로 담긴다(원소 1개라 순서
    // 자유도가 없으므로 toEqual로 길이·원소·순서 전부를 고정한다).
    expect(usePreferenceStore.getState().companions).toEqual(['solo']);
  });
});

describe('PrefStep2Page — 음식 축 탭↔스토어 왕복 (AC2 · US-ONB-10 · 5-9)', () => {
  it('음식 칩을 탭하면 그 칩이 선택 표시되고 스토어 foods에 담긴다', () => {
    // 준비 — 렌더. (기존 5-4는 'seafood'를 선주입으로 쓴다 — 여기는 다른 slug
    // 'spicy'를 실제로 탭해, 이 케이스가 선주입이 아니라 쓰기 경로 증명임을 눈에 띄게 한다.)
    render(<PrefStep2Page />);

    // 실행 — '매운 음식' 칩을 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-food-spicy'));

    // 단언 ① — 읽기 경로: 칩이 선택 표시된다.
    expect(screen.getByTestId('onboarding-pref2-food-spicy')).toBeSelected();
    // 단언 ② — 쓰기 경로: foods 배열에 담긴다.
    expect(usePreferenceStore.getState().foods).toEqual(['spicy']);
  });
});

describe('PrefStep2Page — 이동 축 탭↔스토어 왕복 (AC2 · US-ONB-09 · 5-10)', () => {
  it('이동 항목을 탭하면 그 타일이 선택 표시되고 스토어 transports에 담긴다', () => {
    // 준비 — 렌더.
    render(<PrefStep2Page />);

    // 실행 — '도보 위주' 이동 타일을 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-transport-walk'));

    // 단언 ① — 읽기 경로: 타일이 선택 표시된다.
    expect(
      screen.getByTestId('onboarding-pref2-transport-walk')
    ).toBeSelected();
    // 단언 ② — 쓰기 경로: transports 배열에 담긴다.
    expect(usePreferenceStore.getState().transports).toEqual(['walk']);
  });
});
