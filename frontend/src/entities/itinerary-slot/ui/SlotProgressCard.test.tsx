import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot/model';

import { SlotProgressCard } from './SlotProgressCard';

/**
 * TRIP-746 · AC-3·AC-4·AC-5 — i01 허브 시트 안의 슬롯 카드 3상태(entities · presentation-only).
 *
 * 무엇을 보장하나:
 *  - done  = 이름 › + 우측 "09:30"(계획 startAt, BR-U4-34) + "방문" / 사진 N장 / 후기 박스.
 *            사진·후기가 없으면 그 칸을 통째로 안 그린다(G6 — 실앱은 계약 공백이라 늘 없음).
 *  - active = 상태줄 "13:00 도착 · 지금 관람 중"(D4 고정) + [방문 완료]·[사진]·[메모].
 *            "진행 중" 배지·영업시간 줄은 없다. [사진]·[메모]는 오류 없이 "준비 중"(BR-U4-38).
 *  - upcoming = "예정" 알약 + 상태줄 "15:00 도착 예정 · 11:00–22:00 영업" 한 줄 + 누를 수 없는 아이콘 3개.
 *            거리 줄·수동 [도착]은 없다(도착 자동 원칙).
 *
 * "준비 중" 힌트의 열림 상태는 카드가 갖지 않는다 — entities ui 는 useState 금지
 * (`entitiesItinerarySlotStructure` G2). 카드는 `onPressSoon` 을 부르고 `soonHintVisible` 로 그린다.
 *
 * 각 leaf 는 값 하나 — `toHaveTextContent(문자열)` 은 trim·공백 정규화 뒤 **완전 일치**다(02a ★3).
 * 3동작: 준비(슬롯·상태·사진/후기) → 실행(렌더·press) → 단언(leaf 문구·존재/부재·콜백 횟수).
 */

const DATE = '2026-06-11';

const mkSlot = (
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem => ({
  poiId: 'p1',
  startAt: '09:30:00',
  endAt: '10:50:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo: '감천문화마을',
  distanceRange: null,
  openingHours: null,
  tags: [],
  ...over,
});

const KEY = `${DATE}#p1`;
const id = (role: string) => `execution-live-slot-${role}-${KEY}`;
const PHOTOS = [{ uri: 'file:///a.jpg' }, { uri: 'file:///b.jpg' }];
const MEMO = '골목마다 알록달록한 벽화. 전망대에서 인증샷 남겼다.';

describe('SlotProgressCard · done (AC-3)', () => {
  it('C1 이름·chevron·"09:30"+"방문"·사진 2장·후기를 그린다', () => {
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        photos={PHOTOS}
        memo={MEMO}
      />
    );

    expect(screen.getByTestId(`execution-live-slot-${KEY}`)).toBeOnTheScreen();
    expect(screen.getByTestId(id('name'))).toHaveTextContent('감천문화마을');
    expect(screen.getByTestId(id('chevron'))).toBeOnTheScreen();
    // 시각은 계획 startAt 을 자른 값(재추정 없음). "방문" 은 형제 leaf(중첩 금지, 02a ★4).
    expect(screen.getByTestId(id('visit-time'))).toHaveTextContent('09:30');
    expect(screen.getByTestId(id('visit-label'))).toHaveTextContent('방문');
    // 사진은 준 만큼, 후기는 원문 그대로.
    expect(screen.getByTestId(id('photos'))).toBeOnTheScreen();
    expect(
      screen.getByTestId(`execution-live-slot-photo-0-${KEY}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`execution-live-slot-photo-1-${KEY}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`execution-live-slot-photo-2-${KEY}`)
    ).toBeNull();
    expect(screen.getByTestId(id('memo'))).toHaveTextContent(MEMO);
    // done 엔 액션·상태 알약이 없다.
    expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
    expect(screen.queryByTestId(id('status'))).toBeNull();
  });

  it('C2 사진·후기가 둘 다 없으면 사진 행과 후기 박스를 통째로 안 그린다 (G6)', () => {
    render(<SlotProgressCard slot={mkSlot()} date={DATE} state="done" />);

    // 짝 — 카드 자체는 있다(빈 렌더 공허 통과 차단).
    expect(screen.getByTestId(id('visit-time'))).toHaveTextContent('09:30');
    expect(screen.queryByTestId(id('photos'))).toBeNull();
    expect(screen.queryByTestId(id('memo'))).toBeNull();
  });

  it('C3 후기만 있으면 후기만, 사진 행은 없다 (두 칸이 독립)', () => {
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        photos={[]}
        memo={MEMO}
      />
    );

    expect(screen.getByTestId(id('memo'))).toHaveTextContent(MEMO);
    expect(screen.queryByTestId(id('photos'))).toBeNull();
  });
});

