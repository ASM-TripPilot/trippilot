import { act } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

/**
 * 글자 배율(fontScale) 테스트 헬퍼 (TRIP-1629).
 *
 * 왜 있나: jest 의 RN 목은 기본 fontScale 이 2 다. 전역 기본은 `fontScalePreload.cjs` 가 1 로 고정하고,
 * 배율을 바꿔 보는 테스트는 이 헬퍼로 바꾼다 — 화면은 `useWindowDimensions`·`PixelRatio.getFontScale` 로 읽는다.
 * 잘림·겹침은 jest 가 레이아웃을 계산하지 못해 못 본다 — 여기서 확인하는 건 글자·testID·콜백 보존뿐이다.
 */

/** iOS 실제 단계: 기본 · 일반 최대 · 접근성 진입 · 최대. 큰 글자 경계(1.5)의 양쪽을 덮는다. */
export const FONT_SCALE_MATRIX = [1, 1.353, 1.786, 3.571] as const;

const DEFAULT_FONT_SCALE = 1;

/**
 * 배율을 바꾼다. 항상 `act` 로 감싼다 — `afterEach` 의 reset 은 RNTL 자동 cleanup(언마운트)보다 먼저 돌아
 * 마운트된 화면이 배율 변화를 듣는 중에 일어나므로, act 밖이면 경고가 쏟아진다.
 */
export function setFontScale(fontScale: number): void {
  act(() => {
    Dimensions.set({
      window: { ...Dimensions.get('window'), fontScale },
      screen: { ...Dimensions.get('screen'), fontScale },
    });
  });
}

/**
 * 매트릭스 값마다 `describe` 를 하나씩 만들고, 그 안의 모든 `it` 이 그 배율에서 돈다. 끝나면 1 로 되돌린다.
 * `describe.each` 를 안 쓴다 — 제목이 printf 포맷이라 name 에 `%` 가 있으면 깨진다.
 */
export function describeAtFontScales(
  name: string,
  define: (fontScale: number) => void
): void {
  for (const fontScale of FONT_SCALE_MATRIX) {
    describe(`${name} · 배율 ${fontScale}`, () => {
      beforeEach(() => setFontScale(fontScale));
      afterEach(() => setFontScale(DEFAULT_FONT_SCALE));
      define(fontScale);
    });
  }
}
