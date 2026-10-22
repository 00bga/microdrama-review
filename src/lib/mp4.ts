// Reads the duration from an MP4 container (moov/mvhd). The app trusts the browser's measurement;
// the scripts use this because they have no browser.
export function mp4Duration(buf: Buffer): number | null {
  const find = (start: number, end: number, type: string): [number, number] | null => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = buf.readUInt32BE(pos);
      const name = buf.toString("latin1", pos + 4, pos + 8);
      let header = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(pos + 8));
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < header) return null;
      if (name === type) return [pos + header, pos + size];
      pos += size;
    }
    return null;
  };
  const moov = find(0, buf.length, "moov");
  if (!moov) return null;
  const mvhd = find(moov[0], moov[1], "mvhd");
  if (!mvhd) return null;
  const version = buf.readUInt8(mvhd[0]);
  if (version === 1) {
    const timescale = buf.readUInt32BE(mvhd[0] + 20);
    const duration = Number(buf.readBigUInt64BE(mvhd[0] + 24));
    return timescale > 0 ? duration / timescale : null;
  }
  const timescale = buf.readUInt32BE(mvhd[0] + 12);
  const duration = buf.readUInt32BE(mvhd[0] + 16);
  return timescale > 0 ? duration / timescale : null;
}
