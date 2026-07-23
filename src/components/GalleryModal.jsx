import { useState } from 'react'
import { ImagePlus, Trash2, ChevronLeft, ChevronRight, Loader2, Images } from 'lucide-react'
import Modal from './Modal.jsx'

// 프로젝트 참고 이미지 갤러리 — 그리드로 보여주고 클릭하면 라이트박스로 확대.
// editable=true면 업로드 타일 + 삭제 버튼 표시(그룹 관리), false면 보기 전용(홈).
// initialIndex를 주면 그리드를 거치지 않고 바로 해당 이미지의 라이트박스로 연다(홈에서 사용).
export default function GalleryModal({ title, images, editable = false, initialIndex = null, onUpload, onDelete, onClose }) {
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [lightboxIdx, setLightboxIdx] = useState(initialIndex)

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    for (const f of files) await onUpload(f)
    setUploading(false)
  }

  async function handleDelete(img, ev) {
    ev.stopPropagation()
    setDeletingId(img.id)
    await onDelete(img.id)
    setDeletingId(null)
    setLightboxIdx(null)
  }

  const current = lightboxIdx !== null ? images[lightboxIdx] : null

  return (
    <Modal title={title} onClose={onClose} maxW="max-w-4xl">
      <div className="p-6">
        {current ? (
          <div className="space-y-3">
            <div className="relative bg-slate-100 dark:bg-slate-900 rounded-lg flex items-center justify-center min-h-[420px] max-h-[80vh] overflow-hidden">
              <img src={current.url} alt={current.caption || ''} className="max-w-full max-h-[80vh] object-contain" />
              {images.length > 1 && (
                <>
                  <button onClick={() => setLightboxIdx((i) => (i - 1 + images.length) % images.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/80 dark:bg-slate-800/80 rounded-full shadow hover:bg-white dark:hover:bg-slate-700">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button onClick={() => setLightboxIdx((i) => (i + 1) % images.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/80 dark:bg-slate-800/80 rounded-full shadow hover:bg-white dark:hover:bg-slate-700">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs font-semibold">
                    {lightboxIdx + 1} / {images.length}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center justify-between">
              <button onClick={() => setLightboxIdx(null)}
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-semibold">
                ← 목록으로
              </button>
              {editable && (
                <button onClick={(ev) => handleDelete(current, ev)} disabled={deletingId === current.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-50 rounded-lg text-sm font-semibold">
                  {deletingId === current.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} 삭제
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {images.length === 0 && !editable && (
              <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400 dark:text-slate-500">
                <Images className="w-10 h-10 mb-2" />
                <p className="text-sm">업로드된 참고 이미지가 없습니다.</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.map((img, i) => (
                <div key={img.id}
                  className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer bg-slate-50 dark:bg-slate-900"
                  onClick={() => setLightboxIdx(i)}>
                  <img src={img.url} alt={img.caption || ''} className="w-full h-full object-cover" />
                  {editable && (
                    <button onClick={(ev) => handleDelete(img, ev)} disabled={deletingId === img.id}
                      title="이미지 삭제"
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/60 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100">
                      {deletingId === img.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              ))}
              {editable && (
                <label
                  className="aspect-square rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:text-indigo-500 hover:border-indigo-400 flex flex-col items-center justify-center gap-1 cursor-pointer">
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden"
                    onChange={handleFiles} disabled={uploading} />
                  {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
                  <span className="text-[11px] font-semibold">이미지 추가</span>
                </label>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
