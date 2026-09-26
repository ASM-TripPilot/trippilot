import { readFileSync } from 'fs';
import { join } from 'path';

import { render, screen } from '@testing-library/react-native';

import { TripStatusSegment } from './TripStatusSegment';

/**
 * TRIP-977 · l03 세그먼트 탭 전환 크래시(QA #026).
 *
 * 무엇을 보장하나:
 *  - 금지: 소스에 NativeWind 그림자 유틸(`shadow-sm` 등)이 없다. 선택이 바뀔 때 그림자 클래스가
 *    붙으면 css-interop 이 CSS 변수를 새로 단 컴포넌트를 재마운트하고, dev 경고가 props 를
 *    직렬화하다 크래시한다(실기 전용 — jest 는 이 경로를 못 탄다). 그래서 원인 패턴을 소스로 잠근다.
 *  - 정상: 선택 탭만 RN style 그림자를 갖고, 선택된 탭은 정확히 1개다(TRIP-604 무회귀).
 */

const SOURCE = readFileSync(join(__dirname, 'TripStatusSegment.tsx'), 'utf8');
const BUCKETS = ['upcoming', 'active', 'ended'] as const;

describe('TRIP-977 · 그림자 유틸 동적 토글 금지(소스 가드)', () => {
  // 이름 목록이 아니라 "CSS 변수·애니메이션을 선언하는 유틸 계열" 전체를 막는다(03b 경고-1:
  // `shadow`·`ring-1`·`shadow-black/10`·`scale-105` 도 같은 재마운트 경로를 탄다).
  it('소스에 CSS 변수·애니메이션 선언 유틸(shadow·ring·scale·translate·rotate·skew·transition·animate)이 없다', () => {
    expect(SOURCE).not.toMatch(
      /\b(shadow|ring|scale|translate|rotate|skew|transition|animate)(-[\w/.[\]-]+)?\b(?![A-Z])/
    );
  });
});

describe('TRIP-977 · 선택 탭 그림자는 style 로', () => {
  it.each(BUCKETS)('active=%s 이면 그 탭만 selected + 그림자다', (active) => {
    render(<TripStatusSegment active={active} onChange={jest.fn()} />);

    for (const bucket of BUCKETS) {
      const tab = screen.getByTestId(`my-trip-segment-${bucket}`);
      const selected = bucket === active;
      expect(tab.props.accessibilityState).toEqual({ selected });
      if (selected) {
        expect(tab).toHaveStyle({ shadowOpacity: expect.any(Number) });
      } else {
        expect(tab).not.toHaveStyle({ shadowOpacity: expect.any(Number) });
      }
    }
  });

  it('선택이 바뀌어도 selected 탭은 정확히 1개다', () => {
    const { rerender } = render(
      <TripStatusSegment active="upcoming" onChange={jest.fn()} />
    );
    rerender(<TripStatusSegment active="ended" onChange={jest.fn()} />);

    const selected = BUCKETS.filter(
      (b) =>
        screen.getByTestId(`my-trip-segment-${b}`).props.accessibilityState
          .selected
    );
    expect(selected).toEqual(['ended']);
  });
});
