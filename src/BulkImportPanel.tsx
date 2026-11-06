import { useRef, useState } from 'react'
import type { PlannerState } from './plannerTypes'
import { IMPORT_LABELS, prepareBulkImport, type ImportPreview, type ImportRules } from './bulkImport'
import instructions from './bulk-import-instructions.txt?raw'

interface Props {
  data: PlannerState
  rules: ImportRules
  hasDrafts: boolean
  onApply: (text: string, baseState: PlannerState) => Promise<{ ok: boolean; message: string }>
}

export default function BulkImportPanel({ data, rules, hasDrafts, onApply }: Props) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ result: ImportPreview; text: string; baseState: PlannerState } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const saveLock = useRef(false)
  const stale = preview && (preview.text !== text || preview.baseState !== data)
  const result = preview?.result
  const reference = [
    'KLİNİK ATLAS — GÜNCEL ASİSTAN / ALAN REFERANSI',
    `Alınma tarihi: ${new Date().toLocaleDateString('tr-TR')}`,
    '\nKayıtlı asistanlar:',
    ...data.assistants.map((name) => `- ${name}`),
    '\nUzman çalışma alanları (başlangıç dahil, bitiş hariç):',
    ...data.locations.filter((location) => location.kind === 'normal').map((location) =>
      `- ${location.site} ${location.name}${location.activeFrom ? `; başlangıç: ${location.activeFrom}` : ''}${location.activeUntil ? `; bitiş: ${location.activeUntil}` : ''}`),
  ].join('\n')

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyMessage(`${label} kopyalandı.`)
    } catch {
      setCopyMessage('Panoya erişilemedi. Talimatları aşağıdan seçerek kopyalayabilir veya indirebilirsin.')
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([instructions, '\n\n', reference], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'klinik-atlas-chatgpt-talimatlari.txt'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const save = async () => {
    if (!preview || stale || !result?.nextState || hasDrafts || saveLock.current) return
    saveLock.current = true
    setBusy(true)
    setMessage('')
    try {
      const saved = await onApply(text, preview.baseState)
      setMessage(saved.message)
      if (saved.ok) { setText(''); setPreview(null) }
    } catch {
      setMessage('Kayıt tamamlanamadı. Metin korundu; bulut durumunu kontrol edip yeniden önizle.')
    } finally {
      saveLock.current = false
      setBusy(false)
    }
  }

  return (
    <section className="card fade-up bulk-import-panel" aria-labelledby="bulk-import-heading">
      <div className="bulk-import-heading">
        <div><p className="eyebrow">Tek proje · Tek giriş</p><h2 id="bulk-import-heading">Toplu Veri Girişi</h2></div>
        <span className="bulk-import-badge">5 kayıt türü</span>
      </div>
      <p className="subtext">ChatGPT projesinde hazırladığın nöbet, izin, uzman ve rotasyoner listesini buraya yapıştır. Farklı türler ve tarihler aynı metinde olabilir.</p>
      <details className="bulk-import-guide">
        <summary>ChatGPT projesini bir kez hazırla</summary>
        <ol>
          <li>ChatGPT’de tek bir proje aç. “Proje Talimatlarını Kopyala” ile aldığın metni projenin talimatlarına ekle.</li>
          <li>“Güncel Referansı Kopyala” ile asistan ve alan listesini projeye gönder. Bu listeler değiştiğinde referansı yenile.</li>
          <li>Çalışma listelerini aynı projeye gönder. Gelen çıktının tamamını aşağıdaki alana yapıştır.</li>
        </ol>
        <div className="bulk-import-actions">
          <button type="button" className="secondary" onClick={() => void copy(instructions, 'Proje talimatları')}>Proje Talimatlarını Kopyala</button>
          <button type="button" className="ghost-button" onClick={() => void copy(reference, 'Güncel referans')}>Güncel Referansı Kopyala</button>
          <button type="button" className="ghost-button" onClick={download}>Talimat ve Referansı İndir</button>
        </div>
        <p role="status" className="hint-text">{copyMessage}</p>
        <details><summary>Talimat metnini göster</summary><pre className="bulk-import-instructions" tabIndex={0}>{instructions}{'\n\n'}{reference}</pre></details>
      </details>
      <label className="bulk-import-label" htmlFor="bulk-import-text">ChatGPT çıktısı</label>
      <textarea id="bulk-import-text" value={text} disabled={busy} spellCheck={false} onChange={(event) => { setText(event.target.value); setMessage('') }}
        placeholder={'ASISTAN_NOBET | 2026-11-09 | Aslınur | Çekmeköy\nIZIN_ROTASYON | 2026-11-09 | Azmi | Yıllık İzin\nUZMAN_CALISMA | 2026-11-09 | Sami Yarkın Sözüer | Sancaktepe Ameliyathane 1\nUZMAN_NOBET | 2026-11-09 | Murat Öksüz | Çekmeköy\nROTASYONER | 2026-11-09 | Tahsin'} />
      <div className="bulk-import-actions">
        <button type="button" className="secondary" disabled={busy || !text.trim()} onClick={() => { setPreview({ result: prepareBulkImport(text, data, rules), text, baseState: data }); setMessage('') }}>Kontrol Et ve Önizle</button>
        <span className="hint-text">Kaydetmeden önce tüm kayıtları inceleyebilirsin.</span>
      </div>
      {message ? <p className="notice" role="status">{message}</p> : null}
      {hasDrafts ? <p className="notice warning">Planlamada veya alanlarda açık taslak var. Toplu kayıt için önce taslağı kaydet veya iptal et.</p> : null}
      {stale ? <p className="notice warning" role="status">Metin veya mevcut kayıtlar değişti. Kaydetmeden önce yeniden önizle.</p> : null}
      {result && !stale ? <div className="bulk-import-preview">
        <h3>Aktarım önizlemesi</h3>
        <div className="bulk-import-counts">{Object.entries(IMPORT_LABELS).map(([kind, label]) => {
          const count = result.rows.filter((row) => row.kind === kind).length
          return count ? <span key={kind}><strong>{count}</strong> {label}</span> : null
        })}</div>
        {result.duplicateCount ? <p className="hint-text">{result.duplicateCount} aynı satır tekrarı tek kayıt olarak alındı.</p> : null}
        {result.issues.length ? <div className="import-issue-card" role="alert"><h3>{result.issues.length} sorun — kayıt yapılmadı</h3><ul>{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
        {result.rows.length ? <div className="bulk-import-table-wrap" tabIndex={0} role="region" aria-label="Aktarılacak kayıtlar"><table className="bulk-import-table">
          <thead><tr><th scope="col">Satır</th><th scope="col">Tür</th><th scope="col">Tarih</th><th scope="col">Kişi</th><th scope="col">Alan / durum</th></tr></thead>
          <tbody>{result.rows.map((row) => <tr key={row.line}><td>{row.line}</td><td>{IMPORT_LABELS[row.kind]}</td><td>{row.day}</td><td>{row.name}</td><td>{row.value || 'Günlük rotasyoner havuzu'}</td></tr>)}</tbody>
        </table></div> : null}
        <p className="hint-text">Asistan nöbeti, uzman çalışma ve rotasyoner kayıtları mevcut listeyle birleşir. İzin / rotasyon, kişinin o günkü atamasını değiştirir. Uzman nöbeti ilgili günün tam listesini değiştirir.</p>
        {result.effects.length ? <div className="bulk-import-effects"><h4>Mevcut kayıtlara etkisi</h4><ul>{result.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul></div> : null}
        <button type="button" disabled={busy || hasDrafts || !result.nextState} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : `${result.rows.length} Kaydı Onayla ve Kaydet`}</button>
      </div> : null}
    </section>
  )
}
