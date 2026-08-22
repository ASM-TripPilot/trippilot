import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

import {
  BackChevronGlyph,
  HeartFilledGlyph,
  MapPinGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from './StayGlyphs';

/**
 * e04 저장한 숙소(Figma default `1701:1183` · empty `1702:1183`) — **무상태 프레젠테이션 화면**.
 * props 만 받는다: 조회·판정·합성·라우팅은 전부 페이지(`SavedStayPage`)가 하고, 이 화면은
 * 완성된 VM 목록·`face` 문자열·`isGuest` 로 다섯 얼굴을 그리고 버튼 press 를 콜백으로 올린다.
 *
 * **게스트 분기(`isGuest`)가 `face` 보다 우선한다** — 저장 숙소 조회는 `enabled: isAuthed` 라
 * 게스트에게 `isPending` 이 영원히 true 다(d02 ★1). 그 값이 그대로 `face='loading'` 으로 오면
 * 화면이 끝나지 않는 로딩이 되므로, 게스트 여부를 얼굴 판정의 가장 앞에 둔다.
 *
 * **카드는 계약이 채울 수 있는 것만 정직하게 그린다** — `SavedStay` 스키마엔 사진·지역·거리·
 * 가격이 없어(brief §화면·IO) 이름 + (있으면)날짜라벨만 그린다(g02 line 140 회색 플레이스홀더
 * 선례 승계, 날짜는 체크인/아웃이지 소요시간이 아니다·INV-3). 사진 자리는 회색 배지로 남긴다.
 *
 * **담김 하트는 색(SVG fill)으로 안 잰다** — repo-trap: `*Glyphs.tsx` fill 은 jest 렌더 트리에
 * 안 남는다. 담김을 별도 testID(`saved-stay-heart-filled-{id}`) + 카드의
 * `accessibilityState.selected` 두 신호로 관찰 가능하게 그린다(e03·d02 선례).
 */

/** 저장 숙소 카드 뷰모델 — 이름과 (있으면)날짜라벨만. 지역·거리·가격은 계약 무. */
export interface SavedStayCardVM {
  savedStayId: string;
  name: string;
  /** checkIn~checkOut(있을 때만). 미지정 = 미표시. */
  dateLabel?: string;
}

/** 화면 얼굴 — `resolvePlaceListState().kind` 에서 페이지가 파생(filter-zero 는 구조적 도달
 * 불가라 4종). `PlaceListState`(explore 소유)를 import 하지 않기 위해 로컬 유니온으로 둔다(AC-8). */
export type SavedStayFace = 'loading' | 'error' | 'results' | 'empty';

export interface SavedStayListScreenProps {
  /** 그릴 순서 그대로 — 재정렬은 하지 않는다(서버 순서, BR-U1-15). */
  savedStays: SavedStayCardVM[];
  /** 미지정 = 'results'. */
  face?: SavedStayFace;
  /** face 판정보다 우선(끝나지 않는 로딩 회피). 미지정 = false. */
  isGuest?: boolean;
  /** 카드 press → 페이지가 합성·push. 화면은 id 만 올린다(합성이 stayKey 를 쓰므로 페이지 몫). */
  onPressCard?: (savedStayId: string) => void;
  /** 하단 "다른 숙소를 거점으로 지정" → e05 등록. */
  onPressRegister?: () => void;
  /** empty CTA "숙소 둘러보기" → 숙소 탐색. */
  onPressBrowse?: () => void;
  /** error 얼굴 재시도. */
  onRetry?: () => void;
  /** guest 얼굴 로그인 유도. */
  onPressLogin?: () => void;
  /** 앱바 뒤로. */
  onBack?: () => void;
}

/** Figma 카드 그림자 `0 4 16 rgba(0,0,0,.08)` — className 으로 못 줘 style prop 으로 옮긴다.
 * shadowColor '#000000' 은 raw-hex 가드의 TOKENIZED_HEX 밖이라 무제재(HomeScreen softCardShadow
 * 선례). */
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 3,
};

type ScreenFace = 'guest' | 'loading' | 'error' | 'results' | 'empty';

