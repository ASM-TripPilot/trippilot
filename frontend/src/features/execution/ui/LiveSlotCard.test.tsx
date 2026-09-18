import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { LiveSlotCard } from './LiveSlotCard';

/**
 * TRIP-395 · LiveSlotCard(i01) — 여행 중 한 슬롯의 카드.
 * TRIP-396 재작성: [방문 완료] 기능화(active) · 수동 [도착](upcoming) · 사진/메모 "준비 중" 힌트 ·
 *   active 상태줄 문구 "도착 · 방문 중"(Q6). **C5·C7 동결 개봉**(01b Q2, 선례 TRIP-401·456) —
 *   [방문 완료]가 활성화돼 옛 "비활성 자리" 단언이 성립 불가하므로 신 계약으로 대체.
 *
 * 표면(상태별):
 *  - active   = 핑크 테두리 + "진행 중" 배지 + 상태줄 "HH:mm 도착 · 방문 중"
 *               + [방문 완료](`execution-arrive-complete`, 활성) · [사진]/[메모](press→"준비 중" 힌트).
 *  - upcoming = "예정" 배지 + 상태줄 "HH:mm 도착 예정" + 수동 [도착](`execution-arrive-manual-{key}`).
 *  - done     = 컴팩트(이름 + 시각범위 배지, 액션 버튼·상태 텍스트 없음).
 *
 * 각 leaf 는 값 하나만 담아 `toHaveTextContent`(문자열=완전일치, RNTL 13.3.3)로 읽는다.
 * 3동작 뼈대: 준비=슬롯+상태(+콜백) → 실행=render/press → 단언=필드 텍스트·버튼·힌트.
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

  it('C6 루트 testID가 slotKey 규약({date}#{poiId})을 따른다', () => {
    render(
      <LiveSlotCard slot={slot({ poiId: 'xyz' })} date={DATE} state="active" />
    );
    expect(
      screen.getByTestId(`execution-live-slot-${key('xyz')}`)
    ).toBeTruthy();
  });

  // ── TRIP-396 · AC-3: active 카드의 [방문 완료] 활성화(C5 개봉) ──
  it('A1 active 카드는 활성 [방문 완료]를 그리고, press 는 onPressComplete 를 부른다 (AC-3)', () => {
    const onPressComplete = jest.fn();
    render(
      <LiveSlotCard
        slot={slot()}
        date={DATE}
        state="active"
        onPressComplete={onPressComplete}
      />
    );

    const complete = screen.getByTestId('execution-arrive-complete');
    expect(complete).not.toBeDisabled();
    fireEvent.press(complete);
    expect(onPressComplete).toHaveBeenCalledTimes(1);

    // active 는 완료 버튼이지 수동 도착이 아니다(수동은 upcoming 전용).
    expect(screen.queryByTestId(`execution-arrive-manual-${key()}`)).toBeNull();
  });

  // ── TRIP-396 · Q6: active 상태줄 문구(계획시각 + 정성 "방문 중") ──
  it('A2 active 상태줄은 "HH:mm 도착 · 방문 중"이다 (계획값 + 정성, Q6 · BR-U4-34)', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="active" />);
    // 계획 시각 15:00(재추정 아님) + 정성 상태(숫자 없음, INV-3/executionDurationStructure 통과).
    expect(
      screen.getByTestId(`execution-live-slot-time-${key()}`)
    ).toHaveTextContent('15:00 도착 · 방문 중');
  });

  // ── TRIP-396 · AC-5: 사진·메모 무해 + "준비 중" 힌트 ──
  it('A3 active 사진/메모 press 는 오류 없이 "준비 중" 힌트를 드러낸다 (AC-5 · BR-U4-38)', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="active" />);

    // 준비 — press 전엔 힌트가 없다(공허 통과 방지 앵커).
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();

    // 실행·단언 — [사진] press 는 던지지 않고 힌트를 띄운다.
    fireEvent.press(screen.getByTestId('execution-arrive-photo'));
    expect(screen.getByTestId('execution-arrive-soon-hint')).toBeTruthy();
  });

  it('A3b active [메모] press 도 같은 "준비 중" 힌트를 드러낸다 (AC-5)', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="active" />);
    fireEvent.press(screen.getByTestId('execution-arrive-memo'));
    expect(screen.getByTestId('execution-arrive-soon-hint')).toBeTruthy();
  });

  // ── TRIP-396 · AC-4: upcoming 카드의 수동 [도착] ──
  it('A4 upcoming 카드는 수동 [도착]을 그리고, press 는 onPressManualArrive 를 부른다 (AC-4)', () => {
    const onPressManualArrive = jest.fn();
    render(
      <LiveSlotCard
        slot={slot()}
        date={DATE}
        state="upcoming"
        onPressManualArrive={onPressManualArrive}
      />
    );

    const manual = screen.getByTestId(`execution-arrive-manual-${key()}`);
    expect(manual).not.toBeDisabled();
    fireEvent.press(manual);
    expect(onPressManualArrive).toHaveBeenCalledTimes(1);

    // upcoming 은 아직 도착 전이라 완료 버튼이 없다.
    expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
  });

  // ── TRIP-396 · AC-6: 화면 어디에도 실체류 시간(N분)이 표시되지 않는다 ──
  it('A5 완료/진행 카드 어디에도 소요시간(N분·N시간·소요)이 표시되지 않는다 (AC-6 · INV-3)', () => {
    const durationText = /\d+\s*분|\d+\s*시간|소요/;
    for (const state of ['active', 'done'] as const) {
      const { unmount } = render(
        <LiveSlotCard slot={slot()} date={DATE} state={state} />
      );
      expect(screen.queryByText(durationText)).toBeNull();
      unmount();
    }
  });

  // C7 재작성(done=컴팩트): 액션 버튼(신 testID)·상태 텍스트가 없고 이름+시각범위만 남는다.
  it('C7 done 카드는 액션 버튼·상태 텍스트 없이 이름과 시각범위만 그린다 (완료=컴팩트)', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="done" />);

    // 액션 부재 — 완료엔 방문/사진/메모/수동도착 자리가 없다.
    for (const id of [
      'execution-arrive-complete',
      'execution-arrive-photo',
      'execution-arrive-memo',
      `execution-arrive-manual-${key()}`,
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    // 상태 텍스트 부재(Figma 완료 = 상태 배지 대신 시각범위 배지).
    expect(
      screen.queryByTestId(`execution-live-slot-status-${key()}`)
    ).toBeNull();
    // 이름은 남는다(빈 카드가 아님 — 공허 통과 방지 앵커).
    expect(
      screen.getByTestId(`execution-live-slot-name-${key()}`)
    ).toHaveTextContent('광안리 해수욕장');
    // 시각범위 배지 값이 서버 startAt–endAt 슬라이스와 일치한다.
    expect(
      screen.getByTestId(`execution-live-slot-range-${key()}`)
    ).toHaveTextContent('15:00–16:30');
  });

  // ── TRIP-399 · AC-3: active 카드의 "다음 예정지" 섹션(additive 옵셔널 prop) — 무변경 승계 ──
  // 기존 slot() 헬퍼는 무변경. 카드는 순수 뷰 — Linking·router 를 모른다(nextNav 유틸이
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
