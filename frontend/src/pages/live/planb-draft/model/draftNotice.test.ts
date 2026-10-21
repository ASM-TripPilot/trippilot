/**
 * @jest-environment node
 */
import type { ReplanDiffSlot, ReplanSession } from '@/shared/api/index.schemas';

import {
  includeMissingText,
  isIncludeMissing,
  isPastDayRetryConflict,
  isStaleApplyError,
  reopenRequestParams,
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
 *  - 그 재요청이 지난 날이라 막혔다 = 지난 날 세션(날짜 < 오늘) **이고** 409 일 때만. 오늘·앞날·날짜 없음의 409(경합 등)와
 *    지난 날의 5xx·네트워크는 아니다 — 다시 눌러 볼 일을 날짜 탓으로 돌리지 않는다.
 *  - 미포함 = 넣으려던 POI 가 초안 `after` 의 어느 slotKey 에도 없을 때. 안내 조사는 장소명 끝 글자 받침에 맞춘다(은/는),
 *    한글이 아니면 `은(는)` 병기, 이름을 모르면 이름 없는 문장.
 *  - [조건 바꿔 다시 짜기](대안 없음) = 같은 입력을 시드로, 같은 트리거에 이어 여는 i04 라우트 쿼리. 시드 세 키는 비어도
 *    싣고(라우트가 게이트 대신 i04 로 보내는 표지), 날짜는 오늘이 아니면만·범위는 오늘이면만 싣는다.
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

describe('🔴 isPastDayRetryConflict — 지난 날 세션의 재요청 409 만 날짜 탓', () => {
  // 서버의 지난 날 거절(ReplanSessionService.resolveTargetDate)은 일반 CONFLICT 다 — 경합 409 와 코드가 같다.
  const conflict = axios409('CONFLICT');
  const TODAY = '2026-10-19';

  it('D1 어제 세션 + 409 → 지난 날이라 막혔다', () => {
    expect(
      isPastDayRetryConflict(
        conflict,
        session({ targetDate: '2026-10-18' }),
        TODAY
      )
    ).toBe(true);
  });

  it.each([
    ['오늘', '2026-10-19'],
    ['내일', '2026-10-20'],
    ['날짜 없음(옛 서버)', ''],
  ])(
    'D2 %s 세션의 409 는 날짜 탓이 아니다(경합 409 는 다시 누르면 된다)',
    (_name, targetDate) => {
      expect(
        isPastDayRetryConflict(conflict, session({ targetDate }), TODAY)
      ).toBe(false);
    }
  );

  it.each([
    ['500', { isAxiosError: true, response: { status: 500, data: {} } }],
    ['네트워크(응답 없음)', { isAxiosError: true, message: 'Network Error' }],
    ['axios 아님', new Error('409')],
    ['없음', null],
  ])('D3 어제 세션 + %s → 날짜 탓 아님', (_name, error) => {
    expect(
      isPastDayRetryConflict(
        error,
        session({ targetDate: '2026-10-18' }),
        TODAY
      )
    ).toBe(false);
  });
});

describe('🔴 reopenRequestParams — 같은 입력을 시드로, 같은 트리거의 i04', () => {
  it('Q1 오늘 세션 — 사유·지시·제외(쉼표)·트리거·범위·자유 입력, 날짜 키 없음', () => {
    expect(
      reopenRequestParams(
        session({
          reasons: ['WEATHER', 'TIRED'],
          directives: ['INDOOR', 'LESS_MOVE'],
          excludedPoiIds: ['poi-a', 'poi-b'],
          freeText: '카페로만',
        }),
        '2026-10-19'
      )
    ).toEqual({
      seedReasons: 'WEATHER,TIRED',
      seedDirectives: 'INDOOR,LESS_MOVE',
      seedExcludedPoiIds: 'poi-a,poi-b',
      triggerId: 'trg-1',
      scope: 'PARTIAL_SLOTS',
      prefill: '카페로만',
    });
  });

  it('Q2 오늘이 아닌 세션 — 그 날짜를 싣고 범위는 싣지 않는다(i04 가 그 날 FULL_DAY 로 고정)', () => {
    const params = reopenRequestParams(
      session({ targetDate: '2026-10-20', scope: 'FULL_DAY' }),
      '2026-10-19'
    );

    expect(params).toMatchObject({ targetDate: '2026-10-20' });
    expect(params).not.toHaveProperty('scope');
  });

  it('Q3 입력이 비어도 시드 세 키는 빈 문자열로 싣고, 트리거·자유 입력이 없으면 그 키가 없다', () => {
    expect(
      reopenRequestParams(
        session({
          reasons: undefined,
          directives: [],
          excludedPoiIds: undefined,
          freeText: null,
          triggerId: null,
        }),
        '2026-10-19'
      )
    ).toEqual({
      seedReasons: '',
      seedDirectives: '',
      seedExcludedPoiIds: '',
      scope: 'PARTIAL_SLOTS',
    });
  });

  it('Q4 넣으려던 POI 는 그대로 잇는다(서버엔 안 보내고 i05 → i06 미포함 안내까지)', () => {
    expect(
      reopenRequestParams(session(), '2026-10-19', 'poi-sky')
    ).toMatchObject({ includePoiId: 'poi-sky' });
    expect(reopenRequestParams(session(), '2026-10-19')).not.toHaveProperty(
      'includePoiId'
    );
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
