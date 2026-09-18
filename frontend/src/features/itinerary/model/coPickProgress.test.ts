import fc from 'fast-check';

import { coPickProgress } from './coPickProgress';

/**
 * AC-6 (h16 진행 카운터) — "3/5 슬롯 선택됨 · 남은 2개"의 유일한 판정처.
 *
 * 무엇을 보장하나:
 *  - total = 전체 슬롯(고정 포함) · remaining = 빈 fillable 슬롯(고정 아님 && 미채움) ·
 *    filled = total - remaining(고정은 filled 로 접힌다 = 결정됨, 절대 remaining 아님).
 *  - E2 확정 게이트는 remaining===0 일 때만 열린다 — 이 함수의 remaining 이 그 진실.
 *
 * 준비(Arrange)→실행(Act)→단언(Assert) 3동작으로 서술한다.
 */
describe('🔴 coPickProgress (AC-6)', () => {
  it('C1 · Figma 구체값 — 찬2·빈2·고정1 → 3/5, 남은 2', () => {
    // 준비: h16 Figma 의 슬롯 구성(1·2 찬 · 3·4 빈 · 5 숙소 고정).
    const slots = [
      { fixed: false, filled: true },
      { fixed: false, filled: true },
      { fixed: false, filled: false },
      { fixed: false, filled: false },
      { fixed: true, filled: false },
    ];

    // 실행 + 단언: 고정은 filled 로 접혀 3/5, 남은(빈 fillable) 2.
    expect(coPickProgress(slots)).toEqual({
      total: 5,
      filled: 3,
      remaining: 2,
    });
  });

  it('C2 · 고정 슬롯은 채워지지 않아도 remaining 이 아니다(고정 취급 일관)', () => {
    // 준비: 고정인데 filled=false — 그래도 채울 자리가 아니다.
    const result = coPickProgress([{ fixed: true, filled: false }]);

    // 단언: remaining 0(고정은 선택 대기가 아님) · filled 1(결정됨).
    expect(result.remaining).toBe(0);
    expect(result.filled).toBe(1);
  });

  it('C3 · 전부 채우면 remaining 0 (E2 확정 게이트 열림 조건)', () => {
    const result = coPickProgress([
      { fixed: false, filled: true },
      { fixed: false, filled: true },
    ]);

    expect(result.remaining).toBe(0);
  });

  it('C4 · 빈 배열 → 0/0, NaN 없음', () => {
    expect(coPickProgress([])).toEqual({ total: 0, filled: 0, remaining: 0 });
  });

  it('C5 · PBT 항등 — 임의 슬롯 배열에 filled+remaining=total, 고정 취급 일관', () => {
    // 준비: fast-check 가 무작위 슬롯 배열 수백 개를 생성한다.
    //  (개념) PBT = 예제 하나가 아니라 "항상 성립하는 성질"을 검사한다.
    fc.assert(
      fc.property(
        fc.array(fc.record({ fixed: fc.boolean(), filled: fc.boolean() }), {
          maxLength: 30,
        }),
        (slots) => {
          // 실행
          const { total, filled, remaining } = coPickProgress(slots);
          // 단언(성질): 세 항등이 임의 입력에 항상 참.
          const expectedRemaining = slots.filter(
            (s) => !s.fixed && !s.filled
          ).length;
          return (
            filled + remaining === total &&
            remaining === expectedRemaining &&
            remaining >= 0 &&
            remaining <= total
          );
        }
      )
    );
  });
});
