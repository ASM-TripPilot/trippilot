import { fireEvent, render, screen } from '@testing-library/react-native';

import { VisitRecordCard } from './VisitRecordCard';

/**
 * TRIP-565 · AC-1(UI 반)·AC-3 — 방문 기록 카드(순수 프레젠테이션, VM 주입).
 *
 * 카드는 status 를 prop 으로 받지 않는다 — 세 timestamp 를 `deriveVisitStatus` 로 내부 파생한다(INV-U5-01).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1(UI) active(도착·미완료) 카드 → 완료 체크서클이 활성이고, 누르면 onPressComplete(id) 가 1회.
 *  - 🔴 AC-3(BR-U5-05) upcoming(3 timestamp null) 카드 → 완료 컨트롤 비활성 + 완료 발화 0회.
 *  - 🔴 ★fill 함정 — 상태별로 **서로 다른 testID** 의 체크서클을 렌더(fill 색 의존 금지, repo-traps 글리프).
 *  - skip(라이트) [건너뜀] press → onPressSkip(id).
 *
 * 왜 이렇게 테스트하나(02a §4-★1·★2):
 *  - **체크서클 fill 은 jest 사각** — 완료↔미완료를 fill 색만 바꾸면 심판이 전부 green 인 채 거짓말이 통과한다.
 *    → 상태별 distinct testID(done/active/upcoming/skipped)로 렌더해 present/absent 짝으로 구조를 잠근다.
 *  - **fireEvent.press 는 disabled 를 안 막는다**(pointerEvents 만 막음, 02a §5-B 실측) → "upcoming press → 완료 0회"를
 *    disabled 에 기대지 않고 **완료 발화 Pressable 을 IN_PROGRESS 에만 렌더**하는 구조로 성립시킨다.
 *
 * (개념) `getByTestId('문자열')`=testID 완전일치 · `queryByTestId(...)`=없으면 null(부재 단언) ·
 *   `toBeDisabled()`=accessibilityState.disabled 판독(02a §5-C) · `not.toHaveBeenCalled()`=콜백 미발화.
 */

type Card = React.ComponentProps<typeof VisitRecordCard>['card'];

const baseCard = (
  over: Partial<Card> & Pick<Card, 'visitCheckId' | 'poiId'>
): Card => ({
  nameKo: '광안리',
  slotKey: null,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  arrivedLabel: null,
  ...over,
});

const T = '2026-08-31T14:20:00';

describe('🔴 AC-1(UI) · active 카드 완료 발화', () => {
  it('IN_PROGRESS → 완료 체크서클 활성 + press 시 onPressComplete(id) 1회', () => {
    const onPressComplete = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
        onPressComplete={onPressComplete}
      />
    );

    const control = screen.getByTestId('record-visit-check-active-v1');
    expect(control).not.toBeDisabled();

    fireEvent.press(control);

    expect(onPressComplete).toHaveBeenCalledTimes(1);
    expect(onPressComplete).toHaveBeenCalledWith('v1');
  });
});

describe('🔴 AC-3 · BR-U5-05 — 도착 없는 슬롯은 완료 불가', () => {
  it('UPCOMING → 완료 컨트롤 비활성 + 발화 Pressable 부재 + 완료 0회', () => {
    const onPressComplete = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v3', poiId: 'p3' })}
        onPressComplete={onPressComplete}
      />
    );

    const upcoming = screen.getByTestId('record-visit-check-upcoming-v3');
    // 상태 표식은 비활성(accessibilityState.disabled).
    expect(upcoming).toBeDisabled();
    // 완료를 발화하는 active Pressable 은 아예 없다(구조로 0회를 보장).
    expect(screen.queryByTestId('record-visit-check-active-v3')).toBeNull();

    fireEvent.press(upcoming);
    expect(onPressComplete).not.toHaveBeenCalled();
  });
});

describe('🔴 ★fill 함정 — 상태별 distinct testID', () => {
  const cases: Array<{
    status: string;
    card: Card;
    present: string;
    absent: string;
  }> = [
    {
      status: 'COMPLETED',
      card: baseCard({
        visitCheckId: 'c1',
        poiId: 'p1',
        arrivedAt: T,
        completedAt: T,
      }),
      present: 'record-visit-check-done-c1',
      absent: 'record-visit-check-upcoming-c1',
    },
    {
      status: 'IN_PROGRESS',
      card: baseCard({ visitCheckId: 'c1', poiId: 'p1', arrivedAt: T }),
      present: 'record-visit-check-active-c1',
      absent: 'record-visit-check-done-c1',
    },
    {
      status: 'UPCOMING',
      card: baseCard({ visitCheckId: 'c1', poiId: 'p1' }),
      present: 'record-visit-check-upcoming-c1',
      absent: 'record-visit-check-done-c1',
    },
    {
      status: 'SKIPPED',
      card: baseCard({
        visitCheckId: 'c1',
        poiId: 'p1',
        arrivedAt: T,
        skippedAt: T,
      }),
      present: 'record-visit-check-skipped-c1',
      absent: 'record-visit-check-active-c1',
    },
  ];

  it.each(cases)(
    '$status → $present present · $absent absent (fill 색 아닌 testID 로 구분)',
    ({ card, present, absent }) => {
      render(<VisitRecordCard card={card} />);
      expect(screen.getByTestId(present)).toBeTruthy();
      expect(screen.queryByTestId(absent)).toBeNull();
    }
  );
});

describe('skip(라이트) — [건너뜀] 발화', () => {
  it('IN_PROGRESS 카드 [건너뜀] press → onPressSkip(id) 1회', () => {
    const onPressSkip = jest.fn();
    render(
      <VisitRecordCard
        card={baseCard({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })}
        onPressSkip={onPressSkip}
      />
    );

    fireEvent.press(screen.getByTestId('record-visit-skip-v1'));

    expect(onPressSkip).toHaveBeenCalledTimes(1);
    expect(onPressSkip).toHaveBeenCalledWith('v1');
  });
});
