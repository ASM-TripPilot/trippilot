import { fireEvent, render, screen } from '@testing-library/react-native';

import { StaySearchScreen } from './StaySearchScreen';

/**
 * e02 FAB 배선(TRIP-414) — `onPress={undefined}`이던 "여행 만들기" FAB 을 콜백으로 잇는다.
 * 목적지(`/trips/new/step1`)는 `StaySearchPage`가 정한다(화면은 라우터를 모른다 — 구조 가드).
 *
 * 무엇을 보장하나:
 *  - FAB 을 누르면 `onPressCreateTrip`이 불린다(undefined 스텁이면 이 단언이 red).
 *  - 스크린리더가 읽는 이름이 "여행 만들기"다(자식 Text 의 전각 '＋'가 이름에 안 샌다, AC-접근성).
 *  - 목록 끝 여백(footer)이 FAB 높이(bottom 104 + h 52 = 156)를 덮을 만큼 있어 마지막 카드를
 *    가리지 않는다 — 픽셀 겹침 자체는 6-b 실기 몫이고, 여기선 여백 값이 유지되는지만 잠근다.
 *  - 콜백 미지정이어도 눌러서 크래시하지 않는다(기존 2-prop 호출 회귀 보호).
 */
describe('e02 FAB 배선 (TRIP-414)', () => {
  it('FAB 을 누르면 onPressCreateTrip 이 불린다', () => {
    const onPressCreateTrip = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={[]}
        onPressCreateTrip={onPressCreateTrip}
      />
    );

    fireEvent.press(screen.getByTestId('stay-search-fab'));
    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
  });

  it('스크린리더가 FAB 이름을 "여행 만들기"로 읽는다', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    // accessibilityLabel 이 붙어 전각 '＋'가 이름에서 빠진다.
    expect(screen.getByLabelText('여행 만들기')).toBe(
      screen.getByTestId('stay-search-fab')
    );
  });

  it('목록 끝 여백이 FAB 높이(156)를 덮어 마지막 카드를 안 가린다', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    const footer = screen.getByTestId('stay-search-list-footer');
    const cls = String(footer.props.className ?? '');
    expect(cls).toContain('h-[156px]');
  });

  it('콜백 미지정이면 FAB 을 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    expect(() =>
      fireEvent.press(screen.getByTestId('stay-search-fab'))
    ).not.toThrow();
  });
});
