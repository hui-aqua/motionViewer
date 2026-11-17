/* SUMMARY v4 reader shared by the browser and Worker. */
(() => {
  const FLAGS = ['acc_present', 'gyro_present', 'acc_saturation', 'gyro_saturation', 'fifo_loss',
    'utc_valid', 'timing_anomaly', 'gap_before', 'clock_adjusted', 'low_battery', 'partial_window'];
  function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of new Uint8Array(buffer)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }
  function crc16(bytes) {
    let crc = 0xffff;
    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; ++bit) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
    return crc;
  }
  function fixed(bytes, start, size) {
    const text = new TextDecoder().decode(bytes.subarray(start, start + size));
    return text.split('\0')[0];
  }
  function decodeBinary(buffer, options = {}) {
    const bytes = new Uint8Array(buffer), v = new DataView(buffer);
    const bad = message => { throw new Error('Invalid SUMMARY v4: ' + message); };
    if (bytes.length < 128 || fixed(bytes, 0, 8) !== 'CS3SUM01' || v.getUint16(8, true) !== 4) bad('magic or version');
    const headerBytes = v.getUint16(10, true), recordBytes = v.getUint16(12, true);
    if (headerBytes < 128 || bytes.length < headerBytes || recordBytes < 80 || v.getUint16(14, true) !== 1000) bad('sizes or window');
    if (parseInt(crc32(buffer.slice(0, 124)), 16) !== v.getUint32(124, true)) bad('header CRC32');
    if (options.summaryHz != null && Number(options.summaryHz) !== 1) bad('frequency metadata');
    const header = {
      kind: 'summary', version: 4, headerBytes, recordBytes, device: fixed(bytes, 16, 16), firmware: fixed(bytes, 32, 16),
      createdUtc: v.getBigUint64(48, true) ? new Date(Number(v.getBigUint64(48, true))).toISOString() : '',
      startMonoUs: v.getBigUint64(56, true).toString(), bootCount: v.getUint32(64, true), segmentId: v.getUint32(68, true),
      rawDate: v.getUint32(72, true), rawFirstSampleIndex: v.getBigUint64(76, true).toString(),
      sampleRate: v.getUint16(84, true), accRangeG: v.getUint16(86, true), gyroRangeDps: v.getUint16(88, true),
      timeValid: !!bytes[90], timeSource: bytes[91], summaryHz: 1, rateSource: 'v4 header',
      timestampSemantics: 'exclusive window end', timeBasis: 'session monotonic'
    };
    if (options.validateOnly) {
      let recordCount = 0, validBytes = headerBytes;
      for (let offset = headerBytes; offset + recordBytes <= bytes.length; offset += recordBytes) {
        if (v.getUint32(offset + 12, true) !== recordCount ||
            v.getUint16(offset + 78, true) !== crc16(bytes.subarray(offset, offset + 78))) break;
        ++recordCount; validBytes += recordBytes;
      }
      return {kind: 'summary', header, recordCount, validBytes, tailBytes: bytes.length - validBytes,
        representedDurationSeconds: recordCount};
    }
    const all = [];
    let validBytes = headerBytes, timestampsValid = true, monotonicValid = true;
    for (let offset = headerBytes; offset + recordBytes <= bytes.length; offset += recordBytes) {
      const seq = all.length;
      if (v.getUint32(offset + 12, true) !== seq || v.getUint16(offset + 78, true) !== crc16(bytes.subarray(offset, offset + 78))) break;
      const u16 = n => v.getUint16(offset + n, true), i16 = n => v.getInt16(offset + n, true);
      const status = u16(20), mono = v.getUint32(offset + 8, true), utc = Number(v.getBigUint64(offset, true));
      const previous = all.at(-1);
      const point = {t: String(utc), sensorTimeUs: String(Number(header.startMonoUs) + mono * 1000), monoEndMs: mono,
        recordId: seq, sampleCount: u16(16), missedSamples: u16(18), status,
        temperature: i16(22) === -32768 ? null : i16(22) / 100, batteryVoltage: u16(24) ? u16(24) / 1000 : null,
        accMagPeak: u16(26) * header.accRangeG / 32768, gyroMagPeak: u16(28) * header.gyroRangeDps / 32768,
        accValid: !!(status & 1), gyroValid: !!(status & 2), accSaturated: !!(status & 4), gyroSaturated: !!(status & 8),
        loss: !!(status & 16), timeValid: !!(status & 32), timingWarning: !!(status & 64), emptyIntervalGap: !!(status & 128),
        clockAdjusted: !!(status & 256), lowBattery: !!(status & 512), partialWindow: !!(status & 1024),
        gapBefore: !!(status & 128) || !!(previous && mono - previous.monoEndMs > 1000),
        statusFlags: FLAGS.filter((_, bit) => status & (1 << bit))};
      for (const [sensor, base, range, present] of [['a', 30, header.accRangeG, point.accValid], ['g', 54, header.gyroRangeDps, point.gyroValid]]) {
        for (let axis = 0; axis < 3; ++axis) {
          const key = sensor + 'xyz'[axis], scale = range / 32768;
          point[key] = present ? i16(base + axis * 2) * scale : null;
          point[key + 'Std'] = present ? u16(base + 6 + axis * 2) * scale : null;
          point[key + 'Min'] = present ? i16(base + 12 + axis * 2) * scale : null;
          point[key + 'Max'] = present ? i16(base + 18 + axis * 2) * scale : null;
          point[(sensor === 'a' ? 'acc' : 'gyro') + 'XYZ'[axis] + 'Peak'] = present ? Math.max(Math.abs(point[key + 'Min']), Math.abs(point[key + 'Max'])) : null;
        }
      }
      if (!point.timeValid || !utc || previous && utc <= Number(previous.t)) timestampsValid = false;
      if (previous && mono <= previous.monoEndMs) monotonicValid = false;
      all.push(point); validBytes += recordBytes;
    }
    const stride = options.allRecords ? 1 : Math.max(1, Math.ceil(all.length / 12000));
    const points = [];
    for (let i = 0; i < all.length; i += stride) {
      const point = {...all[i]};
      point.gapBefore ||= all.slice(Math.max(0, i - stride + 1), i).some(p => p.gapBefore);
      points.push(point);
    }
    const tailBytes = bytes.length - validBytes;
    const timestampSpanSeconds = all.length && timestampsValid ? (Number(all.at(-1).t) - Number(all[0].t)) / 1000 : null;
    const monotonicSpanSeconds = all.length && monotonicValid ? (all.at(-1).monoEndMs - all[0].monoEndMs) / 1000 : null;
    return {status: 'decoded', decoded: true, kind: 'summary', header, points, recordCount: all.length,
      plottedCount: points.length, stride, tailBytes, validBytes, damaged: tailBytes > 0,
      representedDurationSeconds: all.length, timestampSpanSeconds, timestampsValid, monotonicValid, monotonicSpanSeconds,
      windowCoverageSeconds: monotonicSpanSeconds == null ? null : monotonicSpanSeconds + 1,
      message: `SUMMARY v4, ${all.length} CRC-checked records, ${tailBytes} excluded bytes`};
  }
  function binaryCsv(buffer, options = {}) {
    const d=decodeBinary(buffer,{...options,allRecords:true});
    const metadata={...d.header,completeRecords:d.recordCount,trailingBytes:d.tailBytes};
    const fields=d.points.length?Object.keys(d.points[0]):[];
    const timeZone = d.kind === 'summary' ? options.timeZone : null;
    const timeFormatter = timeZone ? new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3, hourCycle: 'h23', timeZoneName: 'longOffset'
    }) : null;
    function recordTime(point) {
      const timestamp = Number(point.t);
      if (!point.timeValid || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return '';
      const p = Object.fromEntries(timeFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond} ${p.timeZoneName.replace('GMT', 'UTC')} [${timeZone}]`;
    }
    const escape=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const timeColumns = timeFormatter ? ['record_time_local'] : [];
    const lines=[[...Object.keys(metadata).map(k=>'header_'+k),'record_index',...fields,...timeColumns].map(escape).join(',')];
    d.points.forEach((p,i)=>lines.push([...Object.values(metadata),i,...fields.map(k=>p[k]),...(timeFormatter ? [recordTime(p)] : [])].map(escape).join(',')));
    return lines.join('\r\n')+'\r\n';
  }

  globalThis.motionCrc32 = crc32;
  globalThis.motionCrc16 = crc16;
  globalThis.binaryCsv = binaryCsv;
  globalThis.decodeBinary = decodeBinary;
})();
