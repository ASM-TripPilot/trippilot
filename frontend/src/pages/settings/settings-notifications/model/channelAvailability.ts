import type { NotificationToggle } from '@/shared/api/index.schemas';

/**
 * TRIP-607 · l02 알림 설정 — OS 푸시 권한 × 토글 조합 → 푸시 열 가용성 순수 판정.
 *
 * PBT-U6-F2(CI 차단 게이트)의 대상. 리포 최초의 "OS 권한 × 사용자 설정 → UI 가용성" 순수 함수 —
 * location(l06)은 권한을 서버에 미러해 이 축이 없었다. 인앱 열은 권한과 무관하게 항상 조작 가능하므로
 * 여기서 다루지 않는다(푸시 열만).
 *
 * ⚠ 이 파일은 [테스트 작성]이 낸 red-phase 스텁이다 — 구현은 implementer 몫(throw 로 red 보장).
 */

export type PushPermission = 'GRANTED' | 'DENIED' | 'UNDETERMINED';

export interface PushColumnState {
  /** 푸시 열 전체가 조작 가능한가(권한 필요 칩·설정 이동 배너·토글 disabled 의 근거). */
  available: boolean;
}

/**
 * 권한과 토글 목록을 받아 푸시 열 상태를 판정한다. `inAppEnabled` 는 입력에 있으나 푸시 판정에
 * 영향을 주지 않는다(조합이 서로를 넘보지 못하게 하는 것이 PBT-U6-F2 의 요지).
 *
 * 열 가용성은 **오직 OS 권한**으로 정한다 — `GRANTED` 가 아니면(DENIED·UNDETERMINED) 절대 활성이
 * 아니다. 토글이 켜져 있어도(`pushEnabled=true`) 권한이 없으면 열은 비활성이다. (셀 ON 파생
 * `cellsOn` 은 화면이 `checked` 를 직접 파생해 소비처가 없어 TRIP-1355 에서 지웠다.)
 */
export function resolvePushColumn(
  permission: PushPermission,
  _toggles: readonly Pick<NotificationToggle, 'pushEnabled' | 'inAppEnabled'>[]
): PushColumnState {
  const available = permission === 'GRANTED';
  return { available };
}
