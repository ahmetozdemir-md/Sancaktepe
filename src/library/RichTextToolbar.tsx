import { useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { richTextColor, richTextLink } from './richText'

const TEXT_COLORS = [['Koyu', '#122a2b'], ['Yeşil', '#08765f'], ['Mavi', '#245a9c'], ['Mor', '#7544a4'], ['Kırmızı', '#b93832'], ['Turuncu', '#9b560e'], ['Gri', '#627571'], ['Beyaz', '#ffffff']]
const HIGHLIGHTS = [['Sarı', '#fff0bf'], ['Yeşil', '#dcefe1'], ['Mavi', '#dcecff'], ['Pembe', '#f9dce7'], ['Mor', '#ede1f7'], ['Turuncu', '#ffe2cc']]

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="library-format-tool" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>
}
export default function RichTextToolbar({ editor, compact = false }: { editor: Editor | null; compact?: boolean }) {
  const [panel, setPanel] = useState<'color' | 'highlight' | 'link' | null>(null)
  const [custom, setCustom] = useState('#08765f')
  const [url, setUrl] = useState('')
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), strike: current.isActive('strike'),
    bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), quote: current.isActive('blockquote'), link: current.isActive('link'),
    style: current.isActive('heading', { level: 2 }) ? 'h2' : current.isActive('heading', { level: 3 }) ? 'h3' : 'p',
    align: current.isActive({ textAlign: 'center' }) ? 'center' : current.isActive({ textAlign: 'right' }) ? 'right' : 'left',
    color: richTextColor(current.getAttributes('textStyle').color), highlight: richTextColor(current.getAttributes('highlight').color),
    canUndo: current.can().undo(), canRedo: current.can().redo(), editable: current.isEditable,
  } : null })
  const disabled = !editor || editor.isDestroyed || !state?.editable
  const applyColor = (color?: string) => {
    if (disabled) return
    if (panel === 'highlight') { if (color) editor.chain().focus().setHighlight({ color }).run(); else editor.chain().focus().unsetHighlight().run() }
    else { if (color) editor.chain().focus().setColor(color).run(); else editor.chain().focus().unsetColor().run() }
  }
  return <div className="library-rich-tools" onKeyDown={(event) => { if (event.key === 'Escape') { setPanel(null); editor?.commands.focus() } }}>
    <div className="library-rich-toolbar" role="group" aria-label={compact ? 'Hücre yazısı biçimlendirme' : 'Metin biçimlendirme'}>
      {!compact ? <select aria-label="Metin stili" disabled={disabled} value={state?.style ?? 'p'} onChange={(event) => { if (event.target.value === 'p') editor?.chain().focus().setParagraph().run(); else editor?.chain().focus().setHeading({ level: event.target.value === 'h2' ? 2 : 3 }).run() }}><option value="p">Normal metin</option><option value="h2">Başlık</option><option value="h3">Alt başlık</option></select> : null}
      <div className="library-tool-group">
        <Tool label="Kalın (Ctrl/⌘ B)" active={state?.bold} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></Tool>
        <Tool label="İtalik (Ctrl/⌘ I)" active={state?.italic} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></Tool>
        <Tool label="Altı çizili (Ctrl/⌘ U)" active={state?.underline} disabled={disabled} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></Tool>
        <Tool label="Üstü çizili" active={state?.strike} disabled={disabled} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></Tool>
      </div>
      <div className="library-tool-group">
        <Tool label="Yazı rengi" active={panel === 'color'} disabled={disabled} onClick={() => { setPanel(panel === 'color' ? null : 'color'); setCustom(state?.color ?? '#08765f') }}><span className="library-text-color-icon" style={{ borderColor: state?.color ?? '#08765f' }}>A</span></Tool>
        <Tool label="Vurgu rengi" active={panel === 'highlight'} disabled={disabled} onClick={() => { setPanel(panel === 'highlight' ? null : 'highlight'); setCustom(state?.highlight ?? '#fff0bf') }}><span className="library-highlight-icon" style={{ background: state?.highlight ?? '#fff0bf' }}>A</span></Tool>
        <Tool label="Bağlantı" active={state?.link || panel === 'link'} disabled={disabled} onClick={() => { setPanel(panel === 'link' ? null : 'link'); setUrl(editor?.getAttributes('link').href ?? '') }}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m10 13 4-4m-7 6-2 2a4 4 0 0 0 6 6l4-4a4 4 0 0 0-1-6m3-4 2-2a4 4 0 0 0-6-6L9 5a4 4 0 0 0 1 6" transform="translate(0 -2)" /></svg></Tool>
      </div>
      {!compact ? <div className="library-tool-group">
        <Tool label="Madde işaretli liste" active={state?.bullet} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• ≡</Tool>
        <Tool label="Numaralı liste" active={state?.ordered} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. ≡</Tool>
        <Tool label="Alıntı / not" active={state?.quote} disabled={disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❝</Tool>
        <select aria-label="Metin hizalama" disabled={disabled} value={state?.align ?? 'left'} onChange={(event) => editor?.chain().focus().setTextAlign(event.target.value).run()}><option value="left">Sola</option><option value="center">Ortala</option><option value="right">Sağa</option></select>
      </div> : null}
      <div className="library-tool-group library-history-tools">
        <Tool label="Biçimi temizle" disabled={disabled} onClick={() => editor?.chain().focus().unsetAllMarks().run()}>Tₓ</Tool>
        <Tool label="Geri al (Ctrl/⌘ Z)" disabled={disabled || !state?.canUndo} onClick={() => editor?.chain().focus().undo().run()}>↶</Tool>
        <Tool label="Yinele (Ctrl/⌘ Shift Z)" disabled={disabled || !state?.canRedo} onClick={() => editor?.chain().focus().redo().run()}>↷</Tool>
      </div>
    </div>
    {panel && !disabled ? <div className="library-format-popover" role="group" aria-label={panel === 'link' ? 'Bağlantı düzenleme' : panel === 'color' ? 'Yazı rengi seçimi' : 'Vurgu rengi seçimi'}>
      <div className="library-format-popover-heading"><strong>{panel === 'link' ? 'Seçili yazıya bağlantı' : panel === 'color' ? 'Seçili yazının rengi' : 'Seçili yazının vurgusu'}</strong><button type="button" className="library-small-button" aria-label="Biçim panelini kapat" onClick={() => setPanel(null)}>×</button></div>
      {panel === 'link' ? <div className="library-link-controls"><input aria-label="Bağlantı adresi" type="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} /><button type="button" className="library-small-button" disabled={!richTextLink(url)} onClick={() => { editor.chain().focus().extendMarkRange('link').setLink({ href: richTextLink(url)! }).run(); setPanel(null) }}>Uygula</button><button type="button" className="library-small-button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setPanel(null) }}>Bağlantıyı kaldır</button></div> : <>
        <div className="library-rich-palette">{(panel === 'color' ? TEXT_COLORS : HIGHLIGHTS).map(([name, color]) => <button type="button" key={color} title={name} aria-label={name} aria-pressed={(panel === 'color' ? state?.color : state?.highlight) === color} style={{ backgroundColor: color }} onMouseDown={(event) => event.preventDefault()} onClick={() => { setCustom(color); applyColor(color) }} />)}</div>
        <div className="library-rich-custom"><label>Özel renk<input aria-label="Metin özel renk seçici" type="color" value={richTextColor(custom) ?? '#08765f'} onChange={(event) => { setCustom(event.target.value); applyColor(event.target.value) }} /></label><input aria-label="Metin özel renk kodu" spellCheck={false} value={custom} maxLength={7} onChange={(event) => setCustom(event.target.value)} /><button type="button" className="library-small-button" disabled={!richTextColor(custom)} onClick={() => applyColor(richTextColor(custom))}>Uygula</button><button type="button" className="library-small-button" onClick={() => applyColor()}>Rengi kaldır</button></div>
      </>}
    </div> : null}
  </div>
}
