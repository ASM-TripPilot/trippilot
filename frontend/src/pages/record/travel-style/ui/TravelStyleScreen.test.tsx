import { render, screen, within } from '@testing-library/react-native';

import type {
  StyleAnalysisBody,
  StyleProgress,
} from '@/shared/api/index.schemas';

import { TravelStyleScreen } from './TravelStyleScreen';

/**
 * TRIP-573 · j05 여행 스타일 화면 — VM 주입 순수 렌더 테스트.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-2 정식(BR-U5-42)**: `categoryBreakdown` 4행이 CategoryBarList(`reflection-style-bar`)로,
 *    라벨은 표시 매핑(맛집→미식·isOther→기타)·비율은 `N%`. StatTile 2개(하루 평균 방문·평균 체류).
 *  - 🔴 **AC-5(BR-U5-08a · INV-3 예외)**: 평균 체류 StatTile 이 `72분`을 표시하고, `avgDwellMinutes=null`
 *    이면 그 타일을 **degrade(미표시)** — 0 으로 안 채운다(다른 타일은 그대로).
 *  - 🔴 **AC-3 임시(BR-U5-40·US-REC-09)**: `현재 N곳 / 필요 10곳` + "정식 아님" 명시 + preview.descriptors 칩.
 *    정식 얼굴(막대·StatTile·Evidence)은 **안** 그린다(상호배타).
 *  - 🔴 **[[반쪽 방어]]**: official 인데 `categoryBreakdown` 이 null(계약위반)이어도 0막대·무크래시.
 *
 *  - 🔴 **TRIP-939 AC-5(심사 2.1)**: 지도 자리표시("지도 표시 예정")·범례·"평균 이동 반경" 캡션을 그리지
 *    않는다(Q7 — 새 표면을 발명하지 않는다).
 *  - 🔴 **TRIP-637 AC-1**: 근거 링크(`reflection-style-evidence`·"근거가 된 방문 데이터")는 **어떤 props 로도**
 *    생기지 않는다 — 목적지 라우트도 근거 방문 데이터 계약도 없어 컴포넌트·prop 째 걷었다. 옛 prop
 *    (`onPressEvidence`)을 흘려 넣어도 링크 0.
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
  it('AC-2: 카테고리 4행이 표시 라벨(맛집→미식·기타)·비율(N%)로 StatTile 2와 함께 그려지고, 근거 링크·지도 자리표시는 없다', () => {
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

    // StatTile 2개(하루 평균 방문 · 평균 체류).
    expect(
      screen.getByTestId('reflection-style-stat-places')
    ).toBeOnTheScreen();
    expect(screen.getByText(/4곳/)).toBeOnTheScreen();
    expect(screen.getByText('하루 평균 방문')).toBeOnTheScreen();
    // TRIP-637 AC-1 — 근거 링크가 없고, TRIP-939 AC-5 — 지도 자리표시·범례·반경 캡션도 없다.
    expect(screen.queryByTestId('reflection-style-evidence')).toBeNull();
    expect(screen.queryByTestId('reflection-style-map')).toBeNull();
    expect(screen.queryByText('지도 표시 예정')).toBeNull();
    expect(screen.queryByText(/점 = 방문 장소/)).toBeNull();
    expect(screen.queryByText(/평균 이동 반경/)).toBeNull();
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

describe('Figma 정합 — 체류 미측정·남은 곳 계산', () => {
  // TRIP-765 (옛 TravelStyleScreen.parity.test.tsx)
  /**
   * TRIP-765 · j05 여행 스타일 분석 Figma 정합 중 **동작**만 남긴 묶음.
   *
   *  - 🔴 AC-2 체류 미측정(null)이면 체류 타일을 그리지 않는다(0 으로 채우지 않는다).
   *  - 🔴 AC-6 값 인터폴레이션: 진행 바 아래 "{required-current}곳 더 필요" 가 리터럴이 아니라 계산값
   *    (두 픽스처 4곳/7곳 으로 잠근다).
   *  - 2톤 중첩 Text·헤딩 병합·탭바 존재는 생김새라 지웠다(README 판정 4 — 실화면 QA, 지도 record-style).
   *    `#` 접두는 아래 TRIP-1425 묶음이 같은 뮤테이션을 잡아 합쳤다(2026-11-01).
   */

  describe('🔴 TRIP-765 · AC-2 체류 미측정 degrade', () => {
    it('avgDwellMinutes=null 이면 체류 타일 degrade(미표시)·방문 타일은 남는다(무회귀)', () => {
      // Arrange — 체류 미측정.
      render(
        <TravelStyleScreen
          face="official"
          progress={{ current: 14, required: 10 }}
          analysis={officialBody({ avgDwellMinutes: null })}
          preview={null}
        />
      );

      // Assert — 체류 타일 소멸, 0 으로 안 채움(기존 degrade 무회귀).
      expect(screen.queryByTestId('reflection-style-stat-dwell')).toBeNull();
      expect(screen.queryByText(/0분/)).toBeNull();
      // Assert — 방문 타일은 살아 있다.
      expect(
        screen.getByTestId('reflection-style-stat-places')
      ).toBeOnTheScreen();
    });
  });

  describe('🔴 TRIP-765 · AC-6 진행 바 아래 행 값 인터폴레이션', () => {
    it('6/10 이면 "4곳 더 필요"(required-current)를 그린다', () => {
      // Arrange — 6/10, 잔여 4.
      render(
        <TravelStyleScreen
          face="insufficient"
          progress={{ current: 6, required: 10 }}
          analysis={null}
          preview={{ descriptors: ['느긋'] }}
        />
      );

      // Assert — 계산된 잔여 4.
      expect(screen.getByText(/4곳 더 필요/)).toBeOnTheScreen();
    });

    it('3/10 이면 "7곳 더 필요"로 바뀐다(리터럴이 아니라 계산값)', () => {
      // Arrange — 다른 픽스처 3/10, 잔여 7.
      render(
        <TravelStyleScreen
          face="insufficient"
          progress={{ current: 3, required: 10 }}
          analysis={null}
          preview={{ descriptors: ['느긋'] }}
        />
      );

      // Assert — 값이 따라 바뀐다(리터럴 "4곳 더 필요" 였다면 여기서 4곳이 남아 red).
      expect(screen.getByText(/7곳 더 필요/)).toBeOnTheScreen();
      expect(screen.queryByText(/4곳 더 필요/)).toBeNull();
    });
  });
});

