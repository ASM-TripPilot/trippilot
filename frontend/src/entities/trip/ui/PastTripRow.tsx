import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { PastTripCardVM } from '../model';

/**
 * TRIP-808 · j07 지난 여행 행 — 순수 프레젠테이션(features/record/ui/PastTripList 의 행에서 이관).
 *
 * 카드 = **72×72 placeholder 자리 박스 + 제목 + 날짜범위(+박수)**. 실사진(`<Image>`)·"사진 N·메모 M"
 * 통계는 `Trip` 계약에 필드가 없어 안 그린다(INV-1 정직 degrade — 실데이터는 TRIP-638 이후, 지금은 빈 박스만).
 * 날짜범위·박수는 **별개 leaf** 로 그린다 — 테스트가 getByText 완전일치로
 * 각각 잡기 때문(한 줄로 합치면 exact 실패). null 라벨은 미렌더(가짜 날짜·가짜 "0박" 금지).
 *
 * chevron 은 카드가 소유하지 않고 소비처가 `trailing` 슬롯으로 주입한다(807 SavedStayCard 동형) —
 * j07 PastTripList 가 RecordGlyphs.ChevronRightGlyph 를 넣는다. testID 도 소비처가 명시 full 문자열
 * (`record-calendar-past-trip-{id}`)로 주입해 그 리터럴이 PastTripList.tsx 에 잔존한다(선재 가드 무재조준).
 *
 * TRIP-776 · l03 마이페이지 "지난 여행"(Figma 1603:2414)은 `compact` 변형을 쓴다 — 썸네일 64 r12 · 카드 r12 ·
 * 오른쪽 패딩 14 · 제목↔부제 4. 안 주면 j07 모양 그대로(72 r10). VM 의 `imageUrl`(프리뷰 픽스처 전용 —
 * 실앱은 사진 원본이 기기에만 있어 null)·`photoLabel`("사진 N", 페이지가 /me/records 로 조인)은 둘 다 선택이다.
 */
export interface PastTripRowProps {
  vm: PastTripCardVM;
  onPress: () => void;
  trailing?: ReactNode;
  testID: string;
  /** l03 변형(썸네일 64). 미전달 = j07 72. */
  compact?: boolean;
}

export function PastTripRow({
  vm,
  onPress,
  trailing,
  testID,
  compact = false,
}: PastTripRowProps): ReactElement {
  const { title, dateRangeLabel, nightsLabel } = vm;
  const photoLabel = vm.photoLabel ?? null;
  const imageUrl = vm.imageUrl ?? null;
  // 부제 조각 — 날짜·박수·사진 수를 각각 별개 leaf 로, 사이에 " · " 를 끼운다.
  const subtitle = [dateRangeLabel, nightsLabel, photoLabel].filter(
    (label): label is string => label !== null
  );

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className={
        compact
          ? 'w-full flex-row items-center gap-[12px] rounded-[12px] border border-hairline bg-canvas p-[12px] pr-[14px]'
          : 'w-full flex-row items-center gap-[12px] rounded-card border border-hairline bg-canvas p-[12px]'
      }
    >
      {/* 썸네일 자리 — 사진이 없으면(실앱) 회색 박스만 그린다(사진 원본은 기기 로컬, INV-U5-03). 픽셀·정렬은 6-b. */}
      <View
        testID={`${testID}-thumb`}
        className={
          compact
            ? 'h-[64px] w-[64px] overflow-hidden rounded-thumb bg-surface-soft'
            : 'h-[72px] w-[72px] rounded-[10px] bg-surface-soft'
        }
      >
        {imageUrl !== null && (
          <Image
            testID={`${testID}-photo`}
            source={{ uri: imageUrl }}
            className="h-full w-full"
            resizeMode="cover"
          />
        )}
      </View>
      <View className={compact ? 'flex-1 gap-xs' : 'flex-1 gap-[3px]'}>
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {title}
        </Text>
        {subtitle.length > 0 && (
          <View className="flex-row items-center">
            {subtitle.map((label, i) => (
              <Fragment key={label}>
                {i > 0 && (
                  <Text className="font-noto text-label text-muted"> · </Text>
                )}
                <Text className="font-noto text-label text-muted">{label}</Text>
              </Fragment>
            ))}
          </View>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}
