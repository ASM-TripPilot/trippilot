import { screen } from '@testing-library/react-native';

/**
 * TRIP-1740 AC-7 공용 단언 — 응답의 `imageLicense: 'TYPE1'` 이 출구의 사진 칸까지 도착했는가.
 *
 * 왜 TYPE1 인가: 값이 중간에서 끊겨 null 이 되어도 TYPE3 입력은 null 과 똑같이 `contain` 이라 끊김을 못 잡는다
 * (01c 이식 1). 끊김이 드러나는 유일한 입력이 TYPE1 이다 — 도착했으면 `cover`, 끊겼으면 `contain`.
 *
 * 세 단언을 한 묶음으로 쓴다(어느 쪽이 언제 red 인지는 02a §4):
 *  - 사진 노드가 서버 사진이다(번들 표지도 `cover` 라 이 앵커 없이는 "도착"과 구별되지 않는다).
 *  - `contentFit === 'cover'` — 끊기면 contain 이 되어 red.
 *  - 출처 글자 노드(`${testID}-credit`)가 있다 — 출구가 아직 `PoiPhoto` 를 안 쓰면 red.
 */
export function expectTypeOnePhotoDelivered(testID: string, uri: string): void {
  const photo = screen.getByTestId(testID);
  expect(photo.props.source).toEqual([{ uri }]);
  expect(photo.props.contentFit).toBe('cover');
  expect(screen.getByTestId(`${testID}-credit`)).toBeOnTheScreen();
}
