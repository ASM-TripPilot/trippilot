import { BackHandler, Dimensions, Platform } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { resetPressGuard } from '@/shared/lib/pressGuard';
import {
  closestScrollView,
  renderedText,
  stubScrollTo,
} from '@/test-support/sheetTree';

import { OnboardingTourView } from './OnboardingTourView';

/**
 * TRIP-1595 · 취향 2/2 완료 직후 기능 안내 6장 — 순수 뷰(페이저·진행 점·버튼·장식 무대).
 *
 * 무엇을 보장하나:
 *  - 6장이 전부 마운트되고 장마다 제목·본문 카피가 티켓 표와 같다(AC2·AC4). 2/6에는 가격 표기가 없다.
 *  - 진행 값(접근성 값)과 버튼 구성이 현재 장을 따른다: 1~5장은 건너뛰기+다음, 6장은 시작하기뿐(AC2).
 *  - `다음`·스와이프(`momentumScrollEnd`)·안드로이드 뒤로 가기가 모두 같은 현재 장을 갱신한다(AC2·AC8).
 *  - 건너뛰기·시작하기는 받은 콜백을 부른다(AC3 — 이동·연타 가드는 컨테이너 `OnboardingTourPage` 몫).
 *  - 무대 조각은 장식이다: 숨김 속성 3종, 누를 수 있는 것 0개(AC5). 거리 라벨은 2.1·0.8·0.6km뿐, 시간 표현 0(AC6).
 *
 * 커버하지 않는 것: 픽셀·색·점선·핀 위치(README 판정 4), 실제 스냅·스와이프·터치 차단·안전영역·✦ 폰트(6-b).
 * 계약(testID·props)은 `_workspace/20261022-trip1594-c10-tour-s1/02a_test-design_spec.md` §2 참조.
 *
 * 3동작 뼈대: 준비(렌더) → 실행(누르기·스와이프·핸들러 호출) → 단언(진행 값·버튼·콜백).
 */

// 연타 가드 창(모듈 전역 400ms)은 파일 최상위에서 닫는다 — `다음`이 guardPress 라 앞 누름이 뒤 테스트로 샌다(02a ★6).
beforeEach(() => {
  resetPressGuard();
});

const PAGE_IDS = [1, 2, 3, 4, 5, 6] as const;

/** 장별 카피(티켓 표 = Figma). 줄바꿈은 구현이 정하므로 한 줄로 쓴다 — 단언이 공백으로 접어 비교한다. */
const COPY = [
  {
    page: 1,
    title: '가고 싶은 곳을 하트로 담아요',
    body: '홈과 탐색에서 마음에 드는 장소·숙소를 담아 두면 여행을 만들 때 후보로 나와요.',
  },
  {
    page: 2,
    title: '숙소는 여기서 고르고, 예약은 제휴 사이트에서',
    body: '고른 숙소가 여행의 거점이 돼요. 예약·결제는 제휴 파트너 사이트에서 진행돼요.',
  },
  {
    page: 3,
    title: '일정은 원하는 방식으로 짜요',
    body: 'AI에게 맡기거나, AI 추천 위에서 고르거나, 직접 짜요. 어떤 방식이든 마지막엔 직접 고칠 수 있어요.',
  },
  {
    page: 4,
    title: '여행 중엔 앱을 덜 열어도 돼요',
    body: '자동 기록을 켜 두면 도착한 곳이 방문으로 남고, 비 예보나 휴무가 생기면 알림으로 먼저 알려 드려요.',
  },
  {
    page: 5,
    title: '다녀온 여행은 한 장으로 남아요',
    body: '다닌 곳·거리·사진이 여행 요약으로 정리되고, 날마다 회고를 남길 수 있어요.',
  },
  {
    page: 6,
    title: '막히면 ✦ 도우미에게 물어보세요',
    body: '짜 둔 일정을 검토하거나 고치는 걸 말로 부탁할 수 있어요.',
  },
] as const;

