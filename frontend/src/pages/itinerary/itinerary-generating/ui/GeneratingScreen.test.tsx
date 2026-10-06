import {
  fireEvent,
  render,
  screen,
  within,
  act,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import type { MapCenter, MapPin } from '@/shared/map';

import { GeneratingScreen } from './GeneratingScreen';

/**
 * h07(라이브 Figma · 구 h09) "AI가 일정 짜는 중" 화면의 **렌더 계약**(TRIP-305 → TRIP-789 정합).
 * 화면은 완성된 콜백·데이터만 받는다 — 조회도 POST 도 라우팅도 하지 않는다(배선은 `GeneratingPage` 몫).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에게는 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다. **queryAllByText(정규식)** 은 텍스트를 **부분(포함)** 으로
 * 훑어 매칭 배열을 준다(0건이면 빈 배열) — "화면에 그 문자열이 하나도 없다"를 재는 데 쓴다.
 * **queryByTestId** 는 못 찾으면 **null**(부재 단언용, `getByTestId` 는 못 찾으면 throw).
 *
 * 무엇을 보장하나 — 이 칸의 존재 이유부터(TRIP-789 Figma 정합 재작성):
 *  - 🔴 진행 표면 골격이 실재하고(AC-3) **하단(footer·2버튼)은 사라졌다**(AC-4): 앱바 · 비결정형 진행
 *    표시 · 체크리스트 3행(장소 수집·동선 계산·시간 배치)만 있고 footer·[취소]·[백그라운드로]는 없다.
 *  - 🔴 **화면에 퍼센트(`48%`)·시간추정(`10초쯤`)·소요시간(`N분`/`N시간`) 문자열이 하나도 없다**
 *    (AC-1·AC-2 · INV-3 · ⚑C). 부제는 **현행 유지**(Q3 — '10초쯤' 미추가, 동결 `초` 가드 유지).
 *    소스 가드(`itineraryTimeStructure`)는 `%`·`초`를 아예 안 봐서 이 **렌더 결과** 단언이 유일한 그물.
 *  - 🔴 실패는 삼켜지지 않는다(AC-7 · INV-4): `failed` 면 실패 표면 + [다시 시도]가 뜬다(핸들링 무변경).
 *  - 🔴 앱바 뒤로 셰브론이 **onBackground** 를 부른다(AC-4 — 취소 개념 소멸, 뒤로=백그라운드).
 *  - 🔴 지도 카드는 **pins 있을 때만** 뜬다(AC-5 · INV-2 안전): 없으면 정직하게 생략, 있으면 실 MapView.
 *
 * 3동작 뼈대: 준비 = 콜백 spy·pins 로 렌더 → 실행 = 렌더만/버튼 press → 단언 = 보이는 것·불린 콜백.
 * (SafeAreaProvider 래핑은 불필요 — `DraftScreen.test.tsx` 선례대로 직접 렌더.)
 *
 * ⚠️ 지도(실 `MapView`)는 env 키가 있어야 목 `map-native` 를 그린다(없으면 `map-failure`) — 그래서
 *   beforeEach 에서 키를 세운다(`PlaceDetailScreen.test.tsx` 선례). pins 없는 S1~S5 는 지도를 안 그려
 *   이 키와 무관.
 *
 * 한 파일로 합친 기록(TRIP-1150): 옛 `.bar`·`.pulse` 두 파일을 바깥 describe 로 붙였다. 두 파일은
 * 최상위에서 가짜 타이머·`Animated` 스파이를 켰는데, 그대로 두면 S1~S6 까지 그 아래서 돈다 — 그래서 각자의
 * describe 안 beforeEach/afterEach 로 가뒀다.
 */

/** 진행 화면에 있어선 안 되는 숫자 어휘 — 자리 앵커 `\d` 가 필수다: 체크리스트 라벨 `시간 배치` 가
 * `시간` 을 포함하므로 bare `시간` 은 정당 라벨을 red 로 만든다. `\d\s*시간` 이라야 "N시간"만 잡고
 * `시간 배치` 는 통과한다. */
const PERCENT = /\d\s*%/; // "48%" → "8%" 에 걸림
const SECONDS = /\d\s*초/; // "10초쯤" → "0초" 에 걸림
const DURATION = /\d\s*분|\d\s*시간/; // "이동 30분"·"2시간" 에 걸림, "시간 배치" 는 아님

const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;

const noop = () => {};

/** 지도 카드 픽스처 — 부산 3핀(프리뷰 `MUST_VISIT_PREVIEW_PINS` 와 같은 모양)+중심. */
const MAP_PINS: MapPin[] = [
  { number: 1, lat: 35.1379, lng: 129.0596 },
  { number: 2, lat: 35.1587, lng: 129.1604 },
  { number: 3, lat: 35.163, lng: 129.0104 },
];
const MAP_CENTER: MapCenter = { lat: 35.1532, lng: 129.1104 };

beforeEach(() => {
  ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env[CLIENT_ID_KEY];
  else process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
});

describe('🔴 S1 · AC-3·AC-4 — 진행 골격은 있고 하단(footer·2버튼)은 사라졌다', () => {
  it('앱바·진행 표시·체크리스트 3행은 있고 footer·[취소]·[백그라운드로]는 없다', () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);

    // 긍정 — 남는 골격.
    expect(screen.getByTestId('itinerary-generating-appbar')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // 체크리스트는 정확히 3행이고, 각 행의 라벨이 Figma 정본 문구다(정확 문자열 일치).
    expect(screen.queryAllByTestId(/^itinerary-generating-step-/)).toHaveLength(
      3
    );
    expect(screen.getByText('장소 수집')).toBeOnTheScreen();
    expect(screen.getByText('동선 계산')).toBeOnTheScreen();
    expect(screen.getByText('시간 배치')).toBeOnTheScreen();

    // 부정 — Figma 정합으로 제거된 하단 안내박스·2버튼이 트리에서 사라졌다(AC-4).
    expect(screen.queryByTestId('itinerary-generating-footer')).toBeNull();
    expect(screen.queryByTestId('itinerary-generating-cancel')).toBeNull();
    expect(screen.queryByTestId('itinerary-generating-background')).toBeNull();
  });
});

