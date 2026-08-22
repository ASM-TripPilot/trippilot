import type { ReactElement, ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type { Place } from '@/shared/api/generated/schemas';

import type { PlaceSaveNotice } from '../model/placeSaveGuard';
import {
  BackChevronGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  InfoGlyph,
  MapPinGlyph,
  ShareGlyph,
} from './ExploreGlyphs';

/**
 * d06 장소 상세(Figma `1907:1083`) — **무상태 프레젠테이션 화면**. props만 받는다. 조회·라우팅·
 * 저장 토글 판정은 `pages/place-detail/ui/PlaceDetailPage.tsx` 몫이고, 이 화면은 완성된 `Place`
 * 하나와 저장 여부만 보고 그린다(i05 `PlaceDetailScreen`과 같은 관계 — 다른 feature라 미러).
 *
 * ⚠️ **가진 것만 그린다(INV-1)**: `Place` 스키마엔 소개 본문·입장료·42장 갤러리·관련사진의
 * 데이터원이 없다(단건 GET 계약 부재). 그래서 `explore-place-intro`·`-fee`·`-relphotos`·
 * `-galcount`는 **아예 만들지 않는다** — 없는 값을 지어내면 발명이다. 주소는 full address가
 * 없어 `region ?? '미확인'`, 영업시간 NULL은 값 자리를 다른 testID(`-unknown-openhours`)로
 * 바꿔 기계로 구분한다(i05 선례).
 *
 * ⚠️ **하트 정체성은 색이 아니라 글리프 컴포넌트+testID+`selected`로 잰다** — SVG fill 색은
 * 렌더 트리에 안 남아, 색만 토글하면 "저장됐다는 거짓말"이 심판을 통과한다(repo-trap 글리프
 * 함정, d04·d02 선례).
 */
export interface PlaceDetailScreenProps {
  place: Place;
  /** 담김 여부 — 하트 글리프(filled/outline)와 `accessibilityState.selected`의 단일 출처. */
  saved: boolean;
  /** 저장 응답 대기 중 — 하트를 `disabled`로 만들어 이중 토글을 막는다. 미지정 = false. */
  saving?: boolean;
  /** 저장 실패 배너. 미지정·null이면 안 그린다(INV-4). 위치는 화면 하단 고정. */
  saveError?: PlaceSaveNotice | null;
  onPressBack?: () => void;
  onPressShare?: () => void;
  onToggleSave?: () => void;
  onPressSaveErrorAction?: () => void;
}

// 하단→상단 스크림(from-transparent 30% → to-black/50) — 흰 제목·부제를 사진 위에서 읽히게 한다.
// rgba 는 토큰이 아니라 불투명도라 raw 로 둔다(token-snapper MISS=반투명, HomeScreen 스크림 선례).
const SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)'] as const;
const SCRIM_LOCATIONS = [0.3, 1] as const;

/** 정보 카드 한 행 — 라벨(고정 폭) + 값 슬롯(결측 스위치 때문에 호출부가 조립해 넘긴다). */
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <View className="flex-row items-start gap-[10px] py-[13px]">
      <View className="w-[60px]">
        <Text className="font-noto text-label text-muted">{label}</Text>
      </View>
      <View className="flex-1">{children}</View>
    </View>
  );
}

/** 저장 실패 배너(INV-4) — 다음 조작 시 페이지가 `saveError`를 null로 돌려 지운다(타이머 없음).
 * d04 `SaveErrorBanner`와 같은 모양(아이콘 + 문구 + 조건부 액션). */
