import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { stayKey } from '../model/stayKey';
import { StaySearchScreen } from './StaySearchScreen';

/**
 * TRIP-457 AC-5(화면 절반) · AC-7 — e02 카드 탭 → 상세 이동 콜백 + 하트/카드 press 분리.
 *
 * 무엇을 보장하나: e02 `StaySearchScreen` 카드 루트가 press 되면(현재는 비-Pressable `View`라
 * 탭 계약 자체가 없다) `onPressCard?(item)` 를 올린다. 하트(내부 Pressable)를 누르면 저장 토글만
 * 되고 **카드 push 를 삼키지 않는다**(이벤트 분리) — 반대로 카드 루트를 누르면 저장 콜백은 안
 * 온다. 실제 push(어느 라우트로)는 페이지 몫(cardNav.integration).
 *
 * *(개념·★F-4)* RNTL `findEventHandler` 는 press 대상에서 **부모로만 올라가며 첫 onPress 에서
 * 멈춘다**(자식으로 하강 없음, fire-event.js 실측 §5). 하트·카드가 각자 onPress 를 가지면 서로의
 * 핸들러를 발화하지 않는다 — 그래서 아래 두 방향 단언이 성립한다. `onPressCard` 를 안 주면 카드
 * press 는 무동작(정직한 스텁).
 */

const ITEMS: StayItem[] = [
  {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 145000, currency: 'KRW' },
  },
  {
    externalSource: 'NAVER',
    externalId: 's2',
    name: '서면 시티 호텔',
    lat: 35.1577,
    lng: 129.0594,
    region: '서면',
    amenities: ['wifi'],
    stayType: 'HOTEL',
    price: { amount: 90000, currency: 'KRW' },
  },
];

const KEY_A = stayKey(ITEMS[0]);

describe('C1 · 카드 press = 상세 이동만 (AC-5 화면 절반)', () => {
  it('카드 루트 press → onPressCard(item), 저장 콜백은 안 온다', () => {
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        onPressCard={onPressCard}
        onToggleSave={onToggleSave}
      />
    );

    fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

    expect(onPressCard).toHaveBeenCalledWith(ITEMS[0]);
    expect(onToggleSave).not.toHaveBeenCalled();
  });
});

describe('C2 · 하트 press = 저장만, 카드 push 삼키지 않음 (AC-7)', () => {
  it('하트 press → onToggleSave(item), onPressCard 는 안 온다', () => {
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        onPressCard={onPressCard}
        onToggleSave={onToggleSave}
      />
    );

    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    expect(onToggleSave).toHaveBeenCalledWith(ITEMS[0]);
    expect(onPressCard).not.toHaveBeenCalled();
  });
});

describe('C3 · onPressCard 미지정 무회귀', () => {
  it('onPressCard 를 안 주면 카드 press 가 throw 하지 않는다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    expect(() =>
      fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`))
    ).not.toThrow();
  });
});
