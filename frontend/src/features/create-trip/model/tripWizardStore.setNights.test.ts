import fc from 'fast-check';

import { MAX_TRIP_NIGHTS, nightsSum } from './tripDraft';
import { minNightsFor, useTripWizardStore } from './tripWizardStore';

/**
 * TRIP-666 — 여행지 편집 시트가 처음 요구하는 스토어 액션 `setNights(seq, nights)` (AC-2 스토어 측).
 *
 * 무엇을 보장하나: 이미 담은 도시의 **박수만** 바꾸는 액션이 ① 지정한 seq 의 nights 를 교체하고
 * ② 하한으로 접으며(도시 하나면 0박=당일치기, 여럿이면 최소 1박 — 01b D1 + 0박 결정) ③ 상한은 없고 ④ 못 찾는 seq 는 아무것도 안 바꾼다.
 * add/removeDestination 은 이 사이클에서 손대지 않는다(회귀 잠금 — 여기서 함께 검증).
 *
 * 왜 스토어 단위인가: "즉시 스토어 반영"(01b D3)의 심장은 이 순수 액션이다. 시트·페이지 배선이
 * 이걸 호출할 뿐, 판정(하한·no-op)은 여기 산다. 렌더 없이 getState() 로 값만 본다.
 *
 * 3동작 뼈대: 준비=reset+addDestination → 실행=setNights → 단언=getState().destinations.
 *
 * ⚠️ 모듈 싱글턴이라 매 테스트 전 reset (tripWizardStore.test.ts 선례).
 */

beforeEach(() => {
  useTripWizardStore.getState().reset();
});

// 모듈 싱글턴 — 파일 최상위에서도 끝에 되돌린다(이 파일이 남긴 30박 상태가 다른 파일로 새지 않게).
afterEach(() => {
  useTripWizardStore.getState().reset();
});

describe('AC-2 · setNights — 박수만 교체', () => {
  it('지정한 seq 의 nights 만 바뀌고 다른 seq 는 그대로다 (교차 seq 잠금)', () => {
    // 준비 — 두 도시. seq 1=부산 2박, seq 2=경주 1박.
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().addDestination('경주', 1);

    // 실행 — seq 1 의 박수만 5 로.
    useTripWizardStore.getState().setNights(1, 5);

    // 단언 — seq 1 만 5, seq 2 는 1 그대로. 배열 통째 비교라 seq 를 뒤바꾼 구현이 red.
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 5 },
      { seq: 2, region: '경주', nights: 1 },
    ]);
  });

  it('도시가 하나면 하한 0 — 0박(당일치기)이 되고, 음수는 0 으로 접는다', () => {
    useTripWizardStore.getState().addDestination('부산', 2);

    useTripWizardStore.getState().setNights(1, 0);
    expect(useTripWizardStore.getState().destinations[0].nights).toBe(0);

    useTripWizardStore.getState().setNights(1, -3);
    expect(useTripWizardStore.getState().destinations[0].nights).toBe(0);
  });

  it('도시가 둘 이상이면 하한 1 — 0 이나 음수를 넣어도 1 로 접는다 (01b D1)', () => {
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().addDestination('경주', 1);

    useTripWizardStore.getState().setNights(1, 0);
    expect(useTripWizardStore.getState().destinations[0].nights).toBe(1);

    useTripWizardStore.getState().setNights(2, -3);
    expect(useTripWizardStore.getState().destinations[1].nights).toBe(1);
  });

  it('0박 도시가 있는 상태에서 두 번째 도시를 담으면 기존 도시가 1박으로 올라간다', () => {
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().setNights(1, 0);

    useTripWizardStore.getState().addDestination('경주', 1);

    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 1 },
      { seq: 2, region: '경주', nights: 1 },
    ]);
  });

  it('다도시가 되는 순간 새로 담는 도시도 하한 1 이다 — 0박으로 담아도 1박이 된다', () => {
    useTripWizardStore.getState().addDestination('부산', 1);

    useTripWizardStore.getState().addDestination('경주', 0);

    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 1 },
      { seq: 2, region: '경주', nights: 1 },
    ]);
  });

  it('첫 도시는 0박으로 담을 수 있다(도시 하나는 당일치기가 합법)', () => {
    useTripWizardStore.getState().addDestination('부산', 0);

    expect(useTripWizardStore.getState().destinations[0].nights).toBe(0);
  });

  it('0박이면 종료일이 시작일과 같다(당일치기 기간) — 다시 올리면 하루씩 늘어난다', () => {
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().setStartDate('2026-06-10');

    useTripWizardStore.getState().setNights(1, 0);
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-10');

    useTripWizardStore.getState().setNights(1, 1);
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-11');
  });

  it('minNightsFor — 도시 하나만 0, 그 밖(0곳·여럿)은 1', () => {
    expect(minNightsFor(1)).toBe(0);
    expect(minNightsFor(2)).toBe(1);
    expect(minNightsFor(5)).toBe(1);
    expect(minNightsFor(0)).toBe(1);
  });

  it('TRIP-1219 a · 상한 — 박수 합이 MAX_TRIP_NIGHTS(30)를 넘지 않는다, 상한 값 자체는 허용', () => {
    useTripWizardStore.getState().addDestination('부산', 2);

    useTripWizardStore.getState().setNights(1, MAX_TRIP_NIGHTS);
    expect(useTripWizardStore.getState().destinations[0].nights).toBe(30);

    useTripWizardStore.getState().setNights(1, 42);
    expect(useTripWizardStore.getState().destinations[0].nights).toBe(30);
  });

  it('TRIP-1219 a · 다도시도 합으로 접는다 — 다른 도시 몫을 뺀 만큼만 올라간다', () => {
    useTripWizardStore.getState().addDestination('부산', 20);
    useTripWizardStore.getState().addDestination('경주', 1);

    useTripWizardStore.getState().setNights(2, 99);

    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 20 },
      { seq: 2, region: '경주', nights: 10 },
    ]);
  });

  it('못 찾는 seq 는 아무것도 안 바꾼다 (no-op)', () => {
    useTripWizardStore.getState().addDestination('부산', 2);

    useTripWizardStore.getState().setNights(99, 7);

    // 원본 그대로. no-op 은 목록을 건드리지 않는다.
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2 },
    ]);
  });
});

