import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StaySearchState } from '../model/staySearchState';
import { StaySearchScreen } from './StaySearchScreen';

/**
 * R-16 (01b Seed §3-6) — e02의 "숙소 직접 등록" 버튼이 e05로 가는 문이 된다.
 *
 * 무엇을 보장하나: 지금 시각 스텁(눌러도 아무 일 없음)인 등록 유도 버튼들이 실제로
 * 콜백을 부른다. 목적지 라우트로 보내는 일은 `StaySearchPage`가 하고(화면은 `expo-router`를
 * 못 만진다 — 구조 가드), 이 파일은 "버튼이 눌리면 위로 올라간다"까지만 잰다.
 *
 * 소스 전수 grep 결과 e02의 등록 버튼은 **2개**다(`stay-search-register`(empty 상태) ·
 * `stay-search-error-register`(error 상태)). 브리프 §10-③이 "3개"라 적었으나 소스가 정본이다.
 *
 * 기존 `StaySearchScreen.test.tsx`·`.states.test.tsx`는 동결이라 건드리지 않는다 —
 * 새 prop은 옵셔널이어야 하고, 그 회귀는 아래 마지막 it이 잠근다.
 */

describe('R-16 · e02 등록 버튼 → 등록 화면 (§3-6)', () => {
  it('empty 상태의 등록 유도 카드를 누르면 콜백이 불린다', () => {
    const onPressRegister = jest.fn();
    const state: StaySearchState = { kind: 'empty', degraded: false };
    render(
      <StaySearchScreen
        region="부산"
        items={[]}
        state={state}
        onPressRegister={onPressRegister}
      />
    );

    fireEvent.press(screen.getByTestId('stay-search-register'));
    expect(onPressRegister).toHaveBeenCalledTimes(1);
  });

  it('error 상태의 "숙소 직접 등록" 버튼을 누르면 같은 콜백이 불린다', () => {
    const onPressRegister = jest.fn();
    const state: StaySearchState = { kind: 'error' };
    render(
      <StaySearchScreen
        region="부산"
        items={[]}
        state={state}
        onPressRegister={onPressRegister}
      />
    );

    fireEvent.press(screen.getByTestId('stay-search-error-register'));
    expect(onPressRegister).toHaveBeenCalledTimes(1);
  });

  it('짝(회귀): onPressRegister 없이 렌더해도 버튼은 그대로 있고 눌러도 죽지 않는다', () => {
    const state: StaySearchState = { kind: 'empty', degraded: false };
    render(<StaySearchScreen region="부산" items={[]} state={state} />);

    const button = screen.getByTestId('stay-search-register');
    expect(button).toBeOnTheScreen();
    // 동결 테스트들이 이 3-prop 호출 형태를 그대로 쓴다 — 새 prop이 필수가 되면 그쪽이 깨진다.
    expect(() => fireEvent.press(button)).not.toThrow();
  });
});
