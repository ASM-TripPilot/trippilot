/**
 * i20(수동 위치 입력)·i21(위치 권한 거부) origin 수집 화면 — 한 컴포넌트를 `state` prop 하나로
 * 두 얼굴로 그린다(LocationPreprompt state-param 선례, US-PLANB-10 · BR-U4-19 · TRIP-442).
 *
 * 무엇을 보장하나:
 *  - GPS 를 못 쓸 때(권한 거부·측위 불가) 재계획을 **막지 않고** 위치를 손으로 정하는 표면이다.
 *  - i20/i21 은 배너 카피·지도 기준점·프리시드 선택값만 다르고, origin 수집 어포던스(지도·"이 위치로
 *    계속"·"위치 입력 건너뛰기")는 공유한다 — i21 은 막다른 화면이 아니라 수동 입력 2순위로 잇는다.
 *  - "(추정)" 표기는 `isEstimatedOrigin`(originKind!=='GPS' 로컬 도출)로 즉시 붙인다 — 세션 왕복 없음.
 *
 * ⚠️ 범위 경계(여기서 안 하는 것): 지도 롱프레스→핀 좌표(PIN_DROP)·"이 위치로 계속" 누름→MANUAL
 *    origin 핸드오프·건너뛰기 항법은 **딥링크/프리뷰·라이브 세션 배선(후속) 몫**이라 이 화면은
 *    표면(존재)만 그린다. origin 봉투 계약은 `buildManualOrigin`/`buildStartReplanRequest` 순수
 *    함수가 잠근다. 지도 실동작·"(추정)" i20 선택값·핀 위치·Figma 픽셀은 6-b 실기·스크린샷 몫(AC-6).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isEstimatedOrigin } from '@/features/planb/model/replanOrigin';
import {
  LocationBackChevronGlyph,
  LocationInfoGlyph,
} from '@/shared/location/LocationGlyphs';
import { KakaoMapView, type MapCenter } from '@/shared/map';
import type { StartReplanRequestOriginKind } from '@/shared/api/generated/schemas/startReplanRequestOriginKind';

export type LiveLocationState = 'manual' | 'permission-denied';

export interface LiveLocationPageProps {
  /** origin 을 이어 붙일 재계획 세션의 여행 id. 라이브 세션 배선(후속)이 쓴다 — 이 프리젠테이션
   *  단계에서는 소비하지 않는다(진입은 딥링크/프리뷰 전용). */
  tripId: string;
  state: LiveLocationState;
}

/** soft shadow(Figma `0px 2px 10px rgba(0,0,0,0.06)`) — 반투명이라 토큰이 아니고, shadowColor 는
 * className 을 못 받는 raw 값이다. `#000000` 은 토큰화 9색 밖이라 raw-hex 가드 사정거리 밖(홈
 * fabShadow·탭바 PILL_SHADOW 선례). */
const CARD_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

interface FaceConfig {
  rootTestID: string;
  /** 안내 배너 첫 줄 — 권한 거부(i21)와 측위 불가(i20)를 가르는 유일한 카피 차이. */
  banner: string;
  /** 지도 기준점 — i20 은 여행지 기본 좌표, i21 은 등록 숙소(STAY_ANCHOR) 프리시드. */
  center: MapCenter;
  /** 프리시드 origin 꼬리표 — "(추정)" 표기를 originKind 로 도출한다. */
  originKind: StartReplanRequestOriginKind;
  /** 선택 위치 카드에 뜨는 사람이 읽는 라벨(좌표→라벨 역지오코딩은 6-b, 여기선 프리시드). */
  selectedLabel: string;
  /** 지도 아래 안내 힌트. */
  mapHint: string;
}

