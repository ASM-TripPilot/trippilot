import { AccessibilityInfo } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';

import { resetReduceMotionForTests } from '@/shared/lib/reduceMotion';
import {
  answerReduceMotionSynchronously,
  useAnimatedProbe,
} from '@/test-support/animatedProbe';

import {
  CATEGORY_PALETTES,
  MAGAZINE_TONES,
} from '@/features/reflection/index.view';

import type { StorySlide } from '../model/shareStory';
import { SLIDE_MS } from '../model/storyDeck';
import { StoryDeck, type StoryDeckProps } from './StoryDeck';
import { slideTone } from './StorySlides';

/**
 * TRIP-1667 · j06 스토리 덱(`StoryDeck` = 시간 훅 ↔ 순수 뷰 연결) — "손가락 → 훅" 배선과 시간이 얽힌 것만 잰다.
 *
 * 왜 이 파일이 따로 있나: 페이지 통합 테스트(`ShareCardPage.integration`)는 MSW 응답 때문에 가짜 타이머를 못 쓴다 — 자동 넘김·누름 멈춤을
 * 화면 단위로 재려면 서버 없이 덱만 그려야 한다. 페이지 단위 테스트(`ShareCardPage.test`)는 이 컴포넌트를 목으로 막으므로 한 화면의 두 번째
 * 단위가 아니다. 시간 규칙의 정밀한 값은 `storyDeck.test`(리듀서)·`useStoryDeck.test`(훅)가 이미 재므로 여기선 "연결됐는가"만 본다.
 *
 * 3동작: 준비(장 3개·동작 줄이기 답) → 실행(시간을 흘리거나 탭·길게 누름) → 단언(지금 보이는 장의 testID).
 *
 * 무엇을 보장하나:
 *  - AC-3 시간이 지나면 화면의 장이 바뀐다 · 마지막 장에선 멈추고 [공유 카드 만들기]가 보인다.
 *  - AC-4 오른쪽/왼쪽 영역 탭 → 다음/이전 장(접근성 클릭 = `onPress` 만 오는 경로) · 연타해도 두 번 다 먹는다.
 *  - AC-5 **실제 `Pressable` 의 긴 누름은 탭으로 읽히지 않는다**(`userEvent.longPress` — 02a §5 스파이크로 판별력 확인) · 누르는 동안 자동 넘김이 멈춘다.
 *    ⚠️ "손가락 → 멈춤" 연결(탭 영역의 `onPressIn`/`onPressOut`)은 **SD-9 만** 진짜 경로로 잰다. SD-5 의 `fireEvent` 는 호스트에 prop 이 없으면
 *    조상(`StoryDeckView` 가 받는 같은 이름 prop)을 대신 불러 통과하므로 연결을 지워도 green 이다(5-b B-1 실측).
 *  - AC-6 동작 줄이기 true/null 이면 자동 넘김이 없고, 탭은 된다.
 *  - AC-9 표지 문장이 표지에 머무는 중 도착해도 채워지고 3.4초 시계를 건드리지 않는다.
 *  - 접근성: 탭 영역은 `이전 장`/`다음 장` 버튼이다.
 *
 * ⚠️ 애니메이션 재생(진행 바 칸 채우기·장 등장 연출)·딤·제스처 손맛은 jest 가 못 본다 — 실화면 몫(`docs/feature-map/share-card.md`).
 */

const COVER_VM = {
  title: '부산 여행',
  stickerLabel: '여행 회고',
  region: '부산',
  dateLabel: '2026.06.10~06.12',
  visitLabel: '12곳',
  photoLabel: '사진 24장',
  picture: null,
  palette: 'STATS',
} as const;

const SLIDES: StorySlide[] = [
  { kind: 'cover', key: 'cover', cover: COVER_VM },
  {
    kind: 'day',
    key: 'day-1',
    day: {
      key: '2026-06-11',
      dayLabel: '1일차',
      visitCountLabel: '2곳',
      places: ['광안리 해변', '감천문화마을'],
      distance: null,
      palette: 'STATS',
    },
  },
  {
    kind: 'stats',
    key: 'stats',
    cells: { totalVisits: 12, distanceText: '—', totalPhotos: 24 },
    distanceNote: null,
  },
];

