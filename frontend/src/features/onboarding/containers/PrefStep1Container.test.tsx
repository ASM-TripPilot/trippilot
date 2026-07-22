import { fireEvent, render, screen } from '@testing-library/react-native';

import { usePreferenceStore } from '../store/preferenceStore';
import { PrefStep1Container } from './PrefStep1Container';

/**
 * AC3 · AC4 — 취향 1/2 배선(스토어 ↔ 화면 ↔ 라우터).
 *
 * 무엇을 보장하나: 카드 탭이 실제로 스토어를 바꾸고 그 결과가 화면에 다시 반영되며(왕복),
 * '다음'은 0개 선택에도 2/2로 push하고, 상·하단 '나중에 설정하고 시작'은 홈으로
 * replace하면서 스토어를 건드리지 않는다(미선택 축이 []로 새지 않는다 — AC4).
 *
 * expo-router는 인라인 factory 목(§7-10 — 컨테이너 useRouter는 이 방식, 레이아웃/Redirect
 * 관찰과는 다른 목 종류를 쓴다), 스토어는 **실제** usePreferenceStore를 쓰고 매 테스트
 * 전 reset()한다(모듈 싱글턴이 테스트 간 상태를 새게 두지 않기 위해 — §7-6).
 *
 * 3동작: 준비(reset+렌더) → 실행(탭) → 단언(화면 반영/스토어 값/라우터 호출).
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
  // 준비(공통) — 모듈 싱글턴 스토어를 매 테스트 전 되돌린다(§7-6).
  usePreferenceStore.getState().reset();
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
});

describe('PrefStep1Container — 탭↔스토어 왕복 (AC3 · 5-1)', () => {
  it('카드를 탭하면 화면에 선택 표시가 되고 스토어 값도 함께 바뀐다', () => {
    // 준비 — 렌더(스토어는 이미 reset 완료).
    render(<PrefStep1Container />);

    // 실행 — 'rest' 카드를 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-style-rest'));

    // 단언 — 화면이 재렌더되어 rest가 selected로 보인다(탭→스토어→재렌더 배선 증명).
    expect(screen.getByTestId('onboarding-pref1-style-rest')).toBeSelected();
    // 단언 — 스토어 상태도 함께 바뀌었다.
    expect(usePreferenceStore.getState().styles).toEqual(['rest']);
  });
});

describe('PrefStep1Container — 다음 내비게이션 (AC3 · AC-nav-1 · 5-2)', () => {
  it('0개 선택에도 다음을 탭하면 2/2로 push한다', () => {
    // 준비 — 아무 것도 고르지 않은 채 렌더.
    render(<PrefStep1Container />);

    // 실행 — CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-next'));

    // 단언 — push('/(onboarding)/pref2') — replace가 아니라 push(2/2의 back()이 1/2로
    // 돌아와야 하므로 스택을 쌓는다 — §7-16).
    expect(routerMock.push).toHaveBeenCalledWith('/(onboarding)/pref2');
  });
});

describe('PrefStep1Container — 일괄 탈출 (AC4 · AC-11-1·2 · AC-14-1 · 5-3)', () => {
  it.each([
    ['상단', 'onboarding-pref1-skip-top'],
    ['하단', 'onboarding-pref1-skip-bottom'],
  ])(
    '%s skip을 탭하면 홈으로 replace하고 6축이 전부 null로 유지된다',
    (_label, testId) => {
      // 준비 — 아무 것도 고르지 않은 채 렌더(reset 직후).
      render(<PrefStep1Container />);

      // 실행 — skip 탭.
      fireEvent.press(screen.getByTestId(testId));

      // 단언 — 홈으로 replace.
      expect(routerMock.replace).toHaveBeenCalledWith('/');
      // 단언 — 6축 전부 null 유지(빈 배열로 바뀌지 않는다 — US-ONB-14).
      const state = usePreferenceStore.getState();
      expect(state.styles).toBeNull();
      expect(state.pace).toBeNull();
      expect(state.budget).toBeNull();
      expect(state.companions).toBeNull();
      expect(state.foods).toBeNull();
      expect(state.transports).toBeNull();
    }
  );
});
