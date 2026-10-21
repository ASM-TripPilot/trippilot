/**
 * TRIP-1559 · 전역 토스트 바닥 — "화면이 아래를 얼마나 막고 있나"를 모아 두는 레지스트리와 그 값으로 바닥을 정하는 순수 함수.
 *
 * 토스트 호스트는 루트에 하나뿐이라 지금 어느 화면이 보이는지 모른다. 그래서 하단 바·FAB 를 그리는 쪽(이음새)이
 * `useToastBottom` 으로 자기 윗변 높이를 신고하고, 호스트는 신고된 값 중 가장 높은 것 위에 뜬다. 상태는 모듈 스코프 값 +
 * 구독이다(Toast.tsx 와 같은 방식 · 라이브러리 0). React·내비게이션을 import 하지 않는다.
 */

/**
 * FAB 2단 스택 윗변(둘째 단 바닥 152 + 높이 56). 홈·탐색 랜딩·장소 탐색·숙소 검색 공통.
 * 출처: 각 화면 FAB 의 `bottom-[152px]` + `h-[56px]`(HomeScreen.tsx · StaySearchScreen.tsx 등 — `grep bottom-\[152px\]`).
 * jest 는 이 값을 잠그지 않는다(상수를 import 해 같은 값끼리 비교) — 그 className 을 바꾸면 이 값도 맞추고 실화면(6-b)으로 확인.
 */
export const FAB_STACK_TOP = 208;

/** 신고된 막힘 높이 위로 띄우는 간격. */
const GAP_ABOVE_BLOCKER = 12;
/** 아무것도 신고되지 않았을 때 안전영역 위로 띄우는 간격. */
const GAP_ABOVE_SAFE_AREA = 16;

/**
 * 토스트 바닥(화면 아래에서의 거리). 신고가 없으면 안전영역+16, 있으면 가장 높은 신고+12 —
 * 단 안전영역+16 아래로는 내려가지 않는다. 신고값은 이미 인셋을 포함하므로 여기서 더하지 않는다.
 */
export function resolveToastBottom(
  registered: readonly number[],
  bottomInset: number
): number {
  const floor = bottomInset + GAP_ABOVE_SAFE_AREA;
  if (registered.length === 0) return floor;
  return Math.max(Math.max(...registered) + GAP_ABOVE_BLOCKER, floor);
}

// 항목은 객체로 든다 — 같은 높이를 둘이 신고할 수 있어, 해제는 값이 아니라 항목 정체성으로 해야 남의 것을 안 지운다.
interface Entry {
  height: number;
}

let entries: Entry[] = [];
let snapshot: readonly number[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = entries.map((entry) => entry.height);
  listeners.forEach((listener) => listener());
}

/** 높이를 신고하고 해제 함수를 돌려받는다. 해제 함수는 두 번 불러도·리셋 뒤에 불러도 안전하다. */
export function registerToastBottom(height: number): () => void {
  const entry: Entry = { height };
  entries = [...entries, entry];
  publish();
  return () => {
    if (!entries.includes(entry)) return;
    entries = entries.filter((e) => e !== entry);
    publish();
  };
}

/** 바뀌지 않으면 같은 참조를 돌려준다(`useSyncExternalStore` 스냅샷 조건). */
export function getToastBottoms(): readonly number[] {
  return snapshot;
}

export function subscribeToastBottoms(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 테스트 하네스용 전부 비우기. 운영 코드의 `hideToast` 는 이걸 부르지 않는다(자동 숨김 때 화면 신고가 지워진다). */
export function resetToastBottoms(): void {
  if (entries.length === 0) return;
  entries = [];
  publish();
}