describe('🔴 TRIP-1222 · 통계 타일 표기', () => {
  it('avgDwellMinutes=0(방문 시각 데이터 부족)이면 0분 타일을 그리지 않는다', () => {
    render(
      <TravelStyleScreen
        face="official"
        progress={{ current: 14, required: 10 }}
        analysis={officialBody({ avgDwellMinutes: 0 })}
        preview={null}
      />
    );
    expect(screen.queryByTestId('reflection-style-stat-dwell')).toBeNull();
    expect(
      screen.getByTestId('reflection-style-stat-places')
    ).toBeOnTheScreen();
  });

  it('하루 평균 방문 4.333…은 소수 1자리(4.3곳)로, 정수 4는 4곳 그대로', () => {
    const { rerender } = render(
      <TravelStyleScreen
        face="official"
        progress={{ current: 14, required: 10 }}
        analysis={officialBody({ avgPlacesPerDay: 4.333333 })}
        preview={null}
      />
    );
    expect(screen.getByText(/^4\.3곳$/)).toBeOnTheScreen();
    rerender(
      <TravelStyleScreen
        face="official"
        progress={{ current: 14, required: 10 }}
        analysis={officialBody({ avgPlacesPerDay: 4 })}
        preview={null}
      />
    );
    expect(screen.getByText(/^4곳$/)).toBeOnTheScreen();
  });
});

// TRIP-1425 · Q-130 — 서버가 descriptor 에 `#` 을 붙여 보내(openapi StylePreview 예시 '#바다') 칩이 "##미식"으로 보였다.
describe('TRIP-1425 · 칩의 # 은 한 번만 · 진행 문구 한 줄 삭제', () => {
  function renderInsufficient(descriptors: string[]) {
    render(
      <TravelStyleScreen
        face="insufficient"
        progress={{ current: 6, required: 10 }}
        analysis={null}
        preview={{ descriptors }}
      />
    );
  }

  it.each<[string, string]>([
    ['#미식', '#미식'],
    ['한식', '#한식'],
  ])(
    'descriptor %j 는 칩에 %j 로 보이고 ## 은 어디에도 없다 (AC-18)',
    (descriptor, shown) => {
      renderInsufficient([descriptor]);

      expect(screen.getByText(shown)).toBeOnTheScreen();
      expect(screen.queryByText(/##/)).toBeNull();
      expect(
        screen.getAllByTestId('reflection-style-preview-chip')
      ).toHaveLength(1);
    }
  );

  it('#가 붙은 것·안 붙은 것이 섞여 와도 칩마다 # 하나다 (AC-18 · AC-19)', () => {
    renderInsufficient(['#미식', '한식', '바다']);

    expect(screen.getByText('#미식')).toBeOnTheScreen();
    expect(screen.getByText('#한식')).toBeOnTheScreen();
    expect(screen.getByText('#바다')).toBeOnTheScreen();
    expect(screen.queryByText(/##/)).toBeNull();
    expect(screen.getAllByTestId('reflection-style-preview-chip')).toHaveLength(
      3
    );
  });

  it('"10곳을 채우면…" 줄만 없고, 진행 수치·게이지·"정식 아님"은 남는다 (AC-20 · BR-U5-40)', () => {
    renderInsufficient(['바다']);

    // 지운 줄.
    expect(screen.queryByText(/채우면/)).toBeNull();
    // 남는 세 요소 — 현재 N곳/필요 10곳 · 게이지 · 정식 아님(+ 잔여 행).
    const progress = screen.getByTestId('reflection-style-progress');
    expect(within(progress).getByText(/부족해요/)).toBeOnTheScreen();
    expect(within(progress).getByText(/현재 6곳/)).toBeOnTheScreen();
    expect(screen.getByText(/필요 10곳/)).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-style-progress-gauge')
    ).toBeOnTheScreen();
    expect(screen.getByText('아직 정식 분석이 아니에요')).toBeOnTheScreen();
    expect(screen.getByText(/4곳 더 필요/)).toBeOnTheScreen();
  });
});
