/**
 * e03 숙소 상세 · 무상태 프레젠테이션 화면(Figma 1700:1183 default · 4514:2330 error · TRIP-457 ·
 * TRIP-940 · US-STAY-*).
 *
 * `state`(조회 결과 판별 유니온) + 상태 플래그·콜백만 받는다 — 네트워크·라우팅·저장 판정을 전혀
 * 모른다(FSD 경계, 조회·배선은 `pages/stay-detail/ui/StayDetailPage.tsx`가 진다. 구조 가드가
 * useState·라우터·query·타 feature import 0을 잠근다). ready 가 아닌 네 얼굴(로딩·404·400·네트워크)은
 * testID 로 갈리고 모두 뒤로 버튼을 갖는다. 재시도는 네트워크 오류에만 있다(INV-4, TRIP-940 Q2).
 * ready 얼굴: 사진 URL 필드가 없어 회색 자리(INV-1)·최저가(`formatPrice` 재사용, "· 1박" 없음 Q6)·
 * 편의시설(결측→"미확인" BR-U1-18)·미니맵·주소/전화/객실(전화 null 은 줄째 비움, TRIP-940 Q1)·
 * 제휴 고지·CTA 2종·저장 하트. **몰입 화면 = 하단 탭바 없음**(AC-14, e02 검색화면과 대비).
 *
 * 담김/미담김 하트는 색(SVG fill)이 아니라 **서로 다른 글리프 컴포넌트 = 다른 testID**
 * (`-filled`/`-outline`) + `accessibilityState.selected`로 관찰되게 그린다(repo-trap: `*Glyphs.tsx`
 * fill은 jest 렌더 트리에 안 남는다).
 */
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import type { StayDetail } from '@/shared/api/generated/schemas';

import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { MapView } from '@/shared/map';
import { resolveAmenityIcon } from '../config/amenityIcons';
import {
  BackChevronGlyph,
  ExternalLinkGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  InfoGlyph,
  MapPinGlyph,
  PlusGlyph,
  ShareGlyph,
} from './StayGlyphs';

/** 조회 결과 — `kind` 하나로 얼굴을 고른다. notFound=404 · invalid=400/stayId 없음 · error=5xx/네트워크. */
export type StayDetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; detail: StayDetail }
  | { kind: 'notFound' }
  | { kind: 'invalid' }
  | { kind: 'error' };

export interface StayDetailScreenProps {
  /** `GET /stays/{stayId}` 조회 결과(페이지가 판정한다). */
  state: StayDetailState;
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
  /** 전화 줄 press — `tel:` 열기는 페이지 몫. 미지정=정직한 스텁. */
  onPressPhone?: () => void;
  /** error 얼굴 "다시 시도" — 재조회는 페이지 몫. */
  onRetry?: () => void;
}

const FACE_TEST_ID = {
  loading: 'stay-detail-loading',
  notFound: 'stay-detail-notfound',
  invalid: 'stay-detail-invalid',
  error: 'stay-detail-error',
} as const;

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
      className="h-11 w-11 items-center justify-center rounded-pill bg-canvas"
    >
      {children}
    </Pressable>
  );
}

/** 한 줄 섹션 구분선. */
function Divider(): ReactElement {
  return <View className="h-[1px] w-full bg-hairline" />;
}

/** Figma e03 편의시설 행은 4칸 균등이다 — 이보다 많으면 줄바꿈 격자로 넘긴다(TRIP-918). */
const AMENITY_COLUMNS = 4;

function AmenityChip({
  value,
  wrap,
}: {
  value: string;
  wrap: boolean;
}): ReactElement {
  // 값별 아이콘(주차·조식·와이파이·오션뷰), 모르는 값은 AmenityGlyph 폴백(INV-1). 아이콘 leaf 에
  // testID 를 얹어 화면이 실제로 그 칩의 아이콘을 그리는지 잠근다(어느 아이콘·색은 config/6-b).
  // wrap 폭 83px = Figma 4칸 폭 83.5 에서 0.5 내림 — 딱 맞추면 픽셀 반올림으로 4번째 칩이 줄을 넘을 여지가 있다.
  const Icon = resolveAmenityIcon(value);
  return (
    <View
      testID={`stay-detail-amenity-${value}`}
      className={
        wrap ? 'w-[83px] items-center gap-sm' : 'flex-1 items-center gap-sm'
      }
    >
      <View className="h-12 w-12 items-center justify-center rounded-card border border-hairline bg-surface-soft">
        <Icon testID={`stay-detail-amenity-icon-${value}`} size={24} />
      </View>
      <Text numberOfLines={1} className="font-noto text-caption text-body">
        {value}
      </Text>
    </View>
  );
}

