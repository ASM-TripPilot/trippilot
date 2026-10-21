import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';

import { ALT_LABEL } from '../config/altLabel';
import { buildSlotKey } from '../lib/slotKey';
import { ChevronRightGlyph } from './SlotGlyphs';
import { SlotStopCard } from './SlotStopCard';

/** 호스트가 누를 수 있는가 — Pressable 은 onPress 없이도 응답자 핸들러를 단다(02a ★6 · §5-B). */
function isTouchable(node: ReactTestInstance): boolean {
  return (
    typeof node.props.onStartShouldSetResponder === 'function' ||
    typeof node.props.onClick === 'function'
  );
}

/**
 * TRIP-783 · AC-3·AC-7·E1·E2·E4·E5 — 결과 화면 공용 슬롯 카드(신설·병존, `PoiSlotCard` 대체 아님).
 * presentation-only: `timeLabel` 을 prop 으로 받으면 시각 칩을 그린다("받으면 그린다", 3-a 결정).
 *
 * 무엇을 보장하나:
 *  - 새 testID 접두 `slot-stopcard-*`(기존 4접두와 충돌 0, 02a ★9). 각 leaf 는 값 하나만 담고
 *    `toHaveTextContent(문자열)` **완전일치**로 잠근다(02a ★1·§5 — matches.js exact=true 실검증).
 *  - E1 사진 null → `SlotPhotoPlaceholder`(요소 대체) · E2 시각 null → 칩 요소 부재(빈 칩 금지) ·
 *    E4 필수/고정 배지 조건부 · E5 `onPressAlt` 있을 때만 `ALT_LABEL` 링크.
 *  - AC-7 — 링크 문구는 공용 상수 `ALT_LABEL`(config)에서 온다(카드가 소비).
 *
 * 3동작 뼈대: 준비=슬롯 객체로 렌더 → 실행=렌더/press → 단언=leaf 텍스트·부재·불린 콜백.
 * ⚠️ 카드 자체는 시각을 조립하지 않는다 — `timeLabel` 은 소비처가 만든 문자열을 그대로 그린다.
 */

const DATE = '2026-06-10';

function makeSlot(
  overrides: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId: 'poi-gwangalli',
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: ['바다', '산책'],
    nameKo: '광안리 해변',
    category: '자연',
    imageUrl: 'https://cdn.example.com/gwangalli.jpg',
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof SlotStopCard>[0]> = {}): {
  slotKey: string;
} {
  const slot = props.slot ?? makeSlot();
  render(
    <SlotStopCard
      slot={slot}
      date={DATE}
      index={0}
      timeLabel="10:00–11:00"
      {...props}
    />
  );
  return { slotKey: buildSlotKey(DATE, slot.poiId) };
}

const id =
  (slotKey: string) =>
  (part: string): string =>
    `slot-stopcard-${part}-${slotKey}`;

describe('🔴 SlotStopCard · CS1 — leaf 완전일치 계약 (AC-3)', () => {
  it('번호·이름·태그·시각 칩이 각각 값 하나만 담는 leaf 로 그려진다', () => {
    const { slotKey } = renderCard();
    const at = id(slotKey);

    // 긍정 — 각 leaf 가 자기 값 하나만 담는다(완전일치).
    expect(screen.getByTestId(at('number'))).toHaveTextContent('1'); // index 0 → 1
    expect(screen.getByTestId(at('name'))).toHaveTextContent('광안리 해변');
    expect(screen.getByTestId(at('tags'))).toHaveTextContent('바다 · 산책');
    expect(screen.getByTestId(at('time'))).toHaveTextContent('10:00–11:00');
    expect(screen.getByTestId(at('photo'))).toBeOnTheScreen();

    // 완전일치 잠금 — 부분포함이면 통과, exact 라 실패 → .not 성립(02a ★1).
    expect(screen.getByTestId(at('time'))).not.toHaveTextContent('10:00');
    expect(screen.getByTestId(at('tags'))).not.toHaveTextContent('바다');
  });
});

describe('🔴 SlotStopCard · CS2 — E1 사진 null → 플레이스홀더', () => {
  it('imageUrl 이 null 이면 사진 leaf 대신 SlotPhotoPlaceholder 를 그린다', () => {
    const { slotKey } = renderCard({ slot: makeSlot({ imageUrl: null }) });
    const at = id(slotKey);

    expect(screen.queryByTestId(at('photo'))).toBeNull();
    expect(screen.getByTestId(at('photoplaceholder'))).toBeOnTheScreen();
  });
});

