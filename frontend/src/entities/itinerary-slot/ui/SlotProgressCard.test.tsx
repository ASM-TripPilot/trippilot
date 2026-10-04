import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot/model';

import { ChevronRightGlyph, MemoGlyph, PhotoGlyph } from './SlotGlyphs';
import { SlotProgressCard } from './SlotProgressCard';

/**
 * TRIP-746 · AC-3·AC-4·AC-5 — i01 허브 시트 안의 슬롯 카드 3상태(entities · presentation-only).
 *
 * 무엇을 보장하나:
 *  - done  = 이름 › + 우측 "09:30"(계획 startAt, BR-U4-34) + "방문" / 사진 N장 / 후기 박스.
 *            사진·후기가 없으면 그 칸을 통째로 안 그린다(G6 — 실앱은 계약 공백이라 늘 없음).
 *  - active = 상태줄 "13:00 도착 · 지금 관람 중"(D4 고정) + [방문 완료]·[사진]·[메모].
 *            "진행 중" 배지·영업시간 줄은 없다. [사진]·[메모]는 각자 제 콜백만 부른다(TRIP-1070 —
 *            "준비 중" 힌트 폐기). 콜백을 안 받은 버튼은 그리지 않는다(TRIP-939).
 *  - upcoming = "예정" 알약 + 상태줄 "15:00 도착 예정 · 11:00–22:00 영업" 한 줄 + 누를 수 없는 아이콘 3개.
 *            거리 줄은 없다. 수동 [도착]은 `onPressArrive` 를 받을 때만 그린다(TRIP-1021 — TRIP-746 의
 *            "도착 자동 원칙" 삭제를 되돌림. 자동 도착(TRIP-1018)이 보류라 수동이 유일한 도착 경로다).
 *
 * 사진 안내 문구(`photoNotice`)의 표시 여부는 카드가 갖지 않는다 — entities ui 는 useState 를 두지 않는다
 * (옛 가드 `entitiesItinerarySlotStructure` G2 는 TRIP-1145 로 지웠다). 부모가 문구를 주면 버튼 줄 아래에 그대로 그린다.
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
  alternatives: [],
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
    // TRIP-987: '›' 는 이름 진입 목적지가 있을 때만 그린다 — 목적지를 준 모양으로 고정(C11 이 규칙을 잠근다).
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        photos={PHOTOS}
        memo={MEMO}
        visitedLabel="09:30"
        onPressName={jest.fn()}
      />
    );

    expect(screen.getByTestId(`execution-live-slot-${KEY}`)).toBeOnTheScreen();
    expect(screen.getByTestId(id('name'))).toHaveTextContent('감천문화마을');
    expect(screen.getByTestId(id('chevron'))).toBeOnTheScreen();
    // 시각은 넘겨받은 실제 방문 시각(TRIP-1220). "방문" 은 형제 leaf(중첩 금지, 02a ★4).
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

  it('C1b TRIP-1220 실제 시각(visitedLabel)이 있으면 그 시각 + "방문", 없으면 계획 시각 + "계획"', () => {
    const { rerender } = render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        visitedLabel="07:04"
      />
    );

    expect(screen.getByTestId(id('visit-time'))).toHaveTextContent('07:04');
    expect(screen.getByTestId(id('visit-label'))).toHaveTextContent('방문');

    rerender(<SlotProgressCard slot={mkSlot()} date={DATE} state="done" />);

    expect(screen.getByTestId(id('visit-time'))).toHaveTextContent('09:30');
    expect(screen.getByTestId(id('visit-label'))).toHaveTextContent('계획');
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
    render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressName={jest.fn()}
      />
    );

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

  it('C6 TRIP-1070 AC-1: [사진]은 onPressPhoto 만, [메모]는 onPressMemo 만 1회 부르고 "준비 중" 힌트는 없다', () => {
    // 준비 — 세 버튼에 서로 다른 콜백.
    const onPressComplete = jest.fn();
    const onPressPhoto = jest.fn();
    const onPressMemo = jest.fn();
    render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressComplete={onPressComplete}
        onPressPhoto={onPressPhoto}
        onPressMemo={onPressMemo}
      />
    );

    // 실행·단언 — [사진]
    fireEvent.press(screen.getByTestId('execution-arrive-photo'));
    expect(onPressPhoto).toHaveBeenCalledTimes(1);
    expect(onPressMemo).not.toHaveBeenCalled();

    // 실행·단언 — [메모]
    fireEvent.press(screen.getByTestId('execution-arrive-memo'));
    expect(onPressMemo).toHaveBeenCalledTimes(1);
    expect(onPressPhoto).toHaveBeenCalledTimes(1);
    expect(onPressComplete).not.toHaveBeenCalled();

    // 부재 — 옛 "준비 중" 힌트는 어떤 경우에도 없다.
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
  });

  it('C6b TRIP-939 AC-6: 사진·메모 콜백을 안 받으면 [사진]·[메모]가 없고 [방문 완료]만 남는다', () => {
    // 준비·실행: 사진·메모 진입을 넘기지 않은 모양.
    const onPressComplete = jest.fn();
    render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressComplete={onPressComplete}
      />
    );

    // 단언(부재): 누를 곳 없는 버튼을 그리지 않는다.
    expect(screen.queryByTestId('execution-arrive-photo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();

    // 실행·단언(짝): [방문 완료]는 그대로 동작한다.
    fireEvent.press(screen.getByTestId('execution-arrive-complete'));
    expect(onPressComplete).toHaveBeenCalledTimes(1);
  });

  it('C6c TRIP-1070 F1: photoNotice 를 주면 그 문구 그대로 한 줄을 그리고, 안 주면 없다', () => {
    // 준비·실행 — 문구 없음.
    const { rerender } = render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
      />
    );
    // 단언(부재 앵커)
    expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();

    // 실행 — 부모가 문구를 준다.
    rerender(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
        photoNotice="사진을 기록하지 못했어요. 다시 시도해 주세요"
      />
    );

    // 단언 — 완전 일치(toHaveTextContent 문자열 = 완전 일치, 02a ★13).
    expect(
      screen.getByTestId('execution-arrive-photo-notice')
    ).toHaveTextContent('사진을 기록하지 못했어요. 다시 시도해 주세요');
  });
});

describe('SlotProgressCard · 사진 안내의 [설정 열기] (TRIP-1216 d)', () => {
  const base = {
    slot: mkSlot({
      startAt: '13:00:00',
      endAt: '14:30:00',
      nameKo: '부산시립미술관',
    }),
    date: DATE,
    state: 'active' as const,
    onPressPhoto: jest.fn(),
    photoNotice: '사진 접근 권한이 없어 사진을 불러올 수 없어요',
  };

  it('안내가 있고 onPressPhotoSettings 가 오면 [설정 열기] 가 보이고 누르면 1회 호출된다', () => {
    const onSettings = jest.fn();
    render(<SlotProgressCard {...base} onPressPhotoSettings={onSettings} />);

    fireEvent.press(screen.getByTestId('execution-arrive-photo-settings'));

    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('onPressPhotoSettings 가 없으면 버튼이 없다', () => {
    render(<SlotProgressCard {...base} />);
    expect(screen.queryByTestId('execution-arrive-photo-settings')).toBeNull();
  });

  it('안내가 비면 onPressPhotoSettings 가 와도 버튼이 없다', () => {
    render(
      <SlotProgressCard
        {...base}
        photoNotice={null}
        onPressPhotoSettings={jest.fn()}
      />
    );
    expect(screen.queryByTestId('execution-arrive-photo-settings')).toBeNull();
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
        onPressName={jest.fn()}
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

  it('C7d TRIP-1021 AC-6 여러 줄 영업시간은 불릿 없이 " · " 로 이어진 한 줄로 붙는다', () => {
    render(
      <SlotProgressCard
        slot={upcoming(
          '- 화요일~목요일 / 일요일 10:00~20:00<br>\n- 금요일~토요일 10:00~22:00'
        )}
        date={DATE}
        state="upcoming"
      />
    );

    expect(screen.getByTestId(id('time'))).toHaveTextContent(
      '15:00 도착 예정 · 화요일~목요일 / 일요일 10:00~20:00 · 금요일~토요일 10:00~22:00'
    );
  });

  it('C13 TRIP-1021 AC-9 상태줄은 한 줄로 잘린다 (numberOfLines=1 — 실제 절단은 6-b)', () => {
    render(
      <SlotProgressCard
        slot={upcoming('11:00 - 22:00')}
        date={DATE}
        state="upcoming"
      />
    );

    expect(screen.getByTestId(id('time')).props.numberOfLines).toBe(1);
  });

  it('C8 아이콘 3개는 비활성이고 눌러도 아무 콜백이 없다 · 거리 줄·[방문 완료]가 없고, onPressArrive 미주입이면 [도착]도 없다', () => {
    const onPressComplete = jest.fn();
    const onPressPhoto = jest.fn();
    const onPressMemo = jest.fn();
    render(
      <SlotProgressCard
        slot={upcoming('11:00 - 22:00')}
        date={DATE}
        state="upcoming"
        onPressComplete={onPressComplete}
        onPressPhoto={onPressPhoto}
        onPressMemo={onPressMemo}
      />
    );

    for (const role of ['disabled-check', 'disabled-photo', 'disabled-memo']) {
      const icon = screen.getByTestId(id(role));
      // toBeDisabled = 요소나 조상에 accessibilityState.disabled(02a ★6).
      expect(icon).toBeDisabled();
      fireEvent.press(icon);
    }
    expect(onPressComplete).not.toHaveBeenCalled();
    expect(onPressPhoto).not.toHaveBeenCalled();
    expect(onPressMemo).not.toHaveBeenCalled();
    // TRIP-1070 — 사진·메모 진입은 관람 중 카드에만 선다(예정 카드는 콜백을 받아도 무시).
    expect(screen.queryByTestId('execution-arrive-photo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();

    // 부재 — distanceRange 를 줘도 거리 줄이 없다 · [도착]은 onPressArrive 를 안 넘기면 없다(TRIP-1021).
    // 옛 `execution-arrive-manual-*` 는 TRIP-746 에서 사라진 이름이라 영원히 null — 새 이름으로 재조준.
    expect(screen.queryByTestId(id('distance'))).toBeNull();
    expect(screen.queryByText('약 1.2km · 도보 추정')).toBeNull();
    expect(screen.queryByTestId(id('arrive'))).toBeNull();
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

// ── TRIP-987 A · 이름·'›' → i10 현재 장소 상세 (US-ONTRIP-02 · TRIP-939) ──────────────
//
// 카드는 목적지를 모른다 — `onPressName` 을 받으면 이름+'›' 를 감싼 누름 영역(testID `…-name-…`)이
// 생기고, 안 받으면 이름은 누를 수 없는 글자이고 '›' 도 없다(자매 SlotStopCard 선례, 02a ★1).

/** 호스트가 누를 수 있는가 — Pressable 은 onPress 없이도 응답자 핸들러를 단다(SlotStopCard.test 선례). */
function isTouchable(node: ReactTestInstance): boolean {
  return (
    typeof node.props.onStartShouldSetResponder === 'function' ||
    typeof node.props.onClick === 'function'
  );
}

