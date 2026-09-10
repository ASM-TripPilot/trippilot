import { fireEvent, render, screen } from '@testing-library/react-native';

import { PartialFailureBanner } from './PartialFailureBanner';

/**
 * TRIP-692 · d04 다지역 부분 실패 degraded 배너 — 컴포넌트 단위 심판.
 *
 * 무엇을 보장하나:
 *  - **AC-7** 배너 **컨테이너 자신은 Pressable이 아니다**. 컨테이너 아무 데나 눌러도 재조회가
 *    나가지 않고(누르면 본문까지 재시도가 눌리는 함정 — brief §맹점③), "다시 시도" 버튼만
 *    `onRetry`를 부른다. 컨테이너를 실수로 `Pressable`(onPress=onRetry)로 만들면 컨테이너 press가
 *    onRetry를 1회 세어 `not.toHaveBeenCalled()`가 red가 된다.
 *  - **AC-1(카피)** 본문 문구와 재시도 라벨을 그린다(정본 공백이라 stay 문구를 도메인만 바꾼 발명값).
 *
 * 준비→실행→단언(3동작): render로 배너를 그리고(준비), testID로 컨테이너/버튼을 press(실행),
 * onRetry 호출 횟수·문구를 단언한다.
 *
 * 새 문법 한 줄:
 *  - `jest.fn()` = 호출 여부·횟수를 기록하는 가짜 함수(스파이). `toHaveBeenCalledTimes(1)`로 "정확히 1번".
 *  - `fireEvent.press(el)` = el에 걸린 onPress를 부른다. onPress가 없는 순수 View면 아무 일도 안 한다
 *    (throw 없이 no-op — 실측 확인, 02a §5). 그래서 "컨테이너 press → onRetry 0회"가 성립한다.
 *  - `getByText('문자열')` = 그 문자열과 **완전히 같은** 텍스트 노드를 찾는다(없으면 throw).
 */
describe('PartialFailureBanner — 컨테이너는 눌러도 재조회가 안 나간다 (AC-7)', () => {
  it('컨테이너 press는 no-op, "다시 시도" 버튼만 onRetry를 부른다', () => {
    const onRetry = jest.fn();
    render(<PartialFailureBanner onRetry={onRetry} />);

    // 배너 컨테이너 전체를 눌러도 재시도가 안 나간다(컨테이너가 Pressable이면 여기서 1회 불려 red).
    fireEvent.press(screen.getByTestId('explore-places-partialfailure'));
    expect(onRetry).not.toHaveBeenCalled();

    // "다시 시도" 버튼만 재조회를 부른다.
    fireEvent.press(screen.getByTestId('explore-places-partialfailure-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('PartialFailureBanner — 문구와 재시도 라벨 (AC-1 카피)', () => {
  it('"일부 지역을 불러오지 못했어요"와 "다시 시도"를 그린다', () => {
    render(<PartialFailureBanner onRetry={jest.fn()} />);

    expect(screen.getByText('일부 지역을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
  });
});
