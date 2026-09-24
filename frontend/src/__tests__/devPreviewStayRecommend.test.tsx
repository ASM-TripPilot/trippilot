import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';

/**
 * TRIP-800 · 완료조건 "프리뷰 키 h15-stay-recommend 가 Figma 4385:1623 과 육안 동일(픽스처)" 의 자동 절반.
 *
 * 키 이름·밴드·정렬 위치는 `devPreviewBandNav`·`devPreviewBandSort` 가 잠근다 — 이 파일은 그 키로 열었을 때
 * **무엇이 그려지는가**(Figma 픽스처 값·지도 구성·시트 칸)를 본다. 육안 대조 나머지(치수·색·핀 모양)는 6-b.
 *
 * 무엇을 보장하나:
 *  - 🔴 PV2 카드 3장이 Figma 픽스처 값으로 선다 — 거리는 리포 규칙(`900m`, Figma `0.9km` 드리프트 · 01b Q6),
 *    가격은 `원~`(G1). 배지는 첫 카드만, CTA 는 `해운대 그랜드 호텔을 거점으로`.
 *  - 🔴 PV3 (지도 키가 있을 때) 반경 원 1 · 숙소 핀 1 · 아웃라인 후보 핀 2 · 경로선은 동선 핀만 잇는다.
 *  - 🔴 PV4 시트는 셸 기본 배열의 peek(45%)로 연다(02a D4).
 *  - 🔴 PV5 지뢰 — 프리뷰가 거점 지정 요청 모듈(`@/shared/api/generated/trips/trips`)을 로드하면 즉시 터진다.
 *    화면이 mutation 을 물면 프리뷰가 네트워크 계층을 전이 로드한다(traps-shell, 02a ★15). 기존 지뢰는
 *    `@/shared/api` 배럴만 막아 생성 경로 직접 import 를 못 잡는다.
 *
 * ⚠️ 지도 마커 모양·원 점선·peek 실제 높이는 jest 사각(6-b 실기, 네이티브 재빌드 필요).
 *
 * 3동작 뼈대: 준비=딥링크 state + 지도 키 → 실행=DevPreview 렌더 → 단언=카드·지도·시트 칸.
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목(__mocks__/@gorhom/bottom-sheet.tsx) — devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

// 지뢰 ① — 네트워크 배럴(devPreview 계열 공통).
jest.mock('@/shared/api', () => {
  throw new Error(
    'h15 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});
// 지뢰 ② — 거점 지정 요청이 사는 생성 모듈(PV5). 배럴을 안 거치고 직접 무는 경로를 막는다.
jest.mock('@/shared/api/generated/trips/trips', () => {
  throw new Error(
    'h15 프리뷰가 @/shared/api/generated/trips/trips(거점 지정 요청)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

// 지도 env 키 — 실제 MapView 는 키가 있어야 `map-native`·마커를 그린다(없으면 셸 폴백 바).
// no-dynamic-env-var 회피 — 선언과 대입을 분리(MapView.test 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  mockSearchParams.state = 'h15-stay-recommend';
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  delete mockSearchParams.state;
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

describe('🔴 PV2 · h15 프리뷰가 Figma 픽스처 카드 3장을 그린다', () => {
  it('헤더 · 카드 3장 값 · 배지 첫 장만 · CTA 라벨', () => {
    // 실행
    render(<DevPreview />);

    // 헤더.
    expect(screen.getByTestId('stay-recommend-title')).toHaveTextContent(
      '동선 기준 숙소 추천'
    );
    expect(screen.getByTestId('stay-recommend-count')).toHaveTextContent('3곳');
    expect(screen.getByTestId('stay-recommend-subtitle')).toHaveTextContent(
      '이틀 동선이 해운대·서면 중심이에요 · 이동 합계가 짧은 순'
    );

    // 카드 3장 — Figma 4385:1623 값(거리 표기는 formatDistance, 가격은 원~).
    const expected = [
      [
        '해운대 그랜드 호텔',
        '평균 900m',
        '최대 1.4km',
        '해운대구 · 중간가',
        '120,000원~',
      ],
      [
        '서면 시티 호텔',
        '평균 1.2km',
        '최대 2.0km',
        '부산진구 · 중간가',
        '89,000원~',
      ],
      [
        '광안리 오션뷰',
        '평균 1.3km',
        '최대 1.8km',
        '수영구 · 중간가',
        '145,000원~',
      ],
    ];
    const cards = screen.getAllByTestId(/^stay-recommend-card-\d+$/);
    expect(cards).toHaveLength(3);
    expected.forEach((lines, index) => {
      lines.forEach((line) =>
        expect(within(cards[index]).getByText(line)).toBeOnTheScreen()
      );
    });

    // 배지·선택·CTA.
    expect(within(cards[0]).getByText('추천')).toBeOnTheScreen();
    expect(within(cards[1]).queryByText('추천')).toBeNull();
    expect(within(cards[2]).queryByText('추천')).toBeNull();
    expect(cards[0]).toBeSelected();
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '해운대 그랜드 호텔을 거점으로'
    );
  });
});

describe('🔴 PV3 · h15 프리뷰 지도 — 반경 원 · 숙소 핀 · 아웃라인 후보 핀 · 동선 선', () => {
  it('원 1 · 숙소 1 · 후보 2 · 경로선 좌표 수 = 전체 마커 − 3', () => {
    render(<DevPreview />);

    // 지도가 실제로 떴다(키 있음 → 폴백 아님).
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('map-circle')).toHaveLength(1);
    expect(screen.queryAllByTestId(/^map-marker-stay-/)).toHaveLength(1);
    expect(screen.queryAllByTestId(/^map-marker-candidate-/)).toHaveLength(2);

    // 경로선은 동선 핀만 — 숙소 1 + 후보 2 는 선 밖(02a ★6).
    const markers = screen.getAllByTestId('map-marker');
    const coords = screen.getByTestId('map-path').props.coords as unknown[];
    expect(coords.length).toBeGreaterThanOrEqual(2);
    expect(coords).toHaveLength(markers.length - 3);
  });
});

describe('🔴 PV4 · h15 프리뷰 시트는 peek(45%)로 연다 (★18)', () => {
  it('시트가 받은 배열에서 index 가 가리키는 칸 값이 45%', () => {
    render(<DevPreview />);

    // 도달 앵커 — h15 화면이 실제로 떴다(다른 키의 시트를 재는 것 방지).
    expect(screen.getByTestId('stay-recommend-title')).toBeOnTheScreen();

    const values = screen.root
      .findAll(
        (node) =>
          typeof node.props?.index === 'number' &&
          Array.isArray(node.props?.snapPoints)
      )
      .map(
        (node) =>
          (node.props.snapPoints as unknown[])[node.props.index as number]
      );
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => expect(value).toBe('45%'));
  });
});
