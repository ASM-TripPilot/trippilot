import {
  DRAFT_POLL_INTERVAL_MS,
  DRAFT_POLL_SLOW_INTERVAL_MS,
} from '@/features/itinerary/model/draftView';
import type {
  ItineraryGenerationState,
  Trip,
} from '@/shared/api/index.schemas';
import { NO_ITINERARY } from '@/test-support/tripItineraryCols';

import {
  GENERATION_COMPLETE_MESSAGE,
  GENERATION_COMPLETE_TOAST_ID,
  GENERATION_FAILED_MESSAGE,
  GENERATION_FAILED_TOAST_ID,
  detectGenerationTransition,
  isGenerationScreenOf,
  shouldSkipToast,
  tripsRefetchInterval,
} from './generationWatch';

/**
 * TRIP-1618 — 앱 셸 "생성 완료 감지"의 순수 판정(직전→지금 전이 · 현재 경로가 그 여행의 진행 화면인가).
 * TRIP-1677 — 감시 대상이 일정 캐시 칸에서 `GET /trips` 목록 한 칸으로 바뀌었다: 옛 W2(일정 키 읽기)는 지우고 W2′(`tripsRefetchInterval`)를 둔다.
 *
 * *(개념)* 전이 감지(edge detection) = "지금 값"이 아니라 "직전 값 → 지금 값"의 변화만 본다. 같은 응답이 반복돼도 알림이 한 번뿐인 이유다.
 *
 * 무엇을 보장하나:
 *  - W1 토스트 두 문구는 확정값이고 소요시간 표현이 없다(INV-3, AC5).
 *  - W2 목록 폴링 간격 규칙(`tripsRefetchInterval`): 생성 중 여행이 목록에 없으면 안 묻고, 있으면 2초→5초 곡선, 오류 틱에도 멈추지 않고 5초.
 *  - W3 알리는 전이는 `PARTIAL → COMPLETE|FAILED` 둘뿐이다.
 *  - W4·W5 "그 여행의 진행 화면"이면 셸이 폴링을 양보하고 토스트도 생략한다 / 일정 탭이면 토스트만 생략한다.
 *
 * 3동작 뼈대: 준비 = 값 표 → 실행 = 순수 함수 호출 → 단언 = 반환값. 시계·네트워크·React 없음.
 */

describe('W1 · 문구 상수는 확정값이고 소요시간 표현이 없다 (INV-3 · AC5)', () => {
  // 소요시간 표현: "소요" 라는 낱말, 또는 숫자 뒤 '분'/'시간'. 문구가 바뀌어도 같은 규칙이 지킨다.
  const DURATION_WORDING = /소요|\d\s*(분|시간)/;

  it('성공·실패 문구와 토스트 id 가 확정값이다', () => {
    expect(GENERATION_COMPLETE_MESSAGE).toBe('일정이 완성됐어요');
    expect(GENERATION_FAILED_MESSAGE).toBe('일정을 만들지 못했어요');
    expect(GENERATION_COMPLETE_TOAST_ID).toBe('generation-complete-toast');
    expect(GENERATION_FAILED_TOAST_ID).toBe('generation-failed-toast');
  });

  it('두 문구 모두 소요시간을 말하지 않는다', () => {
    expect(GENERATION_COMPLETE_MESSAGE).not.toMatch(DURATION_WORDING);
    expect(GENERATION_FAILED_MESSAGE).not.toMatch(DURATION_WORDING);
  });

  it('(자가검사) 위 정규식은 소요시간 문구를 실제로 잡는다 — 공허한 통과가 아니다', () => {
    expect('약 3분 소요').toMatch(DURATION_WORDING);
    expect('2시간 걸려요').toMatch(DURATION_WORDING);
    expect('소요 시간 안내').toMatch(DURATION_WORDING);
  });
});

/** 목록의 여행 한 건 — 네 칸만 의미가 있고 나머지는 자리 채움. */
function tripOf(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 'trip-x',
    title: '제주',
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...NO_ITINERARY,
    ...over,
  };
}

