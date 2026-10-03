import fc from 'fast-check';

import { resolveCandidateSelection } from './candidateSelection';

/**
 * TRIP-1073 B · 후보가 도착했을 때 어느 후보를 선택 상태로 둘지 정하는 순수 판정.
 *
 * 규칙(결정 2 (a) · 01b 열린 질문 3 글자 그대로): 사용자가 **직접 탭한** 후보가 지금 목록에 있으면
 * 그것, 아니면 첫 후보(A). 후보가 없으면 선택 없음(null). 자동으로 잡힌 A 는 "사용자가 고른 것"이
 * 아니므로, 호출처는 탭한 poiId 만 넘긴다 — 반경·컨셉을 바꿔 목록이 새로 오면 새 A 가 된다.
 *
 * 무엇을 보장하나: 결과는 늘 **지금 목록 안의 poiId** 다(INV-1). 목록에 없는 후보로 확정 PUT 이
 * 나가는 길(지금 코드의 잠복 결함)을 이 판정 한 곳이 막는다.
 */

const list = (...ids: string[]) => ids.map((poiId) => ({ poiId }));

describe('🔴 resolveCandidateSelection — 표 (B1·B3·B4·B5)', () => {
  it.each<[string, { poiId: string }[], string | null, string | null]>([
    ['후보 0건 · 탭 없음 → 선택 없음', [], null, null],
    ['후보 0건 · 탭 기록만 남음 → 선택 없음', [], 'Y', null],
    ['탭 없음 → 첫 후보(A)', list('X', 'Y', 'Z'), null, 'X'],
    ['탭한 Y 가 목록에 있음 → Y', list('X', 'Y', 'Z'), 'Y', 'Y'],
    ['재조회 [W,Y] · 탭한 Y 가 남음 → Y 유지(B3)', list('W', 'Y'), 'Y', 'Y'],
    ['재조회 [W,X] · 탭한 Y 가 빠짐 → 새 A(W)(B5)', list('W', 'X'), 'Y', 'W'],
    [
      '재조회 [W,X] · 탭 없음(자동 X 였음) → 새 A(W)(B4)',
      list('W', 'X'),
      null,
      'W',
    ],
  ])('%s', (_label, candidates, tapped, expected) => {
    // 준비·실행 — 목록과 탭 기록을 넣는다.
    // 단언 — 원시값 동일(toBe). null 도 toBe 로 비교된다.
    expect(resolveCandidateSelection(candidates, tapped)).toBe(expected);
  });
});

/**
 * 성질(PBT). poiId 는 `p{숫자}` 로, "목록 밖" 탭은 `gone-{숫자}` 로 만들어 접두가 달라 절대 겹치지
 * 않게 한다 — 우연히 목록 안 값을 "밖"으로 뽑는 가짜 반례를 원천 차단한다.
 *
 * *(개념)* `fc.uniqueArray` — 원소가 서로 다른 배열을 만든다. 후보 poiId 는 목록 안에서 유일하다.
 */
const arbCase = fc.record({
  ids: fc
    .uniqueArray(fc.nat({ max: 30 }), { maxLength: 6 })
    .map((ns) => ns.map((n) => `p${n}`)),
  tapKind: fc.constantFrom('none', 'inList', 'outside'),
  pick: fc.nat(),
  gone: fc.nat({ max: 30 }),
});

describe('🔴 resolveCandidateSelection — 성질(PBT)', () => {
  it('0건이면 null · 결과는 늘 목록 안 · 탭한 후보가 있으면 그것 · 아니면 첫 후보', () => {
    fc.assert(
      fc.property(arbCase, ({ ids, tapKind, pick, gone }) => {
        // 준비 — 탭 기록을 세 갈래(없음·목록 안·목록 밖)로 만든다.
        //   목록이 비었는데 'inList' 가 뽑히면 고를 게 없으니 '목록 밖'으로 친다.
        const tapped =
          tapKind === 'none'
            ? null
            : tapKind === 'outside' || ids.length === 0
              ? `gone-${gone}`
              : ids[pick % ids.length];

        // 실행
        const result = resolveCandidateSelection(list(...ids), tapped);

        // 단언 ① 0건이면 선택 없음, 있으면 반드시 하나를 고른다.
        if (ids.length === 0) {
          expect(result).toBeNull();
          return;
        }
        expect(result).not.toBeNull();
        // 단언 ② INV-1 — 목록 밖 poiId 가 선택으로 새지 않는다.
        expect(ids).toContain(result);
        // 단언 ③·④ 탭한 후보가 목록에 있으면 그것, 아니면 첫 후보(A).
        if (tapped !== null && ids.includes(tapped)) {
          expect(result).toBe(tapped);
        } else {
          expect(result).toBe(ids[0]);
        }
      })
    );
  });
});
