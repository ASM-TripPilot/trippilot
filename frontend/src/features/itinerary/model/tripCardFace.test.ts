import {
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
 *  - 🔴 완성(CONFIRMED) → '추천안이 준비됐어요' · 배지 done · resume 없음(구 '확정 장소 N곳' 대체).
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
      '완성(CONFIRMED) — 추천안이 준비됐어요 · 완성 · resume 없음',
      ItineraryStatus.CONFIRMED,
      ItineraryGenerationState.COMPLETE,
      { statusLine: '추천안이 준비됐어요', badge: 'done', resume: false },
    ],
  ] as const)('%s', (_label, status, generationState, expected) => {
    expect(deriveTripCardFace(status, generationState)).toEqual(expected);
  });
});
