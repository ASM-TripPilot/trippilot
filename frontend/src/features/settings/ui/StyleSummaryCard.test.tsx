import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { StyleAnalysisEnvelope } from '@/shared/api/generated/schemas';

import { buildStyleCardModel, type StyleCardVM } from '../model/styleCardModel';
import { StyleSummaryCard } from './StyleSummaryCard';

/**
 * TRIP-606 · l03 스타일 요약 카드 — VM 주입 순수 프레젠테이션 화면. 조회·조립은 페이지 몫이라
 * 여기선 완성 VM 을 props 로 넣고 렌더 계약만 잠근다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-S1(US-NOTIF-08) 정식 VM → 칩 N + 게이지 3행(라벨 3종) + "여행 N개 · 갱신 …" + 상세 어포던스.
 *  - 🔴 AC-S2(BR-U6-24 핵심) 축 값 N → **채운 dot 정확히 N개**(나머지 empty). 채운/빈 dot 별도 testID 카운트.
 *  - 🔴 AC-S3(BR-U6-24) 미달 VM → 안내 한 줄만. 게이지·칩·상세 미렌더.
 *  - 🔴 AC-S4(INV-U5-09) preview.descriptors 가 온 envelope 라도 모델이 걸러 화면은 미달 얼굴(칩 0).
 *  - AC-S5(INV-3) 렌더에 소요시간 문자열 0(선제 green 회귀 앵커 — 진짜 그물은 myStaysStructure G2 소스 스캔).
 *  - 🔴 AC-S6(INV-4) 상세 어포던스는 보이되 real disabled(라우트 미존재 정직 degrade).
 *
 * 왜 이렇게 테스트하나(02a ★2):
 *  - **글리프 fill 함정** — SVG 한 장으로 게이지를 그리면 "value=3인데 4채움"이 전 심판 green(fill 색은 jest 사각).
 *    → 채운/빈 dot 을 각각 다른 exact testID 를 단 View 로 렌더해 `getAllByTestId`(exact-match) **개수**로 단언.
 *    AC-S2 가 값 [5,0,3](경계+distinct)로 축별 카운트를 잠가 이 형태를 강제한다.
 *
 * (개념) `getByText('문자열')`=leaf 완전일치 · `getByText(/정규식/)`/`queryAllByText(/re/)`=부분포함 ·
 *   `getAllByTestId('문자열')`=testID 완전일치(node_modules matches.js exact=true 실검증, 02a §5-A) ·
 *   `toBeDisabled()`=real disabled prop 판독(02a §5-C).
 */

/** 소요시간 표기 탐지기(INV-3) — 부분포함 정규식(TripCardContainer·MyStaysScreen 선례 동형). */
const DURATION = /소요|\d+\s*분|\d+\s*시간/;

/** 정식 VM — 값을 넘겨받아 그린다. */
function officialVM(
  over: Partial<Extract<StyleCardVM, { kind: 'official' }>> = {}
): StyleCardVM {
  return {
    kind: 'official',
    descriptors: ['#바다', '#미식'],
    gauges: [
      { label: '여유로움', value: 4 },
      { label: '미식 취향', value: 4 },
      { label: '활동성', value: 3 },
    ],
    sampleTripCount: 6,
    updatedAt: '2026-08-28T09:00:00Z',
    ...over,
  };
}

describe('🔴 AC-S1 · 정식 렌더(US-NOTIF-08)', () => {
  it('칩 N개 + 게이지 3행(라벨 3종) + "여행 N개 · 갱신 …" + 상세 어포던스를 그린다', () => {
    render(<StyleSummaryCard vm={officialVM()} />);

    // 카드 루트.
    expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();

    // 칩 = descriptors(정확 개수 + 텍스트 완전일치).
    expect(screen.getAllByTestId('my-style-chip')).toHaveLength(2);
    expect(screen.getByText('#바다')).toBeOnTheScreen();
    expect(screen.getByText('#미식')).toBeOnTheScreen();

    // 게이지 3축 행 + 라벨 3종.
    expect(screen.getAllByTestId('my-style-gauge')).toHaveLength(3);
    expect(screen.getByText('여유로움')).toBeOnTheScreen();
    expect(screen.getByText('미식 취향')).toBeOnTheScreen();
    expect(screen.getByText('활동성')).toBeOnTheScreen();

    // 메타줄 — sampleTripCount + slice(0,10)+formatKoreanDate 로 포맷된 갱신 시점.
    //   (slice 를 빼면 formatKoreanDate 가 NaN 으로 깨지므로 이 단언이 그 회귀도 잡는다.)
    expect(screen.getByText(/여행 6개/)).toBeOnTheScreen();
    expect(screen.getByText(/갱신 8월 28일 금요일/)).toBeOnTheScreen();

    // 상세 진입 어포던스 존재(활성/비활성은 AC-S6).
    expect(screen.getByTestId('my-style-detail')).toBeOnTheScreen();
  });
});

