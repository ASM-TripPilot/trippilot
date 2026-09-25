import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { StayDetail } from '@/shared/api/generated/schemas';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { StayDetailScreen } from './StayDetailScreen';

/**
 * TRIP-727 (부모 TRIP-723) — e03 숙소 상세 default 를 Figma 1700:1183 에 정합한 **무상태 화면**의
 * 렌더 계약. TRIP-940 — 데이터 출처가 `item` param 에서 서버 조회 `GET /stays/{stayId}` 로 바뀌며
 * 화면 입력이 `item: StayItem | null` → **`state` 판별 유니온**(loading·ready·notFound·invalid·error)
 * 으로 바뀌었다(01b D0·Q2).
 *
 * 무엇을 보장하나: ready 얼굴은 조회 결과(StayDetail)로 (1) 가격줄 2톤+지역(AC-1), (2) 편의시설
 * 4칸 flex-1·값별 아이콘(AC-2·AC-3), (3) 실 MapView 미니맵(viewOnly·단일핀, AC-4), (4) 지도 아래
 * **주소·전화·객실** 줄(TRIP-940 AC-1·Q1), (5) CTA2 아이콘(AC-6)을 그린다. 결측은 "미확인"이되
 * 전화만은 줄째 비운다(TRIP-940 AC-2). ready 가 아닌 네 얼굴은 서로 다른 testID 를 갖고, 모두
 * 뒤로 버튼을 가지며, 재시도는 네트워크 오류 얼굴에만 있다(TRIP-940 AC-4~7·9, Q2).
 *
 * *(개념 — 이번 사이클 매처·seam, 02a §5 실검증)*
 *  - `getByText(문자열)` = 노드 전체 텍스트 **완전일치** → 2톤 가격은 bold '145,000원'+muted '~'
 *    두 형제 Text(바깥 View)라 결합 노드 '145,000원~'은 `queryByText`로 안 잡힌다(StaySearchCard 선례).
 *  - `toHaveTextContent(/정규식/)` = 행 안 텍스트를 이어 붙인 뒤 **부분 포함** 검사 → 주소·전화·
 *    객실 줄은 라벨과 값이 한 Text 든 두 Text 든 통과한다(문자열을 주면 완전일치라 쓰지 않는다).
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

// openapi `StayDetail` 계약 모양(필수 9 + 선택 4). 주소는 지역('해운대')을 부분으로 품지만
// 완전일치 매처라 지역 개수 세기에 안 섞인다(S1).
const DETAIL: StayDetail = {
  stayId: 'NAVER:s1',
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean', 'wifi'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
  address: '부산 해운대구 우동 1411-1',
  phone: '051-749-7000',
  rooms: 120,
};

// 2톤 가격의 bold 노드 텍스트 — formatPrice 반환('145,000원~')에서 접미 '~'를 뗀 값(StaySearchCard 방식).
const BOLD_PRICE = formatPrice(DETAIL.price).slice(0, -1); // '145,000원'
const FULL_PRICE = formatPrice(DETAIL.price); // '145,000원~' — 결합 단일 노드는 없어야 한다

// Q2 — 비정상 얼굴은 Figma e03 error(4514:2330)의 기존 문구를 그대로 쓴다.
const FAIL_TITLE = '숙소 정보를 불러올 수 없어요';
const FAIL_SUBTITLE = '다시 시도하거나 목록으로 돌아가세요';

function noop(): void {}

function ready(detail: StayDetail = DETAIL) {
  return { kind: 'ready', detail } as const;
}

function baseProps() {
  return {
    state: ready(),
    saved: false,
    onToggleSave: noop,
    onPressBook: noop,
    onPressAddToTrip: noop,
    onPressBack: noop,
    onPressPhone: noop,
    onRetry: noop,
  };
}

/** 렌더 트리를 위→아래(앞 형제 먼저)로 훑어 testID 를 나온 순서대로 모은다(devPreviewAffiliateNotice 선례). */
type JsonNode = { props?: { testID?: unknown }; children?: unknown[] | null };
function testIdsInOrder(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => testIdsInOrder(child, out));
  } else if (node && typeof node === 'object') {
    const { props, children } = node as JsonNode;
    if (typeof props?.testID === 'string') out.push(props.testID);
    if (children) testIdsInOrder(children, out);
  }
  return out;
}

