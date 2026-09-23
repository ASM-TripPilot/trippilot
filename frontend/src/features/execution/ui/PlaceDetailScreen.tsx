import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaceSubtitle } from '@/entities/place/ui/PlaceSubtitle';

import type { PlaceDetailView } from '../model/placeDetailView';

/**
 * TRIP-398 · PlaceDetailScreen(i05) — 여행 중 현재 장소 상세, 무상태 화면.
 *
 * 표면(위→아래): 헤더(제목) · hero 이미지 · 부제 한 줄 · 태그 칩 · 정보 카드
 * (영업시간·위치·다음 일정까지) · "지금 여기" 블록 · 하단 CTA.
 * TRIP-939(심사 2.1): 핸들러 없는 헤더 뒤로·공유 그림과 정적 미니맵 자리표시는 그리지 않는다.
 * [길찾기]는 목적지(`onPressDirections`)가 주입될 때만 그린다(US-ONTRIP-03 개통 시 되살림).
 * 재판정하지 않고 뷰 값만 그린다 — 결측 처리·slack 조립은 model(`placeDetailView.ts`)이 소유.
 *
 * 규율:
 *  - 각 leaf 는 값 하나(`toHaveTextContent` 문자열=완전일치, LiveSlotCard 관례).
 *  - 결측 영업시간은 값 자리를 **다른 testID**(`-unknown-openhours`)로 바꿔 기계로 구분(AC-2).
 *  - 위치는 계약 공백이라 항상 "미확인"(`-unknown-location`, D3).
 *  - 소요시간 단위 문자열은 화면 어디에도 없다(INV-3) — 여유는 정성 라벨(model 조립)만 렌더.
 *  - [길찾기]는 onPressDirections 미주입이면 미렌더(US-ONTRIP-03 소관) · [일정에서 보기]는 콜백(D7).
 */

// 정보 카드 행 라벨 셀 — 고정 폭 86px, bold muted(Figma i05 카드).
function RowLabel({ text }: { text: string }): ReactElement {
  return (
    <View className="w-[86px]">
      <Text className="font-noto-bold text-label text-muted">{text}</Text>
    </View>
  );
}

// 카드 행 구분선(hairline).
function Divider(): ReactElement {
  return <View className="h-px w-full bg-hairline" />;
}

// 정보 카드 한 행 — 라벨 + 값 슬롯(값은 결측 스위치·캡션 때문에 호출부가 조립해 넘긴다).
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <View className="flex-row items-start gap-[14px] py-[14px]">
      <RowLabel text={label} />
      <View className="flex-1 gap-[2px]">{children}</View>
    </View>
  );
}

export interface PlaceDetailScreenProps {
  view: PlaceDetailView;
  onPressItinerary?: () => void;
  /** 길찾기 목적지(US-ONTRIP-03). 미주입이면 [길찾기]를 그리지 않는다(TRIP-939). */
  onPressDirections?: () => void;
}

