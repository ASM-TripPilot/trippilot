import type { TriggerKind } from '@/shared/api/generated/schemas';

import { triggerLabel } from './triggerLabel';

/**
 * TRIP-748 · 지도 위 트리거 알약 카피 `{라벨} · {대상}`(D2 템플릿).
 *
 * 슬롯 매칭(트리거 slotKey ↔ 슬롯)은 호출부 몫 — 받은 슬롯만 쓰고, 없거나 이름이 없으면 라벨만.
 * 도착시는 계획 `startAt` 의 시만 자른다(분 버림, 산술 0 — INV-2 · BR-U4-34). DELAY 의 지연 분은
 * 문구에 넣지 않는다(INV-3). node-safe(`import type` 만).
 */

export interface TriggerPillSlot {
  nameKo?: string | null;
  startAt: string;
}

export function triggerPillCopy(
  kind: TriggerKind,
  slot?: TriggerPillSlot | null
): string {
  const { label } = triggerLabel(kind);
  const name = slot?.nameKo;
  if (!slot || !name) return label;
  if (kind === 'WEATHER') {
    return `${label} · ${name} ${Number(slot.startAt.slice(0, 2))}시`;
  }
  if (kind === 'DELAY') return `${label} · ${name} 방면`;
  if (kind === 'CLOSURE') return `${label} · ${name} 주변 시설`;
  return label;
}
