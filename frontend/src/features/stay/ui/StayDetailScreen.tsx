/**
 * e03 숙소 상세 · 무상태 프레젠테이션 화면(Figma 1700:1183 default · TRIP-457 · US-STAY-*).
 *
 * `item: StayItem | null` + 상태 플래그·콜백만 받는다 — 네트워크·라우팅·저장 판정을 전혀 모른다
 * (FSD 경계, 배선은 `pages/stay-detail/ui/StayDetailPage.tsx`가 진다. 구조 가드가 useState·
 * 라우터·query·타 feature import 0을 잠근다). `item`이 `null`이면(파싱 실패/부재) notFound
 * 얼굴을 그린다(INV-4). 계약 GET이 없어 손에 든 카드 데이터로 그릴 수 있는 것까지만 그린다:
 * 사진 URL 필드가 없어 회색 자리(INV-1)·최저가(`formatPrice` 재사용, "· 1박" 없음 Q6)·편의시설
 * (결측→"미확인" BR-U1-18)·미니맵 정적 자리(Q5, i05 선례)·지역(거리·소요시간 없음 INV-1·INV-3)·
 * 제휴 고지·CTA 2종·저장 하트. **몰입 화면 = 하단 탭바 없음**(AC-14, e02 검색화면과 대비).
 *
 * 담김/미담김 하트는 색(SVG fill)이 아니라 **서로 다른 글리프 컴포넌트 = 다른 testID**
 * (`-filled`/`-outline`) + `accessibilityState.selected`로 관찰되게 그린다(repo-trap: `*Glyphs.tsx`
 * fill은 jest 렌더 트리에 안 남는다).
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { StayItem } from '@/shared/api/generated/schemas';

import { formatPrice } from '../model/formatPrice';
import {
  AmenityGlyph,
  BackChevronGlyph,
  CalendarPlusGlyph,
  ExternalLinkGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  InfoGlyph,
  MapPinGlyph,
  ShareGlyph,
} from './StayGlyphs';

export interface StayDetailScreenProps {
  /** 손에 든 카드 데이터(계약 GET 부재, 01b Q1). null이면 notFound 얼굴(파싱 실패/부재, INV-4). */
  item: StayItem | null;
  /** 담김 여부(AC-11) — 찬 하트 + selected. */
  saved: boolean;
  /** 담기/해제 요청 중이면 하트 disabled(연타 가드). 미지정=활성. */
  pending?: boolean;
  /** 하트 press(AC-11) — 저장/해제 판정은 페이지 몫. */
  onToggleSave: () => void;
  /** 외부에서 예약하기(AC-8) — 제휴 시트 열기는 페이지 몫. */
  onPressBook: () => void;
  /** 일정에 추가(AC-10) — 저장 + 거점 편입 안내는 페이지 몫. */
  onPressAddToTrip: () => void;
  /** hero 뒤로 오버레이. 목적지는 페이지가 정한다(화면은 라우터를 모른다). 미지정=정직한 스텁. */
  onPressBack?: () => void;
  /** AC-10 안내 표시 — 저장 성공 후 페이지가 true로 올린다. 미지정=미표시. */
  addedNotice?: boolean;
}

// 그림자(브리프 §4-2 관례 — #000000은 토큰화된 색 목록 밖이라 V1 가드 대상이 아니다,
// StaySearchScreen.tsx cardShadow와 동형).
const heroButtonShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

/** hero 위 원형 오버레이 버튼(뒤로·공유·저장). */
function HeroCircle({
  children,
  testID,
  onPress,
  disabled,
  selected,
}: {
  children: ReactElement;
  testID: string;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      disabled={disabled}
      onPress={onPress}
      style={heroButtonShadow}
      className="h-9 w-9 items-center justify-center rounded-pill bg-canvas"
    >
      {children}
    </Pressable>
  );
}

/** 한 줄 섹션 구분선. */
function Divider(): ReactElement {
  return <View className="h-[1px] w-full bg-hairline" />;
}

function AmenityChip({ value }: { value: string }): ReactElement {
  return (
    <View
      testID={`stay-detail-amenity-${value}`}
      className="w-[72px] items-center gap-sm"
    >
      <View className="h-12 w-12 items-center justify-center rounded-[14px] border border-hairline bg-surface-soft">
        <AmenityGlyph size={24} />
      </View>
      <Text numberOfLines={1} className="font-noto text-caption text-body">
        {value}
      </Text>
    </View>
  );
}

