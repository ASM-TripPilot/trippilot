import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CARD_SHADOW } from '@/features/settings';
import {
  BedGlyph,
  ChevronLeftGlyph,
  ChevronRightGlyph,
  MUTED,
} from '@/features/settings';

/**
 * TRIP-605 · l04 등록 숙소·예약 기록 화면 — 순수 프레젠테이션(VM 주입). 조회·조합·N+1·포맷은
 * 페이지(`pages/stay/my-stays`)가 진다(MyPageScreen↔TripCardContainer 분리 규율, features/settings 경계).
 *
 * 「출발점 변경」(TRIP-1076 결정 2(A)): 등록 행의 링크 press = `onPressChangeBase(row)` 1회 — 이 화면은
 * 거점을 바꾸지도, 확인 다이얼로그를 띄우지도 않는다. 바꾸기는 페이지가 여는 그 여행의 거점 화면이 한다.
 * Figma 확인 다이얼로그(1606 「일정 다시 생성」)를 안 띄우는 이유: 거점 화면은 일정을 재생성하지 않아 그
 * 문구가 거짓 안내가 된다(INV-4). 옛 해제 다이얼로그(`BaseToggleDialog`)는 TRIP-1191 로 삭제됐고
 * `onConfirmBaseToggle` 은 타입만 남은 고아다 — 이 화면은 쓰지 않는다.
 *
 * 좌표 미확정(INV-U1-08, `canAssignBase=false`)이면 토글이 real `disabled` 라 콜백이 나가지 않는다.
 */

export type MyStayBaseState = 'assigned' | 'unassigned';

export interface MyStayRowVM {
  savedStayId: string;
  name: string;
  location: string;
  dateRangeLabel: string | null;
  sourceLabel: string;
  memoLabel: string | null;
  linkedTripLabel: string;
  baseState: MyStayBaseState;
  canAssignBase: boolean;
  tripId: string | null;
  baseAssignmentId: string | null;
}

export interface MyStaysScreenProps {
  rows: MyStayRowVM[];
  isEmpty: boolean;
  onPressChangeBase?: (row: MyStayRowVM) => void;
  /** 고아(TRIP-1076) — 화면이 쓰지 않는다. 프리뷰·테스트 호출부가 넘겨서 타입만 남긴다. */
  onConfirmBaseToggle?: (row: MyStayRowVM) => void;
  onPressExplore: () => void;
  onPressBack?: () => void;
}

/** 채움/아웃라인 칩 — 날짜·출처·메모 상태를 한 형태로. `filled` 는 채움(surface-strong·body 글자),
 *  아니면 아웃라인(hairline-strong·muted 글자 — Figma 1604 는 출처·메모 둘 다 muted). */
function Chip({
  label,
  filled,
}: {
  label: string;
  filled?: boolean;
}): ReactElement {
  return (
    <View
      className={`min-h-[27px] justify-center rounded-[8px] px-md ${
        filled ? 'bg-surface-strong' : 'border border-hairline-strong'
      }`}
    >
      <Text
        className={`font-noto text-caption ${filled ? 'text-body' : 'text-muted'}`}
      >
        {label}
      </Text>
    </View>
  );
}

/** 등록 숙소 한 행(카드). 출발점 전환 버튼(`my-stays-base-toggle-{id}`)은 등록됨 행에만 하나 —
 *  하단 "출발점 변경" + chevron 링크. 미등록 행은 버튼이 없다: 어느 여행에 지정할지 모르는 채
 *  다이얼로그만 열고 아무것도 안 하던 무반응(INV-4)을 막는다(TRIP-989 D13, 실제 지정은 TRIP-621). */
