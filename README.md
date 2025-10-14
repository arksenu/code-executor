# Code Interpreter API

An MVP implementation of an isolated code execution service that mirrors the OpenAI Code Interpreter run semantics. The API accepts untrusted code for Python, Node.js, Ruby, and PHP, executes it inside hardened containers, and returns structured results including stdout/stderr streams and signed artifact URLs.

## Features

- REST API with OpenAI-style `/v1/runs` and `/v1/files` endpoints
- Per-language runner containers with network isolation, non-root execution, and seccomp/AppArmor profiles
- Strict resource limits (CPU, wall clock, memory, output, and artifact caps)
- Local artifact storage with HMAC-signed, time-limited download URLs
- Static bearer-token authentication with per-key token bucket rate limiting
- Structured JSON logging and simple usage metrics scaffolding
- Jest unit and integration tests covering success, timeout, OOM, and artifact flows
- Docker Compose stack for local development with one image per language
- Minimal admin UI for manual run submission

## Quickstart

1. **Install prerequisites**
   - Docker and Docker Compose
   - Node.js 20+ (for local development)

2. **Run the test suite**

   ```bash
   make test
   ```

3. **Bring the stack up**

   ```bash
   make up
   ```

   The API listens on `http://localhost:8080`. A development bearer token `dev_123` is preconfigured.

4. **Submit a run**

   ```bash
   curl -s -X POST http://localhost:8080/v1/runs \
     -H "Authorization: Bearer dev_123" \
     -H "Content-Type: application/json" \
     -d '{
       "language": "python",
       "code": "print(1+1)",
       "limits": {"timeout_ms": 3000}
     }'
   ```

5. **Tear down**

   ```bash
   make down
   ```

## Configuration

Key environment variables for the API container:

| Variable | Description |
| --- | --- |
| `PORT` | HTTP listen port (default `8080`) |
| `API_KEYS` | Comma-separated list of `token:label:rps:burst` entries |
| `SANDBOX_WORKDIR` | Host path for per-run sandboxes (bind-mounted read/write) |
| `STORAGE_DIR` | Artifact storage directory |
| `PUBLIC_BASE_URL` | Base URL used when generating signed artifact links |
| `SIGNING_KEY` | HMAC signing secret for download URLs |
| `SECCOMP_PROFILE` | Path to seccomp JSON profile mounted inside the container |
| `APPARMOR_PROFILE` | Optional AppArmor profile name applied to runner containers |
| `RUNNER_IMAGE_PYTHON` etc. | Override runner images (defaults to `code-interpreter-runner-*:latest`) |

The orchestrator launches runner containers via the Docker CLI. The Compose file builds the runner images and exposes them for reuse, but the API executes code by spawning ephemeral containers with `--network=none`, `--read-only`, `--cap-drop=ALL`, `--pids-limit=32`, and the provided seccomp/AppArmor policies.

## Threat Model

- **Adversary**: Any API client supplying arbitrary code or uploaded files.
- **Assets**: Host integrity, other tenants' data, and service availability.
- **Attacker goals**:
  - Break out of the sandbox to access host resources or the Docker daemon
  - Exfiltrate sensitive data over the network
  - Launch denial-of-service attacks via resource exhaustion
- **Mitigations**:
  - Containers run as an unprivileged UID/GID with `no-new-privileges`
  - Network disabled (`--network=none`) and AppArmor policy forbids socket operations
  - Seccomp allowlist blocks dangerous syscalls (mount, ptrace, bpf, etc.)
  - Read-only root filesystem with writable `/work` tmpfs per run
  - CPU/memory/timeout limits enforced via Docker and in-runner rlimits
  - Artifact allowlist restricts output to `/work/outputs`
  - Token bucket rate limiting per API key prevents brute-force and DoS
  - Uploaded file size caps and environment variable sanitisation reduce attack surface

## Project Layout

```
/api          # TypeScript API service
/runners      # Language-specific sandbox images
/seccomp      # Seccomp profile allowlists
/apparmor     # AppArmor profile
/web/admin    # Static admin page for manual runs
```

See [`api/openapi/spec.yaml`](api/openapi/spec.yaml) for the full REST schema.

## Development Notes

- Unit and integration tests run under Jest without touching Docker by using a mock sandbox runner.
- The Docker sandbox adapter uses `docker run` with ephemeral containers; ensure the API container has permission to invoke the Docker daemon or replace the adapter with containerd/nsjail integration.
- The runner entrypoints enforce output caps and write usage metrics (`usage.json`) consumed by the orchestrator.
- The static admin page posts directly to the API using the configured bearer token.

## License

MIT
