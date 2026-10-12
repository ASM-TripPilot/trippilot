import { render, screen } from '@testing-library/react-native';

import { SavedStayCard } from '@/entities/stay';

import { SavedStayListScreen } from './SavedStayListScreen';

/**
 * TRIP-1363 — e04 저장 숙소 목록은 FlatList(가상화)다. 100곳이어도 처음 보이는 행만 마운트되고,
 * 같은 props 로 다시 그리면 행(memo)이 재렌더되지 않으며, 목록이 바뀌면 갱신된다.
 */
jest.mock('@/entities/stay', () => {
  const actual = jest.requireActual('@/entities/stay');
  return {
    ...actual,
    SavedStayCard: jest.fn((props: unknown) => actual.SavedStayCard(props)),
  };
});

const stays = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    savedStayId: `ss-${i}`,
    name: `숙소 ${i}`,
  }));
const cardCalls = (): number =>
  (SavedStayCard as unknown as jest.Mock).mock.calls.length;

beforeEach(() => (SavedStayCard as unknown as jest.Mock).mockClear());

describe('TRIP-1363 · SavedStayListScreen FlatList', () => {
  it('L1 · 100곳이어도 전부 마운트하지 않는다(가상화)', () => {
    render(<SavedStayListScreen savedStays={stays(100)} />);
    const mounted = screen.getAllByTestId(/^saved-stay-card-ss-/).length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
    expect(screen.getByTestId('saved-stay-register')).toBeTruthy();
  });

  it('L2 · 같은 목록·콜백으로 다시 그려도 행은 재렌더되지 않는다', () => {
    const data = stays(3);
    const onPressCard = jest.fn();
    const { rerender } = render(
      <SavedStayListScreen savedStays={data} onPressCard={onPressCard} />
    );
    const first = cardCalls();
    expect(first).toBe(3);
    rerender(
      <SavedStayListScreen savedStays={data} onPressCard={onPressCard} />
    );
    expect(cardCalls()).toBe(first);
  });

  it('L3 · 목록이 바뀌면 갱신된다(이름 변경 · 항목 추가)', () => {
    const { rerender } = render(<SavedStayListScreen savedStays={stays(2)} />);
    rerender(
      <SavedStayListScreen
        savedStays={[
          { savedStayId: 'ss-0', name: '바뀐 이름' },
          ...stays(3).slice(1),
        ]}
      />
    );
    expect(screen.getByText('바뀐 이름')).toBeTruthy();
    expect(screen.getAllByTestId(/^saved-stay-card-ss-/)).toHaveLength(3);
  });
});
