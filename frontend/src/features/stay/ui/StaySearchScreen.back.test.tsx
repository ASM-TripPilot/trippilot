import { fireEvent, render, screen } from '@testing-library/react-native';

import { StaySearchScreen } from './StaySearchScreen';

/**
 * e02 앱바 뒤로가기 — 시각 스텁(`onPress={undefined}`)이던 버튼이 콜백을 부른다.
 * 목적지(`router.back()`)는 `StaySearchPage`가 정한다(화면은 라우터를 모른다 — 구조 가드).
 */
describe('e02 뒤로가기', () => {
  it('앱바 뒤로가기를 누르면 콜백이 불린다', () => {
    const onPressBack = jest.fn();
    render(
      <StaySearchScreen region="부산" items={[]} onPressBack={onPressBack} />
    );

    fireEvent.press(screen.getByTestId('stay-search-back'));
    expect(onPressBack).toHaveBeenCalledTimes(1);
  });

  it('콜백 미지정이면 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    expect(() =>
      fireEvent.press(screen.getByTestId('stay-search-back'))
    ).not.toThrow();
  });
});
