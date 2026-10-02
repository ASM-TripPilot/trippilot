import fc from 'fast-check';

import { formatDistance } from '@/entities/place/lib/formatDistance';

import { legDistance } from './legDistance';

/**
 * TRIP-354 · 날짜헤더 총이동거리 라벨(01b Seed §C · Q2) · TRIP-1110 null 섞임 접기. 슬롯들의
 * `distanceRange` 서버 문자열을 느슨하게 파싱·미터 정규화·합산해 "이동 3.2km"(또는 null)를 만든다.
 *
 * 무엇을 보장하나 — 세 갈래가 서로를 지우지 않는다:
 *  - 🔴 **느슨 파서**: "약 3.1km · 도보 추정"에서 숫자+단위(km|m)만 뽑고 꼬리·이동수단은 무시한다.
 *    형식이 바뀌어도(새 이동수단) 안 깨진다. 숫자+단위를 못 뽑는 값만 **broken**이다(02a ★8).
 *  - 🔴 **모르는 구간 = 그날 줄 접기**: broken 하나, 또는 `null`·`undefined`·빈 문자열 하나라도
 *    섞이면 그날 "이동" 줄 전체를 **null**로 접는다 — 아는 구간만 더한 부분합은 실제보다 작은 틀린
 *    숫자다(INV-4 · TRIP-1110 결정 1. 옛 "null 은 스킵" 규약 폐기).
 *  - 🔴 **미터 환산 합산 + 1km 단위전환**: km는 ×1000해 미터로 더하고, `<1000m`→가장 가까운 10m,
 *    `≥1000m`→소수 1자리. 반올림은 **round-half-up**(825→830 · 3247m→3.2km · 3280m→3.3km).
 *  - 🔴 **합계 0·빈 배열 → null** → 헤더는 "{N}곳"만.
 *  - INV-3: duration 미표시. 거리·이동수단만.
 *
 * *(개념)* **순수 함수** — 같은 입력이면 항상 같은 출력, 바깥 상태를 읽지도 바꾸지도 않는다.
 * 그래서 fast-check(임의 입력 수백 개를 자동 생성해 속성을 검사하는 도구)로 통째로 태울 수 있다.
 *
 * 3동작 뼈대: 준비=거리 문자열 배열 → 실행=`legDistance(배열)` → 단언=라벨 문자열 또는 null.
 * 기대값은 Figma 목업이 아니라 02a §5-F 프로브(실제 알고리즘 실행)로 검증한 값이다.
 */

/** '{m}m' 형태로 렌더한 배열 — fast-check 속성이 임의 미터를 거리 문자열로 만든다. */
function asMeterStrings(meters: number[]): string[] {
  return meters.map((m) => `약 ${m}m · 도보 추정`);
}

/** km 구간 하나 — 0.1km 단위 정수 `t` 로 미터 정답(t×100)과 서버 문자열을 함께 만든다. */
function kmLeg(t: number) {
  return { meters: t * 100, text: `약 ${(t / 10).toFixed(1)}km · 차량 추정` };
}

/**
 * 유효 구간 하나(m·km 혼합) — m 단위(1~900m)와 km 단위(0.1~3.0km)를 섞는다.
 * km 를 3.0km 이하로 묶는 이유: `Number('32.3') * 1000` 같은 부동소수 오차가 정답보다 **작게** 나오는 km 값에
 * m 값이 더해져 합이 반올림 경계(…50m)에 딱 걸리면 결과가 한 칸 내려간다(`32.3km + 50m` → 32.3km, 정답 32.4km).
 * 그런 km 값(32.3·64.1·64.6·65.1)이 이 범위엔 없다. 넓은 km 는 아래 `wideKmLeg`(km 끼리만)가 맡는다.
 */
const validLeg = fc.oneof(
  fc
    .integer({ min: 1, max: 900 })
    .map((m) => ({ meters: m, text: `약 ${m}m · 도보 추정` })),
  fc.integer({ min: 1, max: 30 }).map(kmLeg)
);

/**
 * km 전용 구간(0.1~99.9km) — 실서버가 실제로 내는 형식(`약 {x:.1f}km`)과 크기다. km 끼리만 더하면 정답이 늘
 * 100m 배수라 반올림 경계와 50m 떨어져 있어, 부동소수 오차(1m 훨씬 미만)가 결과를 못 바꾼다.
 */
