import { render, screen, within } from '@testing-library/react-native';

import type { Place } from '@/shared/api/generated/schemas';

import { PlaceDetailScreen } from './PlaceDetailScreen';

/**
 * TRIP-710 [d06] 장소 상세 — **화면 렌더 계약**(props-only 순수 뷰). AC-1 부제 핀 · AC-2 미니맵.
 *
 * 무엇을 보장하나:
 *  - **AC-1** 부제(`[category · region]`) 앞에 핀 글리프(`explore-place-subtitle-pin`)가 서고,
 *    부제 텍스트 join 은 그대로다(회귀 없음).
 *  - **AC-2** `explore-place-map` 래퍼 안이 정적 placeholder 가 아니라 실 `<MapView>` 다 —
 *    viewOnly 有, center/pins = place.lat/lng 단일 핀, "지도 준비 중" 문구 소멸.
 *
 * 왜 화면 단위인가: 재는 것은 "props 를 받아 무엇을 그리는가"다. 실제 조회·라우팅·저장 토글은
 * `pages/place-detail/ui/PlaceDetailPage.integration.test.tsx`(동결) 몫이다. 이 화면은 훅 0
 * (props-only)이라 QueryClient·SafeAreaProvider 래퍼가 필요 없다(02a §5-A 실측).
 *
 * ★ MapView 관측(02a §5-C): `@mj-studio/react-native-naver-map` 수동 목이 prop-기록형이라
 *   `NaverMapView→testID="map-native"` 로 props 를 그대로 노출한다. 실 `MapView` 는 env 키가
 *   있어야 `map-native` 를 그리고 없으면 `map-failure` 로 접히므로, beforeEach 에서 키를 세운다
 *   (없으면 AC-2 가 잘못된 이유로 red). center 는 `map-native.props.camera`, viewOnly 는 4개의
 *   `is*GesturesEnabled` 토글로 관측한다. 단일 핀은 경로선(map-path)이 원리적으로 없어
 *   (showPath 는 pins.length>=2 게이트) connectPins-부재는 여기서 안 재고 명부 S8 이 잠근다.
 *
 * ★ 부제 핀 색(on-primary 흰색)은 SVG stroke 라 jest 사각(repo-traps §글리프) — 색이 아니라
 *   testID 존재로만 잰다. 흰색 tone 정합은 6-b 육안(AC-V1).
 */

const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

const GESTURE_TOGGLES = [
  'isScrollGesturesEnabled',
  'isZoomGesturesEnabled',
  'isRotateGesturesEnabled',
  'isTiltGesturesEnabled',
] as const;

// 동결 통합테스트(`PlaceDetailPage.integration.test.tsx`)의 makePlace 와 정합 — 부산시립미술관은
// category '문화'(PoiCategory enum). Figma 라벨 '미술관'·'전시'는 계약 밖 드리프트라 못 쓴다
// (Place.category 는 PoiCategory 7종뿐, tsc 강제 — 02a §4-9). lat≠lng 로 좌표 스왑을 가른다.
function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    poiId: 'p1',
    nameKo: '부산시립미술관',
    category: '문화',
    lat: 35.1,
    lng: 129.1,
    region: '부산 부산진구',
    openingHours: '10:00~18:00 (월 휴관)',
    imageUrl: null,
    tags: ['미술', '실내'],
    savedCount: 3,
    dataStatus: 'ACTIVE',
    ...overrides,
  };
}

describe('🔴 AC-1 · 부제 앞 핀 글리프 (부제 join 무회귀)', () => {
  it('부제 앞에 explore-place-subtitle-pin 이 서고, [category · region] join 은 그대로다', () => {
    // Arrange + Act
    render(<PlaceDetailScreen place={makePlace()} saved={false} />);

    // Assert ① — 부제 핀 글리프가 존재한다(현재 화면엔 이 testID 가 없어 red).
    expect(screen.getByTestId('explore-place-subtitle-pin')).toBeTruthy();

    // Assert ② — 부제 텍스트는 [category, region] 을 ' · ' 로 이은 그대로다(무회귀 앵커).
    //   PlaceSubtitle 이 parts.join(' · ') 단일 Text 라 완전일치로 못박는다(02a §5-B).
    //   핀 추가가 부제 조각을 흔들면(예: 카테고리 누락) 이 단언이 red.
    expect(screen.getByText('문화 · 부산 부산진구')).toBeOnTheScreen();
  });

  // ↑ 위 it 은 핀의 "존재"와 부제 join 텍스트만 봐서, 핀을 부제 뒤로 옮기거나 flex-row
  //   밖으로 빼도 green(공허 통과)이었다. 티켓 AC-1 은 "부제 **앞** 핀"이라 순서까지 잠근다.
  //   핀과 부제는 같은 flex-row 의 형제다(PlaceDetailScreen.tsx: <MapPinGlyph/> 다음
  //   <PlaceSubtitle/>) — 형제 사이에서는 문서 순서(트리 pre-order) = 형제 순서.
  it('핀은 부제 텍스트보다 형제 순서상 앞에 온다 (뒤로 옮기면 red)', () => {
    // Arrange + Act
    render(<PlaceDetailScreen place={makePlace()} saved={false} />);
    const pin = screen.getByTestId('explore-place-subtitle-pin');
    const subtitle = screen.getByText('문화 · 부산 부산진구');

    // Assert — findAll 은 트리를 pre-order(부모→자식, 형→제)로 훑어 매치를 순서대로 담는다
    //   (react-test-renderer `_findAll`: 노드를 자식보다 먼저 push — node_modules 실측,
    //   02c §실검증). 두 노드를 한 쿼리로 뽑으면 배열 순서가 곧 형제 순서다.
    const ordered = screen.root.findAll(
      (node) => node === pin || node === subtitle
    );
    // 인덱스(숫자)로만 비교한다 — ReactTestInstance 자체를 toBe/toEqual 로 비교하면 실패
    //   메시지에서 jest 가 순환참조(parent 포인터)를 직렬화하다 죽는다(SIGABRT 실측, 02c §실검증).
    expect(ordered.length).toBe(2); // 둘 다 잡혔는지(predicate 미스매치 방어)
    expect(ordered.indexOf(pin)).toBeLessThan(ordered.indexOf(subtitle)); // 핀이 부제보다 앞
  });
});

