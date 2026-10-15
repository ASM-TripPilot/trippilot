import fc from 'fast-check';

import {
  DEFAULT_DAY_END,
  WHEEL_HOURS,
  WHEEL_MINUTES,
  dayWindowFields,
  isDefaultDayWindow,
  normalizeDayWindow,
  summaryDayWindow,
  validateDayWindow,
  type DayWindow,
} from './dayWindow';

const clock = fc.constantFrom(
  ...WHEEL_HOURS.flatMap((hour) =>
    WHEEL_MINUTES.map((minute) => `${hour}:${minute}`)
  )
);
const maybe = (arb: fc.Arbitrary<string>): fc.Arbitrary<string | undefined> =>
  fc.option(arb, { nil: undefined });
const windowArb: fc.Arbitrary<DayWindow> = fc.record({
  dayStartAt: maybe(clock),
  firstDayStartAt: maybe(clock),
  lastDayEndAt: maybe(clock),
});

describe('요청 직렬화 (dayWindowFields)', () => {
  it('아무것도 안 정했으면 키가 하나도 없다', () => {
    expect(Object.keys(dayWindowFields({}))).toHaveLength(0);
  });

  it('정한 값만 실린다 — 값이 undefined 인 키는 만들지 않는다', () => {
    const fields = dayWindowFields({
      dayStartAt: '11:00',
      firstDayStartAt: undefined,
      lastDayEndAt: '16:00',
    });
    expect(fields).toEqual({ dayStartAt: '11:00', lastDayEndAt: '16:00' });
    expect('firstDayStartAt' in fields).toBe(false);
  });

  it('하루 시작이 기본 09:00 이면 지운다(서버 기본과 같다)', () => {
    expect(dayWindowFields({ dayStartAt: '09:00' })).toEqual({});
  });

  it('PBT — 결과 키는 정한 값의 키뿐이고 값은 그대로, 안 정한 칸이 빈 문자열로 채워지지 않는다', () => {
    fc.assert(
      fc.property(windowArb, (window) => {
        const fields = dayWindowFields(window);
        for (const [key, value] of Object.entries(fields)) {
          expect(value).toBe(window[key as keyof DayWindow]);
          expect(value).not.toBe('');
        }
        if (window.firstDayStartAt === undefined) {
          expect('firstDayStartAt' in fields).toBe(false);
        }
        if (window.lastDayEndAt === undefined) {
          expect('lastDayEndAt' in fields).toBe(false);
        }
        expect(normalizeDayWindow(fields)).toEqual(fields);
      })
    );
  });
});

describe('검증 (validateDayWindow)', () => {
  it('당일치기: 끝 ≤ 시작이면 막고, 끝 > 시작이면 통과한다', () => {
    expect(
      validateDayWindow(
        { firstDayStartAt: '18:00', lastDayEndAt: '10:00' },
        true
      )
    ).toEqual(['END_NOT_AFTER_START']);
    expect(
      validateDayWindow(
        { firstDayStartAt: '10:00', lastDayEndAt: '10:00' },
        true
      )
    ).toEqual(['END_NOT_AFTER_START']);
    expect(
      validateDayWindow(
        { firstDayStartAt: '10:00', lastDayEndAt: '18:00' },
        true
      )
    ).toEqual([]);
  });

  it('당일치기: 한쪽만 정해도 기본값과 견줘 막는다(시작 22:00 · 종료 기본 21:00)', () => {
    expect(validateDayWindow({ firstDayStartAt: '22:00' }, true)).toEqual([
      'END_NOT_AFTER_START',
    ]);
    expect(validateDayWindow({}, true)).toEqual([]);
  });

  it('여러 날: 하루 시작이 일과 종료(21:00) 이후면 막는다', () => {
    expect(validateDayWindow({ dayStartAt: '21:00' }, false)).toEqual([
      'DAY_START_AFTER_END',
    ]);
    expect(validateDayWindow({ dayStartAt: '20:30' }, false)).toEqual([]);
  });

  it('여러 날: 하루 시작이 마지막 날 종료 이후여도 막는다', () => {
    expect(
      validateDayWindow({ dayStartAt: '17:00', lastDayEndAt: '16:00' }, false)
    ).toEqual(['DAY_START_AFTER_END']);
  });

  it('PBT — 당일치기 통과 ⟺ 실효 시작 < 실효 종료', () => {
    fc.assert(
      fc.property(windowArb, (window) => {
        const start = window.firstDayStartAt ?? window.dayStartAt ?? '09:00';
        const end = window.lastDayEndAt ?? DEFAULT_DAY_END;
        expect(validateDayWindow(window, true).length === 0).toBe(start < end);
      })
    );
  });

  it('PBT — 여러 날 통과하면 하루 시작은 항상 종료보다 이르다', () => {
    fc.assert(
      fc.property(windowArb, (window) => {
        if (validateDayWindow(window, false).length === 0) {
          const start = window.dayStartAt ?? '09:00';
          expect(start < DEFAULT_DAY_END).toBe(true);
          expect(start < (window.lastDayEndAt ?? DEFAULT_DAY_END)).toBe(true);
        }
      })
    );
  });
});

describe('행 요약 (summaryDayWindow)', () => {
  it('기본: 09:00 시작 + 기본', () => {
    expect(summaryDayWindow({}, false)).toEqual({
      main: '09:00 시작',
      sub: '기본',
    });
  });

  it('하루 시작만 바꿨으면 보조 줄이 없다', () => {
    expect(summaryDayWindow({ dayStartAt: '11:00' }, false)).toEqual({
      main: '11:00 시작',
    });
  });

  it('설정한 것만 보조로 단다', () => {
    expect(
      summaryDayWindow(
        {
          dayStartAt: '11:00',
          firstDayStartAt: '14:00',
          lastDayEndAt: '16:00',
        },
        false
      )
    ).toEqual({
      main: '11:00 시작',
      sub: '첫날 14:00부터 · 마지막 날 16:00까지',
    });
    expect(summaryDayWindow({ lastDayEndAt: '16:00' }, false)).toEqual({
      main: '09:00 시작',
      sub: '마지막 날 16:00까지',
    });
  });

  it('당일치기는 첫날 시작이 main, 종료가 보조', () => {
    expect(
      summaryDayWindow(
        { firstDayStartAt: '10:00', lastDayEndAt: '18:00' },
        true
      )
    ).toEqual({ main: '10:00 시작', sub: '18:00까지' });
  });

  it('깨진 창이면 확인 안내를 단다', () => {
    expect(summaryDayWindow({}, true, true).sub).toBe(
      '시작·종료 시각을 확인해 주세요'
    );
  });

  it('PBT — 소요시간 표기(N시간)가 나오지 않는다(INV-3)', () => {
    fc.assert(
      fc.property(windowArb, fc.boolean(), (window, sameDay) => {
        const line = summaryDayWindow(window, sameDay);
        expect(`${line.main} ${line.sub ?? ''}`).not.toMatch(/\d시간/);
      })
    );
  });

  it('isDefaultDayWindow — 09:00 명시도 기본이다', () => {
    expect(isDefaultDayWindow({ dayStartAt: '09:00' })).toBe(true);
    expect(isDefaultDayWindow({ lastDayEndAt: '18:00' })).toBe(false);
  });
});
