# Binary Data Format

Firmware 1.2.0 uses RAW v3 locally and SUMMARY v4 for upload.

## 1. Global encoding rules (both formats)

- Little-endian. Signed = two's complement.
- Serialize field-by-field at explicit offsets with helpers (`put_u16/put_u32/put_u64/put_i16`, matching `get_*`).
  Do not rely on packed-struct memcpy for on-disk I/O. Add offset tests for every field.
- Strings: fixed-length ASCII, NUL-padded; may be unterminated when full.
- Reserved bytes: write 0; readers ignore.
- **CRC32** = IEEE/zlib (reflected poly 0xEDB88320, init 0xFFFFFFFF, xorout 0xFFFFFFFF). Vector `"123456789"` → `0xCBF43926`.
- **CRC16** = CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0). Vector `"123456789"` → `0x29B1`.
- Sensor values are raw BMI270 counts. Physical units: `acc_g = count * acc_range_g / 32768`, `gyro_dps = count * gyro_range_dps / 32768`.
- Headers are written **once** at creation and never rewritten.
- Readers take sizes from header fields and ignore unknown trailing bytes. Future changes may only append fields.

---

## 2. RAW v3 (local only)

### 2.1 Layout

```
[file header 512 B][block 0: 4096 B][block 1: 4096 B] ...
block = block header 64 B + 336 samples × 12 B (4032 B) = 4096 B
```

One RAW file per UTC day per device; keep current directory and naming. Same-day sessions append blocks.
Only sidecar case: if an existing same-day file's **header** is invalid, create `<name>_bNN.bin` (NN = 01..99) and log it.

### 2.2 File header — 512 B

| Off  | Size | Type     | Field             | Value / note                      |
| ---- | ---- | -------- | ----------------- | --------------------------------- |
| 0    | 8    | char[8]  | magic             | `CS3RAW01`                        |
| 8    | 2    | u16      | format_version    | 3                                 |
| 10   | 2    | u16      | header_size       | 512                               |
| 12   | 2    | u16      | block_size        | 4096                              |
| 14   | 2    | u16      | block_header_size | 64                                |
| 16   | 2    | u16      | sample_size       | 12                                |
| 18   | 2    | u16      | rate_hz           | 100                               |
| 20   | 16   | char[16] | device_id         |                                   |
| 36   | 16   | char[16] | firmware_version  |                                   |
| 52   | 4    | u32      | raw_date          | YYYYMMDD (UTC; 0 if time invalid) |
| 56   | 8    | u64      | created_utc_ms    | 0 if time invalid                 |
| 64   | 2    | u16      | acc_range_g       |                                   |
| 66   | 2    | u16      | gyro_range_dps    |                                   |
| 68   | 1    | u8       | acc_conf          | BMI270 ACC_CONF raw               |
| 69   | 1    | u8       | gyr_conf          | GYR_CONF raw                      |
| 70   | 1    | u8       | fifo_config       | FIFO_DOWNS raw (0x88)             |
| 71   | 1    | u8       | time_valid        | 0/1 at creation                   |
| 72   | 436  | u8[]     | reserved          | 0                                 |
| 508  | 4    | u32      | header_crc32      | over bytes 0..507                 |

### 2.3 Block header — 64 B

| Off  | Size | Type    | Field                | Note                                                |
| ---- | ---- | ------- | -------------------- | --------------------------------------------------- |
| 0    | 4    | char[4] | block_magic          | `CS3B`                                              |
| 4    | 4    | u32     | block_seq            | 0-based, contiguous within the file across sessions |
| 8    | 4    | u32     | segment_id           | same as SegmentIndex / SUMMARY                      |
| 12   | 4    | u32     | boot_count           | from NVS                                            |
| 16   | 8    | u64     | first_sample_index   | session-cumulative index of sample 0                |
| 24   | 8    | u64     | anchor_mono_us       | monotonic time of anchor sample                     |
| 32   | 8    | u64     | anchor_utc_ms        | 0 if UTC invalid                                    |
| 40   | 4    | u32     | anchor_sensortime    | 24-bit SensorTime raw ticks                         |
| 44   | 2    | u16     | anchor_sample_offset | index in block that the anchor refers to            |
| 46   | 2    | u16     | sample_count         | 1..336                                              |
| 48   | 2    | u16     | flags                | §2.4                                                |
| 50   | 2    | u16     | missed_before        | samples lost just before sample 0 (saturate 65535)  |
| 52   | 2    | i16     | temp_centi_c         | -32768 = n/a                                        |
| 54   | 2    | u16     | battery_mv           | 0 = n/a                                             |
| 56   | 4    | u32     | reserved             | 0                                                   |
| 60   | 4    | u32     | crc32                | over bytes 0..59 and 64..4095                       |

