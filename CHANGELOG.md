# Changelog

## [Unreleased] - Open-WebUI Integration

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