describe('S1 · 가격줄 — 이름·2톤 가격·지역 (AC-1 · AC-5 · BR-U1-12 · INV-3)', () => {
  it('이름·회색 사진자리·지도자리를 그리고 "· 1박" 접미가 없다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(screen.getByText(DETAIL.name)).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-detail-map')).toBeOnTheScreen();
    // 최저가 = '부터 가격'만, "· 1박" 접미 미부착(Q6, e02·d01 일관).
    expect(screen.queryByText(/1박/)).toBeNull();
  });

  it('가격줄이 2톤(bold 원 + muted ~) 두 형제이고 결합 단일 노드가 없다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const priceRow = screen.getByTestId('stay-detail-price-row');
    // bold '145,000원' + muted '~'(View 형제라 결합 집계 안 됨).
    expect(within(priceRow).getByText(BOLD_PRICE)).toBeOnTheScreen();
    expect(within(priceRow).getByText('~')).toBeOnTheScreen();
    // 결합 단일 노드 '145,000원~'은 어디에도 없다(2톤 분할 확인).
    expect(screen.queryByText(FULL_PRICE)).toBeNull();
  });

  it('가격줄 우측에 지역이 붙고(justify-between), 위치줄은 지역 대신 주소를 그린다 (TRIP-940 AC-1)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const priceRow = screen.getByTestId('stay-detail-price-row');
    // 가격줄 우측 지역(현행 유지).
    expect(within(priceRow).getByText(DETAIL.region)).toBeOnTheScreen();
    // 좌:가격 우:지역 — justify-between.
    expect(String(priceRow.props.className).split(/\s+/)).toContain(
      'justify-between'
    );
    // TRIP-940 — 지도 아래 줄이 지역 반복에서 주소로 바뀌었다(Figma 1700:1183 "📍 부산 해운대구 우동").
    // 그래서 지역은 가격줄 한 곳에만 뜬다(현행은 위치줄에도 떠서 2 → red).
    expect(screen.getAllByText(DETAIL.region)).toHaveLength(1);
    expect(screen.getByTestId('stay-detail-address')).toHaveTextContent(
      /부산 해운대구 우동 1411-1/
    );
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
      <StayDetailScreen
        {...baseProps()}
        state={ready({ ...DETAIL, amenities: [] })}
      />
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
        state={ready({ ...DETAIL, amenities: ['사우나'] })}
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

describe('S8 · 없는 숙소 얼굴 (TRIP-940 AC-5 · INV-4 — 구 "item null" 재작성)', () => {
  it('state 가 notFound 면 notFound 를 그리고 상세 내용·버튼이 없다', () => {
    render(<StayDetailScreen {...baseProps()} state={{ kind: 'notFound' }} />);

    expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
    expect(screen.queryByText(DETAIL.name)).toBeNull();
    expect(screen.queryByTestId('stay-detail-book')).toBeNull();
  });
});

describe('S9 · 위치 지도 = 실 MapView (AC-4 · US-STAY-03 · INV-4)', () => {
  it('stay-detail-map 안이 정적 자리가 아니라 실 MapView(map-native)다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const map = screen.getByTestId('stay-detail-map');
    expect(within(map).getByTestId('map-native')).toBeOnTheScreen();
  });

  it('viewOnly 가 전달돼 제스처 4토글이 개별로 전부 false 다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const native = within(screen.getByTestId('stay-detail-map')).getByTestId(
      'map-native'
    );
    for (const toggle of GESTURE_TOGGLES) {
      expect(native.props[toggle]).toBe(false);
    }
  });

  it('center 와 단일 핀이 detail.lat/lng 로 전달된다(lat↔lng 스왑 방지)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    const map = screen.getByTestId('stay-detail-map');
    const native = within(map).getByTestId('map-native');

    // center — lat/lng 를 뒤바꾸면(둘 다 number 라 tsc 통과) red.
    const camera = native.props.camera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(DETAIL.lat);
    expect(camera.longitude).toBe(DETAIL.lng);

    // 단일 핀(번호 1, d06 방식) 이 detail 좌표에 찍힌다(경로선 없음 — pins.length<2).
    const markers = within(map).getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].props.latitude).toBe(DETAIL.lat);
    expect(markers[0].props.longitude).toBe(DETAIL.lng);
    expect(within(map).getByTestId('map-marker-pin-1')).toBeOnTheScreen();
  });
});

describe('S11 · CTA2 "일정에 추가" 아이콘 (AC-6)', () => {
  it('일정 추가 버튼이 아이콘 leaf 를 그린다(달력+ → +, 글리프 정체·tone 은 6-b)', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(
      within(screen.getByTestId('stay-detail-addtotrip')).getByTestId(
        'stay-detail-addtotrip-icon'
      )
    ).toBeOnTheScreen();
  });
});

// ── TRIP-940 · 서버 조회 결과의 새 줄(주소·전화·객실)과 비정상 얼굴 ─────────────────