describe('SlotProgressCard · 이름 진입 (TRIP-987 A-1·A-2·A-4)', () => {
  const STATES = ['done', 'active', 'upcoming'] as const;

  it.each(STATES)(
    "C11a %s — onPressName 을 주면 이름이 버튼이고, 이름·'›' 어느 쪽을 눌러도 1회씩 불린다",
    (state) => {
      const onPressName = jest.fn();
      render(
        <SlotProgressCard
          slot={mkSlot()}
          date={DATE}
          state={state}
          onPressName={onPressName}
        />
      );

      const name = screen.getByTestId(id('name'));
      expect(name).toHaveTextContent('감천문화마을');
      expect(isTouchable(name)).toBe(true);
      // '›' 는 누름 영역 안에 있다 — 글리프만 따로 떠 있으면 눌러도 안 간다.
      const chevron = within(name).getByTestId(id('chevron'));
      expect(screen.UNSAFE_queryAllByType(ChevronRightGlyph)).toHaveLength(1);

      fireEvent.press(name);
      expect(onPressName).toHaveBeenCalledTimes(1);
      fireEvent.press(chevron);
      expect(onPressName).toHaveBeenCalledTimes(2);
    }
  );

  it.each(STATES)(
    "C11b %s — onPressName 이 없으면 이름은 누를 수 없는 글자이고 '›' 가 없다 (TRIP-939)",
    (state) => {
      render(<SlotProgressCard slot={mkSlot()} date={DATE} state={state} />);

      const name = screen.getByTestId(id('name'));
      expect(name).toHaveTextContent('감천문화마을');
      expect(isTouchable(name)).toBe(false);
      expect(screen.queryByTestId(id('chevron'))).toBeNull();
      expect(screen.UNSAFE_queryAllByType(ChevronRightGlyph)).toHaveLength(0);
    }
  );

  it('C11c 이름 testID 는 카드마다 하나다 — 누름 영역으로 옮기기만 한다', () => {
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        onPressName={jest.fn()}
      />
    );

    expect(screen.getAllByTestId(id('name'))).toHaveLength(1);
  });

  it('C11d active — [방문 완료]와 이름 진입은 서로의 콜백을 부르지 않는다 (A-4)', () => {
    const onPressName = jest.fn();
    const onPressComplete = jest.fn();
    render(
      <SlotProgressCard
        slot={mkSlot({ startAt: '13:00:00', nameKo: '부산시립미술관' })}
        date={DATE}
        state="active"
        onPressName={onPressName}
        onPressComplete={onPressComplete}
      />
    );

    fireEvent.press(screen.getByTestId('execution-arrive-complete'));
    expect(onPressComplete).toHaveBeenCalledTimes(1);
    expect(onPressName).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(id('name')));
    expect(onPressName).toHaveBeenCalledTimes(1);
    expect(onPressComplete).toHaveBeenCalledTimes(1);
    // 기존 leaf 는 그대로다.
    expect(screen.getByTestId(id('time'))).toHaveTextContent(
      '13:00 도착 · 지금 관람 중'
    );
  });
});

