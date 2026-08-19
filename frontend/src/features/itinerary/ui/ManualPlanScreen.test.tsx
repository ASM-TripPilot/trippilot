import { render, screen } from '@testing-library/react-native';

import { ManualPlanScreen } from './ManualPlanScreen';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-338 · h19 직접 짜기(빈 일정) 화면 — **props-only**. 손으로 완성된 `days` 를 넣어 그림만 잰다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **S1 (AC-3)** 빈 일자(slots 0)는 **흰 화면이 아니라** 4시간대 밴드 안내 + 하단 검색 CTA 다.
 *  - 🔴 **S2 (AC-6 · BR-U3-13)** `hasViolation=true` 슬롯은 위반 배지를 **지속 표시**한다(저장 후에도
 *    남아 보임). 문안은 안 잠근다(비어있지 않음만).
 *  - 🔴 **S3 (AC-6)** `hasViolation=false` 면 위반 배지가 **없다**(짝 — 슬롯 카드는 그대로 뜬다).
 *
 * INV-2("저장 전 확정 시각처럼 안 그림")는 이 화면이 **서버가 준 days 만** 받는 구조로 담보된다 —
 * 미저장 로컬 슬롯을 받는 prop 이 없어 미검증 시각이 확정 슬롯으로 샐 길이 없다(02a §3 AC-6).
 *
 * 3동작 뼈대: 준비=days/콜백 → 실행=render → 단언=밴드·CTA·배지.
 */

const noop = () => {};

/** slotKey 규약 `"{date}#{poiId}"`(BR-U2-04) — testID 접미와 일치. */
const DATE = '2026-06-10';
const slotKey = (poiId: string) => `${DATE}#${poiId}`;

function slot(
  poiId: string,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '13:00:00',
    endAt: '14:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    violationReason: null,
    nameKo: '광안리 해변',
    tags: [],
    ...over,
  };
}

describe('🔴 S1 · AC-3 — 빈 일자는 4밴드 안내 + 하단 검색 CTA (흰 화면 아님)', () => {
  it('slots 0 이면 morning·lunch·afternoon·evening 밴드 4행과 검색 CTA 가 뜬다', () => {
    // 준비 — 빈 일자.
    render(
      <ManualPlanScreen
        days={[{ date: DATE, slots: [] }]}
        onBack={noop}
        onPressSearchAdd={noop}
      />
    );

    // 긍정 앵커 — 화면이 실제로 마운트됐다.
    expect(screen.getByTestId('itinerary-manual-root')).toBeOnTheScreen();

    // 4밴드가 전부 뜬다(★) — 각 밴드는 비어 있지 않다(라벨 + "이 시간에 장소 추가").
    (['morning', 'lunch', 'afternoon', 'evening'] as const).forEach((band) => {
      const row = screen.getByTestId(`itinerary-manual-band-${band}`);
      expect(row).toBeOnTheScreen();
      expect(row).toHaveTextContent(/\S/);
    });

    // 하단 진입 CTA.
    expect(screen.getByTestId('itinerary-manual-search-cta')).toBeOnTheScreen();
  });
});

describe('🔴 S2 · AC-6 (★) — hasViolation=true 슬롯은 위반 배지를 지속 표시한다 (BR-U3-13)', () => {
  it('채워진 슬롯 카드가 뜨고 그 위에 위반 배지가 비어 있지 않게 붙는다', () => {
    // 준비 — 위반이 붙은 채로 재조회된 슬롯.
    render(
      <ManualPlanScreen
        days={[
          {
            date: DATE,
            slots: [
              slot('poi-a', {
                hasViolation: true,
                violationReason: '점심시간과 겹쳐요',
              }),
            ],
          },
        ]}
        onBack={noop}
        onPressSearchAdd={noop}
      />
    );

    // 긍정 앵커(짝) — 슬롯 카드가 실제로 그려졌다.
    expect(
      screen.getByTestId(`itinerary-manual-slot-${slotKey('poi-a')}`)
    ).toBeOnTheScreen();

    // 위반 배지 존재 + 비어 있지 않음(문안은 안 잠금 — 정규식 /\S/).
    const badge = screen.getByTestId(
      `itinerary-manual-violation-${slotKey('poi-a')}`
    );
    expect(badge).toBeOnTheScreen();
    expect(badge).toHaveTextContent(/\S/);
  });
});

describe('🔴 S3 · AC-6 — hasViolation=false 면 위반 배지가 없다 (짝)', () => {
  it('위반 없는 슬롯은 카드만 뜨고 위반 배지는 부재한다', () => {
    render(
      <ManualPlanScreen
        days={[
          {
            date: DATE,
            slots: [
              slot('poi-a', { hasViolation: false, violationReason: null }),
            ],
          },
        ]}
        onBack={noop}
        onPressSearchAdd={noop}
      />
    );

    // 짝 — 카드는 그대로 있다(아래 부재가 "아무것도 안 그려서" 통과하는 걸 막는다).
    expect(
      screen.getByTestId(`itinerary-manual-slot-${slotKey('poi-a')}`)
    ).toBeOnTheScreen();
    // 위반 배지는 없다.
    expect(
      screen.queryByTestId(`itinerary-manual-violation-${slotKey('poi-a')}`)
    ).toBeNull();
  });
});