const wideKmLeg = fc.integer({ min: 1, max: 999 }).map(kmLeg);

/** 0m 구간 — 같은 좌표 연속 방문. 서버는 `약 0.0km` 로 준다. 값이 **있는** 구간이라 접지 않는다. */
const zeroLeg = fc.constantFrom('약 0.0km · 도보 추정', '약 0m');

/** 값 없는 구간 — 생성 타입이 `distanceRange?: string | null` 이라 셋 다 실제로 들어온다. */
const hole = fc.constantFrom(null, undefined, '');

/** `extras` 의 각 값을 `pos % (길이+1)` 자리에 끼운다 — 앞·중간·끝 어디든 들어간다. */
function insertAll<T>(base: readonly T[], extras: readonly [T, number][]): T[] {
  const out = [...base];
  for (const [value, pos] of extras) {
    out.splice(pos % (out.length + 1), 0, value);
  }
  return out;
}

describe('🔴 L1 · AC-L1 — 혼합 단위(m·km) 미터 환산 합산 + 1km 단위전환', () => {
  it('m과 km를 섞어 더하고, 합이 1km 이상이면 소수 1자리 km로, 미만이면 10m 단위 m으로 그린다', () => {
    // 950m + 3.1km(=3100m) = 4050m → round-half-up → 4.1km.
    expect(legDistance(['약 950m · 도보 추정', '약 3.1km · 차량 추정'])).toBe(
      '이동 4.1km'
    );

    // 500m + 320m = 820m (<1000) → 가장 가까운 10m.
    expect(legDistance(['약 500m · 도보 추정', '약 320m'])).toBe('이동 820m');
  });
});

describe('🔴 L2 · AC-L2 · TRIP-1110 AC-1 — broken 이든 값 없음(null·undefined·빈 문자열)이든 하나면 그날 줄 접기(null)', () => {
  it('값이 있으나 숫자+단위를 못 뽑으면 전체 null이다', () => {
    expect(legDistance(['약 950m · 도보 추정', '거리 정보 없음'])).toBeNull();
  });

  it('null·undefined·빈 문자열이 한 구간이라도 섞이면 나머지가 유효해도 전체 null이다(부분합 금지)', () => {
    // TRIP-1110 이전엔 스킵되어 '이동 500m'·'이동 2.7km' 가 나왔다 — 그 부분합이 뒤집힌 규약이다.
    expect(legDistance([null, '', '약 500m · 도보 추정'])).toBeNull();
    expect(legDistance(['2.1km', null, '0.6km'])).toBeNull();
    expect(legDistance(['2.1km', undefined, '0.6km'])).toBeNull();
    expect(legDistance(['2.1km', '', '0.6km'])).toBeNull();
    // 끝자리 하나만 비어도 접는다(순서 무관).
    expect(legDistance(['2.1km', '0.8km', null])).toBeNull();
  });
});

describe('🔴 L3 · AC-L3 — 느슨 파서: 이동수단 꼬리 무관 통과, 숫자+단위 부재만 broken', () => {
  it('도보/차량/꼬리 없음이 모두 같은 거리로 파싱되고, 숫자+단위가 없으면 broken(null)이다', () => {
    // 꼬리가 무엇이든(또는 없든) 숫자+단위만 본다 — 셋 다 3.1km.
    for (const arr of [
      ['약 3.1km · 도보 추정'],
      ['약 3.1km · 차량 추정'],
      ['약 3.1km'],
    ]) {
      expect(legDistance(arr)).toBe('이동 3.1km');
    }

    // 숫자+단위가 없으면 broken → null. '3.1'은 단위가 없어 broken이다.
    expect(legDistance(['약 · 도보 추정'])).toBeNull();
    expect(legDistance(['3.1'])).toBeNull();
  });
});

describe('🔴 L4 · AC-L4 — 반올림은 round-half-up(내림 아님): <1000m 10m 단위, ≥1000m 소수 1자리', () => {
  it('824→820·825→830, 3247m→3.2km·3280m→3.3km, 정확히 1000m는 1.0km 경계다', () => {
    expect(legDistance(['약 824m'])).toBe('이동 820m');
    expect(legDistance(['약 825m'])).toBe('이동 830m'); // half-up
    expect(legDistance(['약 3247m'])).toBe('이동 3.2km');
    expect(legDistance(['약 3280m'])).toBe('이동 3.3km'); // half-up
    expect(legDistance(['약 1000m'])).toBe('이동 1.0km'); // 경계: ≥1000 → 소수 1자리
  });
});

