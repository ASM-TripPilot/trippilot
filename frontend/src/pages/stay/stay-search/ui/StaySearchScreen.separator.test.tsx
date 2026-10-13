import { FlatList } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { StaySearchScreen } from './StaySearchScreen';

/**
 * TRIP-1349 — ItemSeparatorComponent 가 인라인 화살표면 렌더마다 새 컴포넌트 타입이라 세퍼레이터가 전부
 * remount 된다. 참조가 렌더 간 같아야 한다.
 */
describe('TRIP-1349 · 숙소 검색 목록 세퍼레이터', () => {
  it('S1 · 다시 그려도 ItemSeparatorComponent 참조가 같다', () => {
    const { rerender } = render(<StaySearchScreen region="부산" items={[]} />);
    const first =
      screen.UNSAFE_getByType(FlatList).props.ItemSeparatorComponent;
    expect(typeof first).toBe('function');
    rerender(<StaySearchScreen region="부산" items={[]} />);
    expect(screen.UNSAFE_getByType(FlatList).props.ItemSeparatorComponent).toBe(
      first
    );
  });
});
