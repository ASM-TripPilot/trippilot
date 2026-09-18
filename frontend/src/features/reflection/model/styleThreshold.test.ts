import fc from 'fast-check';

import type {
  CategoryShare,
  StyleAnalysisBody,
  StyleAnalysisEnvelope,
} from '@/shared/api/generated/schemas';

import { categoryLabel, resolveStyleFace } from './styleThreshold';

/**
 * TRIP-573 · j05 여행 스타일 — 임계/승격 판정 순수 함수 단위 + PBT.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-1 · PBT-U5-F4(CI 차단 게이트)**: `resolveStyleFace` 는 임의의 envelope 에 대해
 *    `official===false` 면 `progress.current>=required`(9↔10 경계 포함)여도 **항상 임시**(자체 승격 합성 0),
 *    `official===true && analysis!=null` 일 때만 정식이다. 승격 권위는 **서버 official 플래그**이지
 *    클라의 current/required 비교가 아니다(브리프 §계약 nuance).
 *  - 🔴 **[[반쪽 방어]]**: envelope·progress·analysis 중첩 결측(null/undefined)에도 크래시 0·never promote.
 *  - 🔴 **AC-2 지원**: `categoryLabel` 은 표시 라벨만 입힌다(집계는 서버 isOther) — `맛집→미식`, isOther→`기타`,
 *    나머지 코드는 항등(O-U5-7 결정).
 *
 * (개념) fast-check: `fc.property(arb, pred)` 는 "임의 입력 arb 마다 pred 가 참"을 명제로 만들고,
 *   `fc.assert(명제, {numRuns})` 가 표본으로 반례를 찾는다(있으면 최소 반례로 축소해 던진다).
 *   `fc.record`=중첩 객체, `fc.constantFrom`=리터럴 택1, `fc.option(arb,{nil})`=nullable, `fc.integer({min,max})`.
 *   (`resolveBootstrapDestination.test.ts` 선례 형태 계승.)
 */

const FACES = ['official', 'insufficient'] as const;

/** 정식 본문 arb — 내용은 판정과 무관하나(존재만 봄) 타입 정합을 위해 최소 형태를 만든다. */
const analysisBodyArb: fc.Arbitrary<StyleAnalysisBody> = fc.record({
  descriptors: fc.array(fc.string()),
  traitGauges: fc.record({
    easygoing: fc.integer({ min: 0, max: 5 }),
    foodAffinity: fc.integer({ min: 0, max: 5 }),
    activeness: fc.integer({ min: 0, max: 5 }),
  }),
  categoryBreakdown: fc.array(
    fc.record({
      category: fc.constantFrom('맛집', '카페', '자연', '명소'),
      ratio: fc.double({ min: 0, max: 1, noNaN: true }),
      isOther: fc.boolean(),
    })
  ),
  avgPlacesPerDay: fc.integer({ min: 0, max: 10 }),
  avgRadiusKm: fc.double({ min: 0, max: 20, noNaN: true }),
  avgDwellMinutes: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
  sampleTripCount: fc.integer({ min: 0, max: 50 }),
  updatedAt: fc.constant('2026-08-28T09:00:00Z'),
});

/** 임의 envelope — official boolean · current 0~20 · required 10 · analysis/preview nullable. */
const envelopeArb: fc.Arbitrary<StyleAnalysisEnvelope> = fc.record({
  official: fc.boolean(),
  progress: fc.record({
    current: fc.integer({ min: 0, max: 20 }),
    required: fc.constant(10),
  }),
  analysis: fc.option(analysisBodyArb, { nil: null }),
  preview: fc.option(fc.record({ descriptors: fc.array(fc.string()) }), {
    nil: null,
  }),
});

