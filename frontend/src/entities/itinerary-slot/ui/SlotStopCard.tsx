import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { ALT_LABEL } from '../config/altLabel';
import { buildSlotKey } from '../lib/slotKey';
import { ChevronRightGlyph, ClockGlyph } from './SlotGlyphs';
import { SlotPhotoPlaceholder } from './SlotPhotoPlaceholder';

/**
 * TRIP-783 · 결과 화면 공용 슬롯 카드 — h07·h08·h11·h14·h16 6종이 공유할 부품(신설·병존,
 * `PoiSlotCard` 대체 아님). presentation-only(useState 0, 콜백 주입).
 *
 * "받으면 그린다"(3-a 결정): `timeLabel` 을 받으면 시각 칩을, `required`/`fixed` 면 배지를,
 * `onPressAlt` 가 있으면 "다른 후보 ›" 링크를 그린다. 시각 표시 정책(h08 표시/h14 표시)은 소비처가
 * 문자열을 조립할지 말지로 정하고, 카드는 받은 값만 그린다(startAt 절삭·시각 판정을 카드가 안 함).
 *
 * 각 leaf 는 값 하나만 담아 `toHaveTextContent` **완전일치**로 잠긴다 — 시각·태그·이름을 다른 Text 로
 * 뗀다. 이름 뒤 `›`·"다른 후보" 뒤 `›` 중 이름 chevron 은 **글리프**(텍스트 아님)라 이름 leaf 텍스트가
 * 이름 하나로 유지되고, "다른 후보 ›" 의 `›` 는 상수(`ALT_LABEL`)에 든 **텍스트**다.
 *
 * 반쪽 계약: 사진 null → `SlotPhotoPlaceholder`(카테고리 틴트+아이콘, 더미 사진 금지 INV-1) · 시각
 * null → 칩 요소 부재(빈 칩 금지). 소요시간 문자열은 없다(INV-3 — 시각 칩은 시각 범위이지 소요시간 아님).
 */

// 카드 그림자(Figma 0 4 16 rgba(0,0,0,0.08)). RN 은 box-shadow 가 없어 스타일로 옮긴다. `#000000` 은
// 브랜드 팔레트(raw-hex 가드 목록) 밖이라 그림자 색으로 정당하다(PoiSlotCard·ManualEditShell 선례 동형).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 2,
} as const;

export interface SlotStopCardProps {
  slot: ItineraryDaysItemSlotsItem;
  /** slotKey 조립용 활성 날짜(페이지가 고른 날). */
  date: string;
  /** 이 날 안에서의 순번 — 번호 배지(index+1). 지도 핀 번호와 같은 값. */
  index: number;
  /** 시각 칩 문구 `HH:mm–HH:mm`(소비처 조립). 미주입이면 칩 요소 자체를 안 그린다(엣지 E2). */
  timeLabel?: string | null;
  /** 필수 방문지 배지(이름 옆 분홍 pill). */
  required?: boolean;
  /** 고정 슬롯 배지(우측 pill, 숙소 등). */
  fixed?: boolean;
  /** 고정 슬롯 부제(`저녁 · 숙소 · 변경 불가` 등). */
  subtitle?: string | null;
  /** 이름 press(슬롯 선택 어포던스). 미주입이면 press 무해(no-op). */
  onPressName?: () => void;
  /** "다른 후보 ›" press. 미주입이면 링크 자체를 안 그린다(고정 슬롯엔 없음, 엣지 E5). */
  onPressAlt?: () => void;
}

export function SlotStopCard({
  slot,
  date,
  index,
  timeLabel,
  required,
  fixed,
  subtitle,
  onPressName,
  onPressAlt,
}: SlotStopCardProps): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const fieldId = (role: string): string => `slot-stopcard-${role}-${slotKey}`;
  const hasImage = slot.imageUrl !== null && slot.imageUrl !== undefined;
  const hasTime = timeLabel !== null && timeLabel !== undefined;

  return (
    <View
      testID={`slot-stopcard-${slotKey}`}
      style={cardShadow}
      className="flex-row items-start gap-[10px] rounded-card border border-hairline bg-canvas p-md"
    >
      {/* 번호 배지 — 24px squircle(rounded-[8px]) primary. */}
      <View className="h-[24px] w-[24px] items-center justify-center rounded-[8px] bg-primary">
        <Text
          testID={fieldId('number')}
          className="font-inter-bold text-caption font-bold text-on-primary"
        >
          {String(index + 1)}
        </Text>
      </View>

      {/* 사진 72×72 — 없으면 카테고리 플레이스홀더로 대체(엣지 E1). */}
      {hasImage ? (
        <Image
          testID={fieldId('photo')}
          source={{ uri: slot.imageUrl as string }}
          resizeMode="cover"
          className="h-[72px] w-[72px] rounded-thumb"
        />
      ) : (
        <SlotPhotoPlaceholder
          category={slot.category}
          testID={fieldId('photoplaceholder')}
        />
      )}

      {/* 텍스트 컬럼 — 각 leaf 는 값 하나. */}
      <View className="flex-1 gap-[6px]">
        {hasTime ? (
          <View className="flex-row items-center gap-xs self-start rounded-[8px] border border-hairline-strong bg-canvas px-sm py-[3px]">
            <ClockGlyph size={12} />
            <Text
              testID={fieldId('time')}
              className="font-noto-bold text-caption font-bold text-ink"
            >
              {timeLabel}
            </Text>
          </View>
        ) : null}

        <View className="flex-row items-center justify-between gap-[6px]">
          <View className="flex-1 flex-row items-center gap-[6px]">
            <Pressable
              testID={fieldId('name')}
              onPress={onPressName}
              className="flex-shrink flex-row items-center gap-[2px]"
            >
              <Text
                numberOfLines={1}
                className="font-noto-bold text-card-title font-bold text-ink"
              >
                {slot.nameKo ?? ''}
              </Text>
              <ChevronRightGlyph size={14} tone="muted" />
            </Pressable>
            {required ? (
              <View
                testID={fieldId('required')}
                className="rounded-pill bg-primary-pale px-sm py-[2px]"
              >
                <Text className="font-noto-bold text-micro font-bold text-primary-text">
                  필수
                </Text>
              </View>
            ) : null}
          </View>
          {fixed ? (
            <View
              testID={fieldId('fixed')}
              className="rounded-pill bg-surface-strong px-sm py-[2px]"
            >
              <Text className="font-noto-bold text-micro font-bold text-muted">
                고정
              </Text>
            </View>
          ) : null}
        </View>

        {slot.tags.length > 0 ? (
          <Text
            testID={fieldId('tags')}
            className="font-noto text-caption text-muted"
          >
            {slot.tags.join(' · ')}
          </Text>
        ) : null}

        {subtitle === null || subtitle === undefined ? null : (
          <Text
            testID={fieldId('subtitle')}
            className="font-noto text-caption text-muted"
          >
            {subtitle}
          </Text>
        )}

        {onPressAlt ? (
          <Pressable
            testID={fieldId('alt')}
            onPress={onPressAlt}
            className="self-start"
          >
            <Text className="font-noto text-caption text-primary-text">
              {ALT_LABEL}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
