/**
 * @jest-environment node
 */
import type {
  ReplanDeferredPlace,
  ReplanDiffSlot,
  ReplanSession,
} from '@/shared/api/index.schemas';

import {
  buildDeferredRows,
  deferredFailureText,
  includeMissingText,
  isIncludeMissing,
  isPastDayRetryConflict,
  isStaleApplyError,
  reopenRequestParams,
  RETRY_FAILED,
  RETRY_PAST_DAY,
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

/**
 * TRIP-1782 — 다른 날로 집은 곳(`deferredPlaces`) 안내 줄·버튼·요청 바디(순수).
 *
 * 무엇을 보장하나:
 *  - 항목마다 한 줄·한 버튼(같은 날이어도 묶지 않는다). 줄 key 는 poiId(서버가 같은 곳을 두 날로 말하면 처음 날만 싣는다).
 *  - 문구 `‘{name}’{은|는} {M}월 {D}일({N}일차) 요청이라 이번엔 넣지 않았어요` · 버튼 `{N}일차에 넣어 다시 짜기`.
 *    `M월 D일` 은 0 패딩·요일 없음, N일차는 달력 산술(월·해 넘김 안전). 시작일을 모르면 일차만 빠진다(줄·버튼은 남는다).
 *  - 요청 바디는 `{scope:'FULL_DAY', targetDate:<그 항목 날>, freeText:'<name> 꼭', …빈 배열·null}` 정확히 — 원 세션의
 *    사유·문장·트리거를 받지 않으므로 "내일" 같은 날 말이 섞일 길이 없다(받는 인자가 장소·시작일뿐).
 *  - 실패 문구는 상태 코드로만 가른다(409 → 지난 날/기간 밖 안내, 그 밖 → 시작 실패) — 세션 날짜를 안 본다.
 */
describe('🔴 buildDeferredRows — 항목마다 한 줄·한 버튼', () => {
  const place = (
    name: string,
    date: string,
    poiId = `poi-${name}`
  ): ReplanDeferredPlace => ({ poiId, name, date });

  it('X1 줄·버튼 문구와 key(poiId) — 받침 있는 이름은 은, 같은 달', () => {
    const rows = buildDeferredRows(
      [place('서울광장', '2026-11-06')],
      '2026-11-05'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('poi-서울광장');
    expect(rows[0].text).toBe(
      '‘서울광장’은 11월 6일(2일차) 요청이라 이번엔 넣지 않았어요'
    );
    expect(rows[0].buttonLabel).toBe('2일차에 넣어 다시 짜기');
  });

  it.each([
    ['서울광장', '은'],
    ['광안리 해변', '은'],
    ['남산타워', '는'],
    ['해운대 바다', '는'],
    ['Cafe', '은(는)'],
  ])(
    'X2 이름 ‘%s’ → 조사 %s (끝 글자 받침 기준, 한글 아니면 병기)',
    (name, particle) => {
      const [row] = buildDeferredRows(
        [place(name, '2026-11-06')],
        '2026-11-05'
      );

      expect(row.text.startsWith(`‘${name}’${particle} 11월 6일(2일차)`)).toBe(
        true
      );
    }
  );

  it.each([
    ['같은 달', '2026-11-05', '2026-11-06', '11월 6일', '2일차'],
    ['시작 당일', '2026-11-05', '2026-11-05', '11월 5일', '1일차'],
    ['월 넘김', '2026-10-30', '2026-11-02', '11월 2일', '4일차'],
    ['해 넘김', '2026-12-30', '2027-01-02', '1월 2일', '4일차'],
    ['0 패딩 없음', '2026-03-01', '2026-03-05', '3월 5일', '5일차'],
  ])('X3 %s — %s → %s (요일·0 패딩 없음)', (_name, start, date, md, nth) => {
    const [row] = buildDeferredRows([place('서울광장', date)], start);

    expect(row.text).toBe(
      `‘서울광장’은 ${md}(${nth}) 요청이라 이번엔 넣지 않았어요`
    );
    expect(row.buttonLabel).toBe(`${nth}에 넣어 다시 짜기`);
  });

  it('X4 시작일을 모르면 일차만 빠진다 — 줄은 남고 버튼은 「그날 넣어 다시 짜기」', () => {
    const [row] = buildDeferredRows(
      [place('서울광장', '2026-11-06')],
      undefined
    );

    expect(row.text).toBe(
      '‘서울광장’은 11월 6일 요청이라 이번엔 넣지 않았어요'
    );
    expect(row.buttonLabel).toBe('그날 넣어 다시 짜기');
    // 시작일을 몰라도 요청은 같은 모양이다(버튼은 동작한다).
    expect(row.request.targetDate).toBe('2026-11-06');
  });

  it('X5 요청 바디 — FULL_DAY · 그 항목의 날 · "<name> 꼭" · 나머지는 빈 값, 날 말·다른 키 없음', () => {
    const [row] = buildDeferredRows(
      [place('서울광장', '2026-11-06')],
      '2026-11-05'
    );

    expect(row.request).toStrictEqual({
      scope: 'FULL_DAY',
      targetDate: '2026-11-06',
      originKind: null,
      reasons: [],
      directives: [],
      freeText: '서울광장 꼭',
      excludedPoiIds: [],
      triggerId: null,
    });
  });

  it('X6 항목이 여럿이면 순서대로 한 줄씩 — 같은 날이어도 묶지 않고 각자 자기 이름·날로 요청한다', () => {
    const rows = buildDeferredRows(
      [
        place('서울광장', '2026-11-06'),
        place('남산타워', '2026-11-06'),
        place('경복궁', '2026-11-07'),
      ],
      '2026-11-05'
    );

    expect(rows.map((r) => r.key)).toEqual([
      'poi-서울광장',
      'poi-남산타워',
      'poi-경복궁',
    ]);
    expect(rows.map((r) => r.request.freeText)).toEqual([
      '서울광장 꼭',
      '남산타워 꼭',
      '경복궁 꼭',
    ]);
    expect(rows.map((r) => r.request.targetDate)).toEqual([
      '2026-11-06',
      '2026-11-06',
      '2026-11-07',
    ]);
    expect(rows.map((r) => r.buttonLabel)).toEqual([
      '2일차에 넣어 다시 짜기',
      '2일차에 넣어 다시 짜기',
      '3일차에 넣어 다시 짜기',
    ]);
  });

  it('X6b 같은 poiId 가 두 날짜로 오면 처음 것 하나만 — 서버 「처음 말한 날」 규칙과 같다(줄 key 가 겹치지 않는다)', () => {
    const rows = buildDeferredRows(
      [
        place('서울광장', '2026-11-06', 'poi-dup'),
        place('서울광장', '2026-11-08', 'poi-dup'),
        place('남산타워', '2026-11-07'),
      ],
      '2026-11-05'
    );

    expect(rows.map((r) => r.key)).toEqual(['poi-dup', 'poi-남산타워']);
    expect(rows[0].request.targetDate).toBe('2026-11-06');
    expect(rows[0].buttonLabel).toBe('2일차에 넣어 다시 짜기');
  });

  it.each([
    ['undefined', undefined],
    ['빈 배열', []],
  ])('X7 %s 이면 줄이 없다', (_name, places) => {
    expect(buildDeferredRows(places, '2026-11-05')).toEqual([]);
  });

  it('X8 줄·버튼 어디에도 소요시간 표현이 없다(INV-3)', () => {
    const rows = buildDeferredRows(
      [place('서울광장', '2026-11-06'), place('남산타워', '2026-11-07')],
      '2026-11-05'
    );

    for (const row of rows) {
      expect(`${row.text} ${row.buttonLabel}`).not.toMatch(
        /(\d+\s*분|\d+\s*시간|소요)/
      );
    }
  });
});

describe('🔴 deferredFailureText — 실패 문구는 상태 코드로 가른다', () => {
  it('Y1 두 문구는 뷰가 쓰던 값 그대로다(세 번째 사본을 만들지 않고 한 곳으로 모았다)', () => {
    expect(RETRY_FAILED).toBe(
      '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요'
    );
    expect(RETRY_PAST_DAY).toBe(
      '아직 일정이 없는 날이거나 여행 기간이 아니라서 AI가 다시 짤 수 없어요'
    );
  });

  it('Y2 409 → 지난 날/기간 밖 안내 (오류 코드·세션 날짜 없이 상태 코드만으로)', () => {
    expect(deferredFailureText(axios409())).toBe(RETRY_PAST_DAY);
    expect(deferredFailureText(axios409('CONFLICT'))).toBe(RETRY_PAST_DAY);
  });

  it.each([
    [
      '500',
      {
        isAxiosError: true,
        response: { status: 500, data: {} },
      },
    ],
    ['네트워크(응답 없음)', { isAxiosError: true, message: 'Network Error' }],
    ['axios 아님', new Error('409')],
    ['없음', null],
    ['undefined', undefined],
  ])('Y3 %s → 시작 실패 문장', (_name, error) => {
    expect(deferredFailureText(error)).toBe(RETRY_FAILED);
  });
});
