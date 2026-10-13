import { render } from '@testing-library/react-native';
import { View } from 'react-native';

import { guardKeyWarnings } from './keyWarnings';

/**
 * `guardKeyWarnings` 탐지기 자가검사 — 겹친 key 와 빠진 key 를 둘 다 잡는다(TRIP-1296).
 *
 * 이 감시를 쓰는 통합 파일(DraftPage·ItineraryPlanPage·SlotFillPage)이 파일마다 같은 자가검사 it(K0)을 복사해 두던 것을
 * 한 번으로 줄였다(TRIP-1351). 감시 파일을 쓰는 테스트는 "경고 0"을 단언하므로, 이 감시가 고장나 아무것도 못 잡으면
 * 모든 "0" 이 공허해진다 — 그 고장을 여기서 한 번 잡는다.
 */
const keyWarnings = guardKeyWarnings();

it('K0 · 탐지기 자가검사 — 겹친 key 와 빠진 key 를 둘 다 잡는다', () => {
  function NoKeyList() {
    // eslint-disable-next-line react/jsx-key -- 일부러 key 를 뺀다(누락 경고 자가검사)
    return [<View />, <View />];
  }

  render(<View>{[<View key="dup" />, <View key="dup" />]}</View>);
  render(<NoKeyList />);

  expect(keyWarnings.keys()).toEqual(['dup']);
  expect(keyWarnings.missing()).toBe(1);
  keyWarnings.clear(); // 일부러 낸 경고 — 파일 감시가 이 테스트를 실패시키지 않게 비운다.
});
