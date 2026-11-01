import { fireEvent, render, screen } from '@testing-library/react-native';

import type { DraftDayTab, DraftView } from '@/features/itinerary/index.view';

import { DraftScreen } from './DraftScreen';

/**
 * h11 초안 화면의 **렌더 계약 — 남는 얼굴(loading·failed·empty)만**. 화면은 완성된 값만 받는다 — 조회도 판정도
 * 하지 않는다.
 *
 * 슬롯 목록 얼굴(`listed`)은 TRIP-1039 부터 `DraftPage` 가 지도+시트 셸(h08)로 그려 프로덕션 도달이 0이었다 —
 * TRIP-1352 가 그 분기를 코드째 지우면서 listed 얼굴 심판(카드 시각·시간대 라벨·번호·키·핀·완성 CTA·교체 트리거·
 * reason 부제 등 ≈890줄)도 함께 지웠다. 그 얼굴의 동작은 셸을 그리는 `DraftPage.integration.test.tsx` 가 잰다.
 *
 * 무엇을 보장하나:
 *  - 일차 탭은 여행 기간만큼이고 데이터 없는 날은 눌러도 선택이 안 바뀐다(AC-4).
 *  - 확정된 일정에서는 다시 시도가 눌리지 않는다(01b D8) — 회색만 칠하고 눌리면 확정 일정이 사라진다.
 *  - 진행 표시는 평범한 것 하나뿐이다(BR-U3-04·05 는 보류 칸).
 *  - (2026-11-01) 헤더 구분자·폴백 안내 아이콘 글리프(생김새)와 일차 탭 가로 스크롤(jest 사각)은 지웠다 —
 *    실화면 QA 몫(`docs/feature-map/ai-generate.md`).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에게는 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다.
 *
 * 3동작 뼈대: 준비=`view`·`tabs` 를 만들어 렌더 → 실행=누른다 → 단언=보이는 것·불린 콜백.
 */

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';

const TABS: DraftDayTab[] = [
  { date: DAY1, dayNumber: 1, hasData: true },
  { date: DAY2, dayNumber: 2, hasData: false },
  { date: DAY3, dayNumber: 3, hasData: false },
];

const LOADING: DraftView = { kind: 'loading' };

/** 렌더된 텍스트 전부. 부정 스캔의 모집단이다 — 소스가 아니라 **보이는 글자**를 훑는다. */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

const onSelectDay = jest.fn();
const onRetry = jest.fn();
const onBack = jest.fn();

type ScreenOverrides = {
  view?: DraftView;
  tabs?: DraftDayTab[];
  selectedDate?: string;
  canRetry?: boolean;
};

function screenElement(over: ScreenOverrides = {}) {
  return (
    <DraftScreen
      view={LOADING}
      tabs={TABS}
      selectedDate={DAY1}
      canRetry
      onSelectDay={onSelectDay}
      onRetry={onRetry}
      onBack={onBack}
      {...over}
    />
  );
}

function renderScreen(over: ScreenOverrides = {}) {
  return render(screenElement(over));
}

beforeEach(() => {
  onSelectDay.mockClear();
  onRetry.mockClear();
  onBack.mockClear();
});

describe('C10 · AC-4 — 탭은 여행 기간만큼이고 데이터 없는 날은 눌리지 않는다', () => {
  it('탭 3개가 뜨고 비활성 탭은 눌러도 선택이 안 바뀐다', () => {
    renderScreen();

    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toHaveLength(3);
    expect(screen.getByTestId('itinerary-draft-day-1')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-draft-day-3')).toBeOnTheScreen();

    // ★ `toBeDisabled()` 하나로는 못 잰다 — 회색으로 칠하기만 하고 실제로는 눌리는 구현이
    //   그 매처를 **통과한다**(TRIP-296 02a §5-2 실측: accessibilityState 만 준 Pressable 은
    //   press 가 1회 불린다). 그래서 press 0회를 짝으로 붙인다.
    const inactive = screen.getByTestId('itinerary-draft-day-2');
    expect(inactive).toBeDisabled();
    fireEvent.press(inactive);
    expect(onSelectDay).not.toHaveBeenCalled();

    // 짝 — 활성 탭은 실제로 눌린다(전부 비활성인 구현을 죽인다).
    fireEvent.press(screen.getByTestId('itinerary-draft-day-1'));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith(DAY1);
  });
});

describe('🔴 C13 · AC-11 — 확정된 일정에서는 다시 시도가 눌리지 않는다 (01b D8)', () => {
  it('canRetry=false 면 비활성이고 눌러도 콜백이 0회다', () => {
    /**
     * ⚠️ 여기가 이 칸에서 **가장 비싼 단일 실패**다. openapi POST 원문: *"확정 일정에 호출하면
     * 확정이 풀리고 PLANNED 새 일정으로 대체되며, 동결됐던 poi_snapshot 참조는 사라진다."*
     * 즉 회색으로 칠하기만 하고 실제로 눌리면 **사용자 데이터가 소실된다** — `toBeDisabled()`
     * 단독으로는 그 구현을 통과시킨다(02a ★8).
     */
    renderScreen({ canRetry: false });

    const retry = screen.getByTestId('itinerary-draft-retry');
    expect(retry).toBeDisabled();
    fireEvent.press(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('canRetry=true 면 눌린다 — 중단된 생성에서 벗어나는 탈출구다', () => {
    // 짝 — 항상 비활성인 구현을 죽인다. PARTIAL 에 갇힌 사용자의 유일한 출구다.
    renderScreen({ canRetry: true });

    fireEvent.press(screen.getByTestId('itinerary-draft-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('C14 · 진행 표시 — 평범한 것 하나뿐이다 (티켓 스코프 · BR-U3-04·05 는 보류 칸)', () => {
  it('진행 표시가 뜨고 단계·진행률·백그라운드·취소는 없다', () => {
    renderScreen({ view: LOADING });

    // 긍정 — 진행 표시가 실재한다.
    expect(screen.getByTestId('itinerary-draft-loading')).toBeOnTheScreen();

    // 부정 — h09/h10 이 요구하는 4가지는 `GenerationSession` 부재로 보류 칸 소관이다. 이 칸이
    // 미리 만들면 데이터 없는 껍데기가 생기고, 나중에 그 칸이 붙을 자리가 어긋난다.
    const texts = renderedTexts().join(' ');
    ['백그라운드', '취소', '%'].forEach((forbidden) => {
      expect(texts).not.toContain(forbidden);
    });
  });
});
