/**
 * @jest-environment node
 */
import type {
  ItineraryDaysItemSlotsItem,
  Trigger,
} from '@/shared/api/index.schemas';

import { hubPillCopy } from './hubPillCopy';

/**
 * 상황 감지 FE-B · frontend-components §3.4 — 허브 i02 알약 문구 = 트리거 **자기 날짜**의 슬롯 + 변형 라벨 + 날짜어.
 *
 * 무엇을 보장하나:
 *  - 장소는 slotKey 의 날짜(`parseSlotKey`)에서 찾는다 — 허브가 오늘을 보고 있어도 내일 트리거는 내일 그 장소다.
 *  - 날짜어는 `affectedDate` 와 오늘로 만든다(같은 날 없음 · 다음 날 `내일` · 그 밖 `M월 D일`).
 *  - 날씨처럼 날짜 단위 신호(slotKey 없음)·슬롯을 못 찾음·깨진 키 → 장소 없이 라벨만(+ 날짜어).
 *  - 변형이 없는 오늘 트리거는 옛 알약과 같다(`휴무 · {장소} 주변 시설`).
 *
 * node-safe 잠금(`@jest-environment node`). 3동작: 준비(트리거·일정·오늘) → 실행(hubPillCopy) → 단언(문자열 완전 일치).
 */

const TODAY = '2026-10-19';
const TOMORROW = '2026-10-20';

const slot = (
  poiId: string,
  nameKo: string,
  startAt: string
): ItineraryDaysItemSlotsItem =>
  ({ poiId, nameKo, startAt }) as ItineraryDaysItemSlotsItem;

const DAYS = [
  { date: TODAY, slots: [slot('p1', '해운대 해변', '17:00:00')] },
  { date: TOMORROW, slots: [slot('p9', '국립중앙박물관', '10:00:00')] },
];

const mk = (over: Partial<Trigger> = {}): Trigger =>
  ({
    triggerId: 'trg-1',
    kind: 'WEATHER',
    affectedDate: TODAY,
    slotKey: `${TODAY}#p1`,
    reason: '비 소식이 있어요',
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-10-19T00:15:00Z',
    ...over,
  }) as Trigger;

describe('hubPillCopy — 허브 알약 (상황 감지 FE-B §3.4)', () => {
  it('H1 내일 휴무 트리거는 허브가 오늘을 봐도 내일 그 장소로 — "내일 휴무 · 국립중앙박물관"', () => {
    const trigger = mk({
      kind: 'CLOSURE',
      variant: 'CLOSED_DAY',
      affectedDate: TOMORROW,
      slotKey: `${TOMORROW}#p9`,
    });

    expect(hubPillCopy(trigger, DAYS, TODAY)).toBe(
      '내일 휴무 · 국립중앙박물관'
    );
  });

  it('H2 오늘 날씨 슬롯 트리거 + 변형 → "강풍 · 해운대 해변 17시"(날짜어 없음)', () => {
    expect(hubPillCopy(mk({ variant: 'WIND' }), DAYS, TODAY)).toBe(
      '강풍 · 해운대 해변 17시'
    );
  });

  it('H3 날짜 단위 날씨(slotKey 없음)는 날짜어 + 변형 라벨만 — "10월 21일 폭염"', () => {
    const trigger = mk({
      variant: 'HEAT',
      affectedDate: '2026-10-21',
      slotKey: null,
    });

    expect(hubPillCopy(trigger, DAYS, TODAY)).toBe('10월 21일 폭염');
  });

  it.each([
    ['일정에 없는 날의 슬롯', `2026-10-25#p1`],
    ['그 날에 없는 장소', `${TODAY}#p404`],
    ['깨진 키', 'p1'],
  ])('H4 %s 이면 장소 없이 라벨만 — "비 예보"', (_name, slotKey) => {
    expect(hubPillCopy(mk({ slotKey }), DAYS, TODAY)).toBe('비 예보');
  });

  it('H5 변형 없는 오늘 CLOSURE 는 옛 알약 그대로 — "휴무 · 해운대 해변 주변 시설"', () => {
    expect(hubPillCopy(mk({ kind: 'CLOSURE' }), DAYS, TODAY)).toBe(
      '휴무 · 해운대 해변 주변 시설'
    );
  });
});
