import type { Trip, TripSummary } from '@/shared/api/generated/schemas';
import { formatKoreanDate } from '@/shared/date/formatKoreanDate';

import {
  CAPTION_MAX_LENGTH,
  HASHTAG_MAX_COUNT,
  SHARE_FORMATS,
  buildShareCard,
  captureShareImage,
  validateCaption,
  validateHashtags,
} from './shareCard';
import { summaryStats } from './summaryStats';
import { distanceSourceLabel, toOrderedVisitList } from './summaryView';

/**
 * TRIP-574 · j06 공유 카드 순수 조립·검증·degrade 스텁.
 *
 * 무엇을 보장하나(계약):
 *  - AC-1: buildShareCard 가 Trip.title·기간·지역·통계·동선을 정확히 조립(summaryStats·
 *    toOrderedVisitList·distanceSourceLabel 재사용, formatKoreanDate 기간).
 *  - AC-2: mode = totalPhotos===0 ? 'no-photo' : 'default'(BR-U5-47).
 *  - AC-3: format 이 aspectRatio 를 결정한다(9:16/1:1/4:5) — 내용은 format 무관 불변.
 *  - ★ 반쪽 방어: summary null·stats/highlights 결측·trip null 계약 위반에도 크래시 0(571·572 재발 방지).
 *  - AC-8(INV-3): 직렬화한 VM 에 duration·소요시간 문자열 0(거리만).
 *  - AC-7: validateCaption/validateHashtags 는 순수(온디바이스만) — 상한 초과 시 invalid·트렁케이트.
 *  - INV-4: captureShareImage() = {armed:false}(정직한 degrade — 실 캡처는 네이티브 리빌드 후속).
 *
 * (개념) `toBeCloseTo(n, 자릿수)` = 부동소수 근사 비교 · `toEqual` = 깊은 값 동치 ·
 *   `not.toThrow()` = 호출이 예외를 안 던짐 · `JSON.stringify` 왕복 = 직렬화 표면에 금칙 문자열 0 확인
 *   (`not.toHaveProperty` 는 `{k:undefined}` 도 키 존재로 판정하는 566 함정이라 회피).
 */

const TRIP: Trip = {
  tripId: 'trip-1',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  party: 2,
  preferenceSnapshot: {},
  destinations: [
    { seq: 1, region: '부산', nights: 2 },
    { seq: 2, region: '경주', nights: 1 },
  ],
  status: 'ENDED',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-13T00:00:00Z',
};

function makeSummary(over: Partial<TripSummary> = {}): TripSummary {
  return {
    narrative: '좋은 여행이었어요',
    highlights: [
      {
        date: '2026-06-11',
        dayOrder: 1,
        visitCount: 2,
        places: ['광안리 해변', '감천문화마을'],
      },
      {
        date: '2026-06-12',
        dayOrder: 2,
        visitCount: 1,
        places: ['해운대 해변'],
      },
    ],
    stats: {
      totalVisits: 12,
      totalDistanceKm: 38,
      distanceSource: 'VISIT_LINE',
      totalPhotos: 24,
      hasLocationData: false,
    },
    source: 'RULE',
    generatedAt: '2026-06-12T10:00:00Z',
    ...over,
  };
}

const STORY = SHARE_FORMATS.find((f) => f.id === 'story')!;

describe('SHARE_FORMATS · 3포맷 shape', () => {
  it('story/square/feed 순서 · 각 aspectRatio(9:16·1:1·4:5) · 라벨 비율 문구', () => {
    expect(SHARE_FORMATS.map((f) => f.id)).toEqual(['story', 'square', 'feed']);
    expect(
      SHARE_FORMATS.find((f) => f.id === 'story')!.aspectRatio
    ).toBeCloseTo(9 / 16, 5);
    expect(
      SHARE_FORMATS.find((f) => f.id === 'square')!.aspectRatio
    ).toBeCloseTo(1, 5);
    expect(SHARE_FORMATS.find((f) => f.id === 'feed')!.aspectRatio).toBeCloseTo(
      4 / 5,
      5
    );
    expect(SHARE_FORMATS.find((f) => f.id === 'story')!.label).toMatch(/9:16/);
    expect(SHARE_FORMATS.find((f) => f.id === 'square')!.label).toMatch(/1:1/);
    expect(SHARE_FORMATS.find((f) => f.id === 'feed')!.label).toMatch(/4:5/);
  });
});

describe('🔴 AC-1 · buildShareCard 내용 조립(default)', () => {
  it('제목·기간·지역·통계·동선·워터마크·mode 를 정확히 조립한다', () => {
    const summary = makeSummary();

    const vm = buildShareCard({ summary, trip: TRIP, format: STORY });

    expect(vm.title).toBe('부산 여행');
    expect(vm.periodText).toBe(
      `${formatKoreanDate('2026-06-10')} ~ ${formatKoreanDate('2026-06-12')}`
    );
    expect(vm.regionText).toBe('부산 · 경주');
    expect(vm.statsCells).toEqual(summaryStats(summary.stats));
    expect(vm.distanceSourceLabel).toBe(distanceSourceLabel('VISIT_LINE'));
    expect(vm.orderedVisits).toEqual(toOrderedVisitList(summary.highlights));
    expect(vm.watermark).toBe('TripPilot');
    expect(vm.mode).toBe('default');
    expect(vm.aspectRatio).toBeCloseTo(9 / 16, 5);
  });
});

