import { pickCoverCity } from './coverCity';

const d = (seq: number, region: string) => ({ seq, region, nights: 1 });

describe('TRIP-1208 · pickCoverCity — 커버에 쓸 도시 이름', () => {
  it('목적지가 하나면 그 region', () => {
    expect(pickCoverCity([d(1, '부산')])).toBe('부산');
  });
  it('여럿이면 seq 가 가장 작은 첫 도시만(배열 순서가 아니라 seq)', () => {
    expect(pickCoverCity([d(2, '경주'), d(1, '제주')])).toBe('제주');
  });
  it('앞뒤 공백은 걷는다', () => {
    expect(pickCoverCity([d(1, '  강릉 ')])).toBe('강릉');
  });
  it.each([
    ['빈 배열', []],
    ['빈 문자열', [d(1, '')]],
    ['공백뿐', [d(1, '   ')]],
  ])('%s 이면 null (빈 글자·undefined 문자열 금지)', (_n, list) => {
    expect(pickCoverCity(list)).toBeNull();
  });
  it('목적지 필드 자체가 없어도(방어) null', () => {
    expect(pickCoverCity(undefined)).toBeNull();
  });
});
