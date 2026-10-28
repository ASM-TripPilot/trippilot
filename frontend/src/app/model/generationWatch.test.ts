import {
  getGetTripsQueryKey,
  getGetTripsTripIdBasesQueryKey,
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdQueryKey,
  getGetTripsTripIdRoutesQueryKey,
  getGetTripsTripIdTriggersQueryKey,
} from '@/shared/api/index.hooks';
import type { ItineraryGenerationState } from '@/shared/api/index.schemas';

import {
  GENERATION_COMPLETE_MESSAGE,
  GENERATION_COMPLETE_TOAST_ID,
  GENERATION_FAILED_MESSAGE,
  GENERATION_FAILED_TOAST_ID,
  detectGenerationTransition,
  isGenerationScreenOf,
  shouldSkipToast,
  tripIdFromItineraryKey,
} from './generationWatch';

/**
 * TRIP-1618 — 앱 셸 "생성 완료 감지"의 순수 판정(캐시 키 읽기 · 직전→지금 전이 · 현재 경로가 그 여행의 진행 화면인가).
 *
 * *(개념)* 전이 감지(edge detection) = "지금 값"이 아니라 "직전 값 → 지금 값"의 변화만 본다. 같은 응답이 반복돼도 알림이 한 번뿐인 이유다.
 *
 * 무엇을 보장하나:
 *  - W1 토스트 두 문구는 확정값이고 소요시간 표현이 없다(INV-3, AC5).
 *  - W2 캐시 칸이 일정 칸인지 읽는 규칙이 코드젠 키 함수의 실제 출력과 맞물려 있다 — 코드젠이 키 모양을 바꾸면 여기서 빨개진다
 *    (안 그러면 셸이 조용히 0건을 감시한다).
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

describe('W2 · 일정 캐시 칸 읽기 — 코드젠 키 함수의 출력과 맞물린다', () => {
  it('일정 키에서는 tripId 를 돌려준다', () => {
    expect(
      tripIdFromItineraryKey(getGetTripsTripIdItineraryQueryKey('trip-x'))
    ).toBe('trip-x');
    expect(
      tripIdFromItineraryKey(
        getGetTripsTripIdItineraryQueryKey(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        )
      )
    ).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it.each<[string, readonly unknown[]]>([
    ['여행 목록', getGetTripsQueryKey()],
    ['여행 단건', getGetTripsTripIdQueryKey('trip-x')],
    ['기점', getGetTripsTripIdBasesQueryKey('trip-x')],
    ['경로', getGetTripsTripIdRoutesQueryKey('trip-x')],
    ['트리거', getGetTripsTripIdTriggersQueryKey('trip-x')],
    ['빈 키', []],
    ['문자열이 아닌 요소', [{ id: 'trip-x' }]],
    ['일정 키 뒤에 요소가 더 붙은 키', [`/trips/trip-x/itinerary`, 'extra']],
  ])('일정 칸이 아니면(%s) null', (_label, key) => {
    expect(tripIdFromItineraryKey(key)).toBeNull();
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
