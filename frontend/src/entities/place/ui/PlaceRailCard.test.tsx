import { render, screen, fireEvent } from '@testing-library/react-native';

import type { PlaceCardVM } from '@/entities/place/model';

import { PlaceRailCard } from './PlaceRailCard';

/**
 * TRIP-806 · AC-M2·M4 — d01 탐색 랜딩·d05 목적지 상세의 "가볼 곳" 레인 카드(160폭)를 entities 로 모은다.
 *
 * 무엇을 보장하나(현행 소비처가 쓰던 testID·표시를 그대로 재현):
 *  - 🔴 루트 testID `explore-place-card-{poiId}` · 이름 · 지역.
 *  - 🔴 사진은 `imageUrl` 있을 때만 `explore-place-card-image-{poiId}`, 없으면 회색 자리(기본 이미지
 *    발명 금지 · INV-1). d01 무수정 `ExploreLandingScreen.placePhoto.test.tsx` 가 이 있음/없음을 심판한다.
 *  - 🔴 카드 press → `onPress(poiId)`.
 *
 * ⚠️ rail 카드는 explore 단일 소비라 testID 를 하드코딩한다(testIDPrefix 안 받음, 02a ★14).
 *
 * 3동작 뼈대: 준비=PlaceCardVM prop → 실행=렌더/press → 단언=testID·텍스트·콜백.
 */

const VM: PlaceCardVM = {
  poiId: 'p1',
  name: '감천문화마을',
  region: '부산 사하구',
  imageUrl: 'https://example.com/gamcheon.jpg',
};

describe('🔴 PlaceRailCard (AC-M2·M4 d01·d05)', () => {
  it('R1 · 이미지 있으면 사진 leaf 와 이름·지역을 그린다', () => {
    const onPress = jest.fn();
    render(<PlaceRailCard card={VM} onPress={onPress} />);

    expect(screen.getByTestId('explore-place-card-p1')).toBeTruthy();
    expect(screen.getByTestId('explore-place-card-image-p1')).toBeTruthy();
    expect(screen.getByText('감천문화마을')).toBeTruthy();
    expect(screen.getByText('부산 사하구')).toBeTruthy();
  });

  it('R2 · 이미지 없으면 사진 leaf 를 안 만든다(회색 자리 · INV-1)', () => {
    const onPress = jest.fn();
    render(
      <PlaceRailCard card={{ ...VM, imageUrl: null }} onPress={onPress} />
    );

    expect(screen.getByTestId('explore-place-card-p1')).toBeTruthy();
    expect(screen.queryByTestId('explore-place-card-image-p1')).toBeNull();
    expect(screen.getByText('감천문화마을')).toBeTruthy();
  });

  it('R3 · 카드 press → onPress(poiId)', () => {
    const onPress = jest.fn();
    render(<PlaceRailCard card={VM} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('explore-place-card-p1'));

    expect(onPress).toHaveBeenCalledWith('p1');
  });
});
