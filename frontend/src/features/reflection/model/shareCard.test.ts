import type { Trip, TripSummary } from '@/shared/api/generated/schemas';

import {
  CAPTION_MAX_LENGTH,
  HASHTAG_MAX_COUNT,
  SHARE_FORMATS,
  buildShareCard,
  captureShareImage,
  formatShareCardStats,
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
 *    toOrderedVisitList·distanceSourceLabel 재사용). **TRIP-766**: 기간은 신규 formatShareCardPeriod
 *    (YYYY.MM.DD 얼굴별)로, 지역은 단일 primary 로 바뀐다(구 formatKoreanDate 조립·다중 join 폐기).
 *  - AC-2: mode = totalPhotos===0 ? 'no-photo' : 'default'(BR-U5-47) + 얼굴별 기간 wiring.
 *  - AC-3(TRIP-766): formatShareCardStats 가 얼굴별 통계 포맷(A/B)을 값 인터폴레이션으로 낸다(통일 금지).
 *  - 포맷↔aspectRatio: format 이 aspectRatio 를 결정(9:16/1:1/4:5) — 내용은 format 무관 불변.
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
  it('제목·기간(YYYY.MM.DD 얼굴별)·지역(단일 primary)·통계·동선·워터마크·mode 를 조립한다', () => {
    const summary = makeSummary();

    const vm = buildShareCard({ summary, trip: TRIP, format: STORY });

    expect(vm.title).toBe('부산 여행');
    // TRIP-766: 기간은 신규 YYYY.MM.DD 얼굴별 포맷(default = 물결표·nights 없음). 구 formatKoreanDate 조립 폐기.
    expect(vm.periodText).toBe('2026.06.10 ~ 06.12');
    // TRIP-766: 지역은 단일 primary(구 다중 목적지 join '부산 · 경주' 폐기, Seed 3-a D).
    expect(vm.regionText).toBe('부산');
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

  it('🔴 얼굴별 기간 wiring — no-photo 는 "N박 M일 · … –", default 는 "… ~" (통일 금지)', () => {
    // no-photo(사진 0) → en dash + nights 접두.
    const noPhoto = buildShareCard({
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
    expect(noPhoto.periodText).toBe('2박 3일 · 2026.06.10 – 06.12');

    // default(사진 24) → 물결표·nights 없음(같은 날짜, 얼굴만 다름).
    const def = buildShareCard({
      summary: makeSummary(),
      trip: TRIP,
      format: STORY,
    });
    expect(def.periodText).toBe('2026.06.10 ~ 06.12');
  });
});

describe('🔴 AC-3 · formatShareCardStats — 얼굴별 통계 포맷(값 인터폴레이션·통일 금지)', () => {
  it('default(포맷 A): "N곳 · Nkm · 사진 N장"', () => {
    expect(
      formatShareCardStats(
        { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
        'default'
      )
    ).toBe('12곳 · 38km · 사진 24장');
  });

  it('no-photo(포맷 B): "방문 N · 이동 Nkm · 사진 N"', () => {
    expect(
      formatShareCardStats(
        { totalVisits: 12, distanceText: '38km', totalPhotos: 0 },
        'no-photo'
      )
    ).toBe('방문 12 · 이동 38km · 사진 0');
  });

  it('값 인터폴레이션 — 다른 셀이면 문자열도 바뀐다(하드코딩 리터럴 아님)', () => {
    expect(
      formatShareCardStats(
        { totalVisits: 7, distanceText: '5km', totalPhotos: 3 },
        'default'
      )
    ).toBe('7곳 · 5km · 사진 3장');
    expect(
      formatShareCardStats(
        { totalVisits: 20, distanceText: '22km', totalPhotos: 9 },
        'no-photo'
      )
    ).toBe('방문 20 · 이동 22km · 사진 9');
  });

  it('INV-3 — 두 얼굴 출력에 소요시간 문자열이 없다(거리·개수만)', () => {
    const a = formatShareCardStats(
      { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
      'default'
    );
    const b = formatShareCardStats(
      { totalVisits: 12, distanceText: '38km', totalPhotos: 0 },
      'no-photo'
    );
    expect(a).not.toMatch(/(소요|\d+\s*분|\d+\s*시간)/);
    expect(b).not.toMatch(/(소요|\d+\s*분|\d+\s*시간)/);
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
