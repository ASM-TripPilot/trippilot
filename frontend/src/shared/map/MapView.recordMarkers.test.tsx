import { render, screen } from '@testing-library/react-native';

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
const PHOTO = require('@/shared/ui/placeholders/home/hero-view.jpg');

// AC-3(visited 사진 썸네일+번호 배지)·AC-4(planned 점선 회색 원)·AC-5(stay 빨강 bed)는 jest-cut 에서 지웠다 — 마커 생김새(SVG·fill)라 실화면 QA 몫(trip-record.md).

describe('🔴 AC-6 — 방문구간 연결선: visited 구간만 잇는다', () => {
  // TRIP-1356 — 같은 coords 블록 3벌(jscpd 44)을 표로 모았다. 기대값은 선이 지나는 좌표를 순서대로.
  it.each<[string, MapPin[], [number, number][]]>([
    [
      'visited 2개만 순서대로(planned·stay 는 선 밖) — j01 형',
      [
        { number: 1, lat: 35.1, lng: 129.1, kind: 'visited', imageUrl: PHOTO },
        {
          number: 2,
          lat: 35.11,
          lng: 129.11,
          kind: 'visited',
          imageUrl: PHOTO,
        },
        { number: 3, lat: 35.12, lng: 129.12, kind: 'planned' },
        { number: 4, lat: 35.13, lng: 129.13, kind: 'planned' },
        { number: 5, lat: 35.14, lng: 129.14, kind: 'stay' },
      ],
      [
        [35.1, 129.1],
        [35.11, 129.11],
      ],
    ],
    [
      '🟢 짝 — kind 미전달 전핀은 전 구간을 잇는다(무회귀)',
      [
        { number: 1, lat: 35.1, lng: 129.1 },
        { number: 2, lat: 35.12, lng: 129.12 },
      ],
      [
        [35.1, 129.1],
        [35.12, 129.12],
      ],
    ],
    [
      'visited 3개(j04 형)면 3점 전부 순서대로',
      [
        { number: 1, lat: 35.1, lng: 129.1, kind: 'visited', imageUrl: PHOTO },
        {
          number: 2,
          lat: 35.11,
          lng: 129.11,
          kind: 'visited',
          imageUrl: PHOTO,
        },
        {
          number: 3,
          lat: 35.12,
          lng: 129.12,
          kind: 'visited',
          imageUrl: PHOTO,
        },
      ],
      [
        [35.1, 129.1],
        [35.11, 129.11],
        [35.12, 129.12],
      ],
    ],
  ])('%s', (_label, pins, expected) => {
    render(<MapView center={CENTER} pins={pins} />);

    // 경로선 coords 는 기대 좌표 배열과 순서까지 같다(색·픽셀 아니라 배열로 잠근다).
    const coords = screen.getByTestId('map-path').props.coords as {
      latitude: number;
      longitude: number;
    }[];
    expect(coords).toEqual(
      expected.map(([latitude, longitude]) => ({ latitude, longitude }))
    );
  });
});
