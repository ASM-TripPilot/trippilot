import fc from 'fast-check';

import { buildGenerationGauge, foldGenerationGauge } from './draftView';
import type {
  DraftDayTab,
  FoldedGenerationGaugeCell,
  GenerationGaugeCell,
  GenerationGaugeFold,
} from './draftView';

/**
 * TRIP-1040 · h07 진행 카드의 **칸 접기**(features 순수 함수 `foldGenerationGauge`).
 *
 * 무엇을 보장하나:
 *  - 여행 일수가 상한(max) 이하면 칸을 그대로 둔다(AC-1 무회귀).
 *  - 넘치면 칸을 max 개로 묶고, 그중 한 칸을 `…` 접기 칸(`{ kind: 'more' }`)으로 쓴다.
 *    지금 만드는 중인 일차(active)는 **항상 남는다**(결정 2 = b). active 가 앞쪽이면 뒤를 접고,
 *    뒤로 밀리면 앞을 접어 active 가 창의 마지막에 선다(Q1).
 *  - 접기 칸에는 숫자가 없다 — `{ kind: 'more' }` 외의 필드가 0개다(BR-U3-05 ⚑C, 가짜 진척 금지).
 *  - 접기는 **고르기만** 한다 — 남은 칸의 상태·일차는 입력과 같다.
 *
 * 3동작 뼈대: 준비=도착 패턴으로 tabs 를 만든다 → 실행=`buildGenerationGauge` → `foldGenerationGauge`
 *   → 단언=남은 칸을 `'일차:상태'`·`'…'` 문자열 배열로 읽어 비교한다.
 */

/** 도착 여부 배열 → 날짜 탭. `true` 면 그 일차 슬롯이 이미 도착했다(`hasData`). */
function tabsOf(arrived: boolean[]): DraftDayTab[] {
  return arrived.map((hasData, index) => ({
    date: `2026-06-${String(10 + index).padStart(2, '0')}`,
    dayNumber: index + 1,
    hasData,
  }));
}

function isFold(cell: FoldedGenerationGaugeCell): cell is GenerationGaugeFold {
  return 'kind' in cell;
}

/** 칸 배열을 사람이 읽는 문자열로 — 일차 칸은 `'3:done'`, 접기 칸은 `'…'`. */
function summary(cells: FoldedGenerationGaugeCell[]): string[] {
  return cells.map((cell) =>
    isFold(cell) ? '…' : `${cell.dayNumber}:${cell.state}`
  );
}

/** 상한 4(소비처 DraftPage 가 넘기는 값)로 접는다. */
function foldOf(arrived: boolean[]): FoldedGenerationGaugeCell[] {
  return foldGenerationGauge(buildGenerationGauge(tabsOf(arrived)), 4);
}

describe('🔴 F1 · AC-1 — 여행 일수가 상한 이하면 칸을 그대로 둔다', () => {
  it('3일·4일(경계) 여행은 입력과 같고 접기 칸이 없다', () => {
    const three = buildGenerationGauge(tabsOf([true, false, false]));
    const four = buildGenerationGauge(tabsOf([true, false, false, false]));

    expect(foldGenerationGauge(three, 4)).toEqual(three);
    expect(summary(foldGenerationGauge(three, 4))).toEqual([
      '1:done',
      '2:active',
      '3:waiting',
    ]);
    // 경계 — 정확히 4일이면 아직 접지 않는다(4칸 모두 일차 칸).
    expect(foldGenerationGauge(four, 4)).toEqual(four);
    expect(summary(foldGenerationGauge(four, 4))).not.toContain('…');
  });
});

describe('🔴 F2 · AC-2 — 활성이 앞쪽이면 뒤를 접는다', () => {
  it('5일 여행·day1 만 도착 → [1 완성, 2 생성 중, 3 대기, …]', () => {
    expect(summary(foldOf([true, false, false, false, false]))).toEqual([
      '1:done',
      '2:active',
      '3:waiting',
      '…',
    ]);
  });
});

describe('🔴 F3 · AC-3 — 활성이 뒤로 밀리면 앞을 접고 활성이 창 끝에 선다 (결정 2 = b · Q1)', () => {
  it('7일 여행·day1~4 도착 → […, 3 완성, 4 완성, 5 생성 중]', () => {
    expect(
      summary(foldOf([true, true, true, true, false, false, false]))
    ).toEqual(['…', '3:done', '4:done', '5:active']);
  });
});

