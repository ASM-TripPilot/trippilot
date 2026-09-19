import {
  render,
  screen,
  fireEvent,
  within,
} from '@testing-library/react-native';

import { StaySearchCard } from './StaySearchCard';

/**
 * TRIP-807 · AC-3 — entities/stay/ui/StaySearchCard: 검색 풀/레인 카드(e02·d01·d05 공용).
 *
 * 무엇을 보장하나:
 *  - 🔴 이름·지역·가격 텍스트를 완전 일치로 그린다(§5-A) + 사진은 회색 자리(계약에 이미지 필드가 없어
 *    URL 을 지어내지 않는다 · INV-1 · ★10).
 *  - 🔴 담김/미담김을 **fill 색이 아니라 서로 다른 글리프 testID + accessibilityState.selected** 로
 *    관측한다(글리프 fill 함정 회피, ★5).
 *  - 🔴 응답 대기(pending) 하트는 진짜 `disabled` — 눌러도 onToggle 이 안 불린다(연타 가드).
 *  - 🔴 하트 press 는 카드 push 를 삼키지 않는다(★F-4 계열) — 저장과 상세 진입이 갈린다.
 *  - 🔴 testID 스킴은 소비처가 **명시 문자열**로 주입한다(e02 `stay-card-save-*-filled` vs d01
 *    `explore-stay-heart-filled-*` 로 스킴이 갈려 단일 prefix 로 재현 불가, ★3). 카드는 여분 testID 를
 *    안 낸다(프로즌 카드 카운트 정규식 보호).
 *
 * *(개념)* `accessibilityState={{selected}}` — 화면 리더가 읽는 "선택됨" 상태. 색(SVG fill)은 jest
 *  렌더 트리에 안 남지만 이 상태는 남아, 담김을 색이 아니라 상태로 잰다(`toBeSelected()`).
 *
 * 3동작 뼈대: 준비=props(명시 testID·variant·save) → 실행=render/press → 단언=testID·텍스트·상태.
 */

// e02(full) 계약 예시 — 소비처가 이 문자열들을 조립해 넘긴다.
const E02_SAVE = {
  saved: false,
  pending: false,
  onToggle: jest.fn(),
  testID: 'stay-card-save-NAVER:s1',
  filledTestID: 'stay-card-save-NAVER:s1-filled',
  outlineTestID: 'stay-card-save-NAVER:s1-outline',
};

function classTokens(node: { props: { className?: string } }): string[] {
  return (node.props.className ?? '').trim().split(/\s+/);
}

describe('🔴 SC1 · full variant 렌더 (이름·지역·가격·사진 자리)', () => {
  it('root·photo testID + 텍스트 완전 일치 + 사진 회색 자리(surface-strong)', () => {
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        photoTestID="stay-card-photo-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="full"
        save={E02_SAVE}
      />
    );

    const card = screen.getByTestId('stay-card-NAVER:s1');
    expect(within(card).getByText('해운대 오션뷰')).toBeOnTheScreen();
    // AC-4 — 지역 단독(거리 계약 공백, StayItem 에 distanceM 없음). "지역·거리" 구조는 허용하되
    // 값이 없으니 지역만 그린다 = 현행. 선제 green 회귀 앵커.
    expect(within(card).getByText('부산 해운대구')).toBeOnTheScreen();

    // AC-2 — 가격 2톤: bold "{천단위}원"(ink16) + muted "~"(muted12) **두 형제 노드**.
    // formatPrice 반환("120,000원~")은 불변, 분할은 카드 몫. (개념) getByText 는 기본 완전일치라
    // 단일 결합 노드 "120,000원~"은 두 형제로 쪼개지면 매칭되지 않는다(§5 실검증).
    const boldPrice = within(card).getByText('120,000원');
    expect(boldPrice).toBeOnTheScreen();
    expect(classTokens(boldPrice)).toEqual(
      expect.arrayContaining(['text-ink', 'font-bold', 'text-[16px]'])
    );
    const mutedTilde = within(card).getByText('~');
    expect(classTokens(mutedTilde)).toEqual(
      expect.arrayContaining(['text-muted', 'text-caption'])
    );
    expect(classTokens(mutedTilde)).not.toContain('font-bold');
    // 반증 — 단일 결합 노드가 아니다(두 Text 가 View 형제라 경계에서 집계 안 됨, ★F-1).
    expect(within(card).queryByText('120,000원~')).toBeNull();

    const photo = within(card).getByTestId('stay-card-photo-NAVER:s1');
    expect(classTokens(photo)).toEqual(
      expect.arrayContaining(['bg-surface-strong'])
    );
  });
});

describe('🔴 SC2 · 미담김 — outline 글리프 + selected false', () => {
  it('outline present · filled 부재 · save 버튼 selected 아님', () => {
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="full"
        save={{ ...E02_SAVE, saved: false }}
      />
    );

    expect(
      screen.getByTestId('stay-card-save-NAVER:s1-outline')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-card-save-NAVER:s1-filled')).toBeNull();
    expect(screen.getByTestId('stay-card-save-NAVER:s1')).not.toBeSelected();
  });
});

