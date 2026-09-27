import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import { RegionPickerScreen } from './RegionPickerScreen';
import type {
  RegionPickerScreenProps,
  RegionPurpose,
} from './RegionPickerScreen';

/**
 * TRIP-1023 칸 B #007 · 지역 선택(d03 여행지 선택 · e00 숙소 지역 선택) 검색 결과 표면(결정3 · Seed Q8).
 *
 * 무엇을 보장하나:
 *  · 검색어가 있으면 목록 섹션 제목이 "검색 결과"다 — 드릴다운 목록의 "지역별 둘러보기"를 그대로 두면
 *    사용자가 검색 중인지 모른다(QA #007). 검색어가 비면(1단·2단) 제목은 그대로다.
 *  · 검색 결과 카드 중 **시군구**에는 계약의 상위 시도명(`Region.sidoName`)이 부제로 붙는다 — "중구"
 *    "동구" 같은 동명 시군구를 구분하는 유일한 단서다. 카드 세 갈래(선택 카드 · "추천 장소 없음" ·
 *    선택 불가 묶음 행) 모두 해당한다(Q8).
 *  · 시도 행에는 같은 이름을 한 번 더 붙이지 않고, 2단 드릴다운 카드와 인기 스트립에도 붙이지 않는다
 *    (이미 시도 제목 아래라 중복 — AC-B4).
 *
 * ★ 기댓값은 픽스처가 준 `sidoName` 을 그대로 쓴다(`CHUNCHEON.sidoName`) — 계약 예시 문자열을 손으로
 *   적으면 픽스처와 어긋난다(브리프 §4 테스트 주의).
 * ★ 카드 안 단언은 `within(card)` 로 좁힌다. 2단 드릴다운은 "{시도} 전체" 제목이, 인기 스트립은 시도
 *   이름이 카드 밖에도 있어 전역 `getByText` 는 오탐한다.
 * ★ `getByText(문자열)` 은 **완전일치**다 — `getByText('검색 결과')` 는 빈 결과 문구 "검색 결과가 없어요"
 *   에 걸리지 않는다(실검증). 부제 Text 노드에는 시도명만 담는다.
 */

function region(
  over: Partial<Region> & Pick<Region, 'regionCode' | 'name'>
): Region {
  return {
    sidoName: over.sidoName ?? '',
    level: over.level ?? RegionLevel.SIGUNGU,
    selectable: over.selectable ?? true,
    poiCount: over.poiCount ?? 3,
    ...over,
  };
}

const INCHEON = region({
  regionCode: '28',
  name: '인천광역시',
  level: RegionLevel.SIDO,
  sidoName: '인천광역시',
  poiCount: 50,
});
const MICHUHOL = region({
  regionCode: '28177',
  name: '미추홀구',
  sidoName: '인천광역시',
  poiCount: 8,
});
const GANGWON = region({
  regionCode: '51',
  name: '강원특별자치도',
  level: RegionLevel.SIDO,
  sidoName: '강원특별자치도',
  selectable: false,
  poiCount: 30,
});
const CHUNCHEON = region({
  regionCode: '51110',
  name: '춘천시',
  sidoName: '강원특별자치도',
  poiCount: 12,
});
/** 후보풀 빔 → "추천 장소 없음" 카드(선택 불가 갈래 ①). */
const HONGCHEON = region({
  regionCode: '51720',
  name: '홍천군',
  sidoName: '강원특별자치도',
  poiCount: 0,
});
/** 일반시의 행정구 — 시군구지만 목적지가 아니다(선택 불가 묶음 행 갈래 ②, Q8). */
const JANGAN = region({
  regionCode: '41111',
  name: '수원시 장안구',
  sidoName: '경기도',
  selectable: false,
  poiCount: 20,
});
/** 동명 시군구 — 부제 없이는 두 카드가 똑같이 "중구"로만 보인다(#007 의 핵심). */
const SEOUL_JUNG = region({
  regionCode: '11140',
  name: '중구',
  sidoName: '서울특별시',
});
const BUSAN_JUNG = region({
  regionCode: '26110',
  name: '중구',
  sidoName: '부산광역시',
});

