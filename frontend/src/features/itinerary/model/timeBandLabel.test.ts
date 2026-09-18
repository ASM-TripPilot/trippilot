import fc from 'fast-check';

import { timeBandLabel, type TimeBandLabel } from './timeBandLabel';

/**
 * TRIP-295 · PBT-U3-2 · BR-U3-07 (01b D5) — timeBandLabel: 시각 문자열 → 시간대 라벨.
 *
 * 무엇을 보장하나: 하루 어느 `HH:mm:ss`를 넣어도 `오전·점심·오후·저녁` 네 값 중
 * **정확히 하나**가 나오고, 네 구간이 24시간을 빠짐없이·겹침없이 덮는다. 저녁만
 * `17:00:00~23:59:59`와 `00:00:00~04:59:59` 두 조각이라 `시작 <= t && t <= 끝` 한 줄로
 * 판정되지 않는다 — 이 비대칭이 이 함수의 유일한 함정이고 AC-3 케이스가 그것만
 * 겨냥한다. 반환값에 소요시간 표현이 없고(INV-3), 같은 입력을 두 번 호출하면 같은
 * 값이 나온다. 성격 축(`활동·식사·전시·숙소`) 합성은 이 함수의 범위 밖이다(01b D3).
 *
 * > *(개념)* **랩어라운드 구간(wrap-around interval)** — 시작이 끝보다 큰 구간
 * > (`17:00 ~ 04:59`). 자정을 넘어 이어지므로 부등호 한 줄로 판정되지 않는다.
 *
 * > *(개념)* **전역성(totality) · 배타성(disjointness)** — "빠짐없이"와 "겹침없이"는
 * > 서로 다른 성질이고 **서로 다른 단언**이다. 하나만 쓰면 반쪽이다.
 *
 * > *(개념)* **PBT(속성 기반 테스트)** — 예시를 손으로 적는 대신 "어떤 입력에도 항상
 * > 참인 성질"을 적고 fast-check가 입력을 수백 개 만들어 반례를 찾는다. 다만 **생성기가
 * > 못 만드는 입력은 원리적으로 못 본다** — 500표본에서 경계 초 4개 중 3개가 한 번도
 * > 나오지 않았다(02a §5-4 실측). 그래서 아래 예제 표가 PBT와 짝을 이룬다.
 *
 * 3동작: 준비(시각 문자열·arbitrary) → 실행(timeBandLabel 호출) → 단언(라벨).
 */

/** 하루의 초 개수. 초 좌표계에서 00:00:00 = 0 … 23:59:59 = 86399. */
const SECONDS_PER_DAY = 86400;

/** 초 좌표 → `HH:mm:ss`. 문자열 비교의 함정 없이 구간을 다루려는 테스트 쪽 도구다. */
const toHms = (secondOfDay: number): string =>
  [
    Math.floor(secondOfDay / 3600),
    Math.floor(secondOfDay / 60) % 60,
    secondOfDay % 60,
  ]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

/**
 * 멤버십 단언의 모집단. 배열 `toContain`은 부분 문자열이 아니라 `===` 멤버십이라
 * (02a §5-1 실측) `'오전 · 활동'` 같은 합성 라벨은 여기서 걸린다 — 성격 축을 열지
 * 않기로 한 01b D3이 조용히 새는 것을 막는 자리다.
 */
const LABELS: TimeBandLabel[] = ['오전', '점심', '오후', '저녁'];

/** 하루 전 구간에서 시각을 고르게 뽑는다(정수 하나를 시각 문자열로 옮기는 형태). */
const timeArb = fc.integer({ min: 0, max: SECONDS_PER_DAY - 1 }).map(toHms);

/**
 * 연속한 초 묶음을 `[시작, 끝]` 구간 목록으로 접는다. 43,200개짜리 배열을 그대로
 * 비교하면 실패 메시지가 수만 줄이 되어 **어느 경계가 어긋났는지 읽을 수 없다.**
 * 접으면 실패 메시지가 틀린 경계를 직접 가리킨다.
 */
const toSpans = (seconds: number[]): [string, string][] => {
  const sorted = [...seconds].sort((a, b) => a - b);
  const spans: [number, number][] = [];

  for (const second of sorted) {
    const last = spans[spans.length - 1];
    if (last && second === last[1] + 1) {
      last[1] = second;
    } else {
      spans.push([second, second]);
    }
  }

  return spans.map(([from, to]): [string, string] => [toHms(from), toHms(to)]);
};