export function StayDetailScreen({
  item,
  saved,
  pending = false,
  onToggleSave,
  onPressBook,
  onPressAddToTrip,
  onPressBack,
  addedNotice = false,
}: StayDetailScreenProps): ReactElement {
  // 파싱 실패/부재 → notFound(INV-4). 손에 든 데이터가 없으면 "부재"가 정직하다(★F-9 — i05가
  // 조회 5xx를 notFound로 오접는 사각과 다른 축: 여기선 애초에 GET 계약이 없다).
  if (item === null) {
    return (
      <View
        testID="stay-detail-notfound"
        className="flex-1 items-center justify-center gap-md bg-canvas px-lg"
      >
        <MapPinGlyph size={32} />
        <Text className="text-center font-noto-bold text-section font-bold text-ink">
          숙소 정보를 불러올 수 없어요
        </Text>
        <Text className="text-center font-noto text-label text-muted">
          다시 시도하거나 목록으로 돌아가세요
        </Text>
      </View>
    );
  }

  return (
    <View testID="stay-detail-root" className="flex-1 bg-canvas">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* hero — 사진 URL 필드가 계약에 없어 회색 자리(INV-1). 뒤로·공유·저장 오버레이. */}
        <View
          testID="stay-detail-hero"
          className="h-[300px] w-full bg-surface-strong"
        >
          <View className="absolute left-lg top-[52px]">
            <HeroCircle testID="stay-detail-back" onPress={onPressBack}>
              <BackChevronGlyph size={22} />
            </HeroCircle>
          </View>
          <View className="absolute right-[62px] top-[52px]">
            {/* 공유 — 표시만(공유 계약 미존재, 범위 밖). 정적 어포던스라 Pressable이 아니다. */}
            <View
              style={heroButtonShadow}
              className="h-9 w-9 items-center justify-center rounded-pill bg-canvas"
            >
              <ShareGlyph size={18} />
            </View>
          </View>
          <View className="absolute right-lg top-[52px]">
            <HeroCircle
              testID="stay-detail-save"
              onPress={onToggleSave}
              disabled={pending}
              selected={saved}
            >
              {saved ? (
                <HeartFilledGlyph testID="stay-detail-save-filled" size={20} />
              ) : (
                <HeartOutlineGlyph
                  testID="stay-detail-save-outline"
                  size={20}
                />
              )}
            </HeroCircle>
          </View>
        </View>

        <View className="gap-[18px] px-lg pb-[26px] pt-lg">
          {/* 제목 · 최저가(1박 접미 없음 Q6, formatPrice 재사용) */}
          <View className="gap-[10px]">
            <Text className="font-noto-bold text-hero font-bold text-ink">
              {item.name}
            </Text>
            <Text className="font-inter-bold text-[18px] font-bold text-ink">
              {formatPrice(item.price)}
            </Text>
          </View>

          <Divider />

          {/* 편의시설 — 결측이면 "미확인"(빈칸 금지, BR-U1-18). 서버 코드 raw 라벨(값 창작 안 함). */}
          <View className="gap-[14px]">
            <Text className="font-noto-bold text-section font-bold text-ink">
              이 숙소 편의시설
            </Text>
            {item.amenities.length > 0 ? (
              <View className="flex-row flex-wrap gap-sm">
                {item.amenities.map((value) => (
                  <AmenityChip key={value} value={value} />
                ))}
              </View>
            ) : (
              <Text
                testID="stay-detail-amenities-empty"
                className="font-noto text-label text-muted"
              >
                미확인
              </Text>
            )}
          </View>

          <Divider />

          {/* 위치 — 미니맵 정적 자리(Q5, KakaoMapView 아님) + 지역(거리·소요시간 없음 INV-1·INV-3) */}
          <View className="gap-md">
            <Text className="font-noto-bold text-section font-bold text-ink">
              위치
            </Text>
            <View
              testID="stay-detail-map"
              className="h-[168px] w-full items-center justify-center rounded-card border border-hairline bg-surface-soft"
            >
              <MapPinGlyph size={32} />
            </View>
            <View className="flex-row items-center gap-xs">
              <MapPinGlyph size={15} />
              <Text className="font-noto text-label text-body">
                {item.region}
              </Text>
            </View>
          </View>

          <Divider />

          {/* 하단 액션 — 제휴 고지 + CTA 2종 */}
          <View className="gap-md">
            <View
              testID="stay-detail-affiliate-notice"
              className="flex-row items-center gap-xs"
            >
              <InfoGlyph size={15} />
              <Text className="font-noto text-caption text-muted">
                예약·결제는 제휴 파트너 사이트에서 진행돼요
              </Text>
            </View>

            <Pressable
              testID="stay-detail-book"
              accessibilityRole="button"
              onPress={onPressBook}
              className="h-[52px] flex-row items-center justify-center gap-sm rounded-button bg-primary"
            >
              <ExternalLinkGlyph size={19} />
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                외부에서 예약하기
              </Text>
            </Pressable>

            <Pressable
              testID="stay-detail-addtotrip"
              accessibilityRole="button"
              onPress={onPressAddToTrip}
              className="h-[52px] flex-row items-center justify-center gap-sm rounded-button border border-hairline-strong bg-canvas"
            >
              <CalendarPlusGlyph size={19} />
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                일정에 추가
              </Text>
            </Pressable>

            {/* 담기 성공 안내(AC-10) — 페이지가 저장 성공 후 addedNotice를 올린다. */}
            {addedNotice ? (
              <View className="flex-row items-center gap-xs rounded-card bg-surface-soft px-lg py-md">
                <InfoGlyph size={15} />
                <Text
                  testID="stay-detail-add-notice"
                  className="flex-1 font-noto text-label text-muted"
                >
                  담은 숙소는 여행 만들 때 거점으로 추가할 수 있어요
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
