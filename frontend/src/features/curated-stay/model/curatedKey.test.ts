import { curatedKey } from './curatedKey';

/**
 * TRIP-1579 — 인기 숙소 `stayId`('TRIPCOM:{hotelId}') → 저장 키 `{ externalSource, externalId, name }`.
 * 첫 콜론으로만 가른다 — hotelId 쪽에 콜론이 더 있어도 externalId 에 그대로 남는다.
 */
describe('K · curatedKey', () => {
  it("'TRIPCOM:123' → TRIPCOM / 123 + 이름", () => {
    expect(
      curatedKey({ stayId: 'TRIPCOM:123', name: '롯데호텔 서울' })
    ).toEqual({
      externalSource: 'TRIPCOM',
      externalId: '123',
      name: '롯데호텔 서울',
    });
  });

  it('첫 콜론으로만 가른다', () => {
    expect(curatedKey({ stayId: 'TRIPCOM:a:b', name: 'x' })).toEqual({
      externalSource: 'TRIPCOM',
      externalId: 'a:b',
      name: 'x',
    });
  });
});
