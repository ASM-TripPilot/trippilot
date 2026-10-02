import { relaxCulpritFilter } from './relaxCulpritFilter';

/**
 * TRIP-416 AC-5 — filter-zero 카드의 "'{원인}' 필터 해제" 버튼이 URL 파라미터에서 무엇을 뺄지
 * 정하는 순수 함수. `filterZeroReasons`의 코드(`amenity:오션뷰`·bare `stayType` 등)를 지금 적용된
 * amenity/stayType 배열에 매핑해 그 원인만 완화한다.
 *
 * 무엇을 보장하나: reason 을 `filterReasonLabel` 과 **같은 규약**(`split(':')` → 앞=축, 뒤=값)으로
 * 읽어 — 값이 있으면 그 축에서 그 값만 빼고, 값이 없으면(bare 축) 그 축을 통째로 비우며, 모르는
 * 축이나 현재 값에 없는 원인은 아무것도 바꾸지 않는다(안전). 입력 배열은 변형하지 않는다.
 *
 * PBT 미적용: `filterReasonLabel` 과 동형 — "모르는 입력은 그대로"는 예제표를 넘는 성질이 없고
 * 매핑이 작아 예제 기반으로 충분하다(01b Seed "PBT 후보 아님", test-designer 판단 일치).
 */
describe('relaxCulpritFilter — 원인 필터 완화 규칙 (AC-5)', () => {
  it.each([
    {
      name: '콜론 값이 있으면 그 축에서 그 값만 뺀다',
      reason: 'amenity:오션뷰',
      current: { amenity: ['오션뷰', '조식'], stayType: [] },
      expected: { amenity: ['조식'], stayType: [] },
    },
    {
      name: 'bare 축(콜론 없음)이면 그 축을 통째로 비운다',
      reason: 'stayType',
      current: { amenity: ['조식'], stayType: ['HOTEL', 'GUESTHOUSE'] },
      expected: { amenity: ['조식'], stayType: [] },
    },
    {
      name: '모르는 축이면 아무것도 바꾸지 않는다',
      reason: 'sort:price',
      current: { amenity: ['조식'], stayType: [] },
      expected: { amenity: ['조식'], stayType: [] },
    },
    {
      name: '원인 값이 현재 필터에 없으면 아무것도 바꾸지 않는다',
      reason: 'amenity:루프탑',
      current: { amenity: ['조식'], stayType: [] },
      expected: { amenity: ['조식'], stayType: [] },
    },
  ])('$name', ({ reason, current, expected }) => {
    // 준비·실행·단언 — 순수 함수라 실행이 곧 단언이다.
    expect(relaxCulpritFilter(reason, current)).toEqual(expected);
  });

  it('입력 배열을 변형하지 않는다(비파괴 — 새 배열을 반환한다)', () => {
    // 준비: 원본 배열 참조를 따로 잡아 둔다.
    const current = { amenity: ['오션뷰', '조식'], stayType: [] };

    // 실행
    relaxCulpritFilter('amenity:오션뷰', current);

    // 단언: 원본은 그대로여야 한다(제거는 반환값에서만 일어난다).
    expect(current.amenity).toEqual(['오션뷰', '조식']);
    expect(current.stayType).toEqual([]);
  });
});