describe('🔴 resolveStyleFace — AC-1 · PBT-U5-F4(승격 불변식, CI 차단)', () => {
  it('임의 입력에 대해 항상 두 얼굴 중 하나를 반환하고 결정적이다(부수효과 없음)', () => {
    fc.assert(
      fc.property(envelopeArb, (envelope) => {
        const first = resolveStyleFace(envelope);
        const second = resolveStyleFace(envelope);
        expect(FACES).toContain(first);
        expect(second).toBe(first);
      }),
      { numRuns: 500 }
    );
  });

  it('불변식: official=false 면 current>=required(경계 포함)여도 항상 insufficient — 자체 승격 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.option(analysisBodyArb, { nil: null }),
        (current, analysis) => {
          const envelope: StyleAnalysisEnvelope = {
            official: false,
            progress: { current, required: 10 },
            analysis,
            preview: null,
          };
          // current 가 10~20(>=required)이고 analysis 가 차 있어도 승격 금지.
          expect(resolveStyleFace(envelope)).toBe('insufficient');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('불변식: official=true && analysis!=null 이면 current 와 무관하게 항상 official', () => {
    fc.assert(
      fc.property(
        analysisBodyArb,
        fc.integer({ min: 0, max: 20 }),
        (analysis, current) => {
          const envelope: StyleAnalysisEnvelope = {
            official: true,
            progress: { current, required: 10 },
            analysis,
            preview: null,
          };
          expect(resolveStyleFace(envelope)).toBe('official');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('불변식: official=true 여도 analysis 가 없으면 insufficient(못 그린다)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (current) => {
        const envelope: StyleAnalysisEnvelope = {
          official: true,
          progress: { current, required: 10 },
          analysis: null,
          preview: { descriptors: ['느긋'] },
        };
        expect(resolveStyleFace(envelope)).toBe('insufficient');
      }),
      { numRuns: 200 }
    );
  });
});

describe('🔴 resolveStyleFace — 9↔10 경계 예제(승격은 official 이 몬다, current 가 아님)', () => {
  it.each([9, 10])(
    'current=%i · official=false + analysis 있음 → insufficient(경계값이 승격 못 함)',
    (current) => {
      const envelope: StyleAnalysisEnvelope = {
        official: false,
        progress: { current, required: 10 },
        analysis: {
          descriptors: [],
          traitGauges: { easygoing: 3, foodAffinity: 3, activeness: 3 },
          categoryBreakdown: [],
          avgPlacesPerDay: 4,
          avgRadiusKm: 1.2,
          avgDwellMinutes: 72,
          sampleTripCount: 3,
          updatedAt: '2026-08-28T09:00:00Z',
        },
        preview: null,
      };
      expect(resolveStyleFace(envelope)).toBe('insufficient');
    }
  );

  it.each([9, 10])(
    'current=%i · official=true + analysis 있음 → official(current 값 무관)',
    (current) => {
      const envelope: StyleAnalysisEnvelope = {
        official: true,
        progress: { current, required: 10 },
        analysis: {
          descriptors: [],
          traitGauges: { easygoing: 3, foodAffinity: 3, activeness: 3 },
          categoryBreakdown: [],
          avgPlacesPerDay: 4,
          avgRadiusKm: 1.2,
          avgDwellMinutes: 72,
          sampleTripCount: 3,
          updatedAt: '2026-08-28T09:00:00Z',
        },
        preview: null,
      };
      expect(resolveStyleFace(envelope)).toBe('official');
    }
  );
});

describe('🔴 resolveStyleFace — [[반쪽 방어]] 중첩 결측 무크래시', () => {
  it('progress·analysis 결측, envelope 자체 null/undefined 여도 insufficient(never promote on garbage)', () => {
    const cases: unknown[] = [
      { official: true }, // progress·analysis 없음
      { official: true, progress: undefined, analysis: undefined },
      { official: false, progress: { current: 12, required: 10 } }, // analysis 키 없음
      null,
      undefined,
    ];
    for (const bad of cases) {
      expect(() =>
        resolveStyleFace(bad as unknown as StyleAnalysisEnvelope)
      ).not.toThrow();
      expect(resolveStyleFace(bad as unknown as StyleAnalysisEnvelope)).toBe(
        'insufficient'
      );
    }
  });
});

describe('🔴 categoryLabel — AC-2 표시 라벨 매핑(집계는 서버, 클라는 변환만)', () => {
  const share = (
    category: string,
    isOther = false,
    ratio = 0.2
  ): CategoryShare => ({ category, ratio, isOther });

  it.each([
    ['맛집', '미식'], // 유일한 코드↔라벨 불일치
    ['카페', '카페'],
    ['자연', '자연'],
    ['명소', '명소'], // 미지/항등 코드는 그대로
  ])('일반 행 %s → %s', (code, label) => {
    expect(categoryLabel(share(code))).toBe(label);
  });

  it('isOther 행은 category 코드와 무관하게 항상 "기타"', () => {
    expect(categoryLabel(share('맛집', true))).toBe('기타');
    expect(categoryLabel(share('무엇이든', true))).toBe('기타');
  });
});
