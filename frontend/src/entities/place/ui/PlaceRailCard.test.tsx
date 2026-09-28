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

/**
 * TRIP-1049 — 카드 사진 우상단에 저장 하트(32 흰 원, HeartButton 대응)를 얹는 옵셔널 슬롯.
 *
 * 무엇을 보장하나:
 *  - `save` 를 안 주면 하트가 없다(지금 소비처 무회귀).
 *  - 담김/안 담김은 **색이 아니라** 서로 다른 글리프 testID + `selected` 로 갈린다(SVG fill 은 jest 사각).
 *  - 하트 press 는 카드 이동(onPress)을 부르지 않는다.
 *  - 대기(pending) 중 하트를 누르면 하트도 카드도 반응하지 않는다 — disabled 하트 press 는 부모
 *    카드로 새므로(02a ★2 Probe C) 카드 쪽 가드가 필요하다.
 */
describe('🔴 PlaceRailCard 저장 하트 슬롯 (TRIP-1049)', () => {
  function withSave(over: { saved?: boolean; pending?: boolean } = {}) {
    const onToggle = jest.fn();
    const onPress = jest.fn();
    render(
      <PlaceRailCard
        card={VM}
        onPress={onPress}
        save={{
          saved: over.saved ?? false,
          pending: over.pending ?? false,
          onToggle,
          testID: 'heart-p1',
          filledTestID: 'heart-filled-p1',
          outlineTestID: 'heart-outline-p1',
        }}
      />
    );
    return { onToggle, onPress };
  }

  it('R6 · save 를 안 주면 하트가 없다(무회귀)', () => {
    render(<PlaceRailCard card={VM} onPress={jest.fn()} />);

    expect(screen.queryByTestId('heart-p1')).toBeNull();
    expect(screen.queryByTestId('heart-outline-p1')).toBeNull();
    expect(screen.queryByTestId('heart-filled-p1')).toBeNull();
  });

  it('R7a · 안 담김 = 빈 하트 + 선택 아님', () => {
    withSave({ saved: false });

    expect(screen.getByTestId('heart-outline-p1')).toBeOnTheScreen();
    expect(screen.queryByTestId('heart-filled-p1')).toBeNull();
    expect(screen.getByTestId('heart-p1')).not.toBeSelected();
  });

  it('R7b · 담김 = 찬 하트 + 선택됨 (색이 아니라 서로 다른 글리프로 갈린다)', () => {
    withSave({ saved: true });

    expect(screen.getByTestId('heart-filled-p1')).toBeOnTheScreen();
    expect(screen.queryByTestId('heart-outline-p1')).toBeNull();
    expect(screen.getByTestId('heart-p1')).toBeSelected();
  });

  it('R8 · 하트 press → onToggle 1회, 카드 이동(onPress)은 0회', () => {
    const { onToggle, onPress } = withSave();

    fireEvent.press(screen.getByTestId('heart-p1'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('R9 · 대기 중 하트는 disabled 이고, 눌러도 onToggle·카드 이동 모두 0회다', () => {
    const { onToggle, onPress } = withSave({ pending: true });

    expect(screen.getByTestId('heart-p1')).toBeDisabled();

    fireEvent.press(screen.getByTestId('heart-p1'));

    expect(onToggle).not.toHaveBeenCalled();
    // disabled 하트 press 는 부모 카드로 샌다 — 카드가 pending 을 보고 이동을 막아야 0 이다.
    expect(onPress).not.toHaveBeenCalled();
  });

  it('R10 · 하트는 32 흰 원이다(h-8·w-8·rounded-pill·bg-on-primary, 하트 32 통일 결정)', () => {
    withSave();

    const tokens = String(screen.getByTestId('heart-p1').props.className ?? '')
      .trim()
      .split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(['h-8', 'w-8', 'rounded-pill', 'bg-on-primary'])
    );
  });
});
