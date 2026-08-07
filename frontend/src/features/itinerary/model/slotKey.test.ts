import fc from 'fast-check';

import { buildSlotKey, buildSlotKeys, parseSlotKey } from './slotKey';

/**
 * TRIP-295 · BR-U2-04 · PBT-U3-4 · PBT-U2-B3 (01b D1 · D2) — slotKey 키 규약.
 *
 * 무엇을 보장하나: `(date, poiId)`가 `"{date}#{poiId}"` 한 형태로만 조립되고
 * (`2026-09-14#7b0c…`), 그 키를 다시 읽으면 원래 두 값이 그대로 복원되며(왕복 항등),
 * 다른 입력은 반드시 다른 키가 된다(단사성). 같은 날 같은 POI가 두 번 오면 조용히
 * 덮어쓰지 않고 `kind:'conflict'`로 드러나고, 형태가 깨진 키는 `kind:'invalid'`로
 * 갈라진다. 이 키는 화면 testID(`itinerary-draft-slot-{slotKey}`)의 재료라 두 곳에서
 * 규약이 갈리면 화면에서야 드러난다 — 그래서 조립 함수와 목록 함수의 일치도 함께 잰다.
 *
 * > *(개념)* **판별 유니온(discriminated union)** — `kind`라는 공통 꼬리표 하나로 갈래를
 * > 구분하는 타입. `null`을 돌려주고 "없음인지 오류인지"를 호출부가 다시 추측하게 하는
 * > 대신 갈래를 타입이 직접 이름 짓는다. 리포 선례는 `parseBudgetAmount`의 3갈래다.
 *
 * > *(개념)* **왕복 항등(round-trip)** — 조립한 뒤 다시 분해하면 원본이 나오는 성질.
 * > 이것만으로는 부족하다 — 입력마다 임의의 유일 문자열을 돌려주는 구현도 통과한다.
 *
 * > *(개념)* **단사성(injectivity)** — "다른 입력 → 다른 출력". 왕복 항등과 **별개**
 * > 성질이고, 키 충돌 방지(BR-U2-04)가 요구하는 것이 바로 이쪽이다.
 *
 * 3동작: 준비(date·poiId) → 실행(build/parse) → 단언(키 문자열과 갈래).
 */

/** 2020-01-01 자정(UTC)을 초기점으로 삼는다. 아래 dateArb가 여기서 며칠 뒤를 센다. */
const EPOCH_ORIGIN_MS = Date.UTC(2020, 0, 1);
const MS_PER_DAY = 86_400_000;

/**
 * dateArb — 계약이 `format: date`(`YYYY-MM-DD`)다. 에폭일 정수를 세어 날짜로 옮긴다.
 *
 * ⚠️ `fc.date({ min, max })`를 쓰지 않는다. min/max를 줘도 **Invalid Date가 섞여 나오고**
 * (2,000표본 중 7개 = 0.35%, 02a §5-2 실측) `toISOString()`이 `RangeError`로 죽는다.
 * numRuns 500이면 약 82% 확률로 한 번은 밟는다 — 6표본·200표본 예비 확인에서는 0개라
 * 안전해 보였던 함정이다. 정수 조합에는 그 갈래가 원리적으로 없다.
 */
const dateArb = fc
  .integer({ min: 0, max: 5843 }) // 2020-01-01 ~ 2035-12-31
  .map((dayOffset) =>
    new Date(EPOCH_ORIGIN_MS + dayOffset * MS_PER_DAY)
      .toISOString()
      .slice(0, 10)
  );

/**
 * poiIdArb — 계약이 `format: uuid`다.
 *
 * ⚠️ fast-check의 uuid는 경계 편향이 커서 500표본 중 146개(29.2%)가 `000000…`·`ffffff…`
 * 로 시작한다(02a §5-3 실측) — "그럴듯한 UUID"는 오히려 드물다. 형식(36자·소문자 hex)과
 * "`#`을 포함하지 않음"은 500/500 지켜 왕복 PBT의 전제로는 충분하지만, BR-U2-04 본문
 * 예시와 글자 단위로 같은 꼴을 보이는 일은 아래 AC-7 예제가 맡는다.
 */
