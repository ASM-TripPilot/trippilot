"""Ephemeral, idempotent PostgreSQL role/schema bootstrap inside the private VPC."""
import base64
import hashlib
import hmac
import json
import secrets
from pathlib import Path
import re

from runtime_secrets import get_secret, require


def scram_verifier(password):
    """Keep plaintext application passwords out of SQL and PostgreSQL statement logs."""
    if not password.isascii() or any(ord(character) < 32 or ord(character) == 127 for character in password):
        raise ValueError("Database passwords must contain printable ASCII characters")
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("ascii"), salt, 4096)
    client = hmac.digest(salted, b"Client Key", "sha256")
    stored = hashlib.sha256(client).digest()
    server = hmac.digest(salted, b"Server Key", "sha256")
    encode = lambda value: base64.b64encode(value).decode("ascii")
    return f"SCRAM-SHA-256$4096:{encode(salt)}${encode(stored)}:{encode(server)}"


def resource_name(run_id):
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?", run_id):
        raise ValueError("run-id must be 1-40 lowercase alphanumeric/dash characters")
    return f"trippilot-db-init-{run_id}"


def bootstrap_manifests(outputs, namespace, run_id, master, database):
    name = resource_name(run_id)
    metadata = {"name": name, "namespace": namespace}
    secret_values = {"PGUSER": master["username"], "PGPASSWORD": master["password"],
                     **{key: scram_verifier(value) for key, value in database.items()}}
    security = {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True,
                "capabilities": {"drop": ["ALL"]}}
    container = {
        "name": "bootstrap", "image": "postgres:16-alpine", "imagePullPolicy": "IfNotPresent",
        "command": ["psql", "--no-psqlrc", "--no-password", "--file=/bootstrap/bootstrap.sql"],
        "securityContext": security,
        "env": [{"name": key, "value": value} for key, value in {
            "PGHOST": outputs["database_host"], "PGPORT": "5432", "PGDATABASE": "trippilot",
            "PGSSLMODE": "require", "PGCONNECT_TIMEOUT": "15", "HOME": "/tmp",
        }.items()] + [{"name": key, "valueFrom": {"secretKeyRef": {"name": name, "key": key}}} for key in secret_values],
        "resources": {"requests": {"cpu": "100m", "memory": "128Mi"}, "limits": {"cpu": "500m", "memory": "256Mi"}},
        "volumeMounts": [{"name": "sql", "mountPath": "/bootstrap", "readOnly": True}, {"name": "tmp", "mountPath": "/tmp"}],
    }
    pod = {
        "restartPolicy": "Never", "automountServiceAccountToken": False,
        "nodeSelector": {"kubernetes.io/os": "linux", "kubernetes.io/arch": "amd64"},
        "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001,
                            "seccompProfile": {"type": "RuntimeDefault"}},
        "containers": [container], "volumes": [{"name": "sql", "configMap": {"name": name}}, {"name": "tmp", "emptyDir": {}}],
    }
    return [
        {"apiVersion": "v1", "kind": "Secret", "type": "Opaque", "metadata": metadata, "stringData": secret_values},
        {"apiVersion": "v1", "kind": "ConfigMap", "metadata": metadata, "data": {"bootstrap.sql": Path(__file__).with_name("bootstrap.sql").read_text()}},
        {"apiVersion": "batch/v1", "kind": "Job", "metadata": metadata,
         "spec": {"backoffLimit": 0, "activeDeadlineSeconds": 600, "ttlSecondsAfterFinished": 600,
                  "template": {"metadata": {"labels": {"app.kubernetes.io/name": "trippilot-db-init"}}, "spec": pod}}},
    ]


def cleanup(namespace, run_id, shell):
    name = resource_name(run_id)
    try:
        shell(["kubectl", "delete", "job", name, "--namespace", namespace,
               "--ignore-not-found", "--cascade=foreground", "--wait=true", "--timeout=90s"])
    finally:
        shell(["kubectl", "delete", "secret", name, "--namespace", namespace, "--ignore-not-found"])
        shell(["kubectl", "delete", "configmap", name, "--namespace", namespace, "--ignore-not-found"])


def bootstrap(outputs, namespace, run_id, shell):
    resource_name(run_id)
    region = outputs["aws_region"]
    master = get_secret(shell, region, outputs["database_master_secret_arn"], strings_only=False)
    database = get_secret(shell, region, outputs["app_secret_arns"]["database"])
    require(master, ("username", "password"), "RDS managed master secret")
    require(database, ("DB_PASSWORD", "DB_MIGRATE_PASSWORD", "AI_DB_PASSWORD"), "database bootstrap (run sync-secrets first)")
    try:
        for manifest in bootstrap_manifests(outputs, namespace, run_id, master, database):
            shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"], json.dumps(manifest))
        shell(["kubectl", "wait", "--namespace", namespace, "--for=condition=complete",
               f"job/{resource_name(run_id)}", "--timeout=660s"])
    finally:
        cleanup(namespace, run_id, shell)
