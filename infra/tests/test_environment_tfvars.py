"""실제 배포가 쓰는 tfvars 파일에 대한 단정.

## 왜 `terraform test` 로는 부족한가

`infra/terraform/stack/tests/environments.tftest.hcl` 의 `run` 블록은 **자기 `variables {}` 를
들고** plan 한다. 그 집합은 `terraform plan -var-file=../environments/<env>.tfvars`
(`aws-deploy.yml`)가 쓰는 집합과 **다르다** — 증거는 리포 안에 있다: 테스트는
`container_logs_enabled = true` 인데 `dev.tfvars` 는 `false` 다.

즉 누가 `dev.tfvars` 에 `data_protection_enabled = false` 한 줄을 넣어도
`terraform test` 는 전부 green 이고(2026-10-05 실측), `infra/terraform` 은 PR 트리거가
없어 CI 도 안 붙는다. 다음 apply 가 **조용히** 삭제 보호를 끄고 백업을 1일로 내린다.

이 파일은 그 구멍만 막는다 — 변수 기본값이 아니라 **배포가 실제로 읽는 파일**을 본다.
"""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENVIRONMENTS = ROOT / 'infra/terraform/environments'


def assignments(environment):
    """tfvars 의 `key = value` 를 평문으로 읽는다 — HCL 파서를 들이지 않는다(주석·단순 대입뿐)."""
    text = (ENVIRONMENTS / f'{environment}.tfvars').read_text()
    found = {}
    for line in text.splitlines():
        line = line.split('#', 1)[0].strip()
        match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$', line)
        if match:
            found[match.group(1)] = match.group(2).strip().strip('"')
    return found


class EnvironmentTfvarsTests(unittest.TestCase):
    def test_no_environment_disables_data_protection(self):
        """삭제 보호·백업 보존을 tfvars 로 끌 수 없다.

        스토어 출시를 dev 스택으로 받기로 했으므로(2026-10-05) dev 도 실사용자 데이터를
        담는다. `data_protection_enabled` 의 기본값은 true 이고, **켜는 것을 잊는 실수**는
        기본값이 막는다. 이 단정이 막는 것은 **끄는 선택을 파일에 적는 것**이다 —
        비용을 줄이려다 보호를 끄는 쪽이 현실적인 경로다.
        """
        for environment in ('dev', 'prd'):
            with self.subTest(environment=environment):
                value = assignments(environment).get('data_protection_enabled')
                self.assertNotIn(
                    value, ('false', 'False'),
                    f'{environment}.tfvars 가 data_protection_enabled 를 끈다 — '
                    '삭제 보호가 풀리고 백업이 1일로 내려간다. 끌 이유가 있으면 '
                    'STORE-LAUNCH 노드의 결정을 먼저 바꿀 것.',
                )

    def test_environment_field_matches_filename(self):
        """`environment` 값이 파일 이름과 같아야 한다 — 어긋나면 한 환경이 다른 환경의
        리소스 이름(`local.name`)을 들고 apply 된다."""
        for environment in ('dev', 'prd'):
            with self.subTest(environment=environment):
                self.assertEqual(assignments(environment).get('environment'), environment)


if __name__ == '__main__':
    unittest.main()
