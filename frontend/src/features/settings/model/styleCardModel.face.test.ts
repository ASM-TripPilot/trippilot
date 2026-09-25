import fc from 'fast-check';

import { resolveStyleFace } from '@/entities/style-analysis/lib/styleFace';
import type {
  StyleAnalysisBody,
  StyleAnalysisEnvelope,
} from '@/shared/api/generated/schemas';

import { buildStyleCardModel } from './styleCardModel';

/**
 * TRIP-637 · AC-4 — l03 요약카드(`buildStyleCardModel`)가 j05 와 **같은 정식/임시 판정**을 쓴다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **동치 property**: 계약 안의 임의 envelope 에 대해 `buildStyleCardModel(e).kind === resolveStyleFace(e)`.
 *    요약카드가 판정을 우회해 자기 분기를 다시 만들면(예: `current >= required` 로 자체 승격) 한 번이라도
 *    갈리는 순간 red — 두 화면이 조용히 갈라지는 것(TRIP-573 맹점②)을 행동으로 막는다.
 *  - 🔴 **위험 조합 고정 예제**: 무작위가 덜 뽑아도 반드시 한 번은 보도록 두 조합을 손으로 고정한다.
 *
 * (개념) 동치 property = "두 함수가 같은 답을 낸다"를 무작위 입력 수백 개로 확인하는 테스트.
 *
 * 커버하지 않는 것: 계약 밖 입력(`progress` 결측·envelope null). `buildStyleCardModel` 은 그 입력에서
 * 크래시하고, 방어 추가는 이번 범위 밖이다(01b Q4) — 그래서 생성기가 `official`·`progress` 를 늘 채운다.
 * VM 값 무변형(AC-M1~M3)은 `styleCardModel.test.ts` 몫.
 */

/** 정식 본문 arb — 판정은 존재만 보지만 요약카드는 값을 읽으므로 타입에 맞는 전체 모양을 만든다. */
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

/**
 * 계약 안의 임의 envelope — `official`·`progress` 는 필수라 늘 채우고, 옵셔널 `analysis`·`preview` 는
 * `requiredKeys` 로 키 생략(undefined)·null·값 세 형태를 모두 돌린다(02a §5-B 실측: 500회 중 생략 88·null 65·값 347).
 */
const envelopeArb: fc.Arbitrary<StyleAnalysisEnvelope> = fc.record(
  {
    official: fc.boolean(),
    progress: fc.record({
      current: fc.integer({ min: 0, max: 20 }),
      required: fc.constant(10),
    }),
    analysis: fc.option(analysisBodyArb, { nil: null }),
    preview: fc.option(fc.record({ descriptors: fc.array(fc.string()) }), {
      nil: null,
    }),
  },
  { requiredKeys: ['official', 'progress'] }
);

const ANALYSIS: StyleAnalysisBody = {
  descriptors: ['#바다'],
  traitGauges: { easygoing: 3, foodAffinity: 3, activeness: 3 },
  categoryBreakdown: [],
  avgPlacesPerDay: 4,
  avgRadiusKm: 1.2,
  avgDwellMinutes: 72,
  sampleTripCount: 3,
  updatedAt: '2026-08-28T09:00:00Z',
};

describe('🔴 AC-4 · 요약카드와 j05 가 같은 판정을 쓴다(동치 property)', () => {
  it('계약 안의 임의 envelope 에서 buildStyleCardModel(e).kind 는 resolveStyleFace(e) 와 같다', () => {
    fc.assert(
      fc.property(envelopeArb, (envelope) => {
        // 실행: 같은 입력을 두 함수에 준다.
        const face = resolveStyleFace(envelope);
        const vm = buildStyleCardModel(envelope);

        // 단언: 요약카드의 얼굴이 공유 판정의 얼굴과 늘 같다.
        expect(vm.kind).toBe(face);
      }),
      { numRuns: 500 }
    );
  });

  it.each([
    [
      'official=false · current 10 · analysis 있음(자체 승격 유혹)',
      {
        official: false,
        progress: { current: 10, required: 10 },
        analysis: ANALYSIS,
        preview: null,
      },
    ],
    [
      'official=true · analysis 없음(그릴 본문 없는 정식)',
      {
        official: true,
        progress: { current: 14, required: 10 },
        analysis: null,
        preview: { descriptors: ['느긋'] },
      },
    ],
  ] as [string, StyleAnalysisEnvelope][])(
    '위험 조합 %s 은 두 쪽 모두 insufficient',
    (_label, envelope) => {
      // 실행
      const face = resolveStyleFace(envelope);
      const vm = buildStyleCardModel(envelope);

      // 단언: 판정이 임시이고, 요약카드도 그 판정을 그대로 따른다.
      expect(face).toBe('insufficient');
      expect(vm.kind).toBe(face);
    }
  );
});