describe('🔴 S2 · AC-1·AC-2 — 숫자·시간 어휘를 그리지 않는다 (결과 심판)', () => {
  it('진행 화면에 퍼센트·초 추정·소요시간 문자열이 하나도 없다', () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);

    // 긍정 짝 — 진행 표면이 실제로 떴다(없으면 아래 "0건"이 빈 렌더에서 공허하게 통과한다).
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // 부정 — 계약에 없는 퍼센트(48%)·지어낸 시간추정(10초쯤)·소요시간(N분/N시간)이 0건이다.
    // ⚑C(가짜 진척 금지) + Q3(동결 `초` 가드 유지 = '10초쯤' 미추가).
    expect(screen.queryAllByText(PERCENT)).toHaveLength(0);
    expect(screen.queryAllByText(SECONDS)).toHaveLength(0);
    expect(screen.queryAllByText(DURATION)).toHaveLength(0);
  });
});

describe('🔴 S3 · AC-7 — 실패는 삼켜지지 않는다 (INV-4)', () => {
  it('failed 면 실패 표면과 [다시 시도] 버튼이 뜨고 onRetry 를 부른다', () => {
    const onRetry = jest.fn();
    render(<GeneratingScreen onBackground={noop} onRetry={onRetry} failed />);

    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-generating-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 S4 · AC-7 짝 — 기본은 실패 표면이 없다', () => {
  it('failed 미지정이면 실패 표면이 없고, 진행 표면은 그대로 뜬다', () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);

    // 부정 — 실패가 아닌데 실패 표면이 뜨면 안 된다.
    expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    // 긍정 짝 — 빈 렌더에서 위 부정이 공짜로 통과하는 것을 막는다.
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });
});