describe('🔴 AC-2 · no-photo 분기(BR-U5-47)', () => {
  it('totalPhotos===0 → mode "no-photo"', () => {
    const vm = buildShareCard({
      summary: makeSummary({
        stats: {
          totalVisits: 12,
          totalDistanceKm: 38,
          distanceSource: 'VISIT_LINE',
          totalPhotos: 0,
          hasLocationData: false,
        },
      }),
      trip: TRIP,
      format: STORY,
    });
    expect(vm.mode).toBe('no-photo');
  });

  it('totalPhotos>0 → mode "default"(짝)', () => {
    const vm = buildShareCard({
      summary: makeSummary(),
      trip: TRIP,
      format: STORY,
    });
    expect(vm.mode).toBe('default');
  });
});

describe('🔴 AC-3 · format 이 aspectRatio 를 정한다(내용은 format 무관)', () => {
  it.each([
    ['story', 9 / 16],
    ['square', 1],
    ['feed', 4 / 5],
  ] as const)('format %s → aspectRatio 근사 %f', (id, ratio) => {
    const format = SHARE_FORMATS.find((f) => f.id === id)!;
    const vm = buildShareCard({ summary: makeSummary(), trip: TRIP, format });
    expect(vm.aspectRatio).toBeCloseTo(ratio, 5);
    // 내용은 포맷과 무관하게 불변(제목·mode 는 그대로).
    expect(vm.title).toBe('부산 여행');
    expect(vm.mode).toBe('default');
  });
});

describe('🔴 ★ 반쪽 방어 — 계약 위반 응답에도 크래시 0', () => {
  it('summary=null 이면 안 던지고 no-photo·빈 동선·거리 대시로 접힌다', () => {
    let vm!: ReturnType<typeof buildShareCard>;
    expect(() => {
      vm = buildShareCard({ summary: null, trip: TRIP, format: STORY });
    }).not.toThrow();
    expect(vm.mode).toBe('no-photo');
    expect(vm.orderedVisits).toEqual([]);
    expect(vm.statsCells.distanceText).toBe('—');
    expect(vm.statsCells.totalVisits).toBe(0);
    expect(vm.statsCells.totalPhotos).toBe(0);
  });

  it('stats·highlights 중첩 결측(null)이어도 안 던진다', () => {
    const broken = { stats: null, highlights: null } as unknown as TripSummary;
    expect(() =>
      buildShareCard({ summary: broken, trip: TRIP, format: STORY })
    ).not.toThrow();
    const vm = buildShareCard({ summary: broken, trip: TRIP, format: STORY });
    expect(vm.orderedVisits).toEqual([]);
  });

  it('trip=null 이어도 안 던지고 제목·지역은 빈 문자열로 방어한다', () => {
    let vm!: ReturnType<typeof buildShareCard>;
    expect(() => {
      vm = buildShareCard({
        summary: makeSummary(),
        trip: null,
        format: STORY,
      });
    }).not.toThrow();
    expect(vm.title).toBe('');
    expect(vm.regionText).toBe('');
  });
});

describe('🔴 AC-8 · INV-3 — 직렬화 표면에 소요시간 0(거리만)', () => {
  it('JSON.stringify(vm) 에 duration·소요시간 문자열이 없다', () => {
    const json = JSON.stringify(
      buildShareCard({ summary: makeSummary(), trip: TRIP, format: STORY })
    );
    expect(json).not.toContain('duration');
    expect(json).not.toMatch(/(소요|\d+\s*분|\d+\s*시간)/);
  });
});

describe('🔴 AC-7 · 폼검증은 온디바이스 순수 함수(서버 저장 없음)', () => {
  it('validateCaption: 상한 이내 valid · 초과 invalid · 초과분 트렁케이트', () => {
    expect(validateCaption('a'.repeat(CAPTION_MAX_LENGTH)).valid).toBe(true);
    const over = validateCaption('a'.repeat(CAPTION_MAX_LENGTH + 5));
    expect(over.valid).toBe(false);
    expect(over.truncated.length).toBe(CAPTION_MAX_LENGTH);
  });

  it('validateHashtags: 개수 이내 valid · 초과 invalid · 초과분 트렁케이트', () => {
    expect(validateHashtags(Array(HASHTAG_MAX_COUNT).fill('#여행')).valid).toBe(
      true
    );
    const over = validateHashtags(Array(HASHTAG_MAX_COUNT + 3).fill('#여행'));
    expect(over.valid).toBe(false);
    expect(over.truncated.length).toBe(HASHTAG_MAX_COUNT);
  });
});

describe('🔴 INV-4 · captureShareImage degrade 스텁(가짜 성공 금지)', () => {
  it('armed:false 를 돌려준다(실 캡처는 네이티브 리빌드 후속)', () => {
    expect(captureShareImage()).toEqual({ armed: false });
  });
});
