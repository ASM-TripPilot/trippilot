import type { ReflectionStats, VisitCheck } from '@/shared/api/index.schemas';

import { paletteKeyForCategory, type PaletteKey } from './categoryPalette';
import { formatKm } from './formatKm';
import {
  devicePhotoUri,
  parseReflectionPayload,
  sceneKind,
} from './reflectionPayload';
import { distanceSourceLabel } from './summaryView';

/**
 * TRIP-1665 · j03 회고 매거진 VM — 서버 응답·방문·일정 재료를 "화면이 계산 없이 그대로 그릴 값"으로 바꾸는 순수 함수.
 * 초심자용: VM(뷰 모델) = 화면 전용으로 미리 계산해 둔 값 묶음. 색은 hex 가 아니라 팔레트 **키**로 담는다.
 *
 * 규칙(테스트가 곧 명세): 동선은 건너뜀 제외·도착 시각 순, 이름은 일정 슬롯 → 즉석 이름 → "N번째 장소"(지어내지 않음,
 * BR-U5-31). 표지 색은 PLAN_B 띠 → 방문 카테고리 최빈(동률은 먼저 간 곳) → 중립. TEXT 장면은 카드에서 빠지고
 * (동선이 대신), EVENT+PLAN_B/SKIPPED 는 번호 없는 띠. 사진은 이 기기 사진에서만(서버엔 URL 이 없다). 소요시간 필드 없음(INV-3).
 * `@/shared/api` 는 타입만 import — 프리뷰가 네트워크 계층을 끌어오지 않게.
 */

export type MagazineVisit = Pick<
  VisitCheck,
  'poiId' | 'arrivedAt' | 'skippedAt'
>;
export interface MagazineSlot {
  poiId: string;
  nameKo?: string | null;
  category?: string | null;
}
export interface MagazineInput {
  date: string;
  isToday: boolean;
  title: string;
  region?: string;
  /** 표시본 — 빌더가 다시 고르지 않는다. */
  narrative: string;
  stats: ReflectionStats;
  distanceDash: boolean;
  payload: string | undefined;
  visits: readonly MagazineVisit[];
  /** undefined = 일정을 아직 모름(동선 박스를 그리지 않는다). */
  slots: readonly MagazineSlot[] | undefined;
  spontaneousNames: Readonly<Record<string, string>>;
  photos: readonly { uri: string; poiId: string }[];
}

/** PlacePhoto 에 그대로 넘긴다: uri 가 있으면 기기 사진, 없으면 카테고리 그림. */
export interface MagazinePicture {
  uri?: string;
  category?: string;
  poiId?: string;
}
export interface MagazineVM {
  cover: {
    title: string;
    stickerLabel: string;
    region?: string;
    dateLabel: string;
    visitLabel: string;
    photoLabel: string;
    picture: MagazinePicture | null;
    palette: PaletteKey;
  };
  quote: { text: string; head: string; mark: string };
  scenes: {
    key: string;
    number: string;
    photoSide: 'left' | 'right';
    caption: string;
    placeName?: string;
    picture: MagazinePicture | null;
    palette: PaletteKey;
  }[];
  planChanges: {
    event: 'PLAN_B' | 'SKIPPED';
    caption: string;
    palette: PaletteKey;
  }[];
  /** [] = 그날 방문 0곳, null = 이름을 아직 모름. */
  route:
    { order: number; name: string; named: boolean; category?: string }[] | null;
  stats: {
    key: 'visits' | 'distance' | 'photos';
    label: string;
    value: string;
    note?: string;
  }[];
  hashtags: string[];
}

const text = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '';

/** 인용문의 마지막 쉼표 뒤 구를 형광펜 구간으로. 쉼표가 없거나 뒤가 비면 전체(Q11). */
export function splitHighlight(text: string): { head: string; mark: string } {
  const comma = text.lastIndexOf(',');
  const tail = comma < 0 ? '' : text.slice(comma + 1).replace(/^\s+/, '');
  return tail === ''
    ? { head: '', mark: text }
    : { head: text.slice(0, text.length - tail.length), mark: tail };
}

