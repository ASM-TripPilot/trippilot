import { type ReactElement, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SettingsGroupVM, SettingsRowVM } from '../model/settingsSections';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { ExportRow } from './ExportRow';
import { NicknameEditRow } from './NicknameEditRow';
import { ChevronLeftGlyph, TrashGlyph } from './SettingsGlyphs';
import { SettingsGroup } from './SettingsGroup';
import { NavRow, PreparingRow, RowBody } from './SettingsRow';

/**
 * l05 설정 화면(프레젠테이션 · props만) — 6그룹을 정본 순서로 그린다. 상호작용 행은 닉네임·
 * 내보내기·계정 삭제 + 위치·알림 네비 행(TRIP-618 진입 개통)이고, 남은 준비중 행(취향 7·제휴)은
 * "준비 중" 비활성이다(AC-6, INV-4). 삭제는 2단 다이얼로그를 거쳐야 최종 콜백이 나간다(AC-12).
 *
 * 상태는 전부 위(페이지)에서 온다 — 화면은 삭제 다이얼로그의 열림만 로컬로 쥔다(딤·모달 실제 덮임은
 * jest 사각, 6-b 실기 전용 · repo-traps). 조회·판정·서버 호출은 페이지 몫이다.
 */
export interface SettingsScreenProps {
  groups: SettingsGroupVM[];
  deletionState: 'active' | 'pending';
  purgeAt?: string | null;
  currentNickname: string;
  nicknameError?: string | null;
  truncatedLabel?: string | null;
  /** 내보내기 조회 실패 안내 — 있으면 ExportRow 인라인 오류로 표면화(INV-4). preview 무파손 위해 optional. */
  exportError?: string | null;
  cancelDeletionError?: boolean;
  onPressBack: () => void;
  onSubmitNickname: (value: string) => void;
  onPressExport: () => void;
  onPressDeleteAccount: () => void;
  onPressCancelDeletion: () => void;
  /** 위치정보 네비 행 진입(페이지가 /settings/location 으로 주입). preview 무파손 위해 optional. */
  onPressLocation?: () => void;
  /** 알림 네비 행 진입(페이지가 /settings/notifications 으로 주입). */
  onPressNotifications?: () => void;
}

export function SettingsScreen({
  groups,
  deletionState,
  purgeAt,
  currentNickname,
  nicknameError,
  truncatedLabel,
  exportError,
  cancelDeletionError,
  onPressBack,
  onSubmitNickname,
  onPressExport,
  onPressDeleteAccount,
  onPressCancelDeletion,
  onPressLocation,
  onPressNotifications,
}: SettingsScreenProps): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);

  const renderRow = (row: SettingsRowVM): ReactElement => {
    switch (row.key) {
      case 'location-consent':
        return (
          <NavRow
            rowKey="location-consent"
            label={row.label}
            onPress={onPressLocation}
          />
        );
      case 'notifications':
        return (
          <NavRow
            rowKey="notifications"
            label={row.label}
            onPress={onPressNotifications}
          />
        );
      case 'nickname':
        return (
          <NicknameEditRow
            value={currentNickname}
            error={nicknameError}
            onSubmit={onSubmitNickname}
          />
        );
      case 'export':
        return (
          <ExportRow
            onPress={onPressExport}
            truncatedLabel={truncatedLabel}
            errorLabel={exportError}
          />
        );
      case 'delete-account':
        return deletionState === 'pending' ? (
          <DeletionPendingBanner
            purgeAt={purgeAt}
            cancelError={cancelDeletionError}
            onPressCancel={onPressCancelDeletion}
          />
        ) : (
          <View testID="settings-row">
            <Pressable
              testID="settings-delete-account"
              onPress={() => setDialogOpen(true)}
            >
              <RowBody
                rowKey="delete-account"
                label="계정 삭제"
                right={
                  <View className="rounded-pill bg-ink px-[10px] py-xs">
                    <Text className="font-noto-bold text-micro text-canvas">
                      위험
                    </Text>
                  </View>
                }
              />
            </Pressable>
          </View>
        );
      default:
        return <PreparingRow rowKey={row.key} label={row.label} />;
    }
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas-alt">
      <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
        <Pressable
          testID="settings-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <ChevronLeftGlyph />
        </Pressable>
        <Text className="text-[18px] font-noto-bold text-ink">설정</Text>
      </View>

      <ScrollView>
        <View className="gap-[22px] px-lg pb-3xl pt-lg">
          {groups.map((group) => (
            <SettingsGroup key={group.key} label={group.label}>
              {group.rows.map((row) => (
                <View key={row.key}>{renderRow(row)}</View>
              ))}
            </SettingsGroup>
          ))}
          <Text className="pt-md text-center font-noto text-caption text-muted-soft">
            TripPilot v1.0.0
          </Text>
        </View>
      </ScrollView>

      {dialogOpen ? (
        <DeleteAccountDialog
          onCancel={() => setDialogOpen(false)}
          onConfirmDeletion={() => {
            onPressDeleteAccount();
            setDialogOpen(false);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * DELETION_PENDING 배너 — 유예 상태 고지 + purgeAt(POST 응답에서만 옴, 초기 pending 진입 세션엔
 * 없을 수 있음) + [삭제 철회](DELETE). 404 는 "유예 없음"이지 성공이 아니라 안내만 띄우고 유예를
 * 유지한다(AC-10, 침묵 금지).
 */
function DeletionPendingBanner({
  purgeAt,
  cancelError,
  onPressCancel,
}: {
  purgeAt?: string | null;
  cancelError?: boolean;
  onPressCancel: () => void;
}): ReactElement {
  return (
    <View testID="settings-deletion-pending" className="gap-sm px-lg py-lg">
      <View className="flex-row items-center gap-md">
        <View className="w-6 items-center">
          <TrashGlyph size={22} />
        </View>
        <Text className="flex-1 font-noto-bold text-body text-ink">
          계정 삭제가 예정되어 있어요
        </Text>
      </View>
      {purgeAt ? (
        <Text className="font-noto text-caption text-muted">
          삭제 예정일 {purgeAt.slice(0, 10)}
        </Text>
      ) : null}
      <Pressable
        testID="settings-deletion-cancel"
        accessibilityRole="button"
        onPress={onPressCancel}
        className="h-11 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
      >
        <Text className="font-noto-bold text-body text-ink">삭제 철회</Text>
      </Pressable>
      {cancelError ? (
        <Text
          testID="settings-deletion-cancel-error"
          className="font-noto text-caption text-primary-text"
        >
          철회할 유예가 없어요. 이미 처리되었거나 만료된 상태예요.
        </Text>
      ) : null}
    </View>
  );
}
