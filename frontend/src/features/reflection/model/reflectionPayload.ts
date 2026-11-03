/**
 * 회고 카드 payload(JSON 문자열) 해석 — 장면(TRIP-1445)에 표지·해시태그·사건 출처(TRIP-1665)를 더했다.
 * 와이어 정본은 `ai/docs/openapi.json` 의 SceneSchema·CoverSchema.
 * 어디가 깨져도 던지지 않는다 — 못 읽는 장면은 빼고, 다 못 읽으면 빈 결과(화면은 subtitle 본문으로 충분하다).
 * 모르는 layout·백엔드 전용 TEXT 는 버리지 않고 `sceneKind` 로 종류만 가른다(INV-4).
 */
interface SlotRef {
  date: string;
  poiId: string;
}

export interface ReflectionScene {
  layout: string;
  caption: string;
  /** 사진 자리가 가리키는 방문(date·poi_id). 없으면 사진 자리가 아니다. */
  slot?: SlotRef;
  /** `source_event`(PLAN_B·SKIPPED …) — 값이 비지 않은 문자열일 때만 키가 생긴다. */
  sourceEvent?: string;
}

export interface ReflectionPayload {
  cover: { title?: string; subtitle?: string; slot?: SlotRef };
  /** 다듬은 해시태그 — trim·앞 '#' 제거·빈 값/중복 제거(순서 보존). '#' 는 화면이 붙인다. */
  hashtags: string[];
  scenes: ReflectionScene[];
}

export type SceneKind =
  'PHOTO' | 'STATS' | 'MAP' | 'EVENT' | 'TEXT' | 'UNKNOWN';

const str = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '';

const rec = (v: unknown): Record<string, any> =>
  typeof v === 'object' && v !== null ? (v as Record<string, any>) : {};

/** `photo_slot.visit_ref` → 방문 참조. date·poi_id 둘 다 문자열일 때만. */
function slotOf(photoSlot: unknown): SlotRef | undefined {
  const ref = rec(rec(photoSlot).visit_ref);
  return str(ref.date) && str(ref.poi_id)
    ? { date: ref.date, poiId: ref.poi_id }
    : undefined;
}

export function parseReflectionPayload(
  payload: string | undefined
): ReflectionPayload {
  let root: Record<string, any>;
  try {
    root = rec(JSON.parse(payload ?? ''));
  } catch {
    return { cover: {}, hashtags: [], scenes: [] };
  }

  const c = rec(root.cover);
  const coverSlot = slotOf(c.photo_slot);
  const cover: ReflectionPayload['cover'] = {
    ...(str(c.title) ? { title: c.title.trim() } : {}),
    ...(str(c.subtitle) ? { subtitle: c.subtitle.trim() } : {}),
    ...(coverSlot ? { slot: coverSlot } : {}),
  };

  const tags = (Array.isArray(root.hashtags) ? root.hashtags : []).flatMap(
    (t: unknown) =>
      typeof t === 'string' ? [t.trim().replace(/^#+/, '').trim()] : []
  );
  const hashtags = [...new Set(tags.filter((t: string) => t !== ''))];

  const scenes = (Array.isArray(root.scenes) ? root.scenes : []).flatMap(
    (s: unknown): ReflectionScene[] => {
      const o = rec(s);
      if (!str(o.layout) || !str(o.caption)) return [];
      const slot = slotOf(o.photo_slot);
      return [
        {
          layout: o.layout,
          caption: o.caption.trim(),
          ...(slot ? { slot } : {}),
          ...(str(o.source_event) ? { sourceEvent: o.source_event } : {}),
        },
      ];
    }
  );

  return { cover, hashtags, scenes };
}

/** layout 문자열 → 종류. 닫힌 목록 밖은 UNKNOWN(버리지 않고 중립 카드로 그린다). */
export function sceneKind(layout: string): SceneKind {
  switch (layout) {
    case 'PHOTO_FULL':
    case 'PHOTO_CAPTION':
      return 'PHOTO';
    case 'STATS':
    case 'MAP':
    case 'EVENT':
    case 'TEXT':
      return layout;
    default:
      return 'UNKNOWN';
  }
}

/** 그날·그 장소의 이 기기 사진 주소. 못 구하면 undefined — 렌더러가 카테고리 그림으로 채운다(빈 칸 금지). */
export function devicePhotoUri(
  slot: SlotRef | undefined,
  date: string,
  photos: readonly { uri: string; poiId: string }[]
): string | undefined {
  if (slot?.date !== date) return undefined;
  return photos.find((p) => p.poiId === slot.poiId)?.uri;
}

/** 사진 장면인데 이 기기에서 사진을 못 구하면 undefined. */
export function slotUri(
  scene: ReflectionScene,
  date: string,
  photos: readonly { uri: string; poiId: string }[]
): string | undefined {
  if (sceneKind(scene.layout) !== 'PHOTO') return undefined;
  return devicePhotoUri(scene.slot, date, photos);
}
