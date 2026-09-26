import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-979 B · 맹점 ①-4 — i20·i21 프리뷰 두 키가 **네트워크 없이** 위치 입력 화면을 그린다.
 *
 * 무엇을 보장하나(초심자용): 위치 입력 화면이 컨테이너(일정 조회·재계획 요청)와 순수 뷰로 갈라진다.
 * 프리뷰가 컨테이너나 배럴(`@/pages/live-location` — 컨테이너를 함께 싣는다)을 import 하면, 모듈을
 * 읽는 순간 네트워크 계층(`@/shared/api`)이 따라 로드된다(traps-shell TRIP-610). 이 파일은 그 계층을
 * **지뢰**로 목해, 프리뷰가 그것을 물면 require 시점에 터지게 한다.
 *
 * 선제 green: 지금의 LiveLocationPage 는 조회가 없는 표면이라 green 이다. 구현이 페이지를 컨테이너로
 * 바꾸면서 프리뷰를 뷰로 옮기지 않으면 이 파일(과 devPreview 계열 전부)이 red 로 떨어진다.
 *
 * 3동작: 준비(지뢰·딥링크 state) → 실행(프리뷰 렌더) → 단언(얼굴 루트·지도 picker).
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다(devPreview 계열 동형).
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 이 모듈을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '위치 입력 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('dev 프리뷰 — i20·i21 위치 입력 키는 순수 뷰만 태운다', () => {
  it.each([
    ['live-location-manual', 'live-location-manual'],
    ['live-location-denied', 'live-location-permission-denied'],
  ])('state=%s 로 열면 %s 얼굴과 지도 picker 가 그려진다', (key, root) => {
    mockSearchParams.state = key;

    render(<DevPreview />);

    expect(screen.getByTestId(root)).toBeOnTheScreen();
    expect(screen.getByTestId('center-pin-picker')).toBeOnTheScreen();
  });
});
