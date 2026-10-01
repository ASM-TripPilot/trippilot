"""Process execution that never echoes secret input or cloud response bodies."""
import os
import re
import subprocess

# AWS CLI 실패 형식("An error occurred (<코드>) when calling the <오퍼레이션> operation")에서
# 에러 코드·오퍼레이션명만 뽑는다 — 둘 다 식별자라 비밀값이 실릴 수 없는 토큰이다.
# 이것까지 숨기면 실 배포 실패가 "aws command failed" 한 줄이 되어 디버깅이 불가능하다
# (2026-09-19 run 35388660238 실측 — 원인 규명에 이 정보가 없어 막혔다).
_AWS_ERROR = re.compile(r"An error occurred \(([A-Za-z0-9._-]{1,80})\)(?: when calling the ([A-Za-z0-9]{1,80}) operation)?")


class CommandError(RuntimeError):
    def __init__(self, executable, detail):
        matched = _AWS_ERROR.search(detail or "")
        cause = "" if not matched else (f" ({matched.group(1)} on {matched.group(2)})" if matched.group(2) else f" ({matched.group(1)})")
        super().__init__(f"{executable} command failed{cause}; inspect service status without printing secrets")
        self.detail = detail


def command(argv, payload=None):
    result = subprocess.run(
        argv, input=payload, text=True, capture_output=True, check=False,
        env={**os.environ, "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off"},
    )
    if result.returncode:
        raise CommandError(argv[0], result.stderr)
    return result.stdout
