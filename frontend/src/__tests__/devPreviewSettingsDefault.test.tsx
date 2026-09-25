import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';

/**
 * TRIP-778 AC-13 — l05 설정 프리뷰가 라이브 Figma 1607:2440 의 내용을 그린다.
 *
 * 무엇을 보장하나:
 *  - `settings-default` 가 서버 enum 값 픽스처(D5)로 취향 7행 값(예산 1행은 `미설정` 칩)·위치 `동의` 칩·
 *    개인화 `사용 중`·제휴 토글 ON 을 그린다 — 운영 필터(TRIP-939)를 거쳐도 새로 연 행이 보인다.
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

const DOT = '·';

/** D5 프리뷰 픽스처가 그려야 할 값 행 — [rowKey, 값]. */
const VALUE_ROWS = [
  ['style', `휴양${DOT}자연`],
  ['companions', '친구'],
  ['activities', `맛집투어${DOT}전시`],
  ['transport', '대중교통'],
  ['food', '일식'],
  ['pace', '느긋하게'],
] as const;

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('🔴 TRIP-778 AC-13 · settings-default 프리뷰 = 라이브 l05 내용', () => {
  it('취향 6행 값 + 예산 "미설정" 칩을 그린다', () => {
    mockSearchParams.state = 'settings-default';

    render(<DevPreview />);

    for (const [key, text] of VALUE_ROWS) {
      expect(
        within(screen.getByTestId(`settings-nav-${key}`)).getByText(text)
      ).toBeOnTheScreen();
    }
    expect(
      within(screen.getByTestId('settings-chip-budget')).getByText('미설정')
    ).toBeOnTheScreen();
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
  ])('%s 도 취향 값·동의 칩·제휴 토글 ON 을 그린다', (stateKey) => {
    mockSearchParams.state = stateKey;

    render(<DevPreview />);

    expect(
      within(screen.getByTestId('settings-nav-style')).getByText(
        `휴양${DOT}자연`
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
