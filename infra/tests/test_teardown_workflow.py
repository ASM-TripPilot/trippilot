"""Destructive actions stay manual and request credentials only after preflight."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class TeardownWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load((ROOT / '.github/workflows/aws-destroy.yml').read_text())

    def test_manual_safe_defaults_and_shared_lock(self):
        trigger = self.workflow.get('on', self.workflow.get(True))
        self.assertEqual(['workflow_dispatch'], list(trigger))
        inputs = trigger['workflow_dispatch']['inputs']
        self.assertEqual('plan', inputs['operation']['default'])
        self.assertEqual('retain', inputs['snapshot_policy']['default'])
        self.assertFalse(inputs['purge_state']['default'])
        self.assertEqual({'group': 'aws-${{ inputs.environment }}', 'cancel-in-progress': False}, self.workflow['concurrency'])
        self.assertEqual({'contents': 'read'}, self.workflow['permissions'])

    def test_unprivileged_source_preflight_and_no_untrusted_checkout(self):
        job = self.workflow['jobs']['preflight']
        self.assertEqual({'contents': 'read'}, job['permissions'])
        self.assertFalse(any('configure-aws-credentials' in s.get('uses', '') for s in job['steps']))
        checkout = next(s for s in job['steps'] if 'actions/checkout' in s.get('uses', ''))
        self.assertEqual('${{ github.sha }}', checkout['with']['ref'])
        self.assertFalse(checkout['with']['persist-credentials'])
        self.assertEqual(0, checkout['with']['fetch-depth'])
        self.assertIn('teardown_source.py', job['steps'][-1]['run'])

    def test_credential_job_rechecks_inputs_before_authentication(self):
        job = self.workflow['jobs']['teardown']
        self.assertEqual('preflight', job['needs'])
        self.assertEqual('${{ inputs.environment }}', job['environment'])
        steps = job['steps']
        validation = next(i for i, s in enumerate(steps) if '--validate-only' in s.get('run', ''))
        auth = next(i for i, s in enumerate(steps) if 'configure-aws-credentials' in s.get('uses', ''))
        self.assertLess(validation, auth)
        checkout = steps[0]['with']
        self.assertEqual('${{ needs.preflight.outputs.sha }}', checkout['ref'])
        self.assertFalse(checkout['persist-credentials'])
        self.assertEqual('${{ vars.AWS_ACCOUNT_ID }}', steps[auth]['with']['allowed-account-ids'])
        for step in steps:
            self.assertNotIn('${{ inputs.', step.get('run', ''))
        self.assertEqual('${{ inputs.confirmation }}', job['env']['DELETE_CONFIRMATION'])


if __name__ == '__main__':
    unittest.main()
