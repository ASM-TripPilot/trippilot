import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { formatPrice } from '../model/formatPrice';
import { StayDetailScreen } from './StayDetailScreen';

/**
 * TRIP-457 AC-2·3·4·8·10·11·14 — e03 숙소 상세 **무상태 화면**의 렌더 계약.
 *
 * 무엇을 보장하나: `StayDetailScreen` 은 손에 든 `StayItem`(계약 GET 부재, 01b Q1)으로
 * 사진 자리·이름·가격·편의시설·미니맵 자리·제휴 고지·CTA 2종·저장 하트를 그린다. 저장/이동/
 * 라우팅 판정은 페이지 몫(화면은 콜백만) — 구조 가드가 useState·라우터·타feature import 0 을 잠근다.
 *
 * *(개념)*
 *  - 담김/미담김 하트는 **색(SVG fill)으로 안 잰다** — repo-trap: `*Glyphs.tsx` fill 은 jest 렌더
 *    트리에 안 남는다. 대신 **서로 다른 글리프 컴포넌트 = 다른 testID**(`-filled`/`-outline`) +
 *    `accessibilityState.selected`(=`toBeSelected()`) 두 신호로 잰다(★F-2 계열, save.test 동형).
 *  - `getByText(문자열)` = 노드 전체 텍스트 **완전일치**, `queryByText(/regex/)` = 부분 포함(§5 실측).
 *  - AC-14 몰입 화면 = 하단 탭바(`shell-tabbar-root`)가 **없다** — e02 검색화면(복제 탭바 있음)과 대비.
 */

const ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean', 'wifi'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};

function noop(): void {}

function baseProps() {
  return {
    item: ITEM,
    saved: false,
    onToggleSave: noop,
    onPressBook: noop,
    onPressAddToTrip: noop,
  };
}

describe('S1 · 상세 렌더 — 이름·가격·사진자리·미니맵 (AC-2·3 · Q6)', () => {
  it('이름·최저가(1박 접미 없음)·회색 사진자리·미니맵 자리·지역을 그린다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(screen.getByText(ITEM.name)).toBeOnTheScreen();
    // 최저가 = formatPrice 재사용(145,000원~). "· 1박" 접미 미부착(Q6, e02·d01 일관).
    expect(screen.getByText(formatPrice(ITEM.price))).toBeOnTheScreen();
    expect(screen.queryByText(/1박/)).toBeNull();
    // 사진 URL 필드가 계약에 없어 회색 자리표시(INV-1, 없는 URL 안 지어냄).
    expect(screen.getByTestId('stay-detail-hero')).toBeOnTheScreen();
    // 미니맵 = 정적 자리표시(Q5, i05 선례).
    expect(screen.getByTestId('stay-detail-map')).toBeOnTheScreen();
    // 위치 섹션은 지역만(거리·소요시간 데이터 없음 — INV-1·INV-3).
    expect(screen.getByTestId('stay-detail-root')).toHaveTextContent(
      new RegExp(ITEM.region)
    );
  });
});

describe('S2 · 편의시설 (AC-4 · BR-U1-18 빈칸 금지)', () => {
  it('편의시설이 있으면 칩으로 그린다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(screen.getByTestId('stay-detail-amenity-ocean')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-amenity-wifi')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-detail-amenities-empty')).toBeNull();
  });

  it('편의시설이 비면 "미확인" 을 그린다(빈칸 아님)', () => {
    render(
      <StayDetailScreen {...baseProps()} item={{ ...ITEM, amenities: [] }} />
    );

    expect(screen.getByTestId('stay-detail-amenities-empty')).toHaveTextContent(
      /미확인/
    );
    expect(screen.queryByTestId(/stay-detail-amenity-/)).toBeNull();
  });
});

describe('S3 · 저장 하트 정체성 (AC-11)', () => {
  it('담김이면 찬 하트(+selected), 미담김이면 빈 하트(+not selected)', () => {
    const { rerender } = render(
      <StayDetailScreen {...baseProps()} saved={true} />
    );

    expect(screen.getByTestId('stay-detail-save-filled')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-detail-save-outline')).toBeNull();
    expect(screen.getByTestId('stay-detail-save')).toBeSelected();

    rerender(<StayDetailScreen {...baseProps()} saved={false} />);

    expect(screen.getByTestId('stay-detail-save-outline')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-detail-save-filled')).toBeNull();
    expect(screen.getByTestId('stay-detail-save')).not.toBeSelected();
  });
});

describe('S4·S5 · press 배선 (AC-8 · AC-10 · AC-11)', () => {
  it('하트·예약하기·일정에추가 press 가 각 콜백을 한 번씩 부른다', () => {
    const onToggleSave = jest.fn();
    const onPressBook = jest.fn();
    const onPressAddToTrip = jest.fn();
    render(
      <StayDetailScreen
        {...baseProps()}
        onToggleSave={onToggleSave}
        onPressBook={onPressBook}
        onPressAddToTrip={onPressAddToTrip}
      />
    );

    fireEvent.press(screen.getByTestId('stay-detail-save'));
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-detail-addtotrip'));

    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onPressBook).toHaveBeenCalledTimes(1);
    expect(onPressAddToTrip).toHaveBeenCalledTimes(1);
  });
});

describe('S6 · 몰입 화면 = 탭바 없음 (AC-14)', () => {
  it('하단 탭바(shell-tabbar-root)가 없다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    // 짝 앵커 — 화면은 실제로 그려졌다(공허 통과 방지).
    expect(screen.getByTestId('stay-detail-root')).toBeOnTheScreen();
    // 부정 — affiliate-sheet 프레임의 BottomTab 을 복제하지 않는다(몰입).
    expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
  });
});

describe('S7 · 인라인 제휴 고지 (AC-8 화면 절반)', () => {
  it('하단 액션에 제휴 고지가 있다(정확 문구는 시트가 담당)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(
      screen.getByTestId('stay-detail-affiliate-notice')
    ).toBeOnTheScreen();
  });
});

describe('S8 · 파싱 실패 얼굴 (AC-2 · INV-4)', () => {
  it('item 이 null 이면 notFound 를 그리고 상세 내용·버튼이 없다', () => {
    render(<StayDetailScreen {...baseProps()} item={null} />);

    expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
    expect(screen.queryByText(ITEM.name)).toBeNull();
    expect(screen.queryByTestId('stay-detail-book')).toBeNull();
  });
});