function MyStayRow({
  row,
  onPressToggle,
}: {
  row: MyStayRowVM;
  onPressToggle: (row: MyStayRowVM) => void;
}): ReactElement {
  const assigned = row.baseState === 'assigned';
  const toggleTestID = `my-stays-base-toggle-${row.savedStayId}`;

  return (
    <View
      testID={`my-stays-row-${row.savedStayId}`}
      style={CARD_SHADOW}
      className="rounded-[12px] border border-hairline bg-canvas p-lg"
    >
      {/* 상단: 숙소명 ↔ 출발점 배지(등록됨만) */}
      <View className="flex-row items-center justify-between gap-md">
        <Text className="flex-1 text-[16px] font-noto-bold text-ink">
          {row.name}
        </Text>
        {assigned ? (
          <View className="min-h-[24px] justify-center rounded-[8px] bg-primary px-[11px]">
            <Text className="font-noto-bold text-caption text-on-primary">
              출발점
            </Text>
          </View>
        ) : null}
      </View>

      {/* 위치 — 계약에 주소 필드가 없어 빈 값이면 줄 자체를 안 그린다(F-1). */}
      {row.location !== '' ? (
        <Text className="mt-sm font-noto text-label text-muted">
          {row.location}
        </Text>
      ) : null}

      {/* 칩 줄 — 날짜(채움)·출처(outline)·메모 상태(outline muted) */}
      <View className="mt-[10px] flex-row flex-wrap gap-sm">
        {row.dateRangeLabel !== null ? (
          <Chip label={row.dateRangeLabel} filled />
        ) : null}
        <Chip label={row.sourceLabel} />
        {row.memoLabel !== null ? <Chip label={row.memoLabel} /> : null}
      </View>

      {/* 구분선은 막대로 — `border-t border-hairline` 은 네 변 두께를 함께 건드려 모서리가 각진다. */}
      <View className="mt-md h-px bg-hairline" />

      {/* 하단: 연결 여행 ↔ 출발점 변경(등록됨만) */}
      <View className="mt-md flex-row items-center justify-between gap-md">
        <Text className="flex-1 font-noto text-caption text-muted">
          {row.linkedTripLabel}
        </Text>
        {assigned ? (
          <Pressable
            testID={toggleTestID}
            accessibilityRole="button"
            disabled={!row.canAssignBase}
            onPress={() => onPressToggle(row)}
            className="flex-row items-center gap-[2px]"
          >
            <Text className="font-noto text-label text-body">출발점 변경</Text>
            <ChevronRightGlyph size={15} color={MUTED} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function MyStaysScreen({
  rows,
  isEmpty,
  onPressChangeBase,
  onPressExplore,
  onPressBack,
}: MyStaysScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="my-stays-root" className="flex-1 bg-canvas">
        {/* 앱바 — 뒤로 + 타이틀 + 하단 hairline */}
        <View className="flex-row items-center gap-md border-b border-hairline px-lg pb-[14px] pt-sm">
          <Pressable
            testID="my-stays-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onPressBack}
          >
            <ChevronLeftGlyph />
          </Pressable>
          <Text className="text-[18px] font-noto-bold text-ink">
            등록 숙소·예약 기록
          </Text>
        </View>

        {isEmpty ? (
          // Figma 1605 는 제목 없이 원·설명·내용 폭 CTA 라 공용 StateNotice(제목 필수·고정 폭 버튼) 대신 로컬로.
          <View className="flex-1 justify-center px-2xl">
            <View testID="my-stays-empty" className="items-center gap-lg">
              <View
                testID="my-stays-empty-icon"
                className="h-[96px] w-[96px] items-center justify-center rounded-full bg-surface-strong"
              >
                <BedGlyph size={44} />
              </View>
              <Text className="text-center font-noto text-body leading-[21px] text-muted">
                {'숙소를 탐색하고 등록하면\n일정을 만들 수 있습니다'}
              </Text>
              <Pressable
                testID="my-stays-explore"
                accessibilityRole="button"
                onPress={onPressExplore}
                className="h-[44px] items-center justify-center rounded-button bg-primary px-[22px]"
              >
                <Text className="font-noto-bold text-card-title text-on-primary">
                  숙소 탐색
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView contentContainerClassName="gap-lg px-lg pb-2xl pt-lg">
            {rows.map((row) => (
              <MyStayRow
                key={row.savedStayId}
                row={row}
                onPressToggle={(pressed) => onPressChangeBase?.(pressed)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
