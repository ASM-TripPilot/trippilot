import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { stayKey } from '../model/stayKey';
import { StaySearchScreen } from './StaySearchScreen';

/**
 * TRIP-417 AC-1·AC-2·AC-3·AC-8·AC-10 — 숙소 검색 카드의 저장 하트 **렌더 계약**.
 *
 * 무엇을 보장하나: `StaySearchScreen`은 옵셔널 prop 3개(`savedKeys`·`onToggleSave`·`pendingKeys`)만
 * 더 받아, 각 카드 하트를 **채움/빈으로 그리고**(AC-3) 누름을 **item 그대로 콜백으로 올린다**(AC-1·2).
 * 저장/해제 판정·네트워크는 여전히 페이지 몫이다(화면은 라우터·훅을 모른다 — 구조 가드가 잠금).
 *
 * *(개념)* 빈/찬 하트는 **색(SVG fill)으로 안 잰다** — repo-trap: `*Glyphs.tsx`의 fill 변화는 jest
 * 렌더 트리에 안 남아 "저장됐다는 거짓말"이 통과한다. 대신 두 신호로 잰다:
 *   ① **컴포넌트 정체성** — 빈=`HeartOutlineGlyph`, 찬=`HeartFilledGlyph`로 **서로 다른 컴포넌트**다.
 *      각자 다른 testID(`stay-card-save-{key}-outline` / `-filled`)를 달아 어느 쪽이 그려졌나를 잰다.
 *      testID를 `save-` 하위에 둔 이유: 동결 `StaySearchScreen.test.tsx`의 카드 카운트 정규식
 *      `/^stay-card-(?!save-|photo-)/`에 안 걸리게(그 짝을 안 지키면 동결 테스트가 red — 02a §4 F-1).
 *   ② **accessibilityState.selected** — `toBeSelected()`가 읽는 접근성 상태(담김=선택됨, AC-10).
 * 하나만 맞고 하나만 틀린 구현(selected=false인데 찬 하트)도 잡으려 둘 다 건다(d02 T-15 동형).
 *
 * 왜 화면 단위인가: "props를 받았을 때 무엇을 그리는가"를 잰다. 실제로 나간 요청·저장/해제 판정·
 * 라우팅은 `pages/stay-search/ui/StaySearchPage.save.integration.test.tsx` 몫이다.
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
  {
    externalSource: 'AGODA',
    externalId: 's3',
    name: '광안리 오션뷰',
    lat: 35.1531,
    lng: 129.1186,
    region: '광안리',
    amenities: ['ocean'],
    stayType: 'PENSION',
    price: { amount: 20000, currency: 'KRW' },
  },
];

const KEY_A = stayKey(ITEMS[0]);
const KEY_B = stayKey(ITEMS[1]);

describe('S1 · 채움/빈 하트 정체성 + selected (AC-3 · AC-10)', () => {
  it('savedKeys에 든 카드만 찬 하트(+selected)이고 나머지는 빈 하트(+not selected)다', () => {
    // 준비 — A만 담김.
    render(
      <StaySearchScreen region="부산" items={ITEMS} savedKeys={[KEY_A]} />
    );

    // 단언 ① 담김 카드 A: 찬 하트 컴포넌트가 있고 빈 하트는 없다 + selected=true.
    expect(
      screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`stay-card-save-${KEY_A}-outline`)).toBeNull();
    expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeSelected();

    // 단언 ② 미담김 카드 B: 빈 하트가 있고 찬 하트는 없다 + selected=false.
    expect(
      screen.getByTestId(`stay-card-save-${KEY_B}-outline`)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`stay-card-save-${KEY_B}-filled`)).toBeNull();
    expect(screen.getByTestId(`stay-card-save-${KEY_B}`)).not.toBeSelected();
  });
});

describe('S2 · 하트 누름은 item을 그대로 올린다 (AC-1 · AC-2)', () => {
  it('찬 하트든 빈 하트든 press → onToggleSave(item) 한 번 (저장/해제 판정은 페이지 몫)', () => {
    // 준비 — A는 찬 하트, B는 빈 하트.
    const onToggleSave = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        savedKeys={[KEY_A]}
        onToggleSave={onToggleSave}
      />
    );

    // 실행 — 찬 하트(A) 누르고, 빈 하트(B) 누른다.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_B}`));

    // 단언 — 화면은 저장/해제를 구분하지 않고 눌린 item만 순서대로 올린다.
    expect(onToggleSave.mock.calls).toEqual([[ITEMS[0]], [ITEMS[1]]]);
  });
});

describe('S3 · 연타 가드 — 대기 중 하트는 disabled (AC-8)', () => {
  it('pendingKeys에 든 하트는 눌러도 콜백이 안 오고, 나머지는 정상 동작한다', () => {
    // 준비 — A만 응답 대기 중.
    const onToggleSave = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        savedKeys={[]}
        onToggleSave={onToggleSave}
        pendingKeys={[KEY_A]}
      />
    );

    // 단언 ① — 대기 중 하트는 비활성 상태다(accessibilityState.disabled).
    expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeDisabled();
    expect(screen.getByTestId(`stay-card-save-${KEY_B}`)).not.toBeDisabled();

    // 실행 — 대기 중 A를 눌러도(비활성이라 press가 onPress를 안 부른다, 02a §5-3 실측), B는 부른다.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));
    expect(onToggleSave).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_B}`));
    expect(onToggleSave.mock.calls).toEqual([[ITEMS[1]]]);
  });
});

describe('S4 · 신 prop 미지정 무회귀 (2-prop)', () => {
  it('savedKeys·onToggleSave를 안 주면 전 카드가 빈 하트·not selected이고 눌러도 안 죽는다', () => {
    // 준비 — 기존 2-prop 호출 형태 그대로.
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    // 단언 — 미지정이면 전부 빈 하트(찬 하트 0건)·not selected(무회귀 — 저장 API 없을 때 채워진
    // 하트를 그리면 거짓말이다).
    ITEMS.forEach((item) => {
      const key = stayKey(item);
      expect(
        screen.getByTestId(`stay-card-save-${key}-outline`)
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(`stay-card-save-${key}-filled`)).toBeNull();
      expect(screen.getByTestId(`stay-card-save-${key}`)).not.toBeSelected();
    });

    // 콜백이 없어도 press가 throw하지 않는다(정직한 스텁 — onPress 부재).
    expect(() =>
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`))
    ).not.toThrow();
  });
});
