import { fireEvent, render, screen } from '@testing-library/react-native';

import { SpontaneousVisitButton } from './SpontaneousVisitButton';

/**
 * TRIP-565 · AC-5(UI 반) — 즉석 방문 추가 버튼(순수 프레젠테이션).
 *
 * 무엇을 보장하나: testID `record-trip-spontaneous-add` 로 렌더되고, press 하면 onPress 가 1회 불린다.
 * 즉석 방문의 실제 적재(slotKey=null·MANUAL·2건 append)는 훅 레벨(useVisitCheck.integration.test)이 잠근다.
 */

describe('AC-5(UI) · 즉석 방문 추가 버튼', () => {
  it('record-trip-spontaneous-add press → onPress 1회', () => {
    const onPress = jest.fn();
    render(<SpontaneousVisitButton onPress={onPress} />);

    fireEvent.press(screen.getByTestId('record-trip-spontaneous-add'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

/**
 * 🔴 TRIP-759 · AC-4 — CTA 카피 축약 `즉석 방문 추가` → `방문 추가`(Figma 1557:1738).
 *
 * 무엇을 보장하나: 버튼 라벨이 `방문 추가` 이고, `즉석` 어휘는 어디에도 안 남는다.
 *
 * ★green-lie 방지: 위 press 블록은 testID·press 만 보고 **텍스트를 안 본다** → 카피를 안 바꿔도
 *   전수 green(파리티가 jest 사각). 이 describe 가 텍스트를 새로 잠근다(spec-analyst 실측).
 * ★exact-match 함정: `방문 추가` 는 현 `즉석 방문 추가` 의 **부분문자열**이다. RNTL `getByText(문자열)`
 *   이 부분포함이면 카피 미변경에도 매치돼 green-lie 가 된다 — matches.js 실측으로 기본 `exact=true`
 *   (완전일치, `===`)를 확인했다(02a §5-A). 그래서 현 노드 `즉석 방문 추가` ≠ `방문 추가` → 미발견 red.
 *
 * (개념) `getByText('방문 추가')` = 텍스트 노드 전체가 정확히 그 문자열(완전일치). `queryByText(/즉석/)`
 *   = 정규식이라 부분 포함 탐지(matches.js 는 정규식이면 `matcher.test(text)`) → `즉석` 이 남으면 잡힌다.
 */
describe('🔴 AC-4 · CTA 카피 = "방문 추가"(즉석 제거)', () => {
  it('라벨이 "방문 추가" 이고 "즉석" 어휘는 없다', () => {
    render(<SpontaneousVisitButton onPress={jest.fn()} />);

    // 긍정 — 새 카피(완전일치, 부분문자열 함정은 exact=true 로 무력화).
    expect(screen.getByText('방문 추가')).toBeTruthy();
    // 부정 — `즉석` 이 남은 텍스트 노드가 하나도 없다(정규식 부분포함 탐지).
    expect(screen.queryByText(/즉석/)).toBeNull();
  });
});
