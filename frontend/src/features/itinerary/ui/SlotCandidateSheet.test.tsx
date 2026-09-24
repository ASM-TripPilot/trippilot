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
      resolve('src/features/itinerary/ui/SlotCandidateSheet.tsx'),
      'utf8'
    );
    expect(source).toContain('@gorhom/bottom-sheet');
    // 긍정 짝 — 파일을 실제로 읽었고 시트 루트를 그린다(공허 통과 방지).
    expect(source).toContain('itinerary-candidate-sheet');
  });
});
