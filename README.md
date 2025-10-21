# Code Interpreter API

An MVP implementation of an isolated code execution service that mirrors the OpenAI Code Interpreter run semantics. The API accepts untrusted code for Python, Node.js, Ruby, PHP, and Go, executes it inside hardened containers, and returns structured results including stdout/stderr streams and signed artifact URLs.

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
- **Open-WebUI Integration**: Use as a code execution tool in AI chat interfaces

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

   The API listens on `http://localhost:8080`. A development bearer token `dev_123` is preconfigured. The admin UI is served at the root: open `http://localhost:8080/`.

<img width="1123" height="895" alt="Screenshot 2025-10-18 at 12 17 11 AM" src="https://github.com/user-attachments/assets/039494e8-270b-4d26-920d-142d5659a360" />

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

   Language values must be one of: `python`, `node`, `ruby`, `php`, `go` (use `node`, not `node.js`).

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
| `HOST_SANDBOX_DIR` | Host directory used by the Docker runner for `--mount src=...` (binds the same location as `SANDBOX_WORKDIR` inside the API container) |
| `DISABLE_SANDBOX_SECURITY` | When set to `1`, omits seccomp/AppArmor and `no-new-privileges` flags (useful on Docker Desktop/macOS) |

The orchestrator launches runner containers via the Docker CLI. The Compose file builds the runner images and exposes them for reuse, but the API executes code by spawning ephemeral containers with `--network=none`, `--read-only`, `--cap-drop=ALL`, `--pids-limit=32`, and the provided seccomp/AppArmor policies. On Docker Desktop/macOS, the default Compose config sets `DISABLE_SANDBOX_SECURITY=1` to relax those flags for compatibility.

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

### Local development: rebuild/refresh cheatsheet

- API TypeScript edits (`api/src/...`):

  ```bash
  docker compose --profile runners build api && docker compose --profile runners up -d
  # or: docker compose up -d --build api
  ```

- Runner entrypoint edits (`runners/{python|node|ruby|php|go}/entrypoint.{sh|py}`):

  - Single runner:
    ```bash
    docker compose --profile runners build runner-node && docker compose --profile runners up -d
    ```
  - Build multiple runners at once (example: php + node + ruby):
    ```bash
    docker compose --profile runners build runner-php runner-node runner-ruby && docker compose --profile runners up -d
    ```

- Web UI edits (`web/admin/index.html`): just refresh the browser (bind-mounted).

- Compose/Dockerfile/env changes:

  ```bash
  docker compose --profile runners up -d --build
  ```

- Quick restart without rebuild:

  ```bash
  docker compose restart api
  ```

- Stop everything:

  ```bash
  make down
  # or
  docker compose down --remove-orphans && docker compose --profile runners down --remove-orphans
  ```

## Open-WebUI Integration

This API can be integrated with [Open-WebUI](https://github.com/open-webui/open-webui) to provide code execution capabilities in AI chat interfaces. 

**Quick Setup:**
1. Start the API: `make up`
2. Import `openwebui_tool.py` into Open-WebUI's Tools section
3. Use `host.docker.internal:8080` if Open-WebUI is in Docker, or just import `openwebui_tool_docker.py` instead of `openwebui_tool.py`

For detailed instructions, see [Open-WebUI Integration Guide](docs/OPENWEBUI_INTEGRATION.md).

## License

MIT
