import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatDayLabel } from '@/entities/trip/lib/formatDayLabel';
import { MapView, type MapCenter, type MapPin } from '@/shared/map';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';
import type { ReflectionStats } from '@/shared/api/generated/schemas';

import { ChangeSummaryRow } from './ChangeSummaryRow';
import { NarrativeBlock } from './NarrativeBlock';
import {
  BackArrowGlyph,
  EmptyCircleGlyph,
  LocationOffGlyph,
  PhotoOffGlyph,
  RetryGlyph,
} from './ReflectionGlyphs';
import { ReflectionPhotoGrid } from './ReflectionPhotoGrid';
import { ReflectionStatsRow } from './ReflectionStatsRow';

/**
 * TRIP-571 · j03 오늘의 회고 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/표시본 조립 0).
 * 조립·조회·표시본 결정은 `pages/daily-reflection` 이 진다(이 파일은 `@/shared/*`·`@/entities/*` 만
 * import — 프리뷰 격리 렌더 안전, FSD 경계). 화면은 완성된 `narrative`·`editableText` 를 받고,
 * `draftNarrative`/`editedNarrative`/`resolveDisplayNarrative` 어느 것도 참조하지 않는다.
 *
 * 4얼굴(TRIP-763: 일차 탭·하단 탭바(기록)·헤더 "편집"은 전 얼굴 공통 크롬):
 *  - default            : stats · 풀폭 지도(좌표 있을 때만) · 서술 카드 · 사진 그리드 · "확인".
 *  - data-insufficient  : stats(거리 "—") + 지도 자리 사유(제목/본문 2줄) + 서술 + "사진 없음" 자리 · "확인".
 *  - empty              : 빈 원 일러스트 + "오늘 기록된 활동이 없습니다" · 하단 CTA "직접 회고 작성".
 *  - error              : stats 채움(BASIC 카드, INV-U5-07) + 에러 카드(다시 시도) · CTA "직접 회고 작성".
 *
 * ★ 신규 표면 prop(dayTabs·activeDay·onSelectDay·onPressTab)은 전부 **옵셔널** — 미주입 호출자(프리뷰·
 *   무회귀 테스트)가 그대로 컴파일된다. Figma 의 기분 3택·메모 입력은 그리지 않는다(TRIP-935 R7) —
 *   저장 계약이 없어 다시 들어오면 사라지는 입력이었다(통합 저장은 계약 확장 티켓 TRIP-823).
 *
 * ★ 편집 진입은 헤더 "편집"(`reflection-daily-edit`, 전 얼굴 · default 는 서술 카드 "수정"으로도 진입)이
 *   진다. empty/error 하단 CTA "직접 회고 작성"은 헤더와 같은 화면에 공존하므로 testID 를 분리한다
 *   (`reflection-daily-compose`, 둘 다 `handleEnterEdit`) — 겹치면 `getByTestId` 가 throw. 편집을 열면 상한
 *   4000(`EditReflectionRequest.maxLength`, 서버 권위) — 빈/공백 텍스트는 저장 비활성 + 저장 콜백 0회.
 *
 * 지도 좌표·핀은 옵셔널 — 회고 계약(`Reflection`)에 좌표가 없어 페이지가 채우면 쓰고, 없으면 default 는
 * 지도 자리를 그리지 않고(TRIP-935 R7) data-insufficient 는 누락 사유를 표기한다(US-REC-06). 가짜 기본
 * 센터 지도 금지. 신규 지도 컴포넌트 금지 — `shared/map/MapView` 재사용, viewOnly.
 */

export type ReflectionFace =
  'default' | 'data-insufficient' | 'empty' | 'error';

/** 일차 탭 VM(페이지가 여행 기간에서 조립). `day` 는 1-기반 일차 번호(record 의 date 문자열과 다름, G2). */
export interface ReflectionDayTab {
  day: number;
  today?: boolean;
}