/** 장별 무대 카피 조각(브리프 §5-2 의 backtick 값). 각각 단독 Text 여야 한다. */
const STAGE_TEXTS: Record<number, string[]> = {
  1: ['부산 사하구', '지금 급상승'],
  2: ['외부에서 예약하기', '해운대 · 350m'],
  3: ['완전 AI가 짜기', 'AI와 같이 짜기', '직접 짜기'],
  4: [
    '날씨가 일정에 영향을 줄 수 있어요',
    '비 예보 · 해운대 17시',
    '광안리 해변',
    '11:00 방문',
  ],
  5: ['총 방문', '총 거리', '총 사진', '광안리→감천, 바다와 골목'],
  6: [
    '지금까지 짠 일정 검토해줘',
    '1일차 동선을 보니 황령산에서 미술관까지 0.8km예요. 그대로 두셔도 괜찮아요.',
  ],
};

const TESTID = {
  pager: 'onboarding-tour-pager',
  progress: 'onboarding-tour-progress',
  skip: 'onboarding-tour-skip',
  next: 'onboarding-tour-next',
  start: 'onboarding-tour-start',
} as const;

function renderTour(initialPage?: number) {
  const onSkip = jest.fn();
  const onStart = jest.fn();
  const view = render(
    <OnboardingTourView
      initialPage={initialPage}
      onSkip={onSkip}
      onStart={onStart}
    />
  );
  return { ...view, onSkip, onStart };
}

/** 진행 점 줄이 알리는 현재 장(접근성 값 — 색이 아니다). */
function expectPage(page: number): void {
  expect(screen.getByTestId(TESTID.progress)).toHaveAccessibilityValue({
    min: 1,
    max: 6,
    now: page,
  });
}

/** `다음`을 한 번 누른다 — 앞 누름의 가드 창을 먼저 닫는다(02a ★6). */
function pressNext(): void {
  resetPressGuard();
  fireEvent.press(screen.getByTestId(TESTID.next));
}

/** 손가락으로 넘겨 페이저가 `x` 오프셋에서 멈춘 것처럼 알린다. */
function swipeTo(x: number): void {
  fireEvent(screen.getByTestId(TESTID.pager), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x, y: 0 } },
  });
}

/** jest 의 창 폭(기본 750). 숫자를 박지 않는다. */
function pageWidth(): number {
  return Dimensions.get('window').width;
}

/** 무대 래퍼 — 자기 자신이 숨김이라 `hidden` 옵션이 있어야 찾는다(02a ★1). */
function stageOf(page: number): ReactTestInstance {
  return screen.getByTestId(`onboarding-tour-stage-${page}`, { hidden: true });
}

/**
 * 누를 수 있는 호스트 노드(Pressable·Touchable 공통: onClick/responder 핸들러가 함수) 수.
 * `UNSAFE_queryAllByType(Pressable)` 은 memo 래핑 때문에 0 을 돌려줘 쓰지 않는다(02a ★2).
 */
function pressableHostsIn(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      (typeof node.props.onClick === 'function' ||
        typeof node.props.onResponderGrant === 'function' ||
        typeof node.props.onStartShouldSetResponder === 'function')
  );
}

describe('AC2 · 6장이 전부 마운트되고 카피가 일치한다 (AC4)', () => {
  it('T1 장 6개가 1~6번으로 모두 트리에 있다', () => {
    // 준비·실행
    renderTour();

    // 단언 — 정확히 6개, 번호 1~6 (조건부 렌더로 현재 장만 그리지 않는다)
    const pages = screen.getAllByTestId(/^onboarding-tour-page-\d+$/);
    expect(pages).toHaveLength(6);
    PAGE_IDS.forEach((page) =>
      expect(
        screen.getByTestId(`onboarding-tour-page-${page}`)
      ).toBeOnTheScreen()
    );
  });

  it.each(COPY)(
    'T2 $page장 제목·본문이 티켓 카피와 문자 단위로 같다(줄바꿈은 공백으로 접어 비교)',
    ({ page, title, body }) => {
      // 준비
      renderTour();
      const pageNode = screen.getByTestId(`onboarding-tour-page-${page}`);

      // 단언 — toHaveTextContent(문자열)은 완전 일치(02a ★4)
      expect(
        within(pageNode).getByTestId(`onboarding-tour-title-${page}`)
      ).toHaveTextContent(title);
      expect(
        within(pageNode).getByTestId(`onboarding-tour-body-${page}`)
      ).toHaveTextContent(body);
    }
  );

  it('T3 2/6 숙소 카드에는 가격 표기가 없다(제목·본문·무대 글자 전부)', () => {
    // 준비
    renderTour(2);
    const page2 = screen.getByTestId('onboarding-tour-page-2');

    // 실행 — 이 장의 글자를 모두 모은다(호스트 Text 수집이라 숨김 무대 안도 읽힌다)
    const all = renderedText(page2);

    // 단언 — 앵커(무대가 실제로 읽혔다) + 가격 표현 없음
    expect(all).toContain('외부에서 예약하기');
    expect(all).not.toMatch(/원|~|₩|\d{1,3}(,\d{3})+/);
  });
});

