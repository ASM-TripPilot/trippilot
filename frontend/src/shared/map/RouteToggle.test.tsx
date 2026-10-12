import { fireEvent, render, screen } from '@testing-library/react-native';

import { RouteToggle, actualDistanceLabel } from './RouteToggle';

/** TRIP-1343 · 계획｜실제 토글(BR-U10-41). 경로 없음 → 실제 비활성 + 사유. 거리만(INV-3). */
describe('RouteToggle', () => {
  it('RT1 경로 있음: 실제 선택 → onChange(actual) · 거리 라벨', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <RouteToggle
        testIDPrefix="x"
        mode="plan"
        actualAvailable
        distanceLabel="실제 3.2km"
        onChange={onChange}
      />
    );
    expect(screen.queryByTestId('x-route-distance')).toBeNull();
    fireEvent.press(screen.getByTestId('x-route-toggle-actual'));
    expect(onChange).toHaveBeenCalledWith('actual');
    rerender(
      <RouteToggle
        testIDPrefix="x"
        mode="actual"
        actualAvailable
        distanceLabel="실제 3.2km"
        onChange={onChange}
      />
    );
    expect(screen.getByTestId('x-route-distance')).toHaveTextContent(
      '실제 3.2km'
    );
  });

  it('RT2 경로 없음: 실제 칸 비활성(눌러도 무반응) + 사유', () => {
    const onChange = jest.fn();
    render(
      <RouteToggle
        testIDPrefix="x"
        mode="plan"
        actualAvailable={false}
        disabledReason="이 날 기록된 경로가 없어요"
        onChange={onChange}
      />
    );
    fireEvent.press(screen.getByTestId('x-route-toggle-actual'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('x-route-disabled-reason')).toHaveTextContent(
      '이 날 기록된 경로가 없어요'
    );
  });

  it('RT3 거리 라벨은 km 소수 1자리, 시간·속도 없음', () => {
    expect(actualDistanceLabel(3249)).toBe('실제 3.2km');
    expect(actualDistanceLabel(0)).toBe('실제 0.0km');
    expect(actualDistanceLabel(12_350)).not.toMatch(/분|시간|km\/h/);
  });
});
