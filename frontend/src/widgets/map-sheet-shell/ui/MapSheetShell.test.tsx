import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { MapSheetShell } from './MapSheetShell';

/**
 * TRIP-783 · 셸 조립 계약(widgets). 전면 지도(`<MapView viewOnly>`) + 2스냅 바텀시트 +
 * 좌상단 일차 칩 오버레이 + 하단 고정 CTA 바를 조립한다.
 *
 * ⚠️ **원리적 사각(02a ★2·★3·★4)** — `@gorhom/bottom-sheet` 목은 통과형이라 시트 실개폐·2스냅·
 *   딤·`enableContentPanningGesture` 는 못 본다(E6·E7 → 6-b 실기). `MapView` 목은 env 유무로
 *   `map-native`/`map-failure` 갈리나 `map-root` 는 양쪽 다 렌더 → 여기선 `map-root` 만 단언한다
 *   (viewOnly 실전달은 `itineraryMapSurfaceStructure` S2 소스 스캔이 잠금). 이 파일은 **children
 *   렌더·prop 전달·testID 트리**만 잠근다.
 *
 * 3동작 뼈대: 준비=header/children/cta/days/pins 주입 렌더 → 실행=렌더/칩·back press → 단언=조립·콜백.
 */

const CENTER = { lat: 35.1532, lng: 129.1188 };
const PINS = [
  { number: 1, lat: 35.1532, lng: 129.1188 },
  { number: 2, lat: 35.1372, lng: 129.1005 },
];
const DAYS = [{ label: '1일차' }, { label: '2일차' }];

function renderShell(
  overrides: Partial<Parameters<typeof MapSheetShell>[0]> = {}
): { onBack: jest.Mock; onSelectDay: jest.Mock } {
  const onBack = jest.fn();
  const onSelectDay = jest.fn();
  render(
    <MapSheetShell
      center={CENTER}
      pins={PINS}
      days={DAYS}
      selectedDayIndex={0}
      onSelectDay={onSelectDay}
      onBack={onBack}
      header={<Text testID="fake-header">헤더</Text>}
      cta={[{ label: '확정하기', variant: 'primary', onPress: jest.fn() }]}
      {...overrides}
    >
      <Text testID="fake-body">본문</Text>
    </MapSheetShell>
  );
  return { onBack, onSelectDay };
}

describe('🔴 MapSheetShell · SH1 — 조립·children·prop 전달', () => {
  it('지도·일차 칩·헤더 슬롯·본문 children·CTA 바가 한 트리에 조립된다', () => {
    renderShell();

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    // 지도 표면 — env 분기 무관하게 map-root 는 렌더된다(02a ★4).
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    // 헤더 슬롯 + 본문 children 이 시트 안에 흐른다(통과형 목이 children 을 렌더).
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    // CTA 바가 조립된다.
    expect(screen.getByTestId('sheet-cta-button-0')).toBeOnTheScreen();
    // 일차 칩 오버레이 — 라벨대로.
    expect(screen.getByTestId('sheet-daychip-0')).toHaveTextContent('1일차');
    expect(screen.getByTestId('sheet-daychip-1')).toHaveTextContent('2일차');
  });
});

describe('🔴 MapSheetShell · SH2 — 일차 칩·back 콜백과 선택 표시', () => {
  it('back·칩 press 가 콜백을 부르고 선택 칩만 selected 다', () => {
    const { onBack, onSelectDay } = renderShell();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('sheet-daychip-1'));
    expect(onSelectDay).toHaveBeenCalledWith(1);

    // 선택 표시 — selectedDayIndex=0 이면 chip-0 만 selected(accessibilityState.selected).
    expect(screen.getByTestId('sheet-daychip-0')).toBeSelected();
    expect(screen.getByTestId('sheet-daychip-1')).not.toBeSelected();
  });
});