export function StayDetailScreen({
  state,
  saved,
  pending = false,
  onToggleSave,
  onPressBook,
  onPressAddToTrip,
  onPressBack,
  addedNotice = false,
  onPressPhone,
  onRetry,
}: StayDetailScreenProps): ReactElement {
  // ready 가 아니면 상세 내용·하트·CTA 없이 한 얼굴만(Figma 4514:2330 — 좌상단 뒤로 + 가운데 핀·
  // 제목·부제). 404·400·네트워크는 문구가 같고 testID 로만 갈린다(TRIP-940 Q2).
  if (state.kind !== 'ready') {
    return (
      <View
        testID={FACE_TEST_ID[state.kind]}
        className="flex-1 items-center justify-center gap-md bg-canvas px-lg"
      >
        <View className="absolute left-lg top-12">
          <HeroCircle testID="stay-detail-back" onPress={onPressBack}>
            <BackChevronGlyph size={24} />
          </HeroCircle>
        </View>
        {state.kind === 'loading' ? (
          <ActivityIndicator />
        ) : (
          <>
            <MapPinGlyph size={32} />
            <Text className="text-center font-noto-bold text-section font-bold text-ink">
              숙소 정보를 불러올 수 없어요
            </Text>
            <Text className="text-center font-noto text-label text-muted">
              다시 시도하거나 목록으로 돌아가세요
            </Text>
            {/* 재시도는 네트워크 오류에만 — 404·400 은 다시 해도 결과가 같다. */}
            {state.kind === 'error' ? (
              <Pressable
                testID="stay-detail-retry"
                accessibilityRole="button"
                onPress={onRetry}
                className="h-12 w-[200px] items-center justify-center rounded-button bg-primary"
              >
                <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                  다시 시도
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    );
  }

  const { detail } = state;
  const amenityWrap = detail.amenities.length > AMENITY_COLUMNS;

  return (
    <View testID="stay-detail-root" className="flex-1 bg-canvas">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* hero — 사진 URL 필드가 계약에 없어 회색 자리(INV-1). 뒤로·공유·저장 오버레이. */}
        <View
          testID="stay-detail-hero"
          className="h-[300px] w-full bg-surface-strong"
        >
          <View className="absolute left-lg top-12">
            <HeroCircle testID="stay-detail-back" onPress={onPressBack}>
              <BackChevronGlyph size={24} />
            </HeroCircle>
          </View>
          <View className="absolute right-[68px] top-12">
            {/* 공유 — 표시만(공유 계약 미존재, 범위 밖). 정적 어포던스라 Pressable이 아니다. */}
            <View
              style={heroButtonShadow}
              className="h-11 w-11 items-center justify-center rounded-pill bg-canvas"
            >
              <ShareGlyph size={24} />
            </View>
          </View>
          <View className="absolute right-lg top-12">
            <HeroCircle
              testID="stay-detail-save"
              onPress={onToggleSave}
              disabled={pending}
              selected={saved}
            >
              {saved ? (
                <HeartFilledGlyph testID="stay-detail-save-filled" size={24} />
              ) : (
                <HeartOutlineGlyph
                  testID="stay-detail-save-outline"
                  size={24}
                />
              )}
            </HeroCircle>
          </View>
        </View>

        <View className="gap-[18px] px-lg pb-[26px] pt-lg">
          {/* 제목 · 가격줄(좌 2톤 최저가 + 우 지역, justify-between) */}
          <View className="gap-[10px]">
            <Text className="font-noto-bold text-hero font-bold text-ink">
              {detail.name}
            </Text>
            <View
              testID="stay-detail-price-row"
              className="flex-row items-center justify-between"
            >
              {/* 좌 — 최저가 2톤: bold "{천단위}원" + muted "~"(1박 접미 없음 Q6, BR-U1-12).
                  바깥은 반드시 View(Text 아님) — 두 Text 가 형제라야 '145,000원~'로 결합 집계되지
                  않는다(StaySearchCard 725 선례). 결측("가격 미확인", "~" 없음)은 단일 muted 노드. */}
              {formatPrice(detail.price).endsWith('~') ? (
                <View className="flex-row items-baseline">
                  <Text className="font-inter-bold text-[18px] font-bold text-ink">
                    {formatPrice(detail.price).slice(0, -1)}
                  </Text>
                  <Text className="font-noto text-caption text-muted">~</Text>
                </View>
              ) : (
                <Text className="font-noto text-label text-muted">
                  {formatPrice(detail.price)}
                </Text>
              )}
              {/* 우 — 지역(핀 + 라벨). 거리·소요시간 필드가 계약에 없어 지역만(INV-1·INV-3). */}
              <View className="flex-row items-center gap-xs">
                <MapPinGlyph size={15} />
                <Text className="font-noto text-label text-body">
                  {detail.region}
                </Text>
              </View>
            </View>
          </View>

          <Divider />

          {/* 편의시설 — 결측이면 "미확인"(빈칸 금지, BR-U1-18). 서버 코드 raw 라벨(값 창작 안 함). */}
          <View className="gap-[14px]">
            <Text className="font-noto-bold text-section font-bold text-ink">
              이 숙소 편의시설
            </Text>
            {detail.amenities.length > 0 ? (
              <View
                testID="stay-detail-amenities"
                className={
                  amenityWrap ? 'flex-row flex-wrap gap-sm' : 'flex-row gap-sm'
                }
              >
                {detail.amenities.map((value) => (
                  <AmenityChip key={value} value={value} wrap={amenityWrap} />
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

          {/* 위치 — 실 MapView(viewOnly·단일 번호 핀) + 주소·전화·객실(거리·소요시간 없음
              INV-1·INV-3). connectPins 미전달(핀 1개라 경로선 없음). 네이버 네이티브라 타일·
              제스처 잠금은 6-b 실기(코드만 머지 시 재빌드 전 회색), env 키 부재 시 코어가
              map-failure 로 접는다(INV-4). */}
          <View className="gap-md">
            <Text className="font-noto-bold text-section font-bold text-ink">
              위치
            </Text>
            <View
              testID="stay-detail-map"
              className="h-[168px] w-full overflow-hidden rounded-card border border-hairline bg-surface-soft"
            >
              <MapView
                center={{ lat: detail.lat, lng: detail.lng }}
                pins={[{ number: 1, lat: detail.lat, lng: detail.lng }]}
                viewOnly
              />
            </View>
            {/* 주소(Figma 1700:1183 지도 아래 줄, 먹색 핀). 결측은 "미확인"(BR-U1-18). */}
            <View
              testID="stay-detail-address"
              className="flex-row items-center gap-xs"
            >
              <MapPinGlyph size={15} tone="ink" />
              <Text className="font-noto text-label text-body">
                {detail.address ?? '미확인'}
              </Text>
            </View>
            {/* 전화·객실 — Figma 근거 없음, 주소 줄과 같은 글자 스타일 2줄(TRIP-940 Q1). 전화 null 은
                "모름"이라 줄째 비운다(계약 설명문). 객실 null 은 "미확인". */}
            {detail.phone != null ? (
              <Pressable
                testID="stay-detail-phone"
                accessibilityRole="button"
                onPress={onPressPhone}
                className="flex-row items-center gap-xs"
              >
                <Text className="font-noto text-label text-muted">전화</Text>
                <Text className="font-noto text-label text-body">
                  {detail.phone}
                </Text>
              </Pressable>
            ) : null}
            <View
              testID="stay-detail-rooms"
              className="flex-row items-center gap-xs"
            >
              <Text className="font-noto text-label text-muted">객실</Text>
              <Text className="font-noto text-label text-body">
                {detail.rooms != null ? `${detail.rooms}실` : '미확인'}
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
              <PlusGlyph
                testID="stay-detail-addtotrip-icon"
                size={19}
                tone="ink"
              />
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
