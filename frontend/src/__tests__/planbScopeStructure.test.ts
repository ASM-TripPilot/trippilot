/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

import {
  DEFAULT_REPLAN_SCOPE,
  REPLAN_DIRECTIVES,
  REPLAN_REASONS,
  REPLAN_SCOPES,
} from '@/features/planb/model/replanScope';

/**
 * TRIP-439 · AC-5 · BR-U4-11 · DEC-U4-3 — i10 재계획 **범위 잠금** 구조가드.
 *
 * 무엇을 보장하나:
 *  - 🔴 범위는 **정확히 2종**(`PARTIAL_SLOTS`=지금 이후 · `FULL_DAY`=오늘 전체) — 다일 재계획 없음.
 *  - 🔴 소스 어디에도 `내일` 문자열 0건 — '내일' 재계획은 계약상 존재하지 않는다(DEC-U4-3).
 *  - 🔴 사유 6 key · 방향 7 key(testID·와이어값)가 카탈로그에 실재(긍정 앵커, D2).
 *
 * 왜 런타임 import + 소스 스캔 이중인가(★6): "정확히 2종"은 실물 배열을 import 해 재는 것이
 * 소스 정규식보다 강하다. "내일 0건"은 헬퍼·주석 어디에 숨어도 잡으려면 소스 스캔이라야 한다.
 *
 * 전처리×탐지기 조합(★7): 소스를 stripComments 로 가공한 뒤 `내일` 을 훑으므로, 가공이 탐지
 * 대상을 지우거나(주석 속) 살려두는지(코드 리터럴)·URL 슬래시를 오인하지 않는지를 G1 에서 실측한다
 * (문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열).
 */

const SCOPE_SOURCE = path.resolve(
  'src',
  'features',
  'planb',
  'model',
  'replanScope.ts'
);

/** 주석을 걷어낸다. `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('G1 · 전처리×탐지기 자가검사 (★7)', () => {
  it('주석 속 내일은 걷히고, 코드 리터럴 내일은 살아남으며, URL 슬래시는 보존된다', () => {
    const sample = [
      '// 내일 재계획은 없다(DEC-U4-3).',
      "const url = 'https://figma.com/design/x';",
      "const bad = '내일';",
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석의 내일은 사라진다.
    expect(stripped).not.toContain('재계획은 없다');
    // 코드 리터럴 내일은 남아 탐지된다(가짜 통과 방지).
    expect(stripped).toContain("const bad = '내일';");
    expect(stripped.includes('내일')).toBe(true);
    // URL 의 `://` 는 주석으로 오인되지 않아 그대로 보존된다.
    expect(stripped).toContain('https://figma.com/design/x');
  });
});

describe('🔴 G2 · 범위 정확히 2종 (런타임 · 긍정 앵커)', () => {
  it('PARTIAL_SLOTS·FULL_DAY 두 매핑만 있고 기본은 지금 이후다', () => {
    expect(REPLAN_SCOPES).toHaveLength(2);
    expect(REPLAN_SCOPES.map((s) => s.scope)).toEqual([
      'PARTIAL_SLOTS',
      'FULL_DAY',
    ]);
    expect(REPLAN_SCOPES.map((s) => s.label)).toEqual([
      '지금 이후',
      '오늘 전체',
    ]);
    expect(DEFAULT_REPLAN_SCOPE).toBe('PARTIAL_SLOTS');
  });
});

describe('🔴 G3 · 사유·방향 카탈로그 key (D2 · testID·와이어값)', () => {
  it('사유 6 key·방향 7 key 가 정확히 그 집합이다', () => {
    expect(REPLAN_REASONS.map((r) => r.key)).toEqual([
      'TEMP_CLOSED',
      'SLOW_MOVE',
      'LOW_ENERGY',
      'FULLY_BOOKED',
      'WEATHER',
      'JUST_CHANGE',
    ]);
    expect(REPLAN_DIRECTIVES.map((d) => d.key)).toEqual([
      'RELAX',
      'FILL_MORE',
      'INDOOR',
      'NEARBY',
      'ADD_FOOD',
      'NIGHT_VIEW',
      'LESS_MOVE',
    ]);
  });
});

describe('🔴 G4 · 내일 0건 (부정 짝 · DEC-U4-3)', () => {
  it('replanScope.ts 소스(주석 제외)에 내일 문자열이 없다', () => {
    const stripped = stripComments(fs.readFileSync(SCOPE_SOURCE, 'utf8'));
    expect(stripped.includes('내일')).toBe(false);
  });
});
