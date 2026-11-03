import {
  CAPTION_MAX_LENGTH,
  HASHTAG_MAX_COUNT,
  type OrderedVisit,
  type PaletteKey,
  type ShareCardVM,
  type SummaryDayCardVM,
  type SummaryMagazineVM,
  type SummaryStatCells,
} from '@/features/reflection/index.view';
import type { ShareCardCopy } from '@/shared/api/index.schemas';

/**
 * TRIP-1667 · j06 스토리 덱의 "장(slide) 목록" 만들기와 "화면에 보여 줄 문구" 정하기 — 둘 다 순수 함수.
 * 초심자용: 순수 함수 = 같은 입력이면 늘 같은 출력, 화면·네트워크를 모른다.
 *
 * 장 구성: 표지 → 일차 장면(방문지가 있는 일차만, 앞 5일차) → 동선(방문 1곳 이상, 앞 6곳) → 숫자.
 * 표지·일차·숫자는 j04 빌더(`buildSummaryMagazineVM`)·대표 카드(`ShareCardVM`)의 **같은 객체**를 싣는다 — 같은 규칙을 두 번 쓰지 않는다.
 * 소요시간 필드 없음(INV-3).
 */

/** 일차 장면 최대 장 수 — 앞 5일차. */
export const STORY_DAY_LIMIT = 5;
/** 동선 장·대표 카드 방문 순서의 최대 줄 수. */
export const SHARE_ROUTE_LIMIT = 6;

export type StorySlide =
  | { kind: 'cover'; key: 'cover'; cover: SummaryMagazineVM['cover'] }
  | { kind: 'day'; key: `day-${number}`; day: SummaryDayCardVM }
  | {
      kind: 'route';
      key: 'route';
      stops: OrderedVisit[];
      palette: PaletteKey;
    }
  | {
      kind: 'stats';
      key: 'stats';
      cells: SummaryStatCells;
      distanceNote: string | null;
    };

export function buildStorySlides(
  magazine: SummaryMagazineVM,
  card: ShareCardVM
): StorySlide[] {
  const days: StorySlide[] = magazine.days
    .filter((day) => day.places.length > 0)
    .slice(0, STORY_DAY_LIMIT)
    .map((day, i) => ({ kind: 'day', key: `day-${i + 1}`, day }));
  const route: StorySlide[] =
    card.orderedVisits.length > 0
      ? [
          {
            kind: 'route',
            key: 'route',
            stops: card.orderedVisits.slice(0, SHARE_ROUTE_LIMIT),
            palette: magazine.routePalette,
          },
        ]
      : [];

  return [
    { kind: 'cover', key: 'cover', cover: magazine.cover },
    ...days,
    ...route,
    {
      kind: 'stats',
      key: 'stats',
      cells: card.statsCells,
      distanceNote:
        magazine.stats.find((tile) => tile.key === 'distance')?.note ?? null,
    },
  ];
}

/**
 * 화면에 보여 줄 캡션(≤150자)과 해시태그 한 줄 — 우선순위: 사용자가 고친 값(빈 문자열도 그 값) > 서버 해시태그(≤10개, 공백으로 이음) > 온디바이스.
 * 서버가 약속(150자·10개)을 어겨도 여기서 앞에서 자른다.
 */
export function resolveShareText({
  copy,
  editedHashtags,
  onDeviceHashtags,
}: {
  copy: ShareCardCopy | undefined;
  editedHashtags: string | null;
  onDeviceHashtags: string;
}): { caption: string; hashtagText: string } {
  const serverTags = copy?.hashtags.slice(0, HASHTAG_MAX_COUNT) ?? [];
  return {
    caption: copy?.caption.slice(0, CAPTION_MAX_LENGTH) ?? '',
    hashtagText:
      editedHashtags ??
      (serverTags.length > 0 ? serverTags.join(' ') : onDeviceHashtags),
  };
}
