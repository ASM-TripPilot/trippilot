import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { SettingsRowChip } from '../model/settingsSections';

import {
  ArrowsSwapGlyph,
  BellGlyph,
  ChevronRightGlyph,
  ContrastGlyph,
  DocumentGlyph,
  DownloadGlyph,
  ExternalLinkGlyph,
  ForkKnifeGlyph,
  GaugeGlyph,
  LogoutGlyph,
  MUTED_SOFT,
  PeopleGlyph,
  PersonGlyph,
  PinGlyph,
  SparkleGlyph,
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
  personalization: SparkleGlyph,
  notifications: BellGlyph,
  'affiliate-toggle': ExternalLinkGlyph,
  logout: LogoutGlyph,
  'delete-account': TrashGlyph,
  // TRIP-937 앱 정보 약관 3행 — 발명 글리프(Figma 역반영 대상).
  'terms-TERMS_OF_SERVICE': DocumentGlyph,
  'terms-PRIVACY_POLICY': DocumentGlyph,
  'terms-LOCATION_TERMS': DocumentGlyph,
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
 *
 * TRIP-778: chevron 앞에 요약 값(14 muted) 또는 칩(r8 — 킷 §3 pill=8 코드 동기화 대기라 임의값)을
 * 얹는다. 둘 다 없으면 chevron 만.
 */
export function NavRow({
  rowKey,
  label,
  value,
  chip,
  onPress,
}: {
  rowKey: string;
  label: string;
  value?: string | null;
  chip?: SettingsRowChip | null;
  onPress?: () => void;
}): ReactElement {
  return (
    <Pressable testID={`settings-nav-${rowKey}`} onPress={onPress}>
      <RowBody
        rowKey={rowKey}
        label={label}
        right={
          <View className="flex-row items-center gap-[6px]">
            {value ? (
              <Text className="font-noto text-body text-muted">{value}</Text>
            ) : null}
            {chip ? <RowChip rowKey={rowKey} chip={chip} /> : null}
            <ChevronRightGlyph
              size={18}
              color={MUTED_SOFT}
              testID={`settings-nav-${rowKey}-chevron`}
            />
          </View>
        }
      />
    </Pressable>
  );
}

function RowChip({
  rowKey,
  chip,
}: {
  rowKey: string;
  chip: SettingsRowChip;
}): ReactElement {
  const tone =
    chip.tone === 'primary'
      ? { box: 'bg-primary-pale', text: 'text-primary-text' }
      : { box: 'bg-surface-strong', text: 'text-muted' };
  return (
    <View
      testID={`settings-chip-${rowKey}`}
      className={`rounded-[8px] px-[10px] py-xs ${tone.box}`}
    >
      <Text className={`font-noto-bold text-micro ${tone.text}`}>
        {chip.label}
      </Text>
    </View>
  );
}