describe('S12 · 주소·전화·객실 줄 (TRIP-940 AC-1 · Q1)', () => {
  it('지도 아래에 주소 → 전화 → 객실 순으로 줄을 그리고, 그 다음이 제휴 고지다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    expect(screen.getByTestId('stay-detail-address')).toHaveTextContent(
      /부산 해운대구 우동 1411-1/
    );
    expect(screen.getByTestId('stay-detail-phone')).toHaveTextContent(
      /051-749-7000/
    );
    expect(screen.getByTestId('stay-detail-rooms')).toHaveTextContent(/120실/);

    // Q1 자리 — 위치 섹션(지도 아래 주소 줄) 바로 밑에 같은 스타일 2줄. 트리 순서로 잰다.
    const ids = testIdsInOrder(screen.toJSON());
    const at = (id: string) => ids.indexOf(id);
    expect(at('stay-detail-map')).toBeGreaterThanOrEqual(0);
    expect(at('stay-detail-address')).toBeGreaterThan(at('stay-detail-map'));
    expect(at('stay-detail-phone')).toBeGreaterThan(at('stay-detail-address'));
    expect(at('stay-detail-rooms')).toBeGreaterThan(at('stay-detail-phone'));
    expect(at('stay-detail-affiliate-notice')).toBeGreaterThan(
      at('stay-detail-rooms')
    );
  });
});

describe('S13 · 결측은 "미확인" (TRIP-940 AC-2 · BR-U1-14 · BR-U1-18)', () => {
  it('price·address·rooms 가 null 이면 가격 미확인·주소 미확인·객실 미확인을 그린다', () => {
    render(
      <StayDetailScreen
        {...baseProps()}
        state={ready({ ...DETAIL, price: null, address: null, rooms: null })}
      />
    );

    // 가격 — 현행 formatPrice 결측 문구(BR-U1-14, 화면을 막지 않는다).
    expect(screen.getByText('가격 미확인')).toBeOnTheScreen();
    // 주소·객실 — 줄은 남고 값 자리가 "미확인"(빈칸 금지, BR-U1-18).
    expect(screen.getByTestId('stay-detail-address')).toHaveTextContent(
      /미확인/
    );
    const rooms = screen.getByTestId('stay-detail-rooms');
    expect(rooms).toHaveTextContent(/미확인/);
    // "0실"·"null실" 같은 가짜 숫자가 새지 않는다.
    expect(rooms).not.toHaveTextContent(/실$/);
  });

  it('phone 이 null 이면 전화 줄이 아예 없고, "미확인" 문자열도 새로 생기지 않는다', () => {
    // 준비 — 전화만 null, 나머지 결측 후보(가격·주소·객실·편의시설)는 전부 채운다.
    render(
      <StayDetailScreen
        {...baseProps()}
        state={ready({ ...DETAIL, phone: null })}
      />
    );

    // 긍정 앵커 — ready 얼굴은 실제로 그려졌고 이웃 줄(객실)은 있다(얼굴째 사라진 공짜 green 차단).
    expect(screen.getByTestId('stay-detail-rooms')).toBeOnTheScreen();
    // 부정 — 전화 줄 부재(null = "모름"이지 "전화 없음"이 아니라 줄을 비운다, 계약 설명문).
    expect(screen.queryByTestId('stay-detail-phone')).toBeNull();
    // 부정 — 전화 자리를 "미확인"으로 채우지 않는다(다른 결측이 없으니 화면 전체에 0개).
    expect(screen.queryAllByText(/미확인/)).toHaveLength(0);
  });
});

describe('S14 · 전화 줄 press 는 콜백만 올린다 (TRIP-940 AC-3 · FSD 경계)', () => {
  it('전화 줄을 누르면 onPressPhone 이 한 번 불린다(tel: 열기는 페이지 몫)', () => {
    const onPressPhone = jest.fn();
    render(<StayDetailScreen {...baseProps()} onPressPhone={onPressPhone} />);

    fireEvent.press(screen.getByTestId('stay-detail-phone'));

    expect(onPressPhone).toHaveBeenCalledTimes(1);
  });
});

const FACE_IDS = [
  'stay-detail-loading',
  'stay-detail-notfound',
  'stay-detail-invalid',
  'stay-detail-error',
] as const;

const NON_READY = [
  { kind: 'loading', face: 'stay-detail-loading' },
  { kind: 'notFound', face: 'stay-detail-notfound' },
  { kind: 'invalid', face: 'stay-detail-invalid' },
  { kind: 'error', face: 'stay-detail-error' },
] as const;