export function buildMagazineVM(input: MagazineInput): MagazineVM {
  const { date, stats, photos } = input;
  const payload = parseReflectionPayload(input.payload);
  // Map 이라 poiId 가 'toString' 같은 프로토타입 이름이어도 안전하다. 같은 poiId 가 둘이면 먼저 나온 슬롯.
  const slotOf = new Map<string, MagazineSlot>();
  for (const s of input.slots ?? [])
    if (!slotOf.has(s.poiId)) slotOf.set(s.poiId, s);

  const nameOf = (poiId: string): string | undefined => {
    const fromSlot = slotOf.get(poiId)?.nameKo;
    if (text(fromSlot)) return fromSlot;
    const own = Object.prototype.hasOwnProperty.call(
      input.spontaneousNames,
      poiId
    )
      ? input.spontaneousNames[poiId]
      : undefined;
    return text(own) ? own : undefined;
  };
  const categoryOf = (poiId: string): string | undefined => {
    const category = slotOf.get(poiId)?.category;
    return text(category) ? category : undefined;
  };

  // 동선 — 건너뜀 제외, 도착 시각 오름차순(시각 없는 것은 뒤, 같으면 입력 순서).
  const kept = input.visits
    .map((v, index) => ({ v, index, at: Date.parse(v.arrivedAt ?? '') }))
    .filter(({ v }) => !v.skippedAt)
    .sort((a, b) => {
      const aHas = !Number.isNaN(a.at);
      const bHas = !Number.isNaN(b.at);
      if (aHas && bHas && a.at !== b.at) return a.at - b.at;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.index - b.index;
    });
  const route: MagazineVM['route'] =
    kept.length === 0
      ? []
      : input.slots === undefined
        ? null
        : kept.map(({ v }, i) => {
            const name = nameOf(v.poiId);
            const category = categoryOf(v.poiId);
            return {
              order: i + 1,
              name: name ?? `${i + 1}번째 장소`,
              named: name !== undefined,
              ...(category ? { category } : {}),
            };
          });

  const pictureOf = (
    slot: { date: string; poiId: string } | undefined
  ): MagazinePicture | null => {
    if (!slot) return null;
    const uri = devicePhotoUri(slot, date, photos);
    const category = categoryOf(slot.poiId);
    return {
      poiId: slot.poiId,
      ...(uri ? { uri } : {}),
      ...(category ? { category } : {}),
    };
  };

  // 장면 — TEXT 는 카드에서 뺀다, EVENT+PLAN_B/SKIPPED 는 띠, 나머지(모르는 layout 포함)는 번호 카드.
  const scenes: MagazineVM['scenes'] = [];
  const planChanges: MagazineVM['planChanges'] = [];
  payload.scenes.forEach((scene, index) => {
    const kind = sceneKind(scene.layout);
    if (kind === 'TEXT') return;
    if (
      kind === 'EVENT' &&
      (scene.sourceEvent === 'PLAN_B' || scene.sourceEvent === 'SKIPPED')
    ) {
      planChanges.push({
        event: scene.sourceEvent,
        caption: scene.caption,
        palette: scene.sourceEvent,
      });
      return;
    }
    const slot = kind === 'PHOTO' ? scene.slot : undefined;
    const n = scenes.length + 1;
    scenes.push({
      key: `scene-${index}`,
      number: String(n).padStart(2, '0'),
      photoSide: n % 2 === 1 ? 'left' : 'right',
      caption: scene.caption,
      ...(slot && nameOf(slot.poiId) ? { placeName: nameOf(slot.poiId) } : {}),
      picture: pictureOf(slot),
      palette:
        slot && slotOf.has(slot.poiId)
          ? paletteKeyForCategory(categoryOf(slot.poiId))
          : 'STATS',
    });
  });

  // 표지 색 — PLAN_B 띠 → 방문 카테고리 최빈(미술+문화 한 통, 모르는 카테고리는 안 센다, 동률은 먼저 간 곳) → 중립.
  const counts = new Map<PaletteKey, number>();
  for (const stop of route ?? []) {
    const key = paletteKeyForCategory(stop.category);
    if (key !== 'STATS') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let dominant: PaletteKey = 'STATS';
  let best = 0;
  for (const [key, count] of counts)
    if (count > best) [dominant, best] = [key, count];
  const coverPalette: PaletteKey = planChanges.some((c) => c.event === 'PLAN_B')
    ? 'PLAN_B'
    : dominant;

  return {
    cover: {
      title: input.title,
      stickerLabel: input.isToday ? '오늘의 회고' : '하루 회고',
      region: input.region,
      dateLabel: date.replace(/-/g, '.'),
      visitLabel: `${stats.visitCount}곳`,
      photoLabel: `사진 ${stats.photoCount}장`,
      picture: pictureOf(payload.cover.slot),
      palette: coverPalette,
    },
    quote: { text: input.narrative, ...splitHighlight(input.narrative) },
    scenes,
    planChanges,
    route,
    stats: [
      { key: 'visits', label: '방문', value: String(stats.visitCount) },
      {
        key: 'distance',
        label: '이동',
        value: input.distanceDash ? '—' : formatKm(stats.distanceKm),
        ...(input.distanceDash
          ? {}
          : { note: distanceSourceLabel(stats.distanceSource) }),
      },
      { key: 'photos', label: '사진', value: String(stats.photoCount) },
    ],
    hashtags: payload.hashtags,
  };
}
