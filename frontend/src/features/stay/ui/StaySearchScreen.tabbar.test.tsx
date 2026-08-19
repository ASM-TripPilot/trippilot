import { fireEvent, render, screen } from '@testing-library/react-native';

import { StaySearchScreen } from './StaySearchScreen';

/**
 * e02 하단 탭바 복구(TRIP-413) — 화면이 그리던 복제 탭바가 `onPressTab={() => {}}`(빈 함수)라
 * 5탭 전부 무동작이던 것을 콜백으로 잇는다. 목적지(라우터)는 `StaySearchPage`가 정한다 —
 * 화면은 라우터를 모른다(구조 가드). 여기선 "누른 탭 key 가 콜백으로 그대로 온다"만 잰다.
 *
 * 무엇을 보장하나:
 *  - 탭을 누르면 `onPressTab`이 그 탭의 key 로 불린다(빈 함수 스텁이면 이 단언이 red).
 *  - 콜백 미지정(기존 2-prop 호출)이어도 눌러서 크래시하지 않는다(회귀 보호).
 */
describe('e02 하단 탭바 배선 (TRIP-413)', () => {
  it('탭을 누르면 onPressTab 이 그 탭 key 로 불린다', () => {
    const onPressTab = jest.fn();
    render(
      <StaySearchScreen region="부산" items={[]} onPressTab={onPressTab} />
    );

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-itinerary'));

    expect(onPressTab).toHaveBeenNthCalledWith(1, 'home');
    expect(onPressTab).toHaveBeenNthCalledWith(2, 'itinerary');
  });

  it('콜백 미지정이면 탭을 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    expect(() =>
      fireEvent.press(screen.getByTestId('shell-tabbar-tab-explore'))
    ).not.toThrow();
  });
});
