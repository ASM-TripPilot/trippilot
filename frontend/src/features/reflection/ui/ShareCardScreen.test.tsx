import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SHARE_FORMATS, type ShareCardVM } from '../model/shareCard';
import { ShareCardScreen, type ShareCardScreenProps } from './ShareCardScreen';

// TRIP-939 — 저장·공유 버튼은 `captureShareImage().armed` 로 그릴지 정한다(개통 플래그 재사용).
// 홀더로 armed 를 갈아끼운다: 기본 false(= 오늘의 운영 빌드), 개통 짝 테스트만 true.
// 팩토리는 호이스팅되므로 `mock` 접두 홀더를 화살표 안에서 **호출 시점에** 읽는다.
const mockShareArmed = { value: false };
jest.mock('../model/shareCard', () => ({
  ...jest.requireActual('../model/shareCard'),
  captureShareImage: () => ({ armed: mockShareArmed.value }),
}));

beforeEach(() => {
  mockShareArmed.value = false;
});

/**
 * TRIP-574 · j06 공유 카드 화면(무상태 프레젠테이션 — VM·formats 주입, 포맷·degrade 로컬상태만).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1(정상 렌더): 제목·포맷 세그(3셀)·프리뷰 프레임·캡션·저장/공유 버튼이 그려진다.
 *  - 🔴 AC-2(BR-U5-47): mode 'no-photo' → 안내 문구 표시 · 'default' → 부재(짝).
 *  - 🔴 AC-3: 포맷 셀 press → 선택 상태 전환 + 프리뷰 aspect(9:16→1:1→4:5) 전환.
 *  - TRIP-939(심사 2.1): 캡처 미장전(armed:false)이면 저장/공유 버튼과 "준비 중" 안내를 **아예 그리지
 *    않는다** — 가짜 성공도, 누르면 뜨는 안내도 없다(어포던스 제거). armed:true 면 버튼이 되살아난다.
 *    [편집]은 onEditCaption 이 주입될 때만 그린다(미주입 Pressable = 눌러도 반응 없는 버튼).
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
    expect(screen.getByText(props.caption)).toBeOnTheScreen();
    // TRIP-939 — 캡처 미장전(기본)이라 저장/공유 버튼은 그리지 않는다.
    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
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

describe('🔴 AC-3 · 카드 통계 라인이 얼굴별 포맷으로 렌더된다(통일 금지)', () => {
  it('default(포맷 A) — "N곳 · Nkm · 사진 N장"', () => {
    renderScreen({
      card: baseCard({
        mode: 'default',
        statsCells: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
      }),
    });
    // 현 프리뷰는 상시 포맷 B(방문 …) → default 기대 A 와 불일치 → red.
    expect(screen.getByText('12곳 · 38km · 사진 24장')).toBeOnTheScreen();
  });

  it('no-photo(포맷 B) — "방문 N · 이동 Nkm · 사진 N"', () => {
    renderScreen({
      card: baseCard({
        mode: 'no-photo',
        statsCells: { totalVisits: 12, distanceText: '38km', totalPhotos: 0 },
      }),
    });
    expect(screen.getByText('방문 12 · 이동 38km · 사진 0')).toBeOnTheScreen();
  });
});

describe('🔴 AC-5 · no-photo 안내 = 박스 없는 플레인 텍스트(좌정렬)', () => {
  it('안내 컨테이너에 박스 크롬(테두리·배경·라운드)이 없고, 문구·좌정렬은 유지된다', () => {
    renderScreen({ card: baseCard({ mode: 'no-photo' }) });

    // 부정 — 박스 크롬 클래스 제거(현 컨테이너는 border·bg-surface-soft·rounded-card → red).
    const notice = screen.getByTestId('reflection-share-no-photo-notice');
    const noticeCls = String(notice.props.className);
    expect(noticeCls).not.toMatch(/\bborder\b/);
    expect(noticeCls).not.toContain('bg-surface-soft');
    expect(noticeCls).not.toContain('rounded-card');

    // 부정 — 내부 문구는 좌정렬(현 text-center 제거 → red).
    const text = screen.getByText(/사진이 없어도 동선 지도만으로/);
    expect(String(text.props.className)).not.toContain('text-center');

    // 긍정 짝 — 문구·testID 는 그대로(현 AC-2 유지 · 공허 통과 차단).
    expect(text).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-939 AC-2 · 캡처 미장전이면 저장/공유 어포던스가 없다 (INV-4 → 어포던스 제거)', () => {
  it('armed:false → 저장·공유 버튼도, "준비 중" 안내도 없다(누를 것도 안내도 없음)', () => {
    // 준비·실행: 기본(armed:false = 오늘의 운영 빌드)으로 그린다.
    renderScreen();

    // 단언: 버튼 2개·degrade 문구가 모두 부재.
    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
    expect(screen.queryByTestId('reflection-share-degrade')).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
    // 짝 앵커: 카드 프리뷰는 그대로 그려졌다(화면이 통째로 빈 것이 아니다).
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
  });

  it('armed:true(개통) → 버튼 2개가 되살아나고, 눌러도 "준비 중" 안내는 없다(짝)', () => {
    // 준비: 네이티브 캡처가 장전됐다고 가정한다.
    mockShareArmed.value = true;
    renderScreen();

    // 실행: 저장을 누른다.
    fireEvent.press(screen.getByTestId('reflection-share-save'));

    // 단언: 두 버튼이 있고, 가짜 안내는 뜨지 않는다.
    expect(screen.getByTestId('reflection-share-export')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-share-degrade')).toBeNull();
  });
});

describe('🔴 TRIP-939 A-1 · 캡션 [편집]은 onEditCaption 이 있을 때만', () => {
  it('onEditCaption 미주입 → [편집] 없음(캡션은 그대로)', () => {
    // 준비·실행: 편집 진입을 주입하지 않는다(ShareCardPage 의 현재 모양).
    const props = renderScreen({ onEditCaption: undefined });

    // 단언: [편집] 부재 + 캡션·해시태그는 남는다.
    expect(screen.queryByTestId('reflection-share-caption-edit')).toBeNull();
    expect(screen.getByText(props.caption)).toBeOnTheScreen();
    expect(screen.getByText(props.hashtagText)).toBeOnTheScreen();
  });

  it('onEditCaption 주입 → [편집]이 있고 press 시 1회(짝)', () => {
    const onEditCaption = jest.fn();
    renderScreen({ onEditCaption });

    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));

    expect(onEditCaption).toHaveBeenCalledTimes(1);
  });
});
