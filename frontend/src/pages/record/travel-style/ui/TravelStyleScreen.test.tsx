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

  it('TRIP-939 AC-5: 근거 목적지 미주입이면 링크도 "준비 중" 안내도 없다(막다른 링크 제거)', () => {
    // 준비·실행: 페이지의 현재 모양(onPressEvidence 미주입)으로 그린다.
    render(
      <TravelStyleScreen
        face="official"
        progress={PROGRESS_OFFICIAL}
        analysis={officialBody()}
        preview={null}
      />
    );

    // 단언: 누를 링크가 없으니 안내도 없다 + 짝 앵커(막대는 그대로).
    expect(screen.queryByTestId('reflection-style-evidence')).toBeNull();
    expect(screen.queryByText(/근거가 된 방문 데이터/)).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
    expect(screen.getAllByTestId('reflection-style-bar')).toHaveLength(4);
  });

  it('TRIP-637 AC-1: 옛 근거 목적지 prop 을 흘려 넣어도 근거 링크가 생기지 않는다(컴포넌트째 제거)', () => {
    // 준비: 삭제된 prop 을 담은 객체 — `as object` 전개라 prop 이 사라진 뒤에도 타입 검사를 통과한다(02a ★7).
    const legacyProps = { onPressEvidence: jest.fn() } as object;

    // 실행: 누군가 옛 배선을 되살린 모양으로 그린다.
    render(
      <TravelStyleScreen
        face="official"
        progress={PROGRESS_OFFICIAL}
        analysis={officialBody()}
        preview={null}
        {...legacyProps}
      />
    );

    // 단언: 링크·문구 0 + 짝 앵커(정식 얼굴 막대는 그대로 4개).
    expect(screen.queryByTestId('reflection-style-evidence')).toBeNull();
    expect(screen.queryByText(/근거가 된 방문 데이터/)).toBeNull();
    expect(screen.getAllByTestId('reflection-style-bar')).toHaveLength(4);
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

  it('TRIP-1076 AC-7(보류) · 임시 얼굴엔 "분석에 사용된 여행 N회 · 마지막 갱신" 부제가 없다 (선제 green)', () => {
    // 미달 envelope 에는 sampleTripCount·updatedAt 이 없다(StylePreview = descriptors 뿐) — 값을 지어내지
    // 않는다. BE 계약이 바뀌기 전까지 이 부제는 정식 얼굴 전용이다.
    render(
      <TravelStyleScreen
        face="insufficient"
        progress={PROGRESS_INSUFFICIENT}
        analysis={null}
        preview={{ descriptors: ['느긋'] }}
      />
    );

    // 짝 앵커 — 임시 얼굴이 실제로 그려졌다(진행 문구).
    expect(screen.getByTestId('reflection-style-progress')).toBeOnTheScreen();
    expect(screen.queryAllByText(/분석에 사용된 여행/)).toHaveLength(0);
  });
});

