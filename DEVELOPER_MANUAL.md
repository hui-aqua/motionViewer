# Viewer developer manual

The Viewer is read-only. It consumes GET /api/v1/files and GET /api/v1/files/content, or opens local files in the browser. dashboard/decoder.js remains the browser decoder; dashboard/app.js renders recordings. The authoritative schema is [DATA_FORMAT.md](../CoreS3_MotionLogger/DATA_FORMAT.md).

The Worker is maintained and deployed from CoreS3_MotionLogger/cloudflare-worker. See its README for backend tests and operations.

## Local validation

Run npm --prefix . install and npm --prefix . test from Storage. Dashboard tests continue to read ../CoreS3_MotionLogger/test/fixtures.

The optional backend/app/main.py filesystem substitute and scripts/test_local_summary.py remain because existing tools and documentation reference them. They require backend/requirements.txt and are separate from Viewer operation.

## Pages publish

Publish dashboard/ using .github/workflows/pages.yml after code review. Serve locally with python -m http.server 8000 --directory dashboard.

## Public device list

The Viewer fetches GET /api/v1/devices from the configured Worker origin. The response is {devices: [{id, display_name}]}; IDs are option values and display names are option labels. This public endpoint shares the file-list CORS policy and requires no key. The firmware Worker owns the single authoritative registry. There is no local device-list copy.

If the API is unavailable or invalid, cloud device selection is disabled; local file viewing remains available. Refresh the page to retry. Deploy the Worker endpoint before publishing this Viewer through Pages. The optional Python substitute fetches the same API, with DEVICES_API_URL available for local API testing; unavailable registry responses produce 503.
