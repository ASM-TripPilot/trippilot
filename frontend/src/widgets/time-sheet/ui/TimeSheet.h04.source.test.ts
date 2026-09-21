/**
 * @jest-environment node
 */
// TRIP-787 · AC-E1 — endsNextDay 유도 단일화 소스 가드(선제 green 트립와이어).
//
// 무엇을 보장하나: h04 변형이 endsNextDay 유도(`end <= start`)를 **재구현하지 않는다**.
//   재구현하면 default 와 두 벌이 되어 한쪽만 고쳐질 때 INV-2 계약이 드리프트한다(02a ★2·seed).
//   현재 유도는 `handleApply`의 line 154 `nextEnd <= nextStart` 하나뿐(실측, 02a §5-D) →
//   `<=` 연산자가 이 파일에 정확히 1개. h04 분기가 유도를 새로 짜면 2개가 되어 red.
//   (helper 로 추출하면 `<=`가 helper 로 옮겨가도 1 유지 — 정당한 리팩토링은 무해.)
//
// jest 는 "유도가 실제로 공유되는가"를 행동으로는 못 본다(h04 apply 페이로드는 seed Q1 로 이연) —
// 소스 스캔이 유일한 그물이다(개념: 가드의 사정거리).
import fs from 'fs';
import path from 'path';

const SUT = path.resolve('src/widgets/time-sheet/ui/TimeSheet.tsx');

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석을 먼저(순서 바꾸면 한 줄 안 코드 소실). 줄 주석은 바로 앞
 * 글자가 `:` 이면(=`https://`) 주석으로 안 본다(동결 가드들과 같은 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function countLte(source: string): number {
  return (source.match(/<=/g) ?? []).length;
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 `<=`·endsNextDay 는 걷히고, 코드의 `<=`·URL 은 살아남는다', () => {
    const sample = [
      '/** endsNextDay 는 end <= start 유도다. raw <= 주석. */',
      '// const dead = a <= b; // 주석 속 유도',
      'const live = nextEnd <= nextStart;',
      "const url = 'https://x/y';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 `<=`·문구는 걷힌다 — 안 걷으면 수호 주석이 카운트를 부풀린다.
    expect(countLte(stripped)).toBe(1);
    expect(stripped).not.toContain('end <= start 유도');
    expect(stripped).not.toContain('dead');

    // ② 코드의 `<=`·URL 은 살아남는다(콜론 뒤 `//` 는 주석이 아니다).
    expect(stripped).toContain('nextEnd <= nextStart');
    expect(/https?:\/\//.test(stripped)).toBe(true);
  });
});

describe('🔴 AC-E1 · endsNextDay 유도는 TimeSheet.tsx 에 단 한 벌 (h04 재구현 금지)', () => {
  it('`<=` 유도가 정확히 1개 (부정: 2벌 금지) + endsNextDay 식별자 실재 (긍정 짝)', () => {
    const stripped = stripComments(fs.readFileSync(SUT, 'utf8'));

    // 긍정 짝 — 유도 대상이 실재한다(빈/무관 파일에서 공허 통과 방지).
    expect(stripped).toContain('endsNextDay');

    // 부정 — 유도(`<=`)는 정확히 한 곳(현재 line 154). h04 가 두 벌로 짜면 2 → red(02a §3-4·§5-D).
    expect(countLte(stripped)).toBe(1);
  });
});
