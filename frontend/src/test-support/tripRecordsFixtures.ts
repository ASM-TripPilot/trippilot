/**
 * j01 방문 기록(`TripRecordsPage.integration`) 응답 픽스처 — 묶음마다 복사돼 있던 일정 봉투·슬롯·완료 방문 빌더를 한 곳에.
 *
 * 시간대 주의: 이 빌더는 문자열만 만든다(시계를 안 건드린다). 기기 시간대를 LA 로 바꾸는 `@jest-environment` docblock 은
 * **그 테스트 파일의 첫 주석이어야 먹는다** — 소비 파일 맨 위에 그대로 둔다(`TripRecordsPage.integration.test.tsx`).
 * 방문 시각 문자열의 `Z` 유무가 곧 "서울 시계로 읽는가"를 가르므로 빌더 인자로 받은 값을 가공하지 않는다.
 *
 * 모양은 스키마 필수 최소값이다 — `as const`/단언 없이 msw `HttpResponse.json` 에 그대로 실린다.
 */
import { http, HttpResponse } from 'msw';

import type { ActualVisit, TripRecord } from '@/shared/api/index.schemas';

export interface DaySlotFixture {
  poiId: string;
  nameKo: string;
  startAt: string;
  endAt: string;
  isFixed: boolean;
  endsNextDay: boolean;
  hasViolation: boolean;
  tags: string[];
}

/** 일정 한 칸 — 기본 10:00~11:00. 좌표 등 추가 필드는 `over` 로 얹는다. */
export function daySlot<T extends object = object>(
  poiId: string,
  nameKo: string,
  over: Partial<DaySlotFixture> & T = {} as T
): DaySlotFixture & T {
  return {
    poiId,
    nameKo,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  } as DaySlotFixture & T;
}

/** 시작=끝 시각인 일정 칸(시각 차이가 의미 없는 묶음용). */
export function daySlotAt(poiId: string, nameKo: string, startAt: string) {
  return daySlot(poiId, nameKo, { startAt, endAt: startAt });
}

/** `GET /trips/{id}/itinerary` 봉투 — 확정 일정. `days` 만 묶음이 정한다. */
export function tripItinerary<D extends { date: string; slots: unknown[] }>(
  days: D[],
  tripId = 't1'
) {
  return {
    itineraryId: 'it1',
    tripId,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days,
  };
}

/** 완료 방문(도착 14:20 · 완료 15:20, 시계 접미사 없음) — 완료 카드라야 사진/메모 슬롯이 붙는다. */
export function completedVisitOn(
  visitCheckId: string,
  day: string,
  poiId: string
) {
  return {
    visitCheckId,
    slotKey: `${day}#${poiId}`,
    poiId,
    arrivedAt: `${day}T14:20:00`,
    completedAt: `${day}T15:20:00`,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: `${day}T15:20:00`,
  };
}

/**
 * `GET /trips/{id}/records` 의 실적 한 줄(TRIP-1415) — 메모 시드가 읽는 것은 `visitCheckId`·`memo` 뿐이다.
 * `hasMemo` 는 memo 와 맞춰 두되 `over` 로 어긋나게 만들 수 있다("있다고는 하는데 본문이 없는" 방문).
 */
export function actualVisit(
  visitCheckId: string,
  memo: string | null,
  over: Partial<ActualVisit> = {}
): ActualVisit {
  return {
    visitCheckId,
    slotKey: null,
    poiId: `poi-${visitCheckId}`,
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    spontaneous: false,
    photoCount: 0,
    memo,
    hasMemo: memo !== null,
    updatedAt: '2026-08-20T05:00:00Z',
    ...over,
  };
}

/** `TripRecord` 봉투 — 날짜 묶음의 실적만 관점이 정한다(계획·미방문·변경 이력은 비운다). */
export function tripRecord(
  days: { date: string; actual: ActualVisit[] }[],
  tripId = 't1'
): TripRecord {
  return {
    tripId,
    days: days.map(({ date, actual }) => ({
      date,
      planned: [],
      actual,
      unvisitedSlotKeys: [],
    })),
    changes: [],
  };
}

const BASE = 'http://localhost:8080/api/v1';

/**
 * records GET 핸들러 — 기본은 실적 0건(서버 메모 없음). 메모를 보는 화면(j01 카드·허브 박스·시트)은 이 응답이 와야
 * 입력이 열린다(TRIP-1415 잠금). 응답을 늦추거나 실패시키려면 `reply` 를 준다.
 */
export function recordsHandler(
  reply: () => Response | Promise<Response> = () =>
    HttpResponse.json(tripRecord([]))
) {
  return http.get(`${BASE}/trips/:tripId/records`, () => reply());
}

/**
 * TRIP-1557 — j01 하단 바의 「요약」 칸이 `GET /trips/{tripId}/summary` 를 조회한다. `onUnhandledRequest:'error'` 통합 버킷에서
 * `TripRecordsPage` 를 마운트하는 파일은 이 핸들러가 없으면 준비 단계에서 죽는다 — 기본은 여행 중(`ready:false`, 서버는 404 가 아니라
 * 200 으로 준다). 준비됨·지연·실패를 보려면 `reply` 를 준다.
 */
export function summaryHandler(
  reply: () => Response | Promise<Response> = () =>
    HttpResponse.json({ ready: false })
) {
  return http.get(`${BASE}/trips/:tripId/summary`, () => reply());
}
