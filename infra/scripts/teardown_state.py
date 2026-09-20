"""환경별 S3 state의 비밀값 보호, 버전 조회와 명시적 영구 삭제."""

import json
import os


def aws_json(run, settings, service, operation, *arguments, stdin=None):
    raw = run(
        [
            "aws",
            service,
            operation,
            *arguments,
            "--region",
            settings.region,
            "--output",
            "json",
        ],
        stdin=stdin,
        quiet=True,
    )
    try:
        result = json.loads(raw)
    except (ValueError, TypeError):
        raise ValueError("AWS 조회 응답 형식이 올바르지 않습니다") from None
    if not isinstance(result, dict):
        raise TypeError("AWS 조회 응답은 객체여야 합니다")
    return result


def entries(result, key):
    value = result.get(key, [])
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError("AWS 목록 응답 형식이 올바르지 않습니다")
    return value


def bucket_arguments(settings, bucket):
    return ["--bucket", bucket, "--expected-bucket-owner", settings.account]


def s3_pages(run, settings, bucket, operation, marker_fields):
    arguments = [*bucket_arguments(settings, bucket), "--no-paginate"]
    previous = set()
    while True:
        result = aws_json(run, settings, "s3api", operation, *arguments)
        if type(result.get("IsTruncated")) is not bool:
            raise ValueError("S3 페이지 완료 여부를 확인할 수 없습니다")
        yield result
        if not result["IsTruncated"]:
            return
        markers = tuple(result.get(field) for field, _ in marker_fields)
        if (
            not all(isinstance(marker, str) and marker for marker in markers)
            or markers in previous
        ):
            raise ValueError("S3 페이지 연속 정보가 올바르지 않습니다")
        previous = {*previous, markers}
        arguments = [*bucket_arguments(settings, bucket), "--no-paginate"]
        for marker, (_, flag) in zip(markers, marker_fields, strict=True):
            arguments = [*arguments, flag, marker]


def object_versions(run, settings, bucket):
    markers = (
        ("NextKeyMarker", "--key-marker"),
        ("NextVersionIdMarker", "--version-id-marker"),
    )
    result = []
    for page in s3_pages(run, settings, bucket, "list-object-versions", markers):
        for kind in ("Versions", "DeleteMarkers"):
            for item in entries(page, kind):
                if (
                    any(
                        not isinstance(item.get(key), str) or not item[key]
                        for key in ("Key", "VersionId")
                    )
                    or type(item.get("IsLatest")) is not bool
                ):
                    raise ValueError("S3 버전 메타데이터가 올바르지 않습니다")
                result = [*result, {**item, "delete_marker": kind == "DeleteMarkers"}]
    return result


def multipart_uploads(run, settings, bucket):
    markers = (
        ("NextKeyMarker", "--key-marker"),
        ("NextUploadIdMarker", "--upload-id-marker"),
    )
    result = []
    for page in s3_pages(run, settings, bucket, "list-multipart-uploads", markers):
        for item in entries(page, "Uploads"):
            if any(
                not isinstance(item.get(key), str) or not item[key]
                for key in ("Key", "UploadId")
            ):
                raise ValueError("S3 업로드 메타데이터가 올바르지 않습니다")
            result = [*result, item]
    return result


def validate_empty_state(state):
    if not isinstance(state, dict) or state.get("version") != 4:
        raise ValueError("Terraform state 형식을 확인할 수 없습니다")
    if not isinstance(state.get("resources"), list):
        raise TypeError("Terraform state 리소스 목록이 올바르지 않습니다")
    for resource in state["resources"]:
        if (
            not isinstance(resource, dict)
            or resource.get("mode") not in {"data", "managed"}
            or not isinstance(resource.get("instances"), list)
        ):
            raise ValueError("Terraform state 리소스 형식이 올바르지 않습니다")
        if resource["mode"] == "managed" and resource["instances"]:
            raise ValueError(
                "서비스 Terraform 리소스가 남아 있어 bootstrap 삭제를 중단합니다"
            )


def validate_state_keys(items, key):
    if any(item["Key"] not in {key, key + ".tflock"} for item in items):
        raise ValueError("허용하지 않은 state 버킷 객체가 있습니다. 소유권·backend drift를 확인하세요")