const FACES: Record<LiveLocationState, FaceConfig> = {
  manual: {
    rootTestID: 'live-location-manual',
    banner: '위치를 확인할 수 없어 현재 위치를 직접 입력해 주세요',
    center: { lat: 35.1587, lng: 129.1604 },
    originKind: 'MANUAL',
    selectedLabel: '광안리 인근',
    mapHint: '지도를 길게 눌러 원하는 위치를 지정할 수 있어요',
  },
  'permission-denied': {
    rootTestID: 'live-location-permission-denied',
    banner: '위치 권한이 꺼져 있어 현재 위치를 직접 입력해 주세요',
    center: { lat: 35.1533, lng: 129.1189 },
    originKind: 'STAY_ANCHOR',
    selectedLabel: '등록 숙소 기준',
    mapHint:
      '현재 위치 대신 등록 숙소를 기준으로 잡았어요. 핀을 옮겨 직접 지정할 수 있어요',
  },
};

export function LiveLocationPage({
  state,
}: LiveLocationPageProps): ReactElement {
  const face = FACES[state];
  const selectedValue = `${face.selectedLabel}${
    isEstimatedOrigin(face.originKind) ? '(추정)' : ''
  }`;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID={face.rootTestID} className="flex-1 bg-canvas">
        <View className="h-[56px] flex-row items-center border-b border-hairline px-lg">
          <LocationBackChevronGlyph />
        </View>

        <View className="flex-1 gap-md px-lg pt-lg">
          <Text className="font-noto-bold text-[20px] font-bold text-ink">
            현재 위치 입력
          </Text>

          {/* 안내 배너(점선 박스 + info) — 첫 줄은 상태별, subline 은 공통. */}
          <View className="flex-row gap-sm rounded-[14px] border border-dashed border-hairline-strong bg-surface-soft px-lg py-md">
            <View className="pt-[2px]">
              <LocationInfoGlyph />
            </View>
            <View className="flex-1 gap-xs">
              <Text className="font-noto text-body text-ink">
                {face.banner}
              </Text>
              <Text className="font-noto text-label text-muted">
                입력한 위치는 추정 출발지로 사용돼요
              </Text>
            </View>
          </View>

          {/* 지도 — center 는 목이 읽는 필수 prop. 롱프레스 실동작·핀 오버레이는 6-b(shared/map 확장
              안 함, Seed §3-a). */}
          <View className="h-[250px] overflow-hidden rounded-[14px]">
            <KakaoMapView center={face.center} />
          </View>
          <Text className="font-noto text-label text-muted">
            {face.mapHint}
          </Text>

          {/* 선택 위치 카드 — 값 옆 "변경"은 다시 고르는 어포던스(효과는 6-b). */}
          <View
            className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-canvas px-lg py-md"
            style={CARD_SHADOW}
          >
            <View className="gap-xs">
              <Text className="font-noto text-label text-muted">
                선택한 위치
              </Text>
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {selectedValue}
              </Text>
            </View>
            <View className="rounded-pill bg-surface-strong px-md py-xs">
              <Text className="font-noto text-label text-body">변경</Text>
            </View>
          </View>
        </View>

        <View className="gap-sm px-lg pb-2xl pt-lg">
          {/* 주 CTA — 존재만(누름→MANUAL origin 핸드오프는 후속 배선). */}
          <Pressable className="h-[52px] items-center justify-center rounded-button bg-primary">
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              이 위치로 계속
            </Text>
          </Pressable>

          {/* 건너뛰기 어포던스 — 서버 사다리(마지막 방문지/등록 숙소)로 위임, 클라가 재판정 안 함.
              중립 가정 문구를 캡션으로 밝힌다(AC-2). */}
          <Pressable
            testID="live-location-use-last-visit"
            className="items-center pt-xs"
          >
            <Text className="font-noto-bold text-card-title font-bold text-muted">
              위치 입력 건너뛰기
            </Text>
          </Pressable>
          <Text className="text-center font-noto text-label text-muted">
            마지막 방문지나 등록 숙소 기준·추정 출발지로 이어져요
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