/**
 * TRIP-1210 — 도시를 여럿 담게 되면서 새로 생긴 위반: 박수 합이 이미 30박인데 도시를 더 담으면 31박이 된다.
 * `setNights`에만 있던 합 상한(TRIP-1219 a)을 `addDestination`도 지킨다 — 넘치게 될 추가는 담기지 않는다.
 * 지역 피커는 이 액션 하나로 도시를 담으므로(`RegionPickerPage`), 여기서 막으면 어느 길로 와도 막힌다.
 *
 * 3동작: 준비(reset + 선상태) → 실행(addDestination) → 단언(getState()).
 */
describe('TRIP-1210 · 도시를 더 담아도 박수 합은 30박을 넘지 않는다', () => {
  function store() {
    return useTripWizardStore.getState();
  }

  it('한 도시 30박에 도시를 더 담으면 담기지 않는다 — 목록·끝 날짜 그대로', () => {
    // 준비 — "아직 0곳" 앵커(앞 테스트 누수가 아님) → 서울 30박, 10/1 시작(끝 10/31).
    expect(store().destinations).toHaveLength(0);
    store().addDestination('서울특별시', 1, '11');
    store().setNights(1, MAX_TRIP_NIGHTS);
    store().setStartDate('2026-10-01');
    expect(store().endDate).toBe('2026-10-31');

    // 실행
    store().addDestination('부산광역시', 1, '26');

    // 단언
    expect(store().destinations).toEqual([
      { seq: 1, region: '서울특별시', nights: 30, regionCode: '11' },
    ]);
    expect(store().endDate).toBe('2026-10-31');
  });

  it('두 도시 20+10박에 세 번째 도시를 담아도 담기지 않는다', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산광역시', 20);
    store().addDestination('경주시', 10);

    store().addDestination('서울특별시', 1);

    expect(store().destinations.map((one) => one.region)).toEqual([
      '부산광역시',
      '경주시',
    ]);
    expect(nightsSum(store().destinations)).toBe(30);
  });

  it('29박이면 1박짜리 도시를 담을 수 있다 — 합이 딱 30박(경계 값은 허용)', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('서울특별시', 1);
    store().setNights(1, 29);
    store().setStartDate('2026-10-01');

    store().addDestination('부산광역시', 1);

    expect(store().destinations.map((one) => one.region)).toEqual([
      '서울특별시',
      '부산광역시',
    ]);
    expect(nightsSum(store().destinations)).toBe(30);
    expect(store().endDate).toBe('2026-10-31');
  });

  /**
   * > *(개념)* **속성 테스트(PBT)** — 무작위로 만든 액션 순서를 수백 번 돌려, 매 단계 뒤 규칙이 깨지지 않는지 본다.
   * 담기·빼기·박수 바꾸기·시작 고르기를 어떤 순서로 섞어도 박수 합은 30박 이하다.
   */
  it('속성 — 어떤 순서로 담고 빼고 박수를 바꿔도 매 단계 박수 합 ≤ 30', () => {
    type Action =
      | { kind: 'add'; region: string; nights: number }
      | { kind: 'remove'; seq: number }
      | { kind: 'nights'; seq: number; nights: number }
      | { kind: 'start'; day: number };

    const actionArb: fc.Arbitrary<Action> = fc.oneof(
      fc.record({
        kind: fc.constant('add' as const),
        region: fc.constantFrom('서울특별시', '부산광역시', '경주시'),
        nights: fc.integer({ min: 0, max: 8 }),
      }),
      fc.record({
        kind: fc.constant('remove' as const),
        seq: fc.integer({ min: 1, max: 8 }),
      }),
      fc.record({
        kind: fc.constant('nights' as const),
        seq: fc.integer({ min: 1, max: 8 }),
        nights: fc.integer({ min: -1, max: 40 }),
      }),
      fc.record({
        kind: fc.constant('start' as const),
        day: fc.integer({ min: 1, max: 28 }),
      })
    );

    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 20 }), (actions) => {
        // 실행마다 빈 드래프트에서 시작한다(beforeEach 는 it 하나에 한 번뿐이다).
        store().reset();
        for (const action of actions) {
          if (action.kind === 'add') {
            store().addDestination(action.region, action.nights);
          } else if (action.kind === 'remove') {
            store().removeDestination(action.seq);
          } else if (action.kind === 'nights') {
            store().setNights(action.seq, action.nights);
          } else {
            const day = String(action.day).padStart(2, '0');
            store().setStartDate(`2026-10-${day}`);
          }
          expect(nightsSum(store().destinations)).toBeLessThanOrEqual(
            MAX_TRIP_NIGHTS
          );
        }
      }),
      { numRuns: 300 }
    );
  });
});
