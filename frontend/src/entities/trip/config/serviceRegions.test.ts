import { SERVICE_REGIONS } from '@/entities/trip';

/**
 * TRIP-1432 · 서비스 지역(2026-10-16 사용자 결정) — 홈·탐색 레인과 지역 피커(TRIP-1443)가 함께 쓴다.
 * 배열 순서가 곧 장소 조회 쿼리 키 순서라, 홈·탐색이 응답 캐시를 나눠 쓰려면 순서까지 같아야 한다.
 * 이름은 서버 별칭(짧은 이름) — `/places?region=` 은 이름을 받는다.
 */
describe('SERVICE_REGIONS', () => {
  it('SR1 · 서울 11 · 부산 26 · 제주 50, 이 순서다', () => {
    expect(SERVICE_REGIONS).toEqual([
      { code: '11', name: '서울' },
      { code: '26', name: '부산' },
      { code: '50', name: '제주' },
    ]);
  });
});
