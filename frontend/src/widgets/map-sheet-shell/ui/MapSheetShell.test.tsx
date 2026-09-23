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

/* ──────────────── TRIP-798 · 묶음 C 가산 확장(h13 장소 추가 리스트) ────────────────
 * 셸은 시트 body 를 `<BottomSheetScrollView>{header}{children}` 로만 그려 왔다 — 무한 스크롤
 * `FlatList`(h13 후보 목록, onEndReached)를 그 안에 넣으면 VirtualizedList-in-ScrollView 로
 * onEndReached 가 죽는다(맹점①). `list?: MapSheetListSlot`(가산)를 주면 body 를
 * `<BottomSheetFlatList data renderItem keyExtractor ListHeaderComponent={header+children}
 * onEndReached ListFooterComponent testID>` 로 그린다 — header·children 은 리스트 맨 위 헤더로.
 * 미전달=현행 스크롤 경로(6 소비처 무변경, SH1~SH7 이 회귀 그물).
 *
 * ⚠️ **원리적 사각(02a-C ★C8)** — `@gorhom/bottom-sheet` 통과형 목이라 2스냅 실개폐·딤·실제
 *   VirtualizedList-in-ScrollView 해소·무한 스크롤 실동작은 못 본다. 여기선 **셸이 list 슬롯을
 *   받으면 body 를 FlatList 로 그리고 data·header·children·onEndReached·testID 를 전달까지 했는지**
 *   (슬롯 계약)만 잠근다. `BottomSheetFlatList` 목은 RN `FlatList` 재수출이라 data·
 *   ListHeaderComponent·testID·onEndReached 를 전부 렌더/노출한다(02a-C §5 실검증, 1회 실행 확인).
 *
 * ★C3 관측 방법: SH8b 는 `renderShell`(Partial<…>[0] 이 list 를 unknown 으로 접어 구체 타입을
 *   반공변 거부)을 **안 쓰고** `<MapSheetShell>` 을 직접 렌더해 제네릭 T 를 `list.data` 로 추론시킨다.
 * ★C4 header/children 은 `getByTestId` **단수 매치**로 굳혀 ListHeaderComponent 밖 이중 렌더를 잡는다.
 * red 성격: 현행 셸은 list 를 무시하고 항상 `BottomSheetScrollView` 를 그린다 → 리스트 아이템·
 *   list.testID 가 안 떠 SH8b 가 red. 구현이 list 분기를 넣으면 green(SH8a 기본값은 계속 green).
 * ─────────────────────────────────────────────────────────────────────── */
