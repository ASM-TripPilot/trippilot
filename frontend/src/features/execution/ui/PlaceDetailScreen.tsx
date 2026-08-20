import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlaceDetailView } from '../model/placeDetailView';
import { BackArrowGlyph, ShareGlyph } from './ExecutionGlyphs';

/**
 * TRIP-398 · PlaceDetailScreen(i05) — 여행 중 현재 장소 상세, 무상태 화면.
 *
 * 표면(위→아래): 헤더(뒤로가기·제목·공유) · hero 이미지 · 부제 한 줄 · 태그 칩 · 정보 카드
 * (영업시간·위치·다음 일정까지) · "지금 여기" 블록 · 미니맵 placeholder · 하단 CTA 2개.
 * 재판정하지 않고 뷰 값만 그린다 — 결측 처리·slack 조립은 model(`placeDetailView.ts`)이 소유.
 *
 * 규율:
 *  - 각 leaf 는 값 하나(`toHaveTextContent` 문자열=완전일치, LiveSlotCard 관례).
 *  - 결측 영업시간은 값 자리를 **다른 testID**(`-unknown-openhours`)로 바꿔 기계로 구분(AC-2).
 *  - 위치는 계약 공백이라 항상 "미확인"(`-unknown-location`, D3).
 *  - 소요시간 단위 문자열은 화면 어디에도 없다(INV-3) — 여유는 정성 라벨(model 조립)만 렌더.
 *  - [길찾기]는 자리만(onPress 없음, US-ONTRIP-03 소관) · [일정에서 보기]만 콜백(D7).
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
}

export function PlaceDetailScreen({
  view,
  onPressItinerary,
}: PlaceDetailScreenProps): ReactElement {
  return (
    <SafeAreaView
      testID="execution-place-detail"
      edges={['top', 'bottom']}
      style={{ flex: 1 }}
      className="bg-canvas"
    >
      <ScrollView className="flex-1" contentContainerClassName="pb-md">
        {/* 헤더 — 뒤로가기·공유는 계약에 핸들러가 없어 시각 요소만(6-b 확인). 컨텍스트 라벨
            "부산 여행 · 2일차"는 trip 조회 계약이 없어 생략(데이터 없이 지어내지 않음). */}
        <View className="gap-[3px] px-lg pb-md pt-[14px]">
          <View className="h-[24px] flex-row items-center">
            <BackArrowGlyph size={24} />
            <View className="flex-1" />
            <ShareGlyph size={24} />
          </View>
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
            <Text className="font-noto text-label text-muted">
              {view.tags.length > 0
                ? view.tags.join(' · ')
                : (view.category ?? '')}
            </Text>
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

          {/* 미니맵 — 실 KakaoMapView 는 후속(D5, 네이티브 재빌드 함정). 이번엔 정적 placeholder.
              ponytail: static box, lat/lng 단일핀 KakaoMapView(viewOnly) 배선은 후속 티켓. */}
          <View
            testID="execution-place-map"
            className="h-[150px] w-full items-center justify-center gap-xs overflow-hidden rounded-[14px] border border-hairline bg-surface-soft"
          >
            <View className="h-[32px] w-[32px] items-center justify-center rounded-pill bg-primary">
              <Text className="font-noto-bold text-caption text-on-primary">
                현
              </Text>
            </View>
            <Text className="font-noto text-caption text-muted">
              지도 준비 중
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* 하단 바 — [길찾기]는 자리만(onPress 없음), [일정에서 보기]만 콜백(D7). */}
      <View className="flex-row items-center gap-[10px] border-t border-hairline px-lg pb-lg pt-md">
        <Pressable
          testID="execution-place-cta-directions"
          accessibilityRole="button"
          className="items-center justify-center rounded-button border border-hairline-strong bg-canvas px-[28px] py-[15px]"
        >
          <Text className="font-noto-bold text-card-title text-ink">
            길찾기
          </Text>
        </Pressable>
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