// ── TRIP-1021 #059 · 예정 카드 수동 [도착] (AC-1·AC-3 카드 쪽) ──────────────────
//
// 카드는 "진행 중 슬롯이 있나"·"오늘인가"를 모른다 — `onPressArrive` 를 받으면 upcoming 에서만
// [도착]을 그리고, 받은 대로 부른다. 누가 받을지는 허브 뷰(active 유무)·페이지(오늘 탭)가 정한다.

describe('SlotProgressCard · 수동 [도착] (TRIP-1021 C12)', () => {
  const upcomingSlot = mkSlot({
    startAt: '15:00:00',
    endAt: '16:30:00',
    nameKo: '전포 카페거리',
  });

  it('C12a upcoming + onPressArrive → "도착" 버튼이 서고, 누르면 그 콜백만 1회 불린다', () => {
    const onPressArrive = jest.fn();
    const onPressName = jest.fn();
    const onPressComplete = jest.fn();
    render(
      <SlotProgressCard
        slot={upcomingSlot}
        date={DATE}
        state="upcoming"
        onPressArrive={onPressArrive}
        onPressName={onPressName}
        onPressComplete={onPressComplete}
      />
    );

    const arrive = screen.getByTestId(id('arrive'));
    expect(arrive).toHaveTextContent('도착');

    fireEvent.press(arrive);

    expect(onPressArrive).toHaveBeenCalledTimes(1);
    expect(onPressName).not.toHaveBeenCalled();
    expect(onPressComplete).not.toHaveBeenCalled();
    // 짝 — 상태줄 leaf 는 그대로다([도착]이 그 Text 안으로 들어가면 형제 통합 테스트들의 완전 일치가 깨진다).
    expect(screen.getByTestId(id('time'))).toHaveTextContent('15:00 도착 예정');
  });

  it.each(['done', 'active'] as const)(
    'C12b %s 카드는 onPressArrive 를 받아도 [도착]을 그리지 않는다 (AC-3)',
    (state) => {
      render(
        <SlotProgressCard
          slot={upcomingSlot}
          date={DATE}
          state={state}
          onPressArrive={jest.fn()}
        />
      );

      // 짝 앵커 — 카드가 실제로 그려졌다.
      expect(screen.getByTestId(id('name'))).toHaveTextContent('전포 카페거리');
      expect(screen.queryByTestId(id('arrive'))).toBeNull();
    }
  );
});

