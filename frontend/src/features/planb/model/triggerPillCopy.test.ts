import type { TriggerKind } from '@/shared/api/generated/schemas';

import { triggerPillCopy } from './triggerPillCopy';

/**
 * TRIP-748 · AC-2 · D2 — 지도 위 트리거 알약 카피를 만드는 순수 함수.
 *
 * 무엇을 보장하나:
 *  - 카피 = `{라벨} · {대상}`. 대상 문구는 kind 마다 템플릿이 다르다(D2).
 *    WEATHER `{슬롯명} {도착시}시` · DELAY `{슬롯명} 방면` · CLOSURE `{슬롯명} 주변 시설`.
 *  - 도착시는 계획값 `startAt` 의 시만 쓴다 — `09:00:00` → `9시`, 분은 버린다(Q4 · INV-2).
 *  - 슬롯이 없거나 이름이 없으면 라벨만 쓴다(매칭 실패 폴백).
 *  - 소요시간·지연 분을 문구에 넣지 않는다(INV-3).
 *
 * 슬롯 매칭(어느 슬롯이 트리거의 slotKey 인가)은 호출하는 페이지 몫이다 — 이 함수는 받은 슬롯만 쓴다.
 * 3동작: 준비(kind·슬롯) → 실행(함수 호출) → 단언(문자열 완전 일치).
 */

const HAEUNDAE = { nameKo: '해운대 해변', startAt: '17:00:00' };
const KINDS: TriggerKind[] = ['WEATHER', 'DELAY', 'CLOSURE'];

describe('triggerPillCopy — P1 kind 별 템플릿 (D2)', () => {
  it.each([
    ['WEATHER', '비 예보 · 해운대 해변 17시'],
    ['DELAY', '이동 지연 · 해운대 해변 방면'],
    ['CLOSURE', '휴무 · 해운대 해변 주변 시설'],
  ] as const)('%s + 해운대 해변 17:00 → "%s"', (kind, expected) => {
    expect(triggerPillCopy(kind, HAEUNDAE)).toBe(expected);
  });
});

describe('triggerPillCopy — P2 도착시는 시만 쓴다 (Q4)', () => {
  it('09:00:00 → "9시"(앞자리 0 없음), 17:30:00 → "17시"(분 버림)', () => {
    expect(
      triggerPillCopy('WEATHER', { nameKo: '해운대 해변', startAt: '09:00:00' })
    ).toBe('비 예보 · 해운대 해변 9시');
    expect(
      triggerPillCopy('WEATHER', { nameKo: '해운대 해변', startAt: '17:30:00' })
    ).toBe('비 예보 · 해운대 해변 17시');
  });
});

describe('triggerPillCopy — P3 매칭 실패면 라벨만', () => {
  it.each([
    ['WEATHER', '비 예보'],
    ['DELAY', '이동 지연'],
    ['CLOSURE', '휴무'],
  ] as const)(
    '%s: 슬롯 undefined · null · 이름 null 이면 "%s" 만',
    (kind, label) => {
      expect(triggerPillCopy(kind)).toBe(label);
      expect(triggerPillCopy(kind, null)).toBe(label);
      expect(triggerPillCopy(kind, { nameKo: null, startAt: '17:00:00' })).toBe(
        label
      );
    }
  );
});

describe('triggerPillCopy — P4 INV-3 소요시간·지연 분 없음', () => {
  it('어떤 조합의 산출에도 "분"·delay·duration 이 없다', () => {
    const outputs = KINDS.flatMap((kind) => [
      triggerPillCopy(kind, HAEUNDAE),
      triggerPillCopy(kind, { nameKo: '해운대 해변', startAt: '09:45:00' }),
      triggerPillCopy(kind),
    ]);

    // 짝 앵커 — 산출이 실제로 있다(빈 문자열 공허 통과 차단).
    outputs.forEach((text) => expect(text.length).toBeGreaterThan(0));
    outputs.forEach((text) => expect(text).not.toMatch(/분|delay|duration/i));
  });
});
