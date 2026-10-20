/**
 * @jest-environment node
 */
import type { ReplanDiffSlot, ReplanSession } from '@/shared/api/index.schemas';

import {
  includeMissingText,
  isIncludeMissing,
  isStaleApplyError,
  staleRetryRequest,
} from './draftNotice';

/**
 * 상황 감지 FE-B · frontend-components §3.6 — i06 최소 변경의 판정(순수).
 *
 * 무엇을 보장하나:
 *  - 낡음 = apply 409 **이고** 오류 코드가 `EXPIRED`·`STALE` 일 때만(BR-SA-19 · INV-SA-7). 다른 409·5xx·네트워크는 일반 실패다
 *    — 409 를 일반 실패로 접지도, 일반 실패를 낡음으로 부풀리지도 않는다.
 *  - [새 대안 보기] = 같은 입력(사유·지시·제외·범위·날짜·트리거·자유 입력)으로 새 세션 봉투. 날짜는 오늘이면 싣지 않고
 *    (생략 = 오늘), 오늘이 아니면 그 날 + FULL_DAY. 출발 좌표는 싣지 않는다 — 서버 사다리가 그때 다시 정한다.
 *  - 미포함 = 넣으려던 POI 가 초안 `after` 의 어느 slotKey 에도 없을 때. 안내 조사는 장소명 끝 글자 받침에 맞춘다(은/는),
 *    한글이 아니면 `은(는)` 병기, 이름을 모르면 이름 없는 문장.
 */

const axios409 = (code?: string) => ({
  isAxiosError: true,
  response: {
    status: 409,
    data: code === undefined ? {} : { error: { code, message: '…' } },
  },
});

describe('🔴 isStaleApplyError — 409 EXPIRED·STALE 만 낡음', () => {
  it.each(['EXPIRED', 'STALE'])('N1 409 + %s → 낡음', (code) => {
    expect(isStaleApplyError(axios409(code))).toBe(true);
  });

  it.each([
    ['409 코드 없음(초안 없음·일정 교체)', axios409()],
    ['409 다른 코드', axios409('CONFLICT')],
    [
      '500 + STALE',
      {
        isAxiosError: true,
        response: { status: 500, data: { error: { code: 'STALE' } } },
      },
    ],
    ['네트워크(응답 없음)', { isAxiosError: true, message: 'Network Error' }],
    ['axios 아님', new Error('STALE')],
    ['없음', null],
  ])('N2 %s → 낡음 아님', (_name, error) => {
    expect(isStaleApplyError(error)).toBe(false);
  });
});

const session = (over: Partial<ReplanSession> = {}): ReplanSession =>
  ({
    sessionId: 'sys-1',
    tripId: 't1',
    itineraryId: 'it1',
    triggerId: 'trg-1',
    scope: 'PARTIAL_SLOTS',
    targetDate: '2026-10-19',
    fromInstant: '2026-10-18T11:15:00Z',
    originKind: 'LAST_VISIT',
    originLat: 33.4,
    originLng: 126.5,
    originEstimated: true,
    reasons: ['TEMP_CLOSED'],
    directives: ['AVOID_OUTDOOR'],
    freeText: null,
    excludedPoiIds: ['poi-closed'],
    status: 'DRAFT',
    createdAt: '2026-10-18T11:16:00Z',
    initiatedBy: 'SYSTEM',
    stale: true,
    ...over,
  }) as ReplanSession;

describe('🔴 staleRetryRequest — 같은 입력으로 새 세션', () => {
  it('R1 오늘 세션 — 사유·지시·제외·범위·트리거 그대로, 날짜·좌표 키 없음', () => {
    expect(staleRetryRequest(session(), '2026-10-19')).toEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: null,
      reasons: ['TEMP_CLOSED'],
      directives: ['AVOID_OUTDOOR'],
      freeText: null,
      excludedPoiIds: ['poi-closed'],
      triggerId: 'trg-1',
    });
  });

  it('R2 오늘이 아닌 세션 — 그 날짜 + FULL_DAY', () => {
    expect(
      staleRetryRequest(
        session({ targetDate: '2026-10-20', scope: 'FULL_DAY' }),
        '2026-10-19'
      )
    ).toEqual({
      scope: 'FULL_DAY',
      originKind: null,
      reasons: ['TEMP_CLOSED'],
      directives: ['AVOID_OUTDOOR'],
      freeText: null,
      excludedPoiIds: ['poi-closed'],
      triggerId: 'trg-1',
      targetDate: '2026-10-20',
    });
  });

  it('R3 비어 있는 입력·자유 입력도 그대로 싣는다(트리거 없는 세션은 null)', () => {
    expect(
      staleRetryRequest(
        session({
          reasons: undefined,
          directives: undefined,
          excludedPoiIds: undefined,
          freeText: '바다 보이는 곳',
          triggerId: null,
        }),
        '2026-10-19'
      )
    ).toMatchObject({
      reasons: [],
      directives: [],
      excludedPoiIds: [],
      freeText: '바다 보이는 곳',
      triggerId: null,
    });
  });
});

const slot = (slotKey: string): ReplanDiffSlot =>
  ({
    slotKey,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
  }) as ReplanDiffSlot;

describe('🔴 isIncludeMissing — 넣으려던 POI 가 초안에 없나', () => {
  const AFTER = [slot('2026-10-19#p1'), slot('2026-10-19#poi-sky')];

  it('I1 초안 after 에 있으면 false, 없으면 true', () => {
    expect(isIncludeMissing('poi-sky', AFTER)).toBe(false);
    expect(isIncludeMissing('poi-sea', AFTER)).toBe(true);
  });

  it('I2 넣으려던 POI 가 없으면(일반 재계획) 늘 false', () => {
    expect(isIncludeMissing(undefined, [])).toBe(false);
    expect(isIncludeMissing('', AFTER)).toBe(false);
  });

  it('I3 깨진 slotKey 는 그 POI 로 치지 않는다', () => {
    expect(isIncludeMissing('poi-sky', [slot('poi-sky')])).toBe(true);
  });
});

describe('🔴 includeMissingText — 받침에 맞춘 조사', () => {
  it.each([
    ['하늘공원', '‘하늘공원’은 이번 안에 넣지 못했어요.'],
    ['성산일출봉', '‘성산일출봉’은 이번 안에 넣지 못했어요.'],
    ['카페 노티드', '‘카페 노티드’는 이번 안에 넣지 못했어요.'],
    ['부산 비엔날레', '‘부산 비엔날레’는 이번 안에 넣지 못했어요.'],
    ['Cafe 1', '‘Cafe 1’은(는) 이번 안에 넣지 못했어요.'],
  ])('T1 "%s" → %s', (name, expected) => {
    expect(includeMissingText(name)).toBe(expected);
  });

  it('T2 이름을 모르면 이름 없는 문장이다', () => {
    expect(includeMissingText(null)).toBe(
      '넣으려던 장소는 이번 안에 넣지 못했어요.'
    );
  });
});
