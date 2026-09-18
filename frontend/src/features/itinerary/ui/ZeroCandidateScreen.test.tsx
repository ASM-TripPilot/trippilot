import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { ZeroCandidateScreen } from './ZeroCandidateScreen';

/**
 * h35 [완전AI] AI 일정 결과 · **후보 0건** — Figma `1906:1083` 의 렌더 계약.
 *
 * 무엇을 보장하나:
 *  - 🔴 **어떤 조건이 0으로 만들었는지 밝힌다**(US-SCHED-02 예외 · AC-6). "결과가 없어요"만
 *    띄우는 화면은 이 심판을 통과할 수 없다.
 *  - 서버가 준 조건 문자열을 **그대로** 낸다(01b D8) — 코드→한글 사전을 만들지 않는다.
 *    서버가 무엇을 줄지 모르는 상태에서 사전은 추측이고, 사전에 없는 코드는 **조용히 사라진다**.
 *  - 조건을 못 받았으면 **몰랐다고 말한다**(AC-7). 침묵도 거짓말도 아닌 세 번째 답이다(INV-4).
 *  - 🔴 완화 제안은 **갈 수 있는 한 행뿐**이다(AC-8 · 01b D7). 목적지 없는 버튼, 완화 파라미터가
 *    없는 재생성 CTA는 그리지 않는다 — 누르면 아무 일도 안 나는 버튼보다 **없는 편**이 정직하다.
 *
 * ⚠️ **Figma 와 의도적으로 갈라진다**(01b D7 · [기록]에서 지라에 보고): 「예산·조건 완화」는
 * 목적지 라우트가 없고(취향 편집이 온보딩 안에만 있다), 「이동 반경 넓히기」의 `radiusMUsed` 는
 * **슬롯 단위 API 전용**이라 일정 전체가 0건인 이 화면에서는 부를 슬롯이 없으며, 하단 CTA
 * `조건 넓혀 다시 만들기` 는 `GenerateItineraryRequest` 에 완화 파라미터가 0개라 문구가
 * 거짓말이 된다. **갭이 아니라 결정**이다.
 *
 * 3동작 뼈대: 준비=조건 목록을 주고 렌더 → 실행=완화 행을 누른다 → 단언=보이는 것·불린 콜백.
 */

const ZERO = 'itinerary-draft-zero';
const RELAX = 'itinerary-draft-zero-relax';
const BACK = 'itinerary-draft-zero-back';

/** Figma 목업이 든 값 — 사람이 읽는 완성 문구 형태다. */
const CATEGORIES = ['1일 예산 5만원', '700m 이내', '비건·24시간'];
const NO_CATEGORY_NOTE = '어떤 조건이 문제인지 확인하지 못했어요';

const onBack = jest.fn();
const onReduceMustVisits = jest.fn();

function renderScreen(shortfallCategories: string[] = CATEGORIES) {
  return render(
    <ZeroCandidateScreen
      shortfallCategories={shortfallCategories}
      onBack={onBack}
      onReduceMustVisits={onReduceMustVisits}
    />
  );
}

beforeEach(() => {
  onBack.mockClear();
  onReduceMustVisits.mockClear();
});

describe('Z0 · 자가검사 — 이게 통과해야 아래 "정확히 1개"가 의미를 갖는다', () => {
  it('완화 행 셀렉터가 화면 루트를 삼키지 않는다', () => {
    renderScreen();

    // ★ 접두 함정 — 루트 testID `itinerary-draft-zero` 는 완화 행 testID
    //   `itinerary-draft-zero-relax` 의 **접두**다. `/^itinerary-draft-zero/` 로 세면 루트까지
    //   함께 잡혀 "완화 행이 1개"라는 단언이 조용히 2를 센다(02a §5-D 실행 확인 · 동결
    //   `DraftScreen.test.tsx` 의 카드 셀렉터가 같은 함정을 다룬 선례).
    expect(screen.queryAllByTestId(/^itinerary-draft-zero-relax/)).toHaveLength(
      1
    );
    expect(
      screen.queryAllByTestId(/^itinerary-draft-zero/).length
    ).toBeGreaterThan(1);
  });
});

