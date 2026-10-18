/**
 * TRIP-1445 · AI 회고 카드의 장면(`payload.scenes`) 해석. 와이어 정본은 `ai/docs/openapi.json` 의 SceneSchema.
 * 어디가 깨져도 던지지 않는다 — 못 읽는 장면은 빼고, 다 못 읽으면 빈 배열(화면은 subtitle 본문으로 충분하다).
 */
export interface ReflectionScene {
  layout: string;
  caption: string;
  /** 사진 자리가 가리키는 방문(date·poi_id). 없으면 사진 자리가 아니다. */
  slot?: { date: string; poiId: string };
}

const PHOTO_LAYOUTS = ['PHOTO_FULL', 'PHOTO_CAPTION'];

const str = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '';

export function parseScenes(payload: string | undefined): ReflectionScene[] {
  let root: unknown;
  try {
    root = JSON.parse(payload ?? '');
  } catch {
    return [];
  }
  const scenes = (root as { scenes?: unknown } | null)?.scenes;
  if (!Array.isArray(scenes)) return [];
  return scenes.flatMap((s: Record<string, any> | null) => {
    if (!str(s?.layout) || !str(s?.caption)) return [];
    const ref = s?.photo_slot?.visit_ref;
    return [
      {
        layout: s.layout,
        caption: s.caption.trim(),
        ...(str(ref?.date) && str(ref?.poi_id)
          ? { slot: { date: ref.date, poiId: ref.poi_id } }
          : {}),
      },
    ];
  });
}

/** 사진 장면인데 이 기기에서 사진을 못 구하면 undefined — 렌더러가 캡션만 그린다(빈 사진 칸 금지). */
export function slotUri(
  scene: ReflectionScene,
  date: string,
  photos: readonly { uri: string; poiId: string }[]
): string | undefined {
  if (!PHOTO_LAYOUTS.includes(scene.layout) || scene.slot?.date !== date)
    return undefined;
  return photos.find((p) => p.poiId === scene.slot?.poiId)?.uri;
}
