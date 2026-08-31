import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KakaoMapView, type MapCenter, type MapPin } from '@/shared/map';
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
 * 조립·조회·표시본 결정은 `pages/daily-reflection` 이 진다(이 파일은 `@/shared/*` 만 import — 프리뷰
 * 격리 렌더 안전, FSD 경계). 화면은 완성된 `narrative`·`editableText` 를 받고, `draftNarrative`/
 * `editedNarrative`/`resolveDisplayNarrative` 어느 것도 참조하지 않는다(AC-8 이 소스로 강제).
 *
 * 4얼굴:
 *  - default            : stats + 지도 + 서술 + 사진 그리드 + 변경요약 · 헤더 "편집" · 하단 "확인".
 *  - data-insufficient  : stats(거리 "—") + 지도 자리 사유 + 서술 + "사진 없음" 자리 · 헤더 "편집" · "확인".
 *  - empty              : 빈 원 일러스트 + "오늘 기록된 활동이 없습니다" · 하단 CTA "직접 회고 작성".
 *  - error              : stats 채움(BASIC 카드, INV-U5-07) + 에러 카드(다시 시도) · CTA "직접 회고 작성".
 *
 * ★ 편집 진입 컨트롤은 얼굴당 정확히 1개라 `reflection-daily-edit` 단일 testID 로 충돌 없이 쓴다 —
 *   default/data-insufficient 는 헤더 "편집", empty/error 는 하단 CTA "직접 회고 작성"(둘 다 `handleEnterEdit`).
 * ★ 편집을 열면 입력 상한은 **4000**(`EditReflectionRequest.maxLength`, 서버 권위) — 빈/공백 텍스트는
 *   저장 비활성 + 저장 콜백 0회(초안 보존, 덮어쓰기 불가). `source` 자리는 VM 에 없다(맹점② 구조적 차단).
 *
 * 지도 좌표·핀은 옵셔널 — 회고 계약(`Reflection`)에 좌표가 없어 페이지가 채우면 쓰고, 없으면 지도 대신
 * 자리표시(가짜 기본 센터 지도 금지, 5-b 경고-2). 신규 지도 컴포넌트 금지 — `shared/map/KakaoMapView`
 * 재사용, viewOnly 글랜스.
 */

export type ReflectionFace =
  'default' | 'data-insufficient' | 'empty' | 'error';

export interface DailyReflectionScreenProps {
  face: ReflectionFace;
  /** 표시본(reflectionFallback 상류 해소). */
  narrative: string;
  /** 편집 시드(페이지 조립, empty 얼굴=''). */
  editableText: string;
  stats: ReflectionStats;
  distanceDash: boolean;
  mapNotice: string | null;
  hidePhotoGrid: boolean;
  photos: { uri: string }[];
  changeSummary?: string | null;
  mapCenter?: MapCenter;
  mapPins?: MapPin[];
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

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* 헤더 — 뒤로 · 제목 · (data 얼굴·비편집) 편집 링크 */}
      <View className="w-full flex-row items-center bg-canvas pb-[12px] pl-[12px] pr-lg pt-[4px]">
        <View className="pr-[4px]">
          <BackArrowGlyph size={24} />
        </View>
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          오늘의 회고
        </Text>
        <View className="flex-1" />
        {!editing && isDataFace ? (
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

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-md px-lg pb-[32px] pt-[8px]"
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
            <EmptyCircleGlyph size={72} />
            <Text className="font-noto text-body text-muted">
              오늘 기록된 활동이 없습니다
            </Text>
          </View>
        ) : face === 'error' ? (
          <>
            <ReflectionStatsRow stats={stats} distanceDash={distanceDash} />
            <View
              testID="reflection-daily-error"
              className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong px-lg py-3xl"
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
                <Text className="font-noto-bold text-label font-bold text-primary">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <ReflectionStatsRow stats={stats} distanceDash={distanceDash} />
            {mapCenter && (mapPins?.length ?? 0) > 0 ? (
              <View className="h-[220px] w-full overflow-hidden rounded-card">
                <KakaoMapView center={mapCenter} pins={mapPins} viewOnly />
              </View>
            ) : (
              // 실 좌표가 없으면 지도를 그리지 않는다 — 하드코딩 기본 센터(서울)를
              // 실데이터처럼 그리면 부산 하루에 서울 지도가 뜨는 거짓 정보가 된다
              // (5-b 경고-2). 회고 계약(Reflection)에 좌표가 없어 오늘은 늘 이 가지다.
              <View
                testID="reflection-daily-map-notice"
                className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
              >
                <LocationOffGlyph size={30} />
                <Text className="text-center font-noto text-label text-muted">
                  {mapNotice ?? '위치 정보를 표시할 수 없어요'}
                </Text>
              </View>
            )}

            <NarrativeBlock narrative={narrative} />

            {hidePhotoGrid ? (
              <View
                testID="reflection-daily-photo-empty"
                className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong px-lg py-3xl"
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

      {/* 하단 CTA — data 얼굴: "확인" · empty/error: "직접 회고 작성"(편집 진입). 편집 중엔 숨김. */}
      {!editing ? (
        <View className="w-full bg-canvas px-lg pb-[24px] pt-[8px]">
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
              testID="reflection-daily-edit"
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
    </SafeAreaView>
  );
}
