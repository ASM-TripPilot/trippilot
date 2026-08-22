import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { LiveSlotCard } from './LiveSlotCard';

/**
 * TRIP-395 · LiveSlotCard(i01) — 여행 중 한 슬롯의 카드.
 *
 * 표면 = 상태 배지 · 계획 시각("15:00 도착 예정") · 장소명 · 영업시간 · 다음 구간 거리.
 * [방문 완료]·[사진]·[메모]는 **비활성 자리만**(BR-U4-38 — 표시하되 동작 안 함, U5 소관).
 * 각 leaf 는 값 하나만 담아 `toHaveTextContent`(완전 일치)로 읽는다(PoiSlotCard 규율 계승).
 *
 * 3동작 뼈대: 준비=슬롯+상태 → 실행=render → 단언=필드 텍스트·비활성.
 */

const DATE = '2026-08-20';
const slot = (
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem => ({
  poiId: 'poi-1',
  startAt: '15:00:00',
  endAt: '16:30:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo: '광안리 해수욕장',
  distanceRange: '약 1.2km · 도보 추정',
  openingHours: '09:00 - 21:00',
  tags: [],
  ...over,
});

const key = (poiId = 'poi-1') => `${DATE}#${poiId}`;

describe('LiveSlotCard', () => {
  it('C1 계획 시각을 "HH:mm 도착 예정"으로, 장소명·영업시간·거리를 각 leaf로 그린다', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="upcoming" />);

    // 계획 시각 — startAt "15:00:00" → "15:00 도착 예정" (재추정 아님, 서버값 슬라이스)
    expect(
      screen.getByTestId(`execution-live-slot-time-${key()}`)
    ).toHaveTextContent('15:00 도착 예정');
    expect(
      screen.getByTestId(`execution-live-slot-name-${key()}`)
    ).toHaveTextContent('광안리 해수욕장');
    expect(
      screen.getByTestId(`execution-live-slot-hours-${key()}`)
    ).toHaveTextContent('09:00 - 21:00');
    expect(
      screen.getByTestId(`execution-live-slot-distance-${key()}`)
    ).toHaveTextContent('약 1.2km · 도보 추정');
  });

  // C2: done 은 Figma 에서 상태 텍스트가 없다(컴팩트) — C7 이 별도로 부재를 잠근다. 여기선
  // 상태 배지를 그리는 두 상태(진행중·예정)만 라벨을 잰다.
  it('C2 상태 배지가 active/upcoming에 따라 진행 중/예정을 그린다', () => {
    const cases: ['active' | 'upcoming', string][] = [
      ['active', '진행 중'],
      ['upcoming', '예정'],
    ];
    for (const [state, label] of cases) {
      const { unmount } = render(
        <LiveSlotCard slot={slot()} date={DATE} state={state} />
      );
      expect(
        screen.getByTestId(`execution-live-slot-status-${key()}`)
      ).toHaveTextContent(label);
      unmount();
    }
  });

  it('C3 영업시간이 null이면 "미확인"을 그린다 (빈칸 아님)', () => {
    render(
      <LiveSlotCard
        slot={slot({ openingHours: null })}
        date={DATE}
        state="upcoming"
      />
    );
    expect(
      screen.getByTestId(`execution-live-slot-hours-${key()}`)
    ).toHaveTextContent('미확인');
  });

  it('C4 다음 구간 거리가 null이면 거리 줄이 아예 없다 (INV-3 파생 금지 · 문자열 그대로만)', () => {
    render(
      <LiveSlotCard
        slot={slot({ distanceRange: null })}
        date={DATE}
        state="upcoming"
      />
    );
    expect(
      screen.queryByTestId(`execution-live-slot-distance-${key()}`)
    ).toBeNull();
  });

  // C5: 진행중(버튼 3개)·예정(거리+아이콘 버튼 3개) 두 상태만 액션 버튼을 갖는다(Figma).
  // 완료(done)는 버튼이 없다 — C7 이 그 부재를 잠근다. 버튼은 여전히 비활성 자리(BR-U4-38).
  it('C5 active·upcoming 카드의 [방문 완료]·[사진]·[메모]는 비활성 자리만이다 (BR-U4-38)', () => {
    for (const state of ['active', 'upcoming'] as const) {
      const { unmount } = render(
        <LiveSlotCard slot={slot()} date={DATE} state={state} />
      );
      for (const role of ['visit', 'photo', 'memo']) {
        expect(
          screen.getByTestId(`execution-live-slot-${role}-${key()}`)
        ).toBeDisabled();
      }
      unmount();
    }
  });

  it('C6 루트 testID가 slotKey 규약({date}#{poiId})을 따른다', () => {
    render(
      <LiveSlotCard slot={slot({ poiId: 'xyz' })} date={DATE} state="active" />
    );
    expect(
      screen.getByTestId(`execution-live-slot-${key('xyz')}`)
    ).toBeTruthy();
  });

  // C7: 완료 카드는 Figma 에서 컴팩트다 — 상태 텍스트·액션 버튼이 없고 이름만 남는다.
  // (컴팩트 높이·시계 시각범위 배지·핑크 아님 같은 픽셀은 jest 무심판 → 6-b 실기. 여기선
  //  jest 가 볼 수 있는 구조 차이(status·버튼 부재)만 잠근다 — 게이트① 동결 결정.)
  it('C7 done 카드는 상태 텍스트·액션 버튼 없이 이름만 그린다 (완료=컴팩트)', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="done" />);

    // 상태 텍스트 없음(Figma 완료 = 상태 배지 대신 시각범위 배지, 상태 텍스트 자체가 없다).
    expect(
      screen.queryByTestId(`execution-live-slot-status-${key()}`)
    ).toBeNull();
    // 액션 버튼 없음(완료엔 방문/사진/메모 자리가 없다).
    for (const role of ['visit', 'photo', 'memo']) {
      expect(
        screen.queryByTestId(`execution-live-slot-${role}-${key()}`)
      ).toBeNull();
    }
    // 이름은 남는다(빈 카드가 아님 — 공허 통과 방지 앵커).
    expect(
      screen.getByTestId(`execution-live-slot-name-${key()}`)
    ).toHaveTextContent('광안리 해수욕장');
    // 시각범위 배지 값이 서버 startAt–endAt 슬라이스와 일치한다(03b 경고-1 — 무심판이던 leaf 잠금).
    expect(
      screen.getByTestId(`execution-live-slot-range-${key()}`)
    ).toHaveTextContent('15:00–16:30');
  });

  // ── TRIP-399 · AC-3: active 카드의 "다음 예정지" 섹션(additive 옵셔널 prop) ──
  // 기존 C1~C7·slot() 헬퍼는 무변경. 카드는 순수 뷰 — Linking·router 를 모른다(nextNav 유틸이
  // 판정을 소유). state='active' + nextDest 있을 때만 거리행·CTA 를 그린다.
  const nextDest = {
    lat: 35.1,
    lng: 129.1,
    nameKo: '광안리',
    distanceRange: '약 1.2km · 도보 추정',
  };

  it('N1 active 카드에 nextDest 를 주면 다음 예정지 거리와 [다음 장소 길찾기] CTA 를 그리고, CTA press 는 onPressNextNav 를 부른다', () => {
    const onPressNextNav = jest.fn();
    render(
      <LiveSlotCard
        slot={slot()}
        date={DATE}
        state="active"
        nextDest={nextDest}
        onPressNextNav={onPressNextNav}
      />
    );

    // 거리 leaf 는 서버 문자열 하나만 담는다(toHaveTextContent 문자열=완전일치, RNTL 13.3.3).
    expect(
      screen.getByTestId('execution-arrive-next-distance')
    ).toHaveTextContent('약 1.2km · 도보 추정');
    expect(screen.getByTestId('execution-arrive-next-nav')).toBeTruthy();

    fireEvent.press(screen.getByTestId('execution-arrive-next-nav'));
    expect(onPressNextNav).toHaveBeenCalledTimes(1);
  });

  it('N2 active 카드라도 nextDest 가 없으면 거리·CTA 섹션이 아예 없다 (AC-3 부재 · 회귀 앵커)', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="active" />);

    expect(screen.queryByTestId('execution-arrive-next-distance')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-next-nav')).toBeNull();
  });
});
