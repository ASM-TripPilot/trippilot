import fc from 'fast-check';

import { validateTripDraft } from './tripDraft';
import { useTripWizardStore } from './tripWizardStore';

/**
 * TRIP-1027 — 여행 기간의 끝 날짜는 **시작 날짜 + 여행지 박수 합(Σnights)** 으로만 정해진다.
 *
 * 무엇을 보장하나: 사용자는 시작 날짜만 고른다(`setStartDate`). 그 뒤 여행지를 담거나(`addDestination`)
 * 빼거나(`removeDestination`) 박수를 바꾸면(`setNights`) 스토어가 끝 날짜를 스스로 다시 계산한다.
 * 그래서 어떤 순서로 입력해도 "박수 합 ≠ 기간" 상태가 생기지 않는다(TRIP-1010 경고-1′의 뿌리 제거).
 *
 * 왜 스토어 단위인가: 끝 날짜를 읽는 곳이 셋(1/4 요약·제출, 2/4 카드, 숙소 등록 달력)이라, 규칙을
 * 스토어 한 곳에 두면 셋이 저절로 맞는다(02a §0). 렌더 없이 `getState()` 로 값만 본다.
 *
 * `setPeriod` 는 받은 그대로 저장하는 문으로 남는다(파생 안 함) — 서버·옛 상태를 흉내 내는 픽스처
 * 문이다. 이 파일의 S7 이 "그 뒤 여행지를 바꾸면 끝이 다시 계산된다"를 잠근다(02a ★4).
 *
 * > *(개념)* **fast-check 속성 테스트** — `fc.assert(fc.property(생성기, 검사함수))` 는 생성기가 만든
 * > 무작위 입력으로 검사함수를 수백 번 돌린다. 여기서는 "무작위 액션 순서"를 만들어, 어떤 순서든
 * > 규칙이 깨지지 않는지 본다.
 *
 * 3동작: 준비(reset + 선상태) → 실행(액션) → 단언(getState()).
 *
 * ⚠️ 모듈 싱글턴 스토어 — 파일 최상위 beforeEach·afterEach 둘 다 reset(02a ★11). 속성 테스트는
 * 실행마다 따로 reset 한다(★1 — beforeEach 는 it 하나에 한 번뿐이다).
 */

function store() {
  return useTripWizardStore.getState();
}

beforeEach(() => {
  store().reset();
});

afterEach(() => {
  store().reset();
});

describe('TRIP-1027 · 시작 날짜를 고르면 끝 날짜가 박수 합으로 정해진다', () => {
  it('S1 · 서울 1박·부산 1박에서 10/1을 시작으로 고르면 기간은 10/1–10/3 (AC-1)', () => {
    // 준비
    store().addDestination('서울특별시', 1);
    store().addDestination('부산광역시', 1);

    // 실행
    store().setStartDate('2026-10-01');

    // 단언 — 끝은 사용자가 고르지 않았다. 프리셋 출처도 아니다.
    expect(store().startDate).toBe('2026-10-01');
    expect(store().endDate).toBe('2026-10-03');
    expect(store().presetCode).toBeUndefined();
    expect(store().touched).toContain('period');
  });

  it('S2 · 여행지가 0곳이면 끝 = 시작 (당일, AC-2)', () => {
    // 준비 — "아직 0곳" 앵커(앞 테스트 누수가 아님).
    expect(store().destinations).toHaveLength(0);

    store().setStartDate('2026-10-01');

    expect(store().startDate).toBe('2026-10-01');
    expect(store().endDate).toBe('2026-10-01');
  });
});

