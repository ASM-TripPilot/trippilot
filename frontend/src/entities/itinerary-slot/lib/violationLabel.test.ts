import fc from 'fast-check';

import {
  formatViolationMinutes,
  VIOLATION_NOTICE,
  violationLabel,
  violationNotice,
} from './violationLabel';

/**
 * TRIP-1008 · 위반 사유 문구 — 서버 `violationReason` 의 자정 기준 분 정수 범위(`543~618`)만 `HH:mm`
 * 으로 바꾸고 나머지는 글자 그대로 둔다(D6 · D5 경계 · Q4).
 *
 * 서버 문법(ai `constraints.py` HC1~HC4 → backend `ViolationText` 가 distinct 후 " · " 로 이음):
 *  - HC1 `영업시간 밖: {s}~{e}` · `{dow}요일 휴무`
 *  - HC2 `이동 {N}분 필요, 간격 {gap}분` (gap 음수 가능) — `~` 없음, D5 로 원문 유지
 *  - HC3 `{YYYY-MM-DD} 고정 블록 미준수` — `~` 없음
 *  - HC4 `day window({ws}~{we}) 밖: {s}~{e}` — 범위 2개
 * `e = s + 체류분` 이라 1440 이상이 될 수 있다 → 1440 으로 나눈 나머지가 시각이다.
 *
 * 3동작: 준비(서버 문자열) → 실행(formatViolationMinutes / violationLabel) → 단언(반환 문자열).
 */

const hh = (n: number): string => String(n).padStart(2, '0');
/** 모델 — 자정 기준 분 → `HH:mm`(1440 나머지). */
const hm = (minutes: number): string => {
  const m = minutes % 1440;
  return `${hh(Math.floor(m / 60))}:${hh(m % 60)}`;
};
/** 브리프 원시값 탐지기. 3자리 미만(`5~65`)은 못 보므로 PBT 에선 보조로만 쓴다(02a ★3). */
const RAW_RANGE = /\d{3,4}~\d{3,4}/;

describe('🔴 D1 · 영업시간 밖 분 범위가 HH:mm 로 바뀐다', () => {
  it('"영업시간 밖: 543~618" → "영업시간 밖: 09:03~10:18"', () => {
    expect(formatViolationMinutes('영업시간 밖: 543~618')).toBe(
      '영업시간 밖: 09:03~10:18'
    );
  });
});

describe('🔴 D2 · 자정 넘김·경계·3자리 미만', () => {
  it.each([
    [
      '영업시간 밖: 1380~1500',
      '영업시간 밖: 23:00~01:00',
      '1440 넘으면 다음 날 시각',
    ],
    [
      '영업시간 밖: 1439~1440',
      '영업시간 밖: 23:59~00:00',
      '정확히 1440 은 00:00',
    ],
    ['영업시간 밖: 0~60', '영업시간 밖: 00:00~01:00', '자정 시작'],
    [
      '영업시간 밖: 5~65',
      '영업시간 밖: 00:05~01:05',
      '3자리 미만도 원시값이다',
    ],
  ])('%s → %s (%s)', (input, expected) => {
    expect(formatViolationMinutes(input)).toBe(expected);
  });
});

describe('🔴 D3 · 여러 위반이 " · " 로 이어져도 분 범위 토큰만 바뀐다 (D5 경계)', () => {
  it('HC1 은 바뀌고 HC2 "이동 54분 필요, 간격 -60분" 은 글자 그대로 남는다', () => {
    const out = formatViolationMinutes(
      '영업시간 밖: 543~618 · 이동 54분 필요, 간격 -60분'
    );
    expect(out).toBe('영업시간 밖: 09:03~10:18 · 이동 54분 필요, 간격 -60분');
    expect(out).toContain('이동 54분 필요, 간격 -60분');
  });

  it('세 건(HC1·HC3·HC2)이 이어진 문자열도 HC1 만 바뀐다', () => {
    expect(
      formatViolationMinutes(
        '영업시간 밖: 1380~1500 · 2026-09-26 고정 블록 미준수 · 이동 12분 필요, 간격 5분'
      )
    ).toBe(
      '영업시간 밖: 23:00~01:00 · 2026-09-26 고정 블록 미준수 · 이동 12분 필요, 간격 5분'
    );
  });
});

describe('🔴 D4 · HC4 는 범위 두 개가 모두 바뀐다 (Q4 — 접두에 묶지 않는다)', () => {
  it('"day window(540~1320) 밖: 543~618" → 둘 다 HH:mm', () => {
    expect(formatViolationMinutes('day window(540~1320) 밖: 543~618')).toBe(
      'day window(09:00~22:00) 밖: 09:03~10:18'
    );
  });
});

describe('🔴 D5 · 모르는 형식은 가리지 않는다 — ~ 가 없으면 입력 그대로 (항등 표)', () => {
  it.each([
    '이동 54분 필요, 간격 -60분',
    '2026-09-26 고정 블록 미준수',
    '0요일 휴무',
    '숙소 고정 충돌',
    '',
  ])('%p → 그대로', (input) => {
    expect(formatViolationMinutes(input)).toBe(input);
  });
});

/** detail 하나 — 원시 문자열과 모델 기대값, `~` 유무. 서버 문법으로만 만든다(02a ★5 — fc.string 금지). */
type Detail = { raw: string; expected: string; hasRange: boolean };

