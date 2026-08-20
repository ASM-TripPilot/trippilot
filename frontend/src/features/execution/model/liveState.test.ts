import type { Itinerary } from '@/shared/api/generated/schemas';

import { resolveLiveState } from './liveState';

/**
 * TRIP-395 · resolveLiveState — 여행 중 화면의 상태 판정 1회.
 *
 * *(개념)* 화면은 조회 결과(로딩·오류·데이터)와 "오늘이 여행 구간 안인가"·"활성 트리거가 있나"를
 * 매번 따로 보지 않고, 이 순수 함수가 **한 번에** 하나의 판정으로 접어 준다. 순수를 지키려
 * `todayDate`를 인자로 받는다(`new Date()`를 함수 안에서 만들지 않는다 — 구조가드·테스트 재현성).
 *
 * 3동작 뼈대: 준비=판정 입력 → 실행=resolveLiveState → 단언=반환 kind.
 */

const itinerary = (dates: string[]): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: 't1',
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: dates.map((date) => ({ date, slots: [] })),
  }) as unknown as Itinerary;

const base = {
  isLoading: false,
  isError: false,
  itinerary: itinerary(['2026-08-20', '2026-08-21']),
  todayDate: '2026-08-20',
};

describe('resolveLiveState — 상태 판정', () => {
  it('A1-1 로딩 중이면 loading이다', () => {
    const state = resolveLiveState({ ...base, isLoading: true });
    expect(state).toEqual({ kind: 'loading' });
  });

  it('A1-2 오류면 error다', () => {
    const state = resolveLiveState({ ...base, isError: true });
    expect(state).toEqual({ kind: 'error' });
  });

  it('A1-3 데이터가 없으면 error다 (성공했으나 빈 응답 방어)', () => {
    const state = resolveLiveState({ ...base, itinerary: undefined });
    expect(state).toEqual({ kind: 'error' });
  });

  it('A1-4 오늘이 여행 구간 밖이면 outsideToday다', () => {
    const state = resolveLiveState({ ...base, todayDate: '2026-09-01' });
    expect(state).toEqual({ kind: 'outsideToday' });
  });

  it('A1-5 오늘이 구간 안이면 active + todayIndex를 준다', () => {
    const state = resolveLiveState({ ...base, todayDate: '2026-08-21' });
    expect(state.kind).toBe('active');
    if (state.kind === 'active') {
      expect(state.todayIndex).toBe(1);
      expect(state.hasActiveTrigger).toBe(false);
    }
  });

  it('A1-6 활성 트리거가 있으면 active에서 hasActiveTrigger=true다', () => {
    const state = resolveLiveState({
      ...base,
      activeTriggers: [{ kind: 'WEATHER' }],
    });
    expect(state.kind).toBe('active');
    if (state.kind === 'active') {
      expect(state.hasActiveTrigger).toBe(true);
    }
  });

  it('A1-7 로딩이 오류보다 우선한다', () => {
    const state = resolveLiveState({ ...base, isLoading: true, isError: true });
    expect(state).toEqual({ kind: 'loading' });
  });
});

/**
 * TRIP-395(재정합) · notFound kind 추가 — 404(일정 미생성)를 네트워크 오류(5xx·무응답)와 가른다.
 *
 * *(개념)* 404 는 react-query 에서 `isError=true` 이기도 하다. 그래서 page 가 `isNotFound(error)`
 * (응답 status===404)로 계산해 **`isNotFound` 를 따로 주입**하고, 이 함수가 error 보다 **먼저**
 * notFound 를 낸다. 네트워크 오류(응답 없음)는 page 가 `isNotFound=false`(모름=안전측)를 주므로
 * error 로 남는다. 우선순위: loading > notFound > error > outsideToday > active(겹침 없음).
 *
 * `isNotFound` 는 **옵셔널**(기본 false)이라 위 A1 케이스·기존 소비자를 안 깬다(additive).
 */
describe('resolveLiveState — notFound 판정', () => {
  it('A2-1 404 입력(isNotFound·isError, 데이터 없음)이면 notFound다', () => {
    const state = resolveLiveState({
      ...base,
      isNotFound: true,
      isError: true,
      itinerary: undefined,
    });
    expect(state).toEqual({ kind: 'notFound' });
  });

  it('A2-2 notFound가 error보다 우선한다', () => {
    const state = resolveLiveState({
      ...base,
      isNotFound: true,
      isError: true,
    });
    expect(state).toEqual({ kind: 'notFound' });
  });

  it('A2-3 네트워크 오류(isNotFound=false)는 여전히 error다 (notFound 게이트 미개방)', () => {
    const state = resolveLiveState({
      ...base,
      isNotFound: false,
      isError: true,
      itinerary: undefined,
    });
    expect(state).toEqual({ kind: 'error' });
  });

  it('A2-4 로딩이 notFound보다 우선한다', () => {
    const state = resolveLiveState({
      ...base,
      isLoading: true,
      isNotFound: true,
    });
    expect(state).toEqual({ kind: 'loading' });
  });
});
