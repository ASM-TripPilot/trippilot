import type { TriggerKind, TriggerVariant } from '@/shared/api/index.schemas';

import { isKnownVariant, triggerLabel } from './triggerLabel';

/**
 * TRIP-748 · 지도 위 트리거 알약 카피 `{라벨} · {대상}`(D2 템플릿).
 *
 * 슬롯 매칭(트리거 slotKey ↔ 슬롯)은 호출부 몫 — 받은 슬롯만 쓰고, 없거나 이름이 없으면 라벨만.
 * 도착시는 계획 `startAt` 의 시만 자른다(분 버림, 산술 0 — INV-2 · BR-U4-34). DELAY 의 지연 분은
 * 문구에 넣지 않는다(INV-3). node-safe(`import type` 만).
 *
 * 상황 감지 FE-B(frontend-components §3.4) — `{dayLabel }{라벨}{ · 장소}{ 시}`. `variant` 를 알면 kind 라벨 대신 변형 라벨,
 * `dayLabel`(`triggerDayLabel` 결과)은 맨 앞에 붙는다. CLOSURE 는 그 장소 자체의 영업이라 변형이 있으면 `주변 시설` 꼬리를
 * 뗀다. 변형이 없으면(옛 서버) 옛 출력과 같다 — PBT-SA-22 ④.
 */

export interface TriggerPillSlot {
  nameKo?: string | null;
  startAt: string;
}

export interface TriggerPillOptions {
  variant?: TriggerVariant;
  /** 표시 시점 날짜어(`내일`·`M월 D일`) — 같은 날이면 null. */
  dayLabel?: string | null;
}

function pillBody(
  kind: TriggerKind,
  slot: TriggerPillSlot | null | undefined,
  variant: TriggerVariant | undefined
): string {
  const { label } = triggerLabel(kind, variant);
  const name = slot?.nameKo;
  if (!slot || !name) return label;
  if (kind === 'WEATHER') {
    return `${label} · ${name} ${Number(slot.startAt.slice(0, 2))}시`;
  }
  if (kind === 'DELAY') return `${label} · ${name} 방면`;
  if (kind === 'CLOSURE') {
    return isKnownVariant(variant)
      ? `${label} · ${name}`
      : `${label} · ${name} 주변 시설`;
  }
  return label;
}

export function triggerPillCopy(
  kind: TriggerKind,
  slot?: TriggerPillSlot | null,
  options?: TriggerPillOptions
): string {
  const body = pillBody(kind, slot, options?.variant);
  return options?.dayLabel ? `${options.dayLabel} ${body}` : body;
}
