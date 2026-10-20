import type { AutomationNotice } from './store';

/**
 * TRIP-1339 · i01 안내 1줄 카피(FD §11 폴백 표 · Figma u10c 4857:3012 — 제목 줄 + 사유 줄 + `설정 열기`).
 * 강등은 오류가 아니라 정상 경로라 경고 화면·재시도 유도를 하지 않는다(BR-U10-06). 여행 구간 끝은 안내하지 않는다.
 */
export interface AutomationNoticeCopy {
  title: string;
  detail: string;
  /** `설정 열기` 링크를 그릴지. */
  settings: boolean;
}

const DEGRADE_DETAIL: Record<string, string> = {
  'when-in-use': "위치 권한이 '사용하는 동안'으로 바뀌었어요",
  'background-blocked': "위치 권한이 '사용하는 동안'으로 바뀌었어요",
  'no-permission': '위치 권한이 꺼졌어요',
  approximate: '정확한 위치가 꺼져 있어요',
  'consent-off': '위치정보 동의가 꺼졌어요',
  'consent-rejected': '위치정보 동의가 꺼졌어요',
  'native-register-failed': '기기에서 자동 기록을 시작하지 못했어요',
  'server-disabled': '지금은 자동 기록을 쓸 수 없어요',
};

const NO_SETTINGS = new Set([
  'consent-off',
  'consent-rejected',
  'server-disabled',
]);

export function automationNoticeCopy(
  notice: AutomationNotice | null,
  droppedCount: number
): AutomationNoticeCopy | null {
  if (notice?.kind === 'degraded') {
    const detail = DEGRADE_DETAIL[notice.reason];
    if (detail) {
      return {
        title: '자동 기록이 꺼졌어요',
        detail,
        settings: !NO_SETTINGS.has(notice.reason),
      };
    }
  }
  if (notice?.kind === 'route-expired') {
    return {
      title: '이동 경로 일부를 올리지 못했어요',
      detail: '그날 거리는 방문 장소를 이은 근사로 보여요',
      settings: false,
    };
  }
  if (droppedCount > 0) {
    return {
      title: `보내지 못한 자동 기록 ${droppedCount}건`,
      detail: '방문 기록에서 직접 남겨 주세요',
      settings: false,
    };
  }
  return null;
}

/** TRIP-1486 · i01 스위치 줄 카피(Figma u10f) — 제목은 고정, 부제만 켜짐/일시 중지로 갈린다. */
export function automationSwitchCopy(paused: boolean): {
  title: string;
  detail: string;
} {
  return {
    title: '자동 기록',
    detail: paused
      ? '일시 중지했어요 · [도착]으로 직접 남겨요'
      : '여행 날짜 동안 방문과 다닌 길을 기록해요',
  };
}

/** 'YYYY-MM-DD' 두 개 → `10월 14일~16일` / `10월 30일~11월 2일` / 하루면 `10월 14일`. */
export function tripDateRangeLabel(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  const head = `${sm}월 ${sd}일`;
  if (start === end) return head;
  return sm === em ? `${head}~${ed}일` : `${head}~${em}월 ${ed}일`;
}
