"""S3 버전·페이지·부분 실패 처리와 state 비밀값 경계."""

import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from unittest.mock import Mock

from teardown_state import (
    aws_json,
    delete_versions,
    entries,
    multipart_uploads,
    object_versions,
    purge_bucket,
    state_evidence,
    validate_empty_state,
)
from infra.tests.test_teardown_bootstrap import BootstrapRunner


class BootstrapStateTest(unittest.TestCase):
    def setUp(self):
        self.run = BootstrapRunner()
        self.settings = self.run.settings

    def test_versions_traverse_both_pagination_markers(self):
        run = Mock(
            side_effect=[
                json.dumps(
                    {
                        "Versions": [{"Key": "a", "VersionId": "1", "IsLatest": True}],
                        "IsTruncated": True,
                        "NextKeyMarker": "a",
                        "NextVersionIdMarker": "1",
                    }
                ),
                json.dumps(
                    {
                        "DeleteMarkers": [
                            {"Key": "b", "VersionId": "2", "IsLatest": True}
                        ],
                        "IsTruncated": False,
                    }
                ),
            ]
        )
        versions = object_versions(run, self.settings, self.run.bucket)
        self.assertEqual([False, True], [item["delete_marker"] for item in versions])
        self.assertIn("--key-marker", run.call_args.args[0])
        self.assertIn("--version-id-marker", run.call_args.args[0])

    def test_uploads_traverse_both_pagination_markers(self):
        run = Mock(
            side_effect=[
                json.dumps(
                    {
                        "Uploads": [{"Key": "a", "UploadId": "upload-1"}],
                        "IsTruncated": True,
                        "NextKeyMarker": "a",
                        "NextUploadIdMarker": "upload-1",
                    }
                ),
                json.dumps({"IsTruncated": False}),
            ]
        )
        uploads = multipart_uploads(run, self.settings, self.run.bucket)
        self.assertEqual("upload-1", uploads[0]["UploadId"])
        self.assertIn("--upload-id-marker", run.call_args.args[0])

    def test_pagination_fails_on_missing_repeated_or_wrong_markers(self):
        for page in (
            {},
            {"IsTruncated": "false"},
            {"IsTruncated": True},
            {"IsTruncated": True, "NextKeyMarker": "a", "NextVersionIdMarker": "1"},
        ):
            with self.subTest(page=page):
                run = Mock(return_value=json.dumps(page))
                with self.assertRaises(ValueError):
                    object_versions(run, self.settings, self.run.bucket)

    def test_bad_version_and_upload_metadata_fail_closed(self):
        for function, field, item in (
            (
                object_versions,
                "Versions",
                {"Key": "a", "VersionId": 1, "IsLatest": True},
            ),
            (
                object_versions,
                "Versions",
                {"Key": "a", "VersionId": "1", "IsLatest": "true"},
            ),
            (multipart_uploads, "Uploads", {"Key": "a"}),
        ):
            with self.subTest(field=field, item=item):
                run = Mock(
                    return_value=json.dumps({field: [item], "IsTruncated": False})
                )
                with self.assertRaises(ValueError):
                    function(run, self.settings, self.run.bucket)

    def test_delete_versions_batches_and_checks_individual_errors(self):
        versions = [{"Key": "old", "VersionId": str(number)} for number in range(1001)]
        run = Mock(return_value="{}")
        delete_versions(run, self.settings, self.run.bucket, versions)
        self.assertEqual(
            [1000, 1],
            [
                len(json.loads(call.kwargs["stdin"])["Delete"]["Objects"])
                for call in run.call_args_list
            ],
        )
        run = Mock(return_value=json.dumps({"Errors": [{"Code": "AccessDenied"}]}))
        with self.assertRaisesRegex(RuntimeError, "일부"):
            delete_versions(run, self.settings, self.run.bucket, versions)
        self.assertEqual(1, run.call_count)

    def test_purge_preserves_current_state_until_historical_versions_are_deleted(self):
        self.run.versions += [
            {"Key": self.run.key, "VersionId": "old", "IsLatest": False}
        ]
        purge_bucket(self.run, self.settings, self.run.bucket, self.run.key, "current")
        bodies = [
            json.loads(kwargs["stdin"])["Delete"]["Objects"]
            for command, kwargs in self.run.calls
            if command[2] == "delete-objects"
        ]
        self.assertEqual(["old", "current"], [body[0]["VersionId"] for body in bodies])

    def test_purge_stops_when_state_changes_or_lock_appears(self):
        for mutation in ("state", "lock"):
            with self.subTest(mutation=mutation):
                run = BootstrapRunner()
                if mutation == "state":
                    run.versions = [{**run.versions[0], "VersionId": "changed"}]
                else:
                    run.versions += [
                        {
                            "Key": run.key + ".tflock",
                            "VersionId": "lock",
                            "IsLatest": True,
                        }
                    ]
                with self.assertRaises(ValueError):
                    purge_bucket(run, self.settings, run.bucket, run.key, "current")
                self.assertFalse(
                    any(command[2] == "delete-objects" for command, _ in run.calls)
                )

    def test_new_deleted_state_history_also_blocks_purge(self):
        self.run.versions = []
        self.run.markers = [
            {"Key": self.run.key, "VersionId": "marker", "IsLatest": True}
        ]
        with self.assertRaises(ValueError):
            purge_bucket(self.run, self.settings, self.run.bucket, self.run.key, None)
        self.assertFalse(
            any(command[2] == "delete-objects" for command, _ in self.run.calls)
        )

    def test_upload_is_aborted_before_delete_and_remaining_upload_blocks_bucket(self):
        self.run.overrides[("s3api", "list-multipart-uploads")] = {
            "Uploads": [{"Key": self.run.key, "UploadId": "1"}],
            "IsTruncated": False,
        }
        with self.assertRaises(RuntimeError):
            purge_bucket(
                self.run, self.settings, self.run.bucket, self.run.key, "current"
            )
        operations = [command[2] for command, _ in self.run.calls]
        self.assertLess(
            operations.index("abort-multipart-upload"),
            operations.index("delete-objects"),
        )
        self.assertNotIn("delete-bucket", operations)

    def test_remaining_object_blocks_bucket(self):
        self.run.overrides[("s3api", "delete-objects")] = {}
        with self.assertRaises(RuntimeError):
            purge_bucket(
                self.run, self.settings, self.run.bucket, self.run.key, "current"
            )
        self.assertFalse(
            any(command[2] == "delete-bucket" for command, _ in self.run.calls)
        )

    def test_state_file_is_private_and_removed_on_read_failure(self):
        self.run.fail = ("s3api", "get-object")
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            with self.assertRaises(RuntimeError):
                state_evidence(
                    self.run, self.settings, self.run.bucket, self.run.key, temp
                )
            self.assertEqual([], list(temp.iterdir()))

    def test_invalid_json_error_does_not_echo_state_contents(self):
        original = self.run

        def invalid(command, **kwargs):
            if command[2] == "get-object":
                Path(command[-1]).write_text("sensitive-state-invalid-json")
                return "{}"
            return original(command, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError) as error:
                state_evidence(
                    invalid,
                    self.settings,
                    self.run.bucket,
                    self.run.key,
                    Path(directory),
                )
            self.assertNotIn("sensitive", str(error.exception))

    def test_old_lock_versions_do_not_block(self):
        self.run.versions += [
            {
                "Key": self.run.key + ".tflock",
                "VersionId": "old-lock",
                "IsLatest": False,
            }
        ]
        self.run.markers = [
            {"Key": self.run.key + ".tflock", "VersionId": "deleted", "IsLatest": True}
        ]
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(
                "current",
                state_evidence(
                    self.run,
                    self.settings,
                    self.run.bucket,
                    self.run.key,
                    Path(directory),
                ),
            )

    def test_data_only_state_is_allowed(self):
        validate_empty_state(
            {
                "version": 4,
                "resources": [
                    {"mode": "data", "instances": [{}]},
                    {"mode": "managed", "instances": []},
                ],
            }
        )

    def test_bad_aws_json_and_list_types_fail_closed(self):
        for result in ("not-json-sensitive", "[]", "null"):
            with (
                self.subTest(result=result),
                self.assertRaises((TypeError, ValueError)),
            ):
                aws_json(
                    Mock(return_value=result), self.settings, "s3api", "list-buckets"
                )
        for result in ({"items": None}, {"items": ["bad"]}):
            with self.subTest(result=result), self.assertRaises(ValueError):
                entries(result, "items")

    def test_duplicate_latest_state_markers_block_purge(self):
        self.run.markers = [{'Key': self.run.key, 'VersionId': 'marker', 'IsLatest': True}]
        with self.assertRaisesRegex(ValueError, '버전'):
            purge_bucket(self.run, self.settings, self.run.bucket, self.run.key, 'current')
        self.assertFalse(any(command[2] == 'delete-objects' for command, _ in self.run.calls))

    def test_foreign_state_keys_block_evidence_and_purge(self):
        for key in ('env:/prd/terraform.tfstate', 'env:/prd/terraform.tfstate.tflock', 'backup.tfstate'):
            for action in ('evidence', 'purge'):
                with self.subTest(key=key, action=action):
                    run = BootstrapRunner()
                    run.versions = [*run.versions, {'Key': key, 'VersionId': 'foreign', 'IsLatest': True}]
                    with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, '허용'):
                        if action == 'evidence':
                            state_evidence(run, run.settings, run.bucket, run.key, Path(directory))
                        else:
                            purge_bucket(run, run.settings, run.bucket, run.key, 'current')
                    self.assertFalse(any(command[2].startswith(('delete', 'abort')) for command, _ in run.calls))

    def test_unknown_multipart_key_blocks_evidence_and_purge(self):
        self.run.overrides[('s3api', 'list-multipart-uploads')] = {'Uploads': [{'Key': 'foreign.tfstate', 'UploadId': 'upload'}], 'IsTruncated': False}
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, '허용'):
            state_evidence(self.run, self.settings, self.run.bucket, self.run.key, Path(directory))
        with self.assertRaisesRegex(ValueError, '허용'):
            purge_bucket(self.run, self.settings, self.run.bucket, self.run.key, 'current')
        self.assertFalse(any(command[2].startswith(('delete', 'abort')) for command, _ in self.run.calls))