const minuteArb = fc.integer({ min: 0, max: 1439 });
const stayArb = fc.integer({ min: 0, max: 1440 });

const hc1HoursArb: fc.Arbitrary<Detail> = fc
  .tuple(minuteArb, stayArb)
  .map(([s, d]) => ({
    raw: `영업시간 밖: ${s}~${s + d}`,
    expected: `영업시간 밖: ${hm(s)}~${hm(s + d)}`,
    hasRange: true,
  }));
const hc1ClosedArb: fc.Arbitrary<Detail> = fc
  .integer({ min: 0, max: 6 })
  .map((dow) => ({
    raw: `${dow}요일 휴무`,
    expected: `${dow}요일 휴무`,
    hasRange: false,
  }));
const hc2Arb: fc.Arbitrary<Detail> = fc
  .tuple(fc.integer({ min: 0, max: 600 }), fc.integer({ min: -600, max: 600 }))
  .map(([n, gap]) => ({
    raw: `이동 ${n}분 필요, 간격 ${gap}분`,
    expected: `이동 ${n}분 필요, 간격 ${gap}분`,
    hasRange: false,
  }));
const hc3Arb: fc.Arbitrary<Detail> = fc
  .tuple(
    fc.integer({ min: 2026, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 })
  )
  .map(([y, mo, d]) => {
    const text = `${y}-${hh(mo)}-${hh(d)} 고정 블록 미준수`;
    return { raw: text, expected: text, hasRange: false };
  });
const hc4Arb: fc.Arbitrary<Detail> = fc
  .tuple(minuteArb, stayArb, minuteArb, stayArb)
  .map(([ws, wd, s, d]) => ({
    raw: `day window(${ws}~${ws + wd}) 밖: ${s}~${s + d}`,
    expected: `day window(${hm(ws)}~${hm(ws + wd)}) 밖: ${hm(s)}~${hm(s + d)}`,
    hasRange: true,
  }));

const anyDetailArb = fc.oneof(
  hc1HoursArb,
  hc1ClosedArb,
  hc2Arb,
  hc3Arb,
  hc4Arb
);
const rangelessDetailArb = fc.oneof(hc1ClosedArb, hc2Arb, hc3Arb);

describe('🔴 D5 · PBT — 서버 문법으로 만든 위반 문자열 (numRuns 500)', () => {
  it('출력은 모델 기대값과 같고, 원시 분 범위는 0건이며, ~ 없는 detail 은 부분 문자열로 남는다', () => {
    fc.assert(
      fc.property(
        fc.array(anyDetailArb, { minLength: 1, maxLength: 4 }),
        (details) => {
          const input = details.map((d) => d.raw).join(' · ');
          const out = formatViolationMinutes(input);

          expect(out).toBe(details.map((d) => d.expected).join(' · '));
          // (i) 브리프 탐지기 — 보조. 주 단언은 위 모델 일치다(02a ★3).
          expect(RAW_RANGE.test(out)).toBe(false);
          // (ii) ~ 없는 detail 은 글자 그대로 살아남는다(D5 — 모르는 형식을 가리지 않는다).
          details
            .filter((d) => !d.hasRange)
            .forEach((d) => expect(out).toContain(d.raw));
        }
      ),
      { numRuns: 500 }
    );
  });

  it('(iii) ~ 없는 detail 만 이은 문자열은 출력이 입력과 같다 (항등)', () => {
    fc.assert(
      fc.property(
        fc.array(rangelessDetailArb, { minLength: 1, maxLength: 4 }),
        (details) => {
          const input = details.map((d) => d.raw).join(' · ');
          expect(formatViolationMinutes(input)).toBe(input);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('🔴 C3 · violationLabel — 표식 문구 조립 규칙 한 곳', () => {
  it('hasViolation=false 면 사유 문자열이 있어도 null 이다 (표식 없음)', () => {
    expect(
      violationLabel({
        hasViolation: false,
        violationReason: '영업시간 밖: 543~618',
      })
    ).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'hasViolation=true · 사유 %s → "일정 충돌" (사유를 지어내지 않는다)',
    (_label, reason) => {
      expect(
        violationLabel({ hasViolation: true, violationReason: reason })
      ).toBe('일정 충돌');
    }
  );

  it('hasViolation=true · HC1 사유 → 분 범위가 HH:mm 로 바뀐 문구', () => {
    expect(
      violationLabel({
        hasViolation: true,
        violationReason: '영업시간 밖: 543~618',
      })
    ).toBe('영업시간 밖: 09:03~10:18');
  });

  it('hasViolation=true · ~ 없는 사유 → 그대로', () => {
    expect(
      violationLabel({ hasViolation: true, violationReason: '숙소 고정 충돌' })
    ).toBe('숙소 고정 충돌');
  });
});

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

  it('N5 · 편집기 함수 violationLabel 은 이번 범위 밖 — 거리 null 이어도 이동 문구 그대로(Seed Q4)', () => {
    // 변수로 넘긴다 — violationLabel 타입엔 distanceRange 가 없어 리터럴이면 tsc 가 막는다(02a ★10).
    const slot = {
      hasViolation: true,
      violationReason: HC2,
      distanceRange: null,
    };

    expect(violationLabel(slot)).toBe(HC2);
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
