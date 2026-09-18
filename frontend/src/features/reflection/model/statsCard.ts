import type { ReflectionStats } from '@/shared/api/generated/schemas';

/**
 * TRIP-571 · statsCard — 근거 수치를 0으로 채운 완전한 stats 를 낸다(INV-U5-07).
 *
 * 무엇을 보장하나: 입력이 비었거나(undefined·null) 필드가 결측이어도 네 필드가 늘 채워진
 * `ReflectionStats` 를 돌려준다. 폴백 ③(기본 카드)과 표시본 BASIC 문장이 이 값만으로 그려지므로,
 * 어떤 상황에서도 숫자 필드가 결측이면 안 된다.
 *
 * ★ 서버 계약상 `stats` 는 required 지만, 클라 폴백은 **응답 자체 결측**(네트워크 실패)까지 방어해야
 * 하므로 입력을 옵셔널로 받는다. `distanceSource` 는 숫자가 아니라 enum 이라 기본값도 유효 enum(`VISIT_LINE`)
 * 이어야 한다 — VISIT_LINE 은 방문점을 이은 직선 합의 근사라 거리 미상일 때의 안전한 기본이다.
 */
export function statsCard(stats?: ReflectionStats | null): ReflectionStats {
  return {
    visitCount: stats?.visitCount ?? 0,
    distanceKm: stats?.distanceKm ?? 0,
    distanceSource: stats?.distanceSource ?? 'VISIT_LINE',
    photoCount: stats?.photoCount ?? 0,
  };
}
