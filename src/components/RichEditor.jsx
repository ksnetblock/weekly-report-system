import { forwardRef, useImperativeHandle } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3, List, ListOrdered, Quote, Undo2, Redo2, Eraser,
} from 'lucide-react'

// Tiptap 리치텍스트 에디터 — 주간보고 우측 편집기
// ref: { getHTML(), setContent(html), insertLine(html), focus() }
const RichEditor = forwardRef(function RichEditor({ initialHTML = '', onChange, placeholder }, ref) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Placeholder.configure({ placeholder: placeholder || '내용을 입력하세요...' }),
    ],
    content: initialHTML || '',
    editorProps: {
      attributes: {
        class: 'rich-content focus:outline-none min-h-full px-4 py-3 text-sm text-slate-800 dark:text-slate-100',
      },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  })

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() ?? '',
    setContent: (html) => editor?.commands.setContent(html || ''),
    insertLine: (html) => editor?.chain().focus('end').insertContent(html).run(),
    focus: () => editor?.chain().focus().run(),
  }), [editor])

  if (!editor) return null

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Toolbar editor={editor} />
      <div className="flex-1 min-h-[50vh] max-h-[70vh] lg:min-h-0 lg:max-h-none overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  )
})

function Toolbar({ editor }) {
  const btn = (active) =>
    `p-1.5 rounded-md transition ${active
      ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300'
      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-slate-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
      <TB onClick={() => editor.chain().focus().toggleBold().run()} cls={btn(editor.isActive('bold'))} title="굵게"><Bold className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().toggleItalic().run()} cls={btn(editor.isActive('italic'))} title="기울임"><Italic className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().toggleUnderline().run()} cls={btn(editor.isActive('underline'))} title="밑줄"><UnderlineIcon className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().toggleStrike().run()} cls={btn(editor.isActive('strike'))} title="취소선"><Strikethrough className="w-4 h-4" /></TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} cls={btn(editor.isActive('heading', { level: 1 }))} title="제목 1"><Heading1 className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} cls={btn(editor.isActive('heading', { level: 2 }))} title="제목 2"><Heading2 className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} cls={btn(editor.isActive('heading', { level: 3 }))} title="제목 3"><Heading3 className="w-4 h-4" /></TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().toggleBulletList().run()} cls={btn(editor.isActive('bulletList'))} title="글머리 기호"><List className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().toggleOrderedList().run()} cls={btn(editor.isActive('orderedList'))} title="번호 목록"><ListOrdered className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().toggleBlockquote().run()} cls={btn(editor.isActive('blockquote'))} title="인용"><Quote className="w-4 h-4" /></TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().undo().run()} cls={btn(false)} title="실행 취소"><Undo2 className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().redo().run()} cls={btn(false)} title="다시 실행"><Redo2 className="w-4 h-4" /></TB>
      <TB onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} cls={btn(false)} title="서식 지우기"><Eraser className="w-4 h-4" /></TB>
    </div>
  )
}

function TB({ onClick, cls, title, children }) {
  return <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cls} title={title}>{children}</button>
}

function Divider() {
  return <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
}

export default RichEditor