const poiIdArb = fc.uuid();

const entryArb = fc.record({ date: dateArb, poiId: poiIdArb });

describe('buildSlotKey — {date}#{poiId} 조립 (AC-7 · AC-8 · AC-9)', () => {
  it('date와 poiId를 #으로 이어 BR-U2-04 형태를 만든다 (AC-7, 예제)', () => {
    // 준비 — BR-U2-04 본문 예시와 같은 꼴(ISO 날짜 + UUID).
    const date = '2026-09-14';
    const poiId = '7b0c1f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';

    // 실행
    const key = buildSlotKey(date, poiId);

    // 단언 — 형태 자체를 값으로 박는다(글자 단위 완전 일치).
    expect(key).toBe('2026-09-14#7b0c1f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f');
  });

  it('임의의 (date, poiId)에서 조립→파싱 왕복이 항등이다 (AC-8, PBT)', () => {
    fc.assert(
      fc.property(dateArb, poiIdArb, (date, poiId) => {
        // 준비 — dateArb · poiIdArb. 어느 쪽도 '#'을 만들지 않는다는 것이 왕복의
        // 숨은 전제이고, 2,000쌍을 실제로 조립·분해해 확인했다(02a §5-5).
        // 실행
        const key = buildSlotKey(date, poiId);
        const parsed = parseSlotKey(key);

        // 단언 L1 — 모양 앵커: 구분자가 정확히 한 번 들어간다.
        expect(key).toBe(`${date}#${poiId}`);
        expect(key.split('#')).toHaveLength(2);

        // 단언 L2 — 왕복 항등: 원본 두 값이 그대로 복원된다.
        expect(parsed).toEqual({ kind: 'ok', date, poiId });
      }),
      { numRuns: 500 }
    );
  });

  it('서로 다른 (date, poiId)면 서로 다른 키가 나온다 — 단사성 (AC-9, PBT)', () => {
    fc.assert(
      fc.property(entryArb, entryArb, (left, right) => {
        // 준비 — 두 쌍. 같은 쌍이 뽑힌 표본은 이 성질의 대상이 아니라 건너뛴다.
        fc.pre(left.date !== right.date || left.poiId !== right.poiId);

        // 실행
        const leftKey = buildSlotKey(left.date, left.poiId);
        const rightKey = buildSlotKey(right.date, right.poiId);

        // 단언 — 키가 갈라진다(BR-U2-04 "키 충돌 방지").
        expect(leftKey).not.toBe(rightKey);
      }),
      { numRuns: 500 }
    );
  });

  it('구분자가 없으면 충돌할 짝도 갈라진다 (AC-9, 예제)', () => {
    // 준비 — 그냥 이어붙이면 둘 다 '2026-09-14abc'가 되는 두 쌍. 구분자 '#'이
    // 왜 필요한지가 이 한 케이스에 들어 있다.
    const left = buildSlotKey('2026-09-1', '4abc');
    const right = buildSlotKey('2026-09-14', 'abc');

    // 단언 — 값 자체(형태)와 "서로 다르다"(충돌 방지 목적)를 둘 다 본다. 값만 보면
    // 왜 이 형태여야 하는지가 사라지고, 다름만 보면 임의의 유일값 반환도 통과한다.
    expect([left, right]).toEqual(['2026-09-1#4abc', '2026-09-14#abc']);
    expect(left).not.toBe(right);
  });
});

