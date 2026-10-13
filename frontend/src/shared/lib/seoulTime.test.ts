/**
 * @jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs
 */
import fc from 'fast-check';

import { seoulDate, seoulInstant, seoulTime } from './seoulDate';

/**
 * TRIP-1069 · AC-1·AC-2·AC-3·AC-6 — 순간 ↔ 서울 벽시계 시각.
 *
 * 무엇을 보장하나:
 *  - `seoulTime(순간)` 은 그 순간을 서울 시계로 읽은 'HH:mm' 이다. 기기 시간대와 무관하다.
 *  - `seoulInstant(서울 날짜, 서울 'HH:mm')` 은 거꾸로 그 벽시계가 가리키는 UTC 순간(`Z`)이다.
 *  - 둘은 서로의 역이다(분 단위). 서울 00~09시에서도 날짜가 하루 어긋나지 않는다.
 *
 * 기기 시간대는 `__setDeviceTimeZone` 으로 바꾼다(seoulDate.test 선례). 로컬 개발기가 KST 라,
 * 비-KST 에서 돌려야 기기 로컬 getter(`getHours`) 구현이 red 가 된다.
 * 기대값은 정수 산술(에포크 ms)로만 만든다 — 구현과 같은 식(Date getter)을 쓰면 항진명제가 된다.
 */

declare const __setDeviceTimeZone: (tz: string | undefined) => void;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const pad = (n: number) => String(n).padStart(2, '0');

/** 정수 산술 오라클 — 에포크 ms(≥0)를 서울 'HH:mm' 으로. */
function kstClock(epochMs: number): string {
  return `${pad((Math.floor(epochMs / HOUR) + 9) % 24)}:${pad(
    Math.floor(epochMs / MINUTE) % 60
  )}`;
}

const DEVICE_ZONES = [
  'UTC',
  'Asia/Seoul',
  'America/Los_Angeles',
  'Pacific/Kiritimati',
];

const TIME_TABLE: [label: string, iso: string, expected: string][] = [
  ['AC-1 원문 — 13:42Z 는 서울 22:42', '2026-09-28T13:42:00Z', '22:42'],
  ['서울 자정 직전', '2026-08-21T14:59:59Z', '23:59'],
  ['서울 자정', '2026-08-21T15:00:00Z', '00:00'],
  ['서울 오전 09:30', '2026-08-22T00:30:00Z', '09:30'],
  ['서울 새해 00:00', '2026-12-31T15:00:00Z', '00:00'],
];

const INSTANT_TABLE: [label: string, day: string, time: string, iso: string][] =
  [
    ['서울 저녁', '2026-08-20', '22:42', '2026-08-20T13:42:00Z'],
    [
      '서울 자정은 UTC 전날 15시',
      '2026-08-21',
      '00:00',
      '2026-08-20T15:00:00Z',
    ],
    ['서울 새벽 01:30', '2026-08-21', '01:30', '2026-08-20T16:30:00Z'],
    ['서울 새해 00:05', '2027-01-01', '00:05', '2026-12-31T15:05:00Z'],
  ];

afterEach(() => {
  __setDeviceTimeZone(undefined);
});

describe('앵커 — 기기 시간대 전환이 실제로 걸린다', () => {
  it('America/Los_Angeles 기기에서 2026-09-28T13:42Z 는 6시로 읽힌다', () => {
    __setDeviceTimeZone('America/Los_Angeles');
    expect(new Date('2026-09-28T13:42:00Z').getHours()).toBe(6);
  });
});

describe.each(DEVICE_ZONES)('기기 시간대 %s', (zone) => {
  beforeEach(() => {
    __setDeviceTimeZone(zone);
  });

  it.each(TIME_TABLE)(
    'AC-1 seoulTime 경계 표 · %s',
    (_label, iso, expected) => {
      expect(seoulTime(new Date(iso))).toBe(expected);
    }
  );

  it('AC-3 같은 순간이면 소수 자리 유무와 무관하게 같은 HH:mm', () => {
    const forms = [
      '2026-09-28T13:44:05.123456Z',
      '2026-09-28T13:44:05Z',
      '2026-09-28T13:44:05.000Z',
    ];

    expect(forms.map((iso) => seoulTime(new Date(iso)))).toEqual([
      '22:44',
      '22:44',
      '22:44',
    ]);
  });

  it.each(INSTANT_TABLE)(
    'AC-6 seoulInstant 역함수 표 · %s',
    (_label, day, time, iso) => {
      const instant = seoulInstant(day, time);

      expect(instant).toMatch(/Z$/);
      expect(Date.parse(instant)).toBe(Date.parse(iso));
    }
  );

  it('AC-2 PBT — 임의 순간의 seoulTime 은 +9h 정수 오라클과 같다', () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Date.parse('2020-01-01T00:00:00Z'),
          max: Date.parse('2035-12-31T23:59:59Z'),
        }),
        (epochMs) => {
          expect(seoulTime(new Date(epochMs))).toBe(kstClock(epochMs));
        }
      )
    );
  });

  it('AC-2 PBT — seoulInstant(seoulDate(t), seoulTime(t)) 는 t 를 분 단위로 내린 순간이다', () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Date.parse('2020-01-01T00:00:00Z'),
          max: Date.parse('2035-12-31T23:59:59Z'),
        }),
        (epochMs) => {
          const at = new Date(epochMs);
          const instant = seoulInstant(seoulDate(at), seoulTime(at));

          expect(instant).toMatch(/Z$/);
          expect(Date.parse(instant)).toBe(epochMs - (epochMs % MINUTE));
        }
      )
    );
  });

  it('AC-2 PBT — 서울 00~09시 표본에서도 시각·날짜 왕복이 어긋나지 않는다', () => {
    const seoulMidnight2020 = Date.parse('2020-01-01T00:00:00+09:00');
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 9 * 60 - 1 }),
        fc.integer({ min: 0, max: MINUTE - 1 }),
        (dayIndex, kstMinute, jitterMs) => {
          const epochMs =
            seoulMidnight2020 + dayIndex * DAY + kstMinute * MINUTE + jitterMs;
          const at = new Date(epochMs);
          const expectedDay = new Date(
            seoulMidnight2020 + dayIndex * DAY + 9 * HOUR
          )
            .toISOString()
            .slice(0, 10);

          const time = seoulTime(at);
          expect(time).toBe(
            `${pad(Math.floor(kstMinute / 60))}:${pad(kstMinute % 60)}`
          );
          expect(seoulDate(at)).toBe(expectedDay);
          expect(Date.parse(seoulInstant(expectedDay, time))).toBe(
            epochMs - jitterMs
          );
        }
      )
    );
  });
});