describe('Figma 정합 — 2톤 타일·헤딩 병합·남은 곳 계산·# 접두·탭바', () => {
  // TRIP-765 (옛 TravelStyleScreen.parity.test.tsx)
  /**
   * TRIP-765 · j05 여행 스타일 분석 Figma 정합 — 렌더 동작 심판.
   *
   * 위 TRIP-573 묶음(AC-2·3·5)은 무수정 green 으로 남는다(§F KEEP).
   * 이 묶음은 정합으로 새로 생기는 **동작**만 red 로 못박는다(크롬·색·픽셀은 소스 스캔/6-b 로 위임).
   *
   * 무엇을 보장하나:
   *  - 🔴 AC-2 2톤: StatTile 이 값·단위를 **중첩** `<Text>{value}<Text>{unit}</Text></Text>` 한 leaf 로
   *    그린다. `getByText(/72분/)` 는 flat·nested 둘 다 통과하므로(§5 A·B 실측) **단위가 별도 노드**인지를
   *    `within(타일).getByText('분')`(exact) 로 가른다 — nested 만 FOUND, flat 은 null.
   *  - 🔴 AC-5 병합: 헤딩+진행문구가 **한 노드**로 병합(testID reflection-style-progress). `within(진행노드)`
   *    로 "부족합니다"가 그 노드 안에 있는지를 잰다(현재는 형제라 within 밖 → null → red, §5 D·E 실측).
   *  - 🔴 AC-6 값 인터폴레이션: 진행 바 아래 "{required-current}곳 더 필요" 가 리터럴이 아니라 계산값
   *    (두 픽스처 4곳/7곳 으로 잠근다).
   *  - 🔴 AC-7 `#`접두: 미리보기 칩을 컴포넌트가 `#${descriptor}` 로 그린다(§5 F 실측).
   *  - 🔴 AC-8: 두 얼굴에 BottomTabBar(records 활성)를 얹는다.
   *
   * (개념) `within(node)` = 그 노드의 subtree(자기 포함)로 쿼리를 좁힌다. `getByText('분', {exact:true})`
   *   = 텍스트가 정확히 '분'인 노드만(부분포함은 정규식 `getByText(/분/)`). 중첩 Text 의 안쪽 Text 는
   *   별도 findable 노드라 exact 로 잡히고, `{value}{unit}` 한 덩어리는 안쪽 노드가 없어 안 잡힌다.
   */

  describe('🔴 TRIP-765 · AC-2 StatTile 2톤 중첩 Text', () => {
    it('평균 체류 타일이 72분을 한 leaf 로 그리되 단위 "분"이 별도 노드다(중첩=2톤)', () => {
      // Arrange — 정식 얼굴, dwell 72.
      render(
        <TravelStyleScreen
          face="official"
          progress={{ current: 14, required: 10 }}
          analysis={officialBody({ avgDwellMinutes: 72 })}
          preview={null}
        />
      );

      // Act — 렌더만.

      // Assert — 한 leaf(형제 분리면 /72분/ 이 null, §5 C).
      expect(screen.getByText(/72분/)).toBeOnTheScreen();
      // Assert — 단위 '분'이 타일 안 별도 노드(exact). flat `{value}{unit}` 면 이 노드가 없어 red(§5 A·B).
      const dwellTile = screen.getByTestId('reflection-style-stat-dwell');
      expect(within(dwellTile).getByText('분')).toBeOnTheScreen();
      // Assert — 방문 타일도 같은 2톤(단위 '곳' 별도 노드).
      const placesTile = screen.getByTestId('reflection-style-stat-places');
      expect(within(placesTile).getByText('곳')).toBeOnTheScreen();
    });

    it('avgDwellMinutes=null 이면 체류 타일 degrade(미표시)·방문 타일은 2톤 유지(무회귀)', () => {
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
      // Assert — 방문 타일은 살아있고 2톤(단위 '곳' 별도 노드).
      const placesTile = screen.getByTestId('reflection-style-stat-places');
      expect(within(placesTile).getByText('곳')).toBeOnTheScreen();
    });
  });

  describe('🔴 TRIP-765 · AC-5 insufficient 헤딩 병합', () => {
    it('헤딩+진행문구가 한 노드로 병합돼 진행 testID 안에 "부족합니다"가 있다', () => {
      // Arrange — 임시 얼굴, 3/10.
      render(
        <TravelStyleScreen
          face="insufficient"
          progress={{ current: 3, required: 10 }}
          analysis={null}
          preview={{ descriptors: ['느긋'] }}
        />
      );

      // Act — 진행 노드로 스코프를 좁힌다.
      const progress = screen.getByTestId('reflection-style-progress');

      // Assert — 병합돼 같은 노드 안에 헤딩·진행이 함께 있다(현재는 헤딩이 형제라 within 밖 → red, §5 D·E).
      expect(within(progress).getByText(/부족합니다/)).toBeOnTheScreen();
      expect(within(progress).getByText(/현재 3곳/)).toBeOnTheScreen();
      // Assert — 필요 수치도 전역에서 findable(무회귀).
      expect(screen.getByText(/필요 10곳/)).toBeOnTheScreen();
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

  describe('🔴 TRIP-765 · AC-7 미리보기 칩 # 접두', () => {
    it('컴포넌트가 descriptor 앞에 #을 붙여 그린다(#바다·#미식·#느긋)', () => {
      // Arrange — 접두 없는 짧은형 descriptor 3개.
      render(
        <TravelStyleScreen
          face="insufficient"
          progress={{ current: 3, required: 10 }}
          analysis={null}
          preview={{ descriptors: ['바다', '미식', '느긋'] }}
        />
      );

      // Assert — 렌더 텍스트에 #이 붙는다(현재는 as-is 라 "#바다" 노드 없음 → red, §5 F).
      expect(screen.getByText('#바다')).toBeOnTheScreen();
      expect(screen.getByText('#미식')).toBeOnTheScreen();
      expect(screen.getByText('#느긋')).toBeOnTheScreen();
      // Assert — 칩 testID 는 3개 그대로(존재 자체는 기존 AC-3 가 잠금).
      expect(
        screen.getAllByTestId('reflection-style-preview-chip')
      ).toHaveLength(3);
    });
  });

  describe('🔴 TRIP-765 · AC-8 BottomTabBar(records 활성) 두 얼굴', () => {
    it('정식 얼굴에 기록 탭 활성 바텀탭바가 있다', () => {
      // Arrange — 정식.
      render(
        <TravelStyleScreen
          face="official"
          progress={{ current: 14, required: 10 }}
          analysis={officialBody()}
          preview={null}
        />
      );

      // Assert — 탭바 루트 + 기록 활성 아이콘(현재 미렌더 → red).
      expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
      expect(
        screen.getByTestId('shell-tabbar-icon-records-active')
      ).toBeOnTheScreen();
    });

    it('임시 얼굴에도 같은 바텀탭바가 있다', () => {
      // Arrange — 임시.
      render(
        <TravelStyleScreen
          face="insufficient"
          progress={{ current: 3, required: 10 }}
          analysis={null}
          preview={{ descriptors: ['느긋'] }}
        />
      );

      // Assert — 두 얼굴 공통(현재 미렌더 → red).
      expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
      expect(
        screen.getByTestId('shell-tabbar-icon-records-active')
      ).toBeOnTheScreen();
    });
  });
});
