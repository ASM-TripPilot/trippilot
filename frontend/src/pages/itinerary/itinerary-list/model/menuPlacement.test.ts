import { menuOpensAbove } from './menuPlacement';

/**
 * 창 높이 874 · 탭바 신고 70 + 간격 12 = 82 면 792 까지 패널이 들어간다. 패널 전체는 154 라
 * ⋯ 아랫변이 638 까지면 아래로, 그보다 아래면 위로 연다.
 */
describe('menuOpensAbove — ⋯ 메뉴 방향 (TRIP-1819)', () => {
  it.each([
    ['넉넉하면 아래로', 100, false],
    ['딱 맞으면 아직 아래로', 638, false],
    ['1pt 라도 넘으면 위로', 639, true],
    ['QA 재현 — ⋯ 아랫변 792 는 위로', 792, true],
  ])('%s', (_name, buttonBottom, above) => {
    expect(menuOpensAbove(buttonBottom, 874, 82)).toBe(above);
  });

  it('완료 배너처럼 아래를 더 막으면 같은 자리도 위로 연다', () => {
    expect(menuOpensAbove(600, 874, 82)).toBe(false);
    expect(menuOpensAbove(600, 874, 146)).toBe(true);
  });

  it('창이 작으면 같은 자리도 위로 연다', () => {
    expect(menuOpensAbove(500, 667, 82)).toBe(true);
  });
});
