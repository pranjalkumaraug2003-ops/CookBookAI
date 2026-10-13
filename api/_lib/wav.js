// Wraps raw 16-bit PCM samples in a standard 44-byte RIFF WAV header.
// Default: 24000 Hz, 1 channel (mono), 16-bit depth (Gemini audio format).

export function pcmToWav(pcm, { sampleRate = 24000, channels = 1, bitDepth = 16 } = {}) {
  const buf = typeof pcm === 'string'
    ? Buffer.from(pcm, 'base64')
    : Buffer.isBuffer(pcm)
      ? pcm
      : Buffer.from(pcm || []);
  const dataSize = buf.length;
  const header = Buffer.alloc(44);
  const bytesPerSample = bitDepth / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, buf]);
}