/* ──────────────── TRIP-790 · D3 가산 확장(h07 첫 소비자) ────────────────
 * `overlay?`(주면 DayChipOverlay 대체)·`cta?`(옵셔널)를 더한다. SH1·SH2 는 **건드리지
 * 않는다** — days·cta 를 주는 기존 거동이 그대로 green 이어야 한다(D3 "기본값 현행 보존"의
 * 회귀 심판). 아래 두 케이스는 h07 사용 형태(진행 카드 overlay + CTA 없음)를 잠근다.
 * ⚠️ red 성격(02a ★9): 현행 props 는 overlay 미지원·cta required 라, 구현 전엔 assertion
 *   또는 render throw 로 red 다(정상 · 구현 후 green).
 * ─────────────────────────────────────────────────────────────────────── */
describe('🔴 MapSheetShell · SH3 — overlay 가 DayChipOverlay 를 대체한다 (D3)', () => {
  it('overlay 를 주면 그 노드가 뜨고 내부 일차 칩 오버레이는 안 그려진다', () => {
    render(
      <MapSheetShell
        center={CENTER}
        pins={PINS}
        // days 를 빈 배열로 둬 현행 DayChipOverlay 가 crash 하지 않게 한다(옵셔널화 전 안전).
        days={[]}
        selectedDayIndex={0}
        onSelectDay={jest.fn()}
        onBack={jest.fn()}
        overlay={<Text testID="fake-overlay">진행 카드</Text>}
        header={<Text testID="fake-header">헤더</Text>}
        cta={[]}
      >
        <Text testID="fake-body">본문</Text>
      </MapSheetShell>
    );

    // 긍정 — 주입한 overlay 노드가 좌상단 자리에 그려진다.
    expect(screen.getByTestId('fake-overlay')).toBeOnTheScreen();
    // 짝 — 기본 일차 칩 오버레이(DayChipOverlay 루트)는 대체돼 사라진다.
    expect(screen.queryByTestId('sheet-daychip-root')).toBeNull();
  });
});

describe('🔴 MapSheetShell · SH4 — cta 미전달이면 CTA 바를 안 그린다 (D3·D9)', () => {
  it('cta 를 안 주면 sheet-cta-root 가 없다 (h07 은 생성 중이라 CTA 없음)', () => {
    render(
      <MapSheetShell
        center={CENTER}
        pins={PINS}
        days={[]}
        selectedDayIndex={0}
        onSelectDay={jest.fn()}
        onBack={jest.fn()}
        overlay={<Text testID="fake-overlay">진행 카드</Text>}
        header={<Text testID="fake-header">헤더</Text>}
      >
        <Text testID="fake-body">본문</Text>
      </MapSheetShell>
    );

    // CTA 를 안 넘기면 하단 고정 바가 통째로 미렌더(빈 바도 안 그린다).
    expect(screen.queryByTestId('sheet-cta-root')).toBeNull();
    // 짝 — 본문·overlay 는 그대로 살아 있다(CTA 만 빠진다).
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-overlay')).toBeOnTheScreen();
  });
});