describe('🔴 L5 · AC-L5 — 합계 0·전부 null·빈 배열 → null → 헤더는 "{N}곳"만', () => {
  it('전부 null이거나, 합이 0이거나, 빈 배열이면 null이다', () => {
    expect(legDistance([null, null])).toBeNull();
    expect(legDistance(['약 0m'])).toBeNull(); // 합 0 → null
    expect(legDistance([])).toBeNull();
  });

  it('0m 구간은 "값 없음"이 아니다 — 다른 유효 구간과 섞이면 접지 않고 0을 더한다', () => {
    // 같은 좌표 연속 방문 → 서버가 '약 0.0km' 를 준다. 0 + 1.2km = 1.2km.
    expect(legDistance(['약 0.0km · 도보 추정', '약 1.2km · 도보 추정'])).toBe(
      '이동 1.2km'
    );
    expect(legDistance(['약 500m · 도보 추정', '약 0m'])).toBe('이동 500m');
  });
});

describe('🔴 P · 속성(fast-check) — 접기(F1) · 정확한 합(F2·F2b) · 0m 불변(F4) · 형식 경계(P2) · broken 접기(F3)', () => {
  it('F1 — 유효 구간 사이 아무 자리에 null·undefined·빈 문자열이 하나라도 끼면 무조건 null이다', () => {
    fc.assert(
      fc.property(
        fc.array(validLeg, { maxLength: 8 }),
        fc.array(fc.tuple(hole, fc.nat()), { minLength: 1, maxLength: 3 }),
        (legs, holes) =>
          legDistance(
            insertAll<string | null | undefined>(
              legs.map((leg) => leg.text),
              holes
            )
          ) === null
      )
    );
  });

  it('F2 — 전부 유효하면(m·km 혼합) 결과는 정확히 `이동 ${formatDistance(미터 합)}`이다', () => {
    fc.assert(
      fc.property(
        fc.array(validLeg, { minLength: 1, maxLength: 8 }),
        (legs) => {
          const sum = legs.reduce((acc, leg) => acc + leg.meters, 0);
          return (
            legDistance(legs.map((leg) => leg.text)) ===
            `이동 ${formatDistance(sum)}`
          );
        }
      )
    );
  });

  it('F2b — km 끼리만이면 0.1~99.9km 넓은 범위에서도 결과는 정확히 `이동 ${formatDistance(미터 합)}`이다', () => {
    fc.assert(
      fc.property(
        fc.array(wideKmLeg, { minLength: 1, maxLength: 8 }),
        (legs) => {
          const sum = legs.reduce((acc, leg) => acc + leg.meters, 0);
          return (
            legDistance(legs.map((leg) => leg.text)) ===
            `이동 ${formatDistance(sum)}`
          );
        }
      )
    );
  });

  it('F4 — 0m 구간을 아무 자리에 끼워도 결과가 안 바뀐다(0m 는 접기 사유가 아니다)', () => {
    fc.assert(
      fc.property(
        fc.array(validLeg, { minLength: 1, maxLength: 8 }),
        fc.array(fc.tuple(zeroLeg, fc.nat()), { minLength: 1, maxLength: 3 }),
        (legs, zeros) => {
          const texts = legs.map((leg) => leg.text);
          return legDistance(insertAll(texts, zeros)) === legDistance(texts);
        }
      )
    );
  });

  it('P2 — 합<1000이면 "…m", 합≥1000이면 "….km"로 끝난다(1km 단위전환 경계)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 900 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (meters) => {
          const label = legDistance(asMeterStrings(meters));
          if (label === null) return false; // 양수 미터가 최소 1개라 null이 아니어야 한다
          const sum = meters.reduce((a, b) => a + b, 0);
          return sum >= 1000
            ? /^이동 \d+\.\d+km$/.test(label)
            : /^이동 \d+m$/.test(label);
        }
      )
    );
  });

  it('F3 — broken 문자열이 아무 자리에 하나라도 섞이면 무조건 null이다(그날 줄 접기)', () => {
    fc.assert(
      fc.property(
        fc.array(validLeg, { maxLength: 8 }),
        fc.nat(),
        (legs, pos) =>
          legDistance(
            insertAll(
              legs.map((leg) => leg.text),
              [['거리 정보 없음', pos]]
            )
          ) === null
      )
    );
  });
});
