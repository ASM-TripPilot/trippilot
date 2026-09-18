import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Trigger } from '@/shared/api/generated/schemas';

import { triggerLabel } from '../model/triggerLabel';
import type { TriggerWatchlistRow } from '../model/triggerWatchlist';
import {
  AppliedAlertGlyph,
  AppliedBackGlyph,
  ClockGlyph,
  ShopGlyph,
  WeatherCloudGlyph,
} from './PlanbGlyphs';

/**
 * TRIP-562 · i09 "감지된 변화" 열람 화면 — 순수 프레젠테이션(사영 결과를 props 로 받아 그리기만).
 *
 * 판정(3항목 접기·배너 선택)은 페이지가 순수 함수 `triggerWatchlist` 로 1회 수행하고(frontend-components
 * §2), 화면은 `{activeBanner, rows}` 를 받아 재판정 없이 그린다.
 *
 * honest rendering: `rows` 는 `{kind, label, status, reason}` 만 진다 — 활성 행 부제는 서버 `reason`,
 * 정상 행 부제는 정적 '정상'. 거리·poi명·시각은 계약(`Trigger`)에 없어 그릴 소스 자체가 없다.
 *
 * AC-3 실효 링크: 감시 행 아이콘을 `triggerLabel(kind).iconKey` 로 고른다(하드코딩 금지 — 종류
 * 완전성 가드가 소유하는 kind→iconKey 매핑을 화면까지 넓히는 자리, labelSource 소스 스캔이 잠근다).
 * 행 이름(카테고리명)은 사영 `row.label` 이 준다(상시 카테고리 상수).
 */

export interface TriggerWatchlistScreenProps {
  /** 발화 중 첫 non-MANUAL 트리거(없으면 배너 미렌더). */
  activeBanner: Trigger | null;
  rows: TriggerWatchlistRow[];
  /** [이 변화로 대안 보기] — 활성 배너 있을 때만 렌더, 재계획 세션 진입(페이지가 라우팅). */
  onPressAlternative: () => void;
  /** 하단 [지금 대안 찾기] — 트리거 없이 수동 재계획 진입(BR-U4-10). */
  onPressManual: () => void;
  onBack?: () => void;
}

/** kind → 감시 행 아이콘. `triggerLabel(kind).iconKey` 경유(AC-3 실효 링크, 하드코딩 금지). */
function iconFor(kind: TriggerWatchlistRow['kind']): ReactElement {
  const iconKey = triggerLabel(kind).iconKey;
  if (iconKey === 'weather') return <WeatherCloudGlyph size={22} />;
  if (iconKey === 'delay') return <ClockGlyph size={22} />;
  return <ShopGlyph size={22} />;
}

function WatchRow({ row }: { row: TriggerWatchlistRow }): ReactElement {
  const active = row.status === 'active';
  const kindKey = row.kind.toLowerCase();
  return (
    <View
      testID={`planb-triggers-item-${kindKey}`}
      className="flex-row items-center gap-md px-[14px] py-[13px]"
    >
      <View
        className={`h-[40px] w-[40px] items-center justify-center rounded-[10px] ${
          active ? 'bg-primary-pale' : 'bg-surface-strong'
        }`}
      >
        {iconFor(row.kind)}
      </View>
      <View className="flex-1 gap-[2px]">
        <Text className="font-noto-bold text-[14px] font-bold text-ink">
          {row.label}
        </Text>
        <Text
          testID={`planb-triggers-sub-${kindKey}`}
          className="font-noto text-label text-muted"
        >
          {active ? row.reason : '정상'}
        </Text>
      </View>
      <View
        className={`rounded-pill px-[10px] py-xs ${
          active ? 'bg-primary-pale' : 'bg-surface-strong'
        }`}
      >
        <Text
          testID={`planb-triggers-badge-${kindKey}`}
          className={`font-noto-bold text-caption font-bold ${
            active ? 'text-primary-text' : 'text-muted'
          }`}
        >
          {active ? '활성' : '정상'}
        </Text>
      </View>
    </View>
  );
}

export function TriggerWatchlistScreen({
  activeBanner,
  rows,
  onPressAlternative,
  onPressManual,
  onBack,
}: TriggerWatchlistScreenProps): ReactElement {
  return (
    <SafeAreaView
      testID="planb-triggers-screen"
      edges={['top', 'bottom']}
      style={{ flex: 1 }}
      className="bg-canvas-alt"
    >
      <View className="gap-[6px] bg-canvas px-lg pb-md pt-[14px]">
        {onBack ? (
          <Pressable
            testID="planb-triggers-back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBack}
          >
            <AppliedBackGlyph size={24} />
          </Pressable>
        ) : null}
        <Text className="font-noto-bold text-[20px] font-bold text-ink">
          감지된 변화
        </Text>
      </View>

      <ScrollView contentContainerClassName="gap-lg px-lg pb-lg pt-md">
        <Text className="font-noto text-[14px] text-muted">
          Plan-B가 이런 변화를 지켜보고 있어요
        </Text>

        {activeBanner ? (
          <View className="gap-[14px] rounded-card border-[1.8px] border-primary bg-canvas p-lg">
            <View className="flex-row items-center gap-md">
              <View className="h-[40px] w-[40px] items-center justify-center rounded-[10px] bg-primary-pale">
                <AppliedAlertGlyph size={22} />
              </View>
              <View className="flex-1">
                <Text
                  testID="planb-triggers-active-title"
                  className="font-noto-bold text-[16px] font-bold text-ink"
                >
                  {activeBanner.reason}
                </Text>
              </View>
              <View className="rounded-pill bg-primary-pale px-[10px] py-xs">
                <Text className="font-noto-bold text-caption font-bold text-primary-text">
                  활성
                </Text>
              </View>
            </View>
            <Pressable
              testID="planb-triggers-active-cta"
              accessibilityRole="button"
              onPress={onPressAlternative}
              className="h-12 items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                이 변화로 대안 보기
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          함께 보는 항목
        </Text>

        <View className="overflow-hidden rounded-card border border-hairline bg-canvas">
          {rows.map((row, index) => (
            <View key={row.kind}>
              {index > 0 ? <View className="h-px bg-hairline" /> : null}
              <WatchRow row={row} />
            </View>
          ))}
        </View>

        <Pressable
          testID="planb-triggers-manual-cta"
          accessibilityRole="button"
          onPress={onPressManual}
          className="h-[52px] items-center justify-center rounded-button bg-primary"
        >
          <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
            지금 대안 찾기
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
