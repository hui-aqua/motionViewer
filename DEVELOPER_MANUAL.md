# Storage developer manual

The Worker entry point is backend/worker/index.js. dashboard/decoder.js provides the shared browser/Worker SUMMARY v4 decoder. dashboard/app.js draws means, standard deviation and min/max bands, magnitude signals, gaps and status flags. backend/app/main.py provides the optional local filesystem substitute.

## Upload contract

POST /api/v1/upload retains authenticated multipart metadata, device/date/CRC32 dedup identity, SHA-256 collision checks and STORED/ALREADY_EXISTS acknowledgements. It accepts only cs3_summary_v4 with 1 Hz metadata. Header magic/version/sizes/CRC32 and every record CRC16 and contiguous sequence are checked. Files must contain at least one complete record and have exact alignment. Firmware RECOVERED uploads contain only their valid prefix.

GET /api/v1/files lists v4 objects for registered devices. GET /api/v1/files/content downloads their bytes. RAW stays on the device. The binary schema is docs/dashboard-data-format.md.

## Local validation

```powershell
npm test
npm run worker:build
python scripts/test_local_summary.py
```

The local Python substitute requires FastAPI and python-multipart. Tests read firmware-generated fixtures in ../CoreS3_MotionLogger/test/fixtures. Cross-tool field comparison is part of that firmware repository's host suite.

## Operator rollout

Deploy the matching Worker from this repository with the following command.

```powershell
npm run worker:deploy
```

Publish the updated dashboard using .github/workflows/pages.yml after code review. Local tests and dry-run packaging precede rollout. The implementation work performs local validation only.