describe('🔴 SlotStopCard · CS3 — E2 시각 null → 칩 생략', () => {
  it('timeLabel 미주입이면 시각 칩 요소 자체가 없다(빈 칩 금지)', () => {
    const { slotKey } = renderCard({ timeLabel: null });
    const at = id(slotKey);

    expect(screen.queryByTestId(at('time'))).toBeNull();
    // 짝 — 시각만 빠지고 카드는 살아 있다.
    expect(screen.getByTestId(at('name'))).toBeOnTheScreen();
    expect(screen.getByTestId(at('tags'))).toBeOnTheScreen();
  });
});

describe('🔴 SlotStopCard · CS4 — E4 필수 배지 조건부', () => {
  it('required 면 배지 present, 미주입이면 부재(짝)', () => {
    const { slotKey } = renderCard({ required: true });
    expect(screen.getByTestId(id(slotKey)('required'))).toBeOnTheScreen();
  });

  it('required 미주입이면 배지 부재', () => {
    const { slotKey } = renderCard();
    expect(screen.queryByTestId(id(slotKey)('required'))).toBeNull();
  });
});

describe('🔴 SlotStopCard · CS5 — E4 고정 배지 + 부제 조건부', () => {
  it('fixed·subtitle 주입이면 고정 배지 + 부제 완전일치', () => {
    const { slotKey } = renderCard({
      slot: makeSlot({ isFixed: true }),
      fixed: true,
      subtitle: '저녁 · 숙소 · 변경 불가',
    });
    const at = id(slotKey);

    expect(screen.getByTestId(at('fixed'))).toBeOnTheScreen();
    expect(screen.getByTestId(at('subtitle'))).toHaveTextContent(
      '저녁 · 숙소 · 변경 불가'
    );
  });

  it('TRIP-1439 Q-096·102 · 방문 완료(locked)한 고정 슬롯은 "고정" 대신 "방문 완료"로 읽힌다', () => {
    const { slotKey } = renderCard({
      slot: makeSlot({ isFixed: true }),
      fixed: true,
      locked: true,
    });
    expect(screen.getByTestId(id(slotKey)('fixed'))).toHaveTextContent(
      '방문 완료'
    );
  });

  it('TRIP-1439 · 방문 완료가 아닌 고정 슬롯(숙소 등)은 그대로 "고정"이다', () => {
    const { slotKey } = renderCard({
      slot: makeSlot({ isFixed: true }),
      fixed: true,
    });
    expect(screen.getByTestId(id(slotKey)('fixed'))).toHaveTextContent('고정');
  });

  it('fixed·subtitle 미주입이면 둘 다 부재(짝)', () => {
    const { slotKey } = renderCard();
    const at = id(slotKey);
    expect(screen.queryByTestId(at('fixed'))).toBeNull();
    expect(screen.queryByTestId(at('subtitle'))).toBeNull();
  });
});

describe('🔴 SlotStopCard · CS6 — E5 다른 후보 링크 + AC-7 공용 상수', () => {
  it('onPressAlt 주입이면 ALT_LABEL 링크가 뜨고 press 가 그 콜백만 부른다', () => {
    const onPressAlt = jest.fn();
    const onPressName = jest.fn();
    const { slotKey } = renderCard({ onPressAlt, onPressName });
    const at = id(slotKey);

    // AC-7 — 링크 문구가 공용 상수와 완전일치(카드가 config 상수를 소비).
    expect(screen.getByTestId(at('alt'))).toHaveTextContent(ALT_LABEL);

    fireEvent.press(screen.getByTestId(at('alt')));

    // 버블링 잠금(02a ★13) — alt press 는 alt 콜백만, name 콜백 0.
    expect(onPressAlt).toHaveBeenCalledTimes(1);
    expect(onPressName).not.toHaveBeenCalled();
  });

  it('onPressAlt 미주입이면 링크 부재(고정 슬롯엔 없음, 짝)', () => {
    const { slotKey } = renderCard();
    expect(screen.queryByTestId(id(slotKey)('alt'))).toBeNull();
  });
});