describe('🔴 F4 · AC-4 — 활성이 없으면(전부 도착) 마지막 일차를 기준으로 앞을 접는다', () => {
  it('7일·5일 전부 도착 → … + 마지막 3일', () => {
    expect(summary(foldOf([true, true, true, true, true, true, true]))).toEqual(
      ['…', '5:done', '6:done', '7:done']
    );
    expect(summary(foldOf([true, true, true, true, true]))).toEqual([
      '…',
      '3:done',
      '4:done',
      '5:done',
    ]);
  });
});

describe('🔴 F5 · AC-5⑤ — 뒤 접기 ↔ 앞 접기가 바뀌는 경계', () => {
  it('5일에서 3일차 생성 중이면 뒤 접기, 4일차 생성 중이면 앞 접기다', () => {
    // 활성이 3일차(창 3칸의 마지막 자리) — 아직 1일차부터 보인다.
    expect(summary(foldOf([true, true, false, false, false]))).toEqual([
      '1:done',
      '2:done',
      '3:active',
      '…',
    ]);
    // 활성이 4일차 — 한 칸 밀려 `…` 가 앞으로 옮겨 간다.
    expect(summary(foldOf([true, true, true, false, false]))).toEqual([
      '…',
      '2:done',
      '3:done',
      '4:active',
    ]);
  });
});

describe('🔴 F6 · AC-5 속성 — 임의 일수·임의 도착 패턴·임의 상한에서 접기 규칙이 늘 성립한다 (fast-check)', () => {
  it('길이≤max · 짧으면 그대로 · 접기 칸 1개(숫자 없음) · 연속 구간 · 활성 포함 · 접기 위치 · 입력 불변', () => {
    fc.assert(
      fc.property(
        // 비연속 도착(예: [도착, 미도착, 도착])도 만든다 — anchor 는 "첫 active" 여야 한다.
        fc.array(fc.boolean(), { minLength: 1, maxLength: 14 }),
        fc.integer({ min: 3, max: 6 }),
        (arrived, max) => {
          // 준비
          const input = buildGenerationGauge(tabsOf(arrived));
          const before = JSON.parse(JSON.stringify(input)) as unknown;

          // 실행
          const out = foldGenerationGauge(input, max);

          // 입력을 바꾸지 않는다(순수 함수).
          expect(input).toEqual(before);
          // ① 칸 수는 상한 이하.
          expect(out.length).toBeLessThanOrEqual(max);

          // ② 짧으면 그대로.
          if (input.length <= max) {
            expect(out).toEqual(input);
            return;
          }

          // ③ 길면 정확히 max 칸, 그중 접기 칸은 정확히 1개이고 숫자·다른 필드가 없다.
          expect(out).toHaveLength(max);
          expect(out.filter(isFold)).toStrictEqual([{ kind: 'more' }]);

          // ③·⑥ 일차 칸은 입력의 연속 구간 그대로(순서·상태·일차 불변).
          const days = out.filter(
            (cell: FoldedGenerationGaugeCell): cell is GenerationGaugeCell =>
              !isFold(cell)
          );
          const start = days[0].dayNumber - 1;
          expect(days).toEqual(input.slice(start, start + days.length));

          // ④ 입력에 active 가 있으면 출력에도 있다.
          const active = input.find((cell) => cell.state === 'active');
          if (active !== undefined) {
            expect(days).toContainEqual(active);
          }

          // ⑤ 접기 칸이 앞에 오는 것은 anchor(첫 active, 없으면 마지막 일차)가 창 밖으로 밀릴 때뿐.
          const anchorIndex =
            active !== undefined ? active.dayNumber - 1 : input.length - 1;
          const foldFirst = isFold(out[0]);
          expect(foldFirst).toBe(anchorIndex > max - 2);

          if (foldFirst) {
            // Q1 — 앞 접기면 anchor 가 창의 마지막 칸이다.
            expect(days[days.length - 1]).toEqual(input[anchorIndex]);
          } else {
            // 뒤 접기면 1일차부터 보이고 `…` 는 맨 끝이다.
            expect(start).toBe(0);
            expect(isFold(out[out.length - 1])).toBe(true);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
