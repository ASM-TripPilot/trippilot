import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { ALT_LABEL } from '../config/altLabel';
import { resolveCategoryPlaceholder } from '../lib/categoryPlaceholder';
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

/* ──────────── TRIP-1116 · 사진 대체 블록 크기 = 사진 자리(72) ────────────
 * 사진 없는 슬롯의 대체 블록이 78 이라 옆 카드 사진(72)보다 커서 시각·이름 줄이 밀렸다.
 * className 은 공백으로 쪼갠 토큰 배열로 비교한다 — 문자열 부분 포함은 `min-h-[78px]` 에 오탐한다.
 * ⚠️ 실제 픽셀 정렬(이름 x 시작점·카드 높이)은 jest 사각 — 6-b 육안.
 * ─────────────────────────────────────────────────────────────────────── */
function classTokens(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '').split(/\s+/);
}

/** 크기 토큰(`h-*`·`w-*`)만 정렬해 뽑는다 — `min-h-*`·`max-w-*` 는 접두가 달라 빠진다. */
function sizeTokens(node: ReactTestInstance): string[] {
  return classTokens(node)
    .filter((token) => /^[hw]-/.test(token))
    .sort();
}

describe('🔴 SlotStopCard · CS9 — 사진 대체 블록이 사진 자리와 같은 72 (TRIP-1116)', () => {
  it('CS9a · A1 — 사진 없는 슬롯의 대체 블록은 72×72·rounded-thumb 이고 78 토큰이 없다', () => {
    const { slotKey } = renderCard({ slot: makeSlot({ imageUrl: null }) });

    const tokens = classTokens(
      screen.getByTestId(id(slotKey)('photoplaceholder'))
    );
    expect(tokens).toEqual(
      expect.arrayContaining(['h-[72px]', 'w-[72px]', 'rounded-thumb'])
    );
    expect(tokens).not.toContain('h-[78px]');
    expect(tokens).not.toContain('w-[78px]');
  });

  it('CS9b · A2 — 사진 있는 슬롯의 사진은 지금처럼 72×72·rounded-thumb 다 (무회귀 · 선제 green)', () => {
    const { slotKey } = renderCard();

    expect(classTokens(screen.getByTestId(id(slotKey)('photo')))).toEqual(
      expect.arrayContaining(['h-[72px]', 'w-[72px]', 'rounded-thumb'])
    );
  });

  it('CS9c · A6 — 같은 카드의 사진 크기 토큰과 대체 블록 크기 토큰이 같다', () => {
    // 준비: 사진 있는 카드와 없는 카드를 한 화면에 나란히(slotKey 가 달라 testID 가 안 겹친다).
    const withPhoto = makeSlot({ poiId: 'poi-photo' });
    const noPhoto = makeSlot({ poiId: 'poi-nophoto', imageUrl: null });
    render(
      <>
        <SlotStopCard slot={withPhoto} date={DATE} index={0} />
        <SlotStopCard slot={noPhoto} date={DATE} index={1} />
      </>
    );

    const photo = sizeTokens(
      screen.getByTestId(id(buildSlotKey(DATE, withPhoto.poiId))('photo'))
    );
    const placeholder = sizeTokens(
      screen.getByTestId(
        id(buildSlotKey(DATE, noPhoto.poiId))('photoplaceholder')
      )
    );

    // 앵커 — 비교할 크기 토큰이 실제로 있다(빈 배열끼리 같아지는 공허한 green 차단).
    expect(photo).toHaveLength(2);
    expect(placeholder).toEqual(photo);
  });

  // "기본" = 매핑 밖 폴백 타일 — 가장 흔한 실제 입력 null 로 대표한다.
  const CATEGORIES: (string | null)[] = [
    '명소',
    '맛집',
    '카페',
    '야경',
    '자연',
    '쇼핑',
    '문화',
    null,
  ];

  it.each(CATEGORIES)(
    'CS9d · A4 — 카테고리 %s: 틴트·72 크기가 testID 를 단 그 root 노드에 함께 있다 (★3 배선)',
    (category) => {
      const { slotKey } = renderCard({
        slot: makeSlot({ imageUrl: null, category }),
      });

      const tokens = classTokens(
        screen.getByTestId(id(slotKey)('photoplaceholder'))
      );
      // 틴트 값 자체는 categoryPlaceholder.test.ts 가 잠근다 — 여기선 "같은 노드" 배선만 본다.
      expect(tokens).toContain(resolveCategoryPlaceholder(category).tintClass);
      expect(tokens).toContain('h-[72px]');
    }
  );

  it.each(CATEGORIES)(
    'CS9e · A5 — 카테고리 %s: 대체 블록 안에 텍스트 노드가 없다 (INV-3 · 선제 green)',
    (category) => {
      const { slotKey } = renderCard({
        slot: makeSlot({ imageUrl: null, category }),
      });

      // host 노드(문자열 타입)만 추린다 — RN `Text` 와 SVG `RNSVGText` 둘 다 이름에 Text 가 있다.
      const hosts = screen
        .getByTestId(id(slotKey)('photoplaceholder'))
        .findAll((node) => typeof node.type === 'string')
        .map((node) => String(node.type));

      // 앵커 — 루트 View 말고도 아이콘이 실제로 그려졌다(아이콘이 통째로 빠져도 "텍스트 0"은 green 이라서).
      expect(hosts.length).toBeGreaterThan(1);
      expect(hosts.filter((type) => /Text/.test(type))).toEqual([]);
    }
  );
});
