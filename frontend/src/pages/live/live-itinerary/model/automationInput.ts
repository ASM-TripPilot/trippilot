import type { VisitCheck } from '@/shared/api/index.schemas';
import type { AutomationVisitRef } from '@/shared/location';

/**
 * TRIP-1339 · 서버 방문 실적 → U10 판정 문맥(서버 우선, §5.2). 즉석 방문(slotKey 없음)은 자동 대상이 아니다.
 * 타임스탬프 없는 행(자동 되돌림으로 비워진 행)은 '되돌림'으로 본다 — 그날 자동 대상에서 빠진다(BR-U10-32).
 */
export function automationVisitRefs(
  visits: readonly VisitCheck[]
): AutomationVisitRef[] {
  const out: AutomationVisitRef[] = [];
  for (const v of visits) {
    if (!v.slotKey) continue;
    if (v.skippedAt)
      out.push({
        slotKey: v.slotKey,
        status: 'skipped',
        at: Date.parse(v.skippedAt),
      });
    else if (v.completedAt)
      out.push({
        slotKey: v.slotKey,
        status: 'completed',
        at: Date.parse(v.completedAt),
      });
    else if (v.arrivedAt)
      out.push({
        slotKey: v.slotKey,
        status: 'arrived',
        at: Date.parse(v.arrivedAt),
      });
    else
      out.push({
        slotKey: v.slotKey,
        status: 'suppressed',
        at: Date.parse(v.updatedAt),
      });
  }
  return out;
}
