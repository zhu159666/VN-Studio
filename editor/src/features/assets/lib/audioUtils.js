/**
 * 音频编辑纯工具（不依赖 DOM / React，可直接在 Node 中测试）。
 */

/**
 * 把声道采样降采样为固定数量的峰值（0..1），用于绘制波形。
 *
 * @param {Float32Array|number[]} channelData 单声道采样（-1..1）
 * @param {number} [buckets] 峰值桶数量，默认 1600（契约要求 ≤2000）
 * @returns {Float32Array} 长度 = buckets 的峰值数组
 */
export function computePeaks(channelData, buckets = 1600) {
  const data = channelData || [];
  const count = Math.max(1, Math.floor(Number(buckets) || 1600));
  const peaks = new Float32Array(count);
  const length = Math.max(0, Math.floor(data.length || 0));
  if (length === 0) return peaks;

  // 采样点比桶还少：逐点铺开（没有可聚合的区间）
  if (length <= count) {
    for (let i = 0; i < length; i += 1) {
      peaks[i] = Math.min(1, Math.abs(Number(data[i]) || 0));
    }
    return peaks;
  }

  const chunk = length / count;
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * chunk);
    const end = Math.min(length, Math.max(start + 1, Math.floor((bucket + 1) * chunk)));
    let max = 0;
    for (let i = start; i < end; i += 1) {
      const value = Math.abs(Number(data[i]) || 0);
      if (value > max) max = value;
    }
    peaks[bucket] = Math.min(1, max);
  }
  return peaks;
}

/**
 * 毫秒转 mm:ss.mmm。
 * @param {number} ms
 * @returns {string}
 */
export function formatTime(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * 把 trim 规整为合法区间：0 ≤ startMs < endMs ≤ durationMs，且至少留 10ms。
 *
 * @param {{startMs?:number,endMs?:number}|null|undefined} trim
 * @param {number} durationMs 源音频总时长
 * @returns {{startMs:number,endMs:number}}
 */
export function clampTrim(trim, durationMs) {
  const total = Math.max(1, Math.round(Number(durationMs) || 0));
  const minGap = Math.min(10, total);
  const rawStart = Number(trim?.startMs);
  const rawEnd = Number(trim?.endMs);
  const start = Number.isFinite(rawStart) ? rawStart : 0;
  const end = Number.isFinite(rawEnd) ? rawEnd : total;

  let startMs = Math.round(Math.min(Math.max(start, 0), Math.max(0, total - minGap)));
  let endMs = Math.round(Math.min(Math.max(end, startMs + minGap), total));
  if (endMs <= startMs) {
    endMs = Math.min(total, startMs + minGap);
    startMs = Math.max(0, endMs - minGap);
  }
  return { startMs, endMs };
}

/**
 * dB 转线性增益倍率。
 * @param {number} db
 * @returns {number}
 */
export function dbToGain(db) {
  const value = Number(db);
  return Number.isFinite(value) ? Math.pow(10, value / 20) : 1;
}

/**
 * 字节数格式化为人类可读文案。
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '未知';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
