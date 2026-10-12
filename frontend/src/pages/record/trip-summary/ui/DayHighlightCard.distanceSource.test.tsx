import { render, screen } from '@testing-library/react-native';

import { DayHighlightCard } from './DayHighlightCard';

/** TRIP-1343 · BR-U10-39 — 날짜 카드 단위 거리 출처 라벨. 미전달이면 없음(플래그 OFF 무회귀). */
describe('DayHighlightCard distance source', () => {
  it('DH1 출처 라벨(경로/근사)이 날짜 testID 로 붙는다', () => {
    render(
      <DayHighlightCard
        dayLabel="1일차"
        visitCountLabel="3곳"
        subtitle=""
        distanceSourceLabel="경로"
        date="2026-06-10"
      />
    );
    expect(
      screen.getByTestId('summary-day-distance-source-2026-06-10')
    ).toHaveTextContent('· 거리 경로');
  });
  it('DH2 미전달이면 라벨 없음', () => {
    render(
      <DayHighlightCard dayLabel="1일차" visitCountLabel="3곳" subtitle="" />
    );
    expect(screen.queryByTestId(/summary-day-distance-source/)).toBeNull();
  });
});
