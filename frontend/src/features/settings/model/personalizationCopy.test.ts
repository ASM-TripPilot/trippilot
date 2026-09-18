import { PersonalizationInfoReason } from '@/shared/api/generated/schemas';

import { personalizationCopy } from './personalizationCopy';

/**
 * TRIP-612 · l05 개인화 — reason → 안내 문구(또는 없음) 순수 함수(AC-8).
 *
 * 무엇을 보장하나:
 *  - reason 3값(APPLIED·CONSENT_MISSING·NOT_ENOUGH_RECORDS)이 문구표를 **그대로** 반환한다.
 *  - APPLIED 는 문구가 없다(null) — 목록이 대신 말한다(01b Q4, 발명 문구 회피).
 *  - ★함정: NOT_ENOUGH_RECORDS 는 **이미 동의한** 사용자라 "동의하면…"류를 절대 내지 않는다(BR-U5-44).
 *    화면(PersonalizationScreen.test)뿐 아니라 이 순수 함수 층에서도 함께 못박는다.
 *
 * (개념) 매처 — `toBe`: 원시값(문자열·null)의 정확 일치. `not.toContain(부분문자열)`: 문자열 안에
 *  그 조각이 없어야 통과(부재 검사).
 */

// 문구표 정본(01b 순수함수표) — reason 한 값이 어떤 문구로 가는지.
const TABLE: ReadonlyArray<
  readonly [PersonalizationInfoReason, string | null]
> = [
  [PersonalizationInfoReason.APPLIED, null],
  [PersonalizationInfoReason.CONSENT_MISSING, '동의하면 지난 기록을 반영해요'],
  [PersonalizationInfoReason.NOT_ENOUGH_RECORDS, '기록이 더 쌓이면 반영돼요'],
];

describe('TRIP-612 · personalizationCopy — 문구표 전수(AC-8)', () => {
  // 준비=reason 한 값 → 실행=personalizationCopy(reason) → 단언=표의 기대값과 정확히 같다.
  it.each(TABLE)('%s → 기대 문구', (reason, expected) => {
    expect(personalizationCopy(reason)).toBe(expected);
  });

  it('enum 3값이 모두 표에 있다(누락 축 방지 앵커)', () => {
    // Object.values(const 객체)로 실제 enum 멤버 3개를 뽑아, 위 표가 그 전수를 덮는지 확인한다.
    const covered = TABLE.map(([reason]) => reason);
    expect(covered).toEqual(
      expect.arrayContaining(Object.values(PersonalizationInfoReason))
    );
    expect(Object.values(PersonalizationInfoReason)).toHaveLength(3);
  });
});

describe('TRIP-612 · personalizationCopy — ★함정(BR-U5-44)', () => {
  it('NOT_ENOUGH_RECORDS 문구에는 "동의하면"이 없다(이미 동의한 사용자에게 동의유도 금지)', () => {
    const copy = personalizationCopy(
      PersonalizationInfoReason.NOT_ENOUGH_RECORDS
    );
    // 급소: 문구가 null 이 아니면서(있으면서) "동의하면" 조각을 담지 않아야 한다.
    expect(copy).not.toBeNull();
    expect(copy).not.toContain('동의하면');
  });
});
