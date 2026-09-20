import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { StayDetailScreen } from './StayDetailScreen';

/**
 * TRIP-727 (부모 TRIP-723) — e03 숙소 상세 default 를 Figma 1700:1183 에 정합한 **무상태 화면**의
 * 렌더 계약.
 *
 * 무엇을 보장하나: 손에 든 StayItem(계약 GET 부재, 01b Q1)으로 (1) 가격줄 2톤+지역(AC-1),
 * (2) 편의시설 4칸 flex-1·값별 아이콘(AC-2·AC-3), (3) 실 MapView 미니맵(viewOnly·단일핀, AC-4),
 * (4) 위치줄 지역(AC-5), (5) CTA2 아이콘(AC-6)을 그린다. 동작 계약(콜백·notFound·결측 미확인·
 * 탭바 없음)은 불변 — S2~S8 회귀 앵커(AC-8).
 *
 * *(개념 — 이번 사이클 매처·seam, 02a §5 실검증)*
 *  - `getByText(문자열)` = 노드 전체 텍스트 **완전일치** → 2톤 가격은 bold '145,000원'+muted '~'
 *    두 형제 Text(바깥 View)라 결합 노드 '145,000원~'은 `queryByText`로 안 잡힌다(StaySearchCard 선례).
 *  - 지역은 가격줄(AC-1 신규)·위치줄(AC-5 회귀) 두 곳 → `getByText(region)`는 다중매치로 throw 하므로
 *    가격줄은 `within(priceRow)`로 좁히고 공존은 `getAllByText(region)` 길이로 잰다.
 *  - MapView 는 `__mocks__/@mj-studio/react-native-naver-map`(prop-기록형 목, 자동 적용)이 map-native
 *    host View 로 props 를 노출 → center=`camera`, viewOnly=`is*GesturesEnabled` 4토글, 단일핀=map-marker
 *    (d06 PlaceDetailScreen 선례). 실 MapView 는 env 키가 있어야 map-native 를 그려 beforeEach 로 세운다.
 *  - 담김/미담김 하트는 색(SVG fill)이 아니라 별 글리프 testID(-filled/-outline)+`toBeSelected()`로 잰다.
 *  - 아이콘의 '어느 아이콘'은 `config/amenityIcons.test.ts`(참조 동일성)가, 색·tone·모양은 6-b 가
 *    잰다 — SVG stroke/shape 는 jest 사각(repo-traps §글리프). 여기선 아이콘 leaf 존재까지만.
 */

const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
// 분리 대입 형태(let 선언 + 별도 대입) — d06 PlaceDetailScreen.test.tsx 선례. `const X =
// process.env[동적키]` 결합 초기화는 expo/no-dynamic-env-var 에 걸린다(6-a lint 실측).
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  // 실 MapView 는 키가 있어야 map-native 를 그린다(없으면 map-failure). d06 선례.
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

// viewOnly 가 펼쳐지는 4토글 — 하나라도 누락되면 어느 축인지 드러나게 개별 단언(d06 선례).
const GESTURE_TOGGLES = [
  'isScrollGesturesEnabled',
  'isZoomGesturesEnabled',
  'isRotateGesturesEnabled',
  'isTiltGesturesEnabled',
] as const;

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

// 2톤 가격의 bold 노드 텍스트 — formatPrice 반환('145,000원~')에서 접미 '~'를 뗀 값(StaySearchCard 방식).
const BOLD_PRICE = formatPrice(ITEM.price).slice(0, -1); // '145,000원'
const FULL_PRICE = formatPrice(ITEM.price); // '145,000원~' — 결합 단일 노드는 없어야 한다

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

describe('S1 · 가격줄 — 이름·2톤 가격·지역 (AC-1 · AC-5 · BR-U1-12 · INV-3)', () => {
  it('이름·회색 사진자리·지도자리를 그리고 "· 1박" 접미가 없다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(screen.getByText(ITEM.name)).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-map')).toBeOnTheScreen();
    // 최저가 = '부터 가격'만, "· 1박" 접미 미부착(Q6, e02·d01 일관).
    expect(screen.queryByText(/1박/)).toBeNull();
  });

  it('가격줄이 2톤(bold 원 + muted ~) 두 형제이고 결합 단일 노드가 없다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const priceRow = screen.getByTestId('stay-detail-price-row');
    // bold '145,000원' + muted '~'(View 형제라 결합 집계 안 됨). 현행 단일 노드 → red.
    expect(within(priceRow).getByText(BOLD_PRICE)).toBeOnTheScreen();
    expect(within(priceRow).getByText('~')).toBeOnTheScreen();
    // 결합 단일 노드 '145,000원~'은 어디에도 없다(2톤 분할 확인).
    expect(screen.queryByText(FULL_PRICE)).toBeNull();
  });

  it('가격줄 우측에 지역이 붙고(justify-between), 지역은 위치줄에도 남는다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const priceRow = screen.getByTestId('stay-detail-price-row');
    // 가격줄 우측 지역(현행 가격줄엔 지역 없음 → red).
    expect(within(priceRow).getByText(ITEM.region)).toBeOnTheScreen();
    // 좌:가격 우:지역 — justify-between.
    expect(String(priceRow.props.className).split(/\s+/)).toContain(
      'justify-between'
    );
    // 지역은 가격줄(AC-1 신규) + 위치줄(AC-5 회귀 앵커) 두 곳에만 뜬다(이름 '해운대 오션 호텔'은
    // 완전일치 아님이라 안 세어진다).
    expect(screen.getAllByText(ITEM.region)).toHaveLength(2);
  });
});

