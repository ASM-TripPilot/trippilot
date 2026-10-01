import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-773 · AC-8 — l01 알림함 프리뷰 두 키가 '모두 읽음' 유/무를 Figma 두 얼굴대로 그린다.
 *
 * 무엇을 보장하나:
 *  - `notification-inbox-default`(Figma 1598:2389): 픽스처에 미읽음 2행이 있으므로 앱바에 '모두 읽음'이 보인다.
 *  - `notification-inbox-empty`(Figma 1599:2388): empty 얼굴이고 '모두 읽음'이 없다.
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다 — 화면이 순수 뷰로 남아야 한다(traps-shell).
 *
 * 3동작: 준비(딥링크 state=키) → 실행(DevPreview 렌더) → 단언(버튼 유/무).
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목 — 다른 devPreview 테스트와 같은 장치(프리뷰 모듈 전체를 로드하므로 필요).
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 이 모듈을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '알림함 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('TRIP-773 · l01 알림함 프리뷰 두 키 (AC-8)', () => {
  it('notification-inbox-default 는 행을 그리고 앱바에 "모두 읽음"을 보인다', () => {
    mockSearchParams.state = 'notification-inbox-default';

    render(<DevPreview />);

    expect(
      screen.getAllByTestId('notification-inbox-row').length
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('notification-inbox-mark-all')).toBeOnTheScreen();
  });

  it('notification-inbox-empty 는 empty 를 그리고 "모두 읽음"이 없다', () => {
    mockSearchParams.state = 'notification-inbox-empty';

    render(<DevPreview />);

    expect(screen.getByTestId('notification-inbox-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('notification-inbox-mark-all')).toBeNull();
  });
});