describe('MapSheetShell · SH8 — list 슬롯이 body 를 BottomSheetFlatList 로 그린다 (TRIP-798 묶음 C)', () => {
  it('SH8a · list 미전달이면 리스트가 없고 header·children 은 스크롤 body 에 그대로다 (선제 green · 회귀 앵커)', () => {
    // 준비/실행 — 기존 소비처 형태(list 안 줌).
    renderShell();

    // 단언 — 리스트 슬롯 부재(list.testID 노드 없음). 6 소비처는 여전히 스크롤 body.
    expect(screen.queryByTestId('shell-list')).toBeNull();
    // 짝 — header·children 은 그대로 시트 body 에 흐른다(무변경).
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
  });

  it('🔴 SH8b · list 를 주면 data 가 렌더되고 header·children 이 ListHeaderComponent 로 얹히며 testID·onEndReached 가 전달된다', () => {
    // 준비 — list 슬롯(data 2건 + onEndReached 스파이). T 는 data 로 추론된다(★C3).
    const onEndReached = jest.fn();
    const data = [{ id: 'x1' }, { id: 'x2' }];

    // 실행 — renderShell 이 아니라 직접 렌더(★C3 반공변 회피).
    render(
      <MapSheetShell
        center={CENTER}
        pins={PINS}
        days={[]}
        selectedDayIndex={0}
        onSelectDay={jest.fn()}
        onBack={jest.fn()}
        header={<Text testID="fake-header">헤더</Text>}
        list={{
          data,
          renderItem: ({ item }) => (
            <Text testID={`list-item-${item.id}`}>{item.id}</Text>
          ),
          keyExtractor: (item) => item.id,
          onEndReached,
          onEndReachedThreshold: 0.5,
          testID: 'shell-list',
        }}
      >
        <Text testID="fake-body">본문</Text>
      </MapSheetShell>
    );

    // ① data 가 renderItem 으로 그려진다(통과형 목이 RN FlatList 라 items 를 동기 렌더).
    //    **red 성격**: 현행 셸은 list 를 무시하고 스크롤 body 만 그려 list-item 이 안 뜬다.
    expect(screen.getByTestId('list-item-x1')).toBeOnTheScreen();
    expect(screen.getByTestId('list-item-x2')).toBeOnTheScreen();
    // ② header·children 이 ListHeaderComponent 로 리스트 맨 위에 **정확히 한 번** 얹힌다(★C4 이중 렌더 차단).
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    // ③ list.testID 가 FlatList 에 전달된다.
    expect(screen.getByTestId('shell-list')).toBeOnTheScreen();
    // ④ onEndReached 가 FlatList 로 전달돼 끝에 닿으면 발화한다(무한 스크롤 배선 · P4 계열).
    fireEvent(screen.getByTestId('shell-list'), 'endReached');
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});

/* ──────────────── TRIP-746 · i01 허브 가산 3종(snapPoints · mapViewOnly · currentLocation) ────────────────
 * i01 여행중 허브는 같은 셸 위에 서되 셋이 다르다: 시트가 3스냅(닫힘·중간·펼침)이고, 지도는 여행 중
 * 자유 탐색이라 **잠그지 않으며**(TRIP-397 결정 계승), 현재위치 점을 얹는다(TRIP-745 계약). 셋 다
 * 옵셔널 가산이라 미전달 기본값이 현행(2스냅·잠금·점 없음)과 같아야 한다 — a 케이스가 그 회귀 앵커다.
 *
 * ⚠️ 원리적 사각(02a ★1·★2): 스냅 실전환은 통과형 목이 못 본다 → `BottomSheet` 에 **넘긴 값**까지만.
 *   지도 목은 env 키가 있어야 `map-native`(prop 기록형)를 그린다 → 지도 케이스는 키를 넣고 원복한다.
 *   실제로 제스처가 막히는지·점이 보이는지는 6-b 실기.
 * ─────────────────────────────────────────────────────────────────────── */

// no-dynamic-env-var 회피 — 선언과 대입을 분리한다(MapView.test 선례).
const SHELL_CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let SHELL_ORIGINAL_CLIENT_ID: string | undefined;
SHELL_ORIGINAL_CLIENT_ID = process.env[SHELL_CLIENT_ID_KEY];

function withMapKey(): void {
  process.env[SHELL_CLIENT_ID_KEY] = 'test-naver-client-id';
}
function restoreMapKey(): void {
  if (SHELL_ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[SHELL_CLIENT_ID_KEY];
  } else {
    process.env[SHELL_CLIENT_ID_KEY] = SHELL_ORIGINAL_CLIENT_ID;
  }
}

const GESTURE_TOGGLES = [
  'isScrollGesturesEnabled',
  'isZoomGesturesEnabled',
  'isRotateGesturesEnabled',
  'isTiltGesturesEnabled',
] as const;

/** 통과형 시트 목에 실린 snapPoints 배열들(합성·호스트 두 겹이라 여러 개 — 전부 같아야 한다). */
function sheetSnapPoints(): unknown[][] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map((node) => node.props.snapPoints as unknown[]);
}

describe('MapSheetShell · SH9 — snapPoints 가 시트 스냅을 정한다 (TRIP-746)', () => {
  it('SH9a · snapPoints 미전달이면 현행 2스냅 [45%, 88%] 을 넘긴다 (선제 green · 회귀 앵커)', () => {
    renderShell();

    const all = sheetSnapPoints();
    expect(all.length).toBeGreaterThan(0);
    all.forEach((points) => expect(points).toEqual(['45%', '88%']));
  });

  it('🔴 SH9b · snapPoints 를 주면 그 배열(3스냅)을 그대로 넘긴다', () => {
    renderShell({ snapPoints: [28, '55%', '86%'] });

    const all = sheetSnapPoints();
    expect(all.length).toBeGreaterThan(0);
    all.forEach((points) => expect(points).toEqual([28, '55%', '86%']));
  });
});

describe('MapSheetShell · SH10 — mapViewOnly 로 지도 잠금을 끈다 (TRIP-746 · Seed Q1)', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('SH10a · mapViewOnly 미전달이면 제스처 4종이 전부 꺼진다(잠금 기본값 · 선제 green)', () => {
    renderShell();

    const map = screen.getByTestId('map-native');
    GESTURE_TOGGLES.forEach((toggle) => expect(map.props[toggle]).toBe(false));
  });

  it('🔴 SH10b · mapViewOnly={false} 면 제스처 4종이 전부 켜진다(여행 중 자유 탐색)', () => {
    renderShell({ mapViewOnly: false });

    const map = screen.getByTestId('map-native');
    GESTURE_TOGGLES.forEach((toggle) => expect(map.props[toggle]).toBe(true));
  });
});

