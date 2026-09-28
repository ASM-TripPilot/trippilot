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
 * testID 접두는 소비처가 `testIDPrefix` 로 주입한다(기본 `explore-place-card` = d01, d05 는
 * `destination-detail-place-card`).
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

/**
 * TRIP-1048 — d05 목적지 검색 결과의 장소 칸이 2열 격자가 되면서, 카드 폭을 부모 칸이 정하는
 * 옵셔널 `variant="fill"` 이 생긴다. 기본값(`'rail'`)은 지금처럼 160 고정폭이어야 d01 탐색
 * 랜딩 레인이 안 흔들린다.
 *
 * (개념) jest 는 NativeWind className 을 style 로 바꾸지 않고 prop 문자열로 남긴다 — 그래서 폭은
 * 픽셀이 아니라 className 토큰(`w-[160px]` / `w-full`)으로 잰다.
 */
describe('🔴 PlaceRailCard 폭 변형 (TRIP-1048)', () => {
  function rootTokens(testID: string): string[] {
    return String(screen.getByTestId(testID).props.className ?? '')
      .trim()
      .split(/\s+/);
  }

  it('R4 · variant 를 안 주거나 "rail" 이면 160 고정폭 그대로다(d01 무회귀)', () => {
    const { unmount } = render(<PlaceRailCard card={VM} onPress={jest.fn()} />);
    expect(rootTokens('explore-place-card-p1')).toContain('w-[160px]');
    expect(rootTokens('explore-place-card-p1')).not.toContain('w-full');
    unmount();

    render(<PlaceRailCard card={VM} onPress={jest.fn()} variant="rail" />);
    expect(rootTokens('explore-place-card-p1')).toContain('w-[160px]');
    expect(rootTokens('explore-place-card-p1')).not.toContain('w-full');
  });

  it('R5 · variant="fill" 이면 폭을 부모에 맡기고(w-full), 사진·이름·지역·press 는 그대로다', () => {
    const onPress = jest.fn();
    render(
      <PlaceRailCard
        card={VM}
        onPress={onPress}
        variant="fill"
        testIDPrefix="destination-detail-place-card"
      />
    );

    expect(rootTokens('destination-detail-place-card-p1')).toContain('w-full');
    expect(rootTokens('destination-detail-place-card-p1')).not.toContain(
      'w-[160px]'
    );
    expect(
      screen.getByTestId('destination-detail-place-card-image-p1')
    ).toBeOnTheScreen();
    expect(screen.getByText('감천문화마을')).toBeOnTheScreen();
    expect(screen.getByText('부산 사하구')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('destination-detail-place-card-p1'));
    expect(onPress).toHaveBeenCalledWith('p1');
  });
});
