import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { ALT_LABEL } from '../config/altLabel';
import { buildSlotKey } from '../lib/slotKey';
import { ChevronRightGlyph, ClockGlyph } from './SlotGlyphs';
import { SlotPhotoPlaceholder } from './SlotPhotoPlaceholder';

/** TRIP-797 · 미지정(startAt 없는) 슬롯 칩 문구 — 정본 공백 발명 카피(Figma 근거 6-b 이연). */
export const UNSPECIFIED_CHIP_LABEL = '시간대 설정';

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
  /** 이름 옆 인라인 경고(TRIP-801 D4·AC-4, 예: "휴관일 확인"). 주면 `slot-stopcard-warning-*` leaf 로
   *  그린다(빨강 텍스트+시계 글리프). 미주입=미렌더(6종 공용 카드 후방호환). 타입 선언만 — 렌더 배선은
   *  [구현] 몫(CS8a 가 red 로 강제). 트리거(`openingHoursKnown === false`)·문구는 소비처가 정한다. */
  warning?: string | null;
  /** TRIP-797 · h12 편집기 opt-in — 주면 시각 칩(또는 미지정 칩)을 **누를 수 있게** 만든다(⌄).
   *  누름 Pressable `slot-stopcard-timechip-*`(또는 미지정 시 `-unspecified-*`) press → 이 콜백.
   *  **미주입이면 Pressable 을 안 그린다**(결과화면 6종: plain `slot-stopcard-time-*` leaf 그대로). */
  onPressTimeChip?: () => void;
  /** TRIP-797 · true 면 시각 칩 대신 "시간대 설정" 칩(`slot-stopcard-unspecified-*`)을 그린다(AC-6).
   *  시각 leaf(`slot-stopcard-time-*`)는 부재. `onPressTimeChip` 있으면 이 칩이 그 콜백을 발화. */
  unspecified?: boolean;
  /** TRIP-797 · 방문 완료 잠금(AC-11 · INV-U3-03). true 면 **시각칩 편집 어포던스를 안 붙인다**
   *  (`onPressTimeChip` 이 있어도 누름 칩 부재). TRIP-753: 보이는 자물쇠 배지 대신 시각 알약을 회색
   *  톤으로 그리고, 잠금 표식 testID(`slot-stopcard-locked-*`)는 그 알약 View 에 붙는다. */
  locked?: boolean;
  /** TRIP-753 · 번호 원을 카드 루트 **밖** 왼쪽에 그린다(편집기 opt-in, 결과 화면 5종 무변경). 톤은
   *  `locked` 면 success, 아니면 primary. testID `slot-stopcard-number-*` 는 원 View 에 붙는다. */
  numberOutside?: boolean;
  /** TRIP-753 · 위반 배지 문구(카테고리 아래 연분홍 알약, `slot-stopcard-violation-*`). 미주입·null 이면
   *  미렌더 — 카드는 `slot.hasViolation` 을 스스로 읽지 않는다(결과 화면 5종 무변경). */
  violation?: string | null;
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
  warning,
  onPressTimeChip,
  unspecified,
  locked,
  numberOutside,
  violation,
}: SlotStopCardProps): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const fieldId = (role: string): string => `slot-stopcard-${role}-${slotKey}`;
  const hasImage = slot.imageUrl !== null && slot.imageUrl !== undefined;
  const hasTime = timeLabel !== null && timeLabel !== undefined;
  // 잠긴 슬롯은 편집 어포던스를 안 붙인다(INV-U3-03) — onPressTimeChip 을 줬어도 누름 칩 부재.
  const editable = onPressTimeChip !== undefined && locked !== true;
  const chipClass =
    'flex-row items-center gap-xs self-start rounded-[8px] border border-hairline-strong bg-canvas px-sm py-[3px]';

  const card = (
    <View
      testID={`slot-stopcard-${slotKey}`}
      style={cardShadow}
      className={`flex-row gap-[10px] rounded-card border border-hairline bg-canvas p-md ${numberOutside ? 'flex-1 items-center' : 'items-start'}`}
    >
      {/* 번호 배지 — 24px squircle(rounded-[8px]) primary. numberOutside 면 카드 밖(아래 return)에 그린다. */}
      {numberOutside ? null : (
        <View className="h-[24px] w-[24px] items-center justify-center rounded-[8px] bg-primary">
          <Text
            testID={fieldId('number')}
            className="font-inter-bold text-caption font-bold text-on-primary"
          >
            {String(index + 1)}
          </Text>
        </View>
      )}

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
        {/* 시각 영역 — 미지정(startAt null)이면 "시간대 설정" 칩, 아니면 시각 칩. 편집기(editable)면
            누름 Pressable(⌄)로, 결과화면(미주입)이면 plain leaf 로 그린다(회귀 0, 02a ★3). */}
        {unspecified ? (
          editable ? (
            <Pressable
              testID={fieldId('unspecified')}
              onPress={onPressTimeChip}
              className={chipClass}
            >
              <ClockGlyph size={12} />
              <Text className="font-noto-bold text-caption font-bold text-ink">
                {UNSPECIFIED_CHIP_LABEL}
              </Text>
            </Pressable>
          ) : (
            <View testID={fieldId('unspecified')} className={chipClass}>
              <ClockGlyph size={12} />
              <Text className="font-noto-bold text-caption font-bold text-ink">
                {UNSPECIFIED_CHIP_LABEL}
              </Text>
            </View>
          )
        ) : hasTime ? (
          editable ? (
            <Pressable
              testID={fieldId('timechip')}
              onPress={onPressTimeChip}
              className={chipClass}
            >
              <ClockGlyph size={12} />
              <Text
                testID={fieldId('time')}
                className="font-noto-bold text-caption font-bold text-ink"
              >
                {timeLabel}
              </Text>
              {/* ⌄ caret — 우향 chevron 을 90° 돌려 아래를 가리키게(신규 글리프 없이 재사용). */}
              <View style={{ transform: [{ rotate: '90deg' }] }}>
                <ChevronRightGlyph size={14} tone="muted" />
              </View>
            </Pressable>
          ) : locked ? (
            // 방문 완료 잠금(AC-11) — 모양은 회색 알약뿐(Figma 4313:2100), 표식 testID 는 알약 자체.
            <View
              testID={fieldId('locked')}
              className="flex-row items-center gap-xs self-start rounded-[8px] border border-muted-soft bg-canvas px-sm py-[3px]"
            >
              <ClockGlyph size={12} />
              <Text
                testID={fieldId('time')}
                className="font-noto-bold text-caption font-bold text-muted"
              >
                {timeLabel}
              </Text>
            </View>
          ) : (
            <View className={chipClass}>
              <ClockGlyph size={12} />
              <Text
                testID={fieldId('time')}
                className="font-noto-bold text-caption font-bold text-ink"
              >
                {timeLabel}
              </Text>
            </View>
          )
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

        {/* 이름 옆 인라인 경고(TRIP-801 D4 · 예: "휴관일 확인") — 시계 글리프 + 빨강 텍스트. 미주입=미렌더
            (6종 공용 카드 후방호환). leaf 는 문구 하나만 담아 완전일치로 잠긴다(글리프는 SVG라 텍스트 0). */}
        {warning === null || warning === undefined ? null : (
          <View className="flex-row items-center gap-[2px] self-start">
            <ClockGlyph size={12} />
            <Text
              testID={fieldId('warning')}
              className="font-noto text-caption text-primary-text"
            >
              {warning}
            </Text>
          </View>
        )}

        {slot.tags.length > 0 ? (
          <Text
            testID={fieldId('tags')}
            className="font-noto text-caption text-muted"
          >
            {slot.tags.join(' · ')}
          </Text>
        ) : null}

        {/* 위반 배지(TRIP-753) — 카테고리 아래 연분홍 알약. 문구는 소비처가 정한다(빈 배지 금지). */}
        {violation ? (
          <View
            testID={fieldId('violation')}
            className="self-start rounded-[12px] bg-primary-pale px-sm py-[3px]"
          >
            <Text className="font-noto-bold text-micro font-bold text-primary">
              {violation}
            </Text>
          </View>
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

  if (!numberOutside) return card;

  // 편집기(TRIP-753): `[번호 원] gap10 [카드]` — 번호는 카드 루트 밖, 톤은 완료(success)/예정(primary).
  return (
    <View className="flex-row items-center gap-[10px]">
      <View
        testID={fieldId('number')}
        className={`h-[24px] w-[24px] items-center justify-center rounded-pill ${locked ? 'bg-success' : 'bg-primary'}`}
      >
        <Text className="font-inter-bold text-caption font-bold text-on-primary">
          {String(index + 1)}
        </Text>
      </View>
      {card}
    </View>
  );
}
