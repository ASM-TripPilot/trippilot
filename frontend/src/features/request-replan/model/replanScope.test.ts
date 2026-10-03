import {
  DEFAULT_REPLAN_SCOPE,
  REPLAN_SCOPES,
  replanScopeOptions,
} from './replanScope';

/**
 * TRIP-1195 · 결정 2 — 오늘이 아닌 날에는 '지금 이후'(PARTIAL_SLOTS) 칩을 내리고 "{N}일차 전체" 한 칩만 남긴다.
 * 서버가 오늘 아닌 날 + PARTIAL_SLOTS 를 400 으로 막는다(openapi) — 그 조합을 화면이 아예 못 만들게 한다.
 */
describe('replanScopeOptions', () => {
  it('S1 오늘(날짜 없음)이면 종전 2칩 그대로다', () => {
    expect(replanScopeOptions()).toBe(REPLAN_SCOPES);
    expect(replanScopeOptions().map((o) => o.scope)).toEqual([
      'PARTIAL_SLOTS',
      'FULL_DAY',
    ]);
    expect(DEFAULT_REPLAN_SCOPE).toBe('PARTIAL_SLOTS');
  });

  it('S2 🔴 오늘이 아닌 날이면 FULL_DAY 한 칩뿐이고 라벨은 "{N}일차 전체"다', () => {
    expect(replanScopeOptions({ dayNumber: 2 })).toEqual([
      { scope: 'FULL_DAY', label: '2일차 전체' },
    ]);
  });

  it('S3 일차를 모르면(일정 미도착) "이 날 전체"로 쓰되 여전히 FULL_DAY 하나다', () => {
    expect(replanScopeOptions({ dayNumber: null })).toEqual([
      { scope: 'FULL_DAY', label: '이 날 전체' },
    ]);
  });

  it('S4 INV-3 — 어떤 라벨에도 분·시간·소요가 없다', () => {
    const labels = [
      ...REPLAN_SCOPES,
      ...replanScopeOptions({ dayNumber: 3 }),
      ...replanScopeOptions({ dayNumber: null }),
    ].map((o) => o.label);
    labels.forEach((label) => expect(label).not.toMatch(/분|시간|소요/));
  });
});