describe('AC2 · 진행 표시와 버튼 구성은 현재 장을 따른다', () => {
  it.each(PAGE_IDS)('T4 %i장에서 진행 값과 버튼이 맞다', (page) => {
    // 준비·실행
    renderTour(page);

    // 단언 — 진행 값
    expectPage(page);

    // 단언 — 눈에 보이는(숨김 무대 제외) 버튼 role 전수: 1~5장 둘, 6장 하나
    const buttons = screen.getAllByRole('button');
    if (page < 6) {
      expect(buttons).toHaveLength(2);
      expect(screen.getByRole('button', { name: '건너뛰기' })).toBe(
        screen.getByTestId(TESTID.skip)
      );
      expect(screen.getByRole('button', { name: '다음' })).toBe(
        screen.getByTestId(TESTID.next)
      );
      expect(screen.queryByTestId(TESTID.start)).toBeNull();
    } else {
      expect(buttons).toHaveLength(1);
      expect(screen.getByRole('button', { name: '시작하기' })).toBe(
        screen.getByTestId(TESTID.start)
      );
      expect(screen.queryByTestId(TESTID.next)).toBeNull();
      expect(screen.queryByTestId(TESTID.skip)).toBeNull();
    }
  });

  it('T4b initialPage 를 주지 않으면 1장에서 시작한다', () => {
    renderTour();
    expectPage(1);
  });

  it.each(PAGE_IDS)(
    'T4c initialPage %i 이면 페이저도 그 장 위치에서 시작한다(contentOffset)',
    (page) => {
      // 준비·실행
      renderTour(page);

      // 단언 — 진행 값만 n이고 페이저는 1장에 머무는 프리뷰 어긋남을 막는다
      expect(screen.getByTestId(TESTID.pager).props.contentOffset).toEqual({
        x: (page - 1) * pageWidth(),
        y: 0,
      });
    }
  );
});

describe('AC2 · 다음·스와이프로 현재 장이 바뀐다', () => {
  it.each([1, 2, 3, 4, 5])(
    'T5 %i장에서 다음을 누르면 한 장 앞으로 가고 페이저를 한 장 폭만큼 굴린다',
    (page) => {
      // 준비 — 이 페이저의 scrollTo 만 세도록 가짜를 꽂는다(02a ★11)
      renderTour(page);
      const scroll = closestScrollView(screen.getByTestId(TESTID.pager));
      expect(scroll).not.toBeNull();
      const scrollTo = stubScrollTo(scroll!);
      expect(scrollTo).not.toHaveBeenCalled();

      // 실행
      pressNext();

      // 단언 — 진행 값 +1, 다음 장 위치(= 장 번호 × 폭)로 한 번
      expectPage(page + 1);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ x: page * pageWidth() })
      );
    }
  );

  it.each([2, 3, 4, 5, 6])(
    'T6 손가락으로 %i장까지 넘기면(momentumScrollEnd) 진행 값이 그 장이 된다',
    (page) => {
      // 준비
      renderTour();
      expectPage(1);

      // 실행
      swipeTo((page - 1) * pageWidth());

      // 단언
      expectPage(page);
    }
  );

  it('T6a 마지막 장으로 넘기면 시작하기만 남고, 처음으로 되돌려 넘기면 건너뛰기·다음이 돌아온다', () => {
    // 준비·실행 1 — 6장
    renderTour();
    swipeTo(5 * pageWidth());

    // 단언 1
    expect(screen.getByTestId(TESTID.start)).toBeOnTheScreen();
    expect(screen.queryByTestId(TESTID.next)).toBeNull();
    expect(screen.queryByTestId(TESTID.skip)).toBeNull();

    // 실행 2 — 1장으로 되돌림
    swipeTo(0);

    // 단언 2
    expectPage(1);
    expect(screen.getByTestId(TESTID.next)).toBeOnTheScreen();
    expect(screen.getByTestId(TESTID.skip)).toBeOnTheScreen();
    expect(screen.queryByTestId(TESTID.start)).toBeNull();
  });

  it('T6b 정지 오프셋이 정수 배수에서 한 픽셀 모자라도 가장 가까운 장으로 본다(반올림)', () => {
    // 준비
    renderTour();

    // 실행 — 3장 시작점(2 × 폭)보다 1px 앞에서 멈춤. 내림이면 2장이 된다.
    swipeTo(2 * pageWidth() - 1);

    // 단언
    expectPage(3);
  });

  it('T6c 정지 오프셋이 정수 배수에서 소수점만큼 넘쳐도 그 장으로 본다(반올림 반대쪽)', () => {
    // 준비
    renderTour();

    // 실행 — 2장 시작점(1 × 폭)에서 0.4px 넘게 멈춤. 올림이면 3장이 된다.
    swipeTo(pageWidth() + 0.4);

    // 단언
    expectPage(2);
  });

  it('T7 스와이프로 3장에 온 뒤 다음을 누르면 낡은 장 번호가 아니라 3장 기준으로 4장이 된다', () => {
    // 준비 — 1장에서 시작해 손가락으로 3장까지
    renderTour();
    swipeTo(2 * pageWidth());
    expectPage(3);
    const scroll = closestScrollView(screen.getByTestId(TESTID.pager));
    const scrollTo = stubScrollTo(scroll!);

    // 실행
    pressNext();

    // 단언
    expectPage(4);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: 3 * pageWidth() })
    );
  });
});

