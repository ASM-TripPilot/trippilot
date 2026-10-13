import { render, screen } from '@testing-library/react-native';

import type { Place } from '@/entities/place/model';

import { PlaceGridCard } from './PlaceGridCard';
import { PlaceSubtitle } from './PlaceSubtitle';

/**
 * TRIP-1349 — PlaceGridCard 는 memo 다. RNTL 은 렌더 횟수를 못 세므로 카드 안쪽 자식(PlaceSubtitle)이
 * 몇 번 불렸는지로 대신 센다. 짝 단언: props 가 바뀌면 반드시 다시 그려진다(stale 화면 금지).
 */
jest.mock('./PlaceSubtitle', () => {
  const actual = jest.requireActual('./PlaceSubtitle');
  return {
    PlaceSubtitle: jest.fn((props: unknown) => actual.PlaceSubtitle(props)),
  };
});

const PLACE: Place = {
  poiId: 'p1',
  nameKo: '해운대 암소갈비집',
  category: '맛집',
  lat: 35.16,
  lng: 129.16,
  region: '부산 해운대구',
  openingHours: null,
  imageUrl: null,
  tags: [],
  savedCount: 1,
  dataStatus: 'ACTIVE',
};

const onToggleSave = jest.fn();
const onPressCard = jest.fn();
const subtitleCalls = (): number =>
  (PlaceSubtitle as unknown as jest.Mock).mock.calls.length;

function card(saved: boolean, pending: boolean, place: Place = PLACE) {
  return (
    <PlaceGridCard
      place={place}
      saved={saved}
      pending={pending}
      onToggleSave={onToggleSave}
      onPressCard={onPressCard}
    />
  );
}

beforeEach(() => (PlaceSubtitle as unknown as jest.Mock).mockClear());

describe('TRIP-1349 · PlaceGridCard memo', () => {
  it('M1 · props 가 같으면(부모 재렌더) 다시 그리지 않는다', () => {
    const { rerender } = render(card(false, false));
    const first = subtitleCalls();
    rerender(card(false, false));
    expect(subtitleCalls()).toBe(first);
  });

  it('M2 · saved 가 바뀌면 다시 그려진다(담음 배지·selected)', () => {
    const { rerender } = render(card(false, false));
    expect(screen.queryByText('담음')).toBeNull();
    rerender(card(true, false));
    expect(screen.getByText('담음')).toBeTruthy();
    expect(screen.getByTestId('explore-places-save-p1')).toBeSelected();
  });

  it('M3 · pending 이 바뀌면 다시 그려진다(하트 disabled)', () => {
    const { rerender } = render(card(false, false));
    rerender(card(false, true));
    expect(screen.getByTestId('explore-places-save-p1')).toBeDisabled();
  });

  it('M4 · place 가 바뀌면 다시 그려진다(이름)', () => {
    const { rerender } = render(card(false, false));
    rerender(card(false, false, { ...PLACE, nameKo: '다른 집' }));
    expect(screen.getByText('다른 집')).toBeTruthy();
  });
});
