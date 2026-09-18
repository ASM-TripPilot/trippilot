import type { NotificationKind } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 알림함 — kind 8종을 5 아이콘군·한글 라벨로 접는 순수 매핑(DEC-U6-8).
 * 일정군(TRIP_PRE·TRIP_DAY·SLOT_PRE)이 한 아이콘("list")·"일정"으로 합쳐진다. */

export type NotificationIconKind =
  'home' | 'list' | 'swap' | 'document' | 'sun';

export interface NotificationKindMeta {
  icon: NotificationIconKind;
  label: string;
}

/** 8종 kind → 5 아이콘군·한글 라벨. 일정군 3종(TRIP_PRE·TRIP_DAY·SLOT_PRE)이 한 항목으로 접힌다. */
const KIND_META: Record<NotificationKind, NotificationKindMeta> = {
  STAY: { icon: 'home', label: '숙소' },
  TRIP_PRE: { icon: 'list', label: '일정' },
  TRIP_DAY: { icon: 'list', label: '일정' },
  SLOT_PRE: { icon: 'list', label: '일정' },
  PLAN_B: { icon: 'swap', label: 'Plan-B' },
  REFLECTION: { icon: 'document', label: '회고' },
  COMMUNITY: { icon: 'sun', label: '커뮤니티' },
  SYSTEM: { icon: 'sun', label: '시스템' },
};

export function notificationKind(kind: NotificationKind): NotificationKindMeta {
  return KIND_META[kind];
}
