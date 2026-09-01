import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
} from './DailyReflectionScreen';

/**
 * TRIP-574 · AC-4·AC-6(진입점) — j03 오늘의 회고 헤더 공유 아이콘(additive).
 *
 * 이 파일은 TRIP-571 `DailyReflectionScreen.test.tsx`(동결)를 **건드리지 않는** 별 파일이다.
 * 공유 아이콘(`reflection-daily-share`)은 `onShare != null` 일 때만 렌더 → 기존 테스트(onShare 미주입)
 * 는 아이콘 부재로 무회귀.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-4(BR-U5-48): `canShare:false`(종료·요약 전) → 아이콘 비활성 + accessibilityState.disabled +
 *    press 시 콜백 0회(진입점 잠금 — `fireEvent.press` 는 disabled 를 물리적으로 안 막으므로 콜백 0회가
 *    실질 그물, 571 저장버튼·TripSummaryScreen 공유버튼 동형).
 *  - 🔴 AC-6(화면측): `canShare:true` → 활성 + press → onShare 1회(라우팅은 페이지 테스트가 잠금).
 *  - ★ additive 부재짝: onShare 미주입 → 아이콘 부재(기존 동결 테스트 무회귀 증거, 선제 green).
 *
 * (개념) `toBeDisabled()` = 실제 disabled 판독 · `accessibilityState.disabled` 프롭 직접 판독 ·
 *   `queryByTestId` = 부재 확인(getBy 는 못 찾으면 throw).
 *
 * INV-3: 이 파일 픽스처에 "N분"·"N시간"·"소요" 문자열을 두지 않는다.
 */

type ShareProps = DailyReflectionScreenProps & {
  canShare?: boolean;
  onShare?: () => void;
};

const NARRATIVE = '오늘은 광안리와 미술관을 둘러본 하루였어요.';

function baseProps(over: Partial<ShareProps> = {}): ShareProps {
  return {
    face: 'default',
    narrative: NARRATIVE,
    editableText: NARRATIVE,
    stats: {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    },
    distanceDash: false,
    mapNotice: null,
    hidePhotoGrid: false,
    photos: [{ uri: 'file://p1.jpg' }],
    changeSummary: null,
    onEnterEdit: jest.fn(),
    onConfirm: jest.fn(),
    onSaveEdit: jest.fn(),
    ...over,
  };
}

function renderScreen(over: Partial<ShareProps> = {}) {
  const props = baseProps(over);
  render(<DailyReflectionScreen {...props} />);
  return props;
}

describe('🔴 AC-4 · 종료·요약 전이면 진입점 비활성(BR-U5-48)', () => {
  it('canShare:false → 공유 아이콘 비활성 + accessibilityState.disabled + press 콜백 0회', () => {
    const onShare = jest.fn();
    renderScreen({ canShare: false, onShare });

    const shareBtn = screen.getByTestId('reflection-daily-share');
    expect(shareBtn).toBeDisabled();
    expect(shareBtn.props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(shareBtn);
    expect(onShare).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-6 · 종료·요약된 여행이면 공유 진입(화면측)', () => {
  it('canShare:true → 활성 + press → onShare 1회(짝)', () => {
    const onShare = jest.fn();
    renderScreen({ canShare: true, onShare });

    const shareBtn = screen.getByTestId('reflection-daily-share');
    expect(shareBtn).not.toBeDisabled();

    fireEvent.press(shareBtn);
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});

describe('★ additive 부재짝 — onShare 미주입 시 아이콘 부재(무회귀 증거)', () => {
  it('onShare 를 안 넘기면 공유 아이콘이 렌더되지 않는다', () => {
    renderScreen();
    expect(screen.queryByTestId('reflection-daily-share')).toBeNull();
  });
});