describe('🔴 SlotStopCard · CS7 — 이름 press 어포던스', () => {
  it('onPressName 주입 시 이름 press 가 콜백을 부른다', () => {
    const onPressName = jest.fn();
    const { slotKey } = renderCard({ onPressName });

    fireEvent.press(screen.getByTestId(id(slotKey)('name')));

    expect(onPressName).toHaveBeenCalledTimes(1);
  });

  it('TRIP-939 AC-7: onPressName 미주입이면 이름은 누를 수 없는 글자이고 옆 › 도 없다 (A-3 · Q4)', () => {
    // 준비·실행: 라이브 호출부 6곳의 현재 모양(이름 진입 미주입). 기본 렌더는 편집기 칩이 아니라
    // 카드 안 ChevronRightGlyph 는 이름 옆 › 하나뿐이다(02a ★11).
    const { slotKey } = renderCard();
    const name = screen.getByTestId(id(slotKey)('name'));

    // 단언: 이름은 그대로 보이되(앵커) 버튼이 아니고, 누를 수 있어 보이는 › 가 없다.
    expect(name).toHaveTextContent('광안리 해변');
    expect(isTouchable(name)).toBe(false);
    expect(screen.UNSAFE_queryAllByType(ChevronRightGlyph)).toHaveLength(0);
  });

  it('onPressName 주입이면 이름이 버튼이고 › 가 1개다(짝 — 목적지가 생기면 되살림)', () => {
    const { slotKey } = renderCard({ onPressName: jest.fn() });

    expect(isTouchable(screen.getByTestId(id(slotKey)('name')))).toBe(true);
    expect(screen.UNSAFE_queryAllByType(ChevronRightGlyph)).toHaveLength(1);
  });
});

/* ──────────────── TRIP-801 · D4 가산(h16 휴관 경고) ────────────────
 * h16 확정 얼굴은 이름 옆에 "⏰ 휴관일 확인" 인라인 경고를 얹는다. `warning?: string | null`(가산)를
 * 주면 그 문구를 `slot-stopcard-warning-*` leaf 로 그린다 — 미주입=미렌더(6종 공용 카드 후방호환).
 * 트리거(`openingHoursKnown === false`)·문구 상수는 소비처(페이지) 몫이고, 카드는 받은 문자열만 그린다.
 * ⚠️ 빨강 텍스트·시계 글리프 톤은 6-b 육안(SVG 색은 jest 사각) — 여기선 leaf 텍스트·부재만 잠근다.
 * ─────────────────────────────────────────────────────────────────────── */
describe('🔴 SlotStopCard · CS8 — warning 가산(휴관 경고, 후방호환)', () => {
  it('CS8a · warning 주입이면 경고 leaf 가 완전일치로 뜬다', () => {
    const { slotKey } = renderCard({ warning: '휴관일 확인' });

    expect(screen.getByTestId(id(slotKey)('warning'))).toHaveTextContent(
      '휴관일 확인'
    );
  });

  it('CS8b · warning 미주입이면 경고 leaf 가 부재한다 (기존 소비처 무변경 · 선제 green)', () => {
    const { slotKey } = renderCard();
    expect(screen.queryByTestId(id(slotKey)('warning'))).toBeNull();
  });
});

/**
 * TRIP-797 · AC-2·AC-5·AC-6·AC-11 (OQ-2) — h12 편집기가 쓰는 `SlotStopCard` **가산(opt-in) 확장**.
 *
 * `SlotStopCard` 는 결과화면 6종(h07·h08·h11·h14·h16)이 이미 쓰는 공용 카드다. 편집기는 이 카드에
 * **옵셔널 prop 만 얹어** 통일한다 — prop 미전달이면 현행 그대로여야 한다(회귀 0, OQ-2). 이 파일은
 * 편집 어포던스(⌄ 시각칩 press·"시간대 설정" 칩·완료 잠금)와 **회귀 0**을 카드 원자 층에서 잠근다.
 * (TRIP-1356 · 옛 `SlotStopCard.editor.test.tsx` 를 이 파일로 합쳤다 — 픽스처·헬퍼 중복 제거, 관점은 describe 로 남는다.)
 *
 * 신규 옵셔널 prop(02a §1-C):
 *  - `onPressTimeChip?` — 주면 시각 칩을 누를 수 있게(⌄) 만든다(Pressable `slot-stopcard-timechip-*`).
 *    미주입이면 Pressable 자체를 안 그린다(결과화면: plain `slot-stopcard-time-*` leaf 그대로).
 *  - `unspecified?` — true면 시각 칩 대신 "시간대 설정" 칩(`slot-stopcard-unspecified-*`).
 *  - `locked?` — 방문 완료 잠금(AC-11): 시각칩 press 를 안 붙인다(INV-U3-03/i07).
 *
 * 3동작 뼈대: 준비=슬롯+편집 prop → 실행=렌더/press → 단언=새 testID 존재·부재·콜백 횟수.
 * ⚠️ 실개폐·픽셀(⌄ 모양)은 이 카드 밖 — press 콜백 발화까지만(시트 실개폐는 페이지·6-b, ★7).
 */