export function PlaceDetailScreen({
  view,
  onPressItinerary,
  onPressDirections,
}: PlaceDetailScreenProps): ReactElement {
  return (
    <SafeAreaView
      testID="execution-place-detail"
      edges={['top', 'bottom']}
      style={{ flex: 1 }}
      className="bg-canvas"
    >
      <ScrollView className="flex-1" contentContainerClassName="pb-md">
        {/* 헤더 — 제목만. 뒤로가기·공유 그림은 핸들러가 없어 그리지 않는다(TRIP-939 Q5 — 뒤로는 iOS
            스와이프·[일정에서 보기]가 대신). 컨텍스트 라벨 "부산 여행 · 2일차"는 trip 조회 계약이 없어
            생략(데이터 없이 지어내지 않음). */}
        <View className="gap-[3px] px-lg pb-md pt-[14px]">
          <Text className="font-noto-bold text-[20px] text-ink">현재 장소</Text>
        </View>

        {/* hero — imageUrl NULL 이면 기본 이미지를 지어내지 않고 빈 placeholder(D6·TRIP-219). */}
        <View
          testID="execution-place-hero"
          className="h-[240px] w-full bg-surface-strong"
        >
          {view.imageUrl ? (
            <Image
              source={{ uri: view.imageUrl }}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : null}
        </View>

        <View className="gap-lg px-lg pb-lg pt-[18px]">
          {/* 부제 — 태그 상위 몇 개를 " · " 로 이은 줄(없으면 category). 앵커 testID 없음. */}
          {view.tags.length > 0 || view.category !== null ? (
            <PlaceSubtitle
              parts={view.tags.length > 0 ? view.tags : [view.category ?? '']}
              className="font-noto text-label text-muted"
            />
          ) : null}

          {/* 태그 칩 — 각 tag 앞에 #. tags 비어도 컨테이너는 남는다(구조 앵커 S1). */}
          <View
            testID="execution-place-tags"
            className="flex-row flex-wrap gap-sm"
          >
            {view.tags.map((tag) => (
              <View
                key={tag}
                className="rounded-pill bg-surface-strong px-md py-[6px]"
              >
                <Text className="font-noto text-label text-body">{`#${tag}`}</Text>
              </View>
            ))}
          </View>

          {/* 정보 카드 — 영업시간·위치·다음 일정까지 3행. */}
          <View className="rounded-card border border-hairline bg-canvas px-lg">
            <InfoRow label="영업시간">
              {view.openingHoursMissing ? (
                <Text
                  testID="execution-place-unknown-openhours"
                  className="font-noto text-label text-ink"
                >
                  {view.openingHours}
                </Text>
              ) : (
                <Text
                  testID="execution-place-openhours"
                  className="font-noto text-label text-ink"
                >
                  {view.openingHours}
                </Text>
              )}
              {view.hoursCaption !== null ? (
                <Text
                  testID="execution-place-hours-caption"
                  className="font-noto text-caption text-primary-text"
                >
                  {view.hoursCaption}
                </Text>
              ) : null}
            </InfoRow>

            <Divider />

            <InfoRow label="위치">
              {/* 계약 공백 — 주소 데이터원이 없어 항상 "미확인"(D3). */}
              <Text
                testID="execution-place-unknown-location"
                className="font-noto text-label text-ink"
              >
                {view.location}
              </Text>
            </InfoRow>

            <Divider />

            <InfoRow label="다음 일정까지">
              <Text
                testID="execution-place-slack"
                className="font-noto text-label text-ink"
              >
                {view.slackLabel}
              </Text>
            </InfoRow>
          </View>

          {/* "지금 여기" — 계획 도착값(BR-U4-34) + 정적 안내 접미. "머무는 중" 활성 판정은 활성
              슬롯 신호 미배선이라 정적(★6, 6-b). */}
          <View className="gap-[5px] rounded-[14px] bg-surface-soft px-lg py-[14px]">
            <Text className="font-noto-bold text-caption text-primary-text">
              지금 여기
            </Text>
            <Text
              testID="execution-place-here"
              className="font-noto text-body text-ink"
            >
              {`${view.arrival} · 머무는 중 · 천천히 둘러보세요`}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* 하단 바 — [길찾기]는 목적지 주입 시에만, [일정에서 보기]는 콜백(D7). */}
      <View className="flex-row items-center gap-[10px] border-t border-hairline px-lg pb-lg pt-md">
        {onPressDirections ? (
          <Pressable
            testID="execution-place-cta-directions"
            accessibilityRole="button"
            onPress={onPressDirections}
            className="items-center justify-center rounded-button border border-hairline-strong bg-canvas px-[28px] py-[15px]"
          >
            <Text className="font-noto-bold text-card-title text-ink">
              길찾기
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="execution-place-cta-itinerary"
          accessibilityRole="button"
          onPress={onPressItinerary}
          className="flex-1 items-center justify-center rounded-button bg-primary py-[15px]"
        >
          <Text className="font-noto-bold text-card-title text-on-primary">
            일정에서 보기
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
