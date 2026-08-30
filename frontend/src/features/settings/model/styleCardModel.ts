import type { StyleAnalysisEnvelope } from '@/shared/api/generated/schemas';

/**
 * TRIP-606 · l03 스타일 요약 카드 뷰모델 — 서버 응답(Envelope)을 화면이 그대로 그릴 값 묶음으로
 * 접는 순수 함수. U6 는 축·비율을 재계산하지 않는다(BR-U6-24) — 라벨만 입히고 값은 응답 그대로.
 *
 * Envelope 은 두 얼굴이다: official=true 면 `analysis` 가, 미달이면 `preview` 가 찬다(하나만 참).
 * 화면이 매번 그 분기를 다시 재판정하지 않도록 여기서 판별 유니온 `kind` 로 접는다. insufficient VM 은
 * `descriptors`·`gauges` 필드 자체가 없어 화면이 preview 를 정식처럼 그릴 코드 경로가 구조적으로 없다
 * (INV-U5-09 미리보기 유출 차단).
 */

export interface StyleGauge {
  label: string;
  /** 0~5, 서버 값 그대로(클라 재계산 금지 — BR-U6-24). */
  value: number;
}

export type StyleCardVM =
  | {
      kind: 'official';
      descriptors: string[];
      /** 정확히 3개, 순서 [easygoing, foodAffinity, activeness]. */
      gauges: StyleGauge[];
      sampleTripCount: number;
      /** raw ISO 그대로 — 포맷은 화면 몫. */
      updatedAt: string;
    }
  | { kind: 'insufficient'; current: number };

export function buildStyleCardModel(
  envelope: StyleAnalysisEnvelope
): StyleCardVM {
  const { analysis } = envelope;
  // official 이 아니거나 분석 본문이 없으면 미달 얼굴 — preview 는 싣지 않는다.
  if (!envelope.official || analysis == null) {
    return { kind: 'insufficient', current: envelope.progress.current };
  }

  const { traitGauges } = analysis;
  return {
    kind: 'official',
    descriptors: analysis.descriptors,
    gauges: [
      { label: '여유로움', value: traitGauges.easygoing },
      { label: '미식 취향', value: traitGauges.foodAffinity },
      { label: '활동성', value: traitGauges.activeness },
    ],
    sampleTripCount: analysis.sampleTripCount,
    updatedAt: analysis.updatedAt,
  };
}
