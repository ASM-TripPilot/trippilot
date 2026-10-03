import {
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

import { deriveTripCardFace } from './tripCardFace';

/**
 * TRIP-788 · AC-1~3 — `deriveTripCardFace(status, generationState)` 순수 함수.
 *
 * 정본 공백(u3 FD에 상태→상태문 표 없음)이라 프론트 합성(01b Q1 Mapping A). 카드 얼굴 3종의
 * (상태문·배지·resume) 조합을 한 함수에 몰아 기록 — 틀리면 이 함수 3줄만 고친다.
 *
 * 무엇을 보장하나:
 *  - 🔴 생성중(PARTIAL) → 'AI가 일정을 짜는 중' · 배지 draft · **resume 없음**.
 *  - 🔴 초안(COMPLETE/FAILED + PLANNED) → '추천안 준비 중' · 배지 draft · **resume 있음**.
 *  - 🔴 완성(CONFIRMED) → '일정 확정' · 배지 done · resume 없음(TRIP-986 Seed D2 — 구 '추천안이 준비됐어요' 교체).
 *    일정 없음(404)·조회 실패 얼굴은 입력 모양이 구현 몫이라 컨테이너 층(`TripCardContainer.test.tsx`)에서 잰다.
 *  - 🔴 FAILED 는 별도 실패 얼굴 없이 초안으로 접는다(01b Q3, INV-4 재시도 · Figma 실패 프레임 없음).
 *
 * *(개념 — resume seam)* resume 는 배지 값과 **독립**이다. 생성중·초안이 같은 draft 배지를 쓰므로
 *   배지로 resume 를 가르면 생성중에 resume 가 샌다 → 이 함수가 배지 외 resume 신호를 별도로 낸다.
 *
 * *(우선순위)* PARTIAL → CONFIRMED → 초안 순(형제 `resolveItineraryDestination` 과 정렬). CONFIRMED
 *   +PARTIAL 동시는 AC 밖(h25 확정이 PARTIAL 중 잠김이라 실서비스 미발생) — 테스트하지 않는다.
 *
 * `toEqual` 완전일치라 세 필드 중 하나만 어긋나거나(상수 하드코딩·resume 뒤바뀜) red.
 */

describe('🔴 deriveTripCardFace · 상태 3종 + FAILED 착지 (Mapping A)', () => {
  it.each([
    [
      '생성중(PARTIAL) — AI가 짜는 중 · 작성중 · resume 없음',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.PARTIAL,
      { statusLine: 'AI가 일정을 짜는 중', badge: 'draft', resume: false },
    ],
    [
      '초안(COMPLETE+PLANNED) — 추천안 준비 중 · 작성중 · resume 있음',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.COMPLETE,
      { statusLine: '추천안 준비 중', badge: 'draft', resume: true },
    ],
    [
      '초안(FAILED+PLANNED, Q3) — 실패도 초안 얼굴로 접음(INV-4 재시도)',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.FAILED,
      { statusLine: '추천안 준비 중', badge: 'draft', resume: true },
    ],
    [
      '완성(CONFIRMED) — 일정 확정 · 완성 · resume 없음 (TRIP-986 D2)',
      ItineraryStatus.CONFIRMED,
      ItineraryGenerationState.COMPLETE,
      { statusLine: '일정 확정', badge: 'done', resume: false },
    ],
  ] as const)('%s', (_label, status, generationState, expected) => {
    expect(deriveTripCardFace(status, generationState)).toEqual(expected);
  });
});

/**
 * TRIP-1015 B · 상태문은 **생성 방식**을 먼저 본다(QA #082 · US-SCHED-10 · 사용자 결정 1).
 *
 * 직접 짜기(MANUAL)는 AI 를 부르지 않는다(openapi `generationMode` 설명). 그런데 카드가 generationState 만
 * 보고 "추천안 준비 중"을 띄워, 사용자가 직접 짜는 여행을 AI 가 준비 중인 것처럼 말했다.
 *
 * 무엇을 보장하나:
 *  - 🔴 MANUAL 이면 확정 전까지 상태문은 '직접 짜는 중', CO_PLAN 이면 '같이 짜는 중'(PARTIAL 포함 — Seed Q2).
 *  - 배지·resume 는 지금 규칙(generationState 기준) 그대로다 — **상태문만** 모드로 갈린다(최소 변경).
 *  - CONFIRMED 는 모드와 상관없이 '일정 확정'.
 *  - FULLY_AI·모드 미지정은 위 describe 그대로(무회귀 — 네 번째 인자로 FULLY_AI 를 줘도 같다).
 *
 * 인자 모양(02a §2-B 계약): 네 번째 **위치 인자** `generationMode`. 세 번째 `notFound` 기본값을 건너뛰려고
 * `false` 를 명시한다. 기존 2인자 호출(doneBar·위 describe)은 그대로 컴파일된다.
 */
describe('🔴 1015-B · deriveTripCardFace · 생성 방식별 상태문 (QA #082)', () => {
  it.each([
    [
      'MANUAL + 초안(COMPLETE) — 직접 짜는 중 · 작성중 · resume 있음',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.COMPLETE,
      ItineraryGenerationMode.MANUAL,
      { statusLine: '직접 짜는 중', badge: 'draft', resume: true },
    ],
    [
      'MANUAL + PARTIAL(도달 불가지만 판정은 모드 우선) — 직접 짜는 중 · resume 없음',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.PARTIAL,
      ItineraryGenerationMode.MANUAL,
      { statusLine: '직접 짜는 중', badge: 'draft', resume: false },
    ],
    [
      'MANUAL + FAILED — 직접 짜는 중 · resume 있음',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.FAILED,
      ItineraryGenerationMode.MANUAL,
      { statusLine: '직접 짜는 중', badge: 'draft', resume: true },
    ],
    [
      'CO_PLAN + PARTIAL(슬롯 채우는 중, Q2) — 같이 짜는 중 · resume 없음',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.PARTIAL,
      ItineraryGenerationMode.CO_PLAN,
      { statusLine: '같이 짜는 중', badge: 'draft', resume: false },
    ],
    [
      'CO_PLAN + 초안(COMPLETE) — 같이 짜는 중 · resume 있음',
      ItineraryStatus.PLANNED,
      ItineraryGenerationState.COMPLETE,
      ItineraryGenerationMode.CO_PLAN,
      { statusLine: '같이 짜는 중', badge: 'draft', resume: true },
    ],
    [
      'MANUAL + CONFIRMED — 모드와 상관없이 일정 확정',
      ItineraryStatus.CONFIRMED,
      ItineraryGenerationState.COMPLETE,
      ItineraryGenerationMode.MANUAL,
      { statusLine: '일정 확정', badge: 'done', resume: false },
    ],
    [
      'CO_PLAN + CONFIRMED — 모드와 상관없이 일정 확정',
      ItineraryStatus.CONFIRMED,
      ItineraryGenerationState.COMPLETE,
      ItineraryGenerationMode.CO_PLAN,
      { statusLine: '일정 확정', badge: 'done', resume: false },
    ],
  ] as const)('%s', (_label, status, generationState, mode, expected) => {
    expect(deriveTripCardFace(status, generationState, false, mode)).toEqual(
      expected
    );
  });

  it.each([
    [
      ItineraryGenerationState.PARTIAL,
      { statusLine: 'AI가 일정을 짜는 중', badge: 'draft', resume: false },
    ],
    [
      ItineraryGenerationState.COMPLETE,
      { statusLine: '추천안 준비 중', badge: 'draft', resume: true },
    ],
  ] as const)(
    'FULLY_AI 를 네 번째 인자로 줘도 지금 문구 그대로다(%s) — 무회귀',
    (generationState, expected) => {
      expect(
        deriveTripCardFace(
          ItineraryStatus.PLANNED,
          generationState,
          false,
          ItineraryGenerationMode.FULLY_AI
        )
      ).toEqual(expected);
    }
  );

  it('일정이 없으면(404) 모드가 무엇이든 "아직 일정이 없어요"다', () => {
    expect(
      deriveTripCardFace(
        undefined,
        undefined,
        true,
        ItineraryGenerationMode.MANUAL
      )
    ).toEqual({
      statusLine: '아직 일정이 없어요',
      badge: 'draft',
      resume: false,
    });
  });
});
