import fs from 'fs';
import path from 'path';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { SlotCandidateSheet } from './SlotCandidateSheet';

/**
 * h08 "다른 후보 시트" — 순수 바텀시트(props + 콜백만, TRIP-793).
 *
 * git mv 재작성: 옛 인라인 패널(`SlotCandidatePanel`, 즉시확정 1단계)을 `@gorhom/bottom-sheet`
 * 바텀시트(scrim + 핸들)로 되돌리고, 후보 행을 사진56 + 이름 + `#태그 · 태그 · 거리` 로 재설계하고,
 * 선택을 **라디오 2단계**(행 press → controlled `selectedPoiId` / "교체하기" press → 확정)로 바꾼다.
 * h18 전체화면(`OptionSwapScreen`)도 이 시트로 합쳐 삭제된다.
 *
 * 무엇을 보장하나:
 *  - 헤더 제목 `{현재 장소명} 대신` + 부제 `{HH:mm}–{HH:mm} · {컨셉} 슬롯의 다른 후보 · 동선은 …`.
 *  - 후보 행: 사진·이름·`#태그 · 태그`·거리 — 배지·추천이유(rationale) leaf·"이동" 라벨은 **없다**.
 *  - 현재 행: 회색 "현재" 칩, 라디오 없음(탭 불가 · BR-U3-24).
 *  - 라디오 2단계: 행 press → onSelectRadio(제어 상태만) / 선택 전 CTA 비활성·무발화 / 선택 후 1회 확정.
 *  - 0건: ◇ 아이콘 + 2줄 문구 + CTA "장소 검색"(h13). "장소 검색 ›" 링크도 h13.
 *  - INV-3: 소요시간 문자열 0(거리만).
 *
 * ★ 바텀시트 목 사각(02a ★3): `@gorhom/bottom-sheet` 목은 통과형이라 scrim 실 딤·시트 실 열림/닫힘은
 *   원리적으로 못 본다. 여기 심판은 **scrim testID 존재·헤더/행 렌더·라디오 상태·scrim onClose 콜백**까지.
 * ★ RNTL STRING 매처=완전일치, /정규식/=부분포함(node_modules 실측 · planb SlotCandidateSheet.test.tsx
 *   선례 · GenerationFallbackScreen.test.tsx S0). leaf 값은 EXACT, 조립 부제·태그는 REGEX.
 *
 * 3동작 뼈대: 준비=props → 실행=렌더/press → 단언=보이는 것·콜백.
 */

/** 현재 장소 행(회색 "현재" 칩, 탭 불가). Figma 값. */
const CURRENT = {
  poiId: 'cur',
  nameKo: '부산시립미술관',
  tags: ['미술', '실내'],
  distanceRange: '560m',
};

/** 후보 2행(선택 후보 p2 · 미선택 p3). 이름·태그는 픽스처(BE 후속), 거리는 응답값. */
const CANDIDATES = [
  {
    poiId: 'p2',
    nameKo: 'F1963 복합문화공간',
    tags: ['카페', '갤러리'],
    distanceRange: '1.1km',
  },
  {
    poiId: 'p3',
    nameKo: '부산근대역사관',
    tags: ['지역', '무료'],
    distanceRange: '1.8km',
  },
];

/** 후보 카드 **루트**만 잡는 셀렉터 — 하위·특수 testID 는 부정 룩어헤드로 제외(개명·재설계 반영). */
const CANDIDATE_ROOT =
  /^itinerary-candidate-(?!sheet|scrim|current|empty|error|place-search|confirm|name-|image-|distance-|tags-|radio-|check-)/;

const renderedCandidatePoiIds = () =>
  screen
    .getAllByTestId(CANDIDATE_ROOT)
    .map((node) =>
      String(node.props.testID).replace('itinerary-candidate-', '')
    );

function renderSheet(
  overrides: Partial<Parameters<typeof SlotCandidateSheet>[0]> = {}
) {
  return render(
    <SlotCandidateSheet
      current={CURRENT}
      candidates={CANDIDATES}
      startAt="13:00:00"
      endAt="14:30:00"
      category="전시"
      selectedPoiId={null}
      onSelectRadio={jest.fn()}
      onConfirm={jest.fn()}
      isPending={false}
      onPressPlaceSearch={jest.fn()}
      onClose={jest.fn()}
      {...overrides}
    />
  );
}