/* ──────────────── TRIP-792 · D5 가산 확장(h08 펼침 프리뷰) ────────────────
 * 셸은 `<BottomSheet index={0}>` 을 하드코딩해 왔다 — 접힘(peek) 얼굴만 초기값으로 낼 수 있었다.
 * h08 펼침 프리뷰(`h08-draft-expanded`)는 시트가 상단 스냅까지 올라간 얼굴이라 초기 스냅을
 * 1(expanded)로 열어야 한다. `initialIndex?: number`(기본 0) 옵셔널 가산으로 `<BottomSheet
 * index={initialIndex ?? 0}>` 을 만든다 — 기존 소비처(index 미전달=0)는 무변경(후방호환).
 *
 * ⚠️ **원리적 사각(맹점③)** — `@gorhom/bottom-sheet` 목은 통과형이라 index 로 시트가 **실제로**
 *   그 스냅까지 열리는지는 못 본다. 여기선 셸이 그 값을 BottomSheet 에 **전달까지 했는지**만 잠근다
 *   (지도 viewOnly·2스냅 실개폐와 같은 계열 — 실전환은 6-b 실기 몫).
 *
 * ★ 관측 방법(§5 실검증): 통과형 목(`__mocks__/@gorhom/bottom-sheet.tsx`)은 받은 prop 을 그대로
 *   `<View {...props}>` 에 얹는다. 그래서 `screen.root.findAll(...)`(렌더 트리 전체를 훑어 조건에 맞는
 *   노드를 배열로 주는 RNTL API)로 `index`(숫자)+`snapPoints`(배열)를 함께 가진 노드를 찾아 그
 *   `index` 값을 읽는다. 합성/호스트 두 겹이 같은 prop 을 갖고 나오므로 개수는 세지 않고 **찾은 노드
 *   전부가 기대 index 인지**로 잠근다(샌드박스 1회 실행으로 3노드 모두 index=0 확인, 02a §5).
 * ─────────────────────────────────────────────────────────────────────── */
function sheetIndices(): number[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map((node) => node.props.index as number);
}

describe('MapSheetShell · SH5 — initialIndex 가 BottomSheet 초기 스냅을 정한다 (TRIP-792 D5)', () => {
  it('SH5a · initialIndex 미전달이면 index=0(peek) 이다 (선제 green · 회귀 앵커)', () => {
    // 준비/실행 — 기존 소비처 형태(initialIndex 안 줌)로 렌더.
    renderShell();

    // 단언 — BottomSheet 에 전달된 index 가 전부 0(현행 하드코딩 값). 구현 후에도 기본값이
    //        0 으로 유지되는지 지키는 회귀 앵커라 지금도 통과한다(선제 green).
    const indices = sheetIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(0));
  });

  it('🔴 SH5b · initialIndex={1} 이면 index=1(expanded) 로 전달된다 (h08 펼침)', () => {
    // 준비/실행 — 펼침 초기 스냅을 요구한다.
    renderShell({ initialIndex: 1 });

    // 단언 — BottomSheet 가 index=1 을 받는다. **red 성격**: 현행 셸은 index={0} 하드코딩이라
    //        initialIndex 를 무시하고 0 을 전달 → 이 단언이 red. 구현이 `index={initialIndex ?? 0}`
    //        으로 바꾸면 green(기본값 0 은 SH5a 가 지킨다).
    const indices = sheetIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(1));
  });
});

/* ──────────────── TRIP-799 · D5 가산 확장(h14 지도 폴백) ────────────────
 * 셸은 지도 스트립에 `<MapView viewOnly>` 를 **무조건** 깔아 왔다 — 지도 로드 실패 얼굴을 낼 슬롯이
 * 없었다(맹점②). `mapFallback?: ReactNode`(가산)를 주면 그 자리에 MapView 대신 이 노드를 렌더한다
 * — day-chip·시트·CTA 는 유지해 화면을 안 비운다(INV-4). 미전달=현행 MapView(801·기존 소비처 무변경).
 *
 * ⚠️ **원리적 사각(D5)** — 실 런타임 지도 실패 감지(MapView onError)는 이 위젯 밖이라, 페이지가
 *   언제 mapFallback 을 주입하는지는 프리뷰·6-b 몫이다. 여기선 **셸이 mapFallback 을 받으면 그 노드로
 *   지도 자리를 대체하는지**(슬롯 계약)만 잠근다.
 * ─────────────────────────────────────────────────────────────────────── */
