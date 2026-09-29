import BottomSheet from '@gorhom/bottom-sheet';
import { render, screen, within } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { MapSheetShell } from './MapSheetShell';

/**
 * TRIP-1112 · 셸 가산 opt-in 2개(01b D1) — 편집기처럼 **본문 스크롤러를 스스로 쥐는** 소비처용.
 *
 *  - `bodyScroll={false}` — 셸이 body 를 `BottomSheetScrollView` 로 감싸지 않는다. 스크롤 안에 스크롤을
 *    겹치면 두 스크롤러가 같은 손가락을 두고 싸운다(브리프 H1). `list` 슬롯을 주면 list 가 이긴다.
 *  - `contentPanning={false}` — 시트 본체에 `enableContentPanningGesture={false}` 로 흘러 시트는 손잡이로만
 *    끌린다. 값은 정적이다(끄는 중에 뒤집으면 gorhom 이 본문을 재마운트한다 — 브리프 F1).
 *  - 둘 다 안 주면 지금 경로 그대로다(다른 셸 소비처 11곳 무회귀).
 *
 * 관측 방법(02a ★1): gorhom 목은 `BottomSheet`·`BottomSheetScrollView` 가 **같은 통과형 컴포넌트**다.
 *   그래서 "스크롤 래퍼가 있다/없다" = 본문 노드 위에 그 통과형 조상이 **몇 겹**인가(기본 2 · opt-in 1).
 *   남는 한 겹은 snapPoints 를 쥔 시트 본체여야 한다.
 * ⚠️ 원리적 사각: 시트가 정말 손잡이로만 끌리는지·본문이 실제로 스크롤되는지는 목이 prop 을 무시해 6-b.
 *
 * 3동작 뼈대: 준비=opt-in 조합으로 셸 렌더 → 실행=렌더 → 단언=시트 본체 prop · 본문 위 통과형 조상 겹수.
 */

const CENTER = { lat: 35.1532, lng: 129.1188 };

function renderShell(
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

/** snapPoints 를 가진 host(문자열 타입) 노드 — 시트 본체(MapSheetShell.test SH12 와 같은 식). */
function sheetHost(): ReactTestInstance {
  const host = screen.root
    .findAll((node) => Array.isArray(node.props?.snapPoints))
    .find((node) => typeof node.type === 'string');
  if (!host) throw new Error('시트 host 노드가 없다');
  return host;
}

/** 노드 위(자기 제외)의 gorhom 통과형 조상들 — 가까운 것부터. 목에선 시트 본체와 본문 스크롤 뷰가 같은 타입이다. */
function sheetPassthroughAncestors(
  node: ReactTestInstance
): ReactTestInstance[] {
  const found: ReactTestInstance[] = [];
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.type === (BottomSheet as unknown)) found.push(cur);
  }
  return found;
}

/** 노드 위(자기 제외) 가장 가까운 host(문자열 타입) 조상 — 본문 틀 View 가 여기 잡힌다. */
function nearestHostAncestor(node: ReactTestInstance): ReactTestInstance {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (typeof cur.type === 'string') return cur;
  }
  throw new Error('host 조상이 없다');
}

/** 노드 위(자기 제외)의 RN `ScrollView` 조상 수 — gorhom 목(통과형)과 별개로 센다. */
function rnScrollViewAncestorCount(node: ReactTestInstance): number {
  let n = 0;
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.type === (ScrollView as unknown)) n += 1;
  }
  return n;
}

describe('MapSheetShell · SH18 — body 비스크롤·콘텐츠 pan 정적 off opt-in (TRIP-1112 D1 · AC-J1·J2·J4)', () => {
  it('🔴 SH18a · bodyScroll={false} 면 header·children 위에 스크롤 래퍼가 없고 시트 본체 한 겹뿐이다 (콘텐츠 pan 은 따로 — 미지정 유지)', () => {
    // 준비/실행 — 본문 스크롤만 끈다.
    renderShell({ bodyScroll: false });

    // 단언 — header·children 둘 다 시트 안에 그대로 그려지고, 그 위 통과형 조상은 시트 본체 하나다.
    for (const id of ['fake-header', 'fake-body']) {
      const ancestors = sheetPassthroughAncestors(screen.getByTestId(id));
      expect(ancestors).toHaveLength(1);
      expect(Array.isArray(ancestors[0].props.snapPoints)).toBe(true);
    }
    // 본문 틀 모양(5-b 경고-1) — 겹수만 세면 gorhom 이 아닌 래퍼·높이 제약 삭제가 green 이다.
    // ① 틀이 남은 높이를 채운다: header 바로 위 host 의 className 토큰에 `flex-1`. 빠지면 틀이 내용만큼
    //    자라 안쪽 Nestable 스크롤에 스크롤할 거리가 없어진다.
    const frameTokens = String(
      nearestHostAncestor(screen.getByTestId('fake-header')).props.className
    ).split(/\s+/);
    expect(frameTokens).toContain('flex-1');
    // ② gorhom 이 아닌 스크롤러(RN ScrollView)로도 감싸지 않는다 — 감싸면 스크롤 안의 스크롤(H1)이 돌아온다.
    //    이 경로의 gorhom 목엔 RN ScrollView 가 없어서 0 이 기준선이다.
    expect(rnScrollViewAncestorCount(screen.getByTestId('fake-body'))).toBe(0);
    // 짝 — 두 opt-in 은 서로 묶이지 않는다: 본문 스크롤만 껐으면 콘텐츠 pan 은 라이브러리 기본(미지정)이다.
    expect(sheetHost().props.enableContentPanningGesture).toBeUndefined();
  });

  it('🔴 SH18b · contentPanning={false} 면 시트 본체가 enableContentPanningGesture=false 를 받는다', () => {
    renderShell({ bodyScroll: false, contentPanning: false });

    // toBe(false) — 미전달(undefined)은 라이브러리 기본 true 로 읽힌다(02a ★2).
    expect(sheetHost().props.enableContentPanningGesture).toBe(false);
  });

  it('SH18c · 두 opt-in 을 안 주면 지금 경로 그대로다 — 스크롤 래퍼 한 겹 + 시트 본체, 콘텐츠 pan 미지정 (선제 green 회귀 앵커)', () => {
    renderShell();

    const ancestors = sheetPassthroughAncestors(
      screen.getByTestId('fake-body')
    );
    // 가까운 쪽 = 본문 스크롤 뷰(snapPoints 없음), 먼 쪽 = 시트 본체.
    expect(ancestors).toHaveLength(2);
    expect(Array.isArray(ancestors[0].props.snapPoints)).toBe(false);
    expect(Array.isArray(ancestors[1].props.snapPoints)).toBe(true);
    expect(sheetHost().props.enableContentPanningGesture).toBeUndefined();
  });

  it('SH18d · list 를 주면 bodyScroll={false} 여도 list 슬롯이 이긴다 — header·children 은 리스트 안 (선제 green)', () => {
    renderShell({
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
