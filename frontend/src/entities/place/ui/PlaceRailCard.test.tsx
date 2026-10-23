import { render, screen, fireEvent } from '@testing-library/react-native';

import type { PlaceCardVM } from '@/entities/place/model';
import { coverFor, FALLBACK_COVER } from '@/test-support/placeCoverFixtures';

import { PlaceRailCard } from './PlaceRailCard';

/**
 * TRIP-806 · AC-M2·M4 — d01 탐색 랜딩의 "가볼 곳" 레인 카드(160폭)를 entities 로 모은다(TRIP-1105 로
 * d05 목적지 상세는 d01 지역 필터로 합쳐졌다).
 *
 * 무엇을 보장하나(현행 소비처가 쓰던 testID·표시를 그대로 재현):
 *  - 🔴 루트 testID `explore-place-card-{poiId}` · 이름 · 지역.
 *  - 🔴 사진 칸 `explore-place-card-image-{poiId}` 는 항상 있다 — `imageUrl` 이 있으면 그 사진, 없으면(사이클
 *    20261022-place-category-covers) 카드의 카테고리·poiId 로 고른 카테고리 생성 이미지.
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
    // 서버 사진이 있으면 카테고리와 무관하게 그 사진 그대로(호출부 기존 동작 불변).
    expect(
      screen.getByTestId('explore-place-card-image-p1').props.source
    ).toEqual([{ uri: 'https://example.com/gamcheon.jpg' }]);
    expect(screen.getByText('감천문화마을')).toBeTruthy();
    expect(screen.getByText('부산 사하구')).toBeTruthy();
  });

  it('R2 · 이미지 없으면 그 카드의 카테고리(술집)·poiId(p1) 로 고른 생성 이미지를 그린다', () => {
    const onPress = jest.fn();
    render(
      <PlaceRailCard
        card={{ ...VM, imageUrl: null, category: '술집' }}
        onPress={onPress}
      />
    );

    expect(screen.getByTestId('explore-place-card-p1')).toBeTruthy();
    // 'p1' 의 FNV-1a % 3 + 1 = 변형 2 → bar-2. 맛집(food-2)이 나오면 카테고리를 엉뚱하게 넘긴 것이다.
    expect(
      screen.getByTestId('explore-place-card-image-p1').props.source
    ).toEqual([coverFor('술집', 'p1')]);
    expect(screen.getByText('감천문화마을')).toBeTruthy();
  });

  it('R2b · 카드에 카테고리가 없으면(옛 호출부) 중립 폴백 place.webp 이다', () => {
    render(
      <PlaceRailCard card={{ ...VM, imageUrl: null }} onPress={jest.fn()} />
    );

    expect(
      screen.getByTestId('explore-place-card-image-p1').props.source
    ).toEqual([FALLBACK_COVER]);
  });

  it('R3 · 카드 press → onPress(poiId)', () => {
    const onPress = jest.fn();
    render(<PlaceRailCard card={VM} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('explore-place-card-p1'));

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
});

// TRIP-1281 — d01 장소 레인: 하트는 "{이름} 저장", 카드는 보이는 글자 그대로의 명시 라벨(지금은 라벨이 없어
// iOS 가 하트의 "담기" 를 카드 라벨 맨 앞에 붙여 읽는다 — 병합 자체는 실기 몫).
describe('저장 하트·카드 접근성 라벨 (d01 장소 레인)', () => {
  function renderWithSave(card: PlaceCardVM, saved: boolean) {
    render(
      <PlaceRailCard
        card={card}
        onPress={jest.fn()}
        save={{
          saved,
          pending: false,
          onToggle: jest.fn(),
          testID: 'heart-p1',
          filledTestID: 'heart-filled-p1',
          outlineTestID: 'heart-outline-p1',
        }}
      />
    );
  }

  it.each([false, true])(
    '하트는 담김=%s 여도 "감천문화마을 저장" 으로 읽히고 selected 는 담김을 따른다',
    (saved) => {
      renderWithSave(VM, saved);

      const heart = screen.getByTestId('heart-p1');
      expect(heart).toHaveAccessibleName('감천문화마을 저장');
      expect(screen.getByLabelText('감천문화마을 저장').props.testID).toBe(
        'heart-p1'
      );
      if (saved) expect(heart).toBeSelected();
      else expect(heart).not.toBeSelected();
    }
  );

  it('카드는 담겨 있어도 "이름, 지역" 으로 읽힌다(담기·저장·담음 없음)', () => {
    renderWithSave(VM, true);

    expect(screen.getByTestId('explore-place-card-p1')).toHaveAccessibleName(
      '감천문화마을, 부산 사하구'
    );
  });

  it('지역이 빈 문자열이면 카드 라벨은 이름만이다', () => {
    renderWithSave({ ...VM, region: '' }, false);

    expect(screen.getByTestId('explore-place-card-p1')).toHaveAccessibleName(
      '감천문화마을'
    );
    // 라벨 없이 글자만 이어 붙여도 위 이름은 같아진다 — 카드 자신의 명시 라벨인지 따로 본다.
    expect(screen.getByLabelText('감천문화마을').props.testID).toBe(
      'explore-place-card-p1'
    );
  });
});
