import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { PlaceRowCard } from './PlaceRowCard';

/**
 * TRIP-806 · AC-M2·M4(d02)·M5(h13) — 썸네일+이름+부제 행 카드를 entities 로 모은다.
 *
 * ⚠️ 이 테스트는 행 카드의 **자기 계약**(중립 접두)만 잠근다. d02(순번·배지·지역·태그·하트, savedPlaceId)
 *   와 h13(#태그·카테고리 메타·추가 버튼, poiId)의 **바이트 재현**은 무수정 소비처 테스트가 심판한다
 *   (02a ★8) — 두 소비처는 접두·루트 접미(`item` vs `card`)·구조가 달라 하나로 강제하지 않는다.
 *
 * 무엇을 보장하나:
 *  - 🔴 `testIDPrefix` 로 루트 `{prefix}-{id}` 를 만든다(소비처가 자기 접두 주입).
 *  - 🔴 `save?` 를 주면 하트를 그린다 — 담김/미담김은 **서로 다른 글리프 testID**(`-heart-filled/outline-{id}`)
 *    + `accessibilityState.selected` 로 잰다(색 토글 아님, 글리프 fill 함정 회피 02a ★5). 하트 press → onToggle.
 *  - 🔴 `trailing?` 슬롯(h13 추가 버튼 자리)을 그대로 렌더한다. `save` 없으면 하트를 안 그린다.
 *  - 🔴 `subtitle` 은 ReactNode 슬롯(소비처가 지역·태그 or 메타 조립).
 *  - 🔴 `imageUrl` null 이면 회색 자리(INV-1).
 *
 * 3동작 뼈대: 준비=prop → 실행=렌더/press → 단언=testID·selected·콜백.
 */

describe('🔴 PlaceRowCard (AC-M2·M4·M5 — 중립 접두 자기 계약)', () => {
  it('W1 · save(담김) → filled 하트 + selected, outline 부재', () => {
    const onToggle = jest.fn();
    render(
      <PlaceRowCard
        testIDPrefix="place-row"
        id="p1"
        name="해운대 해변"
        imageUrl={null}
        subtitle={<Text>부산 · 골목</Text>}
        save={{ saved: true, onToggle }}
      />
    );

    expect(screen.getByTestId('place-row-p1')).toBeTruthy();
    expect(screen.getByText('해운대 해변')).toBeTruthy();
    expect(screen.getByText('부산 · 골목')).toBeTruthy();
    expect(screen.getByTestId('place-row-heart-filled-p1')).toBeTruthy();
    expect(screen.queryByTestId('place-row-heart-outline-p1')).toBeNull();
    expect(screen.getByTestId('place-row-remove-p1')).toBeSelected();
  });

  it('W2 · save(미담김) → outline 하트 + not selected, filled 부재', () => {
    render(
      <PlaceRowCard
        testIDPrefix="place-row"
        id="p1"
        name="해운대 해변"
        save={{ saved: false, onToggle: jest.fn() }}
      />
    );

    expect(screen.getByTestId('place-row-heart-outline-p1')).toBeTruthy();
    expect(screen.queryByTestId('place-row-heart-filled-p1')).toBeNull();
    expect(screen.getByTestId('place-row-remove-p1')).not.toBeSelected();
  });

  it('W3 · 하트 press → onToggle 1회', () => {
    const onToggle = jest.fn();
    render(
      <PlaceRowCard
        testIDPrefix="place-row"
        id="p1"
        name="해운대 해변"
        save={{ saved: true, onToggle }}
      />
    );

    fireEvent.press(screen.getByTestId('place-row-remove-p1'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('W4 · trailing 슬롯을 그린다(h13 추가 버튼 자리), save 없으면 하트 없음', () => {
    render(
      <PlaceRowCard
        testIDPrefix="place-row"
        id="p1"
        name="감천문화마을"
        trailing={<Text testID="row-add">추가</Text>}
      />
    );

    expect(screen.getByTestId('row-add')).toBeTruthy();
    expect(screen.queryByTestId('place-row-remove-p1')).toBeNull();
  });

  it('W5 · imageUrl 있으면 사진 leaf 를 그린다', () => {
    render(
      <PlaceRowCard
        testIDPrefix="place-row"
        id="p1"
        name="감천문화마을"
        imageUrl="https://example.com/x.jpg"
        save={{ saved: false, onToggle: jest.fn() }}
      />
    );

    expect(screen.getByTestId('place-row-photo-p1')).toBeTruthy();
  });
});
