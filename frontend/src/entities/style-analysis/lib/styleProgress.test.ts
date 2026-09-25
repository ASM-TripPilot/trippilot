import fc from 'fast-check';

import type {
  StyleAnalysisEnvelope,
  StyleProgress,
} from '@/shared/api/generated/schemas';

import { resolveStyleProgress } from './styleProgress';

/**
 * TRIP-956 · 스타일 진행도 폴백 — j05(상세)와 l03 요약카드가 같이 쓰는 한 곳.
 *
 * 무엇을 보장하나:
 *  - 🔴 P1 값 표: `progress` 가 없거나(생략·undefined·null) 비었거나(`{}`) 한쪽만 있어도
 *    **필드 단위**로 `current` 는 0, `required` 는 10 으로 채운다. 값이 있으면 그대로 둔다.
 *  - 🔴 P2 property: 계약 밖까지 넓힌 임의 입력에서도 던지지 않고, 숫자로 온 필드는 그대로·아니면 폴백.
 *
 * (개념) 필드 단위 폴백 = 객체 통째로(`progress ?? 기본값`)가 아니라 칸마다 따로 채우기.
 * 통째로 채우면 `{}` 가 그대로 지나가 "현재 undefined곳"이 뜬다.
 *
 * 커버하지 않는 것: envelope 자체 null(두 화면이 먼저 거른다 — 범위 밖).
 */

/** progress 만 다르게 넣은 envelope — 계약 밖 모양이라 캐스팅한다. */
function envelopeWith(progress: unknown, omit = false): StyleAnalysisEnvelope {
  const base = { official: false, analysis: null, preview: null };
  return (omit
    ? base
    : { ...base, progress }) as unknown as StyleAnalysisEnvelope;
}

describe('🔴 P1 · 필드 단위 폴백 값 표 (current 0 · required 10)', () => {
  // 행 = [이름, 기대 current, 기대 required, 입력] — 입력을 끝에 둬야 제목의 %i 가 기대값을 찍는다.
  it.each([
    ['progress 키 없음', 0, 10, envelopeWith(undefined, true)],
    ['progress undefined', 0, 10, envelopeWith(undefined)],
    ['progress null', 0, 10, envelopeWith(null)],
    ['progress {} (빈 객체)', 0, 10, envelopeWith({})],
    ['current 만 4', 4, 10, envelopeWith({ current: 4 })],
    ['required 만 12', 0, 12, envelopeWith({ required: 12 })],
    ['정상 4/10', 4, 10, envelopeWith({ current: 4, required: 10 })],
    [
      '정상 12/10(정식 뒤에도 실림)',
      12,
      10,
      envelopeWith({ current: 12, required: 10 }),
    ],
  ] as [string, number, number, StyleAnalysisEnvelope][])(
    '%s → current %i · required %i',
    (_label, current, required, envelope) => {
      // 실행
      const progress = resolveStyleProgress(envelope);

      // 단언: 빈 칸만 채우고 있는 값은 그대로.
      expect(progress).toEqual({ current, required });
    }
  );
});

/** 필드 한 칸 — 숫자, 또는 계약 위반 null. 키 생략은 record 의 requiredKeys: [] 가 만든다. */
const fieldArb = fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(null));

/** progress 모양 전부 — 부분 객체({}·한쪽만·둘 다), null, undefined, (키 생략은 바깥 record). */
const looseProgressArb = fc.oneof(
  fc.record({ current: fieldArb, required: fieldArb }, { requiredKeys: [] }),
  fc.constant(null),
  fc.constant(undefined)
);

const looseEnvelopeArb = fc.record(
  { official: fc.boolean(), progress: looseProgressArb },
  { requiredKeys: ['official'] }
) as unknown as fc.Arbitrary<StyleAnalysisEnvelope>;

/** 규칙을 말로 옮긴 기대값 — "숫자로 왔으면 그 값, 아니면 기본값". */
function fieldOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

describe('🔴 P2 · 계약 밖 임의 입력에서도 칸마다 폴백 (property)', () => {
  it('어떤 progress 모양이 와도 던지지 않고, 숫자인 칸은 그대로·아닌 칸은 0/10', () => {
    fc.assert(
      fc.property(looseEnvelopeArb, (envelope) => {
        // 준비: 입력 쪽 원래 칸 값(없으면 undefined).
        const raw = (envelope as { progress?: Partial<StyleProgress> | null })
          .progress;

        // 실행
        let progress: StyleProgress | undefined;
        expect(() => {
          progress = resolveStyleProgress(envelope);
        }).not.toThrow();

        // 단언
        expect(progress).toEqual({
          current: fieldOr(raw?.current, 0),
          required: fieldOr(raw?.required, 10),
        });
      }),
      { numRuns: 500 }
    );
  });
});
