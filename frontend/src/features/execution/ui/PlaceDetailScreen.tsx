import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { PlaceSubtitle } from '@/entities/place/ui/PlaceSubtitle';
import { MapView } from '@/shared/map';
import { HeartOutlineGlyph } from '@/shared/ui/HeartGlyphs';

import type { PlaceDetailView } from '../model/placeDetailView';
import {
  BackArrowGlyph,
  HeroPhotoGlyph,
  HeroPinGlyph,
  ShareGlyph,
} from './ExecutionGlyphs';

/**
 * TRIP-755 · PlaceDetailScreen(i10, Figma 4159:2673) — 여행 중 현재 장소 상세, 무상태 화면.
 *
 * 표면(위→아래): 풀블리드 갤러리 히어로(원형 버튼·장소명·핀 부제·"1 / N") · 추천 카피 · 태그 칩 ·
 * 정보 카드(영업시간·주소·입장료) · 미니맵 · "이곳의 사진".
 * 재판정하지 않고 뷰 값만 그린다 — 결측 조립은 model(`placeDetailView.ts`)이 소유.
 *
 * 규율:
 *  - 계약 공백 필드(카피·사진 수·갤러리 2장째부터)는 값이 있을 때만 그린다(INV-1). 주소·입장료
 *    결측은 행을 지우지 않고 다른 testID 로 "미확인"(BR-U4-40, `-unknown-{field}`).
 *  - 뒤로·공유·모두 보기는 콜백이 있을 때만 그린다(TRIP-939 — 반응 없는 버튼 금지).
 *  - 하트는 저장하지 않는다 — 누르면 "준비 중" 한 줄만 뜨고 글리프·selected 는 그대로다(BR-U4-38,
 *    저장 거짓말 금지). 그래서 콜백 prop 이 없고 항상 그린다.
 *  - "다음 일정까지"(여유) 행은 두지 않는다 — Figma 3행 그대로(사용자 결정 2026-09-25 — US-ONTRIP-02 여유 표시 요구와의 차이를 알고 수용).
 *  - 소요시간 단위 문자열은 화면 어디에도 없다(INV-3).
 */

export interface PlaceDetailScreenProps {
  view: PlaceDetailView;
  onPressBack?: () => void;
  onPressShare?: () => void;
  /** "이곳의 사진 · 모두 보기 ›" — 사진 뷰어가 없어 미주입이면 그리지 않는다. */
  onPressSeeAll?: () => void;
}

// 하단 스크림 — 흰 제목·부제를 사진 위에서 읽히게 한다. 반투명이라 raw(d06 SCRIM_COLORS 와 같은 값).
const SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)'] as const;
const SCRIM_LOCATIONS = [0.3, 1] as const;
const THUMB_COUNT = 3;
const SAVE_NOTICE = '저장 기능은 준비 중이에요';

/** 정보 카드 한 행 — 라벨 + 값 슬롯(값은 결측 스위치·캡션 때문에 호출부가 조립해 넘긴다). */
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <View className="flex-row items-start gap-[10px] py-[13px]">
      {/* Figma 라벨 폭 60. */}
      <View className="min-w-[60px]">
        <Text className="font-noto text-label text-muted">{label}</Text>
      </View>
      <View className="flex-1 gap-[2px]">{children}</View>
    </View>
  );
}

// 행 구분선 — `border-hairline` 은 네 변 두께를 함께 건드려(repo-traps) 막대 View 로 그린다.
function Divider(): ReactElement {
  return <View className="h-px w-full bg-hairline" />;
}

/** 값 또는 결측 — 값이 null 이면 "미확인"을 `-unknown-{field}` testID 로 적는다. */
function ValueOrUnknown({
  value,
  field,
}: {
  value: string | null;
  field: string;
}): ReactElement {
  return (
    <Text
      testID={
        value === null
          ? `execution-place-unknown-${field}`
          : `execution-place-${field}`
      }
      className="font-noto text-[13.5px] text-ink"
    >
      {value ?? '미확인'}
    </Text>
  );
}

