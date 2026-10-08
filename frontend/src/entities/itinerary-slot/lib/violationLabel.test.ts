import fc from 'fast-check';

import { VIOLATION_NOTICE, violationNotice } from './violationLabel';

/**
 * 위반 표식 문구 `violationNotice` — h08 셸·h14/h16·폴백 목록·편집기(h12·i07, TRIP-1298)가 함께 쓴다.
 * 서버 정성 문구는 그대로, 비었거나 숫자가 섞이면 고정 라벨(INV-3), 거리를 모르는 슬롯은 "이동 시간 빠듯"
 * 조각을 뺀다(TRIP-1274).
 *
 * 3동작: 준비(슬롯 위반 데이터) → 실행(violationNotice) → 단언(반환 문자열).
 */

describe('🔴 TRIP-1031 · violationNotice — 서버 정성 문구는 보이고, 숫자가 섞이면 고정 라벨', () => {
  it('위반 없음이면 null', () => {
    expect(
      violationNotice({
        hasViolation: false,
        violationReason: '영업시간과 맞지 않아요',
      })
    ).toBeNull();
  });

  it('정성 문구(숫자 없음)는 그대로 보인다', () => {
    // TRIP-1274 — 거리를 아는 슬롯이어야 이동 문구가 "근거 있음"으로 남는다(아래 N2 와 같은 갈래).
    expect(
      violationNotice({
        hasViolation: true,
        violationReason:
          '앞 장소에서 이동할 시간이 빠듯해요 · 영업시간과 맞지 않아요',
        distanceRange: '약 2.1km · 도보 추정',
      })
    ).toBe('앞 장소에서 이동할 시간이 빠듯해요 · 영업시간과 맞지 않아요');
  });

  it.each([
    ['null', null],
    ['빈 문자열', ''],
    ['공백', '   '],
    ['옛 서버 소요시간', '이동 54분 필요, 간격 -60분'],
    ['옛 서버 원시 분 범위', '영업시간 밖: 543~618'],
  ])('%s → 고정 라벨 (INV-3 폴백)', (_n, reason) => {
    expect(
      violationNotice({ hasViolation: true, violationReason: reason })
    ).toBe(VIOLATION_NOTICE);
  });
});

// TRIP-1274 · 다른 후보로 바꾼 뒤 서버가 그 구간 거리를 못 채우면(null) "이동할 시간이 빠듯해요"는 근거가
// 화면에 없는 단정이다(사용자 결정 1, 2026-10-08) — 그 조각만 뺀다. 판정 단위는 슬롯 하나, 그 슬롯 자기
// distanceRange 가 HC2 가 본 구간이다(HC2 는 도착 슬롯에 붙는다).
// 문구는 서버 ViolationText.phraseOf 와 글자 단위로 같아야 해서 리터럴로 들고 있다(02a ★3).
// 구분자 " · " 의 점은 U+00B7 이다(02a §5-1).
const HC2 = '앞 장소에서 이동할 시간이 빠듯해요';
const OPENING = '영업시간과 맞지 않아요';
const DAY_WINDOW = '그 날의 일정 시간대를 벗어났어요';
const MUST_VISIT = '꼭 갈 곳이 일정에 들어가지 못했어요';
const GENERIC = '일정 조건과 맞지 않아요';
const SEP = ' · ';
const NO_DISTANCE = [null, undefined, ''] as const;
const KNOWN_DISTANCE = '약 2.1km · 도보 추정';

