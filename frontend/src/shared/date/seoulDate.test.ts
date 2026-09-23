/**
 * @jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs
 */
import { seoulDate } from './seoulDate';

/**
 * TRIP-506 · AC-1·AC-2 — `seoulDate(now) → 'YYYY-MM-DD'`: 순간을 Asia/Seoul(UTC+9 고정) 달력
 * 날짜로 읽는다. 서버 `TRAVEL_ZONE` 과 같은 기준이라 기기 시간대와 무관해야 한다.
 *
 * 기기 시간대는 `__setDeviceTimeZone` 으로 바꾼다 — 테스트 안의 `process.env.TZ = …` 는 jest 가
 * env 를 사본으로 줘서 `Date` 에 반영되지 않는다(환경 파일 머리 참고). 비-KST 기기에서 돌려야
 * 기기 로컬 getter 구현이 red 가 된다(로컬 개발 기기가 KST 라 그냥 돌리면 통과한다).
 */

declare const __setDeviceTimeZone: (tz: string | undefined) => void;

const BOUNDARY_TABLE: [label: string, iso: string, expected: string][] = [
  ['KST 23:59:59 → 당일', '2026-08-21T14:59:59Z', '2026-08-21'],
  ['KST 00:00 → 다음 날', '2026-08-21T15:00:00Z', '2026-08-22'],
  ['KST 00:30 → 다음 날', '2026-08-21T15:30:00Z', '2026-08-22'],
  ['KST 09:30 → 당일', '2026-08-22T00:30:00Z', '2026-08-22'],
  ['KST 새해 00:00 → 연도 넘어감', '2026-12-31T15:00:00Z', '2027-01-01'],
];

afterEach(() => {
  __setDeviceTimeZone(undefined);
});

describe('AC-1 · 경계 표 (기기 시간대 Asia/Seoul)', () => {
  beforeEach(() => {
    __setDeviceTimeZone('Asia/Seoul');
  });

  it.each(BOUNDARY_TABLE)('%s', (_label, iso, expected) => {
    expect(seoulDate(new Date(iso))).toBe(expected);
  });
});

describe.each([
  ['UTC', 15],
  ['America/Los_Angeles', 8],
])('AC-2 · 기기 시간대 %s 에서도 같은 결과', (deviceTimeZone, localHour) => {
  beforeEach(() => {
    __setDeviceTimeZone(deviceTimeZone);
  });

  // 앵커 — 기기 시간대 전환이 실제로 걸렸는지. 이게 없으면 전환이 죽어도 아래 표가 KST 기기에서 공허하게 통과한다.
  it(`기기 시각이 ${deviceTimeZone} 기준으로 읽힌다 (2026-08-21T15:30Z → ${localHour}시)`, () => {
    expect(new Date('2026-08-21T15:30:00Z').getHours()).toBe(localHour);
  });

  it.each(BOUNDARY_TABLE)('%s', (_label, iso, expected) => {
    expect(seoulDate(new Date(iso))).toBe(expected);
  });
});