No SensorTime frame in this block (flag b7): `anchor_sensortime = 0xFFFFFFFF`, `anchor_sample_offset = 0xFFFF`;
`anchor_mono_us` / `anchor_utc_ms` then refer to sample 0.

### 2.4 Block flags

| Bit  | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| 0    | discontinuity before sample 0 (new session, FIFO loss, resume) |
| 1    | UTC valid                                                    |
| 2    | clock adjusted since previous block                          |
| 3    | low battery (battery_mv < `MOTION_LOW_BATT_MV`; 0 = disabled; flag only, no stop policy in this task) |
| 4    | partial block (Stop or day rollover)                         |
| 5    | accelerometer saturation                                     |
| 6    | gyroscope saturation                                         |
| 7    | no new SensorTime anchor in block                            |
| 8–15 | reserved 0                                                   |

### 2.5 Sample — 12 B

`ax, ay, az, gx, gy, gz` as i16. No per-sample timestamp or status. Unused slots in a partial block are zero.

### 2.6 RAW semantics

- `first_sample_index` counts samples actually written. Lost samples do not advance it; they set b0 + `missed_before`.
  Time is reconstructed per contiguous run.
- **Remove all host-side timestamp backfill/estimation** (this resolves the RAW timestamp-regression issue).
  The anchor is the most recent FIFO SensorTime frame and the sample position it belongs to.
- Blocks are written only as whole 4096 B units. A partial block is written only on Stop or rollover.
- Reopen of a same-day file: validate header magic/version/CRC (invalid → sidecar, §2.1).
  If `(size − 512) % 4096 ≠ 0`, append zero padding to the next block boundary (**never truncate**), then append.
  `block_seq` continues from last valid block + 1.
- Recovery/reading = forward block scan at 4096 B steps; valid block = magic `CS3B` + CRC OK; skip invalid blocks.

---

## 3. SUMMARY v4 (uploaded)

### 3.1 Layout

`[header 128 B][record 80 B] × N`. One file per recording session (segment).
Lifecycle OPEN → FINALIZED (Stop/rollover) or RECOVERED (boot recovery).

### 3.2 Header — 128 B

| Off  | Size | Type     | Field                  | Value / note                     |
| ---- | ---- | -------- | ---------------------- | -------------------------------- |
| 0    | 8    | char[8]  | magic                  | `CS3SUM01`                       |
| 8    | 2    | u16      | format_version         | 4                                |
| 10   | 2    | u16      | header_size            | 128                              |
| 12   | 2    | u16      | record_size            | 80                               |
| 14   | 2    | u16      | window_ms              | 1000                             |
| 16   | 16   | char[16] | device_id              |                                  |
| 32   | 16   | char[16] | firmware_version       |                                  |
| 48   | 8    | u64      | start_utc_ms           | 0 if invalid                     |
| 56   | 8    | u64      | start_mono_us          |                                  |
| 64   | 4    | u32      | boot_count             |                                  |
| 68   | 4    | u32      | segment_id             |                                  |
| 72   | 4    | u32      | raw_date               | RAW file date at session start   |
| 76   | 8    | u64      | raw_first_sample_index | first RAW sample of this session |
| 84   | 2    | u16      | raw_rate_hz            | 100                              |
| 86   | 2    | u16      | acc_range_g            |                                  |
| 88   | 2    | u16      | gyro_range_dps         |                                  |
| 90   | 1    | u8       | time_valid             | 0/1                              |
| 91   | 1    | u8       | time_source            | 0 none, 1 RTC, 2 NTP             |
| 92   | 1    | u8       | acc_conf               |                                  |
| 93   | 1    | u8       | gyr_conf               |                                  |
| 94   | 30   | u8[]     | reserved               | 0                                |
| 124  | 4    | u32      | header_crc32           | over bytes 0..123                |