describe('🔴 SlotCandidateSheet — 헤더(AC-1·5·V1)', () => {
  it('S1 · 제목은 `{현재 장소명} 대신`, 부제는 시각·컨셉·안내(en-dash·중점 원문)', () => {
    renderSheet();

    // leaf 값 하나라 STRING EXACT.
    expect(
      screen.getByTestId('itinerary-candidate-sheet-title')
    ).toHaveTextContent('부산시립미술관 대신');

    // 조립 부제라 /정규식/ 부분포함 — en-dash `–`(U+2013)·중점 `·`(U+00B7) 원문을 잠근다(하이픈이면 red).
    expect(
      screen.getByTestId('itinerary-candidate-sheet-subtitle')
    ).toHaveTextContent(
      /13:00–14:30 · 전시 슬롯의 다른 후보 · 동선은 자동으로 다시 계산돼요/
    );
  });

  it('S1b · category 부재면 컨셉 세그 생략(정직 degrade)', () => {
    renderSheet({ category: undefined });

    const subtitle = screen.getByTestId('itinerary-candidate-sheet-subtitle');
    expect(subtitle).toHaveTextContent(/13:00–14:30/);
    expect(subtitle).toHaveTextContent(/다른 후보/);
    expect(subtitle).toHaveTextContent(/동선은 자동으로 다시 계산돼요/);
    // 컨셉 세그가 빠진다 — 값이 없으므로 지어내지 않는다.
    expect(subtitle).not.toHaveTextContent('전시');
  });
});

