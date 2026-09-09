/**
 * TRIP-673 g02 숙소 선택 시트(S9, Figma `3669:2068`) — **props만 받는 프레젠테이션**(01b D5).
 *
 * 그 밤에 묵을 거점 숙소를 저장 숙소(♥) 후보 중 하나로 고르는 바텀시트다. 조회·드래프트(선택
 * savedStayId)·구간 계산·라우팅은 전부 배선(`TripNewStep2Page`)이 지고, 이 시트는 완성된
 * props(제목·날짜 라벨·후보·선택 id·콜백)만 받아 그린 뒤 press 를 콜백으로 올린다(자매 시트
 * `CompanionEditSheet` 크롬·토큰 계승).
 *
 * 무엇을 그리나:
 *  - **헤더**(AC-1) 박 라벨·지역 제목 + "{날짜(요일)} 밤 · 어디서 묵을까요?" 부제. 정적 카피는
 *    시트가 소유하고, 제목·날짜 라벨은 배선이 밤 카드에서 조립해 내린다.
 *  - **후보 카드**(AC-2) 회색 사진 placeholder + 이름 + 날짜 서브라인(checkIn·checkOut 둘 다 있으면
 *    `formatStayDateRange`=`6.10~6.13`, 없으면 "날짜 없음") + 단일 선택 체크. SavedStay 계약에
 *    price·imageUrl 이 없어(실측) **가격·거리·사진을 발명하지 않는다**(INV-1 · FG-2).
 *  - **단일 선택**(★2) 선택 표식은 색 fill 이 아니라 `accessibilityState={{selected}}`다 — 색만 바꾸는
 *    구현은 jest 무심판이라(글리프 fill 함정, repo-traps) 접근성 상태로 관찰 가능하게 한다.
 *  - **둘러보기**(AC-3, outline) + **이 밤 거점으로 지정**(AC-4, primary, 미선택 시 진짜 `disabled`
 *    prop — accessibilityState 만 세운 가짜는 press 가 그대로 발화한다, [[disabled prop과 accessibilityState]]).
 *  - **후보 0건**(AC-5) empty 안내 + 둘러보기만(지정 CTA 는 그릴 대상이 없어 미렌더).
 *  - **실패 인라인**(★4·INV-4) `assignFailed` 면 오류 문구를 세운다 — 실패를 침묵하지 않는다.
 *
 * ⚠️ 실개폐·딤 전면 커버·중앙정렬·터치 차단은 `@gorhom/bottom-sheet` 통과형 목이라 jest 원리적
 * 사각(repo-traps 바텀시트 함정) — 6-b 실기(`_dev/preview.tsx` 의 시트 열림 키) 몫이다.
 */
import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { SavedStay } from '@/shared/api/generated/schemas';

import { formatStayDateRange } from '../model/stayDateImport';

import { CheckGlyph, SearchGlyph } from './TripGlyphs';

export interface StaySelectSheetProps {
  /** 헤더 제목(박 라벨·지역 — 배선이 조립). 예 "2박 · 부산". */
  title: string;
  /** 그 밤 날짜 라벨(nightlyBaseCards 출력). 예 "6/11(목)". */
  dateLabel: string;
  /** 후보 = 저장 숙소 목록(useSavedStays 결과, 배선이 내림). */
  candidates: SavedStay[];
  /** 드래프트 선택 — 배선이 소유. null 이면 미선택(지정 disabled). */
  selectedSavedStayId: string | null;
  /** 후보 press → 배선 드래프트 갱신. */
  onSelect: (savedStayId: string) => void;
  /** "숙소 둘러보기" → 배선이 탐색 라우트로. */
  onBrowse: () => void;
  /** "이 밤 거점으로 지정" → 배선이 밤 구간을 계산해 POST. */
  onAssign: () => void;
  /** POST 실패 → 인라인 오류(INV-4). 성공/미시도면 미렌더. */
  assignFailed?: boolean;
  /** 딤 바깥 탭·아래로 스와이프 → 배선: 시트 닫기(TRIP-683 AC-2·AC-3). */
  onClose: () => void;
}

/** 딤(backdrop) — 리포 표준 idiom(OtaChoiceSheet 선례). */
function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

const EMPTY_MESSAGE = '저장한 숙소가 아직 없어요';
const ASSIGN_FAILED_MESSAGE = '지정하지 못했어요 · 잠시 후 다시 시도해 주세요';