describe('S2 · 편의시설 존재/결측 (AC-8 회귀 · BR-U1-18 빈칸 금지)', () => {
  it('편의시설이 있으면 값별 칩으로 그린다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(screen.getByTestId('stay-detail-amenity-ocean')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-amenity-wifi')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-detail-amenities-empty')).toBeNull();
  });

  it('편의시설이 비면 "미확인"을 그린다(빈칸 아님)', () => {
    render(
      <StayDetailScreen {...baseProps()} item={{ ...ITEM, amenities: [] }} />
    );

    expect(screen.getByTestId('stay-detail-amenities-empty')).toHaveTextContent(
      /미확인/
    );
    // 'amenity-' ≠ 'amenities-' 라 이 regex 는 결측 노드를 안 잡는다(§5 실검증).
    expect(screen.queryByTestId(/stay-detail-amenity-/)).toBeNull();
  });
});

describe('S2b · 편의시설 아이콘·4칸 균등 (AC-2 · AC-3)', () => {
  it('각 편의시설 칩이 값별 아이콘 leaf 를 그린다(어느 아이콘·색은 config/6-b)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(
      within(screen.getByTestId('stay-detail-amenity-ocean')).getByTestId(
        'stay-detail-amenity-icon-ocean'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-detail-amenity-wifi')).getByTestId(
        'stay-detail-amenity-icon-wifi'
      )
    ).toBeOnTheScreen();
  });

  it('미지 편의시설 값도 칩+아이콘(폴백)을 그린다', () => {
    render(
      <StayDetailScreen
        {...baseProps()}
        item={{ ...ITEM, amenities: ['사우나'] }}
      />
    );

    expect(screen.getByTestId('stay-detail-amenity-사우나')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-detail-amenity-사우나')).getByTestId(
        'stay-detail-amenity-icon-사우나'
      )
    ).toBeOnTheScreen();
  });

  it('칩이 flex-1(4칸 균등)이고 고정폭 w-[72px] 이 아니다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const chipClasses = String(
      screen.getByTestId('stay-detail-amenity-ocean').props.className
    ).split(/\s+/);
    expect(chipClasses).toContain('flex-1');
    expect(chipClasses).not.toContain('w-[72px]');
  });
});

describe('S3 · 저장 하트 정체성 (AC-8 회귀)', () => {
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

describe('S4·S5 · press 배선 (AC-8 회귀)', () => {
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

describe('S6 · 몰입 화면 = 탭바 없음 (AC-8 회귀)', () => {
  it('하단 탭바(shell-tabbar-root)가 없다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    // 짝 앵커 — 화면은 실제로 그려졌다(공허 통과 방지).
    expect(screen.getByTestId('stay-detail-root')).toBeOnTheScreen();
    // 부정 — affiliate-sheet 프레임의 BottomTab 을 복제하지 않는다(몰입).
    expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
  });
});

describe('S7 · 인라인 제휴 고지 (AC-8 회귀)', () => {
  it('하단 액션에 제휴 고지가 있다(정확 문구는 시트가 담당)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(
      screen.getByTestId('stay-detail-affiliate-notice')
    ).toBeOnTheScreen();
  });
});

describe('S8 · 파싱 실패 얼굴 (AC-8 회귀 · INV-4)', () => {
  it('item 이 null 이면 notFound 를 그리고 상세 내용·버튼이 없다', () => {
    render(<StayDetailScreen {...baseProps()} item={null} />);

    expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
    expect(screen.queryByText(ITEM.name)).toBeNull();
    expect(screen.queryByTestId('stay-detail-book')).toBeNull();
  });
});

describe('S9 · 위치 지도 = 실 MapView (AC-4 · US-STAY-03 · INV-4)', () => {
  it('stay-detail-map 안이 정적 자리가 아니라 실 MapView(map-native)다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const map = screen.getByTestId('stay-detail-map');
    // placeholder(MapPinGlyph) → 실 MapView. 현행 placeholder 라 red.
    expect(within(map).getByTestId('map-native')).toBeOnTheScreen();
  });

  it('viewOnly 가 전달돼 제스처 4토글이 개별로 전부 false 다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const native = within(screen.getByTestId('stay-detail-map')).getByTestId(
      'map-native'
    );
    // viewOnly 누락 시 토글이 undefined → red. 개별 단언으로 어느 토글인지 드러난다.
    for (const toggle of GESTURE_TOGGLES) {
      expect(native.props[toggle]).toBe(false);
    }
  });

  it('center 와 단일 핀이 item.lat/lng 로 전달된다(lat↔lng 스왑 방지)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const map = screen.getByTestId('stay-detail-map');
    const native = within(map).getByTestId('map-native');

    // center — lat/lng 를 뒤바꾸면(둘 다 number 라 tsc 통과) red.
    const camera = native.props.camera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(ITEM.lat);
    expect(camera.longitude).toBe(ITEM.lng);

    // 단일 핀(번호 1, d06 방식) 이 item 좌표에 찍힌다(경로선 없음 — pins.length<2).
    const markers = within(map).getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].props.latitude).toBe(ITEM.lat);
    expect(markers[0].props.longitude).toBe(ITEM.lng);
    expect(within(map).getByTestId('map-marker-pin-1')).toBeOnTheScreen();
  });
});

describe('S11 · CTA2 "일정에 추가" 아이콘 (AC-6)', () => {
  it('일정 추가 버튼이 아이콘 leaf 를 그린다(달력+ → +, 글리프 정체·tone 은 6-b)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    // 아이콘 leaf 존재까지 — PlusGlyph vs CalendarPlusGlyph·tone ink 는 SVG 라 jest 사각(6-b).
    expect(
      within(screen.getByTestId('stay-detail-addtotrip')).getByTestId(
        'stay-detail-addtotrip-icon'
      )
    ).toBeOnTheScreen();
  });
});
