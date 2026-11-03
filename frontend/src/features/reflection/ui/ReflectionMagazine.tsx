import type { ReactElement } from 'react';
import { View } from 'react-native';

import { RevealItem } from '@/shared/ui/RevealItem';

import { MAGAZINE_TONES } from '../model/categoryPalette';
import type { MagazineVM } from '../model/magazineVM';
import {
  MagazineCover,
  MagazineHashtags,
  MagazinePlanChange,
  MagazineQuote,
  MagazineRoute,
  MagazineSceneCard,
  MagazineStats,
} from './MagazineParts';

/**
 * TRIP-1665 · 회고 매거진 — 표지 → 인용문 → 장면 카드 → 일정 변경 띠 → 동선 → 숫자 → 해시태그 순으로 이어 그린다.
 * VM 하나만 받는 무상태 뷰(조회·계산 0)라 프리뷰가 네트워크 없이 그린다. 풀폭 종이색 바탕이라 부모의 좌우 패딩을
 * `-mx-lg` 로 되받는다. 등장은 `RevealItem`(아래→위, 차례로)이고 동작 줄이기면 처음부터 보인다.
 * testID 는 `{testIDPrefix}-cover|narrative|narrative-edit|scenes|scene-NN|plan-change|route|route-stop-N|stats|hashtags`.
 */
export interface ReflectionMagazineProps {
  vm: MagazineVM;
  testIDPrefix: string;
  /** 있을 때만 인용문 옆 "수정" 링크가 선다. */
  onEditNarrative?: () => void;
}

const FIRST_DELAY_MS = 300;

export function ReflectionMagazine({
  vm,
  testIDPrefix: p,
  onEditNarrative,
}: ReflectionMagazineProps): ReactElement {
  // 위에서부터 한 칸씩 150ms 늦게 나오도록 등장 순번을 차례로 매긴다(렌더 순서가 곧 순번).
  let order = 0;
  const parts: ReactElement[] = [];
  const reveal = (key: string, node: ReactElement) =>
    parts.push(
      <RevealItem key={key} index={order++} firstDelayMs={FIRST_DELAY_MS}>
        {node}
      </RevealItem>
    );

  reveal(
    'quote',
    <MagazineQuote
      quote={vm.quote}
      testID={`${p}-narrative`}
      editTestID={`${p}-narrative-edit`}
      onEdit={onEditNarrative}
    />
  );
  if (vm.scenes.length > 0)
    parts.push(
      <View key="scenes" testID={`${p}-scenes`} className="gap-lg">
        {vm.scenes.map((scene) => (
          <RevealItem
            key={scene.key}
            index={order++}
            firstDelayMs={FIRST_DELAY_MS}
          >
            <MagazineSceneCard
              scene={scene}
              testID={`${p}-scene-${scene.number}`}
            />
          </RevealItem>
        ))}
      </View>
    );
  vm.planChanges.forEach((change, i) =>
    reveal(
      `plan-${i}`,
      <MagazinePlanChange change={change} testID={`${p}-plan-change`} />
    )
  );
  if (vm.route !== null && vm.route.length > 0) {
    // 박스는 가만히 있고 안의 정류장이 한 곳씩 나온다.
    parts.push(
      <View key="route" className="pt-lg">
        <MagazineRoute
          route={vm.route}
          palette={vm.cover.palette}
          testID={`${p}-route`}
          firstIndex={order}
        />
      </View>
    );
    order += vm.route.length;
  }
  reveal('stats', <MagazineStats stats={vm.stats} testID={`${p}-stats`} />);
  if (vm.hashtags.length > 0)
    reveal(
      'tags',
      <MagazineHashtags tags={vm.hashtags} testID={`${p}-hashtags`} />
    );

  return (
    <View
      className="-mx-lg w-auto"
      style={{ backgroundColor: MAGAZINE_TONES.paper }}
    >
      <MagazineCover cover={vm.cover} testID={`${p}-cover`} />
      {parts}
    </View>
  );
}
