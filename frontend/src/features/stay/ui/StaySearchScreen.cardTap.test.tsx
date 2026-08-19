import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { stayKey } from '../model/stayKey';
import { StaySearchScreen } from './StaySearchScreen';

/**
 * TRIP-420 AC-1·AC-2·AC-3·AC-4 — 숙소 검색 카드의 **탭→상세 콜백 계약**(화면 층).
 *
 * 무엇을 보장하나: `StaySearchScreen`은 옵셔널 prop `onPressCard?`를 하나 더 받아, 카드 본문을
 * 누르면 그 item을 콜백으로 올린다(AC-1). 카드 루트가 Pressable이 되면 그 안에 중첩된 저장
 * 하트를 눌렀을 때 press가 카드로 "떨어져" 상세로 튕기는 회귀가 열릴 수 있는데, 이 파일이 그
 * 갈림을 잠근다 — 활성 하트는 카드로 안 새고(AC-2), **대기(pending) 하트도 안 샌다**(AC-3, 이
 * 티켓의 날카로운 트립와이어). 라우팅·서버는 여전히 페이지 몫이다(화면은 라우터를 모른다 —
 * 동결 `staySearchStructure.test.ts`의 expo-router import 0이 AC-5를 이미 잠근다).
 *
 * *(개념)* **press 버블링** — RNTL `fireEvent.press`는 누른 노드에 `onPress`가 없으면 조상으로
 *   거슬러 올라가 가장 가까운 `onPress`를 부른다. 그래서 대기 하트의 `onPress`를 `undefined`로
 *   두거나 `disabled` prop을 쓰면(둘 다 해당 노드에 onPress가 없는 상태) press가 카드 루트로
 *   떨어져 `onPressCard`가 불려 버린다(02a §5 probe 실측). 이걸 막으려면 하트가 **항상 present한
 *   onPress를 갖고 몸통에서 pending을 가드**해야 한다 — AC-3가 바로 이 형태만 통과시킨다.
 *
 * *(개념)* **`onPressCard`는 아직 없는 prop이다** — 구현자가 추가한다. 지금 렌더에 넘겨도 RN이
 *   모르는 prop을 무시할 뿐이라 안 죽고(AC-1은 콜백 0회로 red), 구현이 배선하면 green이 된다.
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
    price: { amount: 30000, currency: 'KRW' },
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
    price: { amount: 10000, currency: 'KRW' },
  },
];

const KEY_A = stayKey(ITEMS[0]);
const KEY_B = stayKey(ITEMS[1]);

/** 카드 testID만 수집 — 동결 `StaySearchScreen.test.tsx:84`의 정규식을 복제한다
 * (`save-`·`photo-`는 lookahead로 제외해야 카드 3건이 9건으로 부풀지 않는다). */
function cardTestIds(): string[] {
  return screen
    .getAllByTestId(/^stay-card-(?!save-|photo-)/)
    .map((node) => String(node.props.testID));
}

describe('AC-1 · 카드 본문 press → onPressCard(item) 1회', () => {
  it('카드를 누르면 그 item이 정확히 한 번 콜백으로 올라간다', () => {
    // 준비 — 카드 목록 + onPressCard 목.
    const onPressCard = jest.fn();
    render(
      <StaySearchScreen region="부산" items={ITEMS} onPressCard={onPressCard} />
    );

    // 실행 — 첫 카드의 본문(루트)을 누른다.
    fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

    // 단언 — 눌린 item(통째로)이 딱 한 번 올라간다(deep 동치, save.test.tsx S2 관례).
    expect(onPressCard.mock.calls).toEqual([[ITEMS[0]]]);
  });
});

describe('AC-2 · 활성 하트 press → onToggleSave 만, onPressCard 안 섞임', () => {
  it('활성 하트는 저장 콜백만 부르고 카드 탭(상세 이동)은 안 부른다', () => {
    // 준비 — 두 콜백을 다 목으로 걸어 갈림을 관찰한다(양·음 짝).
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        onToggleSave={onToggleSave}
        onPressCard={onPressCard}
      />
    );

    // 실행 — 활성 하트를 누른다.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 단언 — 저장 콜백만 그 item으로 1회, 카드 탭은 0회(활성 하트는 press를 잡아 카드로 안 샘).
    expect(onToggleSave.mock.calls).toEqual([[ITEMS[0]]]);
    expect(onPressCard).not.toHaveBeenCalled();
  });
});

describe('AC-3 · 대기(pending) 하트 press → 두 콜백 다 안 부른다 (트립와이어)', () => {
  it('대기 하트는 카드로 새지 않는다 — 같은 카드 본문 탭은 여전히 onPressCard를 부른다', () => {
    // 준비 — A만 응답 대기 중.
    const onPressCard = jest.fn();
    const onToggleSave = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        pendingKeys={[KEY_A]}
        onToggleSave={onToggleSave}
        onPressCard={onPressCard}
      />
    );

    // 실행 ① — 대기 하트를 누른다(여기서 press가 카드로 떨어지면 안 된다).
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 실행 ② — 같은 카드의 본문을 누른다(공허통과 방지 짝 — onPressCard가 실제로 배선됐음을
    //           이 press가 증명한다).
    fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

    // 단언 — onPressCard는 본문 탭(실행②) 1회뿐이다. 대기 하트(실행①)가 카드로 버블링하면
    // 여기가 2회가 되어 red — 그게 `disabled` prop·`onPress={pending?undefined:…}` 함정이다
    // (02a §4-1 probe 실측). onToggleSave는 대기 가드에 막혀 한 번도 안 불린다.
    expect(onPressCard.mock.calls).toEqual([[ITEMS[0]]]);
    expect(onToggleSave).not.toHaveBeenCalled();
  });
});

describe('AC-4 · onPressCard 미지정 무회귀 (정직한 스텁)', () => {
  it('콜백을 안 주면 카드 press가 throw하지 않고, 카드 개수·하트가 그대로다', () => {
    // 준비 — 기존 2-prop 호출 형태 그대로(onPressCard 없음).
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    // 실행/단언 ① — 콜백이 없어도 press가 안 죽는다(옵셔널 체이닝 no-op).
    expect(() =>
      fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`))
    ).not.toThrow();

    // 단언 ② — 카드 개수가 items.length 그대로(신규 testID가 카운트를 부풀리지 않는다).
    expect(cardTestIds()).toEqual([`stay-card-${KEY_A}`, `stay-card-${KEY_B}`]);

    // 단언 ③ — 각 카드 하트가 여전히 present(카드 Pressable화가 하트를 삼키지 않는다).
    ITEMS.forEach((item) => {
      const key = stayKey(item);
      expect(screen.getByTestId(`stay-card-save-${key}`)).toBeOnTheScreen();
    });
  });
});