describe('🔴 SC3 · 담김 — filled 글리프 + selected true', () => {
  it('filled present · outline 부재 · save 버튼 selected', () => {
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="full"
        save={{ ...E02_SAVE, saved: true }}
      />
    );

    expect(
      screen.getByTestId('stay-card-save-NAVER:s1-filled')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-card-save-NAVER:s1-outline')).toBeNull();
    expect(screen.getByTestId('stay-card-save-NAVER:s1')).toBeSelected();
  });
});

describe('🔴 SC4 · pending 연타 가드', () => {
  it('pending 하트는 disabled — 눌러도 onToggle 0회', () => {
    const onToggle = jest.fn();
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="full"
        save={{ ...E02_SAVE, onToggle, pending: true }}
      />
    );

    const save = screen.getByTestId('stay-card-save-NAVER:s1');
    expect(save).toBeDisabled();
    fireEvent.press(save);
    expect(onToggle).toHaveBeenCalledTimes(0);
  });
});

describe('🔴 SC5 · 하트 press 와 카드 press 가 갈린다 (★F-4 계열)', () => {
  it('하트 press → onToggle 1회·onPress 0회 / 카드 press → onPress 1회', () => {
    const onToggle = jest.fn();
    const onPress = jest.fn();
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="full"
        save={{ ...E02_SAVE, onToggle, pending: false }}
        onPress={onPress}
      />
    );

    fireEvent.press(screen.getByTestId('stay-card-save-NAVER:s1'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(0);

    fireEvent.press(screen.getByTestId('stay-card-NAVER:s1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 SC6 · rail variant (d05) — save 미지정 시 하트 없음', () => {
  it('save 미지정이면 저장 Pressable·글리프가 안 그려진다', () => {
    render(
      <StaySearchCard
        testID="destination-detail-stay-card-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="rail"
      />
    );

    expect(
      screen.getByTestId('destination-detail-stay-card-NAVER:s1')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-card-save-NAVER:s1')).toBeNull();
    expect(screen.queryByTestId('stay-card-save-NAVER:s1-outline')).toBeNull();
  });
});

describe('🔴 SC7 · 여분 testID 0 (프로즌 카드 카운트 정규식 보호)', () => {
  it('카드 하위 testID 는 root·photo·save·outline 뿐 — 이름/지역/가격에 testID 없음', () => {
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        photoTestID="stay-card-photo-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="full"
        save={{ ...E02_SAVE, saved: false }}
      />
    );

    const card = screen.getByTestId('stay-card-NAVER:s1');
    // host 필터 필수 — RN 의 View/Pressable/Svg forwardRef 가 testID 를 합성 노드와 host 노드
    // 양쪽에 복제해, 필터 없이 세면 개수가 ~2.5배로 잡힌다(raw=10 vs hostOnly=4). 리포 표준
    // `PlaceExploreScreen.test.tsx:127`(`typeof node.type === 'string'`)과 동일(02a ★18).
    const ids = card
      .findAll((n) => typeof n.type === 'string' && n.props.testID != null)
      .map((n) => n.props.testID)
      .sort();
    expect(ids).toEqual(
      [
        'stay-card-NAVER:s1',
        'stay-card-photo-NAVER:s1',
        'stay-card-save-NAVER:s1',
        'stay-card-save-NAVER:s1-outline',
      ].sort()
    );
  });
});

describe('🔴 SC8 · full variant 결측 가격 — "가격 미확인" muted regular (AC-3)', () => {
  it('단일 노드로 muted·regular·14 로 그린다(현행 bold ink 16 → muted 14)', () => {
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="가격 미확인"
        variant="full"
        save={E02_SAVE}
      />
    );

    const card = screen.getByTestId('stay-card-NAVER:s1');
    const missing = within(card).getByText('가격 미확인');
    // muted·14(text-body)·regular — bold ink 아님.
    expect(classTokens(missing)).toEqual(
      expect.arrayContaining(['text-muted', 'text-body'])
    );
    expect(classTokens(missing)).not.toContain('font-bold');
    expect(classTokens(missing)).not.toContain('text-ink');
    // 결측 카드엔 "~"(2톤 접미)가 없다 — 2톤 분기로 새지 않는다.
    expect(within(card).queryByText('~')).toBeNull();
  });
});

describe('🔴 SC9 · full variant 저장 하트 — 흰 원형 배경 (AC-5)', () => {
  it('저장 Pressable 이 흰 원(on-primary bg + rounded-pill) 위에 얹힌다', () => {
    render(
      <StaySearchCard
        testID="stay-card-NAVER:s1"
        name="해운대 오션뷰"
        region="부산 해운대구"
        priceText="120,000원~"
        variant="full"
        save={E02_SAVE}
      />
    );

    // 흰 원 배경 = className 으로 잠근다(fill 색이 아니라 — 흰 원 지름·우32/상14 위치는 픽셀,
    // ★F-4 6-b 몫). rail(d05)엔 이미 있던 토큰이라 full 분기 추가가 이 사이클의 실질(★F-3).
    expect(classTokens(screen.getByTestId('stay-card-save-NAVER:s1'))).toEqual(
      expect.arrayContaining(['bg-on-primary', 'rounded-pill', 'absolute'])
    );
  });
});
