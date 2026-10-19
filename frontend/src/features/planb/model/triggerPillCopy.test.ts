import type { TriggerKind } from '@/shared/api/index.schemas';

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

/**
 * 상황 감지 FE-B · frontend-components §3.4 — 알약 `{dayLabel }{라벨}{ · 장소}{ 시}`.
 *
 * 무엇을 보장하나:
 *  - 변형이 있으면 kind 라벨 대신 변형 라벨이 앞에 선다(`강풍`·`폭염`·`휴무`…).
 *  - 날짜어(`내일`·`M월 D일`)는 맨 앞에 공백 하나로 붙는다 — 만드는 것은 호출부(`triggerDayLabel`)다.
 *  - CLOSURE 는 그 장소 자체의 영업이라 변형이 있으면 `주변 시설` 꼬리를 뗀다. 변형이 없으면(옛 서버) 옛 꼬리 그대로.
 *  - DELAY 꼬리(`방면`)와 날씨의 `{H}시` 는 기존 템플릿 그대로다(시는 계획 startAt 을 자를 뿐).
 *  - options 가 없거나 둘 다 null 이면 옛 출력과 바이트까지 같다(PBT 는 `triggerLabel.property.test.ts`).
 */
describe('triggerPillCopy — P5 변형·날짜어 (상황 감지 FE-B)', () => {
  it('정본 예 — CLOSURE·CLOSED_DAY·내일·국립중앙박물관 → "내일 휴무 · 국립중앙박물관"', () => {
    expect(
      triggerPillCopy(
        'CLOSURE',
        { nameKo: '국립중앙박물관', startAt: '10:00:00' },
        { variant: 'CLOSED_DAY', dayLabel: '내일' }
      )
    ).toBe('내일 휴무 · 국립중앙박물관');
  });

  it('정본 예 — WEATHER·WIND·송악산 둘레길 15:00 → "강풍 · 송악산 둘레길 15시"', () => {
    expect(
      triggerPillCopy(
        'WEATHER',
        { nameKo: '송악산 둘레길', startAt: '15:00:00' },
        { variant: 'WIND' }
      )
    ).toBe('강풍 · 송악산 둘레길 15시');
  });

  it('날씨는 날짜 단위 신호라 슬롯이 없으면 날짜어 + 변형 라벨만 — "10월 21일 폭염"', () => {
    expect(
      triggerPillCopy('WEATHER', null, {
        variant: 'HEAT',
        dayLabel: '10월 21일',
      })
    ).toBe('10월 21일 폭염');
  });

  it.each([
    ['OUT_OF_HOURS', '영업시간 밖 · 해운대 해변'],
    ['HOURS_MISMATCH', '영업시간 확인 · 해운대 해변'],
    ['HOLIDAY', '공휴일 휴무 · 해운대 해변'],
    ['PERMANENTLY_CLOSED', '폐업 · 해운대 해변'],
  ] as const)(
    'CLOSURE 변형 %s 이면 주변 시설 꼬리 없이 "%s"',
    (variant, expected) => {
      expect(triggerPillCopy('CLOSURE', HAEUNDAE, { variant })).toBe(expected);
    }
  );

  it('CLOSURE 변형이 null·모르는 값이면 옛 "휴무 · 해운대 해변 주변 시설" 그대로다', () => {
    expect(triggerPillCopy('CLOSURE', HAEUNDAE, { variant: null })).toBe(
      '휴무 · 해운대 해변 주변 시설'
    );
    expect(
      triggerPillCopy('CLOSURE', HAEUNDAE, {
        variant: 'MAYBE' as unknown as 'CLOSED_DAY',
      })
    ).toBe('휴무 · 해운대 해변 주변 시설');
  });

  it('DELAY 는 방면 꼬리 그대로에 날짜어만 붙는다', () => {
    expect(triggerPillCopy('DELAY', HAEUNDAE, { dayLabel: '내일' })).toBe(
      '내일 이동 지연 · 해운대 해변 방면'
    );
  });

  it('options 가 없거나 둘 다 null 이면 옛 출력과 같다', () => {
    for (const kind of KINDS) {
      const old = triggerPillCopy(kind, HAEUNDAE);
      expect(triggerPillCopy(kind, HAEUNDAE, {})).toBe(old);
      expect(
        triggerPillCopy(kind, HAEUNDAE, { variant: null, dayLabel: null })
      ).toBe(old);
    }
  });
});
