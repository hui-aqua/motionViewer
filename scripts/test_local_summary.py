"""Local filesystem handler checks using the firmware-generated golden fixture."""
import asyncio
import io
from pathlib import Path
import sys
import tempfile
import zlib
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import main
from fastapi import HTTPException, UploadFile

# Exercise the registry client offline, then stub it for upload-handler checks.
from unittest.mock import patch
with patch.object(main, 'urlopen', return_value=io.BytesIO(b'{"devices":[{"id":"CS3_01","display_name":"Sensor"}]}')) as request:
    assert main.read_devices() == frozenset(['CS3_01'])
    request.assert_called_once_with(main.DEVICES_API_URL, timeout=10)
for payload in [b'{}', b'{"devices":[]}', b'{"devices":[{"id":"bad/id"}]}']:
    with patch.object(main, 'urlopen', return_value=io.BytesIO(payload)):
        try:
            main.read_devices()
            raise AssertionError('Invalid registry accepted')
        except HTTPException as error:
            assert error.status_code == 503
main.read_devices = lambda: frozenset(['CS3_01'])

async def run():
    data = (Path(__file__).resolve().parents[2] / 'CoreS3_MotionLogger/test/fixtures/summary_v4_sample.bin').read_bytes()[:448]
    async def send(content, **changes):
        fields = dict(device_id='CS3_01', timestamp='2026-11-16T00:00:00Z', sampling_frequency=1,
                      summary_hz=1, measurement_type='motion_summary', file_format='cs3_summary_v4',
                      date='2026-11-16', crc32=f'{zlib.crc32(content):08x}', size_bytes=str(len(content)),
                      authorization=f'Bearer {main.DEVICE_API_KEY}')
        fields.update(changes)
        return await main.upload(UploadFile(filename='summary.bin', file=io.BytesIO(content)), **fields)
    with tempfile.TemporaryDirectory() as directory:
        main.DATA_DIR = Path(directory)
        assert (await send(data))['status'] == 'STORED'
        assert (await send(data))['status'] == 'ALREADY_EXISTS'
        for offset in [0, 124, 148, 206, 220]:
            content = bytearray(data)
            content[offset] ^= 1
            try:
                await send(bytes(content))
                raise AssertionError('Corrupt content accepted')
            except HTTPException as error:
                assert error.status_code == 422
        try:
            await send(data, file_format='cs3_summary_v3')
            raise AssertionError('Legacy accepted')
        except HTTPException as error:
            assert error.status_code == 422
    print('PASS local backend v4 CRCs, sequences, metadata, dedup and legacy rejection')

asyncio.run(run())
