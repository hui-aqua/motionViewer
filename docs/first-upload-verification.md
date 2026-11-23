# Backend verification

Worker upload validation and deployment are maintained in [CoreS3_MotionLogger/cloudflare-worker](../../CoreS3_MotionLogger/cloudflare-worker/README.md). Run its tests from the firmware repository.

The Viewer is read-only: verify GET /api/v1/files and GET /api/v1/files/content through its file list and plot. Publish the dashboard using the existing Pages workflow.

For the optional local filesystem substitute, install backend/requirements.txt and run python scripts/test_local_summary.py.
