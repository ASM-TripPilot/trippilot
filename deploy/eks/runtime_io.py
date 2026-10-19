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


# Job 이 끝났다는 True 조건 — Complete·Failed(쿠버네티스 1.31+ 는 그 앞에 SuccessCriteriaMet·FailureTarget 이 선다).
_JOB_DONE = '{.status.conditions[?(@.status=="True")].type}'


def wait_job(shell, namespace, name, timeout_sec):
    """Job 이 성공하든 실패하든 끝나면 깬다 — 실패면 CommandError(호출자가 로그를 보이고 다시 던진다).

    `kubectl wait --for=condition=complete` 는 Failed 를 영영 못 봐서, 실패한 Job 이 시한(KB 적재 90분)을
    다 태운 뒤에야 배포가 멈췄다(10-18 장소 지식 청킹 리뷰). 여러 `--for` 는 AND 라 OR 를 쓸 수 없다 —
    True 조건이 하나라도 생기길 기다리고, 같은 호출의 출력으로 그 종류를 받는다.
    """
    states = set(shell(["kubectl", "wait", "--namespace", namespace, f"--for=jsonpath={_JOB_DONE}",
                        f"job/{name}", f"--timeout={timeout_sec}s", "-o", f"jsonpath={_JOB_DONE}"]).split())
    if states & {"Failed", "FailureTarget"} or not states & {"Complete", "SuccessCriteriaMet"}:
        raise CommandError("kubectl", f"job/{name} did not succeed: {' '.join(sorted(states)) or 'no condition'}")


def command(argv, payload=None):
    result = subprocess.run(
        argv, input=payload, text=True, capture_output=True, check=False,
        env={**os.environ, "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off"},
    )
    if result.returncode:
        raise CommandError(argv[0], result.stderr)
    return result.stdout
