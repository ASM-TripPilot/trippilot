import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type {
  CompareRow as CompareRowVM,
  CompareRowKind,
} from '../model/compareRows';

/**
 * TRIP-570 · j02 비교 행 — kind('actual'|'unvisited'|'change')별로 라벨/배지/시각을 갈라 그린다.
 *
 * 한 컴포넌트가 VM 의 kind 로 갈라 그리되, 구분은 색이 아니라 **kind별 distinct 라벨 텍스트**로 잠근다
 * (글리프 fill 함정 회피). testID `record-compare-row` 는 kind 무관 루트(화면이 행 개수를 셈).
 * 변경 행은 전·후 장소를 **별개 Text leaf**로 그린다 — `getByText` 완전일치가 각각 잡히게.
 *
 * 토큰(Figma raw → 우리 토큰): 카드 border #ededed→hairline·radius 16→card / 변경 카드 코랄 점선
 * #ff385c→primary(border-dashed) / 배지·pill bg #f2f2f2→surface-strong·#ffe4e9→primary-pale,
 * 배지 텍스트 #6a6a6a→muted·#c13515→primary-text / 장소명 #222→ink 14px→body / 부제 13px→label.
 */

const BADGE: Record<
  CompareRowKind,
  { label: string; box: string; text: string }
> = {
  actual: { label: '[실제]', box: 'bg-surface-strong', text: 'text-ink' },
  unvisited: { label: '[계획]', box: 'bg-surface-strong', text: 'text-muted' },
  change: {
    label: '[변경]',
    box: 'bg-primary-pale',
    text: 'text-primary-text',
  },
};

function Badge({ kind }: { kind: CompareRowKind }): ReactElement {
  const style = BADGE[kind];
  return (
    <View
      className={`items-center rounded-pill px-[8px] py-[3px] ${style.box}`}
    >
      <Text className={`font-noto-bold text-micro ${style.text}`}>
        {style.label}
      </Text>
    </View>
  );
}

function StatusPill({ children }: { children: string }): ReactElement {
  return (
    <View className="items-center rounded-pill bg-surface-strong px-[8px] py-[3px]">
      <Text className="font-noto text-micro text-muted">{children}</Text>
    </View>
  );
}

export interface CompareRowProps {
  row: CompareRowVM;
}

export function CompareRow({ row }: CompareRowProps): ReactElement {
  const rootClass =
    row.kind === 'change'
      ? 'w-full gap-[7px] rounded-card border-[1.5px] border-dashed border-primary bg-canvas p-[14px]'
      : 'w-full gap-[7px] rounded-card border border-hairline bg-canvas p-[14px]';

  return (
    <View testID="record-compare-row" className={rootClass}>
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-[8px]">
          <Badge kind={row.kind} />
          {row.kind === 'change' ? (
            <>
              <Text className="font-noto-bold text-body text-ink">
                {row.beforeLabel}
              </Text>
              <Text className="font-noto text-label text-muted">→</Text>
              <Text className="font-noto-bold text-body text-ink">
                {row.afterLabel}
              </Text>
            </>
          ) : (
            <Text className="font-noto-bold text-body text-ink">
              {row.placeLabel}
            </Text>
          )}
        </View>
        {row.kind === 'unvisited' ? <StatusPill>미방문</StatusPill> : null}
        {row.kind === 'change' && row.reason ? (
          <StatusPill>{row.reason}</StatusPill>
        ) : null}
      </View>

      {row.kind === 'actual' ? (
        <Text className="font-noto text-label text-muted">
          {row.timeLabel} 방문
        </Text>
      ) : null}
      {row.kind === 'change' ? (
        <Text className="font-noto text-label text-muted">
          {row.timeLabel} 변경
        </Text>
      ) : null}
    </View>
  );
}
