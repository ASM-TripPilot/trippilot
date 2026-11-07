import { sidoKey } from './sidoKey';

/**
 * TRIP-1806 — 시도 정식 이름을 짧은 이름으로 접는 규칙이 `features/trip/model/regionMatch` 에서 여기로 이사했다
 * (`entities` 가 `features` 를 못 물어서). 규칙 전체는 `regionMatch.test.ts` 가 그대로 잠그고, 여기는 새 자리에 있는지만 본다.
 */
describe('sidoKey — shared 로 이사한 시도 접기', () => {
  it.each([
    ['서울특별시', '서울'],
    ['부산광역시', '부산'],
    ['제주특별자치도', '제주'],
    ['강원특별자치도', '강원'],
    ['경상북도', '경북'],
    ['경상남도', '경남'],
    ['부산', '부산'],
    ['대덕구', '대덕구'],
  ])('%s → %s', (name, expected) => {
    expect(sidoKey(name)).toBe(expected);
  });
});
