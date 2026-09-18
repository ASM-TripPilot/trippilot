import { type ReactElement, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

import { BaseToggleDialog } from './BaseToggleDialog';
import { BedGlyph, ChevronLeftGlyph } from './SettingsGlyphs';

/**
 * TRIP-605 · l04 등록 숙소·예약 기록 화면 — 순수 프레젠테이션(VM 주입). 조회·조합·N+1·포맷은
 * 페이지(`pages/my-stays`)가 진다(MyPageScreen↔TripCardContainer 분리 규율, features/settings 경계).
 *
 * 출발점 전환 게이트(BR-U6-21): 토글 press = 다이얼로그를 먼저 연다(로컬 `openRow` 상태). 비즈니스
 * 콜백(`onConfirmBaseToggle`)은 다이얼로그 [일정 다시 생성] 확정에서만 부른다 — 즉시 배정/재생성 금지.
 * `LocationConsentScreen`(위치 철회 재확인) 게이트와 정확히 같은 형태.
 *
 * 좌표 미확정(INV-U1-08, `canAssignBase=false`)이면 토글이 real `disabled` 라 게이트에 진입조차 못 한다.
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
  onConfirmBaseToggle: (row: MyStayRowVM) => void;
  onPressExplore: () => void;
  onPressBack?: () => void;
}

/** 채움/점선 칩 — 날짜·출처·메모 상태를 한 형태로. `filled` 는 채움(surface-strong), 아니면 outline. */
function Chip({
  label,
  filled,
  muted,
}: {
  label: string;
  filled?: boolean;
  muted?: boolean;
}): ReactElement {
  return (
    <View
      className={`rounded-pill px-md py-xs ${
        filled ? 'bg-surface-strong' : 'border border-hairline-strong'
      }`}
    >
      <Text
        className={`font-noto text-caption ${muted ? 'text-muted' : 'text-body'}`}
      >
        {label}
      </Text>
    </View>
  );
}

/** 등록 숙소 한 행(카드). 출발점 전환 버튼(`my-stays-base-toggle-{id}`)은 행당 정확히 1개다 —
 *  등록됨이면 하단 "출발점 변경 ›" 링크, 미등록이면 상단 "출발점 지정" 점선 pill. */
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
      className="rounded-card border border-hairline bg-canvas p-lg shadow-md"
    >
      {/* 상단: 숙소명 ↔ 출발점 배지(등록됨)/지정 버튼(미등록) */}
      <View className="flex-row items-start justify-between gap-md">
        <Text className="flex-1 text-[16px] font-noto-bold text-ink">
          {row.name}
        </Text>
        {assigned ? (
          <View className="rounded-pill bg-primary px-md py-xs">
            <Text className="font-noto-bold text-caption text-on-primary">
              출발점
            </Text>
          </View>
        ) : (
          <Pressable
            testID={toggleTestID}
            accessibilityRole="button"
            disabled={!row.canAssignBase}
            onPress={() => onPressToggle(row)}
            className="rounded-pill border border-dashed border-muted-soft px-md py-xs"
          >
            <Text className="font-noto text-caption text-muted">
              출발점 지정
            </Text>
          </Pressable>
        )}
      </View>

      {/* 위치 — 계약에 주소 필드가 없어 빈 값이면 줄 자체를 안 그린다(F-1). */}
      {row.location !== '' ? (
        <Text className="mt-sm font-noto text-label text-muted">
          {row.location}
        </Text>
      ) : null}

      {/* 칩 줄 — 날짜(채움)·출처(outline)·메모 상태(outline muted) */}
      <View className="mt-md flex-row flex-wrap gap-sm">
        {row.dateRangeLabel !== null ? (
          <Chip label={row.dateRangeLabel} filled />
        ) : null}
        <Chip label={row.sourceLabel} />
        {row.memoLabel !== null ? <Chip label={row.memoLabel} muted /> : null}
      </View>

      <View className="mt-md border-t border-hairline" />

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
          >
            <Text className="font-noto-bold text-label text-primary">
              출발점 변경 ›
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function MyStaysScreen({
  rows,
  isEmpty,
  onConfirmBaseToggle,
  onPressExplore,
  onPressBack,
}: MyStaysScreenProps): ReactElement {
  const [openRow, setOpenRow] = useState<MyStayRowVM | null>(null);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="my-stays-root" className="flex-1 bg-canvas">
        {/* 앱바 — 뒤로 + 타이틀 + 하단 hairline */}
        <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
          <Pressable accessibilityRole="button" onPress={onPressBack}>
            <ChevronLeftGlyph />
          </Pressable>
          <Text className="text-[18px] font-noto-bold text-ink">
            등록 숙소·예약 기록
          </Text>
        </View>

        {isEmpty ? (
          <View className="flex-1 justify-center px-lg">
            <StateNotice
              testID="my-stays-empty"
              icon={<BedGlyph size={30} />}
              title="아직 등록된 숙소가 없어요"
              description={'숙소를 탐색하고 등록하면\n일정을 만들 수 있습니다'}
              actions={[
                {
                  testID: 'my-stays-explore',
                  label: '숙소 탐색',
                  variant: 'filled',
                  onPress: onPressExplore,
                },
              ]}
            />
          </View>
        ) : (
          <ScrollView contentContainerClassName="gap-md px-lg py-lg pb-3xl">
            {rows.map((row) => (
              <MyStayRow
                key={row.savedStayId}
                row={row}
                onPressToggle={setOpenRow}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {openRow !== null ? (
        <BaseToggleDialog
          onCancel={() => setOpenRow(null)}
          onConfirm={() => {
            onConfirmBaseToggle(openRow);
            setOpenRow(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
