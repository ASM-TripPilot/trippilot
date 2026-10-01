import { render, screen, within } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';

/**
 * TRIP-768 — 공용 지도 마커 additive 확장(j 밴드 기록·회고). 01b Seed AC-3·4·5·6·7 + AC-1 무회귀 짝.
 *
 * 이 파일은 기존 `MapView.test.tsx`(AC-10 무회귀 대상)를 **건드리지 않고** 새 거동만 잠근다.
 * 네이버 SDK 목은 기존 `__mocks__/@mj-studio/react-native-naver-map.tsx`(prop-기록형)를 그대로 쓴다 —
 * `map-native`(NaverMapView)·`map-marker`(오버레이)·`map-path`(경로선)에 props 를 스프레드하므로
 * 테스트가 렌더 트리에서 prop 을 직접 관측한다.
 *
 * ★ 마커 번호·글자는 `react-native-svg` 라 RNTL `toHaveTextContent` 가 못 읽는다(문자열이
 *   `RNSVGTSpan.props.content` 로 들어감). 그래서 번호는 `UNSAFE_queryAllByProps({ content })` 로 본다.
 *   이 쿼리는 "props[key] === 값" 부분 일치라 문자열은 정확 일치이고, SVG text 하나당 2노드(Text+TSpan)가
 *   잡히므로 존재는 `> 0`, 부재는 `length 0` 으로만 판정한다(정확 개수 금지).
 * ★ 사진(visited)·bed(stay) 같은 그림은 색(fill)만으로 잠그면 글리프 fill-토글 거짓통과 함정에 걸리므로,
 *   `<Svg>` 호스트에 얹은 testID(`map-marker-photo-{n}`·`map-marker-stay-{n}`)로 노드 존재를 잠근다
 *   (기존 `map-marker-check-{n}` 검증 패턴 준용).
 *
 * 구현 전엔 kind 분기·사진 노드·줌 prop 이 없어 대부분 red 다. "kind 미전달 → 현행 물방울" 짝만
 * 선제 green(가짜통과 차단 앵커).
 */

// no-dynamic-env-var 회피 — 선언과 대입을 분리(기존 MapView.test.tsx 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  // 키가 있어야 지도가 뜬다(없으면 무조건 map-failure 라 마커를 못 본다).
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

const CENTER: MapCenter = { lat: 35.1532, lng: 129.1187 };

/** 프리뷰와 같은 로컬 번들 사진(number source). jest 에서는 `{ testUri }` 객체로 온다 — SVG <Image href>
 *  가 받는다(원격 URL 은 TRIP-634 밖). */
const PHOTO = require('@/assets/itinerary/draft-preview-1.jpg');

const GESTURE_TOGGLES = [
  'isScrollGesturesEnabled',
  'isZoomGesturesEnabled',
  'isRotateGesturesEnabled',
  'isTiltGesturesEnabled',
] as const;