describe('🔴 S5 · AC-4 — 앱바 뒤로 셰브론이 onBackground 를 부른다 (취소 개념 소멸)', () => {
  it('앱바 뒤로 press → onBackground 만 1회 부른다', () => {
    const onBackground = jest.fn();
    render(<GeneratingScreen onBackground={onBackground} onRetry={noop} />);

    fireEvent.press(screen.getByTestId('itinerary-generating-back'));
    expect(onBackground).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 S6 · AC-5 — 지도 카드는 pins 있을 때만 뜬다 (INV-2 안전 · 정직 폴백)', () => {
  it('pins 없으면 지도 카드가 없다 (프로덕션 정직 폴백)', () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);

    // 부정 — 좌표가 없으면 지도 카드를 아예 안 그린다(빈 지도·가짜 좌표 금지).
    expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
    // 긍정 짝 — 진행 표면은 그대로 떴다(빈 렌더 공허 통과 방지).
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });

  it('pins·center 를 주면 지도 카드 안에 실 MapView(map-native)가 뜬다', () => {
    render(
      <GeneratingScreen
        onBackground={noop}
        onRetry={noop}
        pins={MAP_PINS}
        center={MAP_CENTER}
      />
    );

    // 긍정 — 지도 카드 래퍼가 뜨고, 그 안이 placeholder 가 아니라 실 MapView(목 map-native)다.
    // (viewOnly·connectPins={false}·연결선 0 을 잠그던 소스층 `itineraryMapSurfaceStructure` 는 TRIP-1145 로 지웠다.)
    const map = screen.getByTestId('itinerary-generating-map');
    expect(within(map).getByTestId('map-native')).toBeTruthy();
  });

  it('pins 만 있고 center 가 없으면 지도 카드를 안 그린다 (게이트가 center 를 요구, 5-b 경고-1)', () => {
    // 준비/실행 — center 없이 pins 만. 실 MapView 는 center 필수(`center.lat` 접근)라 이 조합으로
    // 지도를 그리면 크래시한다. 게이트가 `pins && center` 둘 다 요구함을 잠근다 — `&& center` 를
    // 지우는 뮤턴트는 이 케이스에서 지도를 그려 red 가 된다.
    render(
      <GeneratingScreen onBackground={noop} onRetry={noop} pins={MAP_PINS} />
    );

    expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });
});

// TRIP-1268 · AI 일정 생성 일일 한도(클라이언트 임시 장치) — 한도 얼굴의 렌더 계약.
describe('AI 일일 한도 얼굴', () => {
  /**
   * 무엇을 보장하나:
   *  - `aiLimit` 이 오면 한도 얼굴(`ai-limit-notice`)만 그린다 — 제목·본문(시각으로만 말함, INV-3)·
   *    [직접 짜기 이어가기]·[닫기]. **[다시 시도]는 없다**(눌러도 또 막히는 버튼은 거짓말이다).
   *  - 얼굴 우선순위는 **한도 > 409 안내(busy) > 실패 > 진행**. 이전 POST 실패가 남아 있어도 한도가 이긴다.
   *  - 두 버튼은 각자 자기 콜백만 1회 부른다.
   *
   * *(개념)* `getByText('문자열')` 은 Text 하나의 글자 전체와 **완전 일치**, `getByText(/정규식/)` 은
   * **부분 일치**다. 본문은 두 문장을 한 줄로 합쳐 그릴 수도 있어 정규식으로, 제목·버튼 글자는 완전 일치로 잰다.
   *
   * 3동작 뼈대: 준비 = 콜백 spy 로 `aiLimit` 을 넘겨 렌더 → 실행 = 렌더만/버튼 press → 단언 = 보이는 얼굴·불린 콜백.
   */
  const TITLE = '오늘 AI 일정 만들기 5번을 모두 썼어요';

  function limitProps() {
    return { onContinueManual: jest.fn(), onClose: jest.fn() };
  }

  describe('🔴 L1 · AC-7·AC-9 — 한도 얼굴의 글자와 버튼', () => {
    it('제목·본문 두 문장·두 버튼이 있고, [다시 시도]·진행 표면은 없다', () => {
      render(
        <GeneratingScreen
          onBackground={noop}
          onRetry={noop}
          aiLimit={limitProps()}
        />
      );

      const notice = screen.getByTestId('ai-limit-notice');
      expect(within(notice).getByText(TITLE)).toBeOnTheScreen();
      expect(
        within(notice).getByText(/내일 0시에 다시 쓸 수 있어요/)
      ).toBeOnTheScreen();
      expect(
        within(notice).getByText(/직접 짜기는 계속 쓸 수 있어요/)
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('ai-limit-manual-cta')).getByText(
          '직접 짜기 이어가기'
        )
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('ai-limit-close')).getByText('닫기')
      ).toBeOnTheScreen();

      // 부정 — 다시 시도·진행 표면(진행 바·단계 펄스)이 한 조각도 없다.
      expect(screen.queryByTestId('itinerary-generating-retry')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-progress')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-pulse-1')).toBeNull();
    });
  });

  describe('🔴 L2 · AC-17 — 한도 > 409 안내 > 실패 (판정 순서)', () => {
    it('한도·409·실패가 한꺼번에 와도 한도 얼굴만 그린다', () => {
      render(
        <GeneratingScreen
          onBackground={noop}
          onRetry={noop}
          failed
          busy={{
            cancelable: true,
            onCancelAndRetry: noop,
            onWait: noop,
          }}
          aiLimit={limitProps()}
        />
      );

      expect(screen.getByTestId('ai-limit-notice')).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-generation-busy')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    });
  });

  describe('🔴 L3 · AC-9 — 두 버튼은 자기 콜백만 부른다', () => {
    it('[직접 짜기 이어가기] → onContinueManual 1회, onClose 0회', () => {
      const props = limitProps();
      render(
        <GeneratingScreen onBackground={noop} onRetry={noop} aiLimit={props} />
      );

      fireEvent.press(screen.getByTestId('ai-limit-manual-cta'));

      expect(props.onContinueManual).toHaveBeenCalledTimes(1);
      expect(props.onClose).not.toHaveBeenCalled();
    });

    it('[닫기] → onClose 1회, onContinueManual 0회', () => {
      const props = limitProps();
      render(
        <GeneratingScreen onBackground={noop} onRetry={noop} aiLimit={props} />
      );

      fireEvent.press(screen.getByTestId('ai-limit-close'));

      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(props.onContinueManual).not.toHaveBeenCalled();
    });
  });
});

