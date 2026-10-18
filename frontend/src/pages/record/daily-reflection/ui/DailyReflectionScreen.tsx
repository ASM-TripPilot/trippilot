import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatDayLabel } from '@/entities/trip';
import { MapView, type MapCenter, type MapPin } from '@/shared/map';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';
import { StateNotice } from '@/shared/ui/StateNotice';
import type { ReflectionStats } from '@/shared/api/index.schemas';

import type { MapNotice } from '../model/missingParts';
import { ChangeSummaryRow } from './ChangeSummaryRow';
import { isGuideText } from '../model/fillTemplate';
import { NarrativeBlock } from './NarrativeBlock';
import {
  BackArrowGlyph,
  EmptyCircleGlyph,
  LocationOffGlyph,
  PhotoOffGlyph,
  RetryGlyph,
} from '@/features/reflection/index.view';
import { ReflectionPhotoGrid } from './ReflectionPhotoGrid';
import { ReflectionStatsRow } from './ReflectionStatsRow';

/**
 * TRIP-571 · j03 오늘의 회고 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/표시본 조립 0).
 * 조립·조회·표시본 결정은 `pages/record/daily-reflection` 이 진다(이 파일은 `@/shared/*`·`@/entities/*` 만
 * import — 프리뷰 격리 렌더 안전, FSD 경계). 화면은 완성된 `narrative`·`editableText` 를 받고,
 * `draftNarrative`/`editedNarrative`/`resolveDisplayNarrative` 어느 것도 참조하지 않는다.
 *
 * 5얼굴(TRIP-763: 일차 탭·하단 탭바(기록)·헤더 "편집"은 전 얼굴 공통 크롬):
 *  - default            : stats · 풀폭 지도(좌표 있을 때만) · 서술 카드 · 사진 그리드 · "확인".
 *  - data-insufficient  : stats(거리 "—") + 지도 자리 사유(제목/본문 2줄) + 서술 + "사진 없음" 자리 · "확인".
 *  - empty              : 빈 원 일러스트 + "오늘 기록된 활동이 없습니다" · 하단 CTA "직접 회고 작성".
 *  - error              : stats 채움(BASIC 카드, INV-U5-07) + 에러 카드(다시 시도) · CTA "직접 회고 작성".
 *  - pending            : (TRIP-1068) 조회·생성 중 안내 본문만 · 하단 CTA 없음(empty 로 접지 않는다, INV-4).
 *
 * ★ 신규 표면 prop(dayTabs·activeDay·onSelectDay·onPressTab)은 전부 **옵셔널** — 미주입 호출자(프리뷰·
 *   무회귀 테스트)가 그대로 컴파일된다. 기분 3택·한 줄 메모는
 *   TRIP-935 R7 에서 저장 계약이 없어 걷었다가, 서버가 mood·shortMemo 를 받게 되어(TRIP-828) TRIP-1372 에서
 *   되살렸다 — `onChangeMood`·`onSaveShortMemo` 가 둘 다 있을 때만 그린다(글리프 없는 글자 칩, Figma 확인 필요).
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

/** TRIP-1372 · 기분 코드 3종 — 서버는 코드 모양만 보고 값 집합은 화면이 정한다. 순서가 곧 표시 순서. */
const MOODS = [
  { code: 'sad', label: '아쉬워요' },
  { code: 'soso', label: '괜찮았어요' },
  { code: 'good', label: '좋았어요' },
] as const;

/** TRIP-1372 · 한 줄 메모 상한 — 서버 계약(`shortMemo` maxLength 60)의 UX 사본, 권위는 서버. */
const SHORT_MEMO_MAX = 60;

/** 개행·탭 등 제어 문자를 공백으로 바꾼다(서버는 한 줄만 받는다 — 붙여넣기로 들어온 줄바꿈 방어). */
function toSingleLine(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ');
}

export type ReflectionFace =
  'default' | 'data-insufficient' | 'empty' | 'error' | 'pending';

