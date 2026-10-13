/**
 * TRIP-613 · AC-2·AC-4 · BR-U5-05 · frontend-components §7 — 방문 시각 편집의 클라 선검증 순수 함수.
 *
 * 서버 재검증이 최종이라(INV-2) 이 함수는 UX 게이팅용이다 — 위반이면 시트가 요청을 안 내보내고
 * 인라인 오류를 그린다. `now` 는 인자로 받는다(시계를 안 읽는다) — 같은 입력에 now 만 바꾸면
 * valid↔future 가 뒤집혀야 하므로 재현성 있게 주입받는다(tripWizardStep1 선례).
 *
 * 위반이면 `{ ok: false, reason }`, 아니면 `{ ok: true }` (판별 유니온 — 실패 사유를 잃지 않는다).
 * 우선순위 완료없이도착 > 순서 > 미래 — 테스트는 단일 위반만 잠근다.
 */

export type AdjustTimesViolation =
  'order' | 'completed-without-arrived' | 'future';

export type AdjustTimesDraftResult =
  { ok: true } | { ok: false; reason: AdjustTimesViolation };

export function adjustTimesDraft(params: {
  arrivedAt: string | null;
  completedAt: string | null;
  now: string;
}): AdjustTimesDraftResult {
  const { arrivedAt, completedAt, now } = params;

  // 1. 완료없이도착 — 완료만 있고 도착이 없으면 거부(BR-U5-05, 파생 체류가 정의 안 됨).
  if (completedAt != null && arrivedAt == null) {
    return { ok: false, reason: 'completed-without-arrived' };
  }

  // 2. 순서 — 둘 다 있고 완료 < 도착이면 거부(BR-U5-05, 파생 체류 음수 방지). 같은 시각은 허용(≥).
  if (
    arrivedAt != null &&
    completedAt != null &&
    new Date(completedAt).getTime() < new Date(arrivedAt).getTime()
  ) {
    return { ok: false, reason: 'order' };
  }

  // 3. 미래 — 제공된 시각 중 하나라도 now 보다 미래면 거부(§7, 미래에 방문·완료는 불가능).
  const nowMs = new Date(now).getTime();
  for (const at of [arrivedAt, completedAt]) {
    if (at != null && new Date(at).getTime() > nowMs) {
      return { ok: false, reason: 'future' };
    }
  }

  return { ok: true };
}
