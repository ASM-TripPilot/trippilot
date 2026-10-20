import type { ReactElement, ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { MapPin } from '@/shared/map';
import { buildFitRegion } from '@/shared/map/fitRegion';
import {
  expectHeightLimited,
  expectPinsInBand,
} from '@/test-support/fitBandAsserts';

import { MapSheetShell } from './MapSheetShell';

// TRIP-1416 FB5 — 셸 지도가 맞춤을 다시 계산했는지 센다(MapView 는 memo 라 같은 props 면 본문이 안 돈다).
// 동작은 실물 그대로 감싸기만 한다 → 이 파일의 다른 케이스는 무영향. jest.mock 은 파일 맨 위로 끌어올려진다.
jest.mock('@/shared/map/fitRegion', () => {
  const actual = jest.requireActual('@/shared/map/fitRegion');
  return { ...actual, buildFitRegion: jest.fn(actual.buildFitRegion) };
});

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

// SH9(snapPoints 미전달 3스냅 · 전달 그대로)은 TRIP-1356 에서 지웠다 — 파일 끝 합본의 CS3(기본 28)·CS4(직접 전달) 가 같은 prop 통과를 잠근다.

describe('MapSheetShell · SH10 — mapViewOnly 로 지도 잠금을 끈다 (TRIP-746 · Seed Q1)', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  // SH10a(mapViewOnly 미전달 = 제스처 4종 꺼짐)는 TRIP-1356 에서 지웠다 — SH5a·SH14b 의 expectMapLocked(true) 가 같은 기본 잠금을 잰다.

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

  // TRIP-1356 — 네 it(a 미전달 · b onSheetAnimate · c onSheetScrollBeginDrag · d onMapTap)을 한 흐름으로 합쳤다. 단언은 하나도 줄이지 않았다.
  it('SH12 · 세 prop 은 미전달이면 어디에도 콜백을 달지 않고(6 소비처 무회귀), 주면 각자 제 자리로 흘러간다', () => {
    // a) 미전달 — 짝 앵커: 지도와 시트가 실제로 떴다.
    const bare = render(
      <MapSheetShell
        center={CENTER}
        pins={PINS}
        onBack={jest.fn()}
        header={<Text testID="fake-header">헤더</Text>}
      >
        <Text testID="fake-body">본문</Text>
      </MapSheetShell>
    );
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
    expect(sheetHost().props.onAnimate).toBeUndefined();
    expect(scrollBeginDragNodes()).toHaveLength(0);
    expect(screen.getByTestId('map-native').props.onTapMap).toBeUndefined();
    bare.unmount();

    // b) onSheetAnimate 는 BottomSheet onAnimate 로 흘러 (from, to) 를 그대로 올린다.
    const onSheetAnimate = jest.fn();
    renderShell({ onSheetAnimate });
    const onAnimate = sheetHost().props.onAnimate as
      ((from: number, to: number, fp: number, tp: number) => void) | undefined;
    expect(onAnimate).toBeDefined();
    onAnimate?.(1, 2, 0, 0);
    expect(onSheetAnimate).toHaveBeenCalledTimes(1);
    expect(onSheetAnimate.mock.calls[0].slice(0, 2)).toEqual([1, 2]);
    screen.unmount();

    // c) onSheetScrollBeginDrag 는 시트 본체가 아니라 본문 스크롤 뷰에 달린다.
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
    screen.unmount();

    // d) onMapTap 은 지도 onTapMap 으로 흐른다.
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

/* ──── TRIP-1356 · 옛 MapSheetShell.closedSnap.test 합침 ──── */
/**
 * 닫힘 스냅이 홈 인디케이터 영역 안에 들어가던 결함 — 핸들(28px)이 화면 맨 아래 하단 안전 영역(≈34px)에
 * 묻혀 위로 쓸면 iOS 홈 제스처가 우선했다. 닫힘 높이를 `28 + 하단 안전 영역`으로 키워 핸들이 그 위에 오게 한다.
 *
 * 무엇을 보장하나(셸이 시트에 넘기는 snapPoints 값까지만):
 *  - 🔴 CS1 하단 안전 영역 34 → 닫힘 칸이 62(= 28 + 34), 나머지 칸은 그대로.
 *  - 🔴 CS5 하단 안전 영역 120 → 148 — 0·34·120 세 값이 짝이라 `34 이면 62` 식 고정값은 여기서 걸린다.
 *  - 🟢 CS2 하단 안전 영역 0(홈 버튼 기종·Provider 의 bottom 0) → 28 그대로.
 *  - 🟢 CS3 Provider 없음(jest 기본) → 28 그대로 — 기존 소비처 무회귀 앵커.
 *  - 🟢 CS4 소비처가 snapPoints 를 직접 주면 셸은 손대지 않는다(그쪽 계약은 소비처 소유).
 * ⚠️ 실제 홈 제스처 충돌 해소는 jest 사각 — 실기(TestFlight)로만 본다.
 *
 * 3동작 뼈대: 준비=Provider(bottom 값) → 실행=셸 렌더 → 단언=시트 목이 받은 snapPoints.
 */

function renderWithBottomInset(
  bottom: number | null,
  snapPoints?: (string | number)[]
) {
  const shell = (
    <MapSheetShell
      center={{ lat: 35.1587, lng: 129.1604 }}
      pins={[{ number: 1, lat: 35.16, lng: 129.16 }]}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      snapPoints={snapPoints}
    >
      <Text>본문</Text>
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

/** 셸이 시트 목에 넘긴 snapPoints — 목은 합성·호스트 겹이 여럿이라 첫 노드 값만 본다. */
function firstSheetSnapPoints(): unknown[] {
  const node = screen.root.findAll((n) =>
    Array.isArray(n.props?.snapPoints)
  )[0];
  return node.props.snapPoints as unknown[];
}

// TRIP-1507 — 지도가 풀블리드라 상태바 영역에 비치던 것을 흰 막으로 가린다(높이 = 상단 안전 영역).
describe('MapSheetShell · 상태바 영역 흰 막 (TRIP-1507)', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('상단 안전 영역 47 → 높이 47 의 막이 있고 터치를 통과시킨다', () => {
    renderWithBottomInset(34);
    const cover = screen.getByTestId('map-sheet-shell-statusbar-cover');
    expect(cover.props.style).toEqual(expect.objectContaining({ height: 47 }));
    expect(cover.props.pointerEvents).toBe('none');
  });

  it('Provider 없음(안전 영역 0) → 막을 그리지 않는다', () => {
    renderWithBottomInset(null);
    expect(screen.queryByTestId('map-sheet-shell-statusbar-cover')).toBeNull();
  });
});

describe('MapSheetShell · 닫힘 스냅이 홈 인디케이터 위에 온다', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('CS1 하단 안전 영역 34 → 닫힘 62, 나머지 칸은 그대로', () => {
    renderWithBottomInset(34);
    expect(firstSheetSnapPoints()).toEqual([62, '45%', '88%']);
  });

  it('CS5 하단 안전 영역 120 → 닫힘 148 — 34 로 외운 고정값 구현을 막는 짝(0·34·120)', () => {
    renderWithBottomInset(120);
    expect(firstSheetSnapPoints()).toEqual([148, '45%', '88%']);
  });

  it('CS2 하단 안전 영역 0 → 닫힘 28 그대로', () => {
    renderWithBottomInset(0);
    expect(firstSheetSnapPoints()).toEqual([28, '45%', '88%']);
  });

  it('CS3 Provider 없음 → 닫힘 28 그대로', () => {
    renderWithBottomInset(null);
    expect(firstSheetSnapPoints()).toEqual([28, '45%', '88%']);
  });

  it('CS4 소비처가 snapPoints 를 직접 주면 안전 영역이 있어도 손대지 않는다', () => {
    renderWithBottomInset(34, [100, '50%']);
    expect(firstSheetSnapPoints()).toEqual([100, '50%']);
  });
});

/* ──── TRIP-1356 · 옛 MapSheetShell.fitPins.test 합침 ──── */
/**
 * TRIP-1076 (3) · AC-3 — 셸이 "핀 전부 맞추기"(`fitPins`)를 자기 지도까지 흘린다(옵셔널 additive).
 *
 * 무엇을 보장하나:
 *  - 🔴 FS1 `fitPins` 를 주면 셸이 소유한 `<MapView>` 가 핀 전부를 담는 `region` 으로 열리고 `camera` 는 없다.
 *    결과 화면(h07·h08·h11·h14·h16)이 이 prop 하나로 옵트인한다.
 *  - 🟢 FS2 미전달이면 지금과 같다 — `region` 없이 `camera`(center) 경로(다른 셸 소비처 무회귀).
 *
 * 실 MapView 를 태운다 — 네이버 목(`__mocks__/@mj-studio/react-native-naver-map.tsx`)의 `map-native` 에
 * region·camera 가 그대로 실린다. 키가 없으면 MapView 가 실패 표면으로 떨어지므로 키를 넣고 돈다.
 * ⚠️ 실제 카메라 이동·시트가 가리는 영역은 jest 사각(6-b 실기 — Seed Q3: 시트 인셋 미반영).
 *
 * 3동작 뼈대: 준비=키 + 핀 3개 → 실행=셸 렌더(fitPins 유무) → 단언=map-native 의 region/camera.
 */

type NativeRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const FIT_CENTER = { lat: 35.1532, lng: 129.1186 };
// 광안리·황령산·해운대 — 서로 수 km 떨어진 결과 동선 3곳.
const FIT_PINS: MapPin[] = [
  { number: 1, lat: 35.1532, lng: 129.1186 },
  { number: 2, lat: 35.1573, lng: 129.0819 },
  { number: 3, lat: 35.1587, lng: 129.1604 },
];

function renderFitShell(fitPins?: boolean) {
  render(
    <MapSheetShell
      center={FIT_CENTER}
      pins={FIT_PINS}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      fitPins={fitPins}
    >
      <Text>본문</Text>
    </MapSheetShell>
  );
}

function fitNativeProps(): Record<string, unknown> {
  return screen.getByTestId('map-native').props as Record<string, unknown>;
}

describe('TRIP-1076 · 셸 핀 맞추기 통과 (AC-3)', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('🔴 FS1 fitPins 를 주면 셸 지도가 세 핀을 모두 담는 region 으로 열리고 camera 는 없다', () => {
    renderFitShell(true);

    const region = fitNativeProps().region as NativeRegion | undefined;
    expect(region).toBeDefined();
    if (region === undefined) return;
    FIT_PINS.forEach(({ lat, lng }) => {
      expect(lat).toBeGreaterThanOrEqual(region.latitude);
      expect(lat).toBeLessThanOrEqual(region.latitude + region.latitudeDelta);
      expect(lng).toBeGreaterThanOrEqual(region.longitude);
      expect(lng).toBeLessThanOrEqual(region.longitude + region.longitudeDelta);
    });
    // ★ 택일 — camera 가 같이 가면 SDK 가 region 을 버린다(목은 둘 다 기록해 공허 통과할 수 있다).
    expect(fitNativeProps().camera).toBeUndefined();
  });

  it('🟢 FS2 미전달이면 region 없이 camera(center) 로 연다 (기존 셸 소비처 무회귀)', () => {
    renderFitShell();

    expect(fitNativeProps().region).toBeUndefined();
    expect(fitNativeProps().camera).toBeDefined();
  });
});

/* ──── TRIP-1356 · 옛 MapSheetShell.radius.test 합침 ──── */
/**
 * TRIP-800 · AC-7 · 01b Q5 — 셸이 반경 원(`radiusCircle`)을 지도까지 흘린다(옵셔널 additive).
 *
 * 무엇을 보장하나:
 *  - 🔴 SR1 `radiusCircle` 을 주면 셸이 소유한 `<MapView>` 가 원을 그린다(네이버 목 `map-circle`) — 반경·중심이
 *    그대로 닿는다. h15 가 `mapFallback` 에 자체 지도를 끼우는 우회(폴백 슬롯 의미 오용)를 하지 않게 하는 자리.
 *  - 🟢 SR2 미전달이면 원이 없다 — 기존 셸 소비처(h07·h08·h11·h13·h14·h16·i 밴드) 무회귀 앵커.
 *
 * 기존 `MapSheetShell.test.tsx` 는 건드리지 않는다 — 새 prop 만 이 파일에서 잠근다.
 * 실 MapView 를 태우므로(목 아님) 네이버 목(`__mocks__/@mj-studio/react-native-naver-map.tsx`, 자동 적용)의
 * `map-circle` 에 props 가 그대로 실린다. 키가 없으면 MapView 가 실패 표면으로 떨어지므로 키를 넣고 돈다.
 * ⚠️ 원의 점선·색·실제 크기는 jest 사각(6-b 실기).
 *
 * 3동작 뼈대: 준비=키 + 원 prop → 실행=셸 렌더 → 단언=map-circle 의 radius·좌표.
 */

const RADIUS_CENTER = { lat: 35.1587, lng: 129.1604 };

function renderRadiusShell(radiusCircle?: {
  center: { lat: number; lng: number };
  radiusM: number;
}) {
  render(
    <MapSheetShell
      center={RADIUS_CENTER}
      pins={[{ number: 1, lat: 35.16, lng: 129.16 }]}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      radiusCircle={radiusCircle}
    >
      <Text>본문</Text>
    </MapSheetShell>
  );
}

describe('TRIP-800 · 셸 반경 원 통과 (AC-7 · Q5)', () => {
  beforeEach(withMapKey);
  afterEach(restoreMapKey);

  it('🔴 SR1 radiusCircle 을 주면 셸 지도에 원 1개 — 반경·중심이 그대로 닿는다', () => {
    // 준비·실행 — 무게중심 + 반경 1200m.
    renderRadiusShell({
      center: { lat: 35.1601, lng: 129.1502 },
      radiusM: 1200,
    });

    // 단언 — 원이 하나 그려지고, 넘긴 값이 네이티브 원 오버레이까지 닿았다.
    const circles = screen.queryAllByTestId('map-circle');
    expect(circles).toHaveLength(1);
    expect(circles[0].props.radius).toBe(1200);
    expect(circles[0].props.latitude).toBe(35.1601);
    expect(circles[0].props.longitude).toBe(129.1502);
  });

  it('🟢 SR2 미전달이면 원이 없다 (기존 셸 소비처 무회귀)', () => {
    renderRadiusShell();

    // 도달 앵커 — 지도는 실제로 떴다(원이 없는 이유가 "지도가 없어서"가 아니다).
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('map-circle')).toHaveLength(0);
  });
});

/* ──── TRIP-1356 · 옛 MapSheetShell.bodyScroll.test 합침 ──── */
/**
 * TRIP-1112 · 셸 가산 opt-in 2개(01b D1) — 편집기처럼 **본문 스크롤러를 스스로 쥐는** 소비처용.
 *
 *  - `bodyScroll={false}` — 셸이 body 를 `BottomSheetScrollView` 로 감싸지 않는다. 스크롤 안에 스크롤을
 *    겹치면 두 스크롤러가 같은 손가락을 두고 싸운다(브리프 H1). `list` 슬롯을 주면 list 가 이긴다.
 *  - `contentPanning={false}` — 시트 본체에 `enableContentPanningGesture={false}` 로 흘러 시트는 손잡이로만
 *    끌린다. 값은 정적이다(끄는 중에 뒤집으면 gorhom 이 본문을 재마운트한다 — 브리프 F1).
 *  - 둘 다 안 주면 지금 경로 그대로다(다른 셸 소비처 11곳 무회귀).
 *
 * 통과형 목 위 prop·조상 겹수 단언(SH18a~c)은 TRIP-1367 에서 지웠다 — 시트가 손잡이로만 끌리는지·본문이
 *   실제로 스크롤되는지는 실화면 QA 몫. 남은 SH18d 는 list 슬롯이 이기는 렌더 결과만 본다.
 */

function renderBodyScrollShell(
  overrides: Partial<Parameters<typeof MapSheetShell>[0]> = {}
): void {
  render(
    <MapSheetShell
      center={CENTER}
      pins={[]}
      days={[{ label: '1일차' }]}
      selectedDayIndex={0}
      onSelectDay={jest.fn()}
      onBack={jest.fn()}
      header={<Text testID="fake-header">헤더</Text>}
      cta={[{ label: '저장', variant: 'primary', onPress: jest.fn() }]}
      {...overrides}
    >
      <Text testID="fake-body">본문</Text>
    </MapSheetShell>
  );
}

describe('MapSheetShell · SH18 — body 비스크롤·콘텐츠 pan 정적 off opt-in (TRIP-1112 D1 · AC-J1·J2·J4)', () => {
  it('SH18d · list 를 주면 bodyScroll={false} 여도 list 슬롯이 이긴다 — header·children 은 리스트 안 (선제 green)', () => {
    renderBodyScrollShell({
      bodyScroll: false,
      list: {
        data: [{ id: 'a' }],
        renderItem: ({ item }) => (
          <Text testID={`list-item-${(item as { id: string }).id}`}>행</Text>
        ),
        keyExtractor: (item) => (item as { id: string }).id,
        testID: 'shell-list',
      },
    });

    const list = screen.getByTestId('shell-list');
    expect(within(list).getByTestId('list-item-a')).toBeOnTheScreen();
    expect(within(list).getByTestId('fake-body')).toBeOnTheScreen();
  });
});

/* ──── TRIP-1416 · 셸이 "시트가 안 가린 띠"에 핀을 맞춘다 ────
 * 지도는 화면 전체에 깔리고 시트가 아래를 덮는다. `fitPins` 를 켠 셸은 스냅 배열의 첫 `'%'` 칸(기본 45%,
 * 허브 55%)을 아래 가림으로, 세이프에어리어 top + 오버레이 줄을 위 가림으로, 창 세로/가로를 화면 비율로 삼아
 * 맞춤을 계산한다(Seed Q1~Q4). 시트가 지금 멈춘 칸에서는 띠를 뽑지 않는다 — 시트를 끌 때마다 카메라가
 * 처음 맞춤으로 튀면 사용자 제스처를 되돌린다(AC-10).
 *
 * 무엇을 보장하나:
 *  - 🔴 FB1 (AC-3) 기본 스냅 → 세 핀이 아래 45% 위 · 오버레이 줄(8+36) 아래 · 상자가 세로로 꽉 참.
 *  - 🔴 FB2 (AC-3·Q3) 세이프에어리어 top 200(과장값)이면 위 띠가 200+44 아래로 내려간다.
 *  - 🔴 FB3 (AC-4·Q4) 스냅 [닫힘,'55%',펼침] → 55% 기준, 펼침(2)으로 진입해도 같은 맞춤.
 *  - 🔴 FB4 (AC-5) 다른 날 핀으로 바뀌면 새로 맞추고 새 핀도 띠 안.
 *  - 🔴 FB5 (AC-10) 시트 칸이 바뀌어도 region 은 같은 객체, 1→2 에선 맞춤 재계산 0회(띠 객체 memo).
 *  - FB6 (AC-8) 핀 1개 → 띠 안 region(55% 스냅으로 잰다 — 가운데 50% 는 45% 띠를 우연히 통과) · 0개 → camera.
 * ⚠️ 실제 화면 맞춤(onLayout 재맞춤·시트 실제 높이·물방울 머리)은 jest 사각 → 6-b(AC-11).
 *
 * 3동작 뼈대: 준비=키 + 핀 + (Provider/스냅) → 실행=렌더·rerender·changeSnap → 단언=map-native region.
 */

const WINDOW = Dimensions.get('window');
const WINDOW_ASPECT = WINDOW.height / WINDOW.width;
// 셸 기본 오버레이 줄 바닥 = pt-sm 8 + 뒤로 버튼 36 — 위 예약값은 구현 재량이지만 이보다 작으면 핀이 칩 밑이다(02a ★6).
const SHELL_OVERLAY_ROW_BOTTOM = 8 + 36;
// 다른 날 — 해운대·기장(남북으로 긴 동선).
const OTHER_DAY_PINS: MapPin[] = [
  { number: 1, lat: 35.1631, lng: 129.1635 },
  { number: 2, lat: 35.2445, lng: 129.2222 },
];

function bandRegion(): NativeRegion | undefined {
  return fitNativeProps().region as NativeRegion | undefined;
}

function shellWithPins(
  pins: MapPin[],
  extra: Partial<Parameters<typeof MapSheetShell>[0]> = {}
): ReactElement {
  return (
    <MapSheetShell
      center={FIT_CENTER}
      pins={pins}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      fitPins
      {...extra}
    >
      <Text>본문</Text>
    </MapSheetShell>
  );
}

const fitCalls = (): number => jest.mocked(buildFitRegion).mock.calls.length;

describe('MapSheetShell · 보이는 띠 맞춤 (AC-3·AC-4·AC-5·AC-8·AC-10)', () => {
  // TRIP-1416
  beforeEach(() => {
    withMapKey();
    jest.mocked(buildFitRegion).mockClear();
  });
  afterEach(restoreMapKey);

  it('FB1 기본 스냅이면 세 핀이 아래 45% 위·오버레이 줄 아래 띠에 들고 상자가 세로로 꽉 찬다, camera 는 없다', () => {
    render(shellWithPins(FIT_PINS));

    expectPinsInBand(bandRegion(), FIT_PINS, {
      bottom: 0.45,
      topPx: SHELL_OVERLAY_ROW_BOTTOM,
      screenHeight: WINDOW.height,
    });
    expectHeightLimited(bandRegion(), FIT_PINS, WINDOW_ASPECT);
    expect(fitNativeProps().camera).toBeUndefined();
  });

  it('FB2 세이프에어리어 top 이 크면(200) 위 띠가 상태바+오버레이 줄(200+44) 아래로 내려간다', () => {
    // 준비 — 남북으로 긴 동선 + 과장된 상단 인셋. 1.4 여백이 47pt 정도의 누락은 흡수해 버려서(02a ★6),
    // 인셋을 무시하는 구현이 바닥값을 넘도록 키웠다(인셋 무시 시 위 핀 ≈149px · 바닥 244px).
    render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 200, bottom: 34, left: 0, right: 0 }}
      >
        {shellWithPins(OTHER_DAY_PINS)}
      </SafeAreaInsetsContext.Provider>
    );

    expectPinsInBand(bandRegion(), OTHER_DAY_PINS, {
      bottom: 0.45,
      topPx: 200 + SHELL_OVERLAY_ROW_BOTTOM,
      screenHeight: WINDOW.height,
    });
  });

  it("FB3 스냅이 [닫힘, '55%', 펼침] 이면 55% 기준이고, 펼침(2)으로 진입해도 중간(1) 진입과 같은 맞춤이다", () => {
    // 남북으로 긴 동선 — 동서 동선은 세로 맞춤으로 띠 가운데에 떠서 45% 를 그대로 써도 55% 를 우연히 넘는다.
    const hubSnaps = [28, '55%', 700];
    const { unmount } = render(
      shellWithPins(OTHER_DAY_PINS, {
        snapPoints: hubSnaps,
        initialIndex: 1,
      })
    );
    const atHalf = bandRegion();
    expectPinsInBand(atHalf, OTHER_DAY_PINS, {
      bottom: 0.55,
      topPx: SHELL_OVERLAY_ROW_BOTTOM,
      screenHeight: WINDOW.height,
    });
    unmount();

    render(
      shellWithPins(OTHER_DAY_PINS, {
        snapPoints: hubSnaps,
        initialIndex: 2,
      })
    );

    expect(bandRegion()).toEqual(atHalf);
  });

  it('FB4 다른 날 핀으로 바뀌면 새로 맞추고 새 핀도 아래 45% 위 띠에 든다', () => {
    const { rerender } = render(shellWithPins(FIT_PINS));
    const first = bandRegion();
    expectPinsInBand(first, FIT_PINS, {
      bottom: 0.45,
      topPx: SHELL_OVERLAY_ROW_BOTTOM,
      screenHeight: WINDOW.height,
    });

    rerender(shellWithPins(OTHER_DAY_PINS));

    expect(bandRegion()).not.toBe(first);
    expectPinsInBand(bandRegion(), OTHER_DAY_PINS, {
      bottom: 0.45,
      topPx: SHELL_OVERLAY_ROW_BOTTOM,
      screenHeight: WINDOW.height,
    });
  });

  it('FB5 (금지) 시트가 펼침·닫힘으로 옮겨도 region 은 처음 그 객체다 — 펼침 도착엔 맞춤을 다시 계산하지도 않는다', () => {
    // 준비 — 기본 스냅(peek)으로 연다. 앵커: 지금 region 이 띠를 지킨다(띠를 안 지키는 region 의 공허 통과 차단).
    render(shellWithPins(FIT_PINS));
    const first = bandRegion();
    expectPinsInBand(first, FIT_PINS, {
      bottom: 0.45,
      topPx: SHELL_OVERLAY_ROW_BOTTOM,
      screenHeight: WINDOW.height,
    });
    const callsBefore = fitCalls();

    // 실행 ① — 펼침(88%)에 멈춤. 지도 잠금·center·핀은 그대로라 MapView 가 다시 그려질 이유가 없다.
    changeSnap(2);

    // 단언 ① — 띠 객체가 렌더마다 새로 만들어지면 호출 수가 는다 · 띠를 지금 칸에서 뽑으면 region 이 바뀐다.
    expect(fitCalls()).toBe(callsBefore);
    expect(bandRegion()).toBe(first);

    // 실행 ② — 닫힘에 멈춤(지도 잠금이 풀려 MapView 는 다시 그려진다).
    changeSnap(0);

    // 단언 ② — 다시 그려져도 값이 같아 같은 객체(카메라가 처음 맞춤으로 튀지 않는다).
    expect(bandRegion()).toBe(first);
  });

  it("FB6 핀 1개면 그 핀이 아래 55%('55%' 스냅) 위 띠에 든 region 이고, 핀 0개면 region 없이 camera 다 (TRIP-1363 무회귀)", () => {
    // 55% 로 잰다 — 핀 1개를 가운데(50%)에 두는 지금 모양은 45% 띠는 우연히 통과한다.
    const one = [FIT_PINS[0]];
    const { unmount } = render(
      shellWithPins(one, { snapPoints: [28, '55%', 700] })
    );
    expectPinsInBand(bandRegion(), one, {
      bottom: 0.55,
      topPx: SHELL_OVERLAY_ROW_BOTTOM,
      screenHeight: WINDOW.height,
    });
    expect(fitNativeProps().camera).toBeUndefined();
    unmount();

    render(shellWithPins([]));

    expect(fitNativeProps().region).toBeUndefined();
    expect(fitNativeProps().camera).toBeDefined();
  });
});
