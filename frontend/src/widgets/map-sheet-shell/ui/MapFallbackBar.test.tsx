import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { MapFallbackBar } from './MapFallbackBar';

/**
 * TRIP-919 · 지도 폴백 바(widgets · presentation-only). 셸이 지도 실패를 감지하면 지도 자리에 이 바를
 * 기본값으로 얹고, h14 프리뷰도 같은 바를 `mapFallback` 으로 넘긴다(Figma `4286:2123`).
 *
 * 문구·라벨은 `getByText` **완전일치**다 — 옛 프리뷰처럼 `⊘ `·`↻ ` 기호를 같은 Text 에 붙이면 red
 * (글리프는 `MapSheetGlyphs` 의 SVG 형제 노드여야 한다, 02a ★7). 재시도 상태는 셸이 쥐고 이 바는
 * `onRetry` 를 부르기만 한다(`widgetsStructure` F 가 useState 0 을 잠근다).
 *
 * 3동작 뼈대: 준비=onRetry 스파이로 렌더 → 실행=다시 시도 press → 단언=문구·라벨·콜백 1회.
 */

const MESSAGE = '지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요';

describe('🔴 MapFallbackBar · FB1 — 안내문과 다시 시도 버튼 (TRIP-919 AC-1·AC-2)', () => {
  it('폴백 루트 안에 안내문이 완전일치로 있고, 다시 시도 press 가 onRetry 를 1회 부른다', () => {
    const onRetry = jest.fn();
    render(<MapFallbackBar onRetry={onRetry} />);

    const root = screen.getByTestId('map-sheet-fallback');
    expect(within(root).getByText(MESSAGE)).toBeOnTheScreen();
    const retry = screen.getByTestId('map-sheet-fallback-retry');
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();

    fireEvent.press(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
