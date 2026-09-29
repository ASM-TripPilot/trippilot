import type { TripSummaryStats } from '@/shared/api/generated/schemas';

import { formatShareCardStats } from './shareCard';
import { summaryStats } from './summaryStats';

/**
 * TRIP-572 · j04 summaryStats — 요약 stats 를 표시 3셀로 변환(INV-U5-07 0채움 · 거리 대시).
 *
 * 무엇을 보장하나:
 *  - AC-4(INV-U5-07): 입력 결측(undefined·null)이어도 방문·사진은 0 으로 채운다(빈 칸 금지, 기본 카드가
 *    이 값만으로 그려짐).
 *  - AC-2(BR-U5-39·error 프레임 실측): 이동 거리는 **`hasLocationData:false` 면 "—"**(0km 이 아니다 —
 *    "측정 못 함"과 "0km"를 안 섞는다). true 면 `${km}km`.
 *  - **소요시간 필드 없음**(INV-3) — 거리만. 571 daily `statsCard.ts`(필드명 다름)를 안 건드리고 신규 함수.
 *
 * ★ 571 statsCard 처럼 입력을 옵셔널로 받는다 — 서버 계약상 stats 는 required 지만, 클라 폴백은
 *   **응답 자체 결측**(네트워크 실패)까지 방어한다.
 *
 * (개념) `??` 는 null/undefined 만 대체 — 실제 0/12 값은 그대로 통과("빈 것"과 "0인 것"을 안 섞음).
 * 3동작: 준비=stats(있음/undefined/부분) → 실행=summaryStats → 단언=3셀.
 */

describe('AC-4 · summaryStats — 방문·사진 0채움 (INV-U5-07)', () => {
  it('undefined 입력이면 방문·사진 0, 거리는 대시(위치 결측→측정 못 함)', () => {
    expect(summaryStats(undefined)).toEqual({
      totalVisits: 0,
      distanceText: '—',
      totalPhotos: 0,
    });
  });

  it('null 입력도 0 채움으로 방어한다', () => {
    expect(summaryStats(null)).toEqual({
      totalVisits: 0,
      distanceText: '—',
      totalPhotos: 0,
    });
  });
});

describe('AC-2 · summaryStats — 거리 셀은 hasLocationData 로 갈린다', () => {
  it('hasLocationData:false 면 거리 "—", 방문·사진은 실수치(0 아님)', () => {
    const given: TripSummaryStats = {
      totalVisits: 12,
      totalDistanceKm: 0,
      distanceSource: 'VISIT_LINE',
      totalPhotos: 24,
      hasLocationData: false,
    };

    expect(summaryStats(given)).toEqual({
      totalVisits: 12,
      distanceText: '—',
      totalPhotos: 24,
    });
  });

  it('hasLocationData:true 면 거리 "${km}km"', () => {
    const given: TripSummaryStats = {
      totalVisits: 12,
      totalDistanceKm: 38,
      distanceSource: 'VISIT_LINE',
      totalPhotos: 24,
      hasLocationData: true,
    };

    expect(summaryStats(given)).toEqual({
      totalVisits: 12,
      distanceText: '38km',
      totalPhotos: 24,
    });
  });
});

/**
 * TRIP-1086 · 거리 표기 — j04 통계·j06 공유 카드가 같은 `distanceText` 를 쓴다.
 * 날값 double('1.9294…km')이 아니라 0.1 단위('1.9km'). 대시 판정(hasLocationData)이 반올림보다 먼저다.
 */
describe('🔴 TRIP-1086 AC-2·AC-6 · distanceText 는 0.1 단위 표기', () => {
  function located(
    totalDistanceKm: number,
    hasLocationData = true
  ): TripSummaryStats {
    return {
      totalVisits: 3,
      totalDistanceKm,
      distanceSource: 'VISIT_LINE',
      totalPhotos: 5,
      hasLocationData,
    };
  }

  it('1.9294588176597474km → "1.9km"', () => {
    expect(summaryStats(located(1.9294588176597474)).distanceText).toBe(
      '1.9km'
    );
  });

  it('50m 미만(0.04km)이고 위치가 있으면 "0km" — 대시가 아니다(01b 판단 1)', () => {
    expect(summaryStats(located(0.04)).distanceText).toBe('0km');
  });

  it('hasLocationData:false 면 거리 값이 있어도 "—"(반올림보다 대시 판정이 먼저)', () => {
    expect(summaryStats(located(1.93, false)).distanceText).toBe('—');
  });

  it('j06 공유 카드 문구에도 반올림된 거리가 흘러간다(두 포맷)', () => {
    const cells = summaryStats(located(1.9294588176597474));

    expect(formatShareCardStats(cells, 'default')).toBe(
      '3곳 · 1.9km · 사진 5장'
    );
    expect(
      formatShareCardStats(
        summaryStats({ ...located(1.9294588176597474), totalPhotos: 0 }),
        'no-photo'
      )
    ).toBe('방문 3 · 이동 1.9km · 사진 0');
  });
});
