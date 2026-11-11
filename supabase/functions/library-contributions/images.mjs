import { Buffer } from 'node:buffer'
import { PNG } from 'pngjs'

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export function sanitizeContributionImage(input) {
  const bytes = Buffer.from(input)
  const signature = Buffer.from([137,80,78,71,13,10,26,10])
  if (bytes.length < 33 || bytes.length > MAX_IMAGE_BYTES || !bytes.subarray(0,8).equals(signature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii',12,16) !== 'IHDR') throw new Error('invalid-file')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width > 2400 || height > 2400 || width * height > 4000000 || bytes[24] !== 8 || ![2,6].includes(bytes[25]) || bytes[28] !== 0) throw new Error('invalid-file')
  // Check every chunk boundary before decoding; a second IHDR must never replace the bounded dimensions.
  let offset = 8, ended = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8)
    if (length > bytes.length - offset - 12 || (type === 'IHDR' && offset !== 8)) throw new Error('invalid-file')
    offset += length + 12
    if (type === 'IEND') { if (length !== 0) throw new Error('invalid-file'); ended = true; break }
  }
  if (!ended) throw new Error('invalid-file')
  try {
    const decoded = PNG.sync.read(bytes.subarray(0, offset), {checkCRC:true,skipRescale:true})
    if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) throw new Error('invalid-file')
    // Only decoded pixel data is written. Text, profiles, attachments and trailing bytes are discarded.
    const output = PNG.sync.write({width,height,data:decoded.data}, {colorType:6,inputColorType:6,bitDepth:8,deflateLevel:6})
    if (output.length > MAX_IMAGE_BYTES) throw new Error('file-limit')
    return output
  } catch (error) { if (error instanceof Error && error.message === 'file-limit') throw error; throw new Error('invalid-file') }
}
