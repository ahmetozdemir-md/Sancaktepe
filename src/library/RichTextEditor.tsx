import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { matchingRichText, plainRichText, richTextLink, richTextToPlain, sanitizeRichText, type RichTextDocument } from './richText'
import RichTextToolbar from './RichTextToolbar'

const extensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, horizontalRule: false,
    link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: (value) => Boolean(richTextLink(value)) } }),
  TextStyle, Color, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
]
interface Props {
  text: string
  document?: RichTextDocument | null
  onChange: (text: string, document: RichTextDocument) => void
  label: string
  disabled?: boolean
  compact?: boolean
  autoFocus?: boolean
  onReady?: (editor: Editor | null) => void
}
export default function RichTextEditor({ text, document, onChange, label, disabled = false, compact = false, autoFocus = false, onReady }: Props) {
  const editor = useEditor({
    extensions, content: matchingRichText(text, document) ?? plainRichText(text), editable: !disabled,
    immediatelyRender: false, shouldRerenderOnTransaction: false, autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', class: 'library-rich-content library-rich-input', spellcheck: 'true' } },
    onUpdate: ({ editor: current }) => {
      const richText = sanitizeRichText(current.getJSON())
      if (richText) onChange(richTextToPlain(richText), richText)
      else {
        // Preserve pasted content even when its formatting exceeds the document budget.
        const plain = current.getText({ blockSeparator: '\n' })
        onChange(plain, plainRichText(plain))
      }
    },
  })
  useEffect(() => { editor?.setEditable(!disabled) }, [editor, disabled])
  useEffect(() => { onReady?.(editor); return () => onReady?.(null) }, [editor, onReady])
  useEffect(() => {
    if (!editor) return
    const content = matchingRichText(text, document) ?? plainRichText(text)
    if (JSON.stringify(sanitizeRichText(editor.getJSON())) !== JSON.stringify(content)) editor.commands.setContent(content, { emitUpdate: false })
  }, [editor, text, document])
  const limit = compact ? 2000 : 20000
  return <div className={`library-rich-editor${compact ? ' is-cell-editor' : ''}`}>
    {!compact ? <RichTextToolbar editor={editor} /> : null}
    <EditorContent editor={editor} />
    {!compact ? <p className="library-rich-hint">Yazıyı seçip biçimlendir. Kalın yazıyı normale döndürmek için B’ye tekrar bas; Tₓ seçili yazının biçimini temizler.</p> : null}
    {text.length > limit ? <p className="notice warning" role="alert">Bu alan en fazla {limit.toLocaleString('tr-TR')} karakter olabilir. Kaydetmeden önce kısalt.</p> : null}
  </div>
}
