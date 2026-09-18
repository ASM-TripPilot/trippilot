import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  ArrowsSwapGlyph,
  BellGlyph,
  ChevronRightGlyph,
  ContrastGlyph,
  DownloadGlyph,
  ExternalLinkGlyph,
  ForkKnifeGlyph,
  GaugeGlyph,
  PeopleGlyph,
  PersonGlyph,
  PinGlyph,
  StarGlyph,
  TrashGlyph,
  WonGlyph,
} from './SettingsGlyphs';

/** 행 key → 리딩 아이콘. Figma `1607:2440` 아이콘 배치. */
const LEADING_GLYPHS: Record<
  string,
  (props: { size?: number }) => ReactElement
> = {
  nickname: PersonGlyph,
  export: DownloadGlyph,
  style: ContrastGlyph,
  budget: WonGlyph,
  companions: PeopleGlyph,
  activities: StarGlyph,
  transport: ArrowsSwapGlyph,
  food: ForkKnifeGlyph,
  pace: GaugeGlyph,
  'location-consent': PinGlyph,
  notifications: BellGlyph,
  'affiliate-toggle': ExternalLinkGlyph,
  'delete-account': TrashGlyph,
};

function RowIcon({ rowKey }: { rowKey: string }): ReactElement | null {
  const Glyph = LEADING_GLYPHS[rowKey];
  return Glyph ? <Glyph size={22} /> : null;
}

/**
 * 행 골격 — 리딩 아이콘(24 슬롯) + 라벨 + 우측 액세서리. 커스텀 행(닉네임·내보내기·삭제)도
 * 이 골격 위에 어포던스를 얹어 시각 일관성을 지킨다.
 */
export function RowBody({
  rowKey,
  label,
  right,
}: {
  rowKey: string;
  label: string;
  right?: ReactNode;
}): ReactElement {
  return (
    <View className="flex-row items-center gap-md px-lg py-lg">
      <View className="w-6 items-center">
        <RowIcon rowKey={rowKey} />
      </View>
      <Text className="flex-1 font-noto-bold text-body text-ink">{label}</Text>
      {right}
    </View>
  );
}

/**
 * 준비 중(목적지 라우트 부재) 행 — 렌더하되 비활성이고 "준비 중"을 명시한다(AC-6, INV-4 —
 * 침묵 금지). `disabled` Pressable 이라 `toBeDisabled()` 로 잠긴다. testID 는 계수·단일행 조회용
 * 공통 `settings-row`.
 */
export function PreparingRow({
  rowKey,
  label,
}: {
  rowKey: string;
  label: string;
}): ReactElement {
  return (
    <Pressable
      testID="settings-row"
      disabled
      accessibilityState={{ disabled: true }}
    >
      <RowBody
        rowKey={rowKey}
        label={label}
        right={
          <Text className="font-noto text-micro text-muted-soft">준비 중</Text>
        }
      />
    </Pressable>
  );
}

/**
 * 네비 행(목적지 라우트가 선 활성 행) — `PreparingRow` 의 형제. RowBody + 우향 chevron 어포던스 +
 * onPress. testID 는 `settings-nav-{rowKey}` 로 `PreparingRow` 의 공통 `settings-row`(준비중)와
 * 구분된다 — 이 승격이 곧 심판이다(`ready` 플래그가 아니라 렌더가 물린다, 02a ★1). `disabled`·
 * `accessibilityState` 를 걸지 않아 `not.toBeDisabled()`. onPress 라우트는 페이지가 주입한다.
 */
export function NavRow({
  rowKey,
  label,
  onPress,
}: {
  rowKey: string;
  label: string;
  onPress?: () => void;
}): ReactElement {
  return (
    <Pressable testID={`settings-nav-${rowKey}`} onPress={onPress}>
      <RowBody
        rowKey={rowKey}
        label={label}
        right={<ChevronRightGlyph size={18} />}
      />
    </Pressable>
  );
}
