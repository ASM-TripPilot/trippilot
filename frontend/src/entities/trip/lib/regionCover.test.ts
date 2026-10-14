import { REGION_COVERS } from '../config/regionCovers';

import { pickRegionCover } from './regionCover';

const dest = (seq: number, regionCode?: string | null) => ({ seq, regionCode });

describe('pickRegionCover', () => {
  it('시군구 코드가 있으면 그 시군구 그림을 준다', () => {
    expect(pickRegionCover([dest(1, '26350')])).toBe(REGION_COVERS['26350']);
  });

  it('첫 목적지(seq 최소)의 코드만 쓴다', () => {
    expect(pickRegionCover([dest(2, '26'), dest(1, '50')])).toBe(
      REGION_COVERS['50']
    );
  });

  it('시군구 그림이 없으면 같은 시도 그림으로 내려간다', () => {
    expect(pickRegionCover([dest(1, '11999')])).toBe(REGION_COVERS['11']);
  });

  it('세 곳 밖이거나 코드가 없으면 null — 호출부가 그라데이션을 그린다', () => {
    expect(pickRegionCover([dest(1, '28200')])).toBeNull();
    expect(pickRegionCover([dest(1, null)])).toBeNull();
    expect(pickRegionCover([dest(1, ' ')])).toBeNull();
    expect(pickRegionCover([])).toBeNull();
    expect(pickRegionCover(undefined)).toBeNull();
  });
});