describe('🔴 AC-3 — visited 마커: 사진 썸네일 + 번호 배지', () => {
  it('사진 노드 + 번호(SVG content) + 빨강 배지, 래퍼 collapsable={false}', () => {
    // Arrange — visited 핀 하나(사진 URL 포함).
    const pins: MapPin[] = [
      {
        number: 1,
        lat: 35.1532,
        lng: 129.1187,
        kind: 'visited',
        imageUrl: PHOTO,
      },
    ];

    // Act
    render(<MapView center={CENTER} pins={pins} />);

    // Assert
    const pin = screen.getByTestId('map-marker-pin-1');
    // 프레임 Svg 존재(색이 아니라 testID 로 — fill 사각 회피). ⚠️ 이 프레임(map-marker-photo-{n})은
    // imageUrl 유무와 무관하게 늘 렌더되므로 이것만으론 사진을 못 잠근다(5-b 구멍) — 아래 href 단언이
    // 실제 사진을 문다.
    expect(within(pin).queryByTestId('map-marker-photo-1')).not.toBeNull();
    // ★ 5-b 강화 — 헤드라인 기능(실제 사진)은 SVG <Image> 의 href 로만 잡힌다. react-native-svg 는
    //   href 를 참조 그대로 호스트 노드에 실으므로(node_modules 실측: {href:PHOTO} 매치 length 1) 그
    //   Image 노드 present 를 문다. 이게 없으면 visited 핀에서 imageUrl 을 빼도 나머지 단언(번호 배지
    //   content·fill·collapsable)이 전부 green 이라 사진이 무심판이 된다(code-critic 5-b 실측).
    expect(
      within(pin).UNSAFE_queryAllByProps({ href: PHOTO }).length
    ).toBeGreaterThan(0);
    // 번호 배지 "1"(SVG content). 존재는 > 0 으로만.
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: '1' }).length
    ).toBeGreaterThan(0);
    // 배지 바탕은 빨강(primary). 여러 노드가 이 색일 수 있어 present 만 본다.
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' }).length
    ).toBeGreaterThan(0);
    // 마커 래스터 필수 prop(없으면 iOS New Arch 에서 기본 마커 — 실제 flatten 방지는 6-b).
    expect(
      (pin as { props: { collapsable?: boolean } }).props.collapsable
    ).toBe(false);
  });

  it('짝 — imageUrl 없는 visited 핀은 실제 사진 Image(href) 가 0 (프레임만 남고 사진은 안 뜬다)', () => {
    // Arrange — kind=visited 인데 imageUrl 이 없다(엣지). 프레임 Svg 는 떠도 실제 사진은 없어야 한다.
    // 이 짝이 위 href 단언의 비공허성을 증명한다 — href 노드가 imageUrl 을 실제로 추적함을 보인다.
    render(
      <MapView
        center={CENTER}
        pins={[{ number: 1, lat: 35.1532, lng: 129.1187, kind: 'visited' }]}
      />
    );

    // Assert
    const pin = screen.getByTestId('map-marker-pin-1');
    // 프레임 testID 는 있다(늘 렌더) — 그래서 이것만으로는 사진을 못 잠근다(5-b 구멍의 실체).
    expect(within(pin).queryByTestId('map-marker-photo-1')).not.toBeNull();
    // 그러나 실제 사진 Image(href) 는 0 — imageUrl 이 없으면 <Image> 자체가 안 그려진다.
    expect(within(pin).UNSAFE_queryAllByProps({ href: PHOTO })).toHaveLength(0);
  });

  it('🟢 짝 — kind·imageUrl 미전달이면 사진 노드 없이 현행 분홍 물방울+번호(무회귀)', () => {
    // Arrange — kind 없는 기존 핀. 현행 거동(분홍 물방울+번호)이 그대로여야 한다.
    render(
      <MapView
        center={CENTER}
        pins={[{ number: 1, lat: 35.1532, lng: 129.1187 }]}
      />
    );

    // Assert
    const pin = screen.getByTestId('map-marker-pin-1');
    // 사진 노드는 없다(kind 없으면 사진 분기로 새지 않는다).
    expect(within(pin).queryByTestId('map-marker-photo-1')).toBeNull();
    // 분홍 물방울 + 번호(현행 그대로).
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' }).length
    ).toBeGreaterThan(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: '1' }).length
    ).toBeGreaterThan(0);
  });
});

describe('🔴 AC-4 — planned 마커: 점선 회색 원 + 회색 번호', () => {
  it('회색(#9AA1AB) 번호+아웃라인, 사진·빨강·초록 없음(스왑 차단)', () => {
    // Arrange
    const pins: MapPin[] = [
      { number: 3, lat: 35.1532, lng: 129.1187, kind: 'planned' },
    ];

    // Act
    render(<MapView center={CENTER} pins={pins} />);

    // Assert
    const pin = screen.getByTestId('map-marker-pin-3');
    // 회색 번호(content) + 회색 점선 원(stroke).
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: '3' }).length
    ).toBeGreaterThan(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ stroke: '#9AA1AB' }).length
    ).toBeGreaterThan(0);
    // 사진 없음(planned 는 빈 원).
    expect(within(pin).queryByTestId('map-marker-photo-3')).toBeNull();
    // 빨강/초록이면 안 된다(visited/stay/done 으로 스왑 차단).
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' })
    ).toHaveLength(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#0E9384' })
    ).toHaveLength(0);
  });
});

describe('🔴 AC-5 — stay 마커: 빨강 + 흰 bed, 번호 없음', () => {
  it('bed SVG(testID) + 빨강 마커, 번호·사진 없음', () => {
    // Arrange
    const pins: MapPin[] = [
      { number: 5, lat: 35.1532, lng: 129.1187, kind: 'stay' },
    ];

    // Act
    render(<MapView center={CENTER} pins={pins} />);

    // Assert
    const pin = screen.getByTestId('map-marker-pin-5');
    // bed 아이콘은 testID 로 식별(fill 사각 회피 — map-marker-check 관례 준용).
    expect(within(pin).queryByTestId('map-marker-stay-5')).not.toBeNull();
    // 빨강 마커(primary).
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' }).length
    ).toBeGreaterThan(0);
    // 번호는 안 그린다(stay 는 번호 없음) — content='5' 노드 0개.
    expect(within(pin).UNSAFE_queryAllByProps({ content: '5' })).toHaveLength(
      0
    );
    // 사진도 없다.
    expect(within(pin).queryByTestId('map-marker-photo-5')).toBeNull();
  });
});