const RUNNING = tripOf({
  itineraryStatus: 'PLANNED',
  itineraryGenerationState: 'PARTIAL',
  itineraryGenerationMode: 'FULLY_AI',
  itineraryGenerating: true,
});
/** 세션이 없는 PARTIAL(멈춘 생성) — 서버가 11분 뒤 FAILED 로 닫을 때까지 PARTIAL 로 남는다. */
const STALLED_PARTIAL = tripOf({
  itineraryStatus: 'PLANNED',
  itineraryGenerationState: 'PARTIAL',
  itineraryGenerationMode: 'FULLY_AI',
});
/** 재생성 1차 — 옛 COMPLETE 인 채 세션만 돈다. */
const REGENERATING = tripOf({
  itineraryStatus: 'PLANNED',
  itineraryGenerationState: 'COMPLETE',
  itineraryGenerationMode: 'FULLY_AI',
  itineraryGenerating: true,
});
const DRAFT = tripOf({
  itineraryStatus: 'PLANNED',
  itineraryGenerationState: 'COMPLETE',
  itineraryGenerationMode: 'FULLY_AI',
});
const FAILED = tripOf({
  itineraryStatus: 'PLANNED',
  itineraryGenerationState: 'FAILED',
  itineraryGenerationMode: 'FULLY_AI',
});
const CONFIRMED = tripOf({
  itineraryStatus: 'CONFIRMED',
  itineraryGenerationState: 'COMPLETE',
  itineraryGenerationMode: 'FULLY_AI',
});

/**
 * 관찰자 없이 규칙만 시험하려고 `query` 모양의 평범한 객체를 넘긴다 — 함수가 읽는 건 `state` 셋뿐이다.
 * *(개념)* `refetchInterval` 이 함수면 TanStack 이 "다음 재조회까지 몇 ms"(또는 false=그만)를 이 함수에 묻는다.
 */
function intervalOf(
  data: Trip[] | undefined,
  status: 'pending' | 'success' | 'error' = 'success',
  dataUpdateCount = 1
): number | false {
  return tripsRefetchInterval({
    state: { status, data, dataUpdateCount },
  } as never);
}

describe('W2′ · 목록 폴링 간격 — 생성 중 여행이 있을 때만 묻고, 오류에도 멈추지 않는다 (AC-6 · D3)', () => {
  it.each<[string, Trip[] | undefined]>([
    ['목록을 아직 못 받았다(data 없음)', undefined],
    ['빈 목록', []],
    ['일정 없음만', [tripOf()]],
    ['완료 초안만', [DRAFT]],
    ['실패 초안만', [FAILED]],
    ['확정만', [CONFIRMED]],
  ])('생성 중 여행이 없으면(%s) false — 요청 0', (_label, data) => {
    expect(intervalOf(data)).toBe(false);
  });

  it.each<[string, Trip]>([
    ['세션이 도는 PARTIAL', RUNNING],
    ['세션 없는 PARTIAL(멈춘 생성)', STALLED_PARTIAL],
    ['재생성 중(COMPLETE + generating)', REGENERATING],
  ])('%s 이 하나라도 있으면 빠른 구간 2초', (_label, running) => {
    // 다른 여행이 섞여 있어도 하나면 된다(앵커: 완료 초안 + 확정이 앞에 있다).
    expect(intervalOf([DRAFT, CONFIRMED, running])).toBe(
      DRAFT_POLL_INTERVAL_MS
    );
  });

  it('간격 곡선: 갱신 횟수 14까지 2초, 15부터 5초(pollIntervalMs 와 같은 곡선)', () => {
    expect(intervalOf([RUNNING], 'success', 1)).toBe(DRAFT_POLL_INTERVAL_MS);
    expect(intervalOf([RUNNING], 'success', 14)).toBe(DRAFT_POLL_INTERVAL_MS);
    expect(intervalOf([RUNNING], 'success', 15)).toBe(
      DRAFT_POLL_SLOW_INTERVAL_MS
    );
  });

  it('오류 틱: 옛 data 가 생성 중이면 멈추지 않고 느린 간격 5초 — 횟수와 무관 (D3 · 옛 "오류면 멈춘다"의 뒤집기)', () => {
    expect(intervalOf([RUNNING], 'error', 1)).toBe(DRAFT_POLL_SLOW_INTERVAL_MS);
    expect(intervalOf([RUNNING], 'error', 3)).toBe(DRAFT_POLL_SLOW_INTERVAL_MS);
  });

  it('오류 틱이지만 옛 data 에 생성 중이 없거나 data 자체가 없으면 false', () => {
    expect(intervalOf([DRAFT], 'error', 1)).toBe(false);
    expect(intervalOf(undefined, 'error', 0)).toBe(false);
  });
});

