import fc from 'fast-check';

import {
  toNightlyBases,
  type BaseSection,
  type NightlyBase,
} from './baseSections';

/**
 * TRIP-664 · US-TRIP-07 — toNightlyBases: 다박=1행인 `BaseSection[]`을 밤 단위(1박=1행)로 펼친다.
 *
 * 무엇을 보장하나: `nights`가 N인 구간은 `dateFrom`부터 하루씩 N개의 행이 되고, 각 행은 그 밤의
 * 날짜·숙소명·**통번호**를 갖는다. `nightNumber`는 방출된 행의 1-기반 통번호다 —
 * `toBaseSections`의 `nightLabel`(여행 시작일 고정 기준)과 **다른 축**이라, 앞에 0박 구간이 있어도
 * 첫 방출 행이 1번이다. `nights ≤ 0` 구간은 걸러지는 게 아니라 산식상 0행을 낳고(INV-2 — 판정은
 * 서버 몫), 동일 숙소가 여러 날 겹쳐도 dedup 없이 각 행이 살아남는다. 출력 필드는 정확히 3개
 * (`date`·`stayName`·`nightNumber`) — `duration`·거리 필드가 없다(INV-3).
 *
 * 커버하지 않는 것:
 *  - 원 `toBaseSections`의 행위 — 그건 손대지 않은 `baseSections.test.ts`(13케이스)가 잠근다
 *    (AC-3 "원형 불변" 회귀). 이 파일은 새 export만 다룬다.
 *  - 입력이 뒤섞였을 때의 재정렬 — `toNightlyBases`는 이미 `dateFrom` 오름차순인 `toBaseSections`
 *    출력을 받는다고 본다(정렬은 원 함수 소유). PBT도 정렬된 입력만 만든다.
 *
 * 3동작: 준비(BaseSection 픽스처·생성기) → 실행(toNightlyBases 1회) → 단언(NightlyBase 배열).
 */

// ── 상수 ──────────────────────────────────────────────────────────────────────

/**
 * NightlyBase가 가져야 하는 필드 전부. `Record<keyof NightlyBase, true>`는 타입에 필드가 하나라도
 * 늘면 여기서 컴파일 에러가 나므로, 아래 정렬 키와 짝지어 `duration`·거리 필드가 몰래 붙는 것을 막는다.
 */
const NIGHTLY_SHAPE: Record<keyof NightlyBase, true> = {
  date: true,
  stayName: true,
  nightNumber: true,
};
const NIGHTLY_KEYS = Object.keys(NIGHTLY_SHAPE).sort();

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

/**
 * BaseSection 픽스처(7필드 전부 채움 — 계약이 바뀌면 여기서 컴파일이 깨진다). `toNightlyBases`가
 * 실제로 읽는 것은 `dateFrom`·`nights`·`stayName` 셋뿐이라 나머지는 자리만 채운다.
 */
function section(over: Partial<BaseSection> = {}): BaseSection {
  return {
    baseAssignmentId: 'A1',
    savedStayId: 'S1',
    stayName: '해운대 오션 호텔',
    dateFrom: '2026-06-10',
    dateTo: '2026-06-12',
    nights: 2,
    nightLabel: '1–2박',
    ...over,
  };
}

// ── PBT 입력 도메인 ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** 에포크 일수 → 'YYYY-MM-DD'. `toISOString`은 항상 UTC라 실행 머신 타임존이 표본을 안 민다.
 *  **입력을 만드는 데만 쓰고 구현과 다른 경로로 기대값을 짠다**(오라클 독립성). */
