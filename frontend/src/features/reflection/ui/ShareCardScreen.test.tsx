import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SHARE_FORMATS, type ShareCardVM } from '../model/shareCard';
import { ShareCardScreen, type ShareCardScreenProps } from './ShareCardScreen';

/**
 * TRIP-574 · j06 공유 카드 화면(무상태 프레젠테이션 — VM·formats 주입, 포맷·degrade 로컬상태만).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1(정상 렌더): 제목·포맷 세그(3셀)·프리뷰 프레임·캡션·저장/공유 버튼이 그려진다.
 *  - 🔴 AC-2(BR-U5-47): mode 'no-photo' → 안내 문구 표시 · 'default' → 부재(짝).
 *  - 🔴 AC-3: 포맷 셀 press → 선택 상태 전환 + 프리뷰 aspect(9:16→1:1→4:5) 전환.
 *  - 🔴 degrade 정직성(INV-4): 저장/공유 press → "준비 중" 안내만(가짜 성공·크래시 0, 서버 호출은
 *    화면이 api 미접근이라 구조적으로 0).
 *
 * (개념) `StyleSheet.flatten(node.props.style).aspectRatio` = 인라인 style 에서 종횡비 읽기(§5 실검증) ·
 *   `queryByText(정규식)` = 부분 포함·부재(getBy 는 못 찾으면 throw) · `accessibilityState.selected`
 *   = 세그 활성 셀 판독.
 *
 * INV-3: 이 파일 픽스처의 caption·place 에 "N분"·"N시간"·"소요" 문자열을 두지 않는다(거리·개수만).
 */

function baseCard(over: Partial<ShareCardVM> = {}): ShareCardVM {
  return {
    title: '부산 여행',
    periodText: '6월 10일 수요일 ~ 6월 12일 금요일',
    regionText: '부산 · 경주',
    statsCells: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
    distanceSourceLabel: '근사',
    orderedVisits: [
      { order: 1, dayLabel: 'Day1', place: '광안리 해변' },
      { order: 2, dayLabel: 'Day1', place: '감천문화마을' },
    ],
    mode: 'default',
    watermark: 'TripPilot',
    aspectRatio: 9 / 16,
    ...over,
  };
}

function baseProps(
  over: Partial<ShareCardScreenProps> = {}
): ShareCardScreenProps {
  return {
    card: baseCard(),
    formats: SHARE_FORMATS,
    caption: '광안리에서 보낸 사흘',
    hashtagText: '#부산여행 #광안리',
    onEditCaption: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

function renderScreen(over: Partial<ShareCardScreenProps> = {}) {
  const props = baseProps(over);
  render(<ShareCardScreen {...props} />);
  return props;
}

function frameAspect(): number {
  const frame = screen.getByTestId('reflection-share-preview-frame');
  return StyleSheet.flatten(frame.props.style).aspectRatio as number;
}

describe('🔴 AC-1 · 정상 렌더 — 카드·세그·버튼·캡션', () => {
  it('제목·포맷 세그(3셀)·프리뷰·저장/공유·캡션을 그린다', () => {
    const props = renderScreen();

    expect(screen.getByText(props.card.title)).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-share-format-seg')).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-format-story')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-format-square')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-format-feed')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-share-save')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-share-export')).toBeOnTheScreen();
    expect(screen.getByText(props.caption)).toBeOnTheScreen();
  });
});

describe('🔴 AC-2 · no-photo 안내(BR-U5-47)', () => {
  it('mode "no-photo" 면 안내 문구가 뜬다', () => {
    renderScreen({ card: baseCard({ mode: 'no-photo' }) });
    expect(
      screen.queryByText(/사진이 없어도 동선 지도만으로/)
    ).toBeOnTheScreen();
  });

  it('mode "default" 면 안내 문구가 없다(짝)', () => {
    renderScreen({ card: baseCard({ mode: 'default' }) });
    expect(screen.queryByText(/사진이 없어도 동선 지도만으로/)).toBeNull();
  });
});

describe('🔴 AC-3 · 포맷 세그 전환 — 선택 상태 + 프리뷰 aspect', () => {
  it('story→square→feed 로 aspect 와 선택 셀이 함께 바뀐다', () => {
    renderScreen();

    // 초기 = story(9:16).
    expect(frameAspect()).toBeCloseTo(9 / 16, 5);
    expect(
      screen.getByTestId('reflection-share-format-story').props
        .accessibilityState?.selected
    ).toBe(true);

    // square(1:1).
    fireEvent.press(screen.getByTestId('reflection-share-format-square'));
    expect(frameAspect()).toBeCloseTo(1, 5);
    expect(
      screen.getByTestId('reflection-share-format-square').props
        .accessibilityState?.selected
    ).toBe(true);
    expect(
      screen.getByTestId('reflection-share-format-story').props
        .accessibilityState?.selected
    ).toBe(false);

    // feed(4:5).
    fireEvent.press(screen.getByTestId('reflection-share-format-feed'));
    expect(frameAspect()).toBeCloseTo(4 / 5, 5);
  });
});

describe('🔴 degrade 정직성(INV-4) — 저장/공유는 가짜 성공을 내지 않는다', () => {
  it('저장 press → "준비 중" 안내가 뜨고 크래시하지 않는다', () => {
    renderScreen();
    expect(screen.queryByTestId('reflection-share-degrade')).toBeNull();

    fireEvent.press(screen.getByTestId('reflection-share-save'));

    expect(screen.getByTestId('reflection-share-degrade')).toBeOnTheScreen();
  });

  it('공유 press → "준비 중" 안내가 뜬다(짝)', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('reflection-share-export'));
    expect(screen.getByTestId('reflection-share-degrade')).toBeOnTheScreen();
  });
});
