/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

import {
  REPLAN_DIRECTIVES,
  REPLAN_REASONS,
} from '@/features/planb/config/replanChoices';
import * as replanScopeModule from '@/features/planb/model/replanScope';
import {
  DEFAULT_REPLAN_SCOPE,
  REPLAN_SCOPES,
} from '@/features/planb/model/replanScope';

/**
 * TRIP-439 · AC-5 · BR-U4-11 · DEC-U4-3 — i10 재계획 **범위 잠금** 구조가드.
 *
 * 무엇을 보장하나:
 *  - 🔴 범위는 **정확히 2종**(`PARTIAL_SLOTS`=지금 이후 · `FULL_DAY`=오늘 전체) — 다일 재계획 없음.
 *  - 🔴 소스 어디에도 `내일` 문자열 0건 — '내일' 재계획은 계약상 존재하지 않는다(DEC-U4-3).
 *  - 🔴 사유 6종 · 방향 11종(key=testID·와이어값, 라벨)이 `config/replanChoices` 에 실재하고,
 *    `model/replanScope` 에는 범위만 남는다(TRIP-750 AC-3 — 카탈로그 이관, 두 벌 금지).
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

describe('🔴 G3 · 사유·방향 카탈로그 (TRIP-750 AC-2·3 · Q1 · D5)', () => {
  it('사유 6종·방향 11종이 key·라벨·순서 그대로다', () => {
    expect(REPLAN_REASONS.map((r) => [r.key, r.label])).toEqual([
      ['TEMP_CLOSED', '임시 휴무'],
      ['SLOW_MOVE', '이동 지연'],
      ['LOW_ENERGY', '체력 저하'],
      ['FULLY_BOOKED', '예약 마감'],
      ['WEATHER', '날씨'],
      ['JUST_CHANGE', '그냥 바꾸고 싶어요'],
    ]);
    expect(REPLAN_DIRECTIVES.map((d) => [d.key, d.label])).toEqual([
      ['RELAX', '여유 있게'],
      ['FILL_MORE', '더 채워서'],
      ['INDOOR', '실내로'],
      ['EARLIER', '시간만 당기기'],
      ['NEARBY', '가까운 곳으로'],
      ['ADD_FOOD', '맛집 추가'],
      ['END_NEAR_STAY', '숙소 근처에서 끝내기'],
      ['LESS_MOVE', '이동 짧게'],
      ['KEEP_BUDGET', '예산 유지'],
      ['KEEP_DINNER', '저녁은 그대로'],
      ['AVOID_OUTDOOR', '야외 피하기'],
    ]);
  });
});

describe('🔴 G5 · 카탈로그는 config 한 곳뿐 (TRIP-750 AC-3)', () => {
  it('model/replanScope 는 사유·방향 배열을 export 하지 않는다(범위 2종은 남는다)', () => {
    expect(Object.keys(replanScopeModule)).not.toContain('REPLAN_REASONS');
    expect(Object.keys(replanScopeModule)).not.toContain('REPLAN_DIRECTIVES');
    expect(Object.keys(replanScopeModule)).toContain('REPLAN_SCOPES');
  });
});

describe('🔴 G4 · 내일 0건 (부정 짝 · DEC-U4-3)', () => {
  it('replanScope.ts 소스(주석 제외)에 내일 문자열이 없다', () => {
    const stripped = stripComments(fs.readFileSync(SCOPE_SOURCE, 'utf8'));
    expect(stripped.includes('내일')).toBe(false);
  });
});