function SaveErrorBanner({
  notice,
  onPressAction,
}: {
  notice: PlaceSaveNotice;
  onPressAction?: () => void;
}): ReactElement {
  const actionTestId =
    notice.action === 'login'
      ? 'explore-place-saveerror-login'
      : notice.action === 'retry'
        ? 'explore-place-saveerror-retry'
        : null;
  const actionLabel = notice.action === 'login' ? '로그인하기' : '다시 시도';

  return (
    <View
      testID="explore-place-saveerror"
      className="mx-lg mb-sm flex-row items-start gap-[10px] rounded-button bg-primary-pale p-md"
    >
      <InfoGlyph size={18} />
      <Text className="flex-1 font-noto text-label text-primary-text">
        {notice.message}
      </Text>
      {actionTestId ? (
        <Pressable
          testID={actionTestId}
          accessibilityRole="button"
          onPress={onPressAction}
          className="items-center justify-center rounded-pill border-[1.4px] border-primary bg-canvas px-md py-[7px]"
        >
          <Text className="font-noto-bold text-[12.5px] font-bold text-primary-text">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PlaceDetailScreen({
  place,
  saved,
  saving = false,
  saveError,
  onPressBack,
  onPressShare,
  onToggleSave,
  onPressSaveErrorAction,
}: PlaceDetailScreenProps): ReactElement {
  const subtitle = place.region
    ? `${place.category} · ${place.region}`
    : place.category;

  return (
    <View testID="explore-place-detail" className="flex-1 bg-canvas">
      <ScrollView className="flex-1" contentContainerClassName="pb-[22px]">
        {/* 갤러리 hero(풀블리드) — imageUrl NULL 이면 기본 이미지를 지어내지 않고 회색 자리
            (BR-U1-06). 원형 버튼 3개는 안전영역 위로 띄운다(full-bleed 이미지 immersive). */}
        <View
          testID="explore-place-hero"
          className="h-[430px] w-full overflow-hidden bg-surface-strong"
        >
          {place.imageUrl ? (
            <Image
              source={{ uri: place.imageUrl }}
              resizeMode="cover"
              className="h-full w-full"
            />
          ) : null}
          <LinearGradient
            colors={SCRIM_COLORS}
            locations={SCRIM_LOCATIONS}
            style={StyleSheet.absoluteFillObject}
          />

          {/* 원형 버튼 3개 — full-bleed hero 위에 띄운다. top-[52px]는 Figma 값(상태바 + 여백
              근사) — 기기별 안전영역 정합은 6-b 실기 캘리브레이션 몫(repo-trap: 안전영역 실겹침은
              렌더 트리에 없다). */}
          <View className="absolute left-lg right-lg top-[52px] flex-row items-center">
            <Pressable
              testID="explore-place-back"
              accessibilityRole="button"
              onPress={onPressBack}
              className="h-[38px] w-[38px] items-center justify-center rounded-pill bg-on-primary"
            >
              <BackChevronGlyph size={20} />
            </Pressable>
            <View className="flex-1" />
            <Pressable
              testID="explore-place-share"
              accessibilityRole="button"
              onPress={onPressShare}
              className="h-[38px] w-[38px] items-center justify-center rounded-pill bg-on-primary"
            >
              <ShareGlyph size={19} />
            </Pressable>
            <Pressable
              testID="explore-place-save"
              accessibilityRole="button"
              // 담김=선택됨. 빈/찬은 색이 아니라 이 상태 + 글리프 컴포넌트 정체성으로 잰다
              // (repo-trap 글리프 함정, d04·d02 하트와 같은 신호).
              accessibilityState={{ selected: saved }}
              disabled={saving}
              onPress={onToggleSave}
              className="ml-[10px] h-[38px] w-[38px] items-center justify-center rounded-pill bg-on-primary"
            >
              {saved ? (
                <HeartFilledGlyph
                  testID="explore-place-save-filled"
                  size={20}
                />
              ) : (
                <HeartOutlineGlyph
                  testID="explore-place-save-outline"
                  size={20}
                />
              )}
            </Pressable>
          </View>

          <View className="absolute bottom-[42px] left-lg right-lg gap-xs">
            <Text
              testID="explore-place-title"
              className="font-noto-bold text-[27px] font-bold text-on-primary"
            >
              {place.nameKo}
            </Text>
            <Text className="font-noto text-caption text-on-primary">
              {subtitle}
            </Text>
          </View>
        </View>

        {/* 콘텐츠 — 태그칩 · 정보카드(영업시간·주소만) · 미니맵. 소개·입장료·관련사진은 데이터원이
            없어 자리 자체를 안 만든다(위 주석). */}
        <View className="gap-[14px] px-lg pb-[22px] pt-lg">
          {place.tags.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-x-sm gap-y-xs">
              {place.tags.map((tag) => (
                <View
                  key={tag}
                  className="rounded-pill bg-surface-soft px-[11px] py-[6px]"
                >
                  <Text className="font-noto text-caption text-body">{`#${tag}`}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View className="rounded-[14px] border border-hairline bg-canvas px-[14px]">
            <InfoRow label="영업시간">
              {place.openingHours ? (
                <Text
                  testID="explore-place-openhours"
                  className="font-noto text-label text-ink"
                >
                  {place.openingHours}
                </Text>
              ) : (
                <Text
                  testID="explore-place-unknown-openhours"
                  className="font-noto text-label text-ink"
                >
                  미확인
                </Text>
              )}
            </InfoRow>

            <View className="h-px w-full bg-hairline" />

            <InfoRow label="주소">
              {/* full address 계약 없음 — region 만 있고 없으면 "미확인"(INV-1). */}
              <Text
                testID="explore-place-address"
                className="font-noto text-label text-ink"
              >
                {place.region ?? '미확인'}
              </Text>
            </InfoRow>
          </View>

          {/* 미니맵 — 실 KakaoMapView 는 네이티브 재빌드 함정이라 정적 placeholder(i05 선례).
              ponytail: static box, lat/lng 단일핀 KakaoMapView(viewOnly) 는 후속 티켓. */}
          <View
            testID="explore-place-map"
            className="h-[150px] w-full items-center justify-center gap-xs overflow-hidden rounded-[14px] border border-hairline bg-surface-soft"
          >
            <MapPinGlyph size={28} />
            <Text className="font-noto text-caption text-muted">
              지도 준비 중
            </Text>
          </View>
        </View>
      </ScrollView>

      {saveError ? (
        <SaveErrorBanner
          notice={saveError}
          onPressAction={onPressSaveErrorAction}
        />
      ) : null}
    </View>
  );
}
