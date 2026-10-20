import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Opportunity } from '@/shared/api/index.schemas';

import { OpportunityCard } from './OpportunityCard';

/**
 * 상황 감지 FE-C · frontend-components §4.2 · §10 · §11 — 허브 기회 카드(순수 프레젠테이션, props 만).
 *
 * 무엇을 보장하나:
 *  - 받은 `item` 을 고정 템플릿(`opportunityCopy`)으로 그린다 — 제목·본문, 행사 카드만 각주. 카드는 문장을 따로 만들지 않는다.
 *  - CTA [넣어서 다시 짜기] 는 `onPressReplan` 만, × 는 `onDismiss` 만 부른다(서로 부르지 않는다). × 는 아이콘뿐이라
 *    화면 낭독기가 읽을 이름이 있다.
 *
 * 3동작: 준비(item·콜백) → 실행(render/press) → 단언(testID 글자·콜백 횟수).
 * 콜백 prop 이름을 `onPress` 로 두지 않는다 — RNTL fireEvent.press 는 조상 props 까지 거슬러 올라가 `onPress` 를 찾아,
 * 카드 자신의 prop 이름이 onPress 면 Pressable 배선이 없어도 통과한다(TriggerChip 선례).
 */

const NOTE = '열리는 날·시간은 행사 안내를 확인해 주세요';

const venue: Opportunity = {
  key: 'event:부산 불꽃축제',
  kind: 'EVENT_VENUE',
  eventName: '부산 불꽃축제',
  start: '2026-10-30',
  end: '2026-11-02',
  poiId: 'poi-venue',
  poiName: '광안리 해변',
  nearSlotKey: '2026-10-31#p1',
  distanceLabel: '약 400m',
};

const trending: Opportunity = {
  key: 'trending:해동용궁사',
  kind: 'TRENDING',
  eventName: null,
  start: null,
  end: null,
  poiId: 'poi-trend',
  poiName: '해동용궁사',
  nearSlotKey: '2026-10-31#p2',
  distanceLabel: '약 1.2km',
};

function renderCard(item: Opportunity = venue) {
  const onPressReplan = jest.fn();
  const onDismiss = jest.fn();
  render(
    <OpportunityCard
      item={item}
      onPressReplan={onPressReplan}
      onDismiss={onDismiss}
    />
  );
  return { onPressReplan, onDismiss };
}

describe('OpportunityCard · 허브 기회 카드 (§4.2)', () => {
  it('OC1 행사 카드 — 템플릿 제목·본문과 각주를 그린다', () => {
    renderCard();

    expect(screen.getByTestId('execution-live-opportunity-card')).toBeTruthy();
    expect(
      screen.getByTestId('execution-live-opportunity-title')
    ).toHaveTextContent('‘부산 불꽃축제’ 기간이에요', { exact: true });
    expect(
      screen.getByTestId('execution-live-opportunity-body')
    ).toHaveTextContent(
      '광안리 해변에서 열려요 · 동선에서 약 400m · 11월 2일까지',
      { exact: true }
    );
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it('OC2 요즘 인기 카드 — 고정 제목, 각주 없음', () => {
    renderCard(trending);

    expect(
      screen.getByTestId('execution-live-opportunity-title')
    ).toHaveTextContent('요즘 많이 찾는 곳이 동선 근처에 있어요', {
      exact: true,
    });
    expect(
      screen.getByTestId('execution-live-opportunity-body')
    ).toHaveTextContent('해동용궁사 · 동선에서 약 1.2km', { exact: true });
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('OC3 [넣어서 다시 짜기] → onPressReplan 1회, 숨김은 부르지 않는다', () => {
    const { onPressReplan, onDismiss } = renderCard();

    const cta = screen.getByTestId('execution-live-opportunity-cta');
    expect(cta).toHaveTextContent('넣어서 다시 짜기', { exact: true });
    fireEvent.press(cta);

    expect(onPressReplan).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('OC4 × → onDismiss 1회, 다시 짜기는 부르지 않는다 · 낭독 이름이 있다', () => {
    const { onPressReplan, onDismiss } = renderCard();

    const dismiss = screen.getByTestId('execution-live-opportunity-dismiss');
    expect(screen.getByLabelText('이 추천 닫기')).toBe(dismiss);
    fireEvent.press(dismiss);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onPressReplan).not.toHaveBeenCalled();
  });
});
