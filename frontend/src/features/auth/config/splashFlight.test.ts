import {
  FLIGHT_P0,
  FLIGHT_P3,
  SPLASH_FLIGHT_MS,
  flightPoint,
  flightRotationDeg,
} from './splashFlight';

describe('splashFlight — 항로 베지어 좌표 (TRIP-1383)', () => {
  it('진행률 0 은 항로 시작점(55,230), 1 은 끝점(330,165)을 돌려준다', () => {
    expect(flightPoint(0)).toEqual(FLIGHT_P0);
    const end = flightPoint(1);
    expect(end.x).toBeCloseTo(330, 6);
    expect(end.y).toBeCloseTo(165, 6);
    expect(FLIGHT_P0).toEqual({ x: 55, y: 230 });
    expect(FLIGHT_P3).toEqual({ x: 330, y: 165 });
  });

  it('x 는 진행에 따라 단조 증가한다 — 항로 잘라 보이기(clip)의 전제', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i += 1) {
      const { x } = flightPoint(i / 100);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });

  it('회전각은 시작에서 위쪽으로 기울고(마커 보정 포함) 끝에서 아래쪽으로 기운다', () => {
    // 접선: 시작은 오른쪽 위(dy<0), 끝은 오른쪽 아래(dy>0) → 각도(도) 부호가 바뀐다.
    expect(flightRotationDeg(0)).toBeLessThan(flightRotationDeg(1));
    expect(Number.isFinite(flightRotationDeg(0.5))).toBe(true);
  });

  it('비행 시간은 1300ms 다', () => {
    expect(SPLASH_FLIGHT_MS).toBe(1300);
  });
});
