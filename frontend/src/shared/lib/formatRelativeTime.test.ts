import { formatRelativeTime } from './formatRelativeTime';

/**
 * TRIP-576 · l01 · AC-3(메타 상대시각) — `formatRelativeTime(iso, now) → "방금·N분 전·N시간 전·어제·N일 전"`.
 * 알림 메타 `종류 · 상대시각`의 시각 부분을 만드는 순수 함수. `formatKoreanDate`(절대 날짜)와 다른 기능.
 *
 * 무엇을 보장하나(준비: now 와 그로부터 과거 ISO → 실행: formatRelativeTime → 단언: 정확 문자열):
 *  경계를 표로 핀다 — 분·시간은 Math.floor(경과/단위). "N분 전"은 경과 시각이라 INV-3 소요시간과 무관.
 *
 * 3동작 뼈대: 준비=고정 now(2026-08-30T12:00:00Z) + 오프셋 → 실행=formatRelativeTime → 단언=.toBe.
 * (개념) `Date` 산술: 두 시각의 밀리초 차(now − occurred)를 초/분/시간/일로 접는다.
 */

const NOW = new Date('2026-08-30T12:00:00.000Z');
/** now 로부터 ms 만큼 과거의 ISO 문자열. */
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime · 경계 표 (AC-3)', () => {
  it.each([
    ['방금 (30초 전)', 30 * SEC, '방금'],
    ['방금 (59초 전, <1분 경계)', 59 * SEC, '방금'],
    ['1분 전 (60초 정각 경계)', 60 * SEC, '1분 전'],
    ['10분 전', 10 * MIN, '10분 전'],
    ['59분 전 (<1시간 경계)', 59 * MIN, '59분 전'],
    ['2시간 전', 2 * HOUR, '2시간 전'],
    ['23시간 전 (<24시간 경계)', 23 * HOUR, '23시간 전'],
    ['어제 (25시간 전)', 25 * HOUR, '어제'],
    ['3일 전', 3 * DAY, '3일 전'],
  ])('%s → %s', (_label, offset, expected) => {
    expect(formatRelativeTime(ago(offset), NOW)).toBe(expected);
  });
});