function CircleButton({
  testID,
  onPress,
  selected,
  children,
}: {
  testID: string;
  onPress: () => void;
  selected?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      className="h-[38px] w-[38px] items-center justify-center rounded-pill bg-on-primary"
    >
      {children}
    </Pressable>
  );
}

export function PlaceDetailScreen({
  view,
  onPressBack,
  onPressShare,
  onPressSeeAll,
}: PlaceDetailScreenProps): ReactElement {
  const { width } = useWindowDimensions();
  // 하트 '준비 중' 안내 — 로컬 상태 한 줄(ShareCardScreen degradeVisible 선례). 하트 자체는 안 바뀐다.
  const [saveNoticeVisible, setSaveNoticeVisible] = useState(false);

  const hasPitch = view.pitchTitle !== null || view.pitchBody !== null;
  const coords =
    view.lat !== null && view.lng !== null
      ? { lat: view.lat, lng: view.lng }
      : null;
  const thumbs = view.galleryUrls.slice(0, THUMB_COUNT);
  const moreCount =
    view.photoTotal === null ? 0 : view.photoTotal - THUMB_COUNT;

  return (
    <SafeAreaView
      testID="execution-place-detail"
      edges={['bottom']}
      style={{ flex: 1 }}
      className="bg-canvas"
    >
      <ScrollView className="flex-1" contentContainerClassName="pb-xl">
        {/* 갤러리 히어로(풀블리드 430) — 사진이 없으면 지어내지 않고 회색 자리(D6·INV-1). */}
        <View
          testID="execution-place-hero"
          className="h-[430px] w-full overflow-hidden bg-surface-strong"
        >
          {view.galleryUrls.length > 0 ? (
            <ScrollView
              testID="execution-place-gallery"
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
            >
              {view.galleryUrls.map((uri, index) => (
                <Image
                  key={`${index}-${uri}`}
                  testID={`execution-place-gallery-${index}`}
                  source={{ uri }}
                  resizeMode="cover"
                  className="h-full"
                  style={{ width }}
                />
              ))}
            </ScrollView>
          ) : null}
          <LinearGradient
            colors={SCRIM_COLORS}
            locations={SCRIM_LOCATIONS}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* 원형 버튼 — top-[52px]는 상태바 근사(d06 선례, 기기별 안전영역 정합은 6-b). box-none 이라
              버튼 사이 빈 곳의 스와이프는 갤러리로 간다. */}
          <View
            pointerEvents="box-none"
            className="absolute left-lg right-lg top-[52px] flex-row items-center gap-sm"
          >
            {onPressBack ? (
              <CircleButton testID="execution-place-back" onPress={onPressBack}>
                <BackArrowGlyph size={20} />
              </CircleButton>
            ) : null}
            <View pointerEvents="none" className="flex-1" />
            {onPressShare ? (
              <CircleButton
                testID="execution-place-share"
                onPress={onPressShare}
              >
                <ShareGlyph size={19} />
              </CircleButton>
            ) : null}
            <CircleButton
              testID="execution-place-save"
              onPress={() => setSaveNoticeVisible(true)}
              selected={false}
            >
              <HeartOutlineGlyph
                testID="execution-place-save-outline"
                size={20}
              />
            </CircleButton>
          </View>

          <View
            pointerEvents="none"
            className="absolute bottom-[42px] left-lg right-[120px] gap-xs"
          >
            <Text
              testID="execution-place-title"
              className="font-noto-bold text-[27px] text-on-primary"
            >
              {view.name}
            </Text>
            {view.category !== null ? (
              <View className="flex-row items-center gap-[6px]">
                <HeroPinGlyph testID="execution-place-subtitle-pin" />
                <PlaceSubtitle
                  parts={[view.category]}
                  className="font-noto text-caption text-on-primary"
                />
              </View>
            ) : null}
          </View>

          {view.photoTotal !== null ? (
            <View
              testID="execution-place-photo-count"
              pointerEvents="none"
              className="absolute bottom-lg right-lg flex-row items-center gap-[5px] rounded-[8px] bg-scrim/55 px-[11px] py-[5px]"
            >
              <HeroPhotoGlyph />
              <Text className="font-inter-bold text-micro text-on-primary">
                {`1 / ${view.photoTotal}`}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="gap-[14px] px-lg pt-lg">
          {hasPitch ? (
            <View testID="execution-place-pitch" className="gap-[6px] py-lg">
              {view.pitchTitle !== null ? (
                <Text
                  testID="execution-place-pitch-title"
                  className="font-noto-bold text-[16px] text-ink"
                >
                  {view.pitchTitle}
                </Text>
              ) : null}
              {view.pitchBody !== null ? (
                <Text
                  testID="execution-place-pitch-body"
                  className="font-noto text-[13px] leading-[21px] text-body"
                >
                  {view.pitchBody}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* 태그 칩 — tags 비어도 컨테이너는 남는다(구조 앵커). */}
          <View
            testID="execution-place-tags"
            className="flex-row flex-wrap gap-sm"
          >
            {view.tags.map((tag) => (
              <View
                key={tag}
                className="rounded-[8px] bg-surface-soft px-[11px] py-[6px]"
              >
                <Text className="font-noto text-[12.5px] leading-[14px] text-body">{`#${tag}`}</Text>
              </View>
            ))}
          </View>

          <View
            testID="execution-place-info"
            className="rounded-[12px] border border-hairline bg-canvas px-[14px]"
          >
            <InfoRow label="영업시간">
              <Text
                testID={
                  view.openingHoursMissing
                    ? 'execution-place-unknown-openhours'
                    : 'execution-place-openhours'
                }
                className="font-noto text-[13.5px] text-ink"
              >
                {view.openingHours}
              </Text>
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
            <InfoRow label="주소">
              <ValueOrUnknown value={view.address} field="address" />
            </InfoRow>
            <Divider />
            <InfoRow label="입장료">
              <ValueOrUnknown value={view.admissionFee} field="fee" />
            </InfoRow>
          </View>

          {/* 미니맵 — 현재 장소 1핀 viewOnly(d06 동형). 단일 핀이라 경로선 없음. env 키 부재면 코어가
              map-failure 로 접는다(INV-4), 실타일은 네이티브 재빌드 뒤(6-b). */}
          {coords !== null ? (
            <View
              testID="execution-place-map"
              className="h-[150px] w-full overflow-hidden rounded-[12px] border border-hairline bg-surface-soft"
            >
              <MapView
                center={coords}
                pins={[{ number: 1, ...coords }]}
                viewOnly
                showScaleBar
              />
            </View>
          ) : null}

          {view.galleryUrls.length >= THUMB_COUNT ? (
            <View testID="execution-place-photos" className="gap-md pt-[6px]">
              <View className="flex-row items-center justify-between">
                <Text className="font-noto-bold text-[16px] text-ink">
                  이곳의 사진
                </Text>
                {onPressSeeAll ? (
                  <Pressable
                    testID="execution-place-photos-seeall"
                    accessibilityRole="button"
                    onPress={onPressSeeAll}
                  >
                    <Text className="font-noto text-[12.5px] text-muted">
                      모두 보기 ›
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View className="flex-row gap-sm">
                {thumbs.map((uri, index) => (
                  <View
                    key={`${index}-${uri}`}
                    className="h-[110px] flex-1 overflow-hidden rounded-[12px] bg-surface-strong"
                  >
                    <Image
                      testID={`execution-place-photo-thumb-${index}`}
                      source={{ uri }}
                      resizeMode="cover"
                      className="h-full w-full"
                    />
                    {index === THUMB_COUNT - 1 && moreCount > 0 ? (
                      <View className="absolute inset-0 items-center justify-center bg-scrim/45">
                        <Text
                          testID="execution-place-photos-more"
                          className="font-inter-bold text-[18px] text-on-primary"
                        >
                          {`+${moreCount}`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* 하트 '준비 중' 안내 — 화면 하단 고정, 타이머 없음(d06 SaveErrorBanner 자리). */}
      {saveNoticeVisible ? (
        <View className="mx-lg mb-sm rounded-button bg-surface-soft p-md">
          <Text
            testID="execution-place-save-notice"
            className="font-noto text-label text-body"
          >
            {SAVE_NOTICE}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
