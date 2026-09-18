import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Place } from '@/shared/api/generated/schemas';

import { PlaceExploreScreen } from './PlaceExploreScreen';

/**
 * TRIP-456 · AC-3 — d04 장소 카드 press 버블링 갈림(화면 층).
 *
 * 무엇을 보장하나: 카드를 `Pressable`로 만들어 d06으로 배선하되, **하트 press가 카드로 새지
 * 않는다**. RNTL에서 부모 Pressable 안 자식 Pressable을 누르면 — 자식이 활성이면 부모로 안 새고
 * (Probe A), 자식이 `disabled`면 부모로 **샌다**(Probe C, 02a §5 실측). d04 하트는 `disabled={pending}`
 * 이라, 대기 중 하트를 누르면 카드(d06 이동)로 튕기는 함정이 실재한다 — 카드 onPress를 `!pending`
 * 으로 가드해 그 누수를 막는다.
 *
 * 왜 화면 층인가: 버블링 갈림은 카드의 `Pressable` 구조 + 가드에서 갈리므로, jest.fn 콜백으로
 * "무엇이 불렸나"를 직접 재는 것이 라우터를 거치는 것보다 명확하다(라우터 배선은 AC-1이 잰다).
 */

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '문화',
    lat: 35.1,
    lng: 129.1,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 5,
    dataStatus: 'ACTIVE',
  };
}

const PLACES: Place[] = [
  makePlace('p1', '감천문화마을'),
  makePlace('p2', '광안리'),
];

function renderScreen(overrides?: {
  onPressCard?: (place: Place) => void;
  onToggleSave?: (place: Place) => void;
  pendingPoiIds?: string[];
}) {
  render(
    <PlaceExploreScreen
      places={PLACES}
      savedPoiIds={[]}
      selectedCategory={null}
      searchText=""
      onSelectCategory={() => {}}
      onChangeSearchText={() => {}}
      onToggleSave={overrides?.onToggleSave ?? (() => {})}
      onPressCreateTrip={() => {}}
      pendingPoiIds={overrides?.pendingPoiIds}
      onPressCard={overrides?.onPressCard}
    />
  );
}

describe('AC-3 · d04 카드 press 버블링', () => {
  it('C1 카드 본문을 누르면 onPressCard(place)가 그 카드의 place로 불린다 (하드코딩 아님)', () => {
    // 준비 — 카드 2장, onPressCard 스파이.
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    renderScreen({ onPressCard, onToggleSave });

    // 실행 — 첫 카드 본문(카드 루트 testID)을 누른다.
    fireEvent.press(screen.getByTestId('explore-places-card-p1'));
    // 단언 — 그 카드의 place가 올라간다. 하트 콜백은 안 불린다.
    expect(onPressCard).toHaveBeenCalledTimes(1);
    expect(onPressCard.mock.calls[0][0].poiId).toBe('p1');
    expect(onToggleSave).not.toHaveBeenCalled();

    // 둘째 카드도 각자 poiId — poiId를 하드코딩하면 여기서 갈린다.
    fireEvent.press(screen.getByTestId('explore-places-card-p2'));
    expect(onPressCard).toHaveBeenCalledTimes(2);
    expect(onPressCard.mock.calls[1][0].poiId).toBe('p2');
  });

  it('C2 활성 하트를 누르면 onToggleSave만 불리고 onPressCard로 안 샌다 (Probe A)', () => {
    // 준비 — pending 아님(하트 활성).
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    renderScreen({ onPressCard, onToggleSave });

    // 실행 — 하트를 누른다.
    fireEvent.press(screen.getByTestId('explore-places-save-p1'));

    // 단언 — 하트만 반응, 카드로 안 샌다(활성 자식은 press를 잡는다).
    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onToggleSave.mock.calls[0][0].poiId).toBe('p1');
    expect(onPressCard).not.toHaveBeenCalled();
  });

  it('C3 대기(disabled) 하트를 누르면 push·toggle 둘 다 0이다 (Probe C 누수 차단)', () => {
    // 준비 — p1을 pending으로: 하트가 disabled가 된다.
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    renderScreen({ onPressCard, onToggleSave, pendingPoiIds: ['p1'] });

    // 실행 — 대기 중 하트를 누른다. RNTL에선 disabled 자식 press가 부모(카드)로 샌다 —
    // 카드 onPress가 `!pending` 가드가 없으면 여기서 d06으로 튕긴다.
    fireEvent.press(screen.getByTestId('explore-places-save-p1'));

    // 단언 — 하트도(disabled) 카드도(가드) 반응하지 않는다.
    expect(onToggleSave).not.toHaveBeenCalled();
    expect(onPressCard).not.toHaveBeenCalled();
  });
});
