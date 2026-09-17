from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'infra/scripts/workflow_config.py'


class WorkflowCliTests(unittest.TestCase):
    def test_cli_generates_outputs_for_manual_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'outputs'
            env = {
                **os.environ, 'DEPLOY_ENVIRONMENT': 'dev', 'DEPLOY_MODE': 'plan',
                'AWS_ACCOUNT_ID': '123456789012', 'AWS_REGION': 'ap-northeast-2',
                'AWS_ROLE_ARN': 'arn:aws:iam::123456789012:role/trippilot-dev-github-deploy',
                'GITHUB_REF': 'refs/heads/develop', 'DEPLOY_APPLICATION': 'true',
                'EMBEDDING_ENABLED': 'false', 'GITHUB_OUTPUT': str(output), 'DEPLOY_BRANCH': '',
            }
            result = subprocess.run([sys.executable, str(SCRIPT)], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('deploy_application=false\n', output.read_text())
            self.assertIn('state_bucket=trippilot-tfstate-123456789012-ap-northeast-2-dev\n', output.read_text())
            self.assertEqual(result.stdout, '')

    def test_cli_rejects_invalid_input_without_writing_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'outputs'
            result = subprocess.run([sys.executable, str(SCRIPT)], env={**os.environ, 'DEPLOY_ENVIRONMENT': 'invalid', 'GITHUB_OUTPUT': str(output)}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('::error::DEPLOY_ENVIRONMENT', result.stderr)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
