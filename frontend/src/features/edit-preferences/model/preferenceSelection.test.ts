import fc from 'fast-check';

import { toggleMulti, toggleSingle } from './preferenceSelection';

/**
 * AC5 · US-ONB-05/15 — 토글 순수 규칙 (preferenceSelection).
 *
 * 무엇을 보장하나: 복수 축(toggleMulti)은 null↔배열을 오가며 절대 []를 반환하지 않고,
 * 단일 축(toggleSingle)은 다른 값을 고르면 교체하고 같은 값을 다시 고르면 해제(null)한다.
 * 두 함수 모두 순수(입력 → 출력, 부수효과 없음)라 화면·스토어 없이 검증한다.
 *
 * 3동작: 준비(입력 상태 값) → 실행(toggle 함수 호출) → 단언(반환값).
 */

// 스타일 축(§3-1) 7개 slug — PBT 입력 도메인. 축 종류 자체는 "토글 규칙"과 무관하므로
// 임의로 골라도 무방하다(오라클 독립 — §7-13: 프로덕션 옵션 정의를 가져다 쓰지 않는다).
const STYLE_SLUGS = [
  'rest',
  'gourmet',
  'nature',
  'art',
  'activity',
  'sightseeing',
  'shopping',
] as const;

describe('toggleMulti — 복수 축 토글 (AC5 · AC-05-1~3 · 1-1~1-3)', () => {
  it('null에서 하나를 고르면 배열이 된다 (1-1)', () => {
    // 준비 — 아직 아무것도 안 고른 상태.
    const current: string[] | null = null;

    // 실행 — 'rest'를 토글.
    const next = toggleMulti(current, 'rest');

    // 단언 — 배열 ['rest']가 된다(빈 배열이 아니라 값이 담긴 배열).
    expect(next).toEqual(['rest']);
  });

  it('이미 선택된 값이 있어도 다른 값을 고르면 둘 다 유지된다 (1-2)', () => {
    // 준비 — '휴양(rest)'이 이미 선택된 상태.
    const current = ['rest'];

    // 실행 — '미식(gourmet)'을 추가로 토글.
    const next = toggleMulti(current, 'gourmet');

    // 단언 — 단일 토글처럼 이전 선택이 풀리지 않고 둘 다 남는다.
    expect(next).toEqual(expect.arrayContaining(['rest', 'gourmet']));
    expect(next).toHaveLength(2);
  });

  it('선택된 값을 다시 탭하면 해제되고, []가 아니라 null이 된다 (1-3)', () => {
    // 준비 — 'rest' 하나만 선택된 상태(이 값을 지우면 목록이 빈다).
    const current = ['rest'];

    // 실행 — 같은 'rest'를 다시 토글(해제).
    const next = toggleMulti(current, 'rest');

    // 단언 — null 복귀. []는 "빈 배열로 설정"과 "미설정"을 섞으므로 명시적으로 구분한다.
    expect(next).toBeNull();
    expect(next).not.toEqual([]);
  });
});

describe('toggleSingle — 단일 축 토글 (AC5 · AC-15-1 · 1-4)', () => {
  it('null → 값 선택 → 다른 값으로 교체 → 재탭 해제 순서를 지킨다 (1-4)', () => {
    // 준비 — 페이스 축, 아직 미선택.
    let current: string | null = null;

    // 실행1 — 'balanced'(균형) 선택.
    current = toggleSingle(current, 'balanced');
    // 단언1 — 처음 고른 값이 그대로 담긴다.
    expect(current).toBe('balanced');

    // 실행2 — 'packed'(빡빡) 선택 — 라디오형이라 이전 값을 밀어낸다.
    current = toggleSingle(current, 'packed');
    // 단언2 — 새 값으로 교체되고 'balanced'는 남지 않는다.
    expect(current).toBe('packed');

    // 실행3 — 같은 'packed'를 다시 탭 — §3-4 결정: 재탭하면 해제된다.
    current = toggleSingle(current, 'packed');
    // 단언3 — null로 돌아가 "미설정"을 다시 표현할 수 있다.
    expect(current).toBeNull();
  });
});

describe('toggleMulti — 성질(PBT): []는 절대 나오지 않는다 (AC5 · 1-5)', () => {
  it('임의 토글 시퀀스를 순차 적용해도 결과는 null이거나 비어있지 않은 부분집합이다', () => {
    // 준비 — fast-check: 입력을 수백 개 자동 생성해 성질을 깨는 반례를 찾는다(§1 개념 박스).
    //   fc.array(fc.constantFrom(...도메인)) = 도메인 slug로만 이뤄진 임의 길이 배열(토글 순서).
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...STYLE_SLUGS)), (sequence) => {
        // 실행 — null에서 시작해 시퀀스를 순서대로 적용한다.
        let state: string[] | null = null;
        for (const id of sequence) {
          state = toggleMulti(state, id);

          // 단언(불변식) — 매 단계마다 []는 절대 나오지 않는다.
          expect(state).not.toEqual([]);
          if (state !== null) {
            // 단언(추가) — 중복 없는 도메인 부분집합이어야 한다.
            expect(new Set(state).size).toBe(state.length);
            state.forEach((memberId) => {
              expect(STYLE_SLUGS).toContain(memberId);
            });
          }
        }
      }),
      { numRuns: 300 }
    );
  });
});

describe('toggleMulti — 성질(PBT): 같은 값 2연속 토글은 원상복구 (AC5 · 1-6)', () => {
  it('임의 시작 상태에서 같은 slug를 두 번 토글하면 원래 상태로 돌아온다', () => {
    fc.assert(
      fc.property(
        fc.subarray([...STYLE_SLUGS]),
        fc.constantFrom(...STYLE_SLUGS),
        (startArray, id) => {
          // 준비 — 임의의 시작 집합(중복 없는 부분집합, 비어 있으면 null로 취급)과
          // 토글할 slug 하나.
          const start = startArray.length > 0 ? startArray : null;

          // 실행 — 같은 id를 두 번 토글(선택→해제 또는 해제→선택 — 결과는 왕복해야 한다).
          const once = toggleMulti(start, id);
          const twice = toggleMulti(once, id);

          // 단언 — 집합 기준으로 시작 상태와 동일하다(순서는 무시, 존재 여부만 비교).
          expect(new Set(twice ?? [])).toEqual(new Set(start ?? []));
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('toggleSingle — 성질(PBT): 결과는 항상 null이거나 도메인 원소 1개 (AC5 · 1-7)', () => {
  it('임의 토글 시퀀스를 순차 적용해도 매 단계 "직전과 같으면 null, 다르면 그 값" 규칙을 지킨다', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('relaxed', 'balanced', 'packed')),
        (sequence) => {
          // 준비 — 페이스 축(단일) 도메인 3개로 임의 길이 시퀀스를 만든다.
          let actual: string | null = null;
          // 참조 모델 — "직전과 같으면 null, 다르면 그 값" 규칙을 SUT와 별개로 재현한다
          // (SUT 구현을 그대로 가져다 비교하면 동어반복이 되므로 오라클을 독립시킨다).
          let reference: string | null = null;

          // 실행+단언 — 매 단계마다 SUT(toggleSingle)와 참조 규칙을 나란히 적용해 비교한다.
          for (const id of sequence) {
            actual = toggleSingle(actual, id);
            reference = reference === id ? null : id;

            // 단언 — 매 단계마다 SUT 결과가 참조 규칙과 일치한다(배열이 아니라 스칼라).
            expect(actual).toBe(reference);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});
