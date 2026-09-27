import {
  render,
  screen,
  fireEvent,
  within,
} from '@testing-library/react-native';
import { View } from 'react-native';

import type { Place } from '@/entities/place/model';

import { PlaceGridCard } from './PlaceGridCard';

/**
 * TRIP-806 · AC-M2·M4 — d04 장소 탐색 2열 그리드 카드를 entities 로 모은다.
 *
 * 무엇을 보장하나(무수정 `PlaceExploreScreen.test.tsx` 가 강제하는 정본 재현):
 *  - 🔴 루트 `explore-places-card-{poiId}` · 이름(`nameKo`) · 부제(`카테고리 · 지역`).
 *  - 🔴 저장 하트 `explore-places-save-{poiId}` — 담김/미담김은 색이 아니라 `accessibilityState.selected`
 *    로 잰다(글리프 fill 함정 회피, 02a ★5). 담기면 "담음" 배지가 함께 뜬다.
 *  - 🔴 pending 이면 하트 disabled(연타 가드).
 *  - 🔴 카드 press → onPressCard(place) · 하트 press → onToggleSave(place).
 *  - 🔴 `imageUrl` null 이면 사진 leaf 를 안 그린다(INV-1).
 *
 * ⚠️ grid 카드도 explore 단일 소비라 testID 하드코딩(02a ★14). d04 하트 글리프는 testID 가 없다(현행 보존).
 *
 * 3동작 뼈대: 준비=Place + saved/pending → 실행=렌더/press → 단언=배지·selected·콜백.
 */

const PLACE: Place = {
  poiId: 'p1',
  nameKo: '해운대 암소갈비집',
  category: '맛집',
  lat: 35.16,
  lng: 129.16,
  region: '부산 해운대구',
  openingHours: null,
  imageUrl: 'https://example.com/x.jpg',
  tags: ['갈비'],
  savedCount: 12,
  dataStatus: 'ACTIVE',
};

function renderGrid(overrides: {
  saved?: boolean;
  pending?: boolean;
  place?: Place;
  onToggleSave?: (p: Place) => void;
  onPressCard?: (p: Place) => void;
}) {
  const onToggleSave = overrides.onToggleSave ?? jest.fn();
  const onPressCard = overrides.onPressCard ?? jest.fn();
  render(
    <PlaceGridCard
      place={overrides.place ?? PLACE}
      saved={overrides.saved ?? false}
      pending={overrides.pending ?? false}
      onToggleSave={onToggleSave}
      onPressCard={onPressCard}
    />
  );
  return { onToggleSave, onPressCard };
}

describe('🔴 PlaceGridCard (AC-M2·M4 d04)', () => {
  it('G1 · 담김이면 "담음" 배지 + selected 하트 + 부제(카테고리 · 지역)', () => {
    renderGrid({ saved: true });

    const card = screen.getByTestId('explore-places-card-p1');
    expect(within(card).getByText('담음')).toBeTruthy();
    expect(screen.getByTestId('explore-places-save-p1')).toBeSelected();
    expect(screen.getByText('맛집 · 부산 해운대구')).toBeTruthy();
    expect(screen.getByText('해운대 암소갈비집')).toBeTruthy();
  });

  it('G2 · 미담김이면 "담음" 배지 없고 하트 not selected', () => {
    renderGrid({ saved: false });

    const card = screen.getByTestId('explore-places-card-p1');
    expect(within(card).queryAllByText('담음')).toHaveLength(0);
    expect(screen.getByTestId('explore-places-save-p1')).not.toBeSelected();
  });

  it('G3 · pending 이면 하트 disabled(연타 가드)', () => {
    renderGrid({ pending: true });

    expect(screen.getByTestId('explore-places-save-p1')).toBeDisabled();
  });

  it('G4 · 카드 press → onPressCard, 하트 press → onToggleSave', () => {
    const { onToggleSave, onPressCard } = renderGrid({});

    fireEvent.press(screen.getByTestId('explore-places-card-p1'));
    expect(onPressCard).toHaveBeenCalledWith(PLACE);

    fireEvent.press(screen.getByTestId('explore-places-save-p1'));
    expect(onToggleSave).toHaveBeenCalledWith(PLACE);
  });

  it('G5 · imageUrl null 이면 사진 leaf 없음 + region 없으면 부제=카테고리만(INV-1)', () => {
    renderGrid({
      place: { ...PLACE, imageUrl: null, region: null },
    });

    const card = screen.getByTestId('explore-places-card-p1');
    // 사진 leaf(Image role) 없음 — 회색 자리만. 부제는 region 이 없으므로 카테고리 하나.
    expect(within(card).queryByText('맛집 · 부산 해운대구')).toBeNull();
    expect(within(card).getByText('맛집')).toBeTruthy();
  });
});

// TRIP-1020 (B) #029 — 카드 루트가 버튼이 아니면 VoiceOver·agent-device 트리에서 누를 수 없다.
// 라벨 = 이름 + 카드에 이미 보이는 부제 조각(01b Q1) + 담겼으면 ', 담음'(5-b 경고-1 오케 개정 — 명시 라벨이
// 안쪽 글자 읽기를 대체해, 빼면 VoiceOver 가 담김 여부를 못 듣는다).
const P2: Place = {
  ...PLACE,
  poiId: 'p2',
  nameKo: '감천문화마을',
  category: '문화',
  region: null,
};
const LABEL_P1 = '해운대 암소갈비집, 맛집 · 부산 해운대구, 담음';
const LABEL_P2 = '감천문화마을, 문화';

function renderTwoCards() {
  render(
    <View>
      <PlaceGridCard
        place={PLACE}
        saved
        pending={false}
        onToggleSave={jest.fn()}
        onPressCard={jest.fn()}
      />
      <PlaceGridCard
        place={P2}
        saved={false}
        pending={false}
        onToggleSave={jest.fn()}
        onPressCard={jest.fn()}
      />
    </View>
  );
}

describe('TRIP-1020 AC-B1·B2 · 카드 루트는 이름 라벨을 가진 버튼', () => {
  it.each([
    ['p1', LABEL_P1],
    ['p2', LABEL_P2],
  ])(
    '%s 카드 루트가 button 이고 라벨이 "%s" 로 그 카드 자신에게 붙어 있다',
    (poiId, label) => {
      renderTwoCards();

      // name 은 자식 텍스트·자식 라벨로도 맞으므로(02a ★1) 라벨이 루트 자신에 있는지 따로 본다.
      expect(screen.getByRole('button', { name: label }).props.testID).toBe(
        `explore-places-card-${poiId}`
      );
      expect(screen.getByLabelText(label).props.testID).toBe(
        `explore-places-card-${poiId}`
      );
    }
  );

  it('저장 하트는 카드와 다른 별도 button 노드로 남고 selected 상태를 유지한다', () => {
    renderTwoCards();

    expect(
      screen
        .getAllByRole('button')
        .map((node) => String(node.props.testID))
        .sort()
    ).toEqual([
      'explore-places-card-p1',
      'explore-places-card-p2',
      'explore-places-save-p1',
      'explore-places-save-p2',
    ]);
    expect(screen.getByTestId('explore-places-save-p1')).toBeSelected();
    expect(screen.getByTestId('explore-places-save-p2')).not.toBeSelected();
  });
});
