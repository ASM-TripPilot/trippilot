import type { ReflectionStats } from '@/shared/api/generated/schemas';

import { missingParts } from './missingParts';

/**
 * TRIP-571 · AC-3 (BR-U5-34) — 부분 데이터면 누락을 명시한다(조용히 칸을 지우지 않는다).
 *
 * 무엇을 보장하나:
 *  - photoCount===0 → `hidePhotoGrid=true`(하이라이트/사진 그리드 자리에 "사진 없음").
 *  - visitCount<2 → `mapNotice`(지도 자리 사유 문자열, 비지 않음) + `distanceDash=true`(거리 "—").
 *  - 데이터가 충분하면(방문 2+·사진 1+) 세 신호 모두 꺼진다(mapNotice=null).
 *
 * 왜 이렇게 테스트하나(02a ★5):
 *  - `distanceKm` 은 required number(null 없음)라 "—"는 값이 아니라 **판정 플래그**(distanceDash)로
 *    표현한다 — VISIT_LINE 근사가 방문점 2개 이상을 이어야 성립하므로 1곳 이하는 이동거리가 무의미(01b Q2).
 *  - mapNotice 문구 자체는 Figma 카피(6-b 픽셀 소관)라 발명하지 않고 "비지 않음"만 잠근다.
 *
 * 3동작: 준비=stats → 실행=missingParts → 단언=플래그·사유.
 */

function stats(over: Partial<ReflectionStats> = {}): ReflectionStats {
  return {
    visitCount: 4,
    distanceKm: 12,
    distanceSource: 'VISIT_LINE',
    photoCount: 6,
    ...over,
  };
}

describe('AC-3 · missingParts — 누락 표기(BR-U5-34)', () => {
  it('사진 0장이면 사진 그리드를 생략 신호로 표시한다', () => {
    expect(missingParts(stats({ photoCount: 0 })).hidePhotoGrid).toBe(true);
  });

  it('사진이 1장 이상이면 그리드를 생략하지 않는다(짝)', () => {
    expect(missingParts(stats({ photoCount: 3 })).hidePhotoGrid).toBe(false);
  });

  it('방문 2곳 미만이면 지도 자리에 사유(비지 않음) + 거리 "—"(distanceDash)', () => {
    const parts = missingParts(stats({ visitCount: 1 }));

    expect(parts.mapNotice).not.toBeNull();
    expect((parts.mapNotice ?? '').trim().length).toBeGreaterThan(0);
    expect(parts.distanceDash).toBe(true);
  });

  it('방문 0곳도 지도 사유 + 대시(1곳 이하 전부)', () => {
    const parts = missingParts(stats({ visitCount: 0 }));

    expect(parts.mapNotice).not.toBeNull();
    expect(parts.distanceDash).toBe(true);
  });

  it('방문 2곳 이상이면 지도 사유 없음 + 거리 대시 없음(짝)', () => {
    const parts = missingParts(stats({ visitCount: 2 }));

    expect(parts.mapNotice).toBeNull();
    expect(parts.distanceDash).toBe(false);
  });
});