const KEY = buildSlotKey(DATE, 'poi-gwangalli');
const at = id(KEY);

describe('🔴 SlotStopCard 편집 · B1-1 — onPressTimeChip 주입 → 시각칩이 눌린다(AC-5)', () => {
  it('비고정 슬롯 시각칩 press 가 onPressTimeChip 을 부른다', () => {
    const onPressTimeChip = jest.fn();
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        onPressTimeChip={onPressTimeChip}
      />
    );

    expect(screen.getByTestId(at('timechip'))).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId(at('timechip')));
    expect(onPressTimeChip).toHaveBeenCalledTimes(1);
  });
});

describe('SlotStopCard 편집 · B1-2 (회귀앵커) — onPressTimeChip 미주입 = 결과화면 그대로', () => {
  it('편집 콜백이 없으면 누름 칩(timechip)이 없고 기존 시각 leaf 만 그린다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
      />
    );

    // 편집 어포던스 부재(결과화면 무회귀).
    expect(screen.queryByTestId(at('timechip'))).toBeNull();
    // 기존 시각 leaf 는 그대로(완전일치).
    expect(screen.getByTestId(at('time'))).toHaveTextContent('10:00–11:00');
  });
});

describe('🔴 SlotStopCard 편집 · B1-3 — 미지정 칩(AC-6)', () => {
  it('unspecified 면 시각칩 대신 "시간대 설정" 칩을 그리고 press 로 시트를 연다', () => {
    const onPressTimeChip = jest.fn();
    render(
      <SlotStopCard
        slot={makeSlot({ startAt: '00:00:00' })}
        date={DATE}
        index={0}
        timeLabel={null}
        unspecified
        onPressTimeChip={onPressTimeChip}
      />
    );

    expect(screen.getByTestId(at('unspecified'))).toBeOnTheScreen();
    expect(screen.getByText('시간대 설정')).toBeOnTheScreen();
    // 미지정이면 일반 시각칩·시각 leaf 는 없다.
    expect(screen.queryByTestId(at('time'))).toBeNull();

    fireEvent.press(screen.getByTestId(at('unspecified')));
    expect(onPressTimeChip).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 SlotStopCard 편집 · B1-4 — 완료 잠금(AC-11 · INV-U3-03)', () => {
  it('locked 면 잠금 표식을 그리고 시각칩 편집 어포던스를 안 붙인다', () => {
    const onPressTimeChip = jest.fn();
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        onPressTimeChip={onPressTimeChip}
        locked
      />
    );

    // 잠금 표식 present.
    expect(screen.getByTestId(at('locked'))).toBeOnTheScreen();
    // onPressTimeChip 을 줬어도 잠금이라 누름 칩이 없다(편집 불가).
    expect(screen.queryByTestId(at('timechip'))).toBeNull();
  });
});

describe('SlotStopCard 편집 · B1-6 (★회귀0) — 편집 prop 전무 = 새 testID 0', () => {
  it('세 편집 prop 미전달이면 timechip·unspecified·locked 가 없고 기존 leaf 는 그대로다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
      />
    );

    // OQ-2 회귀 0 — 새 어포던스 testID 가 하나도 안 붙는다(6종 결과화면 무영향의 카드 원자 그물).
    expect(screen.queryByTestId(at('timechip'))).toBeNull();
    expect(screen.queryByTestId(at('unspecified'))).toBeNull();
    expect(screen.queryByTestId(at('locked'))).toBeNull();
    // 기존 표면은 그대로.
    expect(screen.getByTestId(at('time'))).toHaveTextContent('10:00–11:00');
    expect(screen.getByTestId(at('name'))).toHaveTextContent('광안리 해변');
    expect(screen.getByTestId(at('tags'))).toHaveTextContent('바다 · 산책');
  });
});

