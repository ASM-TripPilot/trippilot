import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  StyleAnalysisBody,
  StyleProgress,
} from '@/shared/api/generated/schemas';

import { TravelStyleScreen } from './TravelStyleScreen';

/**
 * TRIP-573 · j05 여행 스타일 화면 — VM 주입 순수 렌더 테스트.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-2 정식(BR-U5-42)**: `categoryBreakdown` 4행이 CategoryBarList(`reflection-style-bar`)로,
 *    라벨은 표시 매핑(맛집→미식·isOther→기타)·비율은 `N%`. StatTile 2개(하루 평균 방문·평균 체류) +
 *    EvidenceLink(`reflection-style-evidence`) + 지도 placeholder degrade.
 *  - 🔴 **AC-5(BR-U5-08a · INV-3 예외)**: 평균 체류 StatTile 이 `72분`을 표시하고, `avgDwellMinutes=null`
 *    이면 그 타일을 **degrade(미표시)** — 0 으로 안 채운다(다른 타일은 그대로).
 *  - 🔴 **AC-3 임시(BR-U5-40·US-REC-09)**: `현재 N곳 / 필요 10곳` + "정식 아님" 명시 + preview.descriptors 칩.
 *    정식 얼굴(막대·StatTile·Evidence)은 **안** 그린다(상호배타).
 *  - 🔴 **[[반쪽 방어]]**: official 인데 `categoryBreakdown` 이 null(계약위반)이어도 0막대·무크래시.
 *
 * (개념) 매처: 부분포함은 `getByText(/정규식/)`, 부재는 `queryBy*`, 개수는 `getAllByTestId`(exact testID).
 *   `toHaveTextContent(문자열)`은 완전일치라 쓰지 않는다(문제로그 [[RNTL toHaveTextContent 완전 일치 함정]]).
 */

/** 정식 본문 — 4행(맛집·카페·자연·기타) + 통계. dwell 값은 숫자 prop(소스 리터럴 아님, INV-3). */
function officialBody(
  overrides: Partial<StyleAnalysisBody> = {}
): StyleAnalysisBody {
  return {
    descriptors: ['#바다', '#미식'],
    traitGauges: { easygoing: 4, foodAffinity: 4, activeness: 3 },
    categoryBreakdown: [
      { category: '맛집', ratio: 0.4, isOther: false },
      { category: '카페', ratio: 0.25, isOther: false },
      { category: '자연', ratio: 0.2, isOther: false },
      { category: '상위3밖', ratio: 0.15, isOther: true },
    ],
    avgPlacesPerDay: 4,
    avgRadiusKm: 1.2,
    avgDwellMinutes: 72,
    sampleTripCount: 6,
    updatedAt: '2026-08-28T09:00:00Z',
    ...overrides,
  };
}

const PROGRESS_OFFICIAL: StyleProgress = { current: 14, required: 10 };
const PROGRESS_INSUFFICIENT: StyleProgress = { current: 3, required: 10 };

