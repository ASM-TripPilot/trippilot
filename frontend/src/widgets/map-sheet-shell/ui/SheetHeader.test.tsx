import { render, screen, within } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { SheetHeader } from './SheetHeader';

/**
 * TRIP-783 · AC-3 — 시트 헤더(widgets, presentation-only). `title·dayLabel·dateLabel·meta`
 * 4문자열을 소비처가 조립해 주입하고, 헤더는 각각 값 하나만 담는 leaf 로 그린다(합산·날짜 포맷은
 * 소비처 몫 — 셸을 presentation-only 로 유지, 01b Q3 결정). 각 leaf 는 `toHaveTextContent(문자열)`
 * **완전일치**로 잠근다(가운뎃점 구분자는 testID 없는 별도 Text, 02a §5 실검증).
 *
 * 3동작 뼈대: 준비=4문자열 주입 렌더 → 실행=렌더만 → 단언=leaf 완전일치.
 */

describe('🔴 SheetHeader · SHH1 — 4 leaf 완전일치(AC-3)', () => {
  it('title·dayLabel·dateLabel·meta 가 각각 값 하나만 담는 leaf 로 그려진다', () => {
    render(
      <SheetHeader
        title="AI 추천안"
        dayLabel="1일차"
        dateLabel="6월 10일(수)"
        meta="4곳 · 3.5km"
      />
    );

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 추천안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 10일(수)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '4곳 · 3.5km'
    );

    // 완전일치 잠금(02a ★1) — meta 는 한 leaf 에 조립 문자열 전체를 담는다(부분포함이면 통과).
    expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(
      '4곳'
    );
  });
});

/* ──────────────── TRIP-790 · D5 가산 — 빈 세그먼트 생략 ────────────────
 * h07 헤더는 2세그다("1일차 완성 · 6월 10일(수)"). 현행 헤더는 title·dayLabel·dateLabel 3세그를
 * 구분자 2개로 항상 그려, dateLabel="" 를 주면 "· ·" 중복(빈 leaf + 꼬리 구분자)이 생긴다.
 * D5: **빈 문자열 세그먼트와 그 구분자를 렌더 안 한다.** SHH1(3세그 전부 비어있지 않음)은
 * 무변경 회귀 앵커다.
 * ─────────────────────────────────────────────────────────────────────── */
describe('🔴 SheetHeader · SHH2 — 빈 dateLabel 세그+구분자 생략 (D5)', () => {
  it('dateLabel="" 이면 date leaf 가 없고 구분자 · 는 딱 1개다', () => {
    // 준비 — h07 조립값(dateLabel 만 빈 문자열).
    render(
      <SheetHeader
        title="1일차 완성"
        dayLabel="6월 10일(수)"
        dateLabel=""
        meta="3곳 · 3.5km"
      />
    );

    // ① 빈 세그 leaf 자체가 안 그려진다(현행은 빈 문자열로 항상 렌더 → 여기서 red).
    expect(screen.queryByTestId('sheet-header-date')).toBeNull();
    // ② 구분자 · 는 title·day 사이 하나뿐(꼬리 구분자 없음). `queryAllByText('·')` 는
    //    testID 없는 별도 `<Text>·</Text>` 를 잡아 개수를 센다(02a §5 실검증). 현행은 2개라 red.
    expect(screen.queryAllByText('·')).toHaveLength(1);
    // 짝 — 비어있지 않은 두 세그는 그대로 뜬다.
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '1일차 완성'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent(
      '6월 10일(수)'
    );
  });
});

/* ──────────────── TRIP-1791 가산 — 오른쪽 `trailing` 슬롯 ────────────────
 * 편집 머리 오른쪽에 「선택」 버튼을 담으려는 additive prop. 안 주는 소비처(다른 5곳)는 트리가 그대로다.
 * ─────────────────────────────────────────────────────────────────────── */
describe('SheetHeader · SHH3 — trailing 슬롯은 줄 때만 래퍼와 함께 생긴다', () => {
  it('trailing 을 주면 래퍼 안에 그 노드가 있고 meta leaf 는 그대로이며, 안 주면 래퍼가 없다', () => {
    // 준비 + 실행 — trailing 있는 렌더.
    render(
      <SheetHeader
        title="일정 편집"
        dayLabel="1일차"
        dateLabel="6월 10일(수)"
        meta="3곳"
        trailing={
          <Pressable accessibilityRole="button" testID="trailing-probe">
            <Text>선택</Text>
          </Pressable>
        }
      />
    );

    // 단언 — 래퍼 안에 있고, 기존 leaf 는 값 하나 그대로(완전일치).
    expect(
      within(screen.getByTestId('sheet-header-trailing')).getByTestId(
        'trailing-probe'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('3곳');
    screen.unmount();

    // 짝 — 안 준 렌더에는 래퍼 자체가 없다(기존 소비처 무변경).
    render(
      <SheetHeader
        title="일정 편집"
        dayLabel="1일차"
        dateLabel="6월 10일(수)"
        meta="3곳"
      />
    );
    expect(screen.queryByTestId('sheet-header-trailing')).toBeNull();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('3곳');
  });
});
