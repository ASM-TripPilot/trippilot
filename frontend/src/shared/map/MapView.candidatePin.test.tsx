import { render, screen, within } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';

/**
 * TRIP-800 · AC-8 — 공용 지도에 **아웃라인 후보 핀**(`kind: 'candidate'`) 가산(h15 추천 후보 위치).
 *
 * 무엇을 보장하나:
 *  - 🔴 MC1 후보 핀 = 흰 채움 + 빨강(primary) 테두리 물방울, **번호·글자 없음**. 공용 래퍼
 *    (`map-marker-pin-{n}`, `collapsable={false}` — iOS 마커 래스터 필수 조건, TRIP-876)를 그대로 쓴다.
 *    모양은 색이 아니라 내부 Svg testID(`map-marker-candidate-{n}`)로 식별한다(fill 토글 거짓통과 회피).
 *  - 🔴 MC2 물방울 끝이 좌표를 가리킨다(anchor `{x:0.5,y:1}`).
 *  - 🔴 MC3 후보·숙소 핀은 **경로선 밖**이다 — 동선 핀만 잇는다(브리프 맹점 ①-3, 02a ★6 ①층).
 *  - 🟢 MC4 kind 없는 기존 핀엔 후보 마커가 안 생긴다(현행 12 소비처 무회귀 앵커).
 *
 * 기존 `MapView.test.tsx`·`MapView.recordMarkers.test.tsx` 는 건드리지 않는다(AC-8 무수정 green).
 * ★ SVG 글자·색은 RNTL 텍스트 쿼리에 안 잡힌다 — `UNSAFE_queryAllByProps` 로 props 를 본다. SVG 1개가
 *   2노드로 잡히기도 해 존재는 `> 0`, 부재는 `length 0` 으로만 판정한다(정확 개수 금지, recordMarkers 선례).
 *
 * 3동작 뼈대: 준비=핀 배열 → 실행=MapView 렌더 → 단언=마커 트리·경로선 좌표.
 */

// no-dynamic-env-var 회피 — 선언과 대입을 분리(기존 MapView.test.tsx 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  // 키가 있어야 지도가 뜬다(없으면 map-failure 라 마커를 못 본다).
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

const CENTER: MapCenter = { lat: 35.1587, lng: 129.1604 };

describe('🔴 MC1 — candidate 핀: 흰 채움 + 빨강 테두리, 번호 없음', () => {
  it('래퍼(collapsable=false) 안에 후보 Svg · 빨강 stroke · 흰 fill, 빨강 채움·번호·사진·침대 없음', () => {
    // 준비 — 후보 핀 하나(번호 12 — 화면이 동선 번호와 겹치지 않게 매긴 값).
    const pins: MapPin[] = [
      { number: 12, lat: 35.1631, lng: 129.1636, kind: 'candidate' },
    ];

    // 실행
    render(<MapView center={CENTER} pins={pins} />);

    // 단언 — 공용 래퍼가 래스터 조건을 지킨다.
    const pin = screen.getByTestId('map-marker-pin-12');
    expect(pin.props.collapsable).toBe(false);
    // 후보 모양은 testID 로 식별한다.
    expect(within(pin).queryByTestId('map-marker-candidate-12')).not.toBeNull();
    // 빨강 테두리 + 흰 채움(아웃라인).
    expect(
      within(pin).UNSAFE_queryAllByProps({ stroke: '#FF385C' }).length
    ).toBeGreaterThan(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FFFFFF' }).length
    ).toBeGreaterThan(0);
    // 빨강으로 **채우면** 선택 핀(current)·숙소 핀과 구분이 안 된다.
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' })
    ).toHaveLength(0);
    // 번호를 그리지 않는다(Figma 후보 핀은 빈 물방울).
    expect(within(pin).UNSAFE_queryAllByProps({ content: '12' })).toHaveLength(
      0
    );
    // 다른 마커족으로 새지 않았다.
    expect(within(pin).queryByTestId('map-marker-stay-12')).toBeNull();
    expect(within(pin).queryByTestId('map-marker-photo-12')).toBeNull();
  });
});

describe('🔴 MC2 — candidate 핀의 끝이 좌표를 가리킨다', () => {
  it('마커 overlay anchor 가 {x:0.5, y:1}', () => {
    const pins: MapPin[] = [
      { number: 12, lat: 35.1631, lng: 129.1636, kind: 'candidate' },
    ];

    render(<MapView center={CENTER} pins={pins} />);

    // 래퍼의 부모가 네이버 마커 overlay(목 host `map-marker`)다.
    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].props.anchor).toEqual({ x: 0.5, y: 1 });
  });
});

describe('🔴 MC3 — 후보·숙소 핀은 경로선 밖, 동선 핀만 잇는다', () => {
  it('동선 2 + 숙소 1 + 후보 2 → map-path coords 는 동선 2점(순서 그대로)', () => {
    // 준비 — h15 조립 모양(동선은 kind 없음).
    const pins: MapPin[] = [
      { number: 1, lat: 35.1532, lng: 129.1187 },
      { number: 2, lat: 35.1587, lng: 129.1604 },
      { number: 11, lat: 35.1631, lng: 129.1636, kind: 'stay' },
      { number: 12, lat: 35.1578, lng: 129.0592, kind: 'candidate' },
      { number: 13, lat: 35.1532, lng: 129.1188, kind: 'candidate' },
    ];

    // 실행
    render(<MapView center={CENTER} pins={pins} />);

    // 단언 — 마커는 5개 다 그리되, 선은 동선 두 점만.
    expect(screen.getAllByTestId('map-marker')).toHaveLength(5);
    const coords = screen.getByTestId('map-path').props.coords as {
      latitude: number;
      longitude: number;
    }[];
    expect(coords).toEqual([
      { latitude: 35.1532, longitude: 129.1187 },
      { latitude: 35.1587, longitude: 129.1604 },
    ]);
  });
});

describe('🟢 MC4 — kind 없는 기존 핀엔 후보 마커가 없다 (무회귀 앵커)', () => {
  it('state 물방울 핀 둘 → map-marker-candidate-* 0', () => {
    const pins: MapPin[] = [
      { number: 1, lat: 35.1532, lng: 129.1187 },
      { number: 2, lat: 35.1587, lng: 129.1604 },
    ];

    render(<MapView center={CENTER} pins={pins} />);

    expect(screen.getByTestId('map-marker-pin-1')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^map-marker-candidate-/)).toHaveLength(0);
  });
});