describe('W3 · 전이 판정 — 알리는 것은 PARTIAL → COMPLETE|FAILED 뿐', () => {
  type State = ItineraryGenerationState | undefined;
  it.each<[State, State, 'COMPLETE' | 'FAILED' | null]>([
    ['PARTIAL', 'COMPLETE', 'COMPLETE'],
    ['PARTIAL', 'FAILED', 'FAILED'],
    ['PARTIAL', 'PARTIAL', null],
    ['COMPLETE', 'COMPLETE', null],
    ['COMPLETE', 'PARTIAL', null],
    ['FAILED', 'COMPLETE', null],
    [undefined, 'COMPLETE', null],
    [undefined, 'FAILED', null],
    ['PARTIAL', undefined, null],
  ])('%s → %s = %s', (prev, next, expected) => {
    expect(detectGenerationTransition(prev, next)).toBe(expected);
  });
});

describe('W4 · 그 여행의 진행 화면인가 (셸 폴링 양보 기준)', () => {
  const ID = 'trip-a';
  it.each<[string, string | null | undefined, boolean]>([
    ['생성 중 화면', `/trips/${ID}/itinerary/generating`, true],
    ['초안 화면', `/trips/${ID}/itinerary/draft`, true],
    [
      '같이 짜기 슬롯 채우기',
      `/trips/${ID}/itinerary/copick/2099-06-10%23poi-1`,
      true,
    ],
    [
      '같이 짜기 슬롯(인코딩 전 모양)',
      `/trips/${ID}/itinerary/copick/slot-1`,
      true,
    ],
    [
      '같이 짜기 완성 확인은 진행 화면이 아니다',
      `/trips/${ID}/itinerary/copick/complete`,
      false,
    ],
    ['다른 여행의 초안', `/trips/trip-b/itinerary/draft`, false],
    ['id 가 접두로만 겹치는 다른 여행', `/trips/${ID}b/itinerary/draft`, false],
    ['일정 탭은 진행 화면이 아니다(목록이다)', '/itinerary', false],
    ['홈', '/', false],
    ['여행 중 허브', `/trips/${ID}/live`, false],
    ['생성 방식 고르기', `/trips/${ID}/itinerary/method`, false],
    ['경로를 아직 모른다(null)', null, false],
    ['경로를 아직 모른다(undefined)', undefined, false],
  ])('%s', (_label, pathname, expected) => {
    expect(isGenerationScreenOf(pathname, ID)).toBe(expected);
  });
});

describe('W5 · 완료 토스트를 생략할 자리 — 진행 화면 또는 일정 탭', () => {
  const ID = 'trip-a';
  it.each<[string, string | null | undefined, boolean]>([
    ['일정 탭은 어느 여행이든 생략', '/itinerary', true],
    ['그 여행의 초안 화면', `/trips/${ID}/itinerary/draft`, true],
    ['그 여행의 생성 중 화면', `/trips/${ID}/itinerary/generating`, true],
    ['그 여행의 슬롯 채우기', `/trips/${ID}/itinerary/copick/slot-1`, true],
    [
      '다른 여행의 초안 화면이면 띄운다',
      `/trips/trip-b/itinerary/draft`,
      false,
    ],
    [
      '같이 짜기 완성 확인이면 띄운다',
      `/trips/${ID}/itinerary/copick/complete`,
      false,
    ],
    ['홈이면 띄운다', '/', false],
    ['경로를 모르면 띄운다', undefined, false],
  ])('%s', (_label, pathname, expected) => {
    expect(shouldSkipToast(pathname, ID)).toBe(expected);
  });
});