// TRIP-1069 · 옛 GeneratingScreen.bar.test.tsx — 가짜 타이머·Animated 스파이는 이 describe 안에서만 켠다.
describe('진행 바 반복·동작 줄이기', () => {
  /**
   * TRIP-1125 · h07 진행 바(`itinerary-generating-progress`)의 동작 줄이기 계약(AC-9·AC-10, 01b Q2=(b)).
   * 측정 기법은 아래 「단계 펄스」 describe 와 같다(JS 드라이버 강제 + 가짜 타이머).
   *
   * ⚠️ jest 는 `onLayout` 을 부르지 않아 트랙 폭이 0 → translateX 가 항상 0 이다. 폭을 주지 않고
   *   "안 움직인다"를 재면 동작 줄이기를 무시하는 코드도 공허하게 통과한다 — 그래서 layout 이벤트로
   *   폭 300 을 먼저 준다.
   */

  const NativeAnimatedHelper =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native/src/private/animated/NativeAnimatedHelper') as {
      default: { shouldUseNativeDriver: (config: unknown) => boolean };
    };

  const noop = () => {};
  const BAR = 'itinerary-generating-progress';
  const TRACK_WIDTH = 300;

  const reduceMotionMock = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
  const reduceMotionDefault = reduceMotionMock.getMockImplementation();

  const realTiming = Animated.timing;
  const realSpring = Animated.spring;
  const realDecay = Animated.decay;

  let spies: jest.SpyInstance[] = [];
  let animationConfigSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    spies = [
      jest
        .spyOn(NativeAnimatedHelper.default, 'shouldUseNativeDriver')
        .mockReturnValue(false),
    ];
    // 설정 인자는 원본(useNativeDriver: true)대로 기록하되 실제로는 JS 로 돌린다 — `Animated.loop` 은
    // shouldUseNativeDriver 가 아니라 설정의 useNativeDriver 를 보고 네이티브 루프로 넘겨서, 그대로
    // 두면 jest 에서 단일 timing 루프가 한 바퀴만 돈다(기기에선 네이티브가 반복한다).
    animationConfigSpies = [
      jest
        .spyOn(Animated, 'timing')
        .mockImplementation((value, config) =>
          realTiming(value, { ...config, useNativeDriver: false })
        ),
      jest
        .spyOn(Animated, 'spring')
        .mockImplementation((value, config) =>
          realSpring(value, { ...config, useNativeDriver: false })
        ),
      jest
        .spyOn(Animated, 'decay')
        .mockImplementation((value, config) =>
          realDecay(value, { ...config, useNativeDriver: false })
        ),
    ];
  });

  afterEach(() => {
    jest.useRealTimers();
    [...spies, ...animationConfigSpies].forEach((spy) => spy.mockRestore());
    if (reduceMotionDefault)
      reduceMotionMock.mockImplementation(reduceMotionDefault);
  });

  function giveTrackWidth(): void {
    fireEvent(screen.getByTestId(BAR), 'layout', {
      nativeEvent: { layout: { width: TRACK_WIDTH, height: 8 } },
    });
  }

  function hostNodes(node: ReactTestInstance): ReactTestInstance[] {
    const own = typeof node.type === 'string' ? [node] : [];
    const kids = node.children.filter(
      (child): child is ReactTestInstance => typeof child !== 'string'
    );
    return [...own, ...kids.flatMap(hostNodes)];
  }

  /**
   * 트랙 안 세그먼트의 폭·translateX. 트랙 바로 아래 자식은 `Animated.View` 합성 노드라 style 에
   * 보간 객체가 들어 있다 — 값이 풀린 **첫 호스트 자손**을 읽는다.
   */
  function segment(): { width: number; translateX: number } {
    const [, seg] = hostNodes(screen.getByTestId(BAR));
    if (!seg) throw new Error('진행 바 세그먼트가 없다');
    const style = StyleSheet.flatten(seg.props.style) ?? {};
    const transforms = (style.transform ?? []) as Record<string, unknown>[];
    const translate = transforms.find((entry) => 'translateX' in entry);
    return {
      width: Number(style.width ?? 0),
      translateX: Number(translate?.translateX ?? 0),
    };
  }

  function sampleSegments(totalMs: number, stepMs = 20): string[] {
    const faces = [JSON.stringify(segment())];
    for (let t = 0; t < totalMs; t += stepMs) {
      act(() => {
        jest.advanceTimersByTime(stepMs);
      });
      faces.push(JSON.stringify(segment()));
    }
    return faces;
  }

  async function renderWithTrack(): Promise<void> {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);
    await act(async () => {});
    giveTrackWidth();
  }

  describe('B-1 · AC-10 — 동작 줄이기가 꺼져 있으면 바가 지금처럼 반복해서 미끄러진다', () => {
    it('세그먼트가 보이고, 시간이 흐르면 움직이며, 한 바퀴를 넘긴 3초 이후에도 움직인다', async () => {
      await renderWithTrack();

      expect(segment().width).toBeGreaterThan(0);

      const faces = sampleSegments(4000);
      expect(new Set(faces).size).toBeGreaterThan(1);
      expect(new Set(faces.slice(3000 / 20)).size).toBeGreaterThan(1);
    });
  });

  describe('🔴 B-2 · AC-9 · Q2(b) — 동작 줄이기가 켜져 있으면 바가 보이는 채로 한 자리에 멈춘다', () => {
    it('시간이 흘러도 세그먼트가 그대로이고, 트랙 안에 완전히 보인다', async () => {
      reduceMotionMock.mockResolvedValue(true);
      await renderWithTrack();

      const faces = sampleSegments(3000);
      expect(new Set(faces).size).toBe(1);

      // 빈 회색 트랙(세그먼트가 왼쪽 밖에 숨음)이 아니다 — 폭 전체가 트랙 안에 있다.
      const { width, translateX } = segment();
      expect(width).toBeGreaterThan(0);
      expect(translateX).toBeGreaterThanOrEqual(0);
      expect(translateX + width).toBeLessThanOrEqual(TRACK_WIDTH);
    });
  });

  describe('B-3 · AC-10 — 동작 줄이기 확인이 오기 전에 떠나면 바가 움직이지 않는다', () => {
    it('확인 Promise 가 언마운트 뒤에 풀려도 어떤 애니메이션 값도 움직이지 않는다', async () => {
      const view = render(
        <GeneratingScreen onBackground={noop} onRetry={noop} />
      );
      giveTrackWidth();

      view.unmount();
      // 확인이 RN 의 언마운트 뒤 값 떼어 내기(타이머)보다 늦게 오는 경우 — 먼저 비우면 RN 이 대신 멈춰
      // 줘 뒤늦은 시작이 안 보인다.
      act(() => {
        jest.advanceTimersByTime(100);
      });
      await act(async () => {});

      const values = animationConfigSpies.flatMap((spy) =>
        spy.mock.calls.map((call) => call[0] as { __getValue: () => number })
      );
      const before = values.map((value) => value.__getValue());
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(values.map((value) => value.__getValue())).toEqual(before);
    });
  });
});