def state_evidence(run, settings, bucket, key, temp):
    versions = object_versions(run, settings, bucket)
    validate_state_keys(versions, key)
    validate_state_keys(multipart_uploads(run, settings, bucket), key)
    if any(
        item["Key"] == key + ".tflock"
        and item["IsLatest"]
        and not item["delete_marker"]
        for item in versions
    ):
        raise ValueError("Terraform 잠금이 남아 있습니다. 실행 상태를 확인하세요")
    history = [item for item in versions if item["Key"] == key]
    latest = [
        item for item in history if item["IsLatest"] and not item["delete_marker"]
    ]
    if not history:
        return None
    if len(latest) != 1 or sum(item["IsLatest"] for item in history) != 1:
        raise ValueError(
            "현재 Terraform state가 없지만 과거 이력이 있습니다. state를 복구한 뒤 서비스 삭제를 확인하세요"
        )
    read_state(run, settings, bucket, key, latest[0]["VersionId"], temp)
    return latest[0]["VersionId"]


def read_state(run, settings, bucket, key, version, temp):
    path = temp / "bootstrap-state.json"
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        run(
            [
                "aws",
                "s3api",
                "get-object",
                *bucket_arguments(settings, bucket),
                "--key",
                key,
                "--version-id",
                version,
                "--region",
                settings.region,
                str(path),
            ],
            quiet=True,
        )
        if path.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("Terraform state 크기가 검증 한도를 초과했습니다")
        try:
            state = json.loads(path.read_text())
        except (ValueError, UnicodeError):
            raise ValueError("Terraform state JSON 형식이 올바르지 않습니다") from None
        validate_empty_state(state)
    finally:
        path.unlink(missing_ok=True)


def delete_versions(run, settings, bucket, versions):
    for offset in range(0, len(versions), 1000):
        objects = [
            {"Key": item["Key"], "VersionId": item["VersionId"]}
            for item in versions[offset : offset + 1000]
        ]
        body = {
            "Bucket": bucket,
            "ExpectedBucketOwner": settings.account,
            "Delete": {"Objects": objects, "Quiet": True},
        }
        result = aws_json(
            run,
            settings,
            "s3api",
            "delete-objects",
            "--expected-bucket-owner",
            settings.account,
            "--cli-input-json",
            "file:///dev/stdin",
            stdin=json.dumps(body),
        )
        if entries(result, "Errors"):
            raise RuntimeError(
                "S3 버전 일부를 삭제하지 못했습니다. state 버킷을 유지하고 중단합니다"
            )


def abort_uploads(run, settings, bucket, key):
    uploads = multipart_uploads(run, settings, bucket)
    validate_state_keys(uploads, key)
    for upload in uploads:
        run(
            [
                "aws",
                "s3api",
                "abort-multipart-upload",
                *bucket_arguments(settings, bucket),
                "--key",
                upload["Key"],
                "--upload-id",
                upload["UploadId"],
                "--region",
                settings.region,
            ],
            quiet=True,
        )


def current_state_version(versions, key, state_version):
    validate_state_keys(versions, key)
    if any(
        item["Key"] == key + ".tflock"
        and item["IsLatest"]
        and not item["delete_marker"]
        for item in versions
    ):
        raise ValueError("Terraform 잠금이 다시 생성되어 S3 삭제를 중단합니다")
    current = [
        item
        for item in versions
        if item["Key"] == key and item["IsLatest"] and not item["delete_marker"]
    ]
    missing_state_has_history = state_version is None and any(
        item["Key"] == key for item in versions
    )
    latest = [item for item in versions if item["Key"] == key and item["IsLatest"]]
    if (
        missing_state_has_history
        or (state_version is not None and len(latest) != 1)
        or (current[0]["VersionId"] if len(current) == 1 else None) != state_version
    ):
        raise ValueError("Terraform state 버전이 변경되어 S3 삭제를 중단합니다")
    return current


def purge_bucket(run, settings, bucket, key, state_version):
    versions = object_versions(run, settings, bucket)
    current = current_state_version(versions, key, state_version)
    abort_uploads(run, settings, bucket, key)
    # 현재 빈 state는 마지막에 지워 부분 실패 시 재시도의 근거를 보존한다.
    historical = [
        item
        for item in versions
        if not (item["Key"] == key and item["VersionId"] == state_version)
    ]
    delete_versions(run, settings, bucket, historical)
    delete_versions(run, settings, bucket, current)
    if object_versions(run, settings, bucket) or multipart_uploads(
        run, settings, bucket
    ):
        raise RuntimeError("S3 객체 또는 업로드가 남아 있어 버킷 삭제를 중단합니다")
    run(
        [
            "aws",
            "s3api",
            "delete-bucket",
            *bucket_arguments(settings, bucket),
            "--region",
            settings.region,
        ],
        quiet=True,
    )
