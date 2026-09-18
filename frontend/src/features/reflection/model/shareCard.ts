import type { Trip, TripSummary } from '@/shared/api/generated/schemas';
import { formatKoreanDate } from '@/shared/date/formatKoreanDate';

import { summaryStats, type SummaryStatCells } from './summaryStats';
import {
  distanceSourceLabel,
  toOrderedVisitList,
  type OrderedVisit,
} from './summaryView';

/**
 * TRIP-574 · j06 공유 카드 — 순수 조립·온디바이스 검증·정직한 degrade 스텁.
 *
 * 무엇을 보장하나(계약):
 *  - AC-1(BR-U5-46): buildShareCard 가 Trip.title·기간·지역·통계·동선을 정확히 조립한다 —
 *    summaryStats·toOrderedVisitList·distanceSourceLabel(j04 재사용)·formatKoreanDate(기간) 재사용,
 *    새 룰을 발명하지 않는다.
 *  - AC-2(BR-U5-47): mode = totalPhotos===0 ? 'no-photo' : 'default'(결측이면 0 취급 → no-photo).
 *  - AC-3(US-REC-13): format 이 aspectRatio 를 정한다(9:16·1:1·4:5) — 내용은 format 무관 불변.
 *  - ★ 반쪽 방어: summary null·stats/highlights 중첩 결측·trip null 계약 위반에도 크래시 0
 *    (571·572 재발 방지 — 상위만 막지 않고 중첩 접근 전 방어). `??` 는 null/undefined 만 대체.
 *  - AC-8(INV-3): VM 어디에도 이동 시간 필드·문자열이 없다(거리만).
 *  - AC-7(§7): validateCaption/validateHashtags 는 순수(온디바이스만) — 상한 초과 시 invalid·트렁케이트.
 *  - INV-4: captureShareImage() = {armed:false} — 네이티브 캡처 미장전을 정직하게 알린다(가짜 성공 금지).
 *    실 캡처·기기 저장·OS 공유는 네이티브 리빌드 동반 후속(view-shot·media-library·sharing·file-system
 *    미설치) — 이 파일은 그 모듈들을 import 조차 안 한다(pickPhotoAsset·geofence degrade 선례 동형).
 */

export interface ShareFormat {
  id: 'story' | 'square' | 'feed';
  label: string;
  aspectRatio: number;
}

/** 공유 포맷 3종 — id 순서 고정(story→square→feed), aspectRatio 가 카드 프리뷰 종횡비를 정한다. */
export const SHARE_FORMATS: ShareFormat[] = [
  { id: 'story', label: '스토리 9:16', aspectRatio: 9 / 16 },
  { id: 'square', label: '정방형 1:1', aspectRatio: 1 },
  { id: 'feed', label: '피드 4:5', aspectRatio: 4 / 5 },
];

export type ShareCardMode = 'default' | 'no-photo';

export interface ShareCardVM {
  title: string;
  periodText: string;
  regionText: string;
  statsCells: SummaryStatCells;
  distanceSourceLabel: string;
  orderedVisits: OrderedVisit[];
  mode: ShareCardMode;
  watermark: string;
  aspectRatio: number;
}

export interface BuildShareCardInput {
  summary: TripSummary | null | undefined;
  trip: Trip | null | undefined;
  format: ShareFormat;
}

/**
 * 카드 뷰모델 조립. 계약 위반 응답(summary·trip null, stats/highlights 결측)에도 던지지 않는다 —
 * 중첩 접근 전에 방어하고 없는 값은 빈 문자열·빈 배열·no-photo 로 접는다.
 */
export function buildShareCard({
  summary,
  trip,
  format,
}: BuildShareCardInput): ShareCardVM {
  const stats = summary?.stats;
  const totalPhotos = stats?.totalPhotos ?? 0;

  return {
    title: trip?.title ?? '',
    periodText:
      trip?.startDate && trip?.endDate
        ? `${formatKoreanDate(trip.startDate)} ~ ${formatKoreanDate(trip.endDate)}`
        : '',
    regionText: (trip?.destinations ?? [])
      .map((dest) => dest.region)
      .join(' · '),
    statsCells: summaryStats(stats),
    distanceSourceLabel: distanceSourceLabel(
      stats?.distanceSource ?? 'VISIT_LINE'
    ),
    orderedVisits: toOrderedVisitList(summary?.highlights ?? []),
    mode: totalPhotos === 0 ? 'no-photo' : 'default',
    watermark: 'TripPilot',
    aspectRatio: format.aspectRatio,
  };
}

/** 캡션 최대 글자수 — 온디바이스 검증 상한(서버 저장 없음, §7). */
export const CAPTION_MAX_LENGTH = 150;
/** 해시태그 최대 개수 — 온디바이스 검증 상한(서버 저장 없음, §7). */
export const HASHTAG_MAX_COUNT = 10;

/** 캡션 온디바이스 검증 — 상한 초과면 invalid, 초과분은 잘라 돌려준다(서버 호출 0). */
export function validateCaption(text: string): {
  valid: boolean;
  length: number;
  truncated: string;
} {
  const length = text.length;
  return {
    valid: length <= CAPTION_MAX_LENGTH,
    length,
    truncated: text.slice(0, CAPTION_MAX_LENGTH),
  };
}

/** 해시태그 온디바이스 검증 — 개수 초과면 invalid, 초과분은 잘라 돌려준다(서버 호출 0). */
export function validateHashtags(tags: string[]): {
  valid: boolean;
  count: number;
  truncated: string[];
} {
  return {
    valid: tags.length <= HASHTAG_MAX_COUNT,
    count: tags.length,
    truncated: tags.slice(0, HASHTAG_MAX_COUNT),
  };
}

/**
 * ponytail: 온디바이스 캡처 degrade 스텁 — 네이티브 모듈을 안 물고 항상 armed:false 를 돌려준다.
 *   실 캡처(View→PNG)·기기 저장·OS 공유는 네이티브 리빌드(prebuild/run) 동반 후속 티켓 몫
 *   (pickPhotoAsset·registerGeofences 선례 동형).
 */
export function captureShareImage(): { armed: false } {
  return { armed: false };
}
