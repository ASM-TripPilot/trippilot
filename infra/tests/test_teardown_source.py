"""Trusted-source preflight uses real Git ancestry without cloud credentials."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import teardown_source


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q', '-b', 'develop')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'Test')
        self.git('commit', '--allow-empty', '-qm', 'trusted')
        self.sha = self.git('rev-parse', 'HEAD')
        self.values = {'GITHUB_REPOSITORY': 'ASM-TripPilot/trippilot',
                       'GITHUB_REF': 'refs/heads/develop', 'GITHUB_SHA': self.sha,
                       'DEPLOY_ENVIRONMENT': 'dev', 'REQUESTED_SHA': self.sha}

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True).strip()

    def test_trusted_commit_and_ancestor(self):
        self.git('commit', '--allow-empty', '-qm', 'new trusted')
        values = {**self.values, 'GITHUB_SHA': self.git('rev-parse', 'HEAD')}
        self.assertEqual(self.sha, teardown_source.verify(values, self.root))

    def test_off_branch_commit_rejected(self):
        self.git('checkout', '-qb', 'unreviewed')
        self.git('commit', '--allow-empty', '-qm', 'unreviewed')
        other = self.git('rev-parse', 'HEAD')
        self.git('checkout', '-q', 'develop')
        with self.assertRaises(ValueError):
            teardown_source.verify({**self.values, 'REQUESTED_SHA': other}, self.root)

    def test_untrusted_ref_repository_sha_and_environment_rejected(self):
        for field, value in [('GITHUB_REF', 'refs/heads/feature/rogue'),
                             ('GITHUB_REPOSITORY', 'fork/trippilot'),
                             ('DEPLOY_ENVIRONMENT', 'prod'),
                             ('REQUESTED_SHA', '--upload-pack=evil'),
                             ('GITHUB_SHA', 'a' * 40)]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                teardown_source.verify({**self.values, field: value}, self.root)

    def test_prd_requires_main_and_configured_branch_is_checked(self):
        with self.assertRaises(ValueError):
            teardown_source.verify({**self.values, 'DEPLOY_ENVIRONMENT': 'prd'}, self.root)
        self.assertEqual(self.sha, teardown_source.verify(
            {**self.values, 'DEPLOY_ENVIRONMENT': 'prd', 'DEPLOY_BRANCH': 'develop'}, self.root))

    def test_cli_outputs_only_verified_sha(self):
        output = self.root / 'output'
        process = subprocess.run([sys.executable, str(Path(teardown_source.__file__))],
                                 cwd=self.root, env={**os.environ, **self.values, 'GITHUB_OUTPUT': str(output)},
                                 capture_output=True, text=True)
        self.assertEqual(0, process.returncode, process.stderr)
        self.assertEqual(f'sha={self.sha}\n', output.read_text())
        failed = subprocess.run([sys.executable, str(Path(teardown_source.__file__))],
                                cwd=self.root, env={**os.environ, **self.values, 'REQUESTED_SHA': 'bad'},
                                capture_output=True, text=True)
        self.assertNotEqual(0, failed.returncode)


if __name__ == '__main__':
    unittest.main()