describe('AC3 · 건너뛰기·시작하기는 받은 콜백을 부른다', () => {
  it.each(PAGE_IDS)(
    'T8 %i장에서 나가는 버튼을 누르면 콜백이 한 번만 불린다',
    (page) => {
      // 준비
      const { onSkip, onStart } = renderTour(page);

      // 실행
      if (page < 6) {
        fireEvent.press(screen.getByTestId(TESTID.skip));
      } else {
        fireEvent.press(screen.getByTestId(TESTID.start));
      }

      // 단언 — 1~5장은 onSkip 만, 6장은 onStart 만
      expect(onSkip).toHaveBeenCalledTimes(page < 6 ? 1 : 0);
      expect(onStart).toHaveBeenCalledTimes(page < 6 ? 0 : 1);
    }
  );
});

describe('AC5 · 무대 조각은 눌리지 않는 장식이다', () => {
  it.each(PAGE_IDS)(
    'T9 %i장 무대는 숨김·터치 차단이고 안에 누를 수 있는 것이 없다',
    (page) => {
      // 준비
      renderTour();
      const stage = stageOf(page);

      // 단언 1 — 숨김 속성 3종
      expect(stage.props.pointerEvents).toBe('none');
      expect(stage.props.accessibilityElementsHidden).toBe(true);
      expect(stage.props.importantForAccessibility).toBe('no-hide-descendants');

      // 단언 2 — 누를 수 있는 노드 0개, role=button 0개(숨김 포함해서 센다 — 02a ★1)
      expect(pressableHostsIn(stage)).toHaveLength(0);
      expect(
        within(stage).queryAllByRole('button', { hidden: true })
      ).toHaveLength(0);

      // 앵커 — 무대가 빈 껍데기가 아니고(hidden 쿼리가 실제로 읽혔다), 제목은 숨겨지지 않았다
      expect(
        within(stage).getAllByText(/\S/, { hidden: true }).length
      ).toBeGreaterThan(0);
      expect(
        screen.getByTestId(`onboarding-tour-title-${page}`)
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(`onboarding-tour-body-${page}`)
      ).toBeOnTheScreen();
    }
  );

  it('T10 무대의 예약 버튼 모양 글자를 눌러도 나가지도 장이 바뀌지도 않는다', () => {
    // 준비
    const { onSkip, onStart } = renderTour(2);

    // 실행
    fireEvent.press(screen.getByText('외부에서 예약하기', { hidden: true }));

    // 단언
    expect(onSkip).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expectPage(2);
  });

  it.each(PAGE_IDS)('T11 %i장 무대에 Figma 카피 조각이 그대로 있다', (page) => {
    // 준비
    renderTour();
    const stage = within(stageOf(page));

    // 단언 — 각 조각이 단독 Text 로(완전 일치 쿼리)
    STAGE_TEXTS[page].forEach((text) =>
      expect(stage.getByText(text, { hidden: true })).toBeTruthy()
    );
  });
});

