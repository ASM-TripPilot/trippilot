import { render, screen } from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
} from './ExploreLandingScreen';

/**
 * TRIP-496 — 가볼 곳 레인 카드가 `imageUrl` 이 있을 때 사진(<Image>)을 그리고, 없으면 회색
 * 플레이스홀더로 둔다(기본 이미지 발명 금지·INV-1).
 *
 * 무엇을 보장하나: 사진 렌더 코드가 아예 없어 회색 박스만 보이던 결함(QA 보고)을 닫는다. `imageUrl`
 * 이 채워진 카드는 `explore-place-card-image-{poiId}` testID 를 가진 <Image> 로 뜨고, null 인
 * 카드는 그 testID 가 트리에 없다(회색 <View> 만).
 *
 * *(개념)* RNTL 의 `queryByTestId` 는 없으면 null 을 돌려줘 "부재"를 단언할 때 쓴다(`getByTestId`
 * 는 없으면 throw). Arrange(카드 VM 구성) → Act(렌더) → Assert(testID 존재/부재).
 */

function baseProps(cards: PlaceCardVM[]): ExploreLandingScreenProps {
  return {
    heading: { title: '무엇을 둘러볼까요?', subtitle: '둘러봐요' },
    onPressSearch: () => {},
    stayLane: {
      error: false,
      cards: [],
      onRetry: () => {},
      onSeeAll: () => {},
    },
    placeLane: {
      error: false,
      cards,
      onRetry: () => {},
      onPressCard: () => {},
    },
    savedMenu: {
      open: false,
      savedCount: 0,
      onToggle: () => {},
      onPressSavedPlaces: () => {},
      onPressSavedStays: () => {},
    },
  };
}

describe('가볼 곳 레인 카드 사진 (TRIP-496)', () => {
  it('imageUrl 이 있으면 사진 <Image> 를 그린다', () => {
    render(
      <ExploreLandingScreen
        {...baseProps([
          {
            poiId: 'p1',
            name: '감천문화마을',
            region: '사하구',
            imageUrl: 'https://cdn.example.com/p1.jpg',
          },
        ])}
      />
    );

    const image = screen.getByTestId('explore-place-card-image-p1');
    expect(image).toBeOnTheScreen();
    expect(image.props.source).toEqual({
      uri: 'https://cdn.example.com/p1.jpg',
    });
  });

  it('imageUrl 이 없으면 사진을 지어내지 않고 플레이스홀더로 둔다 (INV-1)', () => {
    render(
      <ExploreLandingScreen
        {...baseProps([
          {
            poiId: 'p2',
            name: '광안리 해변',
            region: '수영구',
            imageUrl: null,
          },
        ])}
      />
    );

    // 카드 자체는 뜨되(공허 통과 방지), 사진 leaf 는 트리에 없다.
    expect(screen.getByTestId('explore-place-card-p2')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-card-image-p2')).toBeNull();
  });
});