describe('S15 · 비정상 네 얼굴 — 서로 다른 testID · 뒤로 탈출구 · 동작 없음 (TRIP-940 AC-4~6·9 · INV-4)', () => {
  it.each(NON_READY)(
    '$kind 얼굴은 $face 하나만 그리고, 상세 내용·하트·CTA 가 없다',
    ({ kind, face }) => {
      render(<StayDetailScreen {...baseProps()} state={{ kind }} />);

      expect(screen.getByTestId(face)).toBeOnTheScreen();
      // 404(notFound)와 400(invalid)을 포함해 네 얼굴은 testID 로 서로 구분된다(AC-6).
      FACE_IDS.filter((id) => id !== face).forEach((other) => {
        expect(screen.queryByTestId(other)).toBeNull();
      });
      // 조회가 끝나기 전·실패 뒤엔 저장·예약·일정 추가가 일어날 수 없다(AC-4 · AC-11).
      expect(screen.queryByTestId('stay-detail-root')).toBeNull();
      expect(screen.queryByTestId('stay-detail-save')).toBeNull();
      expect(screen.queryByTestId('stay-detail-book')).toBeNull();
      expect(screen.queryByTestId('stay-detail-addtotrip')).toBeNull();
    }
  );

  it.each(NON_READY)(
    '$kind 얼굴 안에 뒤로 버튼이 있고, 누르면 onPressBack 이 한 번 불린다 (AC-9)',
    ({ kind, face }) => {
      const onPressBack = jest.fn();
      render(
        <StayDetailScreen
          {...baseProps()}
          state={{ kind }}
          onPressBack={onPressBack}
        />
      );

      fireEvent.press(
        within(screen.getByTestId(face)).getByTestId('stay-detail-back')
      );

      expect(onPressBack).toHaveBeenCalledTimes(1);
    }
  );
});

describe('S16 · 재시도는 네트워크 오류 얼굴에만 (TRIP-940 AC-5·7 · Q2)', () => {
  it('error 얼굴의 "다시 시도"를 누르면 onRetry 가 한 번 불린다', () => {
    const onRetry = jest.fn();
    render(
      <StayDetailScreen
        {...baseProps()}
        state={{ kind: 'error' }}
        onRetry={onRetry}
      />
    );

    const retry = within(screen.getByTestId('stay-detail-error')).getByTestId(
      'stay-detail-retry'
    );
    expect(retry).toHaveTextContent(/다시 시도/);
    fireEvent.press(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(['loading', 'notFound', 'invalid'] as const)(
    '%s 얼굴에는 재시도 버튼이 없다(다시 해도 결과가 같다)',
    (kind) => {
      render(<StayDetailScreen {...baseProps()} state={{ kind }} />);

      expect(screen.queryByTestId('stay-detail-retry')).toBeNull();
    }
  );
});

describe('S17 · 비정상 얼굴 문구 = Figma e03 error 기존 문구 (TRIP-940 Q2)', () => {
  it.each([
    ['notFound', 'stay-detail-notfound'],
    ['invalid', 'stay-detail-invalid'],
    ['error', 'stay-detail-error'],
  ] as const)(
    '%s 얼굴은 기존 제목·부제를 그대로 쓴다(새 문구를 지어내지 않음)',
    (kind, face) => {
      render(<StayDetailScreen {...baseProps()} state={{ kind }} />);

      const root = screen.getByTestId(face);
      expect(within(root).getByText(FAIL_TITLE)).toBeOnTheScreen();
      expect(within(root).getByText(FAIL_SUBTITLE)).toBeOnTheScreen();
    }
  );

  it('로딩 얼굴은 실패 문구를 그리지 않는다(아직 실패가 아니다)', () => {
    render(<StayDetailScreen {...baseProps()} state={{ kind: 'loading' }} />);

    expect(screen.getByTestId('stay-detail-loading')).toBeOnTheScreen();
    expect(screen.queryByText(FAIL_TITLE)).toBeNull();
  });
});

describe('S18 · 금지 표면 — 리뷰·평점·소요시간 없음 (TRIP-940 AC-12 · US-STAY-03 · INV-3)', () => {
  it('ready 얼굴에 리뷰·평점·"N분" 문자열이 없다', () => {
    render(<StayDetailScreen {...baseProps()} />);

    // 긍정 앵커 — 실제로 ready 얼굴이다.
    expect(screen.getByTestId('stay-detail-root')).toBeOnTheScreen();
    expect(screen.queryAllByText(/리뷰|평점/)).toHaveLength(0);
    expect(screen.queryAllByText(/\d+\s*분/)).toHaveLength(0);
  });
});
