import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MustVisitSeedItem } from '../model/mustVisitSeed';
import { BackChevronGlyph, PlusGlyph, ThumbRemoveGlyph } from './TripGlyphs';

/**
 * S12 꼭 갈 곳 전용 목록(TRIP-676) — props-only 프레젠테이션.
 *
 * g01 요약 스트립의 "전체 보기"가 여는 화면이다. 이 여행의 시드(`MustVisitSeedItem[]`)를 세로
 * 목록으로 그리고, 카드마다 제거 ×·목록 밖에 더 담기/뒤로를 **콜백으로만** 낸다 — 조회·스토어·
 * 라우터는 배선(`MustVisitListPage`)이 진다(경계 규율, `mustVisitListStructure.test.ts`가 잠금).
 *
 * 비주얼 근거(Figma 전용 프레임 부재 — FG-3 대기): h05 `MustVisitPickerScreen`의 앱바+세로 카드
 * 레이아웃과 S1 `MustVisitStrip`의 카드 표면(썸네일·이름) 관례를 시각 기반으로 채택했다(01b D1).
 * 픽셀 확정은 FG-3 후속.
 *
 * `imageUrl` 이 `null` 이면 회색 자리로 두고 기본 이미지를 지어내지 않는다(INV-1). 지역(region)은
 * `MustVisitSeedItem` 계약에 없어 그리지 않는다(계약 공백 — 발명 금지).
 */

const SCREEN_TITLE = '꼭 갈 곳';
const MORE_LABEL = '더 담기';
const EMPTY_TITLE = '아직 담은 곳이 없어요';
const EMPTY_NOTE = '더 담기로 꼭 가고 싶은 곳을 담아보세요';

export interface MustVisitListScreenProps {
  items: MustVisitSeedItem[];
  onRemove(sourcePoiId: string): void;
  onAddMore(): void;
  onBack(): void;
}

/** 카드 한 장 — 썸네일(있으면 이미지·없으면 회색 자리) + 이름 + 제거 ×. 지역은 안 그린다. */
function MustVisitListCard({
  item,
  onRemove,
}: {
  item: MustVisitSeedItem;
  onRemove(sourcePoiId: string): void;
}): ReactElement {
  return (
    <View
      testID={`trip-mustvisit-list-card-${item.sourcePoiId}`}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-md"
    >
      {item.imageUrl === null ? (
        <View
          testID={`trip-mustvisit-list-imageplaceholder-${item.sourcePoiId}`}
          className="h-[64px] w-[64px] rounded-thumb bg-surface-strong"
        />
      ) : (
        <View className="h-[64px] w-[64px] overflow-hidden rounded-thumb bg-surface-strong">
          <Image
            testID={`trip-mustvisit-list-image-${item.sourcePoiId}`}
            source={{ uri: item.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        </View>
      )}
      <Text
        numberOfLines={1}
        className="flex-1 font-noto-bold text-card-title font-bold text-ink"
      >
        {item.name}
      </Text>
      <Pressable
        testID={`trip-mustvisit-list-remove-${item.sourcePoiId}`}
        accessibilityRole="button"
        accessibilityLabel="꼭 갈 곳에서 빼기"
        onPress={() => onRemove(item.sourcePoiId)}
        hitSlop={8}
        className="h-[28px] w-[28px] items-center justify-center rounded-pill bg-surface-strong"
      >
        <ThumbRemoveGlyph size={12} />
      </Pressable>
    </View>
  );
}

export function MustVisitListScreen({
  items,
  onRemove,
  onAddMore,
  onBack,
}: MustVisitListScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="trip-mustvisit-list-root" className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-sm bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="trip-mustvisit-list-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {SCREEN_TITLE}
          </Text>
        </View>

        <ScrollView
          contentContainerClassName="gap-md px-lg pb-2xl pt-[14px]"
          keyboardShouldPersistTaps="handled"
        >
          {items.length === 0 ? (
            <View
              testID="trip-mustvisit-list-empty"
              className="w-full items-center gap-xs py-2xl"
            >
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {EMPTY_TITLE}
              </Text>
              <Text className="font-noto text-caption text-muted">
                {EMPTY_NOTE}
              </Text>
            </View>
          ) : (
            items.map((item) => (
              <MustVisitListCard
                key={item.sourcePoiId}
                item={item}
                onRemove={onRemove}
              />
            ))
          )}

          <Pressable
            testID="trip-mustvisit-list-more"
            accessibilityRole="button"
            onPress={onAddMore}
            className="w-full flex-row items-center justify-center gap-[6px] rounded-card border-[1.5px] border-dashed border-hairline-strong py-lg"
          >
            <PlusGlyph size={20} />
            <Text className="font-noto-bold text-label font-bold text-primary-text">
              {MORE_LABEL}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
