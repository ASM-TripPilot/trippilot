import fc from 'fast-check';

import { deriveEndsNextDay } from './endsNextDay';
import { suggestNextSlotTime } from './suggestNextSlotTime';

/**
 * TRIP-1009 · B (#080) — 장소 추가 시각 시트의 기본값 제안.
 *
 * 무엇을 보장하나: 새 장소의 기본 시작은 **앞 장소가 끝나는 시각**(간격 0)이고 길이는 1시간이다(01b Q1).
 * 23시 이후에 시작하면 종료가 자정을 넘겨 `00:xx` 가 된다(01b Q2-b). 앞 장소가 없거나 이미 자정을 넘겨
 * 끝나면 옛 기본값 10:00–11:00 으로 돌아간다(01b Q2-a).
 * 결과엔 `endsNextDay` 가 없다 — 그 유도는 TimeSheet 가 `deriveEndsNextDay` 로 한다(한 벌 규칙).
 * 제안값일 뿐이고 최종 판정은 저장 시 서버 재검증이다(INV-2).
 *
 * 3동작: 준비(앞 슬롯) → 실행(suggestNextSlotTime) → 단언(시작·종료).
 */

const FALLBACK = { startAt: '10:00:00', endAt: '11:00:00' };
const HHMMSS = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const pad = (n: number): string => String(n).padStart(2, '0');
const minutesOf = (hhmmss: string): number =>
  Number(hhmmss.slice(0, 2)) * 60 + Number(hhmmss.slice(3, 5));

describe('🔴 U1 · 앞 장소가 끝나는 시각에 시작해 1시간 — 경계 표', () => {
  it.each([
    ['11:00:00', '11:00:00', '12:00:00', '보통'],
    ['09:30:00', '09:30:00', '10:30:00', '30분 단위'],
    ['22:30:00', '22:30:00', '23:30:00', '아직 자정 전'],
    ['22:59:00', '22:59:00', '23:59:00', '경계 직전'],
    ['23:00:00', '23:00:00', '00:00:00', '경계 — 종료가 자정'],
    ['23:30:00', '23:30:00', '00:30:00', '자정을 넘긴다'],
    ['23:59:00', '23:59:00', '00:59:00', '마지막 분'],
  ])(
    '앞 장소 종료 %s → %s–%s (%s)',
    (previousEnd, expectedStart, expectedEnd) => {
      expect(
        suggestNextSlotTime({ endAt: previousEnd, endsNextDay: false })
      ).toEqual({ startAt: expectedStart, endAt: expectedEnd });
    }
  );
});

describe('🔴 U2·U3 · 폴백 10:00–11:00', () => {
  it('U2 · 앞 장소가 없으면(빈 일자 첫 장소) 10:00–11:00', () => {
    expect(suggestNextSlotTime()).toEqual(FALLBACK);
    expect(suggestNextSlotTime(undefined)).toEqual(FALLBACK);
  });

  it('U3 · 앞 장소가 자정을 넘겨 끝나면(01:00 익일) 10:00–11:00', () => {
    expect(
      suggestNextSlotTime({ endAt: '01:00:00', endsNextDay: true })
    ).toEqual(FALLBACK);
  });
});

describe('🔴 P · 임의 시각에서 지키는 성질', () => {
  const previousArb = fc
    .record({
      h: fc.integer({ min: 0, max: 23 }),
      m: fc.integer({ min: 0, max: 59 }),
      s: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ h, m, s }) => `${pad(h)}:${pad(m)}:${pad(s)}`);

  it('P1 · 시작 시·분 = 앞 장소 종료 시·분, 길이는 60분(자정 순환 포함), 형식은 HH:mm:ss', () => {
    fc.assert(
      fc.property(previousArb, (previousEnd) => {
        const next = suggestNextSlotTime({
          endAt: previousEnd,
          endsNextDay: false,
        });

        expect(next.startAt).toMatch(HHMMSS);
        expect(next.endAt).toMatch(HHMMSS);
        expect(next.startAt.slice(0, 5)).toBe(previousEnd.slice(0, 5));
        expect(
          (minutesOf(next.endAt) - minutesOf(next.startAt) + 1440) % 1440
        ).toBe(60);
      })
    );
  });

  it('P2 · 제안이 자정을 넘기는 것(시트의 endsNextDay 유도)은 23시 이후 시작일 때뿐이다', () => {
    fc.assert(
      fc.property(previousArb, (previousEnd) => {
        const next = suggestNextSlotTime({
          endAt: previousEnd,
          endsNextDay: false,
        });

        expect(deriveEndsNextDay(next.startAt, next.endAt)).toBe(
          minutesOf(next.startAt) >= 23 * 60
        );
      })
    );
  });

  it('P3 · 앞 장소가 자정을 넘겨 끝났으면 종료 시각이 무엇이든 폴백이다', () => {
    fc.assert(
      fc.property(previousArb, (previousEnd) => {
        expect(
          suggestNextSlotTime({ endAt: previousEnd, endsNextDay: true })
        ).toEqual(FALLBACK);
      })
    );
  });
});