// ── TRIP-1117 · 관람 중 카드의 메모 박스·메모 안내 줄 (결정 2 · Q3 · Q9) ─────────────────
//
// 허브 메모 시트에서 저장한 메모를 관람 중 카드 **버튼 줄 아래**에 done 과 같은 모양의 박스로 보인다
// (Figma 4741:4804). 시트가 닫힌 뒤 도착한 저장 실패는 카드 아래 한 줄(`memoNotice`)로 드러낸다(INV-4).
// 순서는 버튼 줄 → 사진 안내 → 메모 박스(Q9). 문구·표시 여부의 상태는 부모가 쥔다(entities useState 금지).

const MEMO_NOTICE = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

/** 카드 안 testID 를 화면 위→아래(트리 깊이 우선) 순서로 — host 노드만 센다(합성 겹침 제외). */
function testIdOrder(): string[] {
  const card = screen.getByTestId(`execution-live-slot-${KEY}`);
  return card
    .findAll(
      (node) =>
        typeof node.type === 'string' && typeof node.props.testID === 'string'
    )
    .map((node) => node.props.testID as string);
}

describe('SlotProgressCard · active 메모 (TRIP-1117)', () => {
  const activeSlot = mkSlot({
    startAt: '13:00:00',
    endAt: '14:30:00',
    nameKo: '부산시립미술관',
  });

  it('🔴 C15 결정 2: active 에 memo 를 주면 메모 박스가 그 본문 그대로 서고, 안 주면 없다', () => {
    // 준비·실행 — 메모 없음.
    const { rerender } = render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressMemo={jest.fn()}
      />
    );
    // 단언(부재 + 짝 앵커)
    expect(screen.getByTestId('execution-arrive-memo')).toBeOnTheScreen();
    expect(screen.queryByTestId(id('memo'))).toBeNull();

    // 실행 — 부모가 저장본을 준다.
    rerender(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressMemo={jest.fn()}
        memo="바다가 예뻤다"
      />
    );

    expect(screen.getByTestId(id('memo'))).toHaveTextContent('바다가 예뻤다');
  });

  it('🔴 C16 Q9: 버튼 줄 → 사진 안내 → 메모 박스 순서다', () => {
    render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
        photoNotice="사진을 기록하지 못했어요. 다시 시도해 주세요"
        memo="바다가 예뻤다"
      />
    );

    const order = testIdOrder();
    const at = (testID: string) => order.indexOf(testID);
    // 앵커 — 이미 있는 두 요소의 순서(추출기가 위→아래 순서를 낸다는 자가검사).
    expect(at('execution-arrive-memo')).toBeGreaterThanOrEqual(0);
    expect(at('execution-arrive-photo-notice')).toBeGreaterThan(
      at('execution-arrive-memo')
    );
    expect(at(id('memo'))).toBeGreaterThan(at('execution-arrive-photo-notice'));
  });

  it('🔴 C17 Q3: memoNotice 를 주면 버튼 줄 아래에 그 문구 그대로 한 줄이 서고, 안 주면 없다', () => {
    const { rerender } = render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressMemo={jest.fn()}
      />
    );
    expect(screen.getByTestId('execution-arrive-memo')).toBeOnTheScreen();
    expect(screen.queryByTestId('execution-arrive-memo-notice')).toBeNull();

    rerender(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="active"
        onPressMemo={jest.fn()}
        memoNotice={MEMO_NOTICE}
      />
    );

    expect(
      screen.getByTestId('execution-arrive-memo-notice')
    ).toHaveTextContent(MEMO_NOTICE);
    const order = testIdOrder();
    expect(order.indexOf('execution-arrive-memo-notice')).toBeGreaterThan(
      order.indexOf('execution-arrive-memo')
    );
  });

  // TRIP-1203 — done 은 이제 안내를 그린다(아래 「done [사진]·[메모]」 C23). 여기는 upcoming 만 남는다.
  it('C18 upcoming 카드는 memoNotice·photoNotice 를 받아도 안내 줄을 그리지 않는다', () => {
    render(
      <SlotProgressCard
        slot={activeSlot}
        date={DATE}
        state="upcoming"
        memoNotice={MEMO_NOTICE}
        photoNotice="사진을 기록하지 못했어요. 다시 시도해 주세요"
      />
    );

    // 짝 앵커 — 카드가 실제로 그려졌다.
    expect(screen.getByTestId(id('name'))).toHaveTextContent('부산시립미술관');
    expect(screen.queryByTestId('execution-arrive-memo-notice')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
    expect(screen.queryByTestId(id('done-memo-notice'))).toBeNull();
    expect(screen.queryByTestId(id('done-photo-notice'))).toBeNull();
  });
});

