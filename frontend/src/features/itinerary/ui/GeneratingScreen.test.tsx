import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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
    // (viewOnly·connectPins={false}·연결선 0 은 소스층 `itineraryMapSurfaceStructure` S2·S8 이 잠근다.)
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
