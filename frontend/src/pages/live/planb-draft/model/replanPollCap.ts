/**
 * TRIP-1363 · 재계획 세션 폴링 상한(8분) 판정 — 순수 함수. 폴링을 도는 훅(`useReplanSession`)과 분리해 둔다.
 *
 * 서버엔 SOLVING 만료/스윕이 없다(solver 실패 시 FAILED 전이뿐) — 응답이 영영 안 와도 화면이 조용히 계속 도는
 * 것(INV-4 위반)을 막으려고 클라이언트가 상한을 쥔다. 상한에 닿으면 페이지가 폴링 중인 본문을 내리고
 * "늦어지고 있어요" 얼굴을 보인다.
 */

/** 8분. */
export const REPLAN_POLL_CAP_MS = 8 * 60 * 1000;

/**
 * 상한 시각(epoch ms). 기준은 세션 생성 시각(`createdAt`) — 응답이 아직 없거나 시각이 읽히지 않으면
 * 화면에 들어온 시각(`mountedAtMs`)이다(그 경우 상한은 최대 8분 늦게 닿는다).
 */
export function replanCapDeadlineMs(
  createdAt: string | undefined,
  mountedAtMs: number
): number {
  const created = createdAt === undefined ? NaN : Date.parse(createdAt);
  return (
    (Number.isFinite(created) ? created : mountedAtMs) + REPLAN_POLL_CAP_MS
  );
}

/** 상한 도달 여부 — 정확히 상한 시각부터 true(그 직전 1ms 는 정상). */
export function isReplanPollCapped(deadlineMs: number, nowMs: number): boolean {
  return nowMs >= deadlineMs;
}