describe('🔴 TRIP-1274 · violationNotice — 거리를 모르는 슬롯은 "이동 시간 빠듯" 단정을 뺀다', () => {
  it.each(NO_DISTANCE)(
    'N1 · 사유가 이동 문구뿐 · distanceRange=%p → 고정 라벨 "일정 확인이 필요해요"(Seed Q1 — 표식은 남긴다)',
    (distanceRange) => {
      const out = violationNotice({
        hasViolation: true,
        violationReason: HC2,
        distanceRange,
      });

      expect(out).toBe('일정 확인이 필요해요');
      expect(out).not.toContain('빠듯');
    }
  );

  it('N2 · 같은 사유라도 거리를 아는 슬롯이면 서버 문구 그대로(짝 — "항상 숨김"이면 red)', () => {
    expect(
      violationNotice({
        hasViolation: true,
        violationReason: HC2,
        distanceRange: KNOWN_DISTANCE,
      })
    ).toBe(HC2);
  });

  it.each([
    [`${HC2}${SEP}${OPENING}`, OPENING],
    [`${OPENING}${SEP}${HC2}`, OPENING],
    [
      `${OPENING}${SEP}${HC2}${SEP}${DAY_WINDOW}`,
      `${OPENING}${SEP}${DAY_WINDOW}`,
    ],
  ])(
    'N3 · 거리 null · %p → %p (다른 위반 조각은 순서 그대로 남는다)',
    (reason, expected) => {
      expect(
        violationNotice({
          hasViolation: true,
          violationReason: reason,
          distanceRange: null,
        })
      ).toBe(expected);
    }
  );

  it('N4a · 위반 없음이면 거리와 무관하게 null', () => {
    expect(
      violationNotice({
        hasViolation: false,
        violationReason: HC2,
        distanceRange: null,
      })
    ).toBeNull();
  });

  it('N4b · 사유 null · 거리 null → 고정 라벨(지어내지 않는다)', () => {
    expect(
      violationNotice({
        hasViolation: true,
        violationReason: null,
        distanceRange: null,
      })
    ).toBe(VIOLATION_NOTICE);
  });

  it('N4c · 이동 문구를 빼고 남은 조각에 숫자가 있으면 여전히 고정 라벨(INV-3 방어선 무우회)', () => {
    expect(
      violationNotice({
        hasViolation: true,
        violationReason: `${HC2}${SEP}이동 54분 필요, 간격 -60분`,
        distanceRange: null,
      })
    ).toBe(VIOLATION_NOTICE);
  });
});

/** 서버 phraseOf 어휘 5문구 — distinct 후 " · " 로 잇는 서버 문법으로만 입력을 만든다(02a ★11). */
const reasonPartsArb = fc.shuffledSubarray(
  [OPENING, HC2, MUST_VISIT, DAY_WINDOW, GENERIC],
  { minLength: 1 }
);

describe('🔴 TRIP-1274 · violationNotice PBT — 서버 문법 조합 (numRuns 300)', () => {
  it('N6a · 거리 null 이면 결과 = 이동 문구를 뺀 나머지를 같은 순서로 이은 것(비면 고정 라벨)', () => {
    fc.assert(
      fc.property(
        reasonPartsArb,
        fc.constantFrom(...NO_DISTANCE),
        (parts, distanceRange) => {
          const rest = parts.filter((p) => p !== HC2);
          const expected = rest.length > 0 ? rest.join(SEP) : VIOLATION_NOTICE;

          expect(
            violationNotice({
              hasViolation: true,
              violationReason: parts.join(SEP),
              distanceRange,
            })
          ).toBe(expected);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('N6b · 거리를 알면 결과 = 입력 그대로', () => {
    fc.assert(
      fc.property(
        reasonPartsArb,
        fc.integer({ min: 1, max: 999 }),
        (parts, tenths) => {
          const reason = parts.join(SEP);

          expect(
            violationNotice({
              hasViolation: true,
              violationReason: reason,
              distanceRange: `약 ${(tenths / 10).toFixed(1)}km · 도보 추정`,
            })
          ).toBe(reason);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// TRIP-1298 · 편집기도 이 함수를 그대로 쓰므로(EditorView V8-4), "어떤 사유에서도 알약에 숫자 없음"(INV-3)은
// 이 전칭 속성으로 잰다. 전칭이라 무작위 문자열이 곧 "어떤 사유"다 — 다만 서버형 조각에 숫자가 붙은 모양은
// 무작위로 거의 안 나와서 그 모양을 따로 섞는다(02a ★12).
const digitTailArb = fc
  .tuple(
    fc.constantFrom(HC2, OPENING, DAY_WINDOW, MUST_VISIT, GENERIC),
    fc.integer({ min: 0, max: 1500 })
  )
  .map(([phrase, n]) => `${phrase}${SEP}이동 ${n}분 필요`);

describe('🔴 TRIP-1298 · violationNotice PBT — 어떤 사유에서도 표식에 숫자가 없다 (numRuns 300)', () => {
  it('N7 · 위반이면 결과는 늘 문자열이고 숫자가 0개다', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), digitTailArb, fc.constant(null)),
        fc.constantFrom(...NO_DISTANCE, KNOWN_DISTANCE),
        (violationReason, distanceRange) => {
          const out = violationNotice({
            hasViolation: true,
            violationReason,
            distanceRange,
          });

          expect(out).not.toBeNull();
          expect(out).not.toMatch(/\d/);
        }
      ),
      { numRuns: 300 }
    );
  });
});
