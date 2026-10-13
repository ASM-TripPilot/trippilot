import { filterReasonLabel } from './filterReasonLabel';

/**
 * Q3(01b Seed §3-3 · AC-4의 재료) — 필터 사유 코드를 화면에 보일 한글 라벨로 바꾼다.
 *
 * 무엇을 보장하나: 콜론 뒤 값이 있으면 그 값을 그대로 쓰고(서버가 이미 한글이다), 값이
 * 없으면 축 이름 사전(2줄: `stayType`·`amenity`)을 따르며, 사전에 없는 축은 코드 그대로
 * 폴백한다(서버가 축을 늘려도 안 깨진다). PBT는 걸지 않는다 — "모르는 입력은 그대로
 * 반환"은 예제표를 넘는 성질이 없다.
 */
describe('filterReasonLabel — 축·값 변환 규칙 (Q3 · AC-4 재료)', () => {
  it.each([
    { input: 'amenity:조식', expected: '조식' },
    { input: 'amenity:오션뷰', expected: '오션뷰' },
    { input: 'stayType:호텔', expected: '호텔' },
    { input: 'stayType', expected: '숙소 유형' },
    { input: 'amenity', expected: '편의시설' },
    { input: 'amenity:', expected: '편의시설' },
    { input: 'weirdAxis', expected: 'weirdAxis' },
  ])('$input → "$expected"', ({ input, expected }) => {
    expect(filterReasonLabel(input)).toBe(expected);
  });
});
