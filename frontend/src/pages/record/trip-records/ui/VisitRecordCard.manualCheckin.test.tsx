import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { VisitRecordCard } from './VisitRecordCard';

/**
 * 🔴 TRIP-761 · AC-4·AC-5·AC-6 — j01 manual-checkin 카드의 "방문 체크" 코랄 pill.
 *
 * 위치 권한이 없을 때(수동 체크인 모드) 미방문(UPCOMING) 카드에 "방문 체크" pill 이 붙어, press 하면
 * 도착을 **수동으로** 생성한다(`arrive({source:'MANUAL'})`). complete(완료)가 아니라 arrive(도착 생성)다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-4  `manualCheckin` && UPCOMING → pill(`record-visit-manual-check-{id}`) + "방문 체크" 텍스트가 뜬다.
 *            manualCheckin false 거나 UPCOMING 이 아니면 부재(무회귀 짝).
 *  - 🔴 AC-5  pill press → `onPressManualCheck(poiId)` 정확히 1회(seed §3-a).
 *  - 🔴 AC-6  ★manual 모드도 complete 아님 — pill press 는 `onPressComplete` 를 0회로 두고, UPCOMING 완료 발화
 *            Pressable(`record-visit-check-active-*`)은 여전히 부재다(완료 게이트 구조 유지).
 *
 * 왜 별 파일인가(02a §4-★1): 기존 `VisitRecordCard.test.tsx` 의 AC-3(BR-U5-05, UPCOMING 완료 발화 부재)
 *   describe 를 **한 글자도 안 건드리는 것**이 AC-6 무회귀 증거다. 새 케이스를 그 파일에 얹으면 diff 가 나
 *   무회귀가 흐려진다 → 격리(566 `.wiring.test.tsx` 선례). manual-check 는 `onPressManualCheck`(≠`onPressComplete`)라
 *   완료 게이트를 안 깬다 — B6 이 그 분리를 코드에 못박는다.
 *
 * ★fill 함정(02a §4-★7): "방문 체크" pill 을 완료 마커(coral 채운 원)로 착각해 색만 바꾸면 심판이 green 인
 *   채 "도착했다는 거짓말"이 통과한다 → present/absent 짝 testID + complete 0회 로만 판정(색 의존 금지, repo 관례).
 * ★확장타입 재대입: 프로덕션 props 엔 아직 `manualCheckin`·`onPressManualCheck` 가 없다(기존 카드 옵셔널 prop 선례).
 *
 * (개념) `getByTestId('문자열')`=완전일치 · `queryByTestId(...)`=없으면 null(부재) · `getByText(문자열)`=단일
 *   Text leaf 완전일치 · `toHaveBeenCalledWith(값)`=콜백 인자 일치 · `not.toHaveBeenCalled()`=미발화.
 */

type Card = React.ComponentProps<typeof VisitRecordCard>['card'];
type CardWithManual = React.ComponentProps<typeof VisitRecordCard> & {
  manualCheckin?: boolean;
  onPressManualCheck?: (poiId: string) => void;
};
const Card = VisitRecordCard as unknown as (
  props: CardWithManual
) => ReactElement;

const T = '2026-08-31T14:20:00';
const PILL_TEXT = '방문 체크';

const baseCard = (
  over: Partial<Card> & Pick<Card, 'visitCheckId' | 'poiId'>
): Card => ({
  nameKo: '○○ 카페',
  slotKey: null,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  arrivedLabel: null,
  ...over,
});

const upcoming = baseCard({ visitCheckId: 'v3', poiId: 'p3' });

describe('🔴 TRIP-761 · AC-4 · "방문 체크" pill 존재', () => {
  it('B4a · manualCheckin true + UPCOMING → pill + "방문 체크" 텍스트가 뜬다', () => {
    render(
      <Card card={upcoming} manualCheckin onPressManualCheck={jest.fn()} />
    );

    expect(screen.getByTestId('record-visit-manual-check-v3')).toBeTruthy();
    expect(screen.getByText(PILL_TEXT)).toBeTruthy();
  });
});

describe('🔴 TRIP-761 · AC-4 · pill 부재 행렬(무회귀 짝)', () => {
  // manualCheckin && UPCOMING 만 present — false 거나 UPCOMING 이 아니면 전부 absent.
  const cases: Array<{ name: string; card: Card; manualCheckin?: boolean }> = [
    {
      name: 'manualCheckin false + UPCOMING',
      card: upcoming,
      manualCheckin: false,
    },
    {
      name: 'manualCheckin true + COMPLETED',
      card: baseCard({
        visitCheckId: 'v3',
        poiId: 'p3',
        arrivedAt: T,
        completedAt: T,
      }),
      manualCheckin: true,
    },
    {
      name: 'manualCheckin true + IN_PROGRESS',
      card: baseCard({ visitCheckId: 'v3', poiId: 'p3', arrivedAt: T }),
      manualCheckin: true,
    },
    {
      name: 'manualCheckin true + SKIPPED',
      card: baseCard({
        visitCheckId: 'v3',
        poiId: 'p3',
        arrivedAt: T,
        skippedAt: T,
      }),
      manualCheckin: true,
    },
    {
      name: 'manualCheckin 미주입 + UPCOMING',
      card: upcoming,
      manualCheckin: undefined,
    },
  ];

  it.each(cases)('$name → pill 부재', ({ card, manualCheckin }) => {
    render(
      <Card
        card={card}
        manualCheckin={manualCheckin}
        onPressManualCheck={jest.fn()}
      />
    );

    expect(screen.queryByTestId('record-visit-manual-check-v3')).toBeNull();
  });
});

describe('🔴 TRIP-761 · AC-5 · 카드 레벨 arrive 발화', () => {
  it('B5 · pill press → onPressManualCheck(poiId) 정확히 1회', () => {
    const onPressManualCheck = jest.fn();
    render(
      <Card
        card={upcoming}
        manualCheckin
        onPressManualCheck={onPressManualCheck}
      />
    );

    fireEvent.press(screen.getByTestId('record-visit-manual-check-v3'));

    expect(onPressManualCheck).toHaveBeenCalledTimes(1);
    // seed §3-a: onPressManualCheck(poiId). 페이지가 이 poiId 로 arrive({source:'MANUAL', poiId}) 를 쏜다.
    expect(onPressManualCheck).toHaveBeenCalledWith('p3');
  });
});

describe('🔴 TRIP-761 · AC-6 · ★manual 모드도 complete 아님(무회귀)', () => {
  it('B6 · manual-check press → onPressManualCheck 1회 / onPressComplete 0회 + 완료 발화 Pressable 여전히 부재', () => {
    const onPressManualCheck = jest.fn();
    const onPressComplete = jest.fn();
    render(
      <Card
        card={upcoming}
        manualCheckin
        onPressManualCheck={onPressManualCheck}
        onPressComplete={onPressComplete}
      />
    );

    // UPCOMING 완료 게이트는 구조로 유지 — 도착 없는 슬롯엔 완료 발화 Pressable 이 없고, 상태 표식만 비활성.
    expect(screen.queryByTestId('record-visit-check-active-v3')).toBeNull();
    expect(screen.getByTestId('record-visit-check-upcoming-v3')).toBeTruthy();

    fireEvent.press(screen.getByTestId('record-visit-manual-check-v3'));

    // manual-check 는 arrive 로만 흐른다 — complete 는 절대 안 쏜다(두 콜백은 다른 물건).
    expect(onPressManualCheck).toHaveBeenCalledTimes(1);
    expect(onPressComplete).not.toHaveBeenCalled();
  });
});
