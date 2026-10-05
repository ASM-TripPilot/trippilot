import type { ReactElement, ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import { MapSheetShell } from './MapSheetShell';

/**
 * TRIP-783 · 셸 조립 계약(widgets). 전면 지도(`<MapView viewOnly>`) + 바텀시트 +
 * 좌상단 일차 칩 오버레이 + 하단 고정 CTA 바를 조립한다. TRIP-920 부터 기본 스냅은 3칸
 * (닫힘 28 · peek 45% · 펼침 88%)이고, 닫힘 칸에서만 지도가 풀린다(SH14).
 *
 * ⚠️ **원리적 사각(02a ★2·★3·★4)** — `@gorhom/bottom-sheet` 목은 통과형이라 시트 실개폐·2스냅·
 *   딤·`enableContentPanningGesture` 는 못 본다(E6·E7 → 6-b 실기). TRIP-919 부터 셸은 지도 실패
 *   (env 키 없음 → `MapView.onLoadFailed`)를 받으면 지도 자리를 폴백 바로 바꾼다 → 지도를 단언하는
 *   케이스는 **키를 넣고** 돈다(`withMapKey`). viewOnly 실전달을 잠그던 `itineraryMapSurfaceStructure` S2
 *   소스 스캔은 TRIP-1145 로 지웠다. 이 파일은 **children 렌더·prop 전달·testID 트리**만 잠근다.
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

// 지도 env 키 주입/원복 — 실제 MapView 는 키가 있어야 `map-native` 를 그리고, 없으면 `onLoadFailed` 를
// 알려 셸이 폴백 바로 바꾼다(TRIP-919). no-dynamic-env-var 회피 — 선언과 대입을 분리한다(MapView.test 선례).
const SHELL_CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let SHELL_ORIGINAL_CLIENT_ID: string | undefined;
SHELL_ORIGINAL_CLIENT_ID = process.env[SHELL_CLIENT_ID_KEY];

function withMapKey(): void {
  process.env[SHELL_CLIENT_ID_KEY] = 'test-naver-client-id';
}
function withoutMapKey(): void {
  delete process.env[SHELL_CLIENT_ID_KEY];
}
function restoreMapKey(): void {
  if (SHELL_ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[SHELL_CLIENT_ID_KEY];
  } else {
    process.env[SHELL_CLIENT_ID_KEY] = SHELL_ORIGINAL_CLIENT_ID;
  }
}

describe('🔴 MapSheetShell · SH1 — 조립·children·prop 전달', () => {
  // TRIP-919 심판 보정 — 실패가 없는 조건(키 있음)을 명시해 "기본이면 지도가 조립된다"를 계속 지킨다.
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('지도·일차 칩·헤더 슬롯·본문 children·CTA 바가 한 트리에 조립된다', () => {
    renderShell();

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    // 지도 표면 — 키가 있으면 실패가 없어 MapView(map-root)가 조립된다.
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

/* ──────────────── TRIP-792 · D5 가산 확장(h08 펼침 프리뷰) → TRIP-920 개정 ────────────────
 * `initialIndex?: number` 가 `<BottomSheet index>` 초기 스냅을 정한다. TRIP-920 이 기본 배열 앞에 닫힘(28)을
 * 끼워 index 의 뜻이 한 칸씩 밀렸다(0=닫힘 · 1=peek · 2=펼침, 배열 번호 그대로 — 01b Q1).
 *
 * ★ 심판 수정(02a ★1): 옛 SH5 는 **숫자 index**(0·1)를 단언했다. 그러면 배열이 바뀌어도 숫자는 그대로라
 *   green 인 채로 "peek → 닫힘", "펼침 → peek" 로 뜻이 바뀐다. 그래서 **받은 snapPoints 배열에서 그 index 가
 *   가리키는 값**('45%'·'88%'·28)을 단언한다.
 *
 * ⚠️ **원리적 사각** — 통과형 목이라 index 로 시트가 **실제로** 그 칸까지 열리는지는 못 본다. 셸이 값을
 *   BottomSheet 에 **전달까지 했는지**만 잠근다(실전환은 6-b 실기 몫).
 *
 * ★ 관측 방법: 통과형 목(`__mocks__/@gorhom/bottom-sheet.tsx`)은 받은 prop 을 그대로 `<View {...props}>` 에
 *   얹는다. `screen.root.findAll(...)`(렌더 트리 전체를 훑어 조건에 맞는 노드를 배열로 주는 RNTL API)로
 *   `index`(숫자)+`snapPoints`(배열)를 함께 가진 노드를 찾는다. 합성/호스트 3겹이 같은 prop 을 갖고 나오므로
 *   개수는 세지 않고 **찾은 노드 전부**가 기대 값인지로 잠근다(02a §5).
 * ─────────────────────────────────────────────────────────────────────── */
/** 시트가 받은 snapPoints 배열에서 index 가 가리키는 **칸 값**들(숫자 index 가 아니다 — 02a ★1). */
function sheetSnapValues(): unknown[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map(
      (node) => (node.props.snapPoints as unknown[])[node.props.index as number]
    );
}

function expectSnapValue(expected: unknown): void {
  const values = sheetSnapValues();
  expect(values.length).toBeGreaterThan(0);
  values.forEach((value) => expect(value).toBe(expected));
}

describe('MapSheetShell · SH5 — initialIndex 가 BottomSheet 초기 스냅 칸을 정한다 (TRIP-792 D5 · TRIP-920 개정)', () => {
  // TRIP-920 — 지도 잠금까지 보므로 키를 넣는다(없으면 map-native 대신 폴백, 02a ★14).
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('SH5a · initialIndex 미전달이면 peek(45%) 칸으로 열리고 지도는 잠겨 있다 (AC-2 · 선제 green · 심판 수정)', () => {
    // 준비/실행 — 기존 소비처 형태(initialIndex 안 줌).
    renderShell();

    // 단언 — 기본 진입은 여전히 peek. 셸이 배열만 바꾸고 기본 index 를 0 으로 두면 여기서 28 이 나와 red.
    expectSnapValue('45%');
    expectMapLocked(true);
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
  });

  it('🔴 SH5b · initialIndex={2} 면 펼침(88%) 칸으로 열리고 지도는 잠겨 있다 (AC-9 셸 쪽)', () => {
    // 준비/실행 — 펼침 진입(h08 펼침·i06·i07 이 새 배열에서 주는 값).
    renderShell({ initialIndex: 2 });

    // 단언 — 새 배열의 마지막 칸. 현행 2칸 배열엔 index 2 가 없어 undefined → red.
    expectSnapValue('88%');
    expectMapLocked(true);
  });

  it('🔴 SH5c · initialIndex={0} 이면 닫힘(28)으로 진입해 onChange 없이도 처음부터 지도가 풀리고 CTA 가 없다 (셸 상태 초기값 = 초기 index · 02a ★5)', () => {
    // 준비/실행 — 닫힘으로 진입. 라이브러리가 마운트 때 onChange 를 부르는지는 jest 가 모르므로 부르지 않는다.
    renderShell({ initialIndex: 0 });

    // 단언 — 셸이 쥔 "현재 칸" 초기값이 initialIndex 와 같아야 한다(`useState(1)` 하드코딩이면 red).
    expectSnapValue(28);
    expectMapLocked(false);
    expect(screen.queryByTestId('sheet-cta-root')).toBeNull();
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
  // TRIP-919 심판 보정 — 키 없으면 셸 자체 폴백이 map-root 를 치우므로, 미전달=MapView 를 보려면 키가 있어야 한다.
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

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

// (env 키 헬퍼 `withMapKey`·`restoreMapKey` 는 TRIP-919 에서 파일 위쪽으로 옮겼다 — SH1·SH6 도 쓴다.)

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
  it('🔴 SH9a · snapPoints 미전달이면 3스냅 [닫힘 28, 45%, 88%] 을 넘긴다 (AC-1 · TRIP-920 개정)', () => {
    renderShell();

    // 닫힘은 숫자 28(핸들만 보이는 높이 — i01 Figma 4251:2448 · LiveHubView CLOSED_SNAP 과 같은 출처, 01b Q3).
    // 라이브러리 규칙상 낮은 높이부터 오름차순이라 닫힘이 0번이다.
    const all = sheetSnapPoints();
    expect(all.length).toBeGreaterThan(0);
    all.forEach((points) => expect(points).toEqual([28, '45%', '88%']));
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

/* ──────────────── TRIP-919 · 셸이 지도 실패를 스스로 폴백한다 ────────────────
 * 지금까지 `mapFallback` 은 프리뷰가 강제로 넣을 때만 채워졌다. 이제 셸이 `<MapView onLoadFailed>` 로
 * 실패를 받아 **자기 상태(useState)** 에 적고, 지도 자리에 기본 폴백 바(`MapFallbackBar`)를 얹는다.
 * "다시 시도" 는 실패 상태를 풀어 MapView 를 **새로 마운트**한다 → 키가 생겼으면 지도가 뜨고, 여전히
 * 없으면 다시 폴백(정직한 반복). 소비처가 `mapFallback` 을 주면 그쪽이 이긴다(01b 확정).
 *
 * 실패 트리거는 jest 에서 env 키 부재 하나뿐이다(실제 MapView 가 effect 에서 `onLoadFailed` 를 부른다).
 * ⚠️ 원리적 사각(02a ★12): MapView 자체 `map-failure` 면이 폴백 전 한 커밋 깜빡이는 것·폴백 블록이
 *   시트/칩에 가리는지·실기 복구(키는 빌드 때 고정)는 jest 가 못 본다 → AC-V1·AC-V2(6-b).
 * ★ SH13b(재시도 → 지도)와 SH13c(재시도 → 다시 폴백)는 짝이다 — 재시도가 아무것도 안 하는 구현은
 *   SH13c 만으론 못 잡는다(02a ★4). SH13e 는 "항상 폴백" 오구현을 막는 회귀 앵커다(02a ★5).
 *
 * 3동작 뼈대: 준비=env 키 유무 + 셸 렌더 → 실행=렌더(자동 실패)/다시 시도 press → 단언=폴백·지도·시트 유지.
 * ─────────────────────────────────────────────────────────────────────── */
const FALLBACK_MESSAGE =
  '지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요';

describe('MapSheetShell · SH13 — 지도 실패를 셸이 폴백 바로 받는다 (TRIP-919)', () => {
  afterEach(restoreMapKey);

  it('🔴 SH13a · 키가 없으면 지도 자리에 폴백 바가 뜨고 칩·헤더·본문·CTA 는 그대로다 (AC-1·AC-6)', () => {
    // 준비 — 키 없음(실제 MapView 가 onLoadFailed 를 알린다), mapFallback 미전달.
    withoutMapKey();

    // 실행
    renderShell();

    // 단언 — 셸 기본 폴백 바: 안내문 완전일치 + 다시 시도 버튼.
    const fallback = screen.getByTestId('map-sheet-fallback');
    expect(within(fallback).getByText(FALLBACK_MESSAGE)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('map-sheet-fallback-retry')).getByText(
        '다시 시도'
      )
    ).toBeOnTheScreen();
    // 지도(와 MapView 자체 실패면)는 지도 자리에서 빠진다.
    expect(screen.queryByTestId('map-root')).toBeNull();
    // 화면을 비우지 않는다(INV-4) — 일차 칩·헤더·본문·CTA 유지.
    expect(screen.getByTestId('sheet-daychip-root')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
  });

  it('🔴 SH13b · 키가 생긴 뒤 다시 시도하면 폴백이 사라지고 새로 마운트된 지도가 뜬다 (AC-2)', () => {
    // 준비 — 키 없이 렌더해 폴백 상태를 만든다.
    withoutMapKey();
    renderShell();
    expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();

    // 실행 — 키를 넣고 다시 시도.
    withMapKey();
    fireEvent.press(screen.getByTestId('map-sheet-fallback-retry'));

    // 단언 — 폴백이 걷히고 실제 지도(map-native)가 뜬다.
    expect(screen.queryByTestId('map-sheet-fallback')).toBeNull();
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
  });

  it('🔴 SH13c · 키가 여전히 없으면 다시 시도할 때마다 폴백이 다시 뜬다 (AC-2 짝 — 크래시·빈 화면 없음)', () => {
    // 준비 — 키 없음.
    withoutMapKey();
    renderShell();

    // 실행/단언 — 두 번 눌러도 매번 폴백으로 돌아오고, 지도 자리가 비지 않으며 시트는 남는다.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.press(screen.getByTestId('map-sheet-fallback-retry'));

      expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();
      expect(screen.queryByTestId('map-root')).toBeNull();
      expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
    }
  });

  it('SH13d · 소비처가 mapFallback 을 주면 그 노드가 이기고 셸 기본 폴백은 안 뜬다 (AC-3 · 선제 green)', () => {
    // 준비 — 키 없음 + 소비처 폴백.
    withoutMapKey();

    // 실행
    renderShell({
      mapFallback: <Text testID="fake-map-fallback">소비처 폴백</Text>,
    });

    // 단언 — 소비처 노드만 뜬다(셸 기본 바·지도 없음).
    expect(screen.getByTestId('fake-map-fallback')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-sheet-fallback')).toBeNull();
    expect(screen.queryByTestId('map-root')).toBeNull();
  });

  it('SH13e · 키가 있고 실패가 없으면 지도만 뜨고 폴백은 없다 (AC-4 · 선제 green 회귀 앵커)', () => {
    // 준비 — 키 있음.
    withMapKey();

    // 실행
    renderShell();

    // 단언 — "항상 폴백" 오구현이면 여기서 red.
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-sheet-fallback')).toBeNull();
  });

  it('SH13f · 셸 폴백이 이미 뜬 뒤 소비처가 mapFallback 을 넘기면 소비처 노드가 이긴다 (AC-3 짝 · 03b 경고-2)', () => {
    // 왜 필요한가 — SH13d 는 처음부터 mapFallback 을 줘서 MapView 가 한 번도 안 만들어진다(셸 실패 상태가
    // 영영 false). 두 폴백이 **동시에 후보인 순간**을 만들어야 우선순위를 본다.
    const shell = (mapFallback?: ReactNode) => (
      <MapSheetShell
        center={CENTER}
        pins={PINS}
        days={DAYS}
        selectedDayIndex={0}
        onSelectDay={jest.fn()}
        onBack={jest.fn()}
        header={<Text testID="fake-header">헤더</Text>}
        mapFallback={mapFallback}
      >
        <Text testID="fake-body">본문</Text>
      </MapSheetShell>
    );

    // 준비 — 키 없이, mapFallback 없이 렌더 → 셸 실패 상태가 켜져 셸 기본 폴백이 뜬다.
    withoutMapKey();
    const { rerender } = render(shell());
    expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();

    // 실행 — 같은 인스턴스에 소비처 폴백을 넘겨 다시 렌더(셸 실패 상태는 그대로 true).
    rerender(shell(<Text testID="fake-map-fallback">소비처 폴백</Text>));

    // 단언 — 소비처 노드만 뜨고 셸 기본 바는 물러난다.
    expect(screen.getByTestId('fake-map-fallback')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-sheet-fallback')).toBeNull();
    expect(screen.queryByTestId('map-root')).toBeNull();
  });
});

/* ──────────────── TRIP-920 · 시트를 끝까지 내리면(닫힘) 지도가 풀린다 ────────────────
 * 셸이 `<BottomSheet onChange>` 로 "지금 멈춘 칸"을 받아 자기 상태(useState)에 들고, 그 칸이 **기본 배열의
 * 닫힘(0번)** 일 때만 지도 잠금을 푼다(viewOnly off → 팬·줌). 열린 칸(peek·펼침)은 지금처럼 잠긴 글랜스이고,
 * 닫힘에선 CTA 바를 그리지 않는다(28px 핸들을 CTA 가 덮어 되올릴 손잡이가 사라지는 것 방지 — 01b Q2).
 *
 * ★ 통과형 시트 목은 스스로 움직이지 않는다 → 테스트가 host 의 `onChange(index)` 를 **직접** 부르고, 상태
 *   변경이 반영되도록 `act` 로 감싼다(02a ★6·★7). 관측점은 새 testID 없이 둘뿐이다(01b Q4):
 *   지도 제스처 4 prop(`map-native`, SH10 선례)과 `sheet-cta-root` 유무.
 * ★ "0번 = 닫힘" 은 **기본 배열에서만** 참이다. snapPoints 를 직접 준 소비처(i05 `['40%','88%']`)의 0번은 40%
 *   시트다(02a ★3) — SH14d 가 잠근다. `mapViewOnly={false}`(i01)는 어떤 칸에서도 풀린 채다(★9, SH14e).
 * ⚠️ 원리적 사각(02a ★13): 실제 스냅 이동·핸들이 CTA/홈 인디케이터에 가리는지·네이티브 지도가 실제로 팬·줌
 *   되는지·라이브러리가 언제 onChange 를 부르는지는 jest 가 못 본다 → AC-V1~V3(6-b).
 *
 * 3동작 뼈대: 준비=키 주입 + 셸 렌더 → 실행=`changeSnap(index)` → 단언=제스처 4 prop·CTA·칩·폴백.
 * ─────────────────────────────────────────────────────────────────────── */

/** 시트가 그 칸에 **도착해 멈췄다**를 흉내 낸다 — host 의 onChange 를 act 안에서 직접 부른다. */
function changeSnap(index: number): void {
  const onChange = sheetHost().props.onChange as
    ((index: number, position: number, type: number) => void) | undefined;
  expect(onChange).toBeDefined();
  act(() => onChange?.(index, 0, 0));
}

/** 지도 잠금 — 잠김이면 제스처 4 prop 이 전부 false, 풀림이면 전부 true. */
function expectMapLocked(locked: boolean): void {
  const map = screen.getByTestId('map-native');
  GESTURE_TOGGLES.forEach((toggle) => expect(map.props[toggle]).toBe(!locked));
}

describe('🔴 MapSheetShell · SH14 — 닫힘 칸에서만 지도가 풀린다 (TRIP-920)', () => {
  afterEach(restoreMapKey);

  it('SH14a · 닫힘에 도착하면 제스처 4종이 켜지고 일차 칩·mapCard 는 그대로다 (AC-3)', () => {
    // 준비 — 키 주입 + 지도 위 추가 카드.
    withMapKey();
    renderShell({
      mapCard: <Text testID="fake-map-card">일정이 확정됐어요</Text>,
    });

    // 실행 — 시트를 끝까지 내려 닫힘(0번)에 멈춘다.
    changeSnap(0);

    // 단언 — 지도가 풀리고, 지도 위 오버레이는 남는다.
    expectMapLocked(false);
    expect(screen.getByTestId('sheet-daychip-root')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-map-card')).toBeOnTheScreen();
  });

  it('SH14b · 닫힘에선 CTA 바가 없고, peek·펼침으로 다시 올리면 지도가 잠기고 헤더·본문·CTA 가 돌아온다 (AC-4 · AC-7)', () => {
    // 준비
    withMapKey();
    renderShell();

    // 실행/단언 ① — 닫힘: CTA 바 미렌더(핸들 가림 방지).
    changeSnap(0);
    expectMapLocked(false);
    expect(screen.queryByTestId('sheet-cta-root')).toBeNull();

    // 실행/단언 ② — peek 로 올림: 원래 얼굴 + 다시 잠금("onChange 마다 뒤집기" 오구현이면 여기서 red, 02a ★8).
    changeSnap(1);
    expectMapLocked(true);
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();

    // 실행/단언 ③ — 펼침으로 한 번 더: 여전히 잠김 + 원래 얼굴.
    changeSnap(2);
    expectMapLocked(true);
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
  });

  it.each([1, 2])(
    'SH14c · (금지) 열린 칸 %i 에 도착해도 지도는 잠긴 채이고 CTA 는 그대로다 (AC-5)',
    (index) => {
      // 준비
      withMapKey();
      renderShell();

      // 실행 — 닫힘을 거치지 않고 열린 칸에 멈춘다.
      changeSnap(index);

      // 단언
      expectMapLocked(true);
      expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
    }
  );

  it('SH14d · (금지) snapPoints 를 직접 준 소비처(i05 모양)는 0번이 닫힘이 아니다 — 진입 칸 무변경 · 0번 도착에도 잠김 · CTA 유지 (AC-6 · 02a ★3·★4)', () => {
    // 준비 — i05 `ReplanSolvingView` 모양(2칸 배열, initialIndex 미전달).
    withMapKey();
    renderShell({ snapPoints: ['40%', '88%'] });

    // 단언 ① — 셸 기본 진입값(peek=1) 변경이 이 소비처로 새지 않는다: 여전히 0번(40%)으로 연다.
    expectSnapValue('40%');
    expectMapLocked(true);
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();

    // 실행 — 0번(= 40% 시트)에 도착.
    changeSnap(0);

    // 단언 ② — 닫힘 규칙 비적용: 잠김 유지 + CTA 유지.
    expectMapLocked(true);
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();
  });

  it.each<[string, (string | number)[] | undefined]>([
    ['기본 스냅', undefined],
    ['i01 스냅 [28, 55%, 86%]', [28, '55%', '86%']],
  ])(
    'SH14e · (금지) mapViewOnly={false}(i01 모양)는 %s 에서 어느 칸에 멈춰도 풀린 채다 (AC-6 · 02a ★9)',
    (_label, snapPoints) => {
      // 준비 — 여행 중 자유 탐색(허브) 모양.
      withMapKey();
      renderShell({ mapViewOnly: false, snapPoints });

      // 실행/단언 — 진입부터 1 → 2 → 0 전 구간 풀림.
      expectMapLocked(false);
      [1, 2, 0].forEach((index) => {
        changeSnap(index);
        expectMapLocked(false);
      });
    }
  );

  it('SH14f · 지도 실패(키 없음) 중에 닫힘으로 내려도 폴백 바가 그대로이고 화면이 비지 않는다 (AC-8 · INV-4)', () => {
    // 준비 — 키 없음 → 셸 기본 폴백(TRIP-919).
    withoutMapKey();
    renderShell();
    expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();

    // 실행 — 닫힘.
    changeSnap(0);

    // 단언 — 지도 자리는 여전히 폴백(크래시·빈 화면 없음), 오버레이·시트 내용은 남는다.
    expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(screen.getByTestId('sheet-daychip-root')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-body')).toBeOnTheScreen();
  });
});

/* ──────────────── TRIP-920 · 5-b 후속 — 시트가 콘텐츠 높이 칸을 몰래 끼우지 않는다 ────────────────
 * `@gorhom/bottom-sheet` 5.x 는 `enableDynamicSizing` 기본값이 **true** 라, 시트 내용 높이로 만든 칸 하나를
 * 넘긴 snapPoints 에 끼워 넣고 정렬한 배열에서 `index`·`onChange` 번호를 센다(03b 경고-1). 그러면
 * "0=닫힘 · 1=peek · 2=펼침" 번호표가 실기에서 어긋난다 — 내용이 짧은 h12-editor-empty 가 index 2 인데 45% 로 연다.
 *
 * ★ 통과형 목은 dynamic sizing 을 **재현하지 않는다**(넘긴 배열을 그대로 얹을 뿐). 그래서 이 파일과 소비처
 *   테스트의 칸 값 단언 `snapPoints[index]`(02a ★1)는 **"라이브러리가 배열을 고치지 않는다"는 전제** 위에서만
 *   실제 칸 값과 같다. 그 전제를 셸이 `enableDynamicSizing={false}` 로 직접 세우는지를 여기서 잠근다
 *   (02a ★15). 목은 prop 을 host View 에 그대로 펼친다 — 넘기면 `false`, 안 넘기면 `undefined`(02a §5).
 * `toBe(false)` 로 본다 — `undefined` 는 라이브러리 기본값 true 로 읽히므로 통과시키면 안 된다.
 * ⚠️ 원리적 사각: 끈 뒤 실제 높이가 28/45%/88% 인지는 6-b 실기(h12-editor-empty ↔ -filled 첫 높이 비교).
 * ─────────────────────────────────────────────────────────────────────── */
describe('🔴 MapSheetShell · SH15 — 시트에 enableDynamicSizing={false} 를 넘긴다 (TRIP-920 · 03b 경고-1)', () => {
  it.each<[string, (string | number)[] | undefined]>([
    ['기본 스냅', undefined],
    ['직접 준 snapPoints(i05 모양)', ['40%', '88%']],
    ['직접 준 snapPoints(i01 모양)', [28, '55%', '86%']],
  ])(
    'SH15 · %s 에서도 BottomSheet 가 enableDynamicSizing=false 를 받는다',
    (_label, snapPoints) => {
      // 준비/실행 — 셸 렌더.
      renderShell({ snapPoints });

      // 단언 — 시트 본체(host)가 받은 값이 정확히 false(미전달 undefined = 라이브러리 기본 true 라 red).
      expect(sheetHost().props.enableDynamicSizing).toBe(false);
    }
  );
});

/* ──────────────── TRIP-924 · list 슬롯의 빈 목록 안내(ListEmptyComponent) ────────────────
 * h13 장소 후보가 0건이면 시트가 헤더만 남고 비어 보인다. 셸은 **판단하지 않고** 소비처가 준 안내 노드를
 * `<BottomSheetFlatList ListEmptyComponent>` 로 통과시키기만 한다(언제 줄지는 소비처 몫 — 02a ★1).
 * 목의 `BottomSheetFlatList` 는 RN `FlatList` 라 data 0건일 때만 ListEmptyComponent 를 그린다(02a §5).
 * 3동작: 준비=list(data·ListEmptyComponent) 주입 렌더 → 실행=렌더 → 단언=안내가 리스트 안에 뜨는가/안 뜨는가.
 * ─────────────────────────────────────────────────────────────────────── */
function renderListShell(
  data: { id: string }[],
  listEmpty?: ReactElement | null
): void {
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
        testID: 'shell-list',
        ...(listEmpty !== undefined ? { ListEmptyComponent: listEmpty } : {}),
      }}
    >
      <Text testID="fake-body">본문</Text>
    </MapSheetShell>
  );
}

describe('MapSheetShell · SH16 — list 슬롯이 빈 목록 안내를 통과시킨다 (TRIP-924)', () => {
  it('SH16a · ListEmptyComponent 미전달 + 0건이면 셸이 아무 안내도 덧붙이지 않는다 (AC4 · 선제 green · 후방호환)', () => {
    // 준비/실행 — 기존 소비처 형태(안내 없이 빈 data).
    renderListShell([]);

    // 단언 — 리스트 안 글자는 헤더+본문 **정확히** 그뿐(완전 일치 — 셸 기본 안내 문구가 끼면 red, 02a ★3).
    expect(screen.getByTestId('shell-list')).toHaveTextContent('헤더본문');
  });

  it('🔴 SH16b · ListEmptyComponent 를 주고 0건이면 그 노드가 리스트 안에 뜬다 (AC1 셸 쪽)', () => {
    // 준비/실행 — 빈 data + 안내 노드.
    renderListShell([], <Text testID="fake-empty">비었음</Text>);

    // 단언 — 안내가 list.testID 노드 **안**에 뜬다(리스트 밖 오버레이로 그리면 red, 02a ★2).
    //   **red 성격**: 현행 셸은 ListEmptyComponent 를 FlatList 로 안 넘겨 아무것도 안 뜬다.
    expect(
      within(screen.getByTestId('shell-list')).getByTestId('fake-empty')
    ).toBeOnTheScreen();
  });

  it('SH16c · ListEmptyComponent 를 줘도 1건 이상이면 안내가 없다 (AC3 셸 쪽 · 선제 green)', () => {
    // 준비/실행 — 아이템 1건 + 안내 노드.
    renderListShell([{ id: 'x1' }], <Text testID="fake-empty">비었음</Text>);

    // 단언 — 아이템은 뜨고 안내는 없다(헤더·푸터 등 조건 없는 자리에 얹으면 red, 02a ★2).
    expect(screen.getByTestId('list-item-x1')).toBeOnTheScreen();
    expect(screen.queryByTestId('fake-empty')).toBeNull();
  });
});

/* ──────────────── TRIP-1014 · C(#076) — 셸 시트 기본값: 안전 영역 top · 키보드 내린 뒤 복귀 ────────────────
 * h13 장소 추가에서 검색하고 키보드를 내리면 시트가 상태바·다이내믹 아일랜드 위까지 올라간 채 남았다(#076).
 * 셸 BottomSheet 한 곳에 두 기본값을 넣어 소비처 전부가 받게 한다(새 셸 prop 없음).
 *   - `topInset` = 안전 영역 top — 시트 컨테이너 윗변을 상태바 아래로 내린다. **Provider 가 없으면 0**:
 *     `useSafeAreaInsets()` 는 Provider 가 없으면 throw 하므로 컨텍스트를 null 허용으로 읽는다(01b Q1,
 *     선례 `LiveHubView.tsx:194`). 이 리포 jest 에는 safe-area Provider·목이 없다(02a ★C1).
 *   - `keyboardBlurBehavior="restore"` — 키보드가 내려가면 키보드가 뜨기 전 칸으로 돌아온다(01b Q3).
 *
 * 무엇을 보장하나:
 *  - 🔴 SH17a 스크롤 경로·list 경로 둘 다 `restore` 를 받는다(#076 은 list 경로 h13 — 02a ★C7).
 *  - 🔴 SH17b top 47 을 넣으면 47, 안 넣으면 throw 없이 0 — 두 값이 짝이어야 하드코딩(0 이든 47 이든)이
 *    못 빠져나간다(02a ★C3).
 *  - 🟢 SH17c 하단 안전 영역을 넣으면 닫힘 칸만 그만큼 커지고(28→62) 나머지 시트 prop 은 그대로다.
 *
 * 값 주입은 `SafeAreaProvider` 가 아니라 `SafeAreaInsetsContext.Provider` 로 한다 — `SafeAreaProvider` 는
 * 네이티브에서 인셋을 받기 전까지 자식을 안 그린다(02a ★C2).
 * ⚠️ 원리적 사각: 윗변이 실제로 내려오는지·퍼센트 스냅이 줄어드는지·키보드를 내리면 칸이 돌아오는지는
 *   gorhom 런타임 몫이라 6-b 실기(`h13-place-add` — 02a ★C8). 여기선 prop 을 넘겼는지만 본다.
 *
 * 3동작 뼈대: 준비=(안전 영역 값을 넣어) 셸 렌더 → 실행=렌더 → 단언=시트 본체(host)가 받은 prop.
 * ─────────────────────────────────────────────────────────────────────── */
const SAFE_INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

function renderShellWithInsets(): ReturnType<typeof render> {
  return render(
    <SafeAreaInsetsContext.Provider value={SAFE_INSETS}>
      <MapSheetShell
        center={CENTER}
        pins={PINS}
        days={DAYS}
        selectedDayIndex={0}
        onSelectDay={jest.fn()}
        onBack={jest.fn()}
        header={<Text testID="fake-header">헤더</Text>}
      >
        <Text testID="fake-body">본문</Text>
      </MapSheetShell>
    </SafeAreaInsetsContext.Provider>
  );
}

describe('🔴 MapSheetShell · SH17 — 셸 시트가 안전 영역 top 과 키보드 복귀를 받는다 (TRIP-1014 #076)', () => {
  it.each<[string, () => void]>([
    ['스크롤 경로(list 미전달)', () => renderShell()],
    ['list 경로(h13 모양)', () => renderListShell([{ id: 'a' }])],
  ])(
    'SH17a · %s 에서 BottomSheet 가 keyboardBlurBehavior="restore" 를 받는다',
    (_label, renderIt) => {
      renderIt();

      expect(sheetHost().props.keyboardBlurBehavior).toBe('restore');
    }
  );

  it('SH17b · 안전 영역 top 47 이면 topInset 47, Provider 가 없으면 throw 없이 0 이다', () => {
    // ① Provider 로 top 47 을 넣는다.
    const first = renderShellWithInsets();
    expect(sheetHost().props.topInset).toBe(47);
    first.unmount();

    // ② Provider 없이(이 리포 jest 의 기본 상태) — 렌더가 끝까지 되고 0 이다.
    renderShell();
    expect(screen.getByTestId('fake-header')).toBeOnTheScreen();
    expect(sheetHost().props.topInset).toBe(0);
  });

  it('SH17c · 안전 영역을 넣으면 닫힘 칸만 그만큼 커지고 나머지 시트 prop 은 그대로다', () => {
    renderShellWithInsets();

    const host = sheetHost();
    expect(host.props.keyboardBehavior).toBe('interactive');
    expect(host.props.enableDynamicSizing).toBe(false);
    // 닫힘 칸은 28 + 하단 안전 영역(34) — 핸들이 홈 인디케이터 위에 오게(closedSnap 테스트).
    expect(host.props.snapPoints).toEqual([62, '45%', '88%']);
    expect(host.props.index).toBe(1);
  });
});

/* ───────────────────────────────────────────────────────────────────────
 * SH19 — 스크롤 끝 카드가 CTA 바 뒤에 숨지 않는다 (TRIP-935 · 결과 시트 마지막 카드 가림)
 *
 * CTA 바는 시트 위에 absolute 로 떠 있어, 본문 아래 여백이 모자라면 끝까지 스크롤해도 마지막 카드가 바 뒤에
 * 반쯤 남는다(h08 1일차 8번째 카드 실측). 그래서 본문 스크롤 뷰의 아래 여백 ≥ CTA 바 81 + 하단 안전 영역이어야
 * 한다(편집기 N5 와 같은 하한). 인셋 0·34·120 세 줄이 짝이라, 인셋을 빼먹은 고정값은 34·120 줄에서 걸린다.
 * 상한은 하한 + 24(카드 한 칸 틈 pb-2xl) — 여백이 몇 배로 불어 바 위에 빈 칸이 생기는 회귀를 잡는다.
 * 반대편(SH19b): CTA 가 없는 셸(h07 생성 중·i01 허브·Plan-B 재계산 중)은 덮을 바가 없으니 여백을 안 준다.
 * ⚠️ 원리적 사각: 실제로 카드가 바 위로 올라오는지는 gorhom 런타임 몫이라 6-b 실기.
 *
 * 3동작 뼈대: 준비=(하단 인셋·CTA 유무를 정해) 셸 렌더 → 실행=렌더 → 단언=본문 스크롤 뷰의 paddingBottom.
 * ─────────────────────────────────────────────────────────────────────── */
function renderShellWithBottomInset(
  bottom: number | null,
  cta: Parameters<typeof MapSheetShell>[0]['cta']
): void {
  const shell = (
    <MapSheetShell
      center={CENTER}
      pins={PINS}
      days={DAYS}
      header={<Text testID="fake-header">헤더</Text>}
      cta={cta}
    >
      <Text testID="fake-body">본문</Text>
    </MapSheetShell>
  );
  render(
    bottom === null ? (
      shell
    ) : (
      <SafeAreaInsetsContext.Provider
        value={{ top: 47, bottom, left: 0, right: 0 }}
      >
        {shell}
      </SafeAreaInsetsContext.Provider>
    )
  );
}

/** 본문 스크롤 뷰가 받은 paddingBottom. 목에선 시트 본체·스크롤 뷰가 같은 통과형이라 본문에서 가장 가까운
 *  통과형 조상이 스크롤 뷰다(SH18c 와 같은 식) — snapPoints 가 없어야 시트 본체를 잘못 집지 않은 것이다. */
function bodyPaddingBottom(): unknown {
  let scroll = screen.getByTestId('fake-body').parent;
  while (scroll && scroll.type !== (BottomSheetScrollView as unknown)) {
    scroll = scroll.parent;
  }
  if (!scroll) throw new Error('본문 스크롤 뷰가 없다');
  expect(Array.isArray(scroll.props.snapPoints)).toBe(false);
  const style = StyleSheet.flatten(scroll.props.contentContainerStyle) as
    { paddingBottom?: unknown } | undefined;
  return style?.paddingBottom;
}

const ONE_CTA = [
  { label: '확정하기', variant: 'primary' as const, onPress: jest.fn() },
];

describe('🔴 MapSheetShell · SH19 — 본문 아래 여백 = CTA 바 + 하단 안전 영역, CTA 없으면 0 (TRIP-935)', () => {
  it.each<[string, number, number | null]>([
    ['안전 영역 Provider 없음(인셋 0)', 81, null],
    ['하단 인셋 34(홈 인디케이터 기기)', 115, 34],
    ['하단 인셋 120(고정값으로는 못 맞추는 큰 값)', 201, 120],
  ])(
    '%s → 본문 스크롤 뷰 paddingBottom ≥ %i (상한 +24)',
    (_label, min, bottom) => {
      renderShellWithBottomInset(bottom, ONE_CTA);

      const padding = bodyPaddingBottom();
      expect(typeof padding).toBe('number');
      expect(padding as number).toBeGreaterThanOrEqual(min);
      expect(padding as number).toBeLessThanOrEqual(min + 24);
    }
  );

  it('SH19b · CTA 미전달·빈 배열이면 인셋 34 여도 본문 아래 여백이 없다', () => {
    for (const cta of [undefined, []]) {
      renderShellWithBottomInset(34, cta);
      expect(bodyPaddingBottom() ?? 0).toBe(0);
      screen.unmount();
    }
  });
});
