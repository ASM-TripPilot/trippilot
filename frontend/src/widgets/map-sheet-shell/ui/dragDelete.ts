/**
 * TRIP-1246 · 편집기 끌기 — 삭제 영역 판정(순수 함수, jest 로 심판).
 *
 * 삭제 영역은 리스트 밖 시트 하단에 고정돼(Figma `4195:2468` DeleteDropArea) 끌기 중에만 뜬다. 놓은 카드가
 * 삭제인지 재정렬인지는 "끌던 카드가 그 영역 위에 있었나"(`overZone`)로 가르고, 리스트 index 는 안 본다.
 * 위치 계산(`isOverDeleteZone`)은 UI 스레드 반응식에서도 불려서 `'worklet'` 이다.
 */

/** 삭제 영역 바 높이 — Figma cta 프레임 84 = 위 12 + 영역 56 + 아래 16. 하단 안전 영역은 따로 더한다. */
export const DELETE_ZONE_BAR_HEIGHT = 84;

export interface HoverGeometry {
  /** 끌던 카드 윗변(스크롤 내용 좌표 — 라이브러리 hoverOffset). */
  hoverTop: number;
  /** 바깥 스크롤 오프셋. */
  scrollOffset: number;
  /** 끌던 카드 높이. */
  cardSize: number;
  /** 스크롤 영역(시트 본문) 높이. */
  viewportHeight: number;
  bottomInset: number;
}

/** 끌던 카드의 가운데가 하단 삭제 영역 안에 들어왔는가. 뷰포트 높이를 아직 모르면(0) 거짓. */
export function isOverDeleteZone(g: HoverGeometry): boolean {
  'worklet';
  if (g.viewportHeight <= 0 || g.cardSize <= 0) return false;
  const center = g.hoverTop - g.scrollOffset + g.cardSize / 2;
  const zoneTop = g.viewportHeight - DELETE_ZONE_BAR_HEIGHT - g.bottomInset;
  return center >= zoneTop;
}

export type DragDecision<T> =
  | { kind: 'none' }
  | { kind: 'delete'; moved: T }
  | { kind: 'reorder'; slots: T[] };

/** 놓은 뒤 할 일. 고정·방문 완료 카드는 영역 위에 놓여도 아무 일도 안 한다(심층 방어 — 스토어 삭제는 고정을 안 본다). */
export function decideDragEnd<T>(params: {
  /** 라이브러리가 건넨 새 순서 배열. */
  data: T[];
  /** 놓인 칸 index(`DragEndParams.to`). */
  to: number;
  overZone: boolean;
  isPinned: (slot: T) => boolean;
}): DragDecision<T> {
  const moved = params.data[params.to];
  if (moved === undefined || params.isPinned(moved)) return { kind: 'none' };
  if (params.overZone) return { kind: 'delete', moved };
  return { kind: 'reorder', slots: params.data };
}
