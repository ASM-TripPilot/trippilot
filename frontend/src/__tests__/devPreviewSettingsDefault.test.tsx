import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';

/**
 * TRIP-778 AC-13 · TRIP-1051 — l05 설정 프리뷰가 라이브 Figma 4664:3279 의 내용을 그린다.
 *
 * 무엇을 보장하나:
 *  - `settings-default` 가 서버 enum 값 픽스처(D5 — 예산만 미설정)로 취향 한 행 `6/7 설정됨`(Figma 와 같은
 *    숫자)·위치 `동의` 칩·개인화 `사용 중`·제휴 토글 ON 을 그린다. 옛 7행 testID·`미설정` 칩은 없다.
 *    새 프리뷰 키는 만들지 않는다(TRIP-1051 추가 결정 — 같은 컴포넌트가 7행·1행을 동시에 그릴 수 없다).
 *  - 설정 배경을 쓰는 다른 키(내보내기 잘림·실패·삭제 유예·삭제 다이얼로그)도 같은 픽스처를 그린다 —
 *    props 사본이 5벌이라(01 맹점 ⑧) 하나만 고치면 여기서 red(02a ★16). `settings-delete-dialog` 배경의
 *    testID 순서열 동일성은 `devPreviewDeleteDialog.test.tsx` B3 가 따로 잠근다.
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다(traps-shell — 지뢰 목).
 *
 * ⚠️ 픽셀(칩 r8·배경 canvas·행 높이)은 [검증] 스크린샷 대조 몫 — 여기선 내용·testID 까지만.
 *
 * (개념) `it.each(표)` — 같은 단언을 키마다 한 번씩 돌린다.
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
    'l05 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

/** TRIP-778 시절 취향 7행 key — TRIP-1051 로 사라졌다. */
const OLD_PREFERENCE_ROW_KEYS = [
  'style',
  'budget',
  'companions',
  'activities',
  'transport',
  'food',
  'pace',
];

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('🔴 TRIP-778 AC-13 · settings-default 프리뷰 = 라이브 l05 내용', () => {
  it('TRIP-1051: 취향 한 행 "6/7 설정됨"을 그리고, 옛 7행·예산 "미설정" 칩은 없다', () => {
    mockSearchParams.state = 'settings-default';

    render(<DevPreview />);

    // 긍정 앵커 + 값(완전일치 · 행 안).
    expect(
      within(screen.getByTestId('settings-nav-preferences')).getByText(
        '6/7 설정됨'
      )
    ).toBeOnTheScreen();
    for (const key of OLD_PREFERENCE_ROW_KEYS) {
      expect(screen.queryByTestId(`settings-nav-${key}`)).toBeNull();
    }
    expect(screen.queryByTestId('settings-chip-budget')).toBeNull();
  });

  it('위치 "동의" 칩 · 개인화 "사용 중" · 제휴 토글 ON 을 그린다', () => {
    mockSearchParams.state = 'settings-default';

    render(<DevPreview />);

    expect(
      within(screen.getByTestId('settings-chip-location-consent')).getByText(
        '동의'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('settings-nav-personalization')).getByText(
        '사용 중'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('settings-affiliate-toggle')).toBeChecked();
  });
});

describe('🔴 TRIP-778 AC-13 · 설정 배경을 쓰는 다른 키도 같은 픽스처다', () => {
  it.each([
    ['settings-export-truncated'],
    ['settings-export-error'],
    ['settings-pending'],
    ['settings-delete-dialog'],
  ])('%s 도 취향 요약(6/7)·동의 칩·제휴 토글 ON 을 그린다', (stateKey) => {
    mockSearchParams.state = stateKey;

    render(<DevPreview />);

    expect(
      within(screen.getByTestId('settings-nav-preferences')).getByText(
        '6/7 설정됨'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('settings-chip-location-consent')).getByText(
        '동의'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('settings-affiliate-toggle')).toBeChecked();
  });
});
