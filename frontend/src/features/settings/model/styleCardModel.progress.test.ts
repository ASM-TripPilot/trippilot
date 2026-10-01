import fc from 'fast-check';

import { resolveStyleFace } from '@/entities/style-analysis/lib/styleFace';
import { resolveStyleProgress } from '@/entities/style-analysis/lib/styleProgress';
import type {
  StyleAnalysisBody,
  StyleAnalysisEnvelope,
} from '@/shared/api/generated/schemas';

import { buildStyleCardModel } from './styleCardModel';

/**
 * TRIP-956 · AC-3 대칭 — 같은 envelope 을 j05(상세)와 l03 요약카드에 주면 둘 다 같은 "현재 N곳"을 낸다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **대칭 property**: progress 가 망가진 입력까지 넓힌 임의 envelope 에서 요약카드는 던지지 않고,
 *    판정이 임시면 카드의 current = `resolveStyleProgress(e).current`(j05 가 화면에 넘기는 값).
 *  - 🔴 **고정 예제**: progress 가 없는 미달 envelope 하나로 두 쪽이 모두 "현재 0곳"임을 눈으로 보인다.
 *
 * 왜 이 모양인가: j05 페이지는 jest 로 렌더하지 않는다(훅·라우터 배선). 그래서 "페이지는 공유 함수를
 * 부르고 progress 를 직접 읽지 않는다"는 구조 가드(`entitiesStyleAnalysisStructure` G8)가 모양을 잠그고,
 * 이 파일은 "요약카드 결과 = 공유 함수 결과"를 행동으로 잠근다. 둘이 겹쳐야 대칭이 된다.
 *
 * 커버하지 않는 것: 판정(kind) 동치는 `styleCardModel.face.test.ts`, 폴백 값 자체(0/10)는
 * `entities/style-analysis/lib/styleProgress.test.ts`, envelope 자체 null 은 범위 밖.
 */

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

/** 필드 한 칸 — 숫자, 또는 계약 위반 null. 키 생략은 record 의 requiredKeys: [] 가 만든다. */
const fieldArb = fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(null));

/** progress 모양 전부 — 부분 객체({}·한쪽만·둘 다), null, undefined, (키 생략은 바깥 record). */
const looseProgressArb = fc.oneof(
  fc.record({ current: fieldArb, required: fieldArb }, { requiredKeys: [] }),
  fc.constant(null),
  fc.constant(undefined)
);

const looseEnvelopeArb = fc.record(
  {
    official: fc.boolean(),
    progress: looseProgressArb,
    analysis: fc.option(fc.constant(ANALYSIS), { nil: null }),
    preview: fc.option(fc.record({ descriptors: fc.array(fc.string()) }), {
      nil: null,
    }),
  },
  { requiredKeys: ['official'] }
) as unknown as fc.Arbitrary<StyleAnalysisEnvelope>;

describe('🔴 AC-3 · j05 와 요약카드가 같은 current 를 낸다(대칭 property)', () => {
  it('progress 가 망가진 임의 envelope 에서도 요약카드는 안 죽고, 임시면 current 가 공유 폴백과 같다', () => {
    fc.assert(
      fc.property(looseEnvelopeArb, (envelope) => {
        // 실행: 요약카드를 만든다(던지면 여기서 실패).
        let vm: ReturnType<typeof buildStyleCardModel> | undefined;
        expect(() => {
          vm = buildStyleCardModel(envelope);
        }).not.toThrow();

        // 단언: 조건은 카드 결과가 아니라 판정으로 건다 — 카드가 잘못 official 을 내도 여기서 걸린다.
        if (resolveStyleFace(envelope) === 'insufficient') {
          expect(vm).toEqual({
            kind: 'insufficient',
            current: resolveStyleProgress(envelope).current,
          });
        }
      }),
      { numRuns: 500 }
    );
  });

  it('progress 가 없는 미달 envelope 이면 j05 쪽과 요약카드 쪽 모두 임시 · 현재 0곳', () => {
    // 준비: 서버가 progress 를 빼먹고 보낸 미달 응답.
    const envelope = {
      official: false,
      analysis: null,
      preview: { descriptors: ['느긋'] },
    } as unknown as StyleAnalysisEnvelope;

    // 실행: j05 가 화면에 넘기는 값(판정 + 폴백)과 요약카드 VM 을 각각 만든다.
    const j05 = {
      face: resolveStyleFace(envelope),
      current: resolveStyleProgress(envelope).current,
    };
    const card = buildStyleCardModel(envelope);

    // 단언: 두 화면이 같은 얼굴, 같은 숫자.
    expect(j05).toEqual({ face: 'insufficient', current: 0 });
    expect(card).toEqual({ kind: 'insufficient', current: 0 });
  });
});