function props(
  over: Partial<RegionPickerScreenProps> = {}
): RegionPickerScreenProps {
  return {
    purpose: 'trip',
    query: '',
    regions: [INCHEON, MICHUHOL, GANGWON, CHUNCHEON, HONGCHEON],
    isLoading: false,
    isError: false,
    onChangeQuery: jest.fn(),
    onSelectRegion: jest.fn(),
    onRetry: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

const PURPOSES: RegionPurpose[] = ['trip', 'stay'];

describe('🔴 1023-B #007 · 검색어가 있으면 섹션 제목이 "검색 결과" 다 (AC-B1 · BR-U1-07 두 목적 공통)', () => {
  it.each(PURPOSES)(
    'purpose=%s — 결과가 있을 때 "검색 결과" 이고 "지역별 둘러보기" 는 없다',
    (purpose) => {
      render(
        <RegionPickerScreen
          {...props({ purpose, query: '춘천', regions: [CHUNCHEON] })}
        />
      );

      // 앵커 — 검색 결과 카드가 실제로 그려졌다.
      expect(screen.getByTestId('explore-region-51110')).toBeOnTheScreen();
      expect(screen.getByText('검색 결과')).toBeOnTheScreen();
      expect(screen.queryByText('지역별 둘러보기')).toBeNull();
    }
  );

  it('결과가 0건이어도 검색 중이므로 제목은 "검색 결과" 이고, 빈 결과 문구가 함께 뜬다', () => {
    render(<RegionPickerScreen {...props({ query: '없는곳', regions: [] })} />);

    expect(screen.getByText('검색 결과가 없어요')).toBeOnTheScreen();
    expect(screen.getByText('검색 결과')).toBeOnTheScreen();
    expect(screen.queryByText('지역별 둘러보기')).toBeNull();
  });
});

describe('1023-B #007 · 검색어가 비면 제목은 그대로 "지역별 둘러보기" 다 (AC-B2 · 선제 green 회귀 앵커)', () => {
  it.each([
    ['빈 문자열', ''],
    ['공백뿐(드릴다운과 같은 trim 판정)', '   '],
  ])('%s — 1단 시/도 목록 위 제목이 "지역별 둘러보기" 다', (_label, query) => {
    render(<RegionPickerScreen {...props({ query })} />);

    // 앵커 — 1단(시/도 행)이 그려졌다. 공백 검색어를 검색으로 치면 이 행이 사라지고 제목도 갈린다.
    expect(screen.getByTestId('explore-region-sido-28')).toBeOnTheScreen();
    expect(screen.getByText('지역별 둘러보기')).toBeOnTheScreen();
    expect(screen.queryByText('검색 결과')).toBeNull();
  });

  it('2단 드릴다운 안에서도 제목이 "지역별 둘러보기" 다', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);

    fireEvent.press(screen.getByTestId('explore-region-sido-51'));

    expect(
      screen.getByTestId('explore-region-drilldown-back')
    ).toBeOnTheScreen();
    expect(screen.getByText('지역별 둘러보기')).toBeOnTheScreen();
    expect(screen.queryByText('검색 결과')).toBeNull();
  });
});