describe('🔴 SlotCandidateSheet — 후보 행 재설계(AC-2)', () => {
  it('S2 · 사진·이름·`#태그 · 태그`·거리 — 배지·추천이유·"이동" 라벨은 없다', () => {
    renderSheet();

    // 선택 후보 p2 로 전 요소를 확인한다.
    expect(screen.getByTestId('itinerary-candidate-name-p2')).toHaveTextContent(
      'F1963 복합문화공간'
    );
    expect(
      screen.getByTestId('itinerary-candidate-image-p2')
    ).toBeOnTheScreen();
    // 태그줄은 조립이라 REGEX — 첫 태그만 `#`(둘째 태그 앞엔 `#` 없음).
    expect(screen.getByTestId('itinerary-candidate-tags-p2')).toHaveTextContent(
      /#카페 · 갤러리/
    );
    expect(
      screen.getByTestId('itinerary-candidate-tags-p2')
    ).not.toHaveTextContent(/#갤러리/);
    // 거리 leaf 값 하나라 EXACT.
    expect(
      screen.getByTestId('itinerary-candidate-distance-p2')
    ).toHaveTextContent('1.1km');

    // 재설계로 버린 것: 추천이유 leaf 부재(부정 짝) + "이동" 라벨 부재.
    expect(screen.queryByTestId('itinerary-candidate-rationale-p2')).toBeNull();
    expect(screen.queryByText(/이동/)).toBeNull();
  });

  it('S3 · AC-2·INV-1 — 렌더 후보 집합 = 응답 poiId 집합(현재는 후보 루트 아님)', () => {
    renderSheet();

    expect(renderedCandidatePoiIds().sort()).toEqual(['p2', 'p3'].sort());
    // 현재 행은 후보 루트 정규식에서 제외되므로 집합에 안 들어온다.
    expect(renderedCandidatePoiIds()).not.toContain('cur');
  });

  it('S4 · INV-3 — 시트 전체에 소요시간 문자열 0(거리만)', () => {
    renderSheet();

    // 시트 루트 아래 어떤 텍스트에도 `N분`/`N시간`/`소요`가 없다(HH:mm 은 숫자 뒤가 `:`라 안 걸림).
    const sheet = within(screen.getByTestId('itinerary-candidate-sheet'));
    expect(sheet.queryByText(/\d+\s*(분|시간)|소요/)).toBeNull();
  });
});

describe('🔴 SlotCandidateSheet — 현재 행·현재 칩(AC-3)', () => {
  it('S5 · 현재 행은 "현재" 칩·탭 불가(라디오 없음)', () => {
    renderSheet();

    const current = screen.getByTestId('itinerary-candidate-current');
    expect(current).toHaveTextContent(/부산시립미술관/);
    expect(current).toHaveTextContent(/현재/);

    // 현재 슬롯은 후보 집합에서 빠지고(BR-U3-24) 라디오가 없다.
    expect(screen.queryByTestId('itinerary-candidate-radio-cur')).toBeNull();
    expect(renderedCandidatePoiIds()).not.toContain('cur');
  });
});

describe('🔴 SlotCandidateSheet — 라디오 2단계(AC-4·5)', () => {
  it('S6 · 행 press → 그 poiId 로 onSelectRadio, PUT 자리는 안 건드린다', () => {
    const onSelectRadio = jest.fn();
    renderSheet({ onSelectRadio });

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-p2'));

    expect(onSelectRadio).toHaveBeenCalledTimes(1);
    expect(onSelectRadio).toHaveBeenCalledWith('p2');
  });

  it('S7 · 선택 행 = ✓·selected, 미선택 행은 표식 없음', () => {
    renderSheet({ selectedPoiId: 'p2' });

    // 선택은 색·fill 이 아니라 접근성 상태로 관찰(글리프 fill 함정 회피).
    expect(
      screen.getByTestId('itinerary-candidate-radio-p2').props
        .accessibilityState.selected
    ).toBe(true);
    expect(
      screen.getByTestId('itinerary-candidate-check-p2')
    ).toBeOnTheScreen();

    expect(
      screen.getByTestId('itinerary-candidate-radio-p3').props
        .accessibilityState.selected
    ).not.toBe(true);
    expect(screen.queryByTestId('itinerary-candidate-check-p3')).toBeNull();
  });

  it('S8 · 선택 전 CTA 는 "교체하기" 고정·비활성·무발화', () => {
    const onConfirm = jest.fn();
    renderSheet({ selectedPoiId: null, onConfirm });

    const cta = screen.getByTestId('itinerary-candidate-confirm');
    // 배지 조립(`${badge}로 교체`) 제거 — 라벨은 항상 "교체하기".
    expect(cta).toHaveTextContent('교체하기');

    fireEvent.press(cta);
    expect(cta.props.accessibilityState.disabled).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(0);
  });

  it('S9 · 선택 후 CTA 활성, 한 번 누르면 onConfirm 1회', () => {
    const onConfirm = jest.fn();
    renderSheet({ selectedPoiId: 'p2', isPending: false, onConfirm });

    const cta = screen.getByTestId('itinerary-candidate-confirm');
    expect(cta.props.accessibilityState.disabled).not.toBe(true);

    fireEvent.press(cta);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('S10 · pending 중엔 선택돼 있어도 CTA 비활성 + "바꾸는 중이에요"', () => {
    const onConfirm = jest.fn();
    renderSheet({ selectedPoiId: 'p2', isPending: true, onConfirm });

    const cta = screen.getByTestId('itinerary-candidate-confirm');
    fireEvent.press(cta);
    fireEvent.press(cta);

    expect(cta.props.accessibilityState.disabled).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(0);
    expect(screen.queryByText(/바꾸는 중/)).not.toBeNull();
  });
});

describe('🔴 SlotCandidateSheet — 링크·오류·0건(AC-6·7·8)', () => {
  it('S11 · AC-8 — "장소 검색 ›" 링크 press → onPressPlaceSearch', () => {
    const onPressPlaceSearch = jest.fn();
    renderSheet({ onPressPlaceSearch });

    fireEvent.press(screen.getByTestId('itinerary-candidate-place-search'));

    expect(onPressPlaceSearch).toHaveBeenCalledTimes(1);
  });

  it('S12 · AC-6 — errorMessage 는 인라인으로 뜨고 시트는 안 닫힌다', () => {
    const onClose = jest.fn();
    renderSheet({
      errorMessage: '확정된 일정이라 지금은 바꿀 수 없어요',
      onClose,
    });

    expect(screen.getByTestId('itinerary-candidate-error')).toHaveTextContent(
      /확정된 일정/
    );
    expect(screen.getByTestId('itinerary-candidate-sheet')).toBeOnTheScreen();
    expect(onClose).toHaveBeenCalledTimes(0);
  });

  it('S13 · AC-7 — 0건: ◇ 아이콘 + 문구 2줄 + CTA "장소 검색"(교체하기 없음)', () => {
    const onPressPlaceSearch = jest.fn();
    renderSheet({ candidates: [], onPressPlaceSearch });

    // ◇ DiamondGlyph — testID 존재만(SVG fill·모양은 glyph 스캔 제외 관례라 jest 사각).
    expect(
      screen.getByTestId('itinerary-candidate-empty-icon')
    ).toBeOnTheScreen();

    const empty = screen.getByTestId('itinerary-candidate-empty');
    expect(empty).toHaveTextContent(/이 슬롯에 맞는 다른 후보가 없어요/);
    expect(empty).toHaveTextContent(/다른 곳을 직접 검색해 보세요/);

    // 0건엔 "교체하기"가 없고 후보 행도 0.
    expect(screen.queryByTestId('itinerary-candidate-confirm')).toBeNull();
    expect(screen.queryAllByTestId(CANDIDATE_ROOT)).toEqual([]);

    fireEvent.press(screen.getByTestId('itinerary-candidate-empty-search'));
    expect(onPressPlaceSearch).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 SlotCandidateSheet — scrim·바텀시트 복귀(AC-1·D3)', () => {
  it('S14 · scrim 이 있고 press 하면 onClose 가 나간다(실 딤은 jest 사각)', () => {
    const onClose = jest.fn();
    renderSheet({ onClose });

    // scrim 존재는 심판(구조), 실제 화면 덮음·터치 차단은 6-b 실기 몫.
    fireEvent.press(screen.getByTestId('itinerary-candidate-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('S15 · git mv 부재 확정 + 시트가 바텀시트로 복귀했다(소스 스캔)', () => {
    const resolve = (rel: string) => path.resolve(rel);

    // 부재 — 개명·삭제된 옛 파일들(green 단계에서 implementer 가 git rm/mv).
    expect(
      fs.existsSync(resolve('src/features/itinerary/ui/SlotCandidatePanel.tsx'))
    ).toBe(false);
    expect(
      fs.existsSync(resolve('src/features/itinerary/ui/OptionSwapScreen.tsx'))
    ).toBe(false);
    expect(
      fs.existsSync(
        resolve('src/pages/itinerary-option-swap/ui/OptionSwapPage.tsx')
      )
    ).toBe(false);

    // 반전 앵커 — 이 시트는 바텀시트를 **다시** 문다(옛 인라인 패널의 "import 0" 단언을 뒤집는다).
    const source = fs.readFileSync(
      resolve('src/pages/itinerary/itinerary-draft/ui/SlotCandidateSheet.tsx'),
      'utf8'
    );
    expect(source).toContain('@gorhom/bottom-sheet');
    // 긍정 짝 — 파일을 실제로 읽었고 시트 루트를 그린다(공허 통과 방지).
    expect(source).toContain('itinerary-candidate-sheet');
  });
});

/**
 * TRIP-1109 — 후보 조회 상태 얼굴(loading·slow·error). 시트는 시간을 모른다: 컨테이너가 정한
 * `fetchState` 를 **정적 prop** 으로 받아 그린다(프리뷰가 slow 를 정적으로 캡처할 수 있어야 한다).
 * 생략하면 'ready'(응답 도착)라 위 S1~S15 는 그대로다.
 *
 * ★ 후보 행 개수는 `-radio-` 로 센다 — 위 CANDIDATE_ROOT 는 새 `loading`·`skeleton-row` 도 후보로
 *   세므로(넓은 그물로 남겨 둔다) 로딩 중 "후보 0행" 단언에는 못 쓴다(02a ★10).
 */
const EMPTY_TITLE = '이 슬롯에 맞는 다른 후보가 없어요';
const FETCH_FALLBACK = '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요';
const RADIO_ROWS = /^itinerary-candidate-radio-/;
const RAW_HEX = /#[0-9a-fA-F]{3,8}/;

type SheetProps = Parameters<typeof SlotCandidateSheet>[0];

/** 루트 아래(자신 포함) className 문자열을 모두 모은다 — V1 raw hex 스캔 재료. */
function classNamesUnder(testID: string): string[] {
  return screen
    .getByTestId(testID)
    .findAll((node) => typeof node.props.className === 'string')
    .map((node) => String(node.props.className));
}

describe('🔴 SlotCandidateSheet — 조회 상태 얼굴(TRIP-1109 · L1·L2·T2·E1)', () => {
  it('S16 · loading — 스켈레톤 3줄·현재 행·비활성 교체하기, 0건 얼굴은 없다(INV-4)', () => {
    renderSheet({ fetchState: 'loading', candidates: [] });

    const loading = screen.getByTestId('itinerary-candidate-loading');
    expect(
      within(loading).getAllByTestId('itinerary-candidate-skeleton-row')
    ).toHaveLength(3);

    // 도착 전에 0건을 단정하지 않는다.
    expect(screen.queryByTestId('itinerary-candidate-empty')).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-empty-search')).toBeNull();
    expect(screen.queryAllByTestId(RADIO_ROWS)).toHaveLength(0);

    // 이미 손에 있는 것(헤더·현재 행)은 그린다. 교체하기는 있되 눌리지 않는다.
    expect(
      screen.getByTestId('itinerary-candidate-sheet-title')
    ).toHaveTextContent('부산시립미술관 대신');
    expect(screen.getByTestId('itinerary-candidate-current')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-candidate-place-search')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-candidate-confirm').props.accessibilityState
        .disabled
    ).toBe(true);

    // 아직 10초 전이고 실패도 아니다.
    expect(screen.queryByTestId('itinerary-candidate-slow')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-fetch-retry')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-fetch-error')).toBeNull();
  });

  it('S17 · slow — 로딩 얼굴 **안에** 안내 줄 + [다시 시도], 누르면 onRetryFetch 1회', () => {
    const onRetryFetch = jest.fn();
    renderSheet({ fetchState: 'slow', candidates: [], onRetryFetch });

    expect(screen.getByTestId('itinerary-candidate-slow')).toHaveTextContent(
      /시간이 걸리고 있어요/
    );
    // slow 는 별도 얼굴이 아니라 로딩에 겹친다 — 스켈레톤은 계속 보인다.
    expect(screen.getByTestId('itinerary-candidate-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-candidate-empty')).toBeNull();
    expect(
      screen.getByTestId('itinerary-candidate-confirm').props.accessibilityState
        .disabled
    ).toBe(true);

    const retry = screen.getByTestId('itinerary-candidate-fetch-retry');
    expect(retry).toHaveTextContent(/다시 시도/);
    fireEvent.press(retry);
    expect(onRetryFetch).toHaveBeenCalledTimes(1);
  });

  it('S18 · error — 점선 카드(경고 글리프 + 문구 그대로) + 하단 [다시 시도], 교체하기·0건은 없다', () => {
    const onRetryFetch = jest.fn();
    renderSheet({
      fetchState: 'error',
      fetchErrorMessage: FETCH_FALLBACK,
      candidates: [],
      onRetryFetch,
    });

    const card = screen.getByTestId('itinerary-candidate-fetch-error');
    // 문구는 받은 그대로 한 칸(완전 일치) — 잘라 붙이거나 바꾸면 red.
    expect(within(card).getByText(FETCH_FALLBACK)).toBeOnTheScreen();
    expect(
      within(card).getByTestId('itinerary-candidate-fetch-error-icon')
    ).toBeOnTheScreen();

    // 조회 상태일 뿐 결과가 아니다 — 현재 행·장소 검색 탈출구는 남는다(Q2).
    expect(screen.getByTestId('itinerary-candidate-current')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-candidate-place-search')
    ).toBeOnTheScreen();

    // 교체하기 자리를 [다시 시도]가 대신한다. 다른 얼굴은 섞이지 않는다.
    expect(screen.queryByTestId('itinerary-candidate-confirm')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-loading')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-empty')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-empty-search')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-slow')).toBeNull();
    // 조회 실패는 PUT 인라인 오류(`-error`)와 다른 자리다.
    expect(screen.queryByTestId('itinerary-candidate-error')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-candidate-fetch-retry'));
    expect(onRetryFetch).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 SlotCandidateSheet — 조회 상태 구조·INV-3·기본값(TRIP-1109 · V1·G1)', () => {
  it('S19 · V1(Q1) — 실패 카드는 0건 점선 카드와 같은 클래스다(같은 시트 안 모양 일치)', () => {
    const errorView = renderSheet({
      fetchState: 'error',
      fetchErrorMessage: FETCH_FALLBACK,
      candidates: [],
    });
    const errorClass = screen.getByTestId('itinerary-candidate-fetch-error')
      .props.className;
    errorView.unmount();

    renderSheet({ candidates: [] });
    const emptyClass = screen.getByTestId('itinerary-candidate-empty').props
      .className;

    // 앵커 — 둘 다 undefined 여도 `toBe` 는 참이라, 점선 카드임을 먼저 못박는다.
    expect(errorClass).toContain('border-dashed');
    expect(errorClass).toBe(emptyClass);
  });

  it.each<[string, Partial<SheetProps>, string[]]>([
    [
      'loading',
      { fetchState: 'loading', candidates: [] },
      ['itinerary-candidate-loading'],
    ],
    [
      'slow',
      { fetchState: 'slow', candidates: [] },
      ['itinerary-candidate-loading', 'itinerary-candidate-slow'],
    ],
    [
      'error',
      {
        fetchState: 'error',
        fetchErrorMessage: FETCH_FALLBACK,
        candidates: [],
      },
      ['itinerary-candidate-fetch-error', 'itinerary-candidate-fetch-retry'],
    ],
  ])(
    'S20 · V1 — %s 얼굴의 새 노드 className 에 raw hex 0',
    (_face, props, roots) => {
      renderSheet(props);

      const classes = roots.flatMap(classNamesUnder);
      // 앵커 — 실제로 훑었다(빈 목록이면 공허 통과).
      expect(classes.length).toBeGreaterThan(0);
      expect(classes.filter((value) => RAW_HEX.test(value))).toEqual([]);
    }
  );

  it.each<[string, Partial<SheetProps>, string]>([
    [
      'loading',
      { fetchState: 'loading', candidates: [] },
      'itinerary-candidate-loading',
    ],
    [
      'slow',
      { fetchState: 'slow', candidates: [] },
      'itinerary-candidate-slow',
    ],
    [
      'error',
      {
        fetchState: 'error',
        fetchErrorMessage: FETCH_FALLBACK,
        candidates: [],
      },
      'itinerary-candidate-fetch-error',
    ],
    [
      'ready 0건',
      { fetchState: 'ready', candidates: [] },
      'itinerary-candidate-empty',
    ],
    ['ready 2건', { fetchState: 'ready' }, 'itinerary-candidate-radio-p2'],
  ])(
    'S21 · G1 INV-3 — %s 얼굴에 소요시간 문자열 0(거리만)',
    (_face, props, anchor) => {
      renderSheet(props);

      // 앵커 먼저 — 그 얼굴을 실제로 그렸을 때만 아래 부재 단언이 의미가 있다(02a ★6).
      expect(screen.getByTestId(anchor)).toBeOnTheScreen();
      const sheet = within(screen.getByTestId('itinerary-candidate-sheet'));
      expect(sheet.queryByText(/\d+\s*(분|시간)|소요/)).toBeNull();
    }
  );

  it('S22 · 기본값 — fetchState 생략 + 후보 0건이면 0건 얼굴(응답 도착으로 읽는다)', () => {
    renderSheet({ candidates: [] });

    expect(screen.getByTestId('itinerary-candidate-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-candidate-loading')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-fetch-error')).toBeNull();
    expect(screen.queryByTestId('itinerary-candidate-slow')).toBeNull();
  });

  it('S23 · 기본값 — ready + 후보 2건이면 후보 행만, 조회 상태 노드는 없다', () => {
    renderSheet({ fetchState: 'ready' });

    expect(
      screen.getByTestId('itinerary-candidate-radio-p2')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-candidate-radio-p3')
    ).toBeOnTheScreen();
    for (const id of [
      'itinerary-candidate-loading',
      'itinerary-candidate-slow',
      'itinerary-candidate-fetch-retry',
      'itinerary-candidate-fetch-error',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });
});

/**
 * TRIP-948 — 0건 얼굴을 `emptyReason` 으로 가른다. 기존 testID(`-empty`)는 모든 0건 얼굴에 남고,
 * 사유 접미(`-no-nearby`·`-all-in-itinerary`)는 알려진 사유에만 안쪽 노드로 붙는다(폴백엔 없다).
 * 이 시트엔 원래 반경·컨셉 버튼이 없다(직접 검색 하나) — ALL_IN 도 같은 CTA 하나다.
 * ★ 시트 실 열림·딤은 jest 사각(repo-traps 바텀시트) — 6-b 실기 몫.
 */
describe('🔴 SlotCandidateSheet — 0건 사유 얼굴(TRIP-948)', () => {
  const ALL_IN_TITLE = '근처 후보가 이미 모두 일정에 있어요';
  const ALL_IN_HINT =
    '반경을 넓혀도 같아요. 다른 슬롯의 장소를 빼면 후보가 생겨요';

  it('R1 · NO_NEARBY — 기존 문구·CTA 그대로 + 접미 노드', () => {
    const onPressPlaceSearch = jest.fn();
    renderSheet({
      candidates: [],
      emptyReason: 'NO_NEARBY',
      onPressPlaceSearch,
    });

    expect(screen.getByTestId('itinerary-candidate-empty')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-candidate-empty-no-nearby')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('itinerary-candidate-empty-all-in-itinerary')
    ).toBeNull();
    expect(screen.getByText(EMPTY_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(ALL_IN_TITLE)).toBeNull();
    fireEvent.press(screen.getByTestId('itinerary-candidate-empty-search'));
    expect(onPressPlaceSearch).toHaveBeenCalledTimes(1);
  });

  it('R2 · ALL_IN_ITINERARY — 새 문구(제목·보조), 기존 문구 없음, 검색 하나, 소요시간 없음', () => {
    const onPressPlaceSearch = jest.fn();
    renderSheet({
      candidates: [],
      emptyReason: 'ALL_IN_ITINERARY',
      onPressPlaceSearch,
    });

    expect(screen.getByTestId('itinerary-candidate-empty')).toBeOnTheScreen();
    const face = screen.getByTestId(
      'itinerary-candidate-empty-all-in-itinerary'
    );
    expect(within(face).getByText(ALL_IN_TITLE)).toBeOnTheScreen();
    expect(within(face).getByText(ALL_IN_HINT)).toBeOnTheScreen();
    expect(
      screen.queryByTestId('itinerary-candidate-empty-no-nearby')
    ).toBeNull();
    // NO_NEARBY 와 같은 문구면 위반.
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(/반경 넓히기|컨셉 변경/)).toBeNull();
    const sheet = within(screen.getByTestId('itinerary-candidate-sheet'));
    expect(sheet.queryByText(/\d+\s*(분|시간)|소요/)).toBeNull();

    const search = screen.getByTestId('itinerary-candidate-empty-search');
    expect(search).toHaveTextContent('장소 검색');
    fireEvent.press(search);
    expect(onPressPlaceSearch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['null', null],
    ['생략', undefined],
    ['미지 값', 'SOMETHING_NEW'],
  ])('R3 · 사유 %s + 0건 → 기존 한 문구로 폴백(빈 화면 아님)', (_n, reason) => {
    renderSheet({ candidates: [], emptyReason: reason });

    expect(screen.getByTestId('itinerary-candidate-empty')).toBeOnTheScreen();
    expect(screen.getByText(EMPTY_TITLE)).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-candidate-empty-search')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('itinerary-candidate-empty-no-nearby')
    ).toBeNull();
    expect(
      screen.queryByTestId('itinerary-candidate-empty-all-in-itinerary')
    ).toBeNull();
  });

  it('R4 · 후보가 있으면 emptyReason 이 와도 0건 얼굴 없음(무회귀)', () => {
    renderSheet({ emptyReason: 'ALL_IN_ITINERARY' });

    expect(screen.queryByTestId('itinerary-candidate-empty')).toBeNull();
    expect(
      screen.getByTestId('itinerary-candidate-radio-p2')
    ).toBeOnTheScreen();
  });
});