export interface DailyReflectionScreenProps {
  face: ReflectionFace;
  /** 표시본(reflectionFallback 상류 해소). */
  narrative: string;
  /** 편집 시드(페이지 조립, empty 얼굴=''). */
  editableText: string;
  stats: ReflectionStats;
  distanceDash: boolean;
  mapNotice: { title: string; body: string } | null;
  hidePhotoGrid: boolean;
  // photos 는 읽기만 하므로 readonly — 호출자가 `[] as const` 로 넘겨도 받는다(가변 배열도 그대로 할당됨).
  photos: readonly { uri: string }[];
  changeSummary?: string | null;
  mapCenter?: MapCenter;
  mapPins?: MapPin[];
  /** TRIP-762(default) — 일차 탭 목록(옵셔널, 미주입=탭 없음). */
  dayTabs?: ReflectionDayTab[];
  /** TRIP-762(default) — 활성 일차(1-기반). */
  activeDay?: number;
  /** TRIP-762(default) — 일차 탭 선택. */
  onSelectDay?: (day: number) => void;
  /** TRIP-762(default) — 하단 탭바 라우팅. */
  onPressTab?: (key: ShellTabKey) => void;
  onEnterEdit: () => void;
  onConfirm: () => void;
  onSaveEdit: (text: string) => void;
}