describe('🔴 1023-B #007 · 검색 결과의 시군구 카드에 상위 시도명이 부제로 붙는다 (AC-B3 · Seed Q8)', () => {
  it.each([
    { kind: '선택 카드(poiCount>0)', target: CHUNCHEON, query: '춘천' },
    {
      kind: '"추천 장소 없음" 카드(poiCount=0)',
      target: HONGCHEON,
      query: '홍천',
    },
    { kind: '선택 불가 묶음 행(행정구)', target: JANGAN, query: '장안' },
  ])('$kind 에 sidoName 이 보인다', ({ target, query }) => {
    render(<RegionPickerScreen {...props({ query, regions: [target] })} />);

    const card = screen.getByTestId(`explore-region-${target.regionCode}`);
    // 앵커 — 그 카드의 이름이 카드 안에 있다(부제만 있고 이름이 사라진 구현을 막는다).
    expect(within(card).getByText(target.name)).toBeOnTheScreen();
    expect(within(card).getByText(target.sidoName)).toBeOnTheScreen();
  });

  it('동명 시군구 두 "중구" 카드가 각자 자기 시도명을 단다 — 상수 부제가 아니다', () => {
    render(
      <RegionPickerScreen
        {...props({ query: '중구', regions: [SEOUL_JUNG, BUSAN_JUNG] })}
      />
    );

    const seoul = screen.getByTestId('explore-region-11140');
    const busan = screen.getByTestId('explore-region-26110');
    expect(within(seoul).getByText(SEOUL_JUNG.sidoName)).toBeOnTheScreen();
    expect(within(seoul).queryByText(BUSAN_JUNG.sidoName)).toBeNull();
    expect(within(busan).getByText(BUSAN_JUNG.sidoName)).toBeOnTheScreen();
    expect(within(busan).queryByText(SEOUL_JUNG.sidoName)).toBeNull();
  });

  it('부제가 붙어도 선택 카드 press 는 그 Region 객체를 그대로 올린다 (배선 무회귀)', () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionPickerScreen
        {...props({ query: '춘천', regions: [CHUNCHEON], onSelectRegion })}
      />
    );

    fireEvent.press(screen.getByTestId('explore-region-51110'));

    expect(onSelectRegion).toHaveBeenCalledWith(CHUNCHEON);
  });
});

describe('1023-B #007 · 부제를 붙이지 않는 자리 (AC-B4 · 선제 green 회귀 앵커)', () => {
  it('검색 결과의 시도 행은 이름과 같은 시도명을 한 번 더 붙이지 않는다', () => {
    render(
      <RegionPickerScreen
        {...props({ query: '인천', regions: [INCHEON, MICHUHOL] })}
      />
    );

    // 대조 앵커 — 같은 화면의 시군구 카드엔 부제가 붙었다(부제 기능이 켜진 화면에서의 부재여야 의미가 있다).
    expect(
      within(screen.getByTestId('explore-region-28177')).getByText(
        MICHUHOL.sidoName
      )
    ).toBeOnTheScreen();
    // 시도 행 — "인천광역시" 가 카드 안에 정확히 한 번(이름)만 있다.
    expect(
      within(screen.getByTestId('explore-region-28')).getAllByText(
        INCHEON.sidoName
      )
    ).toHaveLength(1);
  });

  it('2단 드릴다운의 시군구 카드에는 부제가 없다 (이미 "{시도} 전체" 제목 아래)', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);

    fireEvent.press(screen.getByTestId('explore-region-sido-51'));

    const card = screen.getByTestId('explore-region-51110');
    // 앵커 — 드릴인한 카드가 그려졌다.
    expect(within(card).getByText(CHUNCHEON.name)).toBeOnTheScreen();
    expect(within(card).queryByText(CHUNCHEON.sidoName)).toBeNull();
    // '전체' 자리(강원 SIDO 묶음 행)도 이름 한 번뿐이다.
    expect(
      within(screen.getByTestId('explore-region-51')).getAllByText(
        GANGWON.sidoName
      )
    ).toHaveLength(1);
  });

  it('인기 스트립 카드에는 부제가 없다 — 시도명이 카드에 한 번뿐이다', () => {
    render(<RegionPickerScreen {...props({ query: '' })} />);

    const popular = screen.getByTestId('explore-region-popular-28');
    expect(within(popular).getAllByText(INCHEON.sidoName)).toHaveLength(1);
  });
});