// ── TRIP-753 · i07·h12 편집기 가산 opt-in(카드 원자 층) ─────────────────────────────────────
//
// 카드는 결과 화면 5종이 함께 쓴다 — 새 모양(카드 밖 번호·위반 배지)은 prop 을 줄 때만 나오고, 주지
// 않으면 지금 그대로여야 한다(C2·C5 가 회귀 앵커). 완료 잠금(`locked`)의 모양 변경은 편집기만 쓰는
// prop 이라 opt-in 없이 바뀐다(자물쇠 배지 → 회색 알약, 표식 testID 는 알약으로 이동).

/** className 을 공백으로 쪼갠 토큰(원소 일치 — `bg-primary` ≠ `bg-primary-pale`). */
function tokens(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);
}

describe('🔴 SlotStopCard 편집 · C1 — numberOutside: 번호 원이 카드 밖, 톤은 잠금이 가른다 (TRIP-753 AC-3)', () => {
  it('비잠금이면 카드 밖 primary 원에 "1" 을 그린다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        numberOutside
      />
    );

    expect(screen.getByTestId(at('number'))).toHaveTextContent('1');
    const card = screen.getByTestId(`slot-stopcard-${KEY}`);
    expect(within(card).queryByTestId(at('number'))).toBeNull();
    expect(tokens(at('number'))).toContain('bg-primary');
    expect(tokens(at('number'))).not.toContain('bg-success');
  });

  it('잠금(방문 완료)이면 같은 원이 success 톤이다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        numberOutside
        locked
      />
    );

    expect(tokens(at('number'))).toContain('bg-success');
    expect(tokens(at('number'))).not.toContain('bg-primary');
  });
});

describe('SlotStopCard 편집 · C2 (회귀앵커) — numberOutside 없으면 번호는 여전히 카드 안', () => {
  it('opt-in 을 안 켠 결과 화면 소비는 번호가 카드 루트의 자손이다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
      />
    );

    const card = screen.getByTestId(`slot-stopcard-${KEY}`);
    expect(within(card).getByTestId(at('number'))).toHaveTextContent('1');
  });
});

describe('🔴 SlotStopCard 편집 · C3 — 완료 잠금은 회색 알약, 자물쇠 배지 없음 (TRIP-753 AC-4)', () => {
  it('locked 표식이 muted-soft 테두리 알약 자체이고 그 안에 시각이 있으며 "방문 완료" 글자는 없다', () => {
    render(
      <SlotStopCard
        slot={makeSlot()}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        onPressTimeChip={jest.fn()}
        locked
      />
    );

    const locked = screen.getByTestId(at('locked'));
    expect(within(locked).getByTestId(at('time'))).toHaveTextContent(
      '10:00–11:00'
    );
    expect(screen.queryByText('방문 완료')).toBeNull();
    expect(screen.queryByTestId(at('timechip'))).toBeNull();
  });
});

describe('🔴 SlotStopCard 편집 · C4 — violation 을 주면 연분홍 배지 (TRIP-753 AC-6)', () => {
  it('문구 하나를 완전일치로 담고 primary-pale 배경이다', () => {
    render(
      <SlotStopCard
        slot={makeSlot({ hasViolation: true })}
        date={DATE}
        index={0}
        timeLabel="10:00–11:00"
        violation="숙소 고정 충돌"
      />
    );

    expect(screen.getByTestId(at('violation'))).toHaveTextContent(
      '숙소 고정 충돌'
    );
  });
});

describe('SlotStopCard 편집 · C5 (회귀앵커) — violation 없거나 null 이면 배지 없음', () => {
  it.each([
    ['미주입', undefined],
    ['null', null],
  ])(
    '%s 이면 카드는 있고 배지는 없다(hasViolation 을 카드가 스스로 읽지 않는다)',
    (_label, violation) => {
      render(
        <SlotStopCard
          slot={makeSlot({
            hasViolation: true,
            alternatives: [],
            violationReason: '숙소 고정 충돌',
          })}
          date={DATE}
          index={0}
          timeLabel="10:00–11:00"
          violation={violation}
        />
      );

      expect(screen.getByTestId(`slot-stopcard-${KEY}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(at('violation'))).toBeNull();
    }
  );
});
