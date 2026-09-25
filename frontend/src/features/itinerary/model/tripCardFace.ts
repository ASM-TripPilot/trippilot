import type {
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-788 · h05/h06 "내 여행" 카드 얼굴 파생(순수). 정본 공백(u3 FD 에 상태→상태문 표 없음)이라
 * 프론트 합성이다(01b Q1 Mapping A) — 세 얼굴의 (상태문·배지·resume) 조합을 이 함수 하나에 몰아
 * 기록해, 매핑이 틀리면 이 3줄만 고친다. 형제 `resolveItineraryDestination`("어느 화면으로") 옆의
 * "어떤 얼굴로"이며, 컨테이너(pages)가 소비한다(pages→features 허용).
 *
 * resume 는 배지와 **독립**이다(AC-5 seam): 생성중·초안이 같은 draft 배지를 쓰므로 배지로 resume 를
 * 가르면 생성중에 resume 가 샌다 — 그래서 배지와 별개로 resume 신호를 낸다.
 */
export interface TripCardFace {
  statusLine: string;
  badge: 'done' | 'draft';
  resume: boolean;
}

/**
 * 우선순위(결정론) — PARTIAL → CONFIRMED → 초안 순(`resolveItineraryDestination` 과 정렬).
 * - `generationState==='PARTIAL'` → 생성중: 'AI가 일정을 짜는 중' · draft · resume 없음.
 * - `status==='CONFIRMED'` → 완성: '추천안이 준비됐어요' · done · resume 없음(구 '확정 장소 N곳' 대체).
 * - else(COMPLETE/FAILED+PLANNED · 404 undefined 포함) → 초안: '추천안 준비 중' · draft · resume 있음.
 */
export function deriveTripCardFace(
  status?: ItineraryStatus,
  generationState?: ItineraryGenerationState
): TripCardFace {
  if (generationState === 'PARTIAL') {
    return { statusLine: 'AI가 일정을 짜는 중', badge: 'draft', resume: false };
  }
  if (status === 'CONFIRMED') {
    return { statusLine: '추천안이 준비됐어요', badge: 'done', resume: false };
  }
  return { statusLine: '추천안 준비 중', badge: 'draft', resume: true };
}