function toDateString(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

interface GeneratedNightly {
  sections: BaseSection[];
  /** 구현과 독립적으로 짠 기대 행 배열(정수→날짜 문자열 경로). */
  expected: NightlyBase[];
  /** Σ(nights>0 구간의 nights) — 태스크 명시 불변식의 기대 행 수. */
  expectedRowCount: number;
}

interface SlotSpec {
  /** 앞 구간 끝에서 며칠을 띄우고 시작하나(≥0 — 공백 허용). */
  gap: number;
  /** 몇 박. ≤0이면 0행을 낳는다(스킵을 섞는다). */
  nights: number;
  name: string;
}

/**
 * 정수 파라미터로 기대 배열을 **먼저** 짜고 그걸 날짜 문자열로 바꿔 입력을 만든다. 커서를 양수 구간
 * 만큼만 전진시켜 (1) 구간들이 `dateFrom` 오름차순이고 (2) 양수 구간이 겹치지 않도록 배치한다 —
 * 그래야 "결과 날짜 오름차순"이 성질로 성립한다. nights≤0 구간은 그 자리에 두되 커서를 안 옮긴다.
 */
function buildNightlyInput(
  startEpoch: number,
  slots: SlotSpec[]
): GeneratedNightly {
  const sections: BaseSection[] = [];
  const expected: NightlyBase[] = [];
  let cursor = 0; // startEpoch 기준 상대 오프셋
  let running = 0; // 통번호

  slots.forEach((slot, index) => {
    const offset = cursor + slot.gap;
    const fromEpoch = startEpoch + offset;

    sections.push(
      section({
        baseAssignmentId: `a${index}`,
        savedStayId: `s${index}`,
        stayName: slot.name,
        dateFrom: toDateString(fromEpoch),
        dateTo: toDateString(fromEpoch + Math.max(0, slot.nights)),
        nights: slot.nights,
      })
    );

    if (slot.nights > 0) {
      for (let k = 0; k < slot.nights; k += 1) {
        running += 1;
        expected.push({
          date: toDateString(fromEpoch + k),
          stayName: slot.name,
          nightNumber: running,
        });
      }
      cursor = offset + slot.nights; // 양수 구간만 커서 전진(비겹침)
    }
    // nights<=0 이면 커서 그대로(0행, 통번호 불변)
  });

  return { sections, expected, expectedRowCount: running };
}

const nightlyInputArb = fc
  .record({
    startEpoch: fc.integer({ min: 20_400, max: 20_800 }),
    slots: fc.array(
      fc.record({
        gap: fc.integer({ min: 0, max: 3 }),
        nights: fc.integer({ min: -2, max: 5 }),
        name: fc.constantFrom('해운대 오션 호텔', '경주 한옥스테이 봄', ''),
      }),
      { maxLength: 6 }
    ),
  })
  .map(({ startEpoch, slots }) => buildNightlyInput(startEpoch, slots));

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('toNightlyBases — 다박 구간을 밤별 1행으로 (TRIP-664)', () => {
  it('2박 한 구간을 이틀 연속 두 행으로 펼치고 통번호를 1·2로 매긴다 (AC-3, 예제)', () => {
    // 준비 — 6/10 체크인, 2박.
    const sections = [
      section({
        dateFrom: '2026-06-10',
        nights: 2,
        stayName: '해운대 오션 호텔',
      }),
    ];

    // 실행
    const result = toNightlyBases(sections);

    // 단언 — dateFrom부터 하루씩, 통번호 1-기반.
    expect(result).toEqual([
      { date: '2026-06-10', stayName: '해운대 오션 호텔', nightNumber: 1 },
      { date: '2026-06-11', stayName: '해운대 오션 호텔', nightNumber: 2 },
    ]);
  });

  it('여러 구간의 통번호가 구간을 넘어 이어진다 — 1·2·3 (AC-3, 예제)', () => {
    // 준비 — 2박(해운대) + 1박(경주).
    const sections = [
      section({ dateFrom: '2026-06-10', nights: 2, stayName: '해운대' }),
      section({ dateFrom: '2026-06-12', nights: 1, stayName: '경주한옥' }),
    ];

    // 실행 + 단언 — 통번호가 리셋되지 않고 3까지 이어진다.
    expect(toNightlyBases(sections)).toEqual([
      { date: '2026-06-10', stayName: '해운대', nightNumber: 1 },
      { date: '2026-06-11', stayName: '해운대', nightNumber: 2 },
      { date: '2026-06-12', stayName: '경주한옥', nightNumber: 3 },
    ]);
  });

  it('0박 구간은 번호를 먹지 않는다 — 그 다음 구간의 첫 행이 1번이다 (AC-3, ★통번호)', () => {
    // 준비 — 0박(A, 방출 0행) 다음에 2박(B). 통번호가 여행 시작 기준이면 이 케이스가 어긋난다.
    const sections = [
      section({ dateFrom: '2026-06-10', nights: 0, stayName: 'A' }),
      section({ dateFrom: '2026-06-11', nights: 2, stayName: 'B' }),
    ];

    // 실행 + 단언 — B의 첫 행이 nightNumber:1(0박 A는 번호를 안 소비).
    expect(toNightlyBases(sections)).toEqual([
      { date: '2026-06-11', stayName: 'B', nightNumber: 1 },
      { date: '2026-06-12', stayName: 'B', nightNumber: 2 },
    ]);
  });

  it('nights가 0·음수인 구간만 있으면 0행이다 (거르는 게 아니라 산식상 0행)', () => {
    const sections = [
      section({ dateFrom: '2026-06-10', nights: 0 }),
      section({ dateFrom: '2026-06-11', nights: -1 }),
    ];

    expect(toNightlyBases(sections)).toHaveLength(0);
  });

  it('동일 숙소가 여러 날 겹쳐도 dedup 없이 각 행이 살아남는다 (AC-3, 예제)', () => {
    // 준비 — 같은 숙소(S1·해운대)를 이틀에 걸쳐 두 구간으로.
    const sections = [
      section({
        savedStayId: 'S1',
        dateFrom: '2026-06-10',
        nights: 1,
        stayName: '해운대',
      }),
      section({
        savedStayId: 'S1',
        dateFrom: '2026-06-11',
        nights: 1,
        stayName: '해운대',
      }),
    ];

    // 실행 + 단언 — 두 행 모두 살아남고 이름이 같다(묶거나 지우지 않는다).
    expect(toNightlyBases(sections)).toEqual([
      { date: '2026-06-10', stayName: '해운대', nightNumber: 1 },
      { date: '2026-06-11', stayName: '해운대', nightNumber: 2 },
    ]);
  });

  it('빈 입력은 빈 배열이다', () => {
    expect(toNightlyBases([])).toHaveLength(0);
  });

  it('각 행의 필드가 정확히 3개다 — date·stayName·nightNumber, duration 없음 (INV-3)', () => {
    const result = toNightlyBases([section({ nights: 1 })]);

    expect(result).toHaveLength(1);
    // 계약 밖 필드(BaseSection의 dateTo·nightLabel·id 등)가 스프레드로 새 나오면 잡힌다.
    expect(Object.keys(result[0]).sort()).toEqual(NIGHTLY_KEYS);
  });

  it('행 수 = Σ(nights>0 구간의 nights) · 날짜 오름차순 · 통번호 연속 (AC-4, PBT)', () => {
    fc.assert(
      fc.property(
        nightlyInputArb,
        ({ sections, expected, expectedRowCount }) => {
          // 실행
          const result = toNightlyBases(sections);

          // 단언 L1 — 행수·순서·하루간격·통번호·stayName·shape를 한꺼번에 잠근다.
          // 기대 배열은 구현과 다른 경로(정수→new Date→문자열)로 짰다(오라클 독립).
          expect(result).toEqual(expected);

          // 단언 L2 — 태스크 명시 불변식 ①: 행 수 = Σ(nights>0 구간의 nights).
          expect(result).toHaveLength(expectedRowCount);

          // 단언 L3 — 태스크 명시 불변식 ②: 결과 날짜가 엄격 오름차순.
          // 'YYYY-MM-DD' 문자열 비교가 곧 날짜 순서다(생성기가 비겹침 정렬 입력만 만든다).
          for (let i = 1; i < result.length; i += 1) {
            expect(result[i - 1].date < result[i].date).toBe(true);
          }

          // 단언 L4 — 통번호는 방출 순서대로 1..N.
          result.forEach((row, i) => {
            expect(row.nightNumber).toBe(i + 1);
          });
        }
      ),
      { numRuns: 500 }
    );
  });
});
