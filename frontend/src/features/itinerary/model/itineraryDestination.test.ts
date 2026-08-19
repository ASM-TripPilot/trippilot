import {
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';
import {
  resolveItineraryDestination,
  type ItineraryDestination,
} from './planState';

/**
 * TRIP-401 · 일정 목적지 판정(순수함수)의 상태별 표를 전수로 잠근다(AC-5 · 결정1).
 *
 * 무엇을 보장하나: `resolveItineraryDestination` 이 (일정 없음/진행 상태/확정 상태) 세 입력만으로
 * 정확히 하나의 목적지 토큰(`method`/`generating`/`draft`/`plan`)을 낸다. 이 함수 하나가 두
 * 진입점(홈 카드 CTA·일정 탭)의 공통 규칙이라, 여기서 표가 굳으면 두 진입점이 같은 규칙을 쓴다.
 *
 * *(개념)* **순수 판정 함수**: 네트워크·시계·라우터를 모르고 입력→출력만 있는 함수. 그래서 결정1
 *   표를 그대로 테스트 표로 옮겨 비공허하게 잠글 수 있다(02a §4-★2).
 *
 * 근거표(01b 결정1): 404→method(생성 방식부터) · PARTIAL→generating(BR-U3-04) ·
 *   FAILED→draft(1차분 유효) · COMPLETE+PLANNED→draft(BR-U3-07 초안) · CONFIRMED→plan(BR-U3-28).
 */

type Case = {
  label: string;
  input: Parameters<typeof resolveItineraryDestination>[0];
  expected: ItineraryDestination;
};

const CASES: Case[] = [
  {
    // 404 = 일정이 아직 없다 → 생성 방식(h04)부터 고르게 보낸다. gen/status 는 없다.
    label: '404(일정 없음)',
    input: { notFound: true },
    expected: 'method',
  },
  {
    // PARTIAL = day1만 채워진 생성 진행 중 → 생성 중 화면(h09). PARTIAL 동안은 항상 PLANNED.
    label: 'PARTIAL(생성 중)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.PARTIAL,
      status: ItineraryStatus.PLANNED,
    },
    expected: 'generating',
  },
  {
    // FAILED = 2차 실패라도 1차분은 유효 → 초안(h11)에서 잔존+실패를 함께 보여준다.
    label: 'FAILED(2차 실패)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.FAILED,
      status: ItineraryStatus.PLANNED,
    },
    expected: 'draft',
  },
  {
    // COMPLETE + PLANNED = 완성됐지만 아직 미확정 → 초안 재검토(h11).
    label: 'COMPLETE+PLANNED(초안)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: ItineraryStatus.PLANNED,
    },
    expected: 'draft',
  },
  {
    // CONFIRMED = 확정된 읽기전용 완성 → 완성 시간표(h25).
    label: 'CONFIRMED(확정)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: ItineraryStatus.CONFIRMED,
    },
    expected: 'plan',
  },
];

describe('🔴 resolveItineraryDestination — 상태별 목적지 표 전수 (AC-5 · 결정1)', () => {
  it.each(CASES)('$label → $expected', ({ input, expected }) => {
    // 준비·실행 — 입력 하나를 순수함수에 넣는다.
    // 단언 — 결정1 표가 지정한 목적지 토큰과 정확히 같다(toBe = 참조/원시값 동일).
    expect(resolveItineraryDestination(input)).toBe(expected);
  });
});
