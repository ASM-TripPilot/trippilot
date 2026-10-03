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

  it('짝 — 상한은 없다 (클램프가 위로도 접으면 red)', () => {
    // 하한만 두면 "항상 1 을 넣는" 구현도, "상한으로 접는" 구현도 통과할 수 있다.
    useTripWizardStore.getState().addDestination('부산', 2);

    useTripWizardStore.getState().setNights(1, 30);
    expect(useTripWizardStore.getState().destinations[0].nights).toBe(30);
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