describe('SlotProgressCard · active (AC-4)', () => {
  const activeSlot = mkSlot({
    startAt: '13:00:00',
    endAt: '14:30:00',
    nameKo: '부산시립미술관',
    openingHours: '10:00 - 18:00',
  });

  it('C4 상태줄은 "13:00 도착 · 지금 관람 중" 이고, 진행 중 배지·영업시간 줄은 없다 (D4)', () => {
    render(<SlotProgressCard slot={activeSlot} date={DATE} state="active" />);

    expect(screen.getByTestId(id('time'))).toHaveTextContent(
      '13:00 도착 · 지금 관람 중'
    );
    expect(screen.getByTestId(id('chevron'))).toBeOnTheScreen();
    // 부재 — 배지(옛 "진행 중")·예정 알약·영업시간(openingHours 를 줘도 안 나온다).
    expect(screen.queryByTestId(id('status'))).toBeNull();
    expect(screen.queryByText('진행 중')).toBeNull();
    expect(screen.queryByTestId(id('hours'))).toBeNull();
    expect(screen.queryByText(/18:00/)).toBeNull();
  });

  it('C5 [방문 완료]를 누르면 onPressComplete 가 1회 불린다', () => {
    const onPressComplete = jest.fn();
    render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressComplete={onPressComplete}
      />
    );

    fireEvent.press(screen.getByTestId('execution-arrive-complete'));

    expect(onPressComplete).toHaveBeenCalledTimes(1);
  });

  it('C6 [사진]·[메모]는 오류 없이 onPressSoon 만 부르고, soonHintVisible 이면 "준비 중" 힌트를 그린다 (BR-U4-38)', () => {
    const onPressComplete = jest.fn();
    const onPressSoon = jest.fn();
    const { rerender } = render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressComplete={onPressComplete}
        onPressSoon={onPressSoon}
      />
    );

    // 기본 프레임엔 힌트가 없다(Figma 와 충돌 없음).
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();

    fireEvent.press(screen.getByTestId('execution-arrive-photo'));
    fireEvent.press(screen.getByTestId('execution-arrive-memo'));

    expect(onPressSoon).toHaveBeenCalledTimes(2);
    expect(onPressComplete).not.toHaveBeenCalled();

    rerender(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressComplete={onPressComplete}
        onPressSoon={onPressSoon}
        soonHintVisible
      />
    );
    expect(screen.getByTestId('execution-arrive-soon-hint')).toBeOnTheScreen();
  });

  it('C6b TRIP-939 AC-6: onPressSoon 미주입이면 [사진]·[메모]·"준비 중" 힌트가 없고 [방문 완료]만 남는다', () => {
    // 준비·실행: 허브(LiveHubView)의 운영 모양 — 사진·메모 진입을 넘기지 않는다.
    const onPressComplete = jest.fn();
    render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressComplete={onPressComplete}
        soonHintVisible
      />
    );

    // 단언(부재): 눌러도 "준비 중"만 뜨던 두 버튼과 힌트가 없다(힌트 표시를 켜도).
    expect(screen.queryByTestId('execution-arrive-photo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();

    // 실행·단언(짝): [방문 완료]는 그대로 동작한다.
    fireEvent.press(screen.getByTestId('execution-arrive-complete'));
    expect(onPressComplete).toHaveBeenCalledTimes(1);
  });
});

