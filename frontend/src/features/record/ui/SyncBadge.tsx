import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { SyncStatus } from '../model/syncQueue';

/**
 * TRIP-568 · AC-5 (BR-U5-19 4상태 → 3표기) — 방문 카드 동기화 상태 배지.
 *
 * 무엇을 보장하나: 클라 소유 4상태를 배지 **3표기**로 접는다 —
 *   `LOCAL`·`PENDING` → '동기화 대기' · `SYNCED` → '동기화 완료' · `CONFLICT` → '충돌'.
 * (LOCAL·PENDING 이 둘 다 '동기화 대기' 로 접히는 것이 이 매핑의 핵심 판단 — 01b 확정.)
 *
 * `SYNC_BADGE_LABEL` 이 `Record<SyncStatus,string>` 이라 상태가 늘면 tsc 가 먼저 깨진다(전수 강제).
 * 색은 심판 대상이 아니다(글리프/배경 fill 은 jest 사각) — 표기 문자열과 testID 만 계약이다.
 */

export const SYNC_BADGE_LABEL: Record<SyncStatus, string> = {
  LOCAL: '동기화 대기',
  PENDING: '동기화 대기',
  SYNCED: '동기화 완료',
  CONFLICT: '충돌',
};

/** 상태별 pill·글자 톤(색은 무심판 — 대기=회색·완료=중간회색·충돌=primary 빨강, 리포 record 관례). */
function badgeTone(status: SyncStatus): { pill: string; text: string } {
  if (status === 'CONFLICT') return { pill: 'bg-primary', text: 'text-white' };
  if (status === 'SYNCED')
    return { pill: 'bg-surface-soft', text: 'text-muted' };
  return { pill: 'bg-surface-soft', text: 'text-muted-soft' };
}

export function SyncBadge({ status }: { status: SyncStatus }): ReactElement {
  const tone = badgeTone(status);
  return (
    <View
      testID="record-trip-sync-badge"
      className={`self-start rounded-pill px-sm py-[3px] ${tone.pill}`}
    >
      <Text className={`text-label ${tone.text}`}>
        {SYNC_BADGE_LABEL[status]}
      </Text>
    </View>
  );
}