// TRIP-1189 · i01 다음 예정지 [길찾기] (Figma 4799:2653 btn·길찾기, US-ONTRIP-03 · BR-U4-39).
// 카드는 순수 뷰 — 누가 첫 upcoming 인지·외부 앱 호출은 부모(페이지)가 정한다. 콜백이 없으면 버튼이 없다.
describe('SlotProgressCard · upcoming 길찾기 (TRIP-1189)', () => {
  const dirId = id('directions');

  it('D1 onPressDirections 를 주면 "길찾기" 버튼이 있고 누르면 그 콜백이 1번 불린다', () => {
    const onPressDirections = jest.fn();
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="upcoming"
        onPressDirections={onPressDirections}
      />
    );

    expect(screen.getByTestId(dirId)).toHaveTextContent('길찾기');
    fireEvent.press(screen.getByTestId(dirId));
    expect(onPressDirections).toHaveBeenCalledTimes(1);
  });

  it('D2 콜백이 없으면 버튼이 없다 (다음 예정지가 아닌 카드 · 좌표 결측)', () => {
    render(<SlotProgressCard slot={mkSlot()} date={DATE} state="upcoming" />);

    expect(screen.queryByTestId(dirId)).toBeNull();
  });

  it('D3 터치 타깃은 hitSlop 으로 44pt 를 채운다 (버튼 높이 < 44)', () => {
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="upcoming"
        onPressDirections={jest.fn()}
      />
    );

    const { hitSlop } = screen.getByTestId(dirId).props;
    expect(hitSlop).toBeTruthy();
    expect(
      Object.values(hitSlop as Record<string, number>).every((n) => n >= 6)
    ).toBe(true);
  });

  it('D4 [도착]과 공존한다 — 둘 다 자기 콜백만 부른다', () => {
    const onPressDirections = jest.fn();
    const onPressArrive = jest.fn();
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="upcoming"
        onPressDirections={onPressDirections}
        onPressArrive={onPressArrive}
      />
    );

    fireEvent.press(screen.getByTestId(dirId));
    expect(onPressArrive).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(id('arrive')));
    expect(onPressDirections).toHaveBeenCalledTimes(1);
    expect(onPressArrive).toHaveBeenCalledTimes(1);
  });

  it('D5 directionsNotice 를 주면 안내 한 줄을 그리고, 없으면 안 그린다 (INV-4)', () => {
    const { rerender } = render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="upcoming"
        onPressDirections={jest.fn()}
      />
    );
    expect(screen.queryByTestId(id('directions-notice'))).toBeNull();

    rerender(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="upcoming"
        onPressDirections={jest.fn()}
        directionsNotice="지도를 열 수 없어요. 약 1.2km"
      />
    );
    expect(screen.getByTestId(id('directions-notice'))).toHaveTextContent(
      '지도를 열 수 없어요. 약 1.2km'
    );
  });

  it('D6 done 카드에는 길찾기가 없다', () => {
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        onPressDirections={jest.fn()}
      />
    );
    expect(screen.queryByTestId(dirId)).toBeNull();
  });

  it('D7 active(진행 중) 카드에도 길찾기가 있고 누르면 콜백 1번 · 방문 완료 버튼과 공존한다', () => {
    const onPressDirections = jest.fn();
    const onPressComplete = jest.fn();
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="active"
        onPressDirections={onPressDirections}
        onPressComplete={onPressComplete}
      />
    );

    expect(screen.getByTestId(dirId)).toHaveTextContent('길찾기');
    fireEvent.press(screen.getByTestId(dirId));
    expect(onPressDirections).toHaveBeenCalledTimes(1);
    expect(onPressComplete).not.toHaveBeenCalled();
  });

  it('D8 active 카드도 콜백이 없으면 버튼이 없고, directionsNotice 가 있으면 안내를 그린다', () => {
    const { rerender } = render(
      <SlotProgressCard slot={mkSlot()} date={DATE} state="active" />
    );
    expect(screen.queryByTestId(dirId)).toBeNull();

    rerender(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="active"
        directionsNotice="지도를 열 수 없어요."
      />
    );
    expect(screen.getByTestId(id('directions-notice'))).toHaveTextContent(
      '지도를 열 수 없어요.'
    );
  });
});

