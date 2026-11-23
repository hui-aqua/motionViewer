# Motion Data Viewer

The Viewer opens SUMMARY v4 recordings locally or through the Worker cloud listing. Local files stay in the browser. It shows mean ± standard deviation and min/max bands, recorded maximum magnitude, sample/loss counts and status flags. Gaps break plot lines and partial windows are identified in tooltips.

Serve the dashboard locally with `python -m http.server 8000 --directory dashboard`, then open http://localhost:8000. Use Open file or drop a v4 `.bin`. Pan, zoom and choose the displayed axes and signals. CSV export includes the valid record prefix and physical units.

The Viewer is read-only and consumes GET /api/v1/files and GET /api/v1/files/content. The Worker is maintained and deployed from CoreS3_MotionLogger/cloudflare-worker. Publish the dashboard through the existing Pages workflow. Copy old SD data before the firmware upgrade. The device auto-resumes after reset and requires a confirmed STOP before retrieval or transport.

See DEVELOPER_MANUAL.md for local tests and rollout commands, and docs/dashboard-data-format.md for the authoritative schema pointer.
