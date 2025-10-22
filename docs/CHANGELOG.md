# Changelog

## [Unreleased] - Go Language Support & Docker Fixes

### Added
- **Go Language Support (Go 1.21)**:
  - Complete Go compiler and runtime support
  - Docker container with golang:1.21-alpine base image
  - Python-based entrypoint script for compilation and execution
  - Support for command-line arguments and file I/O
  - Comprehensive unit tests for Go execution scenarios
  - Web UI integration with Go option in dropdown menu
  - Smart code defaults for each language including Go

### Fixed
- **Open-WebUI Docker Connectivity**:
  - Created Docker-specific tool version (`openwebui_tool_docker.py`) using `host.docker.internal`
  - Increased timeout from 30 to 60 seconds to accommodate Go compilation time
  - Added configurable timeout via Valves interface
  - Improved error messages to diagnose Docker networking issues
  - Fixed timeout issues when executing Go code from Docker-hosted Open-WebUI

### Changed
- Updated TypeScript types to include 'go' language
- Modified Docker Sandbox to handle Go-specific requirements (increased pids-limit to 256)
- Updated docker-compose.yaml with runner-go service
- Enhanced OpenAPI spec to include Go in language enum
- Updated README with Go support and Docker-specific instructions

### Technical Details
- Fixed ARM64 (Mac M1/M2) compatibility issues:
  - Disabled RLIMIT_AS to avoid Go memory allocator conflicts
  - Changed cache paths to writable /work directory
  - Added build optimization flags (-ldflags -s -w)
  - Set GOMEMLIMIT and GOGC environment variables

## [Previous] - Open-WebUI Integration

### Added
- **Open-WebUI Integration**: Complete integration with Open-WebUI for code execution in chat interfaces
  - Added CORS support for browser-based API access
  - Created `/openapi.json` endpoint for API discovery
  - Added `/models` endpoints for OpenAI client compatibility
  - Implemented `openwebui_tool.py` with 5 execution functions (Python, JavaScript, Ruby, PHP)
  - Created comprehensive documentation in `docs/OPENWEBUI_INTEGRATION.md`
  - Added `test_tool.py` for standalone API testing

### Changed
- Enhanced `api/src/index.ts` with Open-WebUI compatibility features
- Improved admin UI path resolution for Docker and local environments
- Updated README with Open-WebUI integration section
- Added detailed inline documentation to all integration files

### Security
- Updated `.gitignore` to exclude sensitive exports and temporary files
- Configured proper CORS headers with authentication support
- Maintained sandboxed execution for all code runs

### Documentation
- Created comprehensive Open-WebUI Integration Guide
- Added setup instructions for Docker networking scenarios
- Documented all tool functions and API endpoints
- Added troubleshooting section for common issues

### Files Modified
- `api/src/index.ts` - Added CORS, OpenAPI spec, /models endpoints
- `api/package.json` - Added cors dependency
- `README.md` - Added Open-WebUI section
- `.gitignore` - Enhanced with Python and export patterns

### Files Added
- `docs/OPENWEBUI_INTEGRATION.md` - Complete integration guide
- `openwebui_tool.py` - Open-WebUI tool implementation
- `test_tool.py` - Standalone test script
- `CHANGELOG.md` - This file

