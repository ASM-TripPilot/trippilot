import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { ALT_LABEL } from '../config/altLabel';
import type { ReplanSlotVM } from '../model';
import { ClockGlyph, LockGlyph } from './SlotGlyphs';
import { SlotPhotoPlaceholder } from './SlotPhotoPlaceholder';

/**
 * TRIP-751 · AC-3 — i05·i06 재계획안 슬롯 1행(순수 props+콜백, 라우팅·훅 모름). Figma `4314:1923`.
 *
 * 카드 안 좌측 번호 원(tone: visited 초록 / planned 빨강) · 사진 72(없으면 카테고리 플레이스홀더) ·
 * 시간 알약 · 장소명 · 카테고리 · "다른 후보". 값이 없으면 요소째 안 그린다(빈 알약 금지).
 * `SlotStopCard` 와 모양이 비슷하지만 입력(서버 슬롯+date)·이름 chevron 고정이 달라 따로 둔다(Seed Q2).
 *
 * ★ INV-3: 시간 알약은 주입된 시각 문자열을 통과 렌더할 뿐 소요시간을 조립하지 않는다.
 * ★ 흐림(opacity)은 카드 **루트에만** 건다 — 대안 없음 판정 단언이 루트 className 을 읽는다.
 */

// 카드 그림자(Figma 0 4 16 rgba(0,0,0,0.08)) — SlotStopCard 와 같은 값.
// 세로 치수는 Figma 4314:1962 기준: 카드 96 = 테두리 1 + 패딩 11 + 사진 72 + 11 + 1(Figma 는 테두리가
// 안쪽이라 RN 에선 패딩을 1 줄인다). 글 칸 70 = 알약 25 + 6 + 이름 18 + 6 + 카테고리 15 — 토큰 기본 줄
// 높이(16·20)를 쓰면 글 칸이 사진보다 커져 카드가 행마다 늘어난다(TRIP-751 6단계 육안 게이트 실측).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 2,
} as const;

export interface ReplanSlotRowProps {
  vm: ReplanSlotVM;
  /** 0부터 — 번호 원은 index+1 을 그린다(TRIP-751). */
  index: number;
  /** 대안 없음의 예정 행 흐림 — VM 이 아니라 뷰가 정한다(Seed Q3). */
  dimmed?: boolean;
  /** 주면 "다른 후보" 링크를 그린다(고정 행 제외). */
  onPressCandidates?: (slotKey: string) => void;
}

export function ReplanSlotRow({
  vm,
  index,
  dimmed,
  onPressCandidates,
}: ReplanSlotRowProps): ReactElement {
  const {
    slotKey,
    placeName,
    tone,
    photo,
    category,
    timeLabel,
    categoryLabel,
  } = vm;
  const fieldId = (role: string): string =>
    `planb-draft-slot-${role}-${slotKey}`;

  return (
    <View
      testID={`planb-draft-slot-${slotKey}`}
      style={cardShadow}
      className={`flex-row items-start gap-[10px] rounded-card border border-hairline bg-canvas p-[11px]${
        dimmed ? ' opacity-45' : ''
      }`}
    >
      <View
        testID={fieldId('number')}
        className={`h-[24px] w-[24px] items-center justify-center rounded-pill ${
          tone === 'visited' ? 'bg-success' : 'bg-primary'
        }`}
      >
        <Text className="font-inter-bold text-caption font-bold text-on-primary">
          {String(index + 1)}
        </Text>
      </View>

      {photo !== null ? (
        <Image
          testID={fieldId('photo')}
          source={photo}
          resizeMode="cover"
          className="h-[72px] w-[72px] rounded-thumb"
        />
      ) : (
        <SlotPhotoPlaceholder
          category={category}
          testID={fieldId('photoplaceholder')}
        />
      )}

      <View className="flex-1 gap-[6px]">
        {timeLabel !== null ? (
          <View
            testID={fieldId('time')}
            className="flex-row items-center gap-[5px] self-start rounded-[8px] border border-hairline-strong bg-canvas py-[4px] pl-[9px] pr-[11px]"
          >
            <ClockGlyph size={12} />
            <Text className="font-noto-bold text-caption font-bold leading-[15px] text-ink">
              {timeLabel}
            </Text>
          </View>
        ) : null}
        <Text
          testID={fieldId('name')}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold leading-[18px] text-ink"
        >
          {placeName}
        </Text>
        {categoryLabel !== null ? (
          <Text
            testID={fieldId('category')}
            className="font-noto text-caption leading-[15px] text-muted"
          >
            {categoryLabel}
          </Text>
        ) : null}

        {vm.isFixed ? (
          <View
            testID={`planb-draft-fixed-${slotKey}`}
            className="flex-row items-center gap-[4px] self-start rounded-pill bg-primary-pale px-md py-[6px]"
          >
            <LockGlyph />
            <Text className="font-noto-bold text-label text-primary-text">
              고정
            </Text>
          </View>
        ) : onPressCandidates !== undefined ? (
          <Pressable
            testID={`planb-draft-candidates-${slotKey}`}
            accessibilityRole="button"
            onPress={() => onPressCandidates(slotKey)}
            hitSlop={8}
            className="self-start"
          >
            <Text className="font-noto text-caption leading-[15px] text-primary-text">
              {ALT_LABEL}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