### 3.3 Record — 80 B

| Off  | Size | Type   | Field          | Note                                   |
| ---- | ---- | ------ | -------------- | -------------------------------------- |
| 0    | 8    | u64    | utc_end_ms     | exclusive window end; 0 if UTC invalid |
| 8    | 4    | u32    | mono_end_ms    | ms since header start_mono_us          |
| 12   | 4    | u32    | record_seq     | 0-based, contiguous per file           |
| 16   | 2    | u16    | sample_count   |                                        |
| 18   | 2    | u16    | missed_samples |                                        |
| 20   | 2    | u16    | status         | §3.4                                   |
| 22   | 2    | i16    | temp_centi_c   | -32768 = n/a                           |
| 24   | 2    | u16    | battery_mv     | 0 = n/a                                |
| 26   | 2    | u16    | acc_mag_max    | counts, saturate 65535                 |
| 28   | 2    | u16    | gyro_mag_max   | counts, saturate 65535                 |
| 30   | 6    | i16[3] | acc_mean       | x,y,z                                  |
| 36   | 6    | u16[3] | acc_std        | population std                         |
| 42   | 6    | i16[3] | acc_min        | signed                                 |
| 48   | 6    | i16[3] | acc_max        | signed                                 |
| 54   | 6    | i16[3] | gyro_mean      |                                        |
| 60   | 6    | u16[3] | gyro_std       |                                        |
| 66   | 6    | i16[3] | gyro_min       |                                        |
| 72   | 6    | i16[3] | gyro_max       |                                        |
| 78   | 2    | u16    | crc16          | over bytes 0..77                       |

Computation: per axis int64 `sum`, `sumsq`; mean = round-half-away-from-zero(sum/n);
std = round(sqrt(max(0, sumsq/n − mean_exact²))), saturate 65535; magnitudes compared squared, one sqrt at window end.
If n = 0 for a sensor, its stats are 0 and its present-bit is clear.

### 3.4 Status bits

| Bit   | Meaning                                                  |
| ----- | -------------------------------------------------------- |
| 0     | accelerometer samples present                            |
| 1     | gyroscope samples present                                |
| 2     | accelerometer saturation                                 |
| 3     | gyroscope saturation                                     |
| 4     | FIFO loss / uncertain frame parse                        |
| 5     | UTC valid                                                |
| 6     | sample-timing anomaly                                    |
| 7     | gap before this window (empty windows skipped)           |
| 8     | clock adjusted inside window                             |
| 9     | low battery (same rule as RAW b3)                        |
| 10    | partial window (first aligned or final at Stop/rollover) |
| 11–15 | reserved 0                                               |

### 3.5 Window rules

- If time valid: windows align to whole UTC seconds (`utc_end_ms % 1000 == 0`); otherwise to 1000 ms monotonic from session start.
- Half-open `[end−1000, end)`. Empty windows are not written; the next written window sets bit 7.
- The final partial window **is** written on Stop/rollover (bit 10).
- Total dropped = Σ missed_samples. No mutable counter in any header.

### 3.6 Valid prefix and upload

- Valid prefix = header CRC OK + longest run of records from seq 0 with correct crc16 and contiguous `record_seq`.
- FINALIZED: upload whole file; size must equal `128 + 80·N` exactly.
- RECOVERED: upload exactly `[0, 128 + 80·valid_records)`; local file may be longer.
- `size_bytes` and `crc32` in upload metadata describe the uploaded bytes. `file_format = "cs3_summary_v4"`.

---