describe('🔴 AC-6 — 방문구간 연결선: visited 구간만 잇는다', () => {
  it('visited 2개만 순서대로(planned·stay 는 선 밖) — j01 형', () => {
    // Arrange — v1·v2 는 visited, 3·4 는 planned, 5 는 stay. 선은 1→2 만.
    const pins: MapPin[] = [
      { number: 1, lat: 35.1, lng: 129.1, kind: 'visited', imageUrl: PHOTO },
      { number: 2, lat: 35.11, lng: 129.11, kind: 'visited', imageUrl: PHOTO },
      { number: 3, lat: 35.12, lng: 129.12, kind: 'planned' },
      { number: 4, lat: 35.13, lng: 129.13, kind: 'planned' },
      { number: 5, lat: 35.14, lng: 129.14, kind: 'stay' },
    ];

    // Act
    render(<MapView center={CENTER} pins={pins} />);

    // Assert — 경로선 coords 는 visited 좌표 2개뿐(색·픽셀 아니라 배열로 잠근다).
    const path = screen.getByTestId('map-path');
    const coords = path.props.coords as {
      latitude: number;
      longitude: number;
    }[];
    expect(coords).toHaveLength(2);
    expect(coords[0]).toEqual({ latitude: 35.1, longitude: 129.1 });
    expect(coords[1]).toEqual({ latitude: 35.11, longitude: 129.11 });
  });

  it('🟢 짝 — kind 미전달 전핀은 전 구간을 잇는다(무회귀)', () => {
    // Arrange — kind 없는 핀 둘. 현행 거동(둘 다 선에 포함)이 그대로여야 한다.
    const pins: MapPin[] = [
      { number: 1, lat: 35.1, lng: 129.1 },
      { number: 2, lat: 35.12, lng: 129.12 },
    ];

    // Act
    render(<MapView center={CENTER} pins={pins} />);

    // Assert
    const coords = screen.getByTestId('map-path').props.coords as {
      latitude: number;
      longitude: number;
    }[];
    expect(coords).toHaveLength(2);
    expect(coords[0]).toEqual({ latitude: 35.1, longitude: 129.1 });
    expect(coords[1]).toEqual({ latitude: 35.12, longitude: 129.12 });
  });

  it('visited 3개(j04 형)면 3점 전부 순서대로', () => {
    // Arrange — 전부 visited → 선이 1→2→3.
    const pins: MapPin[] = [
      { number: 1, lat: 35.1, lng: 129.1, kind: 'visited', imageUrl: PHOTO },
      { number: 2, lat: 35.11, lng: 129.11, kind: 'visited', imageUrl: PHOTO },
      { number: 3, lat: 35.12, lng: 129.12, kind: 'visited', imageUrl: PHOTO },
    ];

    // Act
    render(<MapView center={CENTER} pins={pins} />);

    // Assert
    const coords = screen.getByTestId('map-path').props.coords as unknown[];
    expect(coords).toHaveLength(3);
  });
});

describe('🔴 AC-7 — 줌/축척 opt-in(showZoomControls·showScaleBar), viewOnly 와 독립', () => {
  it('전달하면 map-native 가 isShowZoomControls·isShowScaleBar 를 true 로 받는다', () => {
    // Act
    render(
      <MapView
        center={CENTER}
        pins={[{ number: 1, lat: 35.1, lng: 129.1 }]}
        showZoomControls
        showScaleBar
      />
    );

    // Assert
    const native = screen.getByTestId('map-native');
    expect(native.props.isShowZoomControls).toBe(true);
    expect(native.props.isShowScaleBar).toBe(true);
  });

  it('🟢 짝 — 미전달이면 명시적 false(기본 미표시 — SDK native default true 를 덮는다)', () => {
    // 왜 undefined 가 아니라 false 인가: 네이버 SDK 는 두 컨트롤 native default 가 true 라, prop 을
    // 안 주면(undefined) 컨트롤이 저절로 뜬다. "기본 미표시"를 지키려면 명시적으로 false 를 내려야 한다.
    render(
      <MapView center={CENTER} pins={[{ number: 1, lat: 35.1, lng: 129.1 }]} />
    );

    const native = screen.getByTestId('map-native');
    expect(native.props.isShowZoomControls).toBe(false);
    expect(native.props.isShowScaleBar).toBe(false);
  });

  it('viewOnly 와 독립 — viewOnly 는 컨트롤을 켜지 않고(제스처만), 컨트롤은 제스처 off 와 무관하게 켜진다', () => {
    // Arrange1 — viewOnly 만(컨트롤 prop 없음): 제스처 4토글 off, 컨트롤은 false.
    const { rerender } = render(
      <MapView
        center={CENTER}
        pins={[{ number: 1, lat: 35.1, lng: 129.1 }]}
        viewOnly
      />
    );
    let native = screen.getByTestId('map-native');
    expect(native.props.isShowZoomControls).toBe(false);
    for (const toggle of GESTURE_TOGGLES) {
      expect(native.props[toggle]).toBe(false);
    }

    // Arrange2 — viewOnly + 컨트롤: 제스처는 여전히 off, 컨트롤은 true(둘이 독립).
    rerender(
      <MapView
        center={CENTER}
        pins={[{ number: 1, lat: 35.1, lng: 129.1 }]}
        viewOnly
        showZoomControls
        showScaleBar
      />
    );
    native = screen.getByTestId('map-native');
    expect(native.props.isShowZoomControls).toBe(true);
    expect(native.props.isShowScaleBar).toBe(true);
    for (const toggle of GESTURE_TOGGLES) {
      expect(native.props[toggle]).toBe(false);
    }
  });
});