describe('SlotProgressCard · upcoming (AC-5)', () => {
  const upcoming = (openingHours: string | null) =>
    mkSlot({
      poiId: 'p1',
      startAt: '15:00:00',
      endAt: '16:30:00',
      nameKo: '전포 카페거리',
      openingHours,
      distanceRange: '약 1.2km · 도보 추정',
    });

  it('C7a "예정" 알약과 "15:00 도착 예정 · 11:00–22:00 영업" 한 줄을 그린다', () => {
    render(
      <SlotProgressCard
        slot={upcoming('11:00 - 22:00')}
        date={DATE}
        state="upcoming"
      />
    );

    expect(screen.getByTestId(id('name'))).toHaveTextContent('전포 카페거리');
    expect(screen.getByTestId(id('chevron'))).toBeOnTheScreen();
    expect(screen.getByTestId(id('status'))).toHaveTextContent('예정');
    expect(screen.getByTestId(id('time'))).toHaveTextContent(
      '15:00 도착 예정 · 11:00–22:00 영업'
    );
  });

  it('C7b 영업시간 원문이 범위 모양이 아니면 원문 그대로 잇는다 ("24시간 개방")', () => {
    render(
      <SlotProgressCard
        slot={upcoming('24시간 개방')}
        date={DATE}
        state="upcoming"
      />
    );

    expect(screen.getByTestId(id('time'))).toHaveTextContent(
      '15:00 도착 예정 · 24시간 개방'
    );
  });

  it('C7c 영업시간이 null 이면 " · …" 조각 없이 "15:00 도착 예정" 만 (G6)', () => {
    render(
      <SlotProgressCard slot={upcoming(null)} date={DATE} state="upcoming" />
    );

    expect(screen.getByTestId(id('time'))).toHaveTextContent('15:00 도착 예정');
  });

  it('C8 아이콘 3개는 비활성이고 눌러도 아무 콜백이 없다 · 거리 줄·수동 [도착]·[방문 완료]는 없다', () => {
    const onPressComplete = jest.fn();
    const onPressSoon = jest.fn();
    render(
      <SlotProgressCard
        slot={upcoming('11:00 - 22:00')}
        date={DATE}
        state="upcoming"
        onPressComplete={onPressComplete}
        onPressSoon={onPressSoon}
      />
    );

    for (const role of ['disabled-check', 'disabled-photo', 'disabled-memo']) {
      const icon = screen.getByTestId(id(role));
      // toBeDisabled = 요소나 조상에 accessibilityState.disabled(02a ★6).
      expect(icon).toBeDisabled();
      fireEvent.press(icon);
    }
    expect(onPressComplete).not.toHaveBeenCalled();
    expect(onPressSoon).not.toHaveBeenCalled();

    // 부재 — distanceRange 를 줘도 거리 줄이 없다 · 도착 자동 원칙으로 수동 [도착] 삭제.
    expect(screen.queryByTestId(id('distance'))).toBeNull();
    expect(screen.queryByText('약 1.2km · 도보 추정')).toBeNull();
    expect(screen.queryByTestId(`execution-arrive-manual-${KEY}`)).toBeNull();
    expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
  });
});

