import { Image, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PastTripRow } from './PastTripRow';
import type { PastTripCardVM } from '../model';

/**
 * TRIP-808 · AC-5 — entities/trip/ui/PastTripRow: j07 지난 여행 행(props-only 순수 프레젠테이션).
 * (features/record/ui/PastTripList 의 행을 이관 — 카드 = **제목 + 날짜범위(+박수)만**, 사진 없음.)
 *
 * 무엇을 보장하나:
 *  - 🔴 제목·날짜범위·박수를 **별개 leaf** 로 그린다(`getByText` 완전일치가 각각 잡음 — 한 줄로 합치면
 *    exact 매치 실패, 현 PastTripList 계약 계승). `Trip` 계약에 사진·통계 필드가 없어 **실사진(`<Image>`)·
 *    "사진 N·메모 M" 통계줄은 안 그린다**(INV-1 정직 degrade). 단 72×72 **placeholder 자리 박스**(bg-surface-soft,
 *    이미지 없는 빈 박스)는 크롬으로 그린다(TRIP-767 · 실사진·통계 = TRIP-638 이후 · PR5).
 *  - 🔴 null 라벨은 미렌더(가짜 날짜·가짜 "0박" 금지). 제목만 있어도 카드는 뜬다.
 *  - 🔴 chevron 은 카드가 소유하지 않고 소비처가 **`trailing` 슬롯**으로 주입한다(807 SavedStayCard 동형 —
 *    j07 PastTripList 가 RecordGlyphs.ChevronRightGlyph 를 넣는다). shared 승격 없음(교차 0).
 *  - 🔴 testID 는 소비처가 **명시 full 문자열**(`record-calendar-past-trip-{id}`)로 주입한다 — 그래서 그
 *    리터럴이 PastTripList.tsx 에 잔존해 선재 `recordsCalendarStructure.test.ts` G3 앵커가 재조준 없이 산다.
 *
 * *(개념 — trailing 슬롯)* 카드가 자식 요소를 통째로 받아 우측에 끼워 넣는 자리. 무엇을 그릴지는 소비처가
 *  정하고 카드는 위치만 준다(chevron 이든 무엇이든 카드는 모른다).
 *
 * 3동작 뼈대: 준비=VM+testID+trailing → 실행=render/press → 단언=leaf 텍스트/부재/슬롯.
 */

const noop = () => {};
const ROOT = 'record-calendar-past-trip-t9';

function vm(over: Partial<PastTripCardVM> = {}): PastTripCardVM {
  return {
    tripId: 't9',
    title: '부산 여행',
    dateRangeLabel: '2026.5.1–5.3',
    nightsLabel: '2박 3일',
    ...over,
  };
}

describe('🔴 PR1 · 제목·날짜범위·박수를 별개 leaf 로 + root testID + onPress', () => {
  it('세 leaf 완전일치로 뜨고, 행을 누르면 onPress 가 올라간다', () => {
    const onPress = jest.fn();
    render(<PastTripRow vm={vm()} onPress={onPress} testID={ROOT} />);

    expect(screen.getByTestId(ROOT)).toBeOnTheScreen();
    // 별개 leaf — 완전일치(합치면 exact 실패). 날짜범위 구분자는 en dash(U+2013).
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
    expect(screen.getByText('2026.5.1–5.3')).toBeOnTheScreen();
    expect(screen.getByText('2박 3일')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(ROOT));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 PR2 · null 라벨은 미렌더(가짜값 금지) — 제목·카드는 뜬다', () => {
  it('dateRangeLabel·nightsLabel 이 null 이면 그 leaf 가 없고 제목만 남는다', () => {
    render(
      <PastTripRow
        vm={vm({ dateRangeLabel: null, nightsLabel: null })}
        onPress={noop}
        testID={ROOT}
      />
    );

    // 짝 — 카드·제목은 뜬다(빈 렌더로 아래 부재 단언이 공짜 통과하는 것 차단).
    expect(screen.getByTestId(ROOT)).toBeOnTheScreen();
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();

    // 못 만든 라벨은 미렌더(가짜 날짜·가짜 "0박" 금지).
    expect(screen.queryByText('2026.5.1–5.3')).toBeNull();
    expect(screen.queryByText('2박 3일')).toBeNull();
  });

  it('한쪽만 null 이어도 있는 쪽만 뜬다(부분 degrade)', () => {
    render(
      <PastTripRow
        vm={vm({ dateRangeLabel: '2026.5.1–5.3', nightsLabel: null })}
        onPress={noop}
        testID={ROOT}
      />
    );
    expect(screen.getByText('2026.5.1–5.3')).toBeOnTheScreen();
    expect(screen.queryByText('2박 3일')).toBeNull();
  });
});

describe('🔴 PR3 · trailing 슬롯 — 주면 렌더, 미지정이면 부재(카드는 chevron 불가지)', () => {
  it('trailing 을 주면 그 노드가 뜨고, 안 주면 없다', () => {
    const { rerender } = render(
      <PastTripRow
        vm={vm()}
        onPress={noop}
        testID={ROOT}
        trailing={<Text testID="trailing-slot">›</Text>}
      />
    );
    expect(screen.getByTestId('trailing-slot')).toBeOnTheScreen();

    rerender(<PastTripRow vm={vm()} onPress={noop} testID={ROOT} />);
    expect(screen.queryByTestId('trailing-slot')).toBeNull();
  });
});

describe('🔴 PR4 · 사진·통계 발명 0 (INV-1 — Trip 계약에 없음)', () => {
  it('제목만 준 행에 사진 통계("사진 N·메모 M")·₩·km 같은 발명 문자열이 없다', () => {
    render(
      <PastTripRow
        vm={vm({ dateRangeLabel: null, nightsLabel: null })}
        onPress={noop}
        testID={ROOT}
      />
    );

    // 사진 장수·메모 수·가격·거리를 카드가 지어내지 않는다.
    expect(screen.queryAllByText(/사진|메모|₩|km/)).toHaveLength(0);
    // 짝 — 제목은 뜬다.
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
  });
});

describe('🔴 PR5 · j07 정합 — 72×72 placeholder 자리 + 사진/메모·실사진 미렌더 (TRIP-767)', () => {
  it('제목·기간이 다 있는 카드에도 72×72 placeholder 박스만 있고, 통계줄·실사진(Image)은 없다', () => {
    // 준비 — 완전 VM(제목·날짜·박수 다 있음, 부산 2025 픽스처 대응).
    render(<PastTripRow vm={vm()} onPress={noop} testID={ROOT} />);

    // 짝(긍정) — placeholder 자리 박스가 실재한다(testID = `{root}-thumb`). 현 카드엔 없음 → red.
    // (72×72·bg-surface-soft·이미지 없는 빈 박스 = 크롬 자리. 픽셀·정렬은 6-b.)
    expect(screen.getByTestId(`${ROOT}-thumb`)).toBeOnTheScreen();

    // 부정 — VM(`PastTripCardVM`)에 photoCount·memoCount·사진 URL 필드가 없어(INV-1) 통계줄을 안 그린다.
    expect(screen.queryAllByText(/사진|메모/)).toHaveLength(0);
    // 부정 — 실사진(`<Image>`)도 없다(placeholder 빈 박스뿐 — 실사진은 TRIP-638 이후).
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);

    // 짝(긍정) — 제목·기간 leaf 는 그대로(빈 렌더로 부재 단언이 공짜 통과하는 것 차단).
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
    expect(screen.getByText('2026.5.1–5.3')).toBeOnTheScreen();
  });
});