function renderDeck(over: Partial<StoryDeckProps> = {}) {
  const props: StoryDeckProps = {
    slides: SLIDES,
    caption: '',
    hashtagText: '#부산여행',
    onClose: jest.fn(),
    onMake: jest.fn(),
    ...over,
  };
  const view = render(<StoryDeck {...props} />);
  return {
    ...view,
    props,
    again: (next: Partial<StoryDeckProps>) =>
      view.rerender(<StoryDeck {...props} {...next} />),
  };
}

const slide = (key: string) =>
  screen.queryByTestId(`reflection-share-deck-slide-${key}`);
const zone = (side: 'prev' | 'next') =>
  screen.getByTestId(`reflection-share-deck-${side}`);
const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });
/** 지금 보이는 장의 키(없으면 null). */
const current = () =>
  ['cover', 'day-1', 'stats'].find((key) => slide(key) !== null) ?? null;

describe('StoryDeck — 시간·손가락 배선', () => {
  useAnimatedProbe(); // 가짜 타이머 + JS 드라이버 강제 + 동작 줄이기 답 복원
  beforeEach(() => answerReduceMotionSynchronously(false));

  it('SD-1 · 자동 넘김(AC-3): 3.4초 뒤 다음 장으로 바뀌고, 마지막 장에선 멈춰서 [공유 카드 만들기]가 보인다', () => {
    renderDeck();
    expect(current()).toBe('cover');
    expect(screen.queryByTestId('reflection-share-deck-make')).toBeNull(); // 마지막 장 전엔 버튼 없음(짝)

    advance(SLIDE_MS - 1);
    expect(current()).toBe('cover');
    advance(1);
    expect(current()).toBe('day-1');
    advance(SLIDE_MS);
    expect(current()).toBe('stats');
    advance(60_000);

    expect(current()).toBe('stats');
    expect(screen.getByTestId('reflection-share-deck-make')).toBeOnTheScreen();
  });

  it('SD-2 · 탭 영역(AC-4): 다음/이전 장으로 가고 첫 장의 이전은 무동작, 연타도 두 번 다 먹는다(연타 가드를 걸지 않는다)', () => {
    renderDeck();

    fireEvent.press(zone('prev')); // 첫 장의 왼쪽
    expect(current()).toBe('cover');
    fireEvent.press(zone('next'));
    fireEvent.press(zone('next')); // 같은 틱 연타
    expect(current()).toBe('stats');
    fireEvent.press(zone('prev'));
    expect(current()).toBe('day-1');
  });

  it('SD-3 · 접근성(AC-4): 탭 영역은 "다음 장"·"이전 장" 버튼이다 — 화면 낭독기의 클릭은 onPress 만 온다', () => {
    renderDeck();

    expect(screen.getByRole('button', { name: '다음 장' })).toBe(zone('next'));
    expect(screen.getByRole('button', { name: '이전 장' })).toBe(zone('prev'));
  });

  it('SD-4 · 길게 누름(AC-5): 실제 긴 누름은 탭으로 읽히지 않고(장 그대로), 짧은 누름은 탭이다(짝)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderDeck();

    await user.longPress(zone('next'), { duration: 600 });
    expect(current()).toBe('cover'); // 긴 누름 끝의 뗌이 "다음 장" 탭이 되면 안 된다

    await user.press(zone('next'));
    expect(current()).toBe('day-1'); // 판별력 앵커: 같은 영역의 짧은 누름은 이동한다
  });

  it('SD-5 · 누르는 동안 자동 넘김이 멈추고, 떼면 남은 시간부터 이어진다(AC-5) — 훅 ↔ 뷰 prop 배선만(손가락 → 탭 영역 연결은 SD-9)', () => {
    // ⚠️ fireEvent(요소,'pressIn') 은 그 요소에 onPressIn 이 없으면 조상 컴포넌트의 같은 이름 prop 을 찾아 부른다 —
    // 탭 영역 Pressable 에서 연결이 빠져도 StoryDeckView 의 onPressIn prop 이 대신 불려 통과한다. 진짜 눌림은 SD-9.
    renderDeck();
    advance(1000);

    fireEvent(zone('next'), 'pressIn');
    advance(60_000);
    expect(current()).toBe('cover');
    fireEvent(zone('next'), 'pressOut');
    advance(SLIDE_MS - 1000 - 1);
    expect(current()).toBe('cover');
    advance(1);

    expect(current()).toBe('day-1');
  });

  it('SD-6 · 동작 줄이기 true(AC-6): 자동 넘김이 없고 탭은 된다 · 답이 오기 전(null)에도 시작하지 않는다', () => {
    answerReduceMotionSynchronously(true);
    const reduced = renderDeck();
    advance(60_000);
    expect(current()).toBe('cover');
    fireEvent.press(zone('next'));
    expect(current()).toBe('day-1');
    reduced.unmount();

    // null: 답이 영영 안 오는 OS — 앞 마운트가 캐시에 남긴 답(true)을 비워야 "답 전" 상태가 된다(TRIP-1735 모듈 캐시)
    resetReduceMotionForTests();
    jest
      .mocked(AccessibilityInfo.isReduceMotionEnabled)
      .mockImplementation(() => new Promise<boolean>(() => {}));
    renderDeck();
    advance(60_000);
    expect(current()).toBe('cover');
  });

  it('SD-7 · 표지 문장(AC-9): 자리는 늘 있고, 문장이 표지에 머무는 중 도착하면 채워지되 3.4초 시계는 리셋되지 않는다', () => {
    const { again } = renderDeck({ caption: '' });
    expect(
      screen.getByTestId('reflection-share-deck-cover-caption-slot')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('reflection-share-deck-cover-caption')
    ).toBeNull();

    advance(2000);
    again({ caption: '광안리에서 노을을 봤어요' });
    expect(
      screen.getByTestId('reflection-share-deck-cover-caption')
    ).toHaveTextContent('광안리에서 노을을 봤어요');
    expect(
      screen.getByTestId('reflection-share-deck-cover-caption-slot')
    ).toBeOnTheScreen();

    advance(SLIDE_MS - 2000 - 1);
    expect(current()).toBe('cover');
    advance(1);
    expect(current()).toBe('day-1'); // 문장이 와도 처음부터 다시 세지 않았다
  });

  it('SD-8 · 닫기·만들기: × 는 onClose, 마지막 장의 [공유 카드 만들기]는 onMake 를 각각 1회 부른다', () => {
    const { props } = renderDeck({ startAt: 'last' });

    expect(current()).toBe('stats'); // startAt 'last' = 내보내기에서 돌아온 덱은 마지막 장에서 시작
    fireEvent.press(screen.getByTestId('reflection-share-deck-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onMake).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('reflection-share-deck-make'));
    expect(props.onMake).toHaveBeenCalledTimes(1);
  });

  it('SD-9 · 진짜 눌림(AC-5): 손가락을 대고 있는 동안 3.4초가 지나도 표지에 머물고, 뗀 뒤엔 "남은 시간"부터 이어서 넘어간다', async () => {
    // 준비: 자동 재생 켠 덱을 1초 돌려 남은 시간을 2400ms 로 만든다. 눌림은 가짜 이벤트가 아니라 실제 Pressable 이 보내게 한다.
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderDeck();
    advance(1000);

    // 실행: 4초(> 3.4초) 동안 꾹 누른다 — userEvent 가 대는 동안 가짜 시계를 4초 흘리고 마지막에 뗀다.
    await user.longPress(zone('next'), { duration: 4000 });

    // 단언: 누르는 동안의 4초가 시간으로 안 셌다(onPressIn 연결) · 뗀 뒤 남은 2400ms 에서 정확히 이어진다(onPressOut 연결)
    expect(current()).toBe('cover');
    advance(SLIDE_MS - 1000 - 1);
    expect(current()).toBe('cover');
    advance(1);
    expect(current()).toBe('day-1');
  });

  it('SD-10 · 새 장(AC-7): 일차 → 일차로 넘기면 장이 새로 마운트되어 등장 연출이 처음부터 다시 재생될 조건이 선다(같은 장에 머물면 그대로)', () => {
    // 준비: 같은 종류(일차) 장이 연달아 있는 덱. 연출은 장이 "새로 마운트될 때" 재생되므로, 마운트가 바뀌었는지를 화면 속 노드가
    // 같은 객체인지로 잰다(테스트 렌더러는 같은 화면 노드에 늘 같은 래퍼를 돌려준다 · 렌더 결과의 글자는 두 일차에서 다르지만 `key` 가 없어도 React 가 같은 노드를 재사용해 글자만 바꾼다).
    const twoDays: StorySlide[] = [
      SLIDES[0],
      SLIDES[1],
      {
        kind: 'day',
        key: 'day-2',
        day: {
          key: '2026-06-12',
          dayLabel: '2일차',
          visitCountLabel: '1곳',
          places: ['해운대'],
          distance: null,
          palette: 'STATS',
        },
      },
    ];
    const { again } = renderDeck({ slides: twoDays });
    const dayLabel = () =>
      screen.getByTestId('reflection-share-deck-day-label');
    fireEvent.press(zone('next'));
    const dayOne = dayLabel();

    // 실행 1: 같은 장에서 다른 값(표지 문장)만 바뀐다.
    again({ slides: twoDays, caption: '문장' });
    // 단언 1(앵커): 같은 장이면 노드가 그대로다 — 아래 비교가 "무조건 다름"이 아니라는 증거.
    expect(dayLabel() === dayOne).toBe(true); // (객체 자체를 toBe 로 비교하면 실패 메시지가 화면 내부를 통째로 찍는다)

    // 실행 2: 2일차로 넘긴다.
    fireEvent.press(zone('next'));

    // 단언 2: 1일차의 노드가 아니다(새로 마운트됨)
    expect(slide('day-1')).toBeNull(); // 장이 실제로 바뀌었음을 먼저 확인
    expect(slide('day-2')).toBeOnTheScreen();
    expect(dayLabel() === dayOne).toBe(false);
  });
});

// TRIP-1781 · 덱 표지 사진 — 표지 장에 기기 사진과 스크림이 서고(사진이 없으면 둘 다 없다), 덱 크롬(진행 바·×)과 표지 글자가 같은 색 함수(`slideTone`)를 쓴다.
// 사진 위 글자색·스크림 농도·진행 바 대비는 jest 가 못 본다 — 분기(어느 색 묶음을 고르나)만 상수와 비교한다. 실화면 몫은 기능 지도로.
describe('TRIP-1781 · 덱 표지 사진', () => {
  beforeEach(() => answerReduceMotionSynchronously(true));

  const photoCover = (picture: { uri: string; poiId: string } | null) =>
    ({
      kind: 'cover',
      key: 'cover',
      cover: { ...COVER_VM, picture, palette: '맛집' },
    }) as StorySlide;

  it('SD-P1 · 표지에 사진이 있으면 사진(그 주소)·스크림 노드가 서고 제목·캡션 자리는 그대로다', () => {
    renderDeck({
      slides: [
        photoCover({ uri: 'file://a', poiId: 'p1' }),
        ...SLIDES.slice(1),
      ],
    });

    expect(
      screen.getByTestId('reflection-share-deck-cover-photo').props.source
    ).toEqual([{ uri: 'file://a' }]);
    expect(
      screen.getByTestId('reflection-share-deck-cover-scrim')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-deck-cover-title')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-deck-cover-caption-slot')
    ).toBeOnTheScreen();
  });

  it('SD-P2 · 사진이 없으면 표지 장은 서고 사진·스크림 노드는 없다(짝)', () => {
    renderDeck({ slides: [photoCover(null), ...SLIDES.slice(1)] });

    expect(slide('cover')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('reflection-share-deck-cover-photo')
    ).toBeNull();
    expect(
      screen.queryByTestId('reflection-share-deck-cover-scrim')
    ).toBeNull();
  });

  it('SD-P3 · slideTone: 사진 표지만 글자색이 사진 위 색(onPhoto)이고 바탕은 팔레트 그대로, 그 밖의 장은 각자 팔레트', () => {
    const withPhoto = photoCover({ uri: 'file://a', poiId: 'p1' });
    const noPhoto = photoCover(null);
    const day = SLIDES[1];
    const stats = SLIDES[2];

    expect(slideTone(withPhoto).fg).toBe(MAGAZINE_TONES.onPhoto);
    expect(slideTone(withPhoto).bg).toBe(CATEGORY_PALETTES['맛집'].bg);
    expect(slideTone(noPhoto)).toEqual(CATEGORY_PALETTES['맛집']);
    expect(slideTone(day)).toEqual(CATEGORY_PALETTES.STATS);
    expect(slideTone(stats)).toEqual(CATEGORY_PALETTES.STATS);
  });
});