describe('SlotProgressCard · INV-3 (C9)', () => {
  it('세 상태 어디에도 소요시간(N분·N시간·소요)이 렌더되지 않는다', () => {
    // 영업시간 픽스처는 HH:mm 범위만 — "24시간 개방" 은 이 정규식에 걸리는 오탐이라 뺀다(02a ★8).
    const DURATION = /(\d+\s*분|\d+\s*시간|소요)/;
    const states = ['done', 'active', 'upcoming'] as const;

    for (const state of states) {
      const { toJSON, unmount } = render(
        <SlotProgressCard
          slot={mkSlot({
            openingHours: '11:00 - 22:00',
            distanceRange: '약 1.2km',
          })}
          date={DATE}
          state={state}
          photos={PHOTOS}
          memo="좋았다"
        />
      );
      const text = JSON.stringify(toJSON());
      // 짝 — 렌더가 비지 않았다(이름이 있다).
      expect(text).toContain('감천문화마을');
      expect(DURATION.test(text)).toBe(false);
      unmount();
    }
  });
});

// ── TRIP-748 · 영향 카드 배지 (AC-5 · Seed Q1) ──────────────────────────────
//
// 트리거가 가리키는 **예정** 카드는 "예정" 알약 대신 트리거 라벨(비 예보·이동 지연·휴무)을 분홍으로
// 보인다(Figma 4135:2745). 알약 기하(rounded-button·px 10·py 5)는 그대로, 색 두 클래스만 바뀐다.
// active·done 카드엔 배지를 새로 만들지 않는다(Q1).
// ⚠️ 글자색은 `text-primary`(#FF385C)다 — `text-primary-text`(#C13515)가 아니다(02a ★12).

function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

/** status 글자(Text)를 감싼 알약 박스 — `rounded-button` 을 가진 가장 가까운 조상(02a ★11). */
function badgeBox(): { props?: { className?: unknown } } {
  let up = screen.getByTestId(id('status')).parent;
  while (up && !classTokens(up).includes('rounded-button')) up = up.parent;
  if (!up) throw new Error('status 를 감싼 rounded-button 박스가 없다');
  return up;
}

describe('SlotProgressCard · 배지 override (TRIP-748 C10)', () => {
  const upcomingSlot = mkSlot({
    startAt: '17:00:00',
    endAt: '18:30:00',
    nameKo: '해운대 해변',
  });

  it.each(['비 예보', '이동 지연', '휴무'])(
    'C10a upcoming + badgeLabel "%s" → 그 글자를 분홍 알약(primary-pale 바탕 + primary 글자)으로',
    (label) => {
      render(
        <SlotProgressCard
          slot={upcomingSlot}
          date={DATE}
          state="upcoming"
          badgeLabel={label}
        />
      );

      const status = screen.getByTestId(id('status'));
      expect(status).toHaveTextContent(label);
      expect(classTokens(status)).toContain('text-primary');
      expect(classTokens(status)).not.toContain('text-muted');

      const box = classTokens(badgeBox());
      expect(box).toContain('bg-primary-pale');
      expect(box).not.toContain('bg-surface-strong');
      // 기하는 "예정" 알약과 같다 — 색만 바뀐다.
      expect(box).toEqual(
        expect.arrayContaining(['rounded-button', 'px-[10px]', 'py-[5px]'])
      );
    }
  );

  it('C10b badgeLabel 이 없으면 지금처럼 "예정" + 회색 알약이다 (회귀 앵커)', () => {
    render(
      <SlotProgressCard slot={upcomingSlot} date={DATE} state="upcoming" />
    );

    const status = screen.getByTestId(id('status'));
    expect(status).toHaveTextContent('예정');
    expect(classTokens(status)).toContain('text-muted');
    expect(classTokens(badgeBox())).toContain('bg-surface-strong');
  });

  it.each(['active', 'done'] as const)(
    'C10c %s 카드는 badgeLabel 을 받아도 배지를 만들지 않는다 (Q1)',
    (state) => {
      render(
        <SlotProgressCard
          slot={upcomingSlot}
          date={DATE}
          state={state}
          badgeLabel="비 예보"
        />
      );

      // 짝 앵커 — 카드가 실제로 그려졌다.
      expect(screen.getByTestId(id('name'))).toHaveTextContent('해운대 해변');
      expect(screen.queryByTestId(id('status'))).toBeNull();
      expect(screen.queryByText('비 예보')).toBeNull();
    }
  );
});