function AppBar({
  subtitle,
  onBack,
}: {
  /** results 얼굴에서만 개수 부제를 그린다. 미지정 = 부제 없음(empty·loading·error·guest). */
  subtitle: string | null;
  onBack?: () => void;
}): ReactElement {
  return (
    <View className="w-full gap-xs px-[24px] pb-[8px] pt-[8px]">
      <View className="flex-row items-center gap-xs">
        <Pressable
          testID="saved-stay-back"
          accessibilityRole="button"
          onPress={onBack}
          className="-ml-[8px] h-10 w-10 items-center justify-center"
        >
          <BackChevronGlyph size={24} />
        </Pressable>
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          저장한 숙소
        </Text>
      </View>
      {subtitle ? (
        <View testID="saved-stay-subtitle" className="pl-[8px]">
          <Text className="font-noto text-label text-muted">{subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SavedStayCard({
  vm,
  onPressCard,
}: {
  vm: SavedStayCardVM;
  onPressCard?: (savedStayId: string) => void;
}): ReactElement {
  return (
    // bare Pressable(accessibilityRole 없음 — d04·d02 카드 규율). 저장 목록이라 항상 담김 =
    // accessibilityState.selected. 하트 fill 이 아니라 이 상태 + 별도 글리프 testID 로 담김을 잰다.
    <Pressable
      testID={`saved-stay-card-${vm.savedStayId}`}
      accessibilityState={{ selected: true }}
      onPress={() => onPressCard?.(vm.savedStayId)}
      style={cardShadow}
      className="mb-lg rounded-card border border-hairline bg-canvas"
    >
      {/* 사진 자리 — 계약에 imageUrl 없음(INV-1), 회색 플레이스홀더(line 140 승계). */}
      <View className="h-[178px] w-full rounded-t-card bg-surface-strong">
        <View className="absolute right-[14px] top-[14px]">
          <HeartFilledGlyph
            size={27}
            testID={`saved-stay-heart-filled-${vm.savedStayId}`}
          />
        </View>
      </View>

      <View className="gap-xs px-[14px] pb-[14px] pt-[13px]">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {vm.name}
        </Text>
        {vm.dateLabel ? (
          <Text
            testID={`saved-stay-date-${vm.savedStayId}`}
            className="font-noto text-label text-muted"
          >
            {vm.dateLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ResultsFace({
  savedStays,
  onPressCard,
  onPressRegister,
}: {
  savedStays: SavedStayCardVM[];
  onPressCard?: (savedStayId: string) => void;
  onPressRegister?: () => void;
}): ReactElement {
  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 16,
        }}
      >
        {savedStays.map((vm) => (
          <SavedStayCard
            key={vm.savedStayId}
            vm={vm}
            onPressCard={onPressCard}
          />
        ))}
      </ScrollView>

      <View className="w-full border-t border-hairline bg-canvas px-lg pb-lg pt-md">
        <Pressable
          testID="saved-stay-register"
          accessibilityRole="button"
          onPress={onPressRegister}
          className="h-[52px] w-full flex-row items-center justify-center gap-sm rounded-button border border-hairline-strong bg-canvas"
        >
          <MapPinGlyph size={19} tone="ink" />
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            다른 숙소를 거점으로 지정
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** empty 삽화(01b Q5 단순화 SVG) — Figma 의 사진 3장 겹침 콜라주를 라운드 사각 3개 + 하트 원으로
 * 재현한다. 실사진은 자산 라이선스 미정이라 벡터로 대체(INV-1 정신). */
function EmptyCluster(): ReactElement {
  return (
    <View className="h-[162px] w-[220px] flex-row items-center justify-center gap-xs">
      <View className="h-[118px] w-[70px] rounded-card bg-surface-strong" />
      <View className="h-[162px] w-[92px] items-center justify-center rounded-card border-[3px] border-canvas bg-surface-soft">
        <View className="h-[52px] w-[52px] items-center justify-center rounded-pill bg-canvas">
          <HeartFilledGlyph size={26} />
        </View>
      </View>
      <View className="h-[118px] w-[70px] rounded-card bg-surface-strong" />
    </View>
  );
}

function EmptyFace({
  onPressBrowse,
}: {
  onPressBrowse?: () => void;
}): ReactElement {
  return (
    <View
      testID="saved-stay-empty"
      className="w-full flex-1 items-center justify-center px-[28px]"
    >
      <EmptyCluster />
      <Text className="mt-2xl text-center font-noto-bold text-[20px] font-bold text-ink">
        마음에 드는 숙소를 저장해 보세요
      </Text>
      <Text className="mt-[10px] text-center font-noto text-label leading-[21px] text-muted">
        인기 숙소를 둘러보고 ♥로 저장하면{'\n'}여기에 모아 바로 거점으로 쓸 수
        있어요
      </Text>
      <Pressable
        testID="saved-stay-browse"
        accessibilityRole="button"
        onPress={onPressBrowse}
        style={cardShadow}
        className="mt-2xl h-[52px] flex-row items-center justify-center gap-sm rounded-[14px] bg-primary px-[28px]"
      >
        <SearchGlyph size={19} />
        <Text className="font-noto-bold text-card-title font-bold text-on-primary">
          숙소 둘러보기
        </Text>
      </Pressable>
    </View>
  );
}

function LoadingFace(): ReactElement {
  return (
    <View testID="saved-stay-loading" className="w-full gap-lg px-lg pt-lg">
      <Text className="font-noto text-label text-muted-soft">
        저장한 숙소를 불러오는 중
      </Text>
      {[0, 1].map((index) => (
        <View key={index} className="gap-md">
          <View className="h-[178px] w-full rounded-card bg-surface-strong" />
          <View className="h-[15px] w-2/3 rounded-thumb bg-hairline" />
        </View>
      ))}
    </View>
  );
}

function ErrorFace({ onRetry }: { onRetry?: () => void }): ReactElement {
  return (
    <View className="w-full flex-1 items-center justify-center px-lg">
      <StateNotice
        testID="saved-stay-error"
        icon={<WarningTriangleGlyph size={32} tone="primary" />}
        title="저장한 숙소를 불러올 수 없어요"
        description="잠시 후 다시 시도해 주세요"
        actions={[
          {
            testID: 'saved-stay-error-retry',
            label: '다시 시도',
            variant: 'filled',
            onPress: onRetry,
          },
        ]}
      />
    </View>
  );
}

function GuestFace({
  onPressLogin,
}: {
  onPressLogin?: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-1 items-center justify-center px-lg">
      <StateNotice
        testID="saved-stay-guest"
        icon={<HeartFilledGlyph size={30} />}
        title="로그인하면 저장한 숙소를 볼 수 있어요"
        description="마음에 든 숙소를 저장해 두면 여행 거점으로 바로 이어져요"
        actions={[
          {
            testID: 'saved-stay-guest-login',
            label: '로그인하기',
            variant: 'filled',
            onPress: onPressLogin,
          },
        ]}
      />
    </View>
  );
}

export function SavedStayListScreen({
  savedStays,
  face = 'results',
  isGuest = false,
  onPressCard,
  onPressRegister,
  onPressBrowse,
  onRetry,
  onPressLogin,
  onBack,
}: SavedStayListScreenProps): ReactElement {
  const screenFace: ScreenFace = isGuest ? 'guest' : face;
  const subtitle =
    screenFace === 'results'
      ? `저장한 숙소 ${savedStays.length}곳 · ♥로 담아둔 곳`
      : null;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View testID="saved-stay-root" className="flex-1 bg-canvas">
        <AppBar subtitle={subtitle} onBack={onBack} />

        {screenFace === 'guest' ? (
          <GuestFace onPressLogin={onPressLogin} />
        ) : null}
        {screenFace === 'loading' ? <LoadingFace /> : null}
        {screenFace === 'error' ? <ErrorFace onRetry={onRetry} /> : null}
        {screenFace === 'empty' ? (
          <EmptyFace onPressBrowse={onPressBrowse} />
        ) : null}
        {screenFace === 'results' ? (
          <ResultsFace
            savedStays={savedStays}
            onPressCard={onPressCard}
            onPressRegister={onPressRegister}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
