import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * AC6 · 인터뷰5 — dev 프리뷰의 pref1·pref2 2키.
 *
 * 무엇을 보장하나: 프리뷰에 취향 1/2·2/2 상태 토글이 추가되고, 그 토글이 실물
 * PrefStep1Screen/PrefStep2Screen을 **빈 선택 상태**로(컴포넌트 직접 렌더, 가드 우회
 * 아님) 그린다. 동결 devPreview.test.tsx와 나란한 별도 파일이라 그 해시를 건드리지
 * 않는다(§2-1 근거).
 *
 * *(개념)* 지뢰(landmine) 목: `@/shared/api`를 로드하는 즉시 throw하는 목이다. 소스를
 * 정규식으로 훑는 방식과 달리 **전이 의존까지** 잡는다 — 프리뷰가 그리는 화면이 어딘가
 * 에서 네트워크 계층을 끌고 오면 이 스위트가 바로 터진다(동결 devPreview.test.tsx와
 * 같은 장치, §7-17).
 *
 * 3동작: 준비(지뢰 목 + preview require) → 실행(토글 press) → 단언(실물 화면 루트 표시).
 */

// @gorhom/bottom-sheet은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다.
// 목 본체는 __mocks__/@gorhom/bottom-sheet.tsx(수동 목) — 동결 devPreview.test와 같은 장치.
jest.mock('@gorhom/bottom-sheet');

jest.mock('@/shared/api', () => {
  throw new Error('프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다');
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

describe('dev 프리뷰 — 취향 pref1·pref2 (AC6 · 8-1)', () => {
  it('pref1·pref2 토글이 각각 실물 화면 루트를 그린다', () => {
    // 실행 — 프리뷰 렌더.
    render(<DevPreview />);

    // 실행 — pref1 상태 토글.
    fireEvent.press(screen.getByTestId('dev-preview-state-pref1'));
    // 단언 — 실물 PrefStep1Screen 루트가 보인다.
    expect(screen.getByTestId('onboarding-pref1-root')).toBeOnTheScreen();

    // 실행 — pref2 상태 토글.
    fireEvent.press(screen.getByTestId('dev-preview-state-pref2'));
    // 단언 — 실물 PrefStep2Screen 루트가 보인다.
    expect(screen.getByTestId('onboarding-pref2-root')).toBeOnTheScreen();
  });
});

describe('dev 프리뷰 — 취향 pref1은 빈 선택 상태로 그린다 (AC6 · 인터뷰5 · 8-2)', () => {
  it('대표 카드가 selected 아니고, 루트는 정상 렌더된다', () => {
    // 실행 — 프리뷰 렌더 + pref1 토글.
    render(<DevPreview />);
    fireEvent.press(screen.getByTestId('dev-preview-state-pref1'));

    // 단언(긍정) — 루트가 그려진다(부재 단언과 짝 — 가짜 통과 방지).
    expect(screen.getByTestId('onboarding-pref1-root')).toBeOnTheScreen();
    // 단언(부정) — 대표 카드('rest')는 selected가 아니다(빈 선택 상태 픽스처 — 인터뷰5).
    expect(
      screen.getByTestId('onboarding-pref1-style-rest')
    ).not.toBeSelected();
  });
});