describe('TRIP-1027 · 여행지·박수가 바뀌면 끝 날짜가 따라간다', () => {
  it('S3 · 당일에서 서울 1박을 담으면 끝 +1, 부산 1박을 더 담으면 또 +1 (AC-3)', () => {
    store().setStartDate('2026-10-01');
    expect(store().endDate).toBe('2026-10-01');

    store().addDestination('서울특별시', 1);
    expect(store().endDate).toBe('2026-10-02');

    store().addDestination('부산광역시', 1);
    expect(store().endDate).toBe('2026-10-03');
  });

  it('S4 · 부산 +1 → 끝 +1, 다시 −1 → 되돌아옴, 서울 삭제 → 그만큼 줄어듦 (AC-4)', () => {
    // 준비 — 서울(seq 1) 1박 · 부산(seq 2) 1박, 기간 10/1–10/3.
    store().addDestination('서울특별시', 1);
    store().addDestination('부산광역시', 1);
    store().setStartDate('2026-10-01');
    expect(store().endDate).toBe('2026-10-03');

    store().setNights(2, 2);
    expect(store().endDate).toBe('2026-10-04');

    store().setNights(2, 1);
    expect(store().endDate).toBe('2026-10-03');

    store().removeDestination(1);
    // 남은 것은 부산 1박뿐 — 시작은 그대로, 끝만 줄어든다.
    expect(store().startDate).toBe('2026-10-01');
    expect(store().endDate).toBe('2026-10-02');
  });

  it('S5 · 시작이 없으면 여행지를 담고 박수를 바꿔도 끝 날짜가 생기지 않는다', () => {
    store().addDestination('서울특별시', 1);
    store().setNights(1, 3);

    // 끝만 있는 반쪽 기간은 요약·게이트를 거짓으로 만든다 — 시작이 없으면 끝도 없다.
    expect(store().startDate).toBeUndefined();
    expect(store().endDate).toBeUndefined();
  });

  it('S6 · 월·연·윤년 경계를 넘는다 (12/31 + 2박 = 다음 해 1/2, 2028-02-28 + 1박 = 2/29)', () => {
    store().setStartDate('2026-12-31');
    store().addDestination('서울특별시', 2);
    expect(store().endDate).toBe('2027-01-02');

    store().reset();
    store().setStartDate('2028-02-28');
    store().addDestination('서울특별시', 1);
    expect(store().endDate).toBe('2028-02-29');
  });

  it('S7 · setPeriod 로 그대로 적힌 기간도, 그 뒤 여행지를 담으면 새 박수 합으로 다시 계산된다', () => {
    // 준비 — 받은 그대로 저장하는 문(서버·옛 상태 흉내). 0곳인데 3박이라 Σ ≠ 기간.
    store().setPeriod(undefined, '2026-06-10', '2026-06-13');
    expect(store().endDate).toBe('2026-06-13');

    // 실행
    store().addDestination('부산광역시', 1);

    // 단언 — 옛 끝(6/13)이 남지 않는다. 시작 + 새 Σ(1).
    expect(store().startDate).toBe('2026-06-10');
    expect(store().endDate).toBe('2026-06-11');
  });
});

// ── AC-6 · 어떤 입력 순서로도 박수 합 ≠ 기간이 되지 않는다(속성 테스트) ─────────────────────

type Action =
  | { kind: 'add'; region: string; nights: number }
  | { kind: 'remove'; seq: number }
  | { kind: 'nights'; seq: number; nights: number }
  | { kind: 'start'; offsetDays: number };

const MS_PER_DAY = 86_400_000;
const ORIGIN = Date.UTC(2026, 0, 1);

/** 오라클 — 리포의 tripLength·deriveEndDate 를 쓰지 않고 따로 계산한다(02a ★2). */
function oracleDaysBetween(start: string, end: string): number {
  return (
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
    MS_PER_DAY
  );
}

function oracleNightsSum(): number {
  let total = 0;
  for (const one of store().destinations) total += one.nights;
  return total;
}

/** 2026-01-01 + offset 일 → 'YYYY-MM-DD'(연·윤년 경계 포함, 2028-02-29 를 지난다). */
function isoFromOffset(offsetDays: number): string {
  return new Date(ORIGIN + offsetDays * MS_PER_DAY).toISOString().slice(0, 10);
}

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant('add' as const),
    region: fc.constantFrom('서울특별시', '부산광역시', '경주시'),
    nights: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({
    kind: fc.constant('remove' as const),
    seq: fc.integer({ min: 1, max: 6 }),
  }),
  fc.record({
    kind: fc.constant('nights' as const),
    seq: fc.integer({ min: 1, max: 6 }),
    nights: fc.integer({ min: -1, max: 6 }),
  }),
  fc.record({
    kind: fc.constant('start' as const),
    offsetDays: fc.integer({ min: 0, max: 800 }),
  })
);

function apply(action: Action): void {
  switch (action.kind) {
    case 'add':
      store().addDestination(action.region, action.nights);
      return;
    case 'remove':
      store().removeDestination(action.seq);
      return;
    case 'nights':
      store().setNights(action.seq, action.nights);
      return;
    case 'start':
      store().setStartDate(isoFromOffset(action.offsetDays));
      return;
  }
}

/** 매 단계 뒤 불변식 — 최종 상태만 보면 중간의 재계산 누락이 다음 액션에 덮인다(02a ★3). */
function expectConsistent(): void {
  const { startDate, endDate, destinations, party } = store();
  if (startDate === undefined) {
    expect(endDate).toBeUndefined();
    return;
  }
  expect(endDate).toBeDefined();
  expect(oracleDaysBetween(startDate, endDate ?? '')).toBe(oracleNightsSum());
  // '다음' 이 박수 때문에 막히지 않는다 — 박수·기간 관련 위반 코드가 없다.
  const codes = validateTripDraft({
    startDate,
    endDate: endDate ?? '',
    destinations,
    party,
  });
  expect(codes).not.toContain('NIGHTS_EXCEED_PERIOD');
  expect(codes).not.toContain('END_BEFORE_START');
}

describe('TRIP-1027 AC-6 · 속성 — 임의의 입력 순서 뒤에도 끝 − 시작 = 박수 합', () => {
  it('담기·빼기·박수 바꾸기·시작 고르기를 어떤 순서로 섞어도 매 단계 규칙이 성립한다', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 12 }), (actions) => {
        // 실행마다 빈 드래프트에서 시작한다(02a ★1).
        store().reset();
        expectConsistent();
        for (const action of actions) {
          apply(action);
          expectConsistent();
        }
      }),
      { numRuns: 300 }
    );
  });
});
