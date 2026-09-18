import fc from 'fast-check';

import { legDistance } from './legDistance';

/**
 * TRIP-354 · 날짜헤더 총이동거리 라벨(01b Seed §C · Q2). 슬롯들의 `distanceRange` 서버 문자열을
 * 느슨하게 파싱·미터 정규화·합산해 "이동 3.2km"(또는 null)를 만든다.
 *
 * 무엇을 보장하나 — 세 갈래가 서로를 지우지 않는다:
 *  - 🔴 **느슨 파서**: "약 3.1km · 도보 추정"에서 숫자+단위(km|m)만 뽑고 꼬리·이동수단은 무시한다.
 *    형식이 바뀌어도(새 이동수단) 안 깨진다. 숫자+단위를 못 뽑는 값만 **broken**이다(02a ★8).
 *  - 🔴 **실패 = 그날 줄 접기**: 값이 있으나 broken 하나면 그날 "이동" 줄 전체를 **null**로 접는다
 *    (실제보다 적은 틀린 숫자보다 침묵이 낫다). `null`·빈 문자열은 조용히 **스킵**(실패 아님 · ★9).
 *  - 🔴 **미터 환산 합산 + 1km 단위전환**: km는 ×1000해 미터로 더하고, `<1000m`→가장 가까운 10m,
 *    `≥1000m`→소수 1자리. 반올림은 **round-half-up**(825→830 · 3247m→3.2km · 3280m→3.3km).
 *  - 🔴 **합계 0(전부 null/스킵) → null** → 헤더는 "{N}곳"만.
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

describe('🔴 L2 · AC-L2 — present-but-broken 하나면 그날 줄 접기(null), null/빈 슬롯은 조용히 스킵', () => {
  it('값이 있으나 숫자+단위를 못 뽑으면 전체 null이고, null/빈 문자열은 스킵되어 나머지만 합산한다', () => {
    // broken 하나 → 그날 전체 null(실제보다 적은 틀린 숫자 금지).
    expect(legDistance(['약 950m · 도보 추정', '거리 정보 없음'])).toBeNull();

    // null·빈 문자열은 실패가 아니라 스킵 — 남은 500m만 합산된다.
    expect(legDistance([null, '', '약 500m · 도보 추정'])).toBe('이동 500m');
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

describe('🔴 L5 · AC-L5 — 합계 0(전부 null/스킵/0) → null → 헤더는 "{N}곳"만', () => {
  it('전부 null이거나, 합이 0이거나, 빈 배열이면 null이다', () => {
    expect(legDistance([null, null])).toBeNull();
    expect(legDistance(['약 0m'])).toBeNull(); // 합 0 → null
    expect(legDistance([])).toBeNull();
  });
});

describe('🔴 P · 속성(fast-check) — 스킵 불변성 · 형식 경계 · broken 강제 null', () => {
  it('P1 — null/빈 문자열을 섞어 넣어도 결과가 변하지 않는다(스킵은 실패가 아니다)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 900 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (meters) => {
          const base = legDistance(asMeterStrings(meters));
          const withNulls = legDistance([
            null,
            ...asMeterStrings(meters),
            '',
            undefined,
          ]);
          return base === withNulls;
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

  it('P3 — broken 문자열이 하나라도 섞이면 무조건 null(그날 줄 접기)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 900 }), { maxLength: 8 }),
        (meters) =>
          legDistance([...asMeterStrings(meters), '거리 정보 없음']) === null
      )
    );
  });
});
