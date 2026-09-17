"""Process execution that never echoes secret input or cloud response bodies."""
import os
import subprocess


class CommandError(RuntimeError):
    def __init__(self, executable, detail):
        super().__init__(f"{executable} command failed; inspect service status without printing secrets")
        self.detail = detail


def command(argv, payload=None):
    result = subprocess.run(
        argv, input=payload, text=True, capture_output=True, check=False,
        env={**os.environ, "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off"},
    )
    if result.returncode:
        raise CommandError(argv[0], result.stderr)
    return result.stdout