describe('🔴 AC-2 · 미니맵 실 MapView (단일 핀 · viewOnly · center/pins=place)', () => {
  it('explore-place-map 안이 map-native 이고 "지도 준비 중" 은 사라진다', () => {
    // Arrange + Act
    render(<PlaceDetailScreen place={makePlace()} saved={false} />);
    const map = screen.getByTestId('explore-place-map');

    // Assert ① — placeholder 가 아니라 실 MapView(map-native)가 래퍼 안에 있다(현재 placeholder → red).
    expect(within(map).getByTestId('map-native')).toBeTruthy();
    // Assert ② — placeholder 문구가 사라졌다(현재 present → red).
    expect(within(map).queryByText('지도 준비 중')).toBeNull();
  });

  it('viewOnly 가 전달돼 제스처 4토글이 개별로 전부 false 다', () => {
    // Arrange + Act
    render(<PlaceDetailScreen place={makePlace()} saved={false} />);
    const native = within(screen.getByTestId('explore-place-map')).getByTestId(
      'map-native'
    );

    // Assert — viewOnly 누락 시 토글이 undefined → red(구현 강제). 개별 단언으로 어느 토글인지 드러남.
    for (const toggle of GESTURE_TOGGLES) {
      expect(native.props[toggle]).toBe(false);
    }
  });

  it('center 와 단일 핀이 place.lat/lng 로 전달된다(lat↔lng 스왑 방지)', () => {
    // Arrange
    const place = makePlace();
    // Act
    render(<PlaceDetailScreen place={place} saved={false} />);
    const map = screen.getByTestId('explore-place-map');
    const native = within(map).getByTestId('map-native');

    // Assert ① — center. lat/lng 뒤바꾸면(둘 다 number 라 tsc 통과) red.
    const camera = native.props.camera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(place.lat);
    expect(camera.longitude).toBe(place.lng);

    // Assert ② — 단일 핀(번호 1, D2 감수) 이 place 좌표에 찍힌다.
    const markers = within(map).getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].props.latitude).toBe(place.lat);
    expect(markers[0].props.longitude).toBe(place.lng);
    expect(within(map).getByTestId('map-marker-pin-1')).toBeTruthy();
  });
});

/**
 * TRIP-988 · A(BR-U3-09 · D3) — 영업시간 원문의 `<br>` 태그는 줄바꿈으로 그린다.
 *
 * `toHaveTextContent(문자열)` 기본 정규화는 줄바꿈을 공백으로 접는다 — 그대로 쓰면 태그를 공백으로
 * 바꾼 화면도 통과한다. 그래서 정규화를 끈 항등 normalizer(`(s) => s`)로 줄바꿈까지 글자 그대로 잰다.
 */
describe('🔴 TRIP-988 A-1 · 영업시간 `<br>` → 줄바꿈 (d06)', () => {
  const keepAsIs = (text: string): string => text;

  it('원문 태그가 화면에 남지 않고, 태그 자리에서 두 줄로 나뉜다', () => {
    // 준비 — QA 재현 원문(#012)을 가진 장소.
    const place = makePlace({
      openingHours: '월요일~토요일 12:00~22:30<br>- 일요일 12:00~21:30',
    });

    // 실행
    render(<PlaceDetailScreen place={place} saved={false} />);

    // 단언 — 두 줄 문자열과 글자 그대로 같고, `<br` 조각이 없다.
    const hours = screen.getByTestId('explore-place-openhours');
    expect(hours).toHaveTextContent(
      '월요일~토요일 12:00~22:30\n- 일요일 12:00~21:30',
      { normalizer: keepAsIs }
    );
    expect(hours).not.toHaveTextContent(/<br/i);
  });

  it('A-5 무회귀 — 영업시간이 없으면 "미확인" 자리를 그대로 쓴다', () => {
    render(
      <PlaceDetailScreen
        place={makePlace({ openingHours: null })}
        saved={false}
      />
    );

    expect(
      screen.getByTestId('explore-place-unknown-openhours')
    ).toHaveTextContent('미확인');
    expect(screen.queryByTestId('explore-place-openhours')).toBeNull();
  });
});