describe('AC6 · 소요시간 표현은 없고 거리는 km 라벨뿐이다 (INV-3)', () => {
  it('T12 3/6 무대의 거리 라벨은 2.1·0.8·0.6km 셋이고, 화면 어디에도 분·시간·소요·도보가 없다', () => {
    // 준비
    renderTour(3);
    const stage3 = within(stageOf(3));

    // 단언 1 — 무대의 km 라벨이 정확히 세 개
    const kmLabels = stage3.getAllByText(/^\d+(\.\d+)?km$/, { hidden: true });
    expect(kmLabels).toHaveLength(3);
    ['2.1km', '0.8km', '0.6km'].forEach((label) =>
      expect(stage3.getByText(label, { hidden: true })).toBeTruthy()
    );

    // 단언 2 — 화면 전체 글자(숨김 무대 포함, 6장 전부 마운트)에 시간 표현 0
    const everything = renderedText(screen.UNSAFE_root);
    expect(everything).toContain('건너뛰기'); // 앵커 — 크롬 글자가 읽혔다
    expect(everything).toContain('2.1km'); // 앵커 — 무대 글자가 읽혔다
    expect(everything).not.toMatch(/분|시간|소요|도보/);
  });
});

describe('AC8 · 안드로이드 하드웨어 뒤로 가기', () => {
  // 02a ★9 — ios jest 의 BackHandler 는 빈 구현이라 등록을 가로챈다. 안드로이드 전용 가드가 있어도 닿게 OS 를 바꾼다.
  let handlers: (() => boolean | null | undefined)[];
  let remove: jest.Mock;
  let add: jest.SpyInstance;
  let restoreOs: () => void;

  beforeEach(() => {
    handlers = [];
    remove = jest.fn();
    add = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler);
        return { remove };
      });
    const replaced = jest.replaceProperty(Platform, 'OS', 'android');
    restoreOs = () => replaced.restore();
  });

  afterEach(() => {
    add.mockRestore();
    restoreOs();
  });

  /** 가장 마지막으로 등록된 핸들러를 부른다(페이지마다 다시 등록하는 구현도 같은 결과). */
  function pressHardwareBack(): boolean | null | undefined {
    let result: boolean | null | undefined;
    act(() => {
      result = handlers[handlers.length - 1]();
    });
    return result;
  }

  it('T13a 3장에서 뒤로 가기는 앱을 닫지 않고(소비) 2장으로 간다', () => {
    // 준비 — 앵커: hardwareBackPress 를 실제로 구독했다
    renderTour(3);
    expect(add).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    const scrollTo = stubScrollTo(
      closestScrollView(screen.getByTestId(TESTID.pager))!
    );

    // 실행
    const consumed = pressHardwareBack();

    // 단언 — true 는 "내가 처리했다"(앱 종료·화면 이탈 없음)
    expect(consumed).toBe(true);
    expectPage(2);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ x: pageWidth() })
    );
  });

  it('T13b 1장에서 뒤로 가기는 소비만 하고 아무 일도 하지 않는다', () => {
    // 준비
    const { onSkip, onStart } = renderTour(1);
    expect(add).toHaveBeenCalled();

    // 실행
    const consumed = pressHardwareBack();

    // 단언
    expect(consumed).toBe(true);
    expectPage(1);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('T13c 6장에서도 이전 장(5장)으로 가고, 시작하기가 건너뛰기·다음으로 바뀐다', () => {
    // 준비
    renderTour(6);

    // 실행
    expect(pressHardwareBack()).toBe(true);

    // 단언
    expectPage(5);
    expect(screen.getByTestId(TESTID.next)).toBeOnTheScreen();
    expect(screen.queryByTestId(TESTID.start)).toBeNull();
  });

  it('T13d 화면을 떠나면 등록한 구독을 모두 푼다', () => {
    // 준비
    const { unmount } = renderTour(2);
    expect(add).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    // 실행
    unmount();

    // 단언 — 등록 수만큼 해제
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  });
});
