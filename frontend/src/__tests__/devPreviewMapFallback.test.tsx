import type { ComponentType } from 'react';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

/**
 * TRIP-919 · AC-7 — `h14-plan-map-fallback` 프리뷰가 로컬 마크업 대신 **승격된 위젯**
 * (`MapFallbackBar`)을 `mapFallback` 으로 넘긴다. 키 이름·위치·개수는 `devPreviewBandNav`·
 * `devPreviewBandSort` 가 이미 잠근다(무변경 green) — 이 파일은 "무엇이 그려지는가"만 본다.
 *
 * ★ 지도 env 키를 **넣고** 돈다(02a ★6). 키가 없으면 셸이 스스로 폴백을 띄워, 프리뷰가 위젯을 안
 *   넘겨도 폴백이 보여 거짓 green 이 된다. 키가 있으면 위젯을 명시적으로 넘긴 경우에만 폴백이 뜬다
 *   (dev build 에 키가 있어도 폴백 얼굴을 볼 수 있어야 한다).
 * 문구 복제 금지(로컬 마크업 소멸)는 `mapSheetShellStructure` G6b 가 전 소스 스캔으로 잠근다.
 *
 * 3동작 뼈대: 준비=키 주입 + 딥링크 state → 실행=DevPreview 렌더(+다시 시도 press) → 단언=폴백·지도·CTA.
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목(__mocks__/@gorhom/bottom-sheet.tsx) — devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

// no-dynamic-env-var 회피 — 선언과 대입 분리(MapView.test 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  delete mockSearchParams.state;
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env[CLIENT_ID_KEY];
  else process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
});

const FALLBACK_MESSAGE =
  '지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요';

describe('TRIP-919 · h14 지도 폴백 프리뷰는 승격된 위젯을 쓴다 (AC-7)', () => {
  it('🔴 PV1 · h14-plan-map-fallback 은 키가 있어도 위젯 폴백을 그리고, 다시 시도는 noop 이라 폴백이 유지된다', () => {
    // 준비 — 폴백 프리뷰 딥링크.
    mockSearchParams.state = 'h14-plan-map-fallback';

    // 실행 — 렌더.
    render(<DevPreview />);

    // 단언 — 위젯의 testID·문구가 지도 자리에 뜨고 지도는 없다. CTA 는 남는다.
    const fallback = screen.getByTestId('map-sheet-fallback');
    expect(within(fallback).getByText(FALLBACK_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(
      within(screen.getByTestId('sheet-cta-button-0')).getByText(
        '일정 저장하기'
      )
    ).toBeOnTheScreen();

    // 실행/단언 — 프리뷰의 다시 시도는 noop: 눌러도 크래시 없이 폴백 그대로.
    fireEvent.press(screen.getByTestId('map-sheet-fallback-retry'));
    expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();
  });

  it('PV2 · h14-plan-default 는 키가 있으면 지도를 그리고 폴백은 없다 (선제 green · 회귀 앵커)', () => {
    // 준비 — 기본 얼굴.
    mockSearchParams.state = 'h14-plan-default';

    // 실행
    render(<DevPreview />);

    // 단언 — 기본 얼굴이 폴백을 강제하지 않는다.
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-sheet-fallback')).toBeNull();
  });
});