describe('MapSheetShell · SH11 — currentLocation 을 지도에 흘린다 (TRIP-746)', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('SH11a · currentLocation 미전달이면 현재위치 점이 없다 (선제 green · 회귀 앵커)', () => {
    renderShell();

    // 짝 — 지도 자체는 떴다.
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-current-location')).toBeNull();
  });

  it('🔴 SH11b · currentLocation 을 주면 현재위치 점이 지도 위에 뜬다', () => {
    renderShell({ currentLocation: { lat: 35.1, lng: 129.05 } });

    expect(screen.getByTestId('map-current-location')).toBeOnTheScreen();
  });
});

/* ──────────────── TRIP-748 · 알약 숨김 입구 3개(가산) ────────────────
 * i02 허브는 지도 위 트리거 알약을 "시트를 끌거나 스크롤하거나 지도를 탭하면" 로컬로 숨긴다(D3).
 * 셸은 그 세 사건을 **판단 없이 흘려보내기만** 한다 — 마운트 가드(from ≥ 0 && from ≠ to)는 허브 몫.
 *   onSheetAnimate         → <BottomSheet onAnimate>
 *   onSheetScrollBeginDrag → <BottomSheetScrollView onScrollBeginDrag>
 *   onMapTap               → <MapView onTapMap>
 * 통과형 시트 목은 이 이벤트를 스스로 쏘지 않는다 — 테스트가 넘겨진 prop 을 직접 부른다(02a ★2·★3).
 * 시트 목은 3겹(forwardRef·함수·host)이라 host(문자열 타입)를 고른다.
 * ─────────────────────────────────────────────────────────────────────── */

/** snapPoints 를 가진 host(문자열 타입) 노드 — BottomSheet 본체. */
function sheetHost() {
  const host = screen.root
    .findAll((node) => Array.isArray(node.props?.snapPoints))
    .find((node) => typeof node.type === 'string');
  if (!host) throw new Error('시트 host 노드가 없다');
  return host;
}

function scrollBeginDragNodes() {
  return screen.root.findAll(
    (node) => typeof node.props?.onScrollBeginDrag === 'function'
  );
}

describe('MapSheetShell · SH12 — 시트 끌기·본문 스크롤·지도 탭을 흘려보낸다 (TRIP-748)', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('SH12a · 세 prop 미전달이면 어디에도 콜백을 달지 않는다 (선제 green · 6 소비처 무회귀)', () => {
    renderShell();

    // 짝 앵커 — 지도와 시트가 실제로 떴다.
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
    expect(sheetHost().props.onAnimate).toBeUndefined();
    expect(scrollBeginDragNodes()).toHaveLength(0);
    expect(screen.getByTestId('map-native').props.onTapMap).toBeUndefined();
  });

  it('🔴 SH12b · onSheetAnimate 는 BottomSheet onAnimate 로 흘러 (from, to) 를 그대로 올린다', () => {
    const onSheetAnimate = jest.fn();
    renderShell({ onSheetAnimate });

    const onAnimate = sheetHost().props.onAnimate as
      ((from: number, to: number, fp: number, tp: number) => void) | undefined;
    expect(onAnimate).toBeDefined();
    onAnimate?.(1, 2, 0, 0);

    expect(onSheetAnimate).toHaveBeenCalledTimes(1);
    expect(onSheetAnimate.mock.calls[0].slice(0, 2)).toEqual([1, 2]);
  });

  it('🔴 SH12c · onSheetScrollBeginDrag 는 시트 본체가 아니라 본문 스크롤 뷰에 달린다', () => {
    const onSheetScrollBeginDrag = jest.fn();
    renderShell({ onSheetScrollBeginDrag });

    const nodes = scrollBeginDragNodes();
    expect(nodes.length).toBeGreaterThan(0);
    // 본문 스크롤 뷰 = snapPoints 가 없는 노드(시트 본체에 달면 이 단언이 깨진다).
    nodes.forEach((node) =>
      expect(Array.isArray(node.props.snapPoints)).toBe(false)
    );
    // 본문 children 을 품은 노드여야 한다.
    expect(
      nodes[nodes.length - 1].findAll(
        (node) => node.props?.testID === 'fake-body'
      ).length
    ).toBeGreaterThan(0);

    (nodes[nodes.length - 1].props.onScrollBeginDrag as (e: unknown) => void)({
      nativeEvent: {},
    });

    expect(onSheetScrollBeginDrag).toHaveBeenCalledTimes(1);
  });

  it('🔴 SH12d · onMapTap 은 지도 onTapMap 으로 흐른다', () => {
    const onMapTap = jest.fn();
    renderShell({ onMapTap });

    const native = screen.getByTestId('map-native');
    expect(native.props.onTapMap).toBeDefined();
    (native.props.onTapMap as (p: unknown) => void)({
      latitude: 35.15,
      longitude: 129.11,
      x: 1,
      y: 2,
    });

    expect(onMapTap).toHaveBeenCalledTimes(1);
  });
});
