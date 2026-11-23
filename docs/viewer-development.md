# Viewer verification

Run `npm test` from this repository. The Viewer VM harness checks the firmware-generated SUMMARY v4 golden fixture, physical means/std/min/max, recorded magnitude, gaps, partial flags, local file loading, zoom, hover, themes, statistics and CSV export. Worker tests are maintained in CoreS3_MotionLogger/cloudflare-worker.

Run `python scripts/test_local_summary.py` with FastAPI and python-multipart installed for the local filesystem substitute. The fixture lives in the sibling CoreS3_MotionLogger checkout. The firmware Python suite compares every decoded SUMMARY field across the host firmware decoder, Python and Worker decoder.

Before deployment, inspect the native browser at desktop and phone widths, open a local v4 file, verify the mean ± std and min/max bands, gap breaks, status tooltips, magnitude signals, CSV export and UTC/Oslo display. Native browser and hardware acceptance are pending.
