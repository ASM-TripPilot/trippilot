import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-1088 · R1 — j01 프리뷰 키가 「오늘의 회고」 FAB 를 Figma 대로 그리는가(6-b 육안 대조의 전제).
 *
 * 무엇을 보장하나:
 *  - default·error·manual-checkin·empty 4키는 FAB 를 그린다(Figma 4716:2946 · 4721:2853 · 4721:2846 · 4721:2860).
 *  - visit-time-sheet 키는 그리지 않는다(Figma 4707:2808 은 scrim·시트가 덮는 프레임이라 FAB 가 없다).
 *
 * 왜 렌더인가: 소스 스캔으로 `onPressReflection=` 을 찾으면 `={undefined}` 도 통과한다 — 키의 render() 를
 *   실제로 그려 FAB testID 를 본다. 키 수는 바뀌지 않는다(devPreviewBandNav 총량 가드 무변경).
 * 3동작: 준비(키로 엔트리 찾기) → 실행(render()) → 단언(뷰 앵커 + FAB 유무).
 */

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
}));

jest.mock('@gorhom/bottom-sheet');

jest.mock('@/shared/api', () => {
  throw new Error(
    'j01 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PREVIEW_STATES } = require('@/app/_dev/preview') as {
  PREVIEW_STATES: { key: string; band: string; render: () => ReactElement }[];
};

const FAB = 'record-trip-reflection-fab';

function renderKey(key: string): { band: string } {
  const state = PREVIEW_STATES.find((s) => s.key === key);
  if (state === undefined) throw new Error(`${key} 키 없음`);
  render(state.render());
  return state;
}

describe('🔴 TRIP-1088 R1 · j01 프리뷰의 「오늘의 회고」 FAB', () => {
  it.each([
    'records-default',
    'records-error',
    'records-manual-checkin',
    'records-empty',
  ])('R1a %s 는 FAB 를 그린다', (key) => {
    const state = renderKey(key);

    expect(state.band).toBe('j');
    expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();
  });

  it('R1b records-visit-time-sheet 는 FAB 를 그리지 않는다', () => {
    renderKey('records-visit-time-sheet');

    expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
    expect(screen.queryByTestId(FAB)).toBeNull();
  });
});