// ── TRIP-1203 · 방문 완료(done) 카드의 [사진]·[메모] (US-REC-02 · G-U4-7) ─────────────────
//
// done 얼굴이 active 와 같은 prop(onPressPhoto·onPressMemo·photoNotice·onPressPhotoSettings·memoNotice)을
// 읽는다 — 새 prop 은 없다. 카드가 여러 장이라 testID 에 slotKey 를 붙이고(`…-done-…-{slotKey}`), active 의
// 고정 testID(`execution-arrive-*`)는 쓰지 않는다(02a ★1). 버튼 모양은 active 와 같은 className·글리프다.
// 세로 순서: 머리줄 → 사진 행 → 버튼 줄 → 사진 안내 → [설정 열기] → 메모 안내 → 메모 박스.
//
// (개념) `findByType(컴포넌트)` = 그 노드 아래에서 해당 컴포넌트로 그려진 노드 하나를 찾는다(글리프 props 확인용).

const DONE_IDS = [
  'done-photo',
  'done-memo',
  'done-photo-notice',
  'done-photo-settings',
  'done-memo-notice',
] as const;
const DONE_ANY = /^execution-live-slot-done-/;
const PHOTO_FAILED = '사진을 기록하지 못했어요. 다시 시도해 주세요';
const PHOTO_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';
const DONE_MEMO_FAILED = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

