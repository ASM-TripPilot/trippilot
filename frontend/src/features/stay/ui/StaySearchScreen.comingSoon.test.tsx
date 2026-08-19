import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { StaySearchScreen } from './StaySearchScreen';

/**
 * TRIP-419 — 숙소 검색 가격대 칩의 "준비 중" 정직한 표기 + 무동작 소유권 이동.
 *
 * 무엇을 보장하나(AC-419-4·5): 계약(`GET /stays/search`)에 가격대 파라미터가 없어 실동작이
 * 불가능한 가격대 칩이 ① 자기 자리에 "준비 중" Text를 갖고("가격대" 라벨은 별도 Text로 유지),
 * ② 비활성이며(`toBeDisabled`) 눌러도 `onPressFilter('price')`가 불리지 않는다 — 지금은 화면이
 * price도 배선해 눌리면 호출되고, 무동작은 페이지가 axis 'price'를 무시해 실현된다. 이 티켓은
 * 그 무동작 소유권을 화면(disabled)으로 옮긴다.
 *
 * 무회귀 경계(이 파일 밖에서 잠금):
 *  - V3(가격대 칩 `border-hairline-strong`+`가격대` Text 동결)는 `StaySearchScreen.test.tsx`가
 *    그대로 잠근다(AC-419-6). 준비중 신호는 테두리 교체가 아니라 캡션+disabled+라벨 muted로만
 *    줘야 그 동결이 안 깨진다(맹점①, 02a §5-2 양립 실측). 이 파일은 그 파일을 안 건드린다.
 *  - 필터 배선(region·more)은 `StaySearchScreen.filter.test.tsx`가 잠근다(AC-419-7) — 아래
 *    it 4가 같은 화면에서 무회귀 짝을 한 번 더 확인한다.
 *
 * 새 문법 메모(학습자):
 *  - `within(chip).getByText('준비 중')`: 칩 안으로 좁혀 정확히 '준비 중'인 Text를 찾는다.
 *  - `toBeDisabled()`: `disabled` prop 또는 `accessibilityState.disabled`가 true면 통과.
 *  - `fireEvent.press(node)`: 탭을 흉내낸다. disabled 요소에서는 no-op라 onPress가 안 불린다
 *    (node_modules 실측, 02a §5-1).
 *  - `not.toHaveBeenCalledWith('price')`: 그 인자로 한 번도 안 불렸는지 본다.
 *  - `toHaveBeenNthCalledWith(n, arg)`: n번째 호출의 인자가 정확히 그것인지 본다.
 */

describe('🔴 AC-419-4 — 가격대 칩이 자기 자리에 "준비 중" 표기를 갖는다', () => {
  it('stay-search-filter-price 안에 "준비 중" Text + "가격대" 라벨(별도 노드)이 함께 있다', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    const chip = screen.getByTestId('stay-search-filter-price');
    // within(chip) 스코프 — "준비 중"이 칩 자리 안이다(공용 한 줄 아님, AC-419-8).
    expect(within(chip).getByText('준비 중')).toBeOnTheScreen();
    // V3 동결 계승 — "가격대" 라벨은 별도 Text로 남는다(무회귀, AC-419-6). 준비중 캡션이 이
    // 노드를 오염하지 않음은 02a §5-2 양립 프로브로 실측.
    expect(within(chip).getByText('가격대')).toBeOnTheScreen();
  });

  it('region·more 칩에는 "준비 중"이 없다 (표기가 가격대에만, 부정 짝)', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    ['region', 'more'].forEach((axis) => {
      const chip = screen.getByTestId(`stay-search-filter-${axis}`);
      expect(within(chip).queryByText('준비 중')).toBeNull();
    });
  });
});

describe('🔴 AC-419-5 — 가격대 칩은 눌러도 무동작 + 비활성 낭독', () => {
  it('toBeDisabled이고, 눌러도 onPressFilter가 "price"로 불리지 않는다', () => {
    const onPressFilter = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={[]}
        onPressFilter={onPressFilter}
      />
    );

    const chip = screen.getByTestId('stay-search-filter-price');
    // 색 아닌 신호 — disabled(→ accessibilityState.disabled)로 비활성이 관찰된다.
    expect(chip).toBeDisabled();

    // 현재는 price도 onPressFilter('price')로 배선돼 있어 지금은 호출된다(red). disabled로
    // 옮기면 press가 no-op이라 미호출(green). 무동작 소유권이 page→screen으로 이동한다.
    fireEvent.press(chip);
    expect(onPressFilter).not.toHaveBeenCalledWith('price');
  });

  it('region·more 칩은 여전히 눌리면 onPressFilter가 불린다 (배선 무회귀 짝, AC-419-7)', () => {
    const onPressFilter = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={[]}
        onPressFilter={onPressFilter}
      />
    );

    fireEvent.press(screen.getByTestId('stay-search-filter-region'));
    fireEvent.press(screen.getByTestId('stay-search-filter-more'));

    expect(onPressFilter).toHaveBeenNthCalledWith(1, 'region');
    expect(onPressFilter).toHaveBeenNthCalledWith(2, 'more');
  });
});
