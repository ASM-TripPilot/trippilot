import { render, screen, within } from '@testing-library/react-native';

import type { StyleAnalysisBody } from '@/shared/api/generated/schemas';

import { TravelStyleScreen } from './TravelStyleScreen';

/**
 * TRIP-765 · j05 여행 스타일 분석 Figma 정합 — 렌더 동작 심판.
 *
 * 기존 `TravelStyleScreen.test.tsx`(TRIP-573 AC-2·3·5)는 무수정 green 으로 남는다(§F KEEP).
 * 이 파일은 정합으로 새로 생기는 **동작**만 red 로 못박는다(크롬·색·픽셀은 소스 스캔/6-b 로 위임).
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

/** 정식 본문 — dwell 은 숫자 prop(소스 리터럴 아님, INV-3). 기존 test 픽스처 미러. */
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
    expect(screen.getAllByTestId('reflection-style-preview-chip')).toHaveLength(
      3
    );
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
