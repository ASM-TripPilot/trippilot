/**
 * TRIP-1013 연타 관통 공용 가드 — 모듈 전역 400ms 창.
 * 창은 화면을 건너가야 하므로(첫 탭 화면 → 바뀐 화면의 다른 버튼) 감싼 함수마다가 아니라 모듈에 하나다.
 * 타이머로 닫지 않고 `Date.now()` 비교로 판정한다(pages 층 타이머 금지 · 페이지 테스트가 `Date.now`를 멈춘다).
 */

const WINDOW_MS = 400;

let openedAt = -Infinity;

/** 콜백을 감싼다. 창(400ms)이 열려 있으면 무시하고, 아니면 창을 열고 원래 콜백을 부른다. */
export function guardPress<Args extends unknown[]>(
  handler: (...args: Args) => void
): (...args: Args) => void {
  return (...args) => {
    // 무시된 누름은 창을 늘리지 않는다 — 연타를 계속해도 400ms 뒤엔 누를 수 있어야 한다.
    // 음수 경과(기기 시계가 뒤로 감)는 창 밖으로 본다 — 아니면 뒤로 간 만큼 먹통이 된다(5-b 경고-1).
    const elapsed = Date.now() - openedAt;
    if (elapsed >= 0 && elapsed < WINDOW_MS) return;
    openPressGuardWindow();
    handler(...args);
  };
}

/** 누름 없이 창을 연다 — 서버 응답으로 표면이 바뀌는 순간에 부른다(01b Q2). */
export function openPressGuardWindow(): void {
  openedAt = Date.now();
}

/** 테스트 전용 — 창을 닫는다(=400ms 이상 흐른 것과 같다). */
export function resetPressGuard(): void {
  openedAt = -Infinity;
}
