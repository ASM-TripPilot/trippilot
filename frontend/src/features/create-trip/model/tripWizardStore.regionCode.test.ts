/**
 * @jest-environment node
 */
import { useTripWizardStore } from './tripWizardStore';

/**
 * TRIP-1042 AC-12 · 맹점 ① — 여행 목적지에 행정구역 코드를 함께 담는다.
 *
 * 무엇을 보장하나: 지역 피커가 쥔 `regionCode` 를 `addDestination` 세 번째 인자로 받아 목적지에 담고,
 * 목적지를 빼거나 박수를 바꿔도 코드가 따라간다. 꼭 갈 곳 고르기(d02 select)가 이 코드로 지역을 가르고,
 * 여행 생성 요청에도 그대로 실린다(동명이지역도 코드로 확정). 코드를 안 주면 종전처럼 비어 있다.
 *
 * ⚠️ 모듈 싱글턴 스토어 — 리셋을 파일 최상위 beforeEach·afterEach 에 건다.
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

describe('TRIP-1042 AC-12 · 목적지에 regionCode 가 담긴다', () => {
  it('코드를 주면 그 목적지에 regionCode 로 담긴다', () => {
    expect(store().destinations).toHaveLength(0);

    store().addDestination('서울특별시', 1, '11');

    const [seoul] = store().destinations;
    expect(store().destinations).toHaveLength(1);
    expect(seoul.seq).toBe(1);
    expect(seoul.region).toBe('서울특별시');
    expect(seoul.nights).toBe(1);
    expect(seoul.regionCode).toBe('11');
  });

  it('코드를 안 주면 regionCode 는 비어 있다 (종전 호출 무회귀)', () => {
    store().addDestination('부산', 1);

    const [busan] = store().destinations;
    expect(busan.region).toBe('부산');
    expect(busan.regionCode).toBeUndefined();
  });

  it('앞 목적지를 빼도 남은 목적지의 코드는 그대로다(seq 만 다시 매긴다)', () => {
    store().addDestination('서울특별시', 1, '11');
    store().addDestination('부산광역시', 2, '26');

    store().removeDestination(1);

    const [left] = store().destinations;
    expect(store().destinations).toHaveLength(1);
    expect(left.seq).toBe(1);
    expect(left.region).toBe('부산광역시');
    expect(left.regionCode).toBe('26');
  });

  it('박수를 바꿔도 코드는 그대로다', () => {
    store().addDestination('서울특별시', 1, '11');

    store().setNights(1, 3);

    const [seoul] = store().destinations;
    expect(seoul.nights).toBe(3);
    expect(seoul.regionCode).toBe('11');
  });
});
