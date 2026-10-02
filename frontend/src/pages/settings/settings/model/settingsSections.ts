/**
 * l05 설정 7그룹 뷰모델 조립 (AC-1 · AC-11) — 순수 함수.
 *
 * 정본 순서(Figma 라이브 = 화면 유일 정본): 계정 → 여행 취향 → 위치정보 → 알림 → 제휴 안내 →
 * (앱 정보 — TRIP-937, Figma 에 없음) → 위험 영역. 각 행은 `ready` 로 상호작용 여부를 표시한다 —
 * TRIP-778 로 모든 행이 `ready:true` 다(취향·제휴·개인화 개통). 취향 그룹은 머리글 없는 한 행이다
 * (TRIP-1051 — 7행이 전부 같은 편집 화면으로 가는 가짜 선택지였다).
 *
 * 요약값: 닉네임(Q6 — null/undefined 를 문자열로 흘리지 않는다) · 취향 `N/7 설정됨`
 * · 위치 동의 칩 · 개인화 `사용 중`. 입력이 없으면(응답 전·실패) 값도 칩도 두지 않는다 — 모를 때
 * `미설정`/`미동의` 라고 말하면 거짓 표면이다(D4).
 */
import type { PreferenceView } from '@/shared/api/index.schemas';

import { summarizePreferences } from './preferenceSummary';

export interface SettingsInput {
  nickname: string;
  /** 소셜 MVP 는 email 이 null 일 수 있다. Q6 확정으로 요약엔 닉네임만 쓰므로 여기선 참조하지 않는다. */
  email: string | null;
  /** GET /me/preferences. 없으면(응답 전·실패) 취향 행은 값 없음. */
  preferences?: PreferenceView;
  /** GET /me/location-consent 의 gpsRecordingOptIn(L3 — 행 라벨과 같은 것). 없으면 칩 없음(D4). */
  locationConsent?: boolean;
  /** 개인화 동의(reason !== CONSENT_MISSING). true 일 때만 `사용 중`(D3). */
  personalizationOn?: boolean;
}

export interface SettingsRowChip {
  label: string;
  tone: 'neutral' | 'primary';
}

export interface SettingsRowVM {
  key: string;
  label: string;
  value?: string | null;
  chip?: SettingsRowChip | null;
  ready: boolean;
}

/** 취향 행 값 — N = 설정된 축 수, 분모 = 축 개수. 모르면(응답 전·실패) 값 없음(D4). */
function preferenceRow(view?: PreferenceView): SettingsRowVM {
  const row = { key: 'preferences', label: '여행 취향', ready: true };
  if (!view) return row;
  const axes = Object.values(summarizePreferences(view));
  const set = axes.filter((a) => a.kind === 'value').length;
  return { ...row, value: `${set}/${axes.length} 설정됨` };
}

function consentChip(consent?: boolean): SettingsRowChip | null {
  if (consent === undefined) return null;
  return consent
    ? { label: '동의', tone: 'primary' }
    : { label: '미동의', tone: 'neutral' };
}

export interface SettingsGroupVM {
  key: string;
  /** null = 머리글 없는 카드(취향 그룹). */
  label: string | null;
  rows: SettingsRowVM[];
}

export function buildSettingsSections(input: SettingsInput): SettingsGroupVM[] {
  return [
    {
      key: 'account',
      label: '계정',
      rows: [
        {
          key: 'nickname',
          label: '닉네임·이메일',
          value: input.nickname,
          ready: true,
        },
        { key: 'export', label: '데이터 내보내기', ready: true },
        { key: 'logout', label: '로그아웃', ready: true },
      ],
    },
    {
      key: 'preferences',
      label: null,
      rows: [preferenceRow(input.preferences)],
    },
    {
      key: 'location',
      label: '위치정보',
      rows: [
        {
          key: 'location-consent',
          label: 'GPS 이동경로 기록',
          chip: consentChip(input.locationConsent),
          ready: true,
        },
        {
          key: 'personalization',
          label: '개인화',
          value: input.personalizationOn ? '사용 중' : null,
          ready: true,
        },
      ],
    },
    {
      key: 'notifications',
      label: '알림',
      rows: [{ key: 'notifications', label: '알림 설정', ready: true }],
    },
    {
      key: 'affiliate',
      label: '제휴 안내',
      rows: [
        {
          key: 'affiliate-toggle',
          label: '외부 이동 시 제휴 안내 다시 보기',
          ready: true,
        },
      ],
    },
    {
      // TRIP-937 — 약관·정책 열람(가이드라인 5.1.1(i)). Figma l05·U6 BLM §3.3 에 없는 그룹(정본 드리프트).
      // rowKey `terms-{termsType}` 의 접미가 열람 라우트 `/terms/{termsType}` 의 세그먼트다.
      key: 'app-info',
      label: '앱 정보',
      rows: [
        {
          key: 'terms-TERMS_OF_SERVICE',
          label: '서비스 이용약관',
          ready: true,
        },
        {
          key: 'terms-PRIVACY_POLICY',
          label: '개인정보 처리방침',
          ready: true,
        },
        {
          key: 'terms-LOCATION_TERMS',
          label: '위치정보 이용약관',
          ready: true,
        },
      ],
    },
    {
      key: 'danger',
      label: '위험 영역',
      rows: [{ key: 'delete-account', label: '계정 삭제', ready: true }],
    },
  ];
}

/**
 * 운영 화면용 필터(TRIP-939) — `ready:true` 행만 남기고, 행이 0개가 된 그룹은 뺀다. 입력은 바꾸지
 * 않는다. 판정은 `ready` 플래그로만 하므로, 기능을 열 때는 위 모델에서 `ready:true` 한 줄이면 된다.
 */
export function filterReadySettingsSections(
  groups: SettingsGroupVM[]
): SettingsGroupVM[] {
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.ready) }))
    .filter((g) => g.rows.length > 0);
}
