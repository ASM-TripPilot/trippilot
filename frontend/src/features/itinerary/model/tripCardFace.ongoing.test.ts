import {
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

import { deriveTripCardFace } from './tripCardFace';

/**
 * TRIP-1121 · AC-3 — 카드 얼굴에 "여행 중"(badge 'live')을 더한다(01b D5).
 *
 * 인자 모양(02a §1 계약): 다섯째 **위치 인자** `ongoing`(기본 false). 셋째 `notFound`·넷째 `generationMode`
 * 를 건너뛰려고 `false`·`undefined` 를 명시한다. 기존 2·4인자 호출(doneBar·컨테이너)은 그대로 컴파일된다.
 *
 * 무엇을 보장하나:
 *  - 확정(CONFIRMED) + ongoing → 상태문 '일정 확정' · 배지 live · resume 없음.
 *  - ongoing 이 없거나 false 면 지금과 같은 완성(done) 얼굴 — doneBar 가 기대는 `badge==='done'` 이 안 바뀐다.
 *  - 확정이 아니면(초안·생성중·404) ongoing 을 줘도 지금 얼굴 그대로 — "여행 중"은 확정 분기에서만 난다.
 *  - 생성 방식(MANUAL·CO_PLAN)은 확정 얼굴에 영향이 없다(live 도 마찬가지).
 *
 * `toEqual` 완전일치라 세 필드 중 하나만 어긋나도 red.
 */

const LIVE = { statusLine: '일정 확정', badge: 'live', resume: false } as const;
const DONE = { statusLine: '일정 확정', badge: 'done', resume: false } as const;

describe('🔴 F1 · 확정 + 여행 중 → live 얼굴', () => {
  it('CONFIRMED · COMPLETE · ongoing=true → 일정 확정 · live · resume 없음', () => {
    // 실행
    const face = deriveTripCardFace(
      ItineraryStatus.CONFIRMED,
      ItineraryGenerationState.COMPLETE,
      false,
      undefined,
      true
    );
    // 단언
    expect(face).toEqual(LIVE);
  });
});

describe('🟢 F2 · ongoing 이 없거나 false 면 완성 그대로 (무회귀)', () => {
  it('ongoing=false 를 명시해도 done', () => {
    expect(
      deriveTripCardFace(
        ItineraryStatus.CONFIRMED,
        ItineraryGenerationState.COMPLETE,
        false,
        undefined,
        false
      )
    ).toEqual(DONE);
  });

  it('2인자 호출(doneBar 방식)은 done', () => {
    expect(
      deriveTripCardFace(
        ItineraryStatus.CONFIRMED,
        ItineraryGenerationState.COMPLETE
      )
    ).toEqual(DONE);
  });
});

describe('🟢 F3 · 확정이 아니면 ongoing=true 여도 지금 얼굴 그대로', () => {
  it.each([
    [
      '초안(PLANNED+COMPLETE)',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.COMPLETE,
      false,
      { statusLine: '추천안 준비 중', badge: 'draft', resume: true },
    ],
    [
      '생성중(PARTIAL)',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.PARTIAL,
      false,
      { statusLine: 'AI가 일정을 짜는 중', badge: 'draft', resume: false },
    ],
    [
      '일정 없음(404)',
      undefined,
      undefined,
      true,
      { statusLine: '아직 일정이 없어요', badge: 'draft', resume: false },
    ],
  ] as const)('%s', (_label, status, generationState, notFound, expected) => {
    expect(
      deriveTripCardFace(status, generationState, notFound, undefined, true)
    ).toEqual(expected);
  });
});

describe('🔴 F4 · 생성 방식과 무관하게 확정 + 여행 중 → live', () => {
  it.each([ItineraryGenerationMode.MANUAL, ItineraryGenerationMode.CO_PLAN])(
    '%s',
    (mode) => {
      expect(
        deriveTripCardFace(
          ItineraryStatus.CONFIRMED,
          ItineraryGenerationState.COMPLETE,
          false,
          mode,
          true
        )
      ).toEqual(LIVE);
    }
  );
});
