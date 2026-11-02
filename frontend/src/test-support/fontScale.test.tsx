import { render, screen } from '@testing-library/react-native';
import {
  Dimensions,
  PixelRatio,
  Text,
  useWindowDimensions,
} from 'react-native';

import { isLargeText } from '@/shared/lib/fontScale';

import {
  describeAtFontScales,
  FONT_SCALE_MATRIX,
  setFontScale,
} from './fontScale';

/**
 * TRIP-1629 AC-H — 글자 배율 헬퍼 계약. 헬퍼가 "배율을 바꾸고, 끝나면 1 로 되돌리고, act 경고를 안 낸다"를 잠근다.
 *
 * `Probe` 는 화면이 배율을 읽는 길(`useWindowDimensions`)을 글자로 그리는 작은 컴포넌트다.
 * 3동작: 준비(배율 설정) → 실행(Probe 렌더) → 단언(Probe 글자·Dimensions·PixelRatio).
 */
function Probe() {
  const { fontScale } = useWindowDimensions();
  return <Text testID="probe">{String(fontScale)}</Text>;
}

const readers = () => ({
  window: Dimensions.get('window').fontScale,
  screen: Dimensions.get('screen').fontScale,
  pixelRatio: PixelRatio.getFontScale(),
});

// act 경고(= 헬퍼가 마운트된 화면 옆에서 act 없이 배율을 바꿈)는 console.error 로만 나오고 테스트를 실패시키지 않는다.
// 그래서 파일 전체에 감시를 건다. 이 afterEach 는 RNTL 의 자동 cleanup 뒤에 돌지만, 경고는 안쪽 reset 시점에
// 이미 기록돼 있다. (02a ★3)
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  const calls = errorSpy.mock.calls.map((call) => String(call[0]));
  errorSpy.mockRestore();
  expect(calls).toEqual([]);
});

describe('fontScale 헬퍼 · 매트릭스', () => {
  it('H1 iOS 실제 단계 4개이고, 큰 글자 경계(1.5) 양쪽을 덮는다', () => {
    expect([...FONT_SCALE_MATRIX]).toEqual([1, 1.353, 1.786, 3.571]);
    expect(FONT_SCALE_MATRIX.map(isLargeText)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('fontScale 헬퍼 · setFontScale', () => {
  afterEach(() => setFontScale(1));

  it('H2 화면이 읽는 길(useWindowDimensions·Dimensions·PixelRatio)이 전부 그 값이 된다', () => {
    setFontScale(3.571);
    render(<Probe />);

    expect(screen.getByTestId('probe')).toHaveTextContent('3.571');
    expect(readers()).toEqual({
      window: 3.571,
      screen: 3.571,
      pixelRatio: 3.571,
    });
  });

  it('H3 이미 그려진 화면 옆에서 바꿔도 화면이 따라오고 act 경고가 없다', () => {
    setFontScale(1);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('1');

    setFontScale(1.786);

    expect(screen.getByTestId('probe')).toHaveTextContent('1.786');
  });
});

describe('fontScale 헬퍼 · describeAtFontScales', () => {
  const defined: number[] = [];

  describeAtFontScales('H4 매트릭스', (fontScale) => {
    defined.push(fontScale);

    it('이 it 는 자기 배율을 본다 — 그린 채 끝나도 되돌리는 reset 이 act 경고를 안 낸다', () => {
      render(<Probe />);

      expect(screen.getByTestId('probe')).toHaveTextContent(String(fontScale));
      expect(readers()).toEqual({
        window: fontScale,
        screen: fontScale,
        pixelRatio: fontScale,
      });
      // 일부러 unmount 하지 않는다 — 헬퍼의 afterEach 가 마운트 중에 reset 한다.
    });
  });

  it('H4b 매트릭스 값마다 정확히 한 번, 순서대로 정의한다', () => {
    expect(defined).toEqual([...FONT_SCALE_MATRIX]);
  });

  // 반드시 describeAtFontScales 블록 뒤에 둔다 — 마지막 값(3.571)이 남았는지 보는 자리다.
  it('H5 블록 밖은 다시 1 이다 (누수 없음)', () => {
    expect(readers()).toEqual({ window: 1, screen: 1, pixelRatio: 1 });
  });
});