describe('timeBandLabel — 시각 → 시간대 라벨 사영 (TRIP-295)', () => {
  it('어떤 유효한 HH:mm:ss에도 라벨이 네 값 중 정확히 하나다 (AC-1, PBT)', () => {
    fc.assert(
      fc.property(timeArb, (startAt) => {
        // 준비 — timeArb가 하루 전 구간에서 시각을 하나 뽑는다.
        // 실행
        const label = timeBandLabel(startAt);

        // 단언 L1 — 네 값 중 하나(=== 멤버십). undefined·null·빈 문자열·다섯째 값이
        // 전부 여기서 배제된다.
        expect(LABELS).toContain(label);

        // 단언 L2 — 경계 명시(의도된 중복, L1에 이미 함의됨): AC-1 문면을 남긴다.
        expect(typeof label).toBe('string');
        expect(label).not.toBe('');
      }),
      { numRuns: 500 }
    );
  });

  /**
   * 동결 경계 8점(01b) + 티켓 지정 3점. PBT가 원리적으로 못 보는 자리를 손으로 덮는다 —
   * 500표본에서 경계 초 `17999`·`18000`·`86399`는 한 번도 나오지 않았다(02a §5-4).
   */
  const BOUNDARY_CASES: {
    name: string;
    startAt: string;
    expected: TimeBandLabel;
  }[] = [
    { name: '자정(랩 시작)', startAt: '00:00:00', expected: '저녁' },
    { name: '랩 조각 마지막 초', startAt: '04:59:59', expected: '저녁' },
    { name: '오전 첫 초', startAt: '05:00:00', expected: '오전' },
    { name: '오전 마지막 초', startAt: '10:59:59', expected: '오전' },
    { name: '점심 첫 초', startAt: '11:00:00', expected: '점심' },
    { name: '정오', startAt: '12:00:00', expected: '점심' },
    { name: '점심 마지막 초', startAt: '13:59:59', expected: '점심' },
    { name: '오후 첫 초', startAt: '14:00:00', expected: '오후' },
    { name: '오후 마지막 초', startAt: '16:59:59', expected: '오후' },
    { name: '저녁 첫 초', startAt: '17:00:00', expected: '저녁' },
    { name: '하루 마지막 초', startAt: '23:59:59', expected: '저녁' },
  ];

  it.each(BOUNDARY_CASES)(
    '$name $startAt → $expected (AC-2, 예제)',
    ({ startAt, expected }) => {
      // 준비 — 표의 한 행. 실행 + 단언 — 손으로 적은 기대값과 완전 일치.
      expect(timeBandLabel(startAt)).toBe(expected);
    }
  );

  it('하루 86,400초를 전수 열거하면 네 구간이 24시간을 빠짐없이·겹침없이 덮는다 (AC-3)', () => {
    // 준비 — 표본 추출이 아니라 전수 열거다. 라벨별로 초 좌표를 모은다.
    const secondsByLabel = new Map<string, number[]>();

    // 실행 — 하루의 모든 초에 대해 라벨을 구한다.
    for (let second = 0; second < SECONDS_PER_DAY; second += 1) {
      const label = timeBandLabel(toHms(second));
      const bucket = secondsByLabel.get(label);
      if (bucket) {
        bucket.push(second);
      } else {
        secondsByLabel.set(label, [second]);
      }
    }

    const secondsOf = (label: TimeBandLabel) => secondsByLabel.get(label) ?? [];
    const allSeconds = [...secondsByLabel.values()].flat();

    // 단언 L1 — 전역성①: 나온 라벨이 정확히 네 종류다(다섯째 값이 섞이면 깨진다).
    expect([...secondsByLabel.keys()].sort()).toEqual([...LABELS].sort());

    // 단언 L2 — 전역성②: 라벨이 붙은 초의 총합이 하루 전체다(누락 0).
    expect(allSeconds).toHaveLength(SECONDS_PER_DAY);

    // 단언 L3 — 배타성: 어떤 초도 두 번 세어지지 않는다(겹침 0).
    expect(new Set(allSeconds).size).toBe(SECONDS_PER_DAY);

    // 단언 L4 — 구간이 동결 표와 글자 그대로 같다. 셋은 한 조각씩이고,
    //
    // ⚠️ 위 L1~L3(전역성·배타성)은 **랩어라운드를 빠뜨린 구현도 전부 통과한다**
    // (02a §5-6 실측). 구간 정의를 실제로 잡는 것은 이 L4다 — 예제 11점만 만족시키고
    // 구간 내부를 오전으로 흘리는 구현이 AC-2를 11/11 통과한 뒤 여기서만 죽었다.
    expect(toSpans(secondsOf('오전'))).toEqual([['05:00:00', '10:59:59']]);
    expect(toSpans(secondsOf('점심'))).toEqual([['11:00:00', '13:59:59']]);
    expect(toSpans(secondsOf('오후'))).toEqual([['14:00:00', '16:59:59']]);

    // 저녁만 두 조각이다 — 자정 랩어라운드가 여기서 값으로 박힌다. 초 좌표
    // 오름차순이라 자정 조각이 먼저 온다(배열 toEqual은 순서에 민감하다).
    expect(toSpans(secondsOf('저녁'))).toEqual([
      ['00:00:00', '04:59:59'],
      ['17:00:00', '23:59:59'],
    ]);
  });

  it('어떤 시각에서도 라벨에 소요시간 표현이 없다 (AC-4, PBT)', () => {
    fc.assert(
      fc.property(timeArb, (startAt) => {
        // 준비 — timeArb.
        // 실행
        const label = timeBandLabel(startAt);

        // 단언 — 긍정 앵커 먼저(없으면 아래 부정 3줄은 빈 문자열에도 통과한다).
        expect(LABELS).toContain(label);

        // 단언 — 부정 3종(INV-3 · BR-U3-08). 재는 대상은 **함수 반환값**이고 소스
        // 파일이 아니다 — 소스 전수 스캔은 구현자가 다는 INV-3 수호 주석 자체를
        // 걸어 통과 불가능한 심판이 된다(2026-08-08 문제로그).
        expect(label).not.toMatch(/duration/i);
        expect(label).not.toContain('분');
        expect(label).not.toContain('소요');
      }),
      { numRuns: 500 }
    );
  });

  it('같은 입력을 두 번 호출하면 같은 값을 반환한다 (AC-5, PBT)', () => {
    fc.assert(
      fc.property(timeArb, (startAt) => {
        // 준비 — timeArb.
        // 실행 — 같은 startAt으로 두 번 호출한다.
        const first = timeBandLabel(startAt);
        const second = timeBandLabel(startAt);

        // 단언 — 두 값이 완전 일치한다(부수효과·난수·시계 읽기가 없다).
        expect(second).toBe(first);
      }),
      { numRuns: 500 }
    );
  });
});
