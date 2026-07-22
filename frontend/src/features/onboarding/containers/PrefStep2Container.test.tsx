import { fireEvent, render, screen } from '@testing-library/react-native';

import { usePreferenceStore } from '../store/preferenceStore';
import { PrefStep2Container } from './PrefStep2Container';

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

describe('PrefStep2Container — 복귀 시 선택값 보존 (AC2 · AC3 · 5-4)', () => {
  it('1/2에서 고른 값이 2/2를 언마운트·재마운트해도 남고, back은 router.back()을 부른다', () => {
    // 준비 — 1/2에서 이미 골랐다고 가정하고 스토어에 직접 선주입(스토어는 화면과 독립된
    // 모듈 싱글턴이라 이렇게 미리 채워도 된다 — §1 개념 박스).
    usePreferenceStore.getState().toggleStyle('rest');
    usePreferenceStore.getState().toggleFood('seafood');

    // 실행 — 렌더 후 언마운트, 다시 렌더(1/2↔2/2 왕복의 등가).
    const { unmount } = render(<PrefStep2Container />);
    unmount();
    render(<PrefStep2Container />);

    // 단언 — seafood 칩이 여전히 선택 상태(스토어가 화면 수명과 무관함을 증명).
    expect(screen.getByTestId('onboarding-pref2-food-seafood')).toBeSelected();

    // 실행 — back chevron 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-back'));

    // 단언 — router.back() 호출(1/2로 복귀 — 스토어는 그대로 살아있다).
    expect(routerMock.back).toHaveBeenCalled();
  });
});

describe('PrefStep2Container — 완료 내비게이션 (AC3 · AC-done-1 · 5-5)', () => {
  it('0개 선택에도 완료를 탭하면 홈으로 replace한다', () => {
    // 준비 — 아무 것도 고르지 않은 채 렌더.
    render(<PrefStep2Container />);

    // 실행 — CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — replace('/') (서버 미전송은 F6 6-3 구조 가드가 별도로 잠근다).
    expect(routerMock.replace).toHaveBeenCalledWith('/');
  });
});

describe('PrefStep2Container — 일괄 탈출 (AC4 · 5-6)', () => {
  it('skip-bottom을 탭하면 홈으로 replace하고, 이미 고른 styles는 그대로 남는다', () => {
    // 준비 — styles만 미리 선택된 상태.
    usePreferenceStore.getState().toggleStyle('rest');
    render(<PrefStep2Container />);

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