// 옛 GeneratingScreen.pulse.test.tsx — 가짜 타이머·Animated 스파이는 이 describe 안에서만 켠다.
describe('단계 펄스', () => {
  /**
   * TRIP-1046 · h07 생성 중 3단계 원의 **순차 펄스** 계약(QA #025). 가짜 타이머·JS 드라이버 강제는 이
   * describe 안에서만 켠다 — 최상위 S1~S6 이 그 아래서 돌지 않게(TRIP-1150 합치기).
   *
   * 무엇을 보장하나:
   *  - 🔴 각 단계 행에 펄스 원(`itinerary-generating-pulse-n`)이 정확히 1개, 세 원은 **같은 얼굴**(⚑C —
   *    체크·반채움·`완료`/`대기` 차등 금지).
   *  - 🔴 원이 실제로 움직이고, 시작이 1→2→3 순서로 어긋난다. 애니메이션 설정은 전부 네이티브 드라이버.
   *  - 🔴 기기 "동작 줄이기"가 켜져 있으면 움직이지 않는 완전히 보이는 원.
   *  - 실패·409 얼굴엔 펄스 원이 없다.
   *
   * ⚠️ jest 의 RN 목은 네이티브 드라이버 애니메이션을 JS 값에 반영하지 않는다(02a ★2 실측) — 그래서
   *   `shouldUseNativeDriver` 를 false 로 스파이해 JS 로 돌리고(★3), 대신 "네이티브로 설정했나"는
   *   `Animated.timing` 등의 설정 인자로 따로 잰다.
   *
   * 3동작 뼈대: 준비 = 가짜 타이머·스파이 → 실행 = 렌더 후 시간 흘리기 → 단언 = 원의 모양이 바뀌었나.
   */

  // RN 0.81 내부 경로 — 바뀌면 require 가 throw 해 조용히 green 이 되지 않는다(02a ★3).
  const NativeAnimatedHelper =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native/src/private/animated/NativeAnimatedHelper') as {
      default: { shouldUseNativeDriver: (config: unknown) => boolean };
    };

  const noop = () => {};
  const PULSE = /^itinerary-generating-pulse-/;
  const LABELS = ['장소 수집', '동선 계산', '시간 배치'] as const;

  const reduceMotionMock = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
  const reduceMotionDefault = reduceMotionMock.getMockImplementation();

  let spies: jest.SpyInstance[] = [];
  let animationConfigSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    spies = [
      jest
        .spyOn(NativeAnimatedHelper.default, 'shouldUseNativeDriver')
        .mockReturnValue(false),
    ];
    animationConfigSpies = [
      jest.spyOn(Animated, 'timing'),
      jest.spyOn(Animated, 'spring'),
      jest.spyOn(Animated, 'decay'),
    ];
  });

  afterEach(() => {
    jest.useRealTimers();
    [...spies, ...animationConfigSpies].forEach((spy) => spy.mockRestore());
    if (reduceMotionDefault)
      reduceMotionMock.mockImplementation(reduceMotionDefault);
  });

  /** 원 서브트리(자기 자신 포함)의 호스트 노드들. */
  function hostNodes(node: ReactTestInstance): ReactTestInstance[] {
    const own = typeof node.type === 'string' ? [node] : [];
    const kids = node.children.filter(
      (child): child is ReactTestInstance => typeof child !== 'string'
    );
    return [...own, ...kids.flatMap(hostNodes)];
  }

  /** 움직이는 얼굴 — 서브트리 호스트들의 opacity·transform(02a ★6). */
  function face(n: number): string {
    const dot = screen.getByTestId(`itinerary-generating-pulse-${n}`);
    return JSON.stringify(
      hostNodes(dot).map((node) => {
        const style = StyleSheet.flatten(node.props.style) ?? {};
        return { opacity: style.opacity, transform: style.transform };
      })
    );
  }

  /** 구조 서명 — 호스트 타입·className 재귀(testID·style 제외, 02a ★7). */
  function signature(node: ReactTestInstance): unknown {
    if (typeof node.type !== 'string') {
      return node.children
        .filter(
          (child): child is ReactTestInstance => typeof child !== 'string'
        )
        .map(signature);
    }
    return {
      type: node.type,
      className: node.props.className,
      children: node.children.map((child) =>
        typeof child === 'string' ? child : signature(child)
      ),
    };
  }

  /** 20ms 씩 `totalMs` 동안 세 원의 얼굴을 뜬다. [0] = 흘리기 전. */
  function sampleFaces(totalMs = 3000, stepMs = 20): string[][] {
    const perDot: string[][] = [[face(1)], [face(2)], [face(3)]];
    for (let t = 0; t < totalMs; t += stepMs) {
      act(() => {
        jest.advanceTimersByTime(stepMs);
      });
      [1, 2, 3].forEach((n, i) => perDot[i].push(face(n)));
    }
    return perDot;
  }

  /** 마운트 후 isReduceMotionEnabled 의 Promise 를 비운다(02a ★4). */
  async function renderProgress(): Promise<void> {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);
    await act(async () => {});
  }

  describe('🔴 P-1 · AC-1 — 단계 행마다 펄스 원 1개, 세 원은 같은 얼굴(⚑C)', () => {
    it('각 단계 행 안에 itinerary-generating-pulse-n 이 정확히 1개씩, 모두 3개다', async () => {
      await renderProgress();

      [1, 2, 3].forEach((n) => {
        const step = screen.getByTestId(`itinerary-generating-step-${n}`);
        const dots = within(step).getAllByTestId(PULSE);
        expect(dots).toHaveLength(1);
        expect(dots[0].props.testID).toBe(`itinerary-generating-pulse-${n}`);
      });
      expect(screen.getAllByTestId(PULSE)).toHaveLength(3);
    });

    it('세 원의 구조(타입·className)가 같고, 행 안 글자는 라벨뿐이다(완료·대기 없음)', async () => {
      await renderProgress();

      const [s1, s2, s3] = [1, 2, 3].map((n) =>
        signature(screen.getByTestId(`itinerary-generating-pulse-${n}`))
      );
      expect(s2).toEqual(s1);
      expect(s3).toEqual(s1);

      LABELS.forEach((label, i) => {
        const step = screen.getByTestId(`itinerary-generating-step-${i + 1}`);
        const texts = within(step)
          .queryAllByText(/.+/)
          .map((node) => node.props.children);
        expect(texts).toEqual([label]);
      });
      expect(screen.queryAllByText(/완료|대기/)).toHaveLength(0);
    });
  });

  describe('🔴 P-2 · AC-2 — 원이 움직이고, 1→2→3 순서로 번지며, 네이티브 드라이버다', () => {
    it('시간이 흐르면 세 원 모두 모양(opacity/transform)이 바뀐다', async () => {
      await renderProgress();

      const perDot = sampleFaces();

      perDot.forEach((faces) => expect(new Set(faces).size).toBeGreaterThan(1));
    });

    it('처음 움직이기 시작하는 순서가 1번 → 2번 → 3번이다(시작이 어긋난다)', async () => {
      await renderProgress();

      const perDot = sampleFaces();
      const firstMove = perDot.map((faces) =>
        faces.findIndex((f) => f !== faces[0])
      );

      firstMove.forEach((index) => expect(index).not.toBe(-1));
      expect(firstMove[0]).toBeLessThan(firstMove[1]);
      expect(firstMove[1]).toBeLessThan(firstMove[2]);
    });

    it('한 번 깜빡이고 멈추지 않는다 — 3~4초 구간에서도 세 원 모두 모양이 바뀐다(반복)', async () => {
      await renderProgress();

      // 한 바퀴(약 1.2초)+어긋남(0.6초)을 넘긴 뒤의 창만 본다 — loop 없이 한 번만 펄스하면 여기선 정지.
      const perDot = sampleFaces(4000);
      const lateWindow = perDot.map((faces) => faces.slice(3000 / 20));

      lateWindow.forEach((faces) =>
        expect(new Set(faces).size).toBeGreaterThan(1)
      );
    });

    it('Animated.timing/spring/decay 설정이 전부 useNativeDriver: true 다', async () => {
      await renderProgress();
      sampleFaces(1500);

      const configs = animationConfigSpies.flatMap((spy) =>
        spy.mock.calls.map((call) => call[1] as { useNativeDriver?: boolean })
      );
      // 진행 바 1개 + 펄스 1개 이상.
      expect(configs.length).toBeGreaterThan(1);
      configs.forEach((config) => expect(config.useNativeDriver).toBe(true));
    });
  });

  describe('P-2d · AC-2 — 화면이 사라지면 펄스도 멈춘다(정리)', () => {
    it('언마운트 뒤에는 시간이 흘러도 어떤 애니메이션 값도 더 바뀌지 않는다', async () => {
      const view = render(
        <GeneratingScreen onBackground={noop} onRetry={noop} />
      );
      await act(async () => {});
      // 1번 원만 출발하고 2·3번은 아직 어긋남 대기 중인 시점에 떠난다.
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // 애니메이션을 건 값들 — timing/spring/decay 의 첫 인자(진행 바 + 펄스).
      const values = animationConfigSpies.flatMap((spy) =>
        spy.mock.calls.map((call) => call[0] as { __getValue: () => number })
      );
      // 짝 — 진행 바 1개 + 펄스 값들이 실제로 잡혔다(비면 아래 "안 바뀐다"가 공허 통과).
      expect(values.length).toBeGreaterThan(1);

      view.unmount();
      const before = values.map((value) => value.__getValue());
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(values.map((value) => value.__getValue())).toEqual(before);
    });
  });

  describe('P-2e · AC-2 — 동작 줄이기 확인이 오기 전에 떠나면 펄스를 시작하지 않는다', () => {
    it('확인 Promise 가 언마운트 뒤에 풀려도 어떤 애니메이션 값도 움직이지 않는다', async () => {
      const view = render(
        <GeneratingScreen onBackground={noop} onRetry={noop} />
      );
      const values = animationConfigSpies.flatMap((spy) =>
        spy.mock.calls.map((call) => call[0] as { __getValue: () => number })
      );
      expect(values.length).toBeGreaterThan(1);

      // Promise 를 비우기 **전에** 떠난다 — 그 뒤 풀리는 확인이 시작을 부르면 안 된다.
      view.unmount();
      const before = values.map((value) => value.__getValue());
      await act(async () => {});
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(values.map((value) => value.__getValue())).toEqual(before);
    });
  });

  describe('🔴 P-4 · AC-4 — 동작 줄이기가 켜져 있으면 펄스를 멈춘 완전한 원', () => {
    it('시간이 흘러도 세 원이 그대로이고, 같은 모양이며, 흐려지거나 줄지 않았다', async () => {
      reduceMotionMock.mockResolvedValue(true);
      await renderProgress();

      // 짝 — 원이 실제로 있다(없으면 아래 "안 움직인다"가 공허하게 통과).
      expect(screen.getAllByTestId(PULSE)).toHaveLength(3);

      const perDot = sampleFaces();
      perDot.forEach((faces) => expect(new Set(faces).size).toBe(1));
      expect(perDot[1][0]).toBe(perDot[0][0]);
      expect(perDot[2][0]).toBe(perDot[0][0]);

      [1, 2, 3].forEach((n) => {
        hostNodes(
          screen.getByTestId(`itinerary-generating-pulse-${n}`)
        ).forEach((node) => {
          const style = StyleSheet.flatten(node.props.style) ?? {};
          expect([undefined, 1]).toContain(style.opacity);
          const transforms = (style.transform ?? []) as Record<
            string,
            unknown
          >[];
          transforms.forEach((entry) => {
            if ('scale' in entry) expect(entry.scale).toBe(1);
          });
        });
      });
    });
  });

  describe('P-6 · AC-6 — 실패·409 얼굴엔 펄스 원이 없다', () => {
    it('failed 면 실패 표면만 있고 펄스 원은 0개다', async () => {
      render(<GeneratingScreen onBackground={noop} onRetry={noop} failed />);
      await act(async () => {});

      expect(
        screen.getByTestId('itinerary-generating-failed')
      ).toBeOnTheScreen();
      expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
    });

    it('busy(다른 여행 생성 중)면 안내만 있고 펄스 원은 0개다', async () => {
      render(
        <GeneratingScreen
          onBackground={noop}
          onRetry={noop}
          busy={{ cancelable: true, onCancelAndRetry: noop, onWait: noop }}
        />
      );
      await act(async () => {});

      expect(screen.getByTestId('itinerary-generation-busy')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
    });
  });
});