describe('🔴 Z1 · AC-6 — 어떤 조건이 0으로 만들었는지 밝힌다 (US-SCHED-02 예외)', () => {
  it('받은 조건 세 개가 각각 화면에 그대로 보인다', () => {
    renderScreen();

    const zero = screen.getByTestId(ZERO);
    // 세 문자열을 **각각** 집는다. 하나만 그리거나 " · " 로 뭉뚱그리는 구현이 여기서 죽는다.
    // (`getByText` 는 기본 완전 일치지만, 중첩 `Text` 로 쪼개 그려도 자손을 이어붙여 찾는다 —
    //  02a §5-F 실행 확인. 즉 이 단언은 마크업 모양을 강요하지 않는다.)
    CATEGORIES.forEach((category) => {
      expect(within(zero).getByText(category)).toBeOnTheScreen();
    });

    // 짝 — 조건을 받았으면 "몰랐다" 문구는 **없다**. 두 문구를 동시에 띄우는 구현을 죽인다.
    expect(screen.queryAllByText(NO_CATEGORY_NOTE)).toEqual([]);
  });

  it('축 코드로 와도 그대로 낸다 — 사전을 만들지 않는다 (01b D8)', () => {
    /**
     * 계약은 `shortfallCategories: string[]` 이라고만 말하고 **형태를 정하지 않는다.** 목업은
     * `1일 예산 5만원`(완성 문구)인데 서버가 축 코드(`budget`)를 줄 수도 있다. 여기서 사전
     * (코드→한글)을 만들면 사전에 없는 코드가 **화면에서 사라진다** — 그대로 내면 그 사고가
     * 원리적으로 없다. 못생긴 문자열이 사라진 문자열보다 낫다.
     */
    renderScreen(['budget', 'radius']);

    const zero = screen.getByTestId(ZERO);
    expect(within(zero).getByText('budget')).toBeOnTheScreen();
    expect(within(zero).getByText('radius')).toBeOnTheScreen();
  });
});

describe('🔴 Z2 · AC-7 — 조건을 못 받았으면 몰랐다고 말한다 (01b D8 · INV-4)', () => {
  it('빈 목록이면 확인하지 못했다고 밝히고 완화 제안은 그대로 남는다', () => {
    // 계약상 `required: [level]` 뿐이라 **조건 없이 오는 것이 정상 조합**이다(brief §3.3).
    // 그때 조건 섹션만 조용히 지우면 "결과가 없어요"만 남아 AC-6 을 정면으로 어긴다.
    renderScreen([]);

    expect(screen.getByText(NO_CATEGORY_NOTE)).toBeOnTheScreen();

    // 짝 — 조건이 없다고 **완화 제안까지** 사라지지 않는다. 사용자에게 남는 다음 행동이다.
    expect(screen.queryAllByTestId(/^itinerary-draft-zero-relax/)).toHaveLength(
      1
    );
  });
});

describe('🔴 Z3 · AC-8 — 완화 제안은 갈 수 있는 한 행뿐이다 (01b D7)', () => {
  it('완화 행이 정확히 1개이고 누르면 콜백이 1회 불린다', () => {
    renderScreen();

    expect(screen.queryAllByTestId(/^itinerary-draft-zero-relax/)).toHaveLength(
      1
    );

    fireEvent.press(screen.getByTestId(RELAX));

    // 긍정 짝 — 그려만 두고 죽어 있는 행이 아니다. 실재 라우트(`/itinerary/must-visits`)가
    // 있는 유일한 행이라 이 사이클에서 유일하게 살아 있는 출구다.
    expect(onReduceMustVisits).toHaveBeenCalledTimes(1);
  });

  it('반경·예산 행과 재생성 CTA 가 화면에 0건이다', () => {
    renderScreen();

    /**
     * ★ 두 그물로 잡는다.
     *  ① **버튼 개수** — 이 화면에서 누를 수 있는 것은 뒤로와 완화 행 **둘뿐**이다. 재생성
     *     CTA 가 늘면 여기서 죽는다. ⚠️ 한계: `accessibilityRole` 이 없는 `Pressable` 은
     *     `queryAllByRole('button')` 에 **안 잡힌다**(02a §5-C 실행 확인) — 그래서 두 testID 에
     *     역할 부착을 계약으로 못 박고(02a §2.1), 아래 ② 문구 그물을 함께 둔다.
     *  ② **문구** — 금칙 토큰을 `예산`·`반경` 처럼 순진하게 고르면 서버가 준 칩
     *     (`1일 예산 5만원` · `700m 이내`)과 Figma 히어로 부제가 자기 자신을 red 로 만든다
     *     (02a ★5). 칩과 겹치지 않는 조각만 고른다.
     */
    expect(
      screen
        .queryAllByRole('button')
        .map((node) => String(node.props.testID))
        .sort()
    ).toEqual([BACK, RELAX]);

    expect(screen.root).not.toHaveTextContent(/이동 반경/);
    expect(screen.root).not.toHaveTextContent(/예산·조건/);
    expect(screen.root).not.toHaveTextContent(/다시 만들기/);

    // 짝 — 뒤로는 살아 있다(전부 안 그리는 구현을 죽인다).
    fireEvent.press(screen.getByTestId(BACK));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