/** 일차 탭 VM(페이지가 여행 기간에서 조립). `day` 는 1-기반 일차 번호(record 의 date 문자열과 다름, G2). */
export interface ReflectionDayTab {
  day: number;
  today?: boolean;
  /** TRIP-1425 · 아직 오지 않은 날 — 누를 수 없고 흐리게 보인다(판정은 페이지). */
  disabled?: boolean;
}

export interface DailyReflectionScreenProps {
  face: ReflectionFace;
  /** 표시본(reflectionFallback 상류 해소). */
  narrative: string;
  /** 편집 시드(페이지 조립, empty 얼굴=''). */
  editableText: string;
  stats: ReflectionStats;
  distanceDash: boolean;
  mapNotice: MapNotice | null;
  hidePhotoGrid: boolean;
  // photos 는 읽기만 하므로 readonly — 호출자가 `[] as const` 로 넘겨도 받는다(가변 배열도 그대로 할당됨).
  photos: readonly { uri: string }[];
  /** TRIP-1445 · AI 장면 블록(없으면 안 그린다). */
  scenesBlock?: ReactNode;
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
  /**
   * TRIP-980 · 보고 있는 날이 KST 오늘인가(옵셔널, 미주입=오늘). 아니면 헤더 "하루 회고"·empty
   * "이 날 기록된 활동이 없습니다"(사용자 확정 D2).
   */
  isToday?: boolean;
  /**
   * TRIP-1119 · 헤더 ‹ 뒤로가기(옵셔널, 미주입=‹ 는 그리되 눌러도 이동 없음). 편집 중 ‹ 는 화면이
   * 먼저 가로채 편집만 닫는다(결정 2 b — 편집은 화면 안 하위 상태, onBack 0회).
   */
  onBack?: () => void;
  /** TRIP-1372 · 서버가 돌려준 그날의 기분 코드(없으면 null). */
  mood?: string | null;
  /** TRIP-1372 · 서버가 돌려준 한 줄 메모(없으면 null). */
  shortMemo?: string | null;
  /**
   * TRIP-1372 · 기분 저장(코드, 지우기는 ''). 성공 여부를 돌려준다 — 실패면 화면이 알린다(INV-4).
   * 이 둘(`onChangeMood`·`onSaveShortMemo`)이 모두 있을 때만 기분·한 줄 입력을 그린다 — 저장할 곳 없는
   * 입력은 다시 들어오면 사라지는 거짓말이었다(TRIP-935 R7).
   */
  onChangeMood?: (code: string) => Promise<boolean>;
  /** TRIP-1372 · 한 줄 메모 저장(trim 한 값, 지우기는 ''). */
  onSaveShortMemo?: (text: string) => Promise<boolean>;
  onEnterEdit: () => void;
  onConfirm: () => void;
  /**
   * 저장. Promise 를 돌려주면 true(성공)일 때만 편집을 닫고, false 면 편집·입력을 그대로 둔 채 실패를
   * 알린다(TRIP-980, INV-4). 결과를 안 돌려주는 호출자(프리뷰·화면 테스트)는 예전처럼 즉시 닫는다.
   */
  onSaveEdit: (text: string) => void | Promise<boolean>;
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
  scenesBlock,
  changeSummary,
  mapCenter,
  mapPins,
  dayTabs,
  activeDay,
  onSelectDay,
  onPressTab,
  isToday = true,
  onBack,
  mood,
  shortMemo,
  onChangeMood,
  onSaveShortMemo,
  onEnterEdit,
  onConfirm,
  onSaveEdit,
}: DailyReflectionScreenProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(editableText);
  const [saveFailed, setSaveFailed] = useState(false);
  // 서버 기본 안내문은 회고 글이 아니다(TRIP-1212) — 그대로 저장되면 안내문이 회고로 남는다.
  const canSave = text.trim().length > 0 && !isGuideText(text);
  const isDataFace = face === 'default' || face === 'data-insufficient';

  const handleEnterEdit = () => {
    onEnterEdit();
    setText(isGuideText(editableText) ? '' : editableText);
    setSaveFailed(false);
    setEditing(true);
  };
  const handleCancel = () => {
    setEditing(false);
  };
  const handleBack = () => {
    if (editing) {
      handleCancel();
      return;
    }
    onBack?.();
  };
  // TRIP-1372 · 기분·한 줄. 한 줄 초안은 손대기 전(null)엔 서버 값을 그대로 보인다.
  const extrasOn = onChangeMood !== undefined && onSaveShortMemo !== undefined;
  const [memoDraft, setMemoDraft] = useState<string | null>(null);
  const [extrasFailed, setExtrasFailed] = useState(false);
  const memoShown = memoDraft ?? shortMemo ?? '';
  const memoToSave = toSingleLine(memoShown).trim();
  const memoDirty = memoToSave !== (shortMemo ?? '');

  const handleMood = (code: string) => {
    if (!onChangeMood) return;
    setExtrasFailed(false);
    // 선택한 칩을 다시 누르면 지운다(빈 문자열).
    void onChangeMood(mood === code ? '' : code).then((saved) => {
      if (!saved) setExtrasFailed(true);
    });
  };
  /** 한 줄이 바뀌었으면 저장한다. 안 바뀌었으면 요청 없이 true. */
  const flushMemo = async (): Promise<boolean> => {
    if (!onSaveShortMemo || !memoDirty) return true;
    setExtrasFailed(false);
    const saved = await onSaveShortMemo(memoToSave);
    if (saved) setMemoDraft(null);
    else setExtrasFailed(true);
    return saved;
  };
  // 「확인」은 쓴 한 줄이 저장돼야 닫는다 — 키보드가 떠 있어도 첫 탭이 버튼으로 가서(handled) blur 저장이 안 돈다.
  const handleDataConfirm = () => {
    if (!extrasOn || !memoDirty) {
      onConfirm();
      return;
    }
    void flushMemo().then((saved) => {
      if (saved) onConfirm();
    });
  };

  const handleSave = () => {
    if (!canSave) return;
    setSaveFailed(false);
    const pending = onSaveEdit(text);
    if (!(pending instanceof Promise)) {
      setEditing(false);
      return;
    }
    void pending.then((saved) => {
      if (saved) setEditing(false);
      else setSaveFailed(true);
    });
  };

  const extrasBlock = extrasOn ? (
    <View testID="reflection-daily-extras" className="w-full gap-md">
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        오늘 어땠어요?
      </Text>
      <View className="w-full flex-row gap-sm">
        {MOODS.map(({ code, label }) => {
          const selected = mood === code;
          return (
            <Pressable
              key={code}
              testID={`reflection-daily-mood-${code}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => handleMood(code)}
              className={`flex-1 items-center rounded-pill py-sm ${
                selected
                  ? 'bg-primary'
                  : 'border border-hairline-strong bg-canvas'
              }`}
            >
              <Text
                className={`text-label ${
                  selected ? 'font-noto-bold font-bold text-white' : 'text-ink'
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="w-full flex-row items-center gap-sm rounded-card border border-hairline-strong bg-canvas px-lg py-[10px]">
        <TextInput
          testID="reflection-daily-memo-input"
          value={memoShown}
          onChangeText={(next) => setMemoDraft(toSingleLine(next))}
          onEndEditing={() => void flushMemo()}
          maxLength={SHORT_MEMO_MAX}
          placeholder="오늘 하루를 한 줄로 남겨보세요"
          className="flex-1 font-noto text-body text-ink"
        />
        <Text className="font-noto text-label text-muted">
          {`${memoShown.length}/${SHORT_MEMO_MAX}`}
        </Text>
      </View>
      {extrasFailed ? (
        <Text className="font-noto text-label text-primary-text">
          저장하지 못했어요. 다시 시도해 주세요
        </Text>
      ) : null}
    </View>
  ) : null;

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
          <Text
            testID={`reflection-daily-map-notice-reason-${mapNotice.reason}`}
            className="text-center font-noto text-label text-muted"
          >
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
        <Pressable
          testID="reflection-daily-back"
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={handleBack}
          className="pr-[4px]"
        >
          <BackArrowGlyph size={24} />
        </Pressable>
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          {isToday ? '오늘의 회고' : '하루 회고'}
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
                // disabled 는 누름을 막고 RN 이 accessibilityState.disabled 로도 합쳐 싣는다.
                disabled={tab.disabled}
                accessibilityState={{ selected: active }}
                onPress={() => onSelectDay?.(tab.day)}
                className={`rounded-pill px-lg py-sm ${
                  active
                    ? 'bg-primary'
                    : 'border border-hairline-strong bg-canvas'
                }${tab.disabled ? ' opacity-40' : ''}`}
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

      {/* TRIP-1211 · 편집 중엔 키보드가 올라오면 본문이 줄어들고(KeyboardAvoidingView), 저장·취소는 스크롤 밖
          고정 푸터라 긴 글에서도 키보드 바로 위에 닿는다. 스크롤·탭이 키보드를 내리고(keyboardDismissMode),
          키보드가 떠 있어도 첫 탭이 버튼으로 간다(keyboardShouldPersistTaps="handled"). jest 는 실제 키보드를
          못 본다 — 구조(회피 컨테이너·푸터 위치·prop)만 잠그고 동작은 실기. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
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
              {saveFailed ? (
                <Text className="font-noto text-label text-primary-text">
                  저장하지 못했어요. 다시 시도해 주세요
                </Text>
              ) : null}
            </View>
          ) : face === 'pending' ? (
            <StateNotice
              testID="reflection-daily-pending"
              illustration={
                <View className="h-[72px] w-[72px] rounded-full bg-surface-soft" />
              }
              title="회고를 준비하고 있어요"
              description="잠시만 기다려 주세요"
              actions={[]}
            />
          ) : face === 'empty' ? (
            <View
              testID="reflection-daily-empty"
              className="w-full items-center gap-md py-[64px]"
            >
              <EmptyCircleGlyph size={60} />
              <Text className="font-noto text-body text-muted">
                {isToday
                  ? '오늘 기록된 활동이 없습니다'
                  : '이 날 기록된 활동이 없습니다'}
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

              {scenesBlock}

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

              {extrasBlock}

              {/* changeSummary 는 default 얼굴에서 그리지 않는다(prop 은 무회귀로 유지). */}
              {/* 하단 CTA — 저장할 입력이 없으니 "확인"(TRIP-935 R7). data-insufficient 와 같은 이름표. */}
              <Pressable
                testID="reflection-daily-confirm"
                onPress={handleDataConfirm}
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

              {extrasBlock}

              {changeSummary ? (
                <ChangeSummaryRow changeSummary={changeSummary} />
              ) : null}
            </>
          )}
        </ScrollView>

        {editing ? (
          <View className="w-full bg-canvas px-lg pb-md pt-sm">
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
        ) : face !== 'default' && face !== 'pending' ? (
          // 하단 CTA(data-insufficient: "확인" · empty/error: "직접 회고 작성"=편집 진입). TRIP-1425 · 편집 푸터처럼
          // 회피 컨테이너 안·스크롤 뒤에 둬야 한 줄 입력 중 키보드에 밀려 올라와 [확인]이 안 가린다(실기 6-b).
          // pb-[104px] 는 탭바(96) 위에 앉히는 여백 — 키보드가 떠도 남는 빈 띠는 그대로 둔다(Seed Q4).
          <View className="w-full bg-canvas px-lg pb-[104px] pt-[8px]">
            {isDataFace ? (
              <Pressable
                testID="reflection-daily-confirm"
                onPress={handleDataConfirm}
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
      </KeyboardAvoidingView>

      {/* 하단 탭바(기록 활성) — 전 얼굴 공통 오버레이, 편집 중엔 숨김. CTA 는 위 회피 컨테이너 안에 있다. */}
      {editing ? null : (
        <BottomTabBar
          activeKey="records"
          onPressTab={onPressTab ?? (() => {})}
        />
      )}
    </SafeAreaView>
  );
}