describe('🔴 TravelStyleScreen · official 얼굴 (AC-2 · AC-5)', () => {
  it('AC-2: 카테고리 4행이 표시 라벨(맛집→미식·기타)·비율(N%)로, StatTile 2·Evidence·지도 placeholder 와 함께 그려진다', () => {
    render(
      <TravelStyleScreen
        face="official"
        progress={PROGRESS_OFFICIAL}
        analysis={officialBody()}
        preview={null}
      />
    );

    // 막대 = 행마다 exact testID View(SVG 한 장 fill 금지) → 개수로 잰다.
    expect(screen.getAllByTestId('reflection-style-bar')).toHaveLength(4);
    // 표시 라벨 매핑 + 최상위 비율.
    expect(screen.getByText(/미식/)).toBeOnTheScreen();
    expect(screen.getByText(/기타/)).toBeOnTheScreen();
    expect(screen.getByText(/40%/)).toBeOnTheScreen();

    // StatTile 2개(하루 평균 방문 · 평균 체류) + Evidence + 지도 placeholder degrade.
    expect(
      screen.getByTestId('reflection-style-stat-places')
    ).toBeOnTheScreen();
    expect(screen.getByText(/4곳/)).toBeOnTheScreen();
    expect(screen.getByText('하루 평균 방문')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-style-evidence')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-style-map')).toBeOnTheScreen();
  });

  it('AC-5: 평균 체류 StatTile 이 72분을 표시한다(INV-3 유일 예외, BR-U5-08a)', () => {
    render(
      <TravelStyleScreen
        face="official"
        progress={PROGRESS_OFFICIAL}
        analysis={officialBody({ avgDwellMinutes: 72 })}
        preview={null}
      />
    );

    expect(screen.getByTestId('reflection-style-stat-dwell')).toBeOnTheScreen();
    expect(screen.getByText(/72분/)).toBeOnTheScreen();
    expect(screen.getByText('평균 체류 시간')).toBeOnTheScreen();
  });

  it('AC-5: avgDwellMinutes=null 이면 체류 타일을 degrade(미표시) — 0 으로 안 채운다', () => {
    render(
      <TravelStyleScreen
        face="official"
        progress={PROGRESS_OFFICIAL}
        analysis={officialBody({ avgDwellMinutes: null })}
        preview={null}
      />
    );

    // 체류 타일은 사라지고(미측정), 다른 타일(하루 평균 방문)은 그대로.
    expect(screen.queryByTestId('reflection-style-stat-dwell')).toBeNull();
    expect(screen.queryByText(/0분/)).toBeNull();
    expect(
      screen.getByTestId('reflection-style-stat-places')
    ).toBeOnTheScreen();
  });

  it('EvidenceLink press → "준비 중" degrade 만(가짜 이동 0, Q3·INV-4)', () => {
    render(
      <TravelStyleScreen
        face="official"
        progress={PROGRESS_OFFICIAL}
        analysis={officialBody()}
        preview={null}
      />
    );

    fireEvent.press(screen.getByTestId('reflection-style-evidence'));
    expect(screen.getByText(/준비 중/)).toBeOnTheScreen();
  });

  it('[[반쪽 방어]]: categoryBreakdown 이 null(계약위반)이어도 0막대·무크래시, 통계 타일은 생존', () => {
    render(
      <TravelStyleScreen
        face="official"
        progress={PROGRESS_OFFICIAL}
        analysis={officialBody({
          categoryBreakdown:
            null as unknown as StyleAnalysisBody['categoryBreakdown'],
        })}
        preview={null}
      />
    );

    expect(screen.queryAllByTestId('reflection-style-bar')).toHaveLength(0);
    expect(
      screen.getByTestId('reflection-style-stat-places')
    ).toBeOnTheScreen();
  });
});

describe('🔴 TravelStyleScreen · insufficient 얼굴 (AC-3)', () => {
  it('진행(현재 N곳/필요 10곳) + 정식 아님 명시 + preview.descriptors 칩(BR 우선, Q2)', () => {
    render(
      <TravelStyleScreen
        face="insufficient"
        progress={PROGRESS_INSUFFICIENT}
        analysis={null}
        preview={{ descriptors: ['느긋', '바다'] }}
      />
    );

    // 진행 + 정식 아님 명시.
    const progress = screen.getByTestId('reflection-style-progress');
    expect(progress).toBeOnTheScreen();
    expect(screen.getByText(/현재 3곳/)).toBeOnTheScreen();
    expect(screen.getByText(/필요 10곳/)).toBeOnTheScreen();
    expect(screen.getByText(/정식 분석이 아니/)).toBeOnTheScreen();

    // 온보딩 취향 미리보기 칩(Figma 목업엔 없지만 BR/계약 우선).
    expect(screen.getAllByTestId('reflection-style-preview-chip')).toHaveLength(
      2
    );
    expect(screen.getByText(/느긋/)).toBeOnTheScreen();
    expect(screen.getByText(/바다/)).toBeOnTheScreen();
  });

  it('임시 얼굴은 정식 얼굴 요소(막대·StatTile·Evidence)를 안 그린다(상호배타)', () => {
    render(
      <TravelStyleScreen
        face="insufficient"
        progress={PROGRESS_INSUFFICIENT}
        analysis={null}
        preview={{ descriptors: ['느긋'] }}
      />
    );

    expect(screen.queryAllByTestId('reflection-style-bar')).toHaveLength(0);
    expect(screen.queryByTestId('reflection-style-stat-places')).toBeNull();
    expect(screen.queryByTestId('reflection-style-stat-dwell')).toBeNull();
    expect(screen.queryByTestId('reflection-style-evidence')).toBeNull();
  });
});