/** 후보 한 장 — 사진 자리(회색)·이름·날짜 서브라인·선택 체크. 선택 표식은 색 fill 이 아니라
 * `accessibilityState`(관측 가능) + 우측 체크로 잰다(★2). */
function CandidateCard({
  stay,
  selected,
  onSelect,
}: {
  stay: SavedStay;
  selected: boolean;
  onSelect: (savedStayId: string) => void;
}): ReactElement {
  const dateLine =
    stay.checkIn && stay.checkOut
      ? formatStayDateRange(stay.checkIn, stay.checkOut)
      : '날짜 없음';

  return (
    <Pressable
      testID={`trip-base-staysheet-cand-${stay.savedStayId}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onSelect(stay.savedStayId)}
      className={`w-full flex-row items-center gap-md rounded-card border py-[10px] pl-[10px] pr-[14px] ${
        selected ? 'border-primary' : 'border-hairline-strong'
      }`}
    >
      {/* 사진 자리 — SavedStay 계약에 imageUrl 이 없어 회색 placeholder 만(발명 금지, INV-1). */}
      <View className="h-[56px] w-[56px] rounded-[12px] bg-surface-strong" />
      <View className="flex-1 gap-[2px]">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {stay.name}
        </Text>
        <Text className="font-noto text-caption text-muted">{dateLine}</Text>
      </View>
      {selected ? <CheckGlyph size={22} /> : null}
    </Pressable>
  );
}

export function StaySelectSheet({
  title,
  dateLabel,
  candidates,
  selectedSavedStayId,
  onSelect,
  onBrowse,
  onAssign,
  assignFailed,
  onClose,
}: StaySelectSheetProps): ReactElement {
  const empty = candidates.length === 0;

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="trip-base-staysheet"
        className="gap-lg px-xl pb-[34px] pt-[10px]"
      >
        {/* grabber */}
        <View className="items-center">
          <View className="h-[4px] w-[40px] rounded-[2px] bg-hairline-strong" />
        </View>

        {/* header */}
        <View className="gap-xs">
          <Text className="text-[20px] font-noto-bold font-bold text-ink">
            {title}
          </Text>
          <Text className="font-noto text-label text-muted">
            {`${dateLabel} 밤 · 어디서 묵을까요?`}
          </Text>
        </View>

        {/* body — 후보 목록 또는 0건 안내(둘은 상호배타) */}
        {empty ? (
          <View testID="trip-base-staysheet-empty" className="py-xl">
            <Text className="font-noto text-body text-muted">
              {EMPTY_MESSAGE}
            </Text>
          </View>
        ) : (
          <View className="gap-sm">
            {candidates.map((stay) => (
              <CandidateCard
                key={stay.savedStayId}
                stay={stay}
                selected={stay.savedStayId === selectedSavedStayId}
                onSelect={onSelect}
              />
            ))}
          </View>
        )}

        {/* 실패 인라인(INV-4) — 침묵하지 않는다. 성공/미시도면 미렌더. */}
        {assignFailed ? (
          <Text
            testID="trip-base-staysheet-error"
            className="font-noto text-label text-primary-text"
          >
            {ASSIGN_FAILED_MESSAGE}
          </Text>
        ) : null}

        {/* 둘러보기(outline) — 후보가 있든 없든 항상 있는 탈출구. */}
        <Pressable
          testID="trip-base-staysheet-browse"
          accessibilityRole="button"
          onPress={onBrowse}
          className="h-[52px] w-full flex-row items-center justify-center gap-xs rounded-button border-[1.2px] border-hairline-strong bg-canvas"
        >
          <SearchGlyph size={20} />
          <Text className="font-noto-bold text-body font-bold text-ink">
            숙소 둘러보기
          </Text>
        </Pressable>

        {/* 지정(primary) — 후보가 있을 때만. 미선택이면 진짜 disabled 라 눌러도 발화 0(★3). */}
        {empty ? null : (
          <Pressable
            testID="trip-base-staysheet-assign"
            accessibilityRole="button"
            disabled={selectedSavedStayId === null}
            onPress={onAssign}
            className={`h-[52px] w-full items-center justify-center rounded-button bg-primary ${
              selectedSavedStayId === null ? 'opacity-40' : ''
            }`}
          >
            <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
              이 밤 거점으로 지정
            </Text>
          </Pressable>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}