describe('🔴 AC-S2 · 게이지 채움 수 = 값(BR-U6-24, 글리프 fill 함정 회피)', () => {
  it('축 값 N 이면 채운 dot 이 정확히 N개, 나머지는 빈 dot 이다(경계 0·5 포함)', () => {
    // 값 [5,0,3] — 경계(꽉·빈)와 서로 다른 개수로, "SVG 한 장 4채움" 오구현을 카운트로 잡는다.
    render(
      <StyleSummaryCard
        vm={officialVM({
          descriptors: ['#바다'],
          gauges: [
            { label: '여유로움', value: 5 },
            { label: '미식 취향', value: 0 },
            { label: '활동성', value: 3 },
          ],
        })}
      />
    );

    const rows = screen.getAllByTestId('my-style-gauge');
    expect(rows).toHaveLength(3);

    // 행0 — 여유로움 5: 채움 5 / 빈 0.
    expect(within(rows[0]).getByText('여유로움')).toBeOnTheScreen();
    expect(within(rows[0]).getAllByTestId('my-style-dot-filled')).toHaveLength(
      5
    );
    expect(within(rows[0]).queryAllByTestId('my-style-dot-empty')).toHaveLength(
      0
    );

    // 행1 — 미식 취향 0: 채움 0 / 빈 5.
    expect(within(rows[1]).getByText('미식 취향')).toBeOnTheScreen();
    expect(
      within(rows[1]).queryAllByTestId('my-style-dot-filled')
    ).toHaveLength(0);
    expect(within(rows[1]).getAllByTestId('my-style-dot-empty')).toHaveLength(
      5
    );

    // 행2 — 활동성 3: 채움 3 / 빈 2.
    expect(within(rows[2]).getByText('활동성')).toBeOnTheScreen();
    expect(within(rows[2]).getAllByTestId('my-style-dot-filled')).toHaveLength(
      3
    );
    expect(within(rows[2]).getAllByTestId('my-style-dot-empty')).toHaveLength(
      2
    );
  });
});

describe('🔴 AC-S3 · 미달 렌더(BR-U6-24)', () => {
  it('insufficient VM 은 안내 한 줄만 그리고 게이지·칩·상세를 안 그린다', () => {
    render(<StyleSummaryCard vm={{ kind: 'insufficient', current: 4 }} />);

    // 카드 루트는 남되(같은 카드의 다른 얼굴), 안내 문안이 뜬다.
    expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
    expect(
      screen.getByText(/10곳 이상 쌓이면 분석을 제공합니다/)
    ).toBeOnTheScreen();
    expect(screen.getByText(/현재 4곳/)).toBeOnTheScreen();

    // 부정 짝 — 정식 얼굴 요소는 하나도 없다.
    expect(screen.queryAllByTestId('my-style-gauge')).toHaveLength(0);
    expect(screen.queryAllByTestId('my-style-chip')).toHaveLength(0);
    expect(screen.queryAllByTestId('my-style-dot-filled')).toHaveLength(0);
    expect(screen.queryByTestId('my-style-detail')).toBeNull();
  });
});

describe('🔴 AC-S4 · 미리보기 비정식(모델→화면 합성, INV-U5-09)', () => {
  it('preview.descriptors 가 온 envelope 라도 칩/게이지를 그리지 않고 미달 얼굴만 그린다', () => {
    // 모델이 실제로 걸러내는지를 프레젠테이션 이음매까지 관통해 확인한다(M2 는 유닛 teeth).
    const env: StyleAnalysisEnvelope = {
      official: false,
      progress: { current: 5, required: 10 },
      analysis: null,
      preview: { descriptors: ['#바다', '#미식', '#느긋'] },
    };
    const vm = buildStyleCardModel(env);

    render(<StyleSummaryCard vm={vm} />);

    // preview 텍스트는 화면 어디에도 없다.
    expect(screen.queryAllByTestId('my-style-chip')).toHaveLength(0);
    expect(screen.queryByText('#바다')).toBeNull();
    expect(screen.queryByText('#느긋')).toBeNull();
    // 미달 얼굴로 접힌다.
    expect(screen.getByText(/현재 5곳/)).toBeOnTheScreen();
  });
});

describe('AC-S5 · INV-3 소요시간 미표시(렌더, 선제 green 회귀 앵커)', () => {
  it('정식 카드를 그려도 분·시간·소요 표기가 0건이다', () => {
    render(<StyleSummaryCard vm={officialVM()} />);

    // 탐지기 자가검사(짝) — 실제 소요시간은 잡히고, 메타줄 날짜는 무시한다.
    expect('도보 15분').toMatch(DURATION);
    expect('여행 6개 · 갱신 8월 28일 금요일').not.toMatch(DURATION);

    // 렌더 결과를 훑는다 — 소요시간 문자열 0건.
    expect(screen.queryAllByText(DURATION)).toHaveLength(0);
  });
});

describe('🔴 AC-S6 · 상세 진입 정직 degrade(INV-4)', () => {
  it('상세 어포던스는 보이되 real disabled 이고, press 해도 아무 일이 없다', () => {
    render(<StyleSummaryCard vm={officialVM()} />);

    const detail = screen.getByTestId('my-style-detail');
    // 급소: real disabled(회색인데 눌리는 함정 회피). 라우트(records/style) 미존재 동안.
    expect(detail).toBeDisabled();

    // press 해도 죽은 내비 없음 — 화면은 라우터 무의존이라 구조적으로 무동작(무크래시).
    expect(() => fireEvent.press(detail)).not.toThrow();
  });
});
