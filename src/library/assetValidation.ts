import { ASSET_TYPES, MAX_ASSET_BYTES } from './model.ts'

export async function validateAsset(file: File): Promise<void> {
  if (!ASSET_TYPES[file.type] || !file.size || file.size > MAX_ASSET_BYTES) throw new Error('PNG, JPG, WebP veya PDF seç. Dosya en fazla 1 MB olabilir.')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const matches = file.type === 'application/pdf' ? String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
    : file.type === 'image/png' ? bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
      : file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!matches) throw new Error('Dosyanın içeriği seçilen dosya türüyle uyuşmuyor.')
}
