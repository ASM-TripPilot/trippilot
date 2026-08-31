import { render, screen } from '@testing-library/react-native';

import type { SyncStatus } from '../model/syncQueue';
import { SYNC_BADGE_LABEL, SyncBadge } from './SyncBadge';

/**
 * TRIP-568 · AC-5 (BR-U5-19 4상태 → 3표기) — 동기화 상태 배지.
 *
 * 무엇을 보장하나: 클라 소유 4상태를 카드 배지 **3표기**로 접는다 —
 *   `LOCAL`·`PENDING` → '동기화 대기' · `SYNCED` → '동기화 완료' · `CONFLICT` → '충돌'.
 * (LOCAL·PENDING 이 둘 다 '동기화 대기' 로 접히는 것이 이 매핑의 핵심 판단 — 01b 확정.)
 *
 * 개념: `Record<SyncStatus, string>` = 4상태 전수 강제. enum 값이 늘면 tsc 가 먼저 깨진다.
 *   `getByText('문자열')` = 렌더 트리의 텍스트 leaf 완전일치(부분포함은 정규식).
 *
 * 3동작 뼈대: 준비=상태 prop → 실행=render/조회 → 단언=배지 존재·라벨.
 */

describe('SYNC_BADGE_LABEL — 4상태 전수 매핑(순수)', () => {
  it('4키를 빠짐없이 덮고, LOCAL·PENDING 은 함께 "동기화 대기" 로 접힌다', () => {
    const allStates: SyncStatus[] = ['LOCAL', 'PENDING', 'SYNCED', 'CONFLICT'];
    // 키 전수 — 상태가 늘면 여기서 먼저 빨개진다.
    expect(Object.keys(SYNC_BADGE_LABEL).sort()).toEqual([...allStates].sort());

    expect(SYNC_BADGE_LABEL).toEqual({
      LOCAL: '동기화 대기',
      PENDING: '동기화 대기',
      SYNCED: '동기화 완료',
      CONFLICT: '충돌',
    });
  });
});

describe('🔴 SyncBadge — 카드 배지 렌더(3표기)', () => {
  it.each([
    ['LOCAL', '동기화 대기'],
    ['PENDING', '동기화 대기'],
    ['SYNCED', '동기화 완료'],
    ['CONFLICT', '충돌'],
  ] as [SyncStatus, string][])(
    '%s → 배지가 뜨고 "%s" 를 보인다',
    (status, label) => {
      render(<SyncBadge status={status} />);

      expect(screen.getByTestId('record-trip-sync-badge')).toBeOnTheScreen();
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
  );
});
