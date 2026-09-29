import { render, screen, within } from '@testing-library/react-native';

import type { ReflectionStats } from '@/shared/api/generated/schemas';

import { ReflectionStatsRow } from './ReflectionStatsRow';

/**
 * TRIP-1086 · j03 통계 타일의 이동 거리 — 서버 double 을 그대로 찍지 않고 '1.9km' 로 보인다.
 *
 * 무엇을 보장하나:
 *  - 🔴 AC-1: `distanceDash:false` 면 거리 칸이 0.1 단위 표기('1.9km'·'12km'·'0.4km')다. 날값 '1.929…' 없음.
 *  - AC-6(BR-U5-39): `distanceDash:true` 면 값이 무엇이든 '—' — '0km' 로 바뀌지 않는다("측정 못 함" ≠ 0).
 *
 * (개념) `within(상자).getByText('글자')` = 그 상자 안에서 글자가 **정확히 같은** Text 노드를 찾는다.
 */

function stats(distanceKm: number): ReflectionStats {
  return {
    visitCount: 3,
    distanceKm,
    distanceSource: 'VISIT_LINE',
    photoCount: 2,
  };
}

describe('🔴 AC-1 · 거리 칸은 0.1 단위 표기', () => {
  it.each([
    [1.9294588176597474, '1.9km'],
    [12, '12km'],
    [0.4, '0.4km'],
  ])('distanceKm %p → "%s"', (km, expected) => {
    render(<ReflectionStatsRow stats={stats(km)} distanceDash={false} />);

    const row = screen.getByTestId('reflection-daily-stats');
    expect(within(row).getByText(expected)).toBeOnTheScreen();
    // 날값 double 이 새어 나오지 않는다.
    expect(within(row).queryByText(/1\.929/)).toBeNull();
  });
});

describe('AC-6 · 대시 분기 무회귀 — 측정 못 함은 0km 이 아니다', () => {
  it.each([0, 0.04])('distanceDash:true · distanceKm %p → "—"', (km) => {
    render(<ReflectionStatsRow stats={stats(km)} distanceDash />);

    const row = screen.getByTestId('reflection-daily-stats');
    expect(within(row).getByText('—')).toBeOnTheScreen();
    expect(within(row).queryByText(/km$/)).toBeNull();
  });
});