describe('SlotProgressCard · done [사진]·[메모] (TRIP-1203)', () => {
  it('C19 done 이 사진·메모 콜백을 받으면 [사진]·[메모]가 서고 각자 제 콜백만 1회 부른다 — [방문 완료]·[길찾기]·고정 testID 는 없다', () => {
    // 준비 — 네 콜백을 모두 준다(done 이 앞의 둘만 그리는지 본다).
    const onPressPhoto = jest.fn();
    const onPressMemo = jest.fn();
    const onPressComplete = jest.fn();
    const onPressDirections = jest.fn();
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        visitedLabel="09:30"
        onPressPhoto={onPressPhoto}
        onPressMemo={onPressMemo}
        onPressComplete={onPressComplete}
        onPressDirections={onPressDirections}
      />
    );

    // 단언 — 글자는 완전 일치(글리프는 텍스트를 내지 않는다, 02a §5).
    expect(screen.getByTestId(id('done-photo'))).toHaveTextContent('사진');
    expect(screen.getByTestId(id('done-memo'))).toHaveTextContent('메모');

    // 실행·단언 — [사진]
    fireEvent.press(screen.getByTestId(id('done-photo')));
    expect(onPressPhoto).toHaveBeenCalledTimes(1);
    expect(onPressMemo).not.toHaveBeenCalled();

    // 실행·단언 — [메모]
    fireEvent.press(screen.getByTestId(id('done-memo')));
    expect(onPressMemo).toHaveBeenCalledTimes(1);
    expect(onPressPhoto).toHaveBeenCalledTimes(1);

    // 부재 — 완료 카드엔 [방문 완료]·[길찾기]가 없고, 관람 중 카드의 고정 testID 도 쓰지 않는다(02a ★1·★2).
    expect(screen.queryByTestId('execution-arrive-complete')).toBeNull();
    expect(screen.queryByTestId(id('directions'))).toBeNull();
    expect(screen.queryByTestId('execution-arrive-photo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();
    expect(onPressComplete).not.toHaveBeenCalled();
    expect(onPressDirections).not.toHaveBeenCalled();
  });

  it('C20 done [사진]·[메모]는 관람 중 카드의 버튼과 className 이 같고, 글리프는 PhotoGlyph·MemoGlyph 16 이다', () => {
    // 준비 — 같은 슬롯을 관람 중으로 먼저 그려 그 버튼 className 을 읽는다(리터럴 복사 금지, 02a ★15).
    const activeView = render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="active"
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
      />
    );
    const activePhotoClass = screen.getByTestId('execution-arrive-photo').props
      .className as string;
    const activeMemoClass = screen.getByTestId('execution-arrive-memo').props
      .className as string;
    activeView.unmount();
    // 앵커 — 빈 문자열끼리 같아지는 공허 통과 차단.
    expect(activePhotoClass).toContain('rounded-[10px]');

    // 실행 — 같은 슬롯을 완료로 그린다.
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
      />
    );

    // 단언
    const photo = screen.getByTestId(id('done-photo'));
    const memo = screen.getByTestId(id('done-memo'));
    expect(photo.props.className).toBe(activePhotoClass);
    expect(memo.props.className).toBe(activeMemoClass);
    expect(photo.findByType(PhotoGlyph).props.size).toBe(16);
    expect(memo.findByType(MemoGlyph).props.size).toBe(16);
  });

  it('C21 done 이 사진·메모 콜백·안내를 안 받으면 done 버튼·안내가 하나도 없다 (TRIP-939 무회귀)', () => {
    render(<SlotProgressCard slot={mkSlot()} date={DATE} state="done" />);

    // 짝 앵커 — 카드는 그려졌다.
    expect(screen.getByTestId(id('visit-time'))).toHaveTextContent('09:30');
    for (const role of DONE_IDS) {
      expect(screen.queryByTestId(id(role))).toBeNull();
    }
  });

  it('C22 done 이 photoNotice 를 받으면 done 안내 한 줄이, onPressPhotoSettings 까지 받으면 [설정 열기]가 서고 누르면 1회 불린다', () => {
    // 준비·실행
    const onPressPhotoSettings = jest.fn();
    const { rerender } = render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        onPressPhoto={jest.fn()}
        photoNotice={PHOTO_DENIED}
        onPressPhotoSettings={onPressPhotoSettings}
      />
    );

    // 단언 — 문구 완전 일치, 고정 testID 는 아니다.
    expect(screen.getByTestId(id('done-photo-notice'))).toHaveTextContent(
      PHOTO_DENIED
    );
    expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-photo-settings')).toBeNull();
    const settings = screen.getByTestId(id('done-photo-settings'));
    expect(settings).toHaveTextContent('설정 열기');
    fireEvent.press(settings);
    expect(onPressPhotoSettings).toHaveBeenCalledTimes(1);

    // 실행·단언 — 안내가 비면 [설정 열기]도 없다.
    rerender(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        onPressPhoto={jest.fn()}
        photoNotice={null}
        onPressPhotoSettings={onPressPhotoSettings}
      />
    );
    expect(screen.getByTestId(id('done-photo'))).toBeOnTheScreen();
    expect(screen.queryByTestId(id('done-photo-notice'))).toBeNull();
    expect(screen.queryByTestId(id('done-photo-settings'))).toBeNull();
  });

  it('C23 done 메모 안내는 그 문구 그대로 한 줄이고, 순서는 사진 행 → 버튼 → 사진 안내 → [설정 열기] → 메모 안내 → 메모 박스다', () => {
    render(
      <SlotProgressCard
        slot={mkSlot()}
        date={DATE}
        state="done"
        photos={PHOTOS}
        memo={MEMO}
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
        photoNotice={PHOTO_FAILED}
        onPressPhotoSettings={jest.fn()}
        memoNotice={DONE_MEMO_FAILED}
      />
    );

    expect(screen.getByTestId(id('done-memo-notice'))).toHaveTextContent(
      DONE_MEMO_FAILED
    );
    expect(screen.queryByTestId('execution-arrive-memo-notice')).toBeNull();

    const order = testIdOrder();
    const at = (testID: string) => order.indexOf(testID);
    // 앵커 — 이미 있는 두 요소(사진 행 < 메모 박스)가 위→아래로 나온다(추출기 자가검사).
    expect(at(id('photos'))).toBeGreaterThanOrEqual(0);
    expect(at(id('memo'))).toBeGreaterThan(at(id('photos')));
    expect(at(id('done-photo'))).toBeGreaterThan(at(id('photos')));
    expect(at(id('done-memo'))).toBeGreaterThan(at(id('done-photo')));
    expect(at(id('done-photo-notice'))).toBeGreaterThan(at(id('done-memo')));
    expect(at(id('done-photo-settings'))).toBeGreaterThan(
      at(id('done-photo-notice'))
    );
    expect(at(id('done-memo-notice'))).toBeGreaterThan(
      at(id('done-photo-settings'))
    );
    expect(at(id('memo'))).toBeGreaterThan(at(id('done-memo-notice')));
  });

  it('C24 upcoming 은 사진·메모 콜백·안내를 받아도 done 버튼·안내도 고정 버튼도 그리지 않는다 (누설 앵커)', () => {
    render(
      <SlotProgressCard
        slot={mkSlot({ startAt: '15:00:00' })}
        date={DATE}
        state="upcoming"
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
        photoNotice={PHOTO_FAILED}
        onPressPhotoSettings={jest.fn()}
        memoNotice={DONE_MEMO_FAILED}
      />
    );

    // 짝 앵커 — 예정 얼굴이다.
    expect(screen.getByTestId(id('time'))).toHaveTextContent('15:00 도착 예정');
    expect(screen.queryAllByTestId(DONE_ANY)).toHaveLength(0);
    expect(screen.queryByTestId('execution-arrive-photo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();
  });

  it('C25 active 는 콜백·안내를 다 받아도 고정 testID 만 쓰고 done testID 는 하나도 그리지 않는다 (누설 앵커)', () => {
    render(
      <SlotProgressCard
        slot={mkSlot({ startAt: '13:00:00' })}
        date={DATE}
        state="active"
        onPressPhoto={jest.fn()}
        onPressMemo={jest.fn()}
        photoNotice={PHOTO_FAILED}
        onPressPhotoSettings={jest.fn()}
        memoNotice={DONE_MEMO_FAILED}
      />
    );

    expect(screen.getByTestId('execution-arrive-photo')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-arrive-memo')).toBeOnTheScreen();
    expect(
      screen.getByTestId('execution-arrive-photo-notice')
    ).toHaveTextContent(PHOTO_FAILED);
    expect(
      screen.getByTestId('execution-arrive-memo-notice')
    ).toHaveTextContent(DONE_MEMO_FAILED);
    expect(screen.queryAllByTestId(DONE_ANY)).toHaveLength(0);
  });
});