export function DailyReflectionScreen({
  face,
  narrative,
  editableText,
  stats,
  distanceDash,
  mapNotice,
  hidePhotoGrid,
  photos,
  changeSummary,
  mapCenter,
  mapPins,
  dayTabs,
  activeDay,
  onSelectDay,
  onPressTab,
  onEnterEdit,
  onConfirm,
  onSaveEdit,
}: DailyReflectionScreenProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(editableText);
  const canSave = text.trim().length > 0;
  const isDataFace = face === 'default' || face === 'data-insufficient';

  const handleEnterEdit = () => {
    onEnterEdit();
    setText(editableText);
    setEditing(true);
  };
  const handleCancel = () => {
    setEditing(false);
  };
  const handleSave = () => {
    if (!canSave) return;
    onSaveEdit(text);
    setEditing(false);
  };

  const hasMap = mapCenter !== undefined && (mapPins?.length ?? 0) > 0;
  const mapArea = hasMap ? (
    // 풀폭 250h · radius 0(px-lg 패딩 바깥으로 -mx-lg 하여 화면 폭 꽉 채운다).
    <View className="-mx-lg h-[250px] overflow-hidden">
      <MapView center={mapCenter} pins={mapPins} viewOnly />
    </View>
  ) : (
    // 실 좌표가 없으면 지도를 그리지 않는다 — 하드코딩 기본 센터(서울)를 실데이터처럼 그리면
    // 부산 하루에 서울 지도가 뜨는 거짓 정보가 된다. 회고 계약(Reflection)에 좌표가 없어 오늘은 늘 이 가지다.
    <View
      testID="reflection-daily-map-notice"
      className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
    >
      <LocationOffGlyph size={30} />
      {mapNotice ? (
        // 제목·본문을 각각 leaf Text 로 — 객체를 한 슬롯에 넣으면 React child 에러라 2줄로 나눈다.
        <>
          <Text className="text-center font-noto-bold text-body font-bold text-ink">
            {mapNotice.title}
          </Text>
          <Text className="text-center font-noto text-label text-muted">
            {mapNotice.body}
          </Text>
        </>
      ) : (
        <Text className="text-center font-noto text-label text-muted">
          위치 정보를 표시할 수 없어요
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* 헤더 — 뒤로 · 제목 · (data 얼굴·비편집) 편집 링크. TRIP-762: 헤더 공유 제거(j03 공유 0). */}
      <View className="w-full flex-row items-center bg-canvas pb-[12px] pl-[12px] pr-lg pt-[4px]">
        <View className="pr-[4px]">
          <BackArrowGlyph size={24} />
        </View>
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          오늘의 회고
        </Text>
        <View className="flex-1" />
        {!editing ? (
          <Pressable
            testID="reflection-daily-edit"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={handleEnterEdit}
          >
            <Text className="font-noto-bold text-body font-bold text-primary">
              편집
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* 일차 탭(전 얼굴 공통, 헤더 아래 고정). 활성 탭만 코랄 pill — 색이 아니라
          accessibilityState.selected 로 잠근다(fill jest 사각). 라벨은 한글 N일차(formatDayLabel 재사용),
          오늘 탭엔 "오늘 ·" 접두. record 의 day-tab testID·타입은 쓰지 않는다(G2). */}
      {!editing && dayTabs && dayTabs.length > 0 ? (
        <View className="w-full flex-row gap-sm bg-canvas px-lg pb-[10px] pt-[4px]">
          {dayTabs.map((tab) => {
            const active = tab.day === activeDay;
            const label = tab.today
              ? `오늘 · ${formatDayLabel(tab.day)}`
              : formatDayLabel(tab.day);
            return (
              <Pressable
                key={tab.day}
                testID={`reflection-daily-day-tab-${tab.day}`}
                accessibilityState={{ selected: active }}
                onPress={() => onSelectDay?.(tab.day)}
                className={`rounded-pill px-lg py-sm ${
                  active
                    ? 'bg-primary'
                    : 'border border-hairline-strong bg-canvas'
                }`}
              >
                <Text
                  className={`text-label ${
                    active ? 'font-noto-bold text-white' : 'text-ink'
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <ScrollView
        className="flex-1"
        contentContainerClassName={`gap-md px-lg pt-[8px] ${
          face === 'default' && !editing ? 'pb-[120px]' : 'pb-[32px]'
        }`}
      >
        {editing ? (
          <View className="w-full gap-md pt-[8px]">
            <TextInput
              testID="reflection-daily-edit-input"
              value={text}
              onChangeText={setText}
              maxLength={4000}
              multiline
              textAlignVertical="top"
              placeholder="직접 회고를 작성해 보세요"
              className="min-h-[180px] rounded-card border border-hairline-strong bg-canvas p-lg font-noto text-body text-ink"
            />
            <View className="flex-row gap-sm">
              <Pressable
                testID="reflection-daily-edit-cancel"
                onPress={handleCancel}
                className="h-12 flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
              >
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  취소
                </Text>
              </Pressable>
              <Pressable
                testID="reflection-daily-edit-save"
                disabled={!canSave}
                accessibilityState={{ disabled: !canSave }}
                onPress={handleSave}
                className={`h-12 flex-1 items-center justify-center rounded-button ${
                  canSave ? 'bg-primary' : 'bg-surface-strong'
                }`}
              >
                <Text
                  className={`font-noto-bold text-card-title font-bold ${
                    canSave ? 'text-on-primary' : 'text-muted-soft'
                  }`}
                >
                  저장
                </Text>
              </Pressable>
            </View>
          </View>
        ) : face === 'empty' ? (
          <View
            testID="reflection-daily-empty"
            className="w-full items-center gap-md py-[64px]"
          >
            <EmptyCircleGlyph size={60} />
            <Text className="font-noto text-body text-muted">
              오늘 기록된 활동이 없습니다
            </Text>
          </View>
        ) : face === 'error' ? (
          <>
            <ReflectionStatsRow stats={stats} distanceDash={distanceDash} />
            <View
              testID="reflection-daily-error"
              className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
            >
              <Text className="font-noto-bold text-body font-bold text-ink">
                회고를 불러오지 못했어요
              </Text>
              <Text className="text-label text-muted">
                직접 회고를 작성할 수 있어요
              </Text>
              <Pressable
                testID="reflection-daily-retry"
                onPress={onConfirm}
                className="mt-sm flex-row items-center gap-[6px] rounded-button border border-hairline-strong bg-canvas px-lg py-sm"
              >
                <RetryGlyph size={16} />
                <Text className="font-noto-bold text-label font-bold text-ink">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          </>
        ) : face === 'default' ? (
          <>
            <ReflectionStatsRow stats={stats} distanceDash={distanceDash} />

            {/* 좌표 없으면 지도 자리 자체를 그리지 않는다(TRIP-935 R7 — 늘 빈 점선 박스였다). */}
            {hasMap ? mapArea : null}

            {/* 서술 카드 — 헤드 "오늘의 기록" + "수정"(편집 진입, 죽은 링크 아님) + 본문(NarrativeBlock). */}
            <View className="w-full gap-sm rounded-card bg-surface-soft px-lg py-md">
              <View className="flex-row items-center">
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  오늘의 기록
                </Text>
                <View className="flex-1" />
                <Pressable
                  testID="reflection-daily-narrative-edit"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={handleEnterEdit}
                >
                  <Text className="font-noto-bold text-label font-bold text-primary">
                    수정
                  </Text>
                </Pressable>
              </View>
              <NarrativeBlock narrative={narrative} />
            </View>

            {hidePhotoGrid ? (
              <View
                testID="reflection-daily-photo-empty"
                className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
              >
                <PhotoOffGlyph size={26} />
                <Text className="text-label text-muted">사진 없음</Text>
              </View>
            ) : (
              <ReflectionPhotoGrid photos={photos} />
            )}

            {/* changeSummary 는 default 얼굴에서 그리지 않는다(prop 은 무회귀로 유지). */}
            {/* 하단 CTA — 저장할 입력이 없으니 "확인"(TRIP-935 R7). data-insufficient 와 같은 이름표. */}
            <Pressable
              testID="reflection-daily-confirm"
              onPress={onConfirm}
              className="h-[52px] w-full items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                확인
              </Text>
            </Pressable>
          </>
        ) : (
          // data-insufficient (무회귀 — 기존 표면 유지).
          <>
            <ReflectionStatsRow stats={stats} distanceDash={distanceDash} />
            {mapArea}

            <NarrativeBlock narrative={narrative} />

            {hidePhotoGrid ? (
              <View
                testID="reflection-daily-photo-empty"
                className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
              >
                <PhotoOffGlyph size={26} />
                <Text className="text-label text-muted">사진 없음</Text>
              </View>
            ) : (
              <ReflectionPhotoGrid photos={photos} />
            )}

            {changeSummary ? (
              <ChangeSummaryRow changeSummary={changeSummary} />
            ) : null}
          </>
        )}
      </ScrollView>

      {/* 하단 — 탭바(기록 활성)는 전 얼굴 공통 오버레이. 비-default 얼굴은 그 위에 CTA 를 함께 얹는다
          (data-insufficient: "확인" · empty/error: "직접 회고 작성"=편집 진입). CTA 는 탭바 높이(96)만큼
          아래 여백을 둬 탭바 위에 앉는다(세로 순서 자체는 6-b 육안). 편집 중엔 모두 숨김. */}
      {editing ? null : (
        <>
          {face !== 'default' ? (
            <View className="w-full bg-canvas px-lg pb-[104px] pt-[8px]">
              {isDataFace ? (
                <Pressable
                  testID="reflection-daily-confirm"
                  onPress={onConfirm}
                  className="h-[52px] w-full items-center justify-center rounded-button bg-primary"
                >
                  <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                    확인
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  testID="reflection-daily-compose"
                  onPress={handleEnterEdit}
                  className="h-[52px] w-full items-center justify-center rounded-button bg-primary"
                >
                  <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                    직접 회고 작성
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null}
          <BottomTabBar
            activeKey="records"
            onPressTab={onPressTab ?? (() => {})}
          />
        </>
      )}
    </SafeAreaView>
  );
}
