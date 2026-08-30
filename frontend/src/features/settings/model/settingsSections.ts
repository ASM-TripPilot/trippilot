/**
 * l05 설정 6그룹 뷰모델 조립 (AC-1 · AC-11) — 순수 함수.
 *
 * 정본 순서(Figma 라이브 = 화면 유일 정본): 계정 → 여행 취향 → 위치정보 → 알림 → 제휴 안내 →
 * 위험 영역. 각 행은 `ready` 로 상호작용 여부를 표시한다 — 목적지 라우트가 선 행(위치·알림)은
 * `ready:true`, 아직 없는 행(취향 7·제휴)은 `ready:false` 다(TRIP-618 진입 개통, AC-5·INV-4).
 *
 * 요약값은 닉네임만 라이브다(Q6 — email 이 null 이어도 닉네임만 표기, null/undefined 를 문자열로
 * 흘리지 않는다). 취향·위치·알림 요약값은 이 티켓 범위 밖이라 채우지 않는다(정적 placeholder = 없음).
 */

export interface SettingsInput {
  nickname: string;
  /** 소셜 MVP 는 email 이 null 일 수 있다. Q6 확정으로 요약엔 닉네임만 쓰므로 여기선 참조하지 않는다. */
  email: string | null;
}

export interface SettingsRowVM {
  key: string;
  label: string;
  value?: string | null;
  ready: boolean;
}

export interface SettingsGroupVM {
  key: string;
  label: string;
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
      ],
    },
    {
      key: 'preferences',
      label: '여행 취향',
      rows: [
        { key: 'style', label: '여행 스타일', ready: false },
        { key: 'budget', label: '예산', ready: false },
        { key: 'companions', label: '동행 유형', ready: false },
        { key: 'activities', label: '선호 활동', ready: false },
        { key: 'transport', label: '이동 방식', ready: false },
        { key: 'food', label: '음식 취향', ready: false },
        { key: 'pace', label: '일정 밀도·이동 선호', ready: false },
      ],
    },
    {
      key: 'location',
      label: '위치정보',
      rows: [
        { key: 'location-consent', label: '위치정보 수집 동의', ready: true },
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
          ready: false,
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