describe('MapSheetShell · SH6 — mapFallback 이 지도 자리를 대체한다 (TRIP-799 D5·AC-6)', () => {
  it('SH6a · mapFallback 미전달이면 map-root(MapView) 가 뜬다 (선제 green · 회귀 앵커)', () => {
    // 준비/실행 — 기존 소비처 형태(mapFallback 안 줌).
    renderShell();

    // 단언 — 지도 표면이 현행대로 뜬다(기본값=MapView). 구현 후에도 미전달=MapView 유지(선제 green).
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
  });

  it('🔴 SH6b · mapFallback 을 주면 그 노드가 뜨고 map-root 는 사라지며 시트·오버레이·CTA 는 유지된다', () => {
    // 준비/실행 — 지도 실패 폴백 노드를 주입한다.
    renderShell({
      mapFallback: (
        <Text testID="fake-map-fallback">지도를 불러올 수 없어요</Text>
      ),
    });

    // 긍정 — 주입한 폴백 노드가 지도 스트립 자리에 뜬다.
    expect(screen.getByTestId('fake-map-fallback')).toBeOnTheScreen();
    // ★13 짝 — 기본 MapView(map-root)는 대체돼 사라진다. **red 성격**: 현행 셸은 mapFallback 을
    //   무시하고 항상 MapView 를 깔아 map-root 가 남는다 → 이 단언이 red. 구현이 mapFallback 분기를
    //   넣으면 green.
    expect(screen.queryByTestId('map-root')).toBeNull();
    // 화면을 안 비운다(INV-4) — day-chip·시트 body·CTA 는 유지.
    expect(screen.getByTestId('sheet-daychip-root')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
  });
});

/* ──────────────── TRIP-801 · D3 가산 확장(h16 성공 배너) ────────────────
 * 셸은 지도 위 좌상단에 `DayChipOverlay`(또는 `overlay` 대체)만 얹어 왔다. h16 확정 얼굴은 일차 칩
 * **아래에** 성공 배너 카드를 하나 더 얹어야 한다. `mapCard?: ReactNode`(가산)를 주면 day-chip 오버레이
 * **아래에 추가로** 렌더한다 — `overlay?`(교체)와 달리 **추가**다(★6). 미전달=미렌더(후방호환).
 *
 * ⚠️ **원리적 사각** — 배너의 지도 위 절대 위치·색·정확 카피는 6-b 실기/육안(SH1~SH6 사각 계열).
 *   여기선 **셸이 mapCard 를 받으면 그 노드를 추가로 그리는지**(추가 슬롯 계약)만 잠근다.
 * ─────────────────────────────────────────────────────────────────────── */
describe('MapSheetShell · SH7 — mapCard 가 day-chip 아래에 추가로 렌더된다 (TRIP-801 D3)', () => {
  it('SH7a · mapCard 미전달이면 그 노드가 없고 day-chip 오버레이는 그대로다 (선제 green · 회귀 앵커)', () => {
    // 준비/실행 — 기존 소비처 형태(mapCard 안 줌).
    renderShell();

    // 단언 — mapCard 노드 부재 + 기본 day-chip 오버레이 유지(미전달=미렌더, 후방호환).
    expect(screen.queryByTestId('fake-map-card')).toBeNull();
    expect(screen.getByTestId('sheet-daychip-root')).toBeOnTheScreen();
  });

  it('🔴 SH7b · mapCard 를 주면 그 노드가 뜨고 day-chip 오버레이도 그대로 유지된다 (교체 아닌 추가 · ★6)', () => {
    // 준비/실행 — 성공 배너 자리에 마커 노드를 주입한다.
    renderShell({
      mapCard: <Text testID="fake-map-card">일정이 확정됐어요</Text>,
    });

    // 긍정 — 주입한 mapCard 노드가 지도 위에 그려진다.
    expect(screen.getByTestId('fake-map-card')).toBeOnTheScreen();
    // ★6 핵심 — overlay(교체)와 달리 day-chip 오버레이는 **사라지지 않는다**(추가 슬롯).
    //   **red 성격**: 현행 셸은 mapCard 를 무시해 fake-map-card 가 안 떠 이 단언이 red.
    //   구현이 day-chip 아래 `{mapCard}` 를 그리면 green.
    expect(screen.getByTestId('sheet-daychip-root')).toBeOnTheScreen();
    // 시트 body·CTA 도 유지.
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
  });
});
