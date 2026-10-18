import type { CompanionType } from '@/shared/api/index.schemas';

/**
 * 동반 유형별 인원 범위(TRIP-1423 Q-059) — 혼자 1 · 연인 2 고정, 친구·가족 2명 이상, 미선택 1명 이상.
 * 정본 BR-U1-39 에는 없는 사용자 결정(2026-10-16)이다. 배선(칩을 고르면 인원을 범위 안으로)과 동행 시트
 * (범위 끝의 −·+ disabled)가 이 한 곳을 같이 읽는다 — 두 층이 따로 적으면 갈라진다.
 */
export function partyRangeFor(type: CompanionType | undefined): {
  min: number;
  max: number;
} {
  if (type === '혼자') return { min: 1, max: 1 };
  if (type === '연인') return { min: 2, max: 2 };
  if (type === '친구' || type === '가족') return { min: 2, max: Infinity };
  return { min: 1, max: Infinity };
}
