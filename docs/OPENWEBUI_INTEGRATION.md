# Open-WebUI Integration Guide

This document explains how to integrate the Code Interpreter API with [Open-WebUI](https://github.com/open-webui/open-webui) to enable code execution capabilities within your AI chat interface.

## Overview

The integration allows Open-WebUI to execute code in five languages (Python, Node.js, Ruby, PHP, and Go) through sandboxed Docker containers, providing a safe environment for running untrusted code directly from chat conversations.

## Architecture

```
┌─────────────┐       ┌──────────────┐       ┌─────────────────┐
│  Open-WebUI │──────▶│ Code         │──────▶│ Docker          │
│  (Browser)  │ HTTP  │ Interpreter  │ Docker│ Containers      │
│             │       │ API          │ API   │ (Sandboxed)     │
└─────────────┘       └──────────────┘       └─────────────────┘
```

## Prerequisites

- Docker and Docker Compose
- Open-WebUI running (locally or in Docker)
- Node.js 20+ (for local development)

## Setup Instructions

### 1. Start the Code Interpreter API

```bash
# Using Make
make up

# Or using Docker Compose
docker compose --profile runners up -d
```

The API will be available at `http://localhost:8080`

### 2. Configure Open-WebUI Tool

#### Option A: Import Pre-configured Tool

1. Download the tool export from the releases or use the one in this repository
2. In Open-WebUI, go to **Settings → Workspace → Tools**
3. Click **Import** and upload the JSON file
4. Update the API URL if needed (see Docker Networking section)

#### Option B: Manual Setup

1. In Open-WebUI, go to **Settings → Workspace → Tools**
2. Click **New Tool**
3. Copy the contents of:
   - `openwebui_tool.py` for standard setup
   - `openwebui_tool_docker.py` if Open-WebUI is running in Docker (recommended)
4. Save the tool with a descriptive name

### 3. Docker Networking Configuration

The API URL depends on where Open-WebUI is running:

| Open-WebUI Location | API URL |
|-------------------|---------|
| Local browser (not Docker) | `http://localhost:8080/v1/runs` |
| Docker container | `http://host.docker.internal:8080/v1/runs` |
| Same Docker network | `http://code-interpreter-api:8080/v1/runs` |

**Important**: If Open-WebUI is in Docker, you have two options:
1. Use `openwebui_tool_docker.py` which has `host.docker.internal` pre-configured (recommended)
2. Use `openwebui_tool.py` and change the `api_url` valve to `http://host.docker.internal:8080/v1/runs`

## File Structure

```
code-interpreter/
├── api/                      # Main API implementation
│   └── src/
│       └── index.ts          # Enhanced with CORS, OpenAPI spec
├── openwebui_tool.py         # Open-WebUI tool implementation
├── openwebui_tool_docker.py  # Docker-specific version with host.docker.internal
├── test_tool.py              # Standalone test script
└── docs/
    └── OPENWEBUI_INTEGRATION.md  # This file
```

## Files Explained

### `api/src/index.ts` (Modified)
Added endpoints and features for Open-WebUI compatibility:
- **CORS support**: Allows browser-based requests
- **`/openapi.json`**: Serves OpenAPI specification
- **`/models` endpoints**: Compatibility with OpenAI clients
- **Better path resolution**: Works in different environments

### `openwebui_tool.py`
The main Open-WebUI tool implementation with:
- **Class-based structure**: Uses `Tools` class as required by Open-WebUI
- **6 functions**: `execute_code`, `run_python`, `run_javascript`, `run_ruby`, `run_php`, `run_go`
- **Error handling**: Graceful failures with emoji indicators
- **Configurable endpoints**: Via `Valves` configuration

### `test_tool.py`
Standalone Python script for testing the API without Open-WebUI:
```bash
python3 test_tool.py
```

## Usage in Open-WebUI

### Enabling the Tool

1. Start a new chat
2. Look for the tools/functions selector (usually a 🧩 icon)
3. Select "Code Interpreter" from available tools
4. The tool is now active for that chat session

### Example Prompts

```
"Run this Python code: print('Hello, World!')"

"Execute this Ruby script and tell me the output:
def factorial(n)
  return 1 if n <= 1
  n * factorial(n - 1)
end
puts factorial(10)"

"Can you run JavaScript code to generate 10 random numbers?"

"Execute PHP code to show the current date and time"

"Run Go code to print hello world"
```

### Function Reference

| Function | Language | Description |
|----------|----------|-------------|
| `run_python(code)` | Python 3.11 | Execute Python code |
| `run_javascript(code)` | Node.js 20 | Execute JavaScript code |
| `run_ruby(code)` | Ruby 3.x | Execute Ruby code |
| `run_php(code)` | PHP 8.x | Execute PHP code |
| `run_go(code)` | Go 1.21 | Execute Go code (compilation + execution) |
| `execute_code(code, language)` | Any | Generic execution with language parameter |

## Security Features

- **Sandboxed execution**: Each code run is in an isolated Docker container
- **Resource limits**: CPU, memory, and time limits enforced
- **Network isolation**: Containers have no network access
- **Read-only filesystem**: Prevents system modifications
- **Non-root execution**: Runs as unprivileged user

### Default Limits

| Resource | Limit |
|----------|-------|
| Timeout | 5 seconds (API), 60 seconds (Tool) |
| Memory | 256 MB |
| CPU | 5000ms |
| Output size | 1 MB |
| Artifacts | 5 MB total |

### Go Language Considerations

Go programs require compilation before execution, which adds approximately 3-4 seconds to the total execution time. The Docker container uses `golang:1.21-alpine` and handles:
- Compilation with optimization flags (`-ldflags -s -w`)
- Increased process limits (256 pids) for concurrent compilation
- Proper memory management for ARM64 architectures

## Troubleshooting

### Issue: "Connection failed" in Open-WebUI

**Cause**: Docker networking issue
**Solution**: Change `localhost` to `host.docker.internal` in tool configuration

### Issue: "Code execution timed out"

**Cause**: Code took longer than 60 seconds (tool timeout) or 5 seconds (API timeout)
**Note**: Go programs require compilation which takes 3-4 seconds
**Solution**: Optimize code or increase timeout in API configuration

### Issue: Tool not appearing in chat

**Cause**: Tool not properly saved or selected
**Solution**: 
1. Verify tool is saved in Workspace → Tools
2. Check if tool is enabled for current chat
3. Try refreshing Open-WebUI

### Issue: Authentication failed

**Cause**: Incorrect API key
**Solution**: Ensure API key matches between tool config and API environment

### Checking Logs

```bash
# API logs
docker logs code-interpreter-api-1 --tail 50

# Open-WebUI logs (if in Docker)
docker logs open-webui --tail 50
```

## API Endpoints

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/v1/runs` | POST | Execute code | Yes (Bearer token) |
| `/v1/health` | GET | Health check | No |
| `/openapi.json` | GET | OpenAPI spec | No |
| `/models` | GET | Model list (compatibility) | No |

## Environment Variables

### Code Interpreter API

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | API port |
| `API_KEYS` | dev_123:default:5:10 | API keys with rate limits |
| `SANDBOX_WORKDIR` | /sandbox | Container working directory |
| `PUBLIC_BASE_URL` | http://localhost:8080 | Public URL for API |

## Development

### Testing Changes

```bash
# Test API directly
curl -X POST http://localhost:8080/v1/runs \
  -H "Authorization: Bearer dev_123" \
  -H "Content-Type: application/json" \
  -d '{"language": "python", "code": "print(1+1)"}'

# Test with Python script
python3 test_tool.py
```

### Rebuilding After Changes

```bash
# Stop services
docker compose --profile runners down

# Rebuild API
docker compose --profile runners build api

# Start services
docker compose --profile runners up -d
```

## Export/Import Tools

### Exporting
1. Go to Tools in Open-WebUI
2. Click the export button on your tool
3. Save the JSON file

### Importing
1. Go to Tools in Open-WebUI
2. Click Import
3. Select the JSON file
4. Update configuration as needed

### Export Format
The export includes:
- Complete tool code
- Function specifications
- Metadata (name, description, author)
- Configuration (endpoints, auth)

## Contributing

To contribute improvements:

1. Test your changes locally
2. Update this documentation if needed
3. Include the tool export for easy sharing
4. Submit a pull request

## License

This integration is part of the Code Interpreter API project.