describe('buildSlotKeys — 같은 날 같은 POI 충돌 검출 (AC-10)', () => {
  it('충돌이 없으면 kind:ok이고 키가 입력 순서대로 전부 담긴다 (긍정 앵커)', () => {
    // 준비 — 대조군 둘을 한 목록에 넣는다: 같은 날 다른 POI, 같은 POI 다른 날.
    // 앞의 것이 없으면 date만 보고 판정하는 구현이, 뒤의 것이 없으면 poiId만 보고
    // 판정하는 구현이 통과한다. BR-U2-04는 "같은 날 **그리고** 같은 POI"다.
    const entries = [
      { date: '2026-09-14', poiId: 'poi-a' },
      { date: '2026-09-14', poiId: 'poi-b' },
      { date: '2026-09-15', poiId: 'poi-a' },
    ];

    // 실행
    const result = buildSlotKeys(entries);

    // 단언 — 갈래·키·순서까지 완전 일치(배열 toEqual은 순서에 민감하다).
    expect(result).toEqual({
      kind: 'ok',
      keys: ['2026-09-14#poi-a', '2026-09-14#poi-b', '2026-09-15#poi-a'],
    });
  });

  it('같은 날 같은 poiId가 두 번 오면 kind:conflict로 드러난다 (AC-10)', () => {
    // 준비 — 1번과 3번이 같은 날 같은 POI다.
    const entries = [
      { date: '2026-09-14', poiId: 'poi-a' },
      { date: '2026-09-14', poiId: 'poi-b' },
      { date: '2026-09-14', poiId: 'poi-a' },
    ];

    // 실행
    const result = buildSlotKeys(entries);

    // 단언 — 조용히 덮어써서 슬롯 하나가 사라지면 위반이다.
    expect(result.kind).toBe('conflict');

    // 단언 — 어느 키가 겹쳤는지가 드러나야 한다. kind만 바꾸고 정보를 버리면
    // 호출부가 무엇을 고쳐야 하는지 알 수 없다.
    expect((result as { duplicates: string[] }).duplicates).toContain(
      '2026-09-14#poi-a'
    );
  });

  it('서로 다른 항목만 있으면 각 키가 buildSlotKey와 일치한다 (AC-10, PBT)', () => {
    fc.assert(
      fc.property(
        // 준비 — (date, poiId) 쌍이 서로 겹치지 않는 목록만 뽑는다.
        fc.uniqueArray(entryArb, {
          selector: (entry) => `${entry.date}#${entry.poiId}`,
          minLength: 1,
          maxLength: 8,
        }),
        (entries) => {
          // 실행
          const result = buildSlotKeys(entries);

          // 단언 — 충돌이 없으므로 ok 갈래다.
          expect(result.kind).toBe('ok');

          // 단언 — 목록 함수와 조립 함수가 **같은 규약**을 쓴다. 두 경로가 갈리면
          // 화면 testID가 갈라지고 렌더 층에서야 드러난다.
          expect((result as { keys: string[] }).keys).toEqual(
            entries.map((entry) => buildSlotKey(entry.date, entry.poiId))
          );
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('parseSlotKey — 깨진 입력 분류 (AC-11)', () => {
  it('형태가 맞는 키는 kind:ok로 갈라 읽는다 (긍정 앵커)', () => {
    // 준비 + 실행 — 이 앵커가 없으면 아래 세 줄은 항상 invalid를 돌려주는 구현에도
    // 전부 통과한다.
    const parsed = parseSlotKey('2026-09-14#poi-a');

    // 단언
    expect(parsed).toEqual({
      kind: 'ok',
      date: '2026-09-14',
      poiId: 'poi-a',
    });
  });

  /**
   * 01b D2가 동결한 세 갈래. `'#abc'`처럼 구성요소가 비는 경우는 **일부러 넣지 않았다** —
   * 그것을 invalid로 볼지가 어느 정본에도 없어(02a ★12) 여기서 정하면 요구사항 발명이다.
   */
  const BROKEN_CASES: { name: string; key: string }[] = [
    { name: '# 없음', key: '2026-09-14' },
    { name: '# 둘 이상', key: '2026-09-14#poi-a#extra' },
    { name: '빈 문자열', key: '' },
  ];

  it.each(BROKEN_CASES)('$name → kind:invalid (AC-11)', ({ key }) => {
    // 준비 = 표의 한 행 · 실행 = parseSlotKey · 단언 = 갈래가 invalid다.
    // 왕복이 성립하지 않는 입력을 조용히 통과시키지 않는다.
    expect(parseSlotKey(key)).toEqual({ kind: 'invalid' });
  });
});
