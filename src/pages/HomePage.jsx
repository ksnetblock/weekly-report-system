import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, FolderTree, Layers, Settings2, FileText, Images } from 'lucide-react'
import * as api from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import GalleryModal from '../components/GalleryModal.jsx'

// 홈 — 그룹과 각 그룹에 속한 프로젝트의 정의·상세 설명 (읽기 전용)
export default function HomePage({ onAuthError }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])
  const [projectMeta, setProjectMeta] = useState([])
  const [projectImages, setProjectImages] = useState([])
  const [galleryGid, setGalleryGid] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { groups, projectMeta, projectImages } = await api.getManualLayer()
      setGroups(groups)
      setProjectMeta(projectMeta)
      setProjectImages(projectImages)
    } catch (e) {
      onAuthError(e)
      toast('불러오기 실패', e.message, 'warning')
    } finally {
      setLoading(false)
    }
  }, [toast, onAuthError])

  useEffect(() => { load() }, [load])

  // 그룹별 프로젝트 묶기
  const projectsByGroup = useMemo(() => {
    const map = new Map(groups.map((g) => [g.id, []]))
    for (const p of projectMeta) {
      if (p.group_id && map.has(p.group_id)) map.get(p.group_id).push(p)
    }
    return map
  }, [groups, projectMeta])

  // asana_gid → 참고 이미지 목록
  const imagesByGid = useMemo(() => {
    const map = new Map()
    for (const img of projectImages) {
      if (!map.has(img.asana_gid)) map.set(img.asana_gid, [])
      map.get(img.asana_gid).push(img)
    }
    return map
  }, [projectImages])

  const galleryProject = useMemo(
    () => projectMeta.find((p) => p.asana_gid === galleryGid) || null,
    [projectMeta, galleryGid]
  )

  const assignedCount = useMemo(
    () => projectMeta.filter((p) => p.group_id).length,
    [projectMeta]
  )

  const displayName = (p) => p.display_name || p.name || '(이름 없음)'

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> 불러오는 중...
      </main>
    )
  }

  return (
    <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* 소개 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">프로젝트 그룹 안내</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              각 그룹의 정의와, 그룹에 속한 프로젝트들의 상세 설명입니다.<br />
              그룹과 배정은 <Link to="/groups" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">그룹 관리</Link>에서,
              일정(간트)은 <Link to="/schedule" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">일정</Link>에서 확인하세요.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Stat Icon={FolderTree} label="그룹" value={groups.length} />
            <Stat Icon={Layers} label="배정된 프로젝트" value={assignedCount} />
          </div>
        </div>
      </div>

      {/* 그룹이 없을 때 */}
      {groups.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center py-20 text-center">
          <FolderTree className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">아직 그룹이 없습니다.</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">그룹 관리에서 그룹을 만들고 프로젝트를 배정하세요.</p>
          <Link to="/groups" className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-md">
            <Settings2 className="w-4 h-4" /> 그룹 관리로 이동
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const projects = projectsByGroup.get(g.id) || []
            return (
              <section key={g.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                {/* 그룹 헤더 */}
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700"
                  style={{ borderLeft: `4px solid ${g.color || '#6366f1'}` }}>
                  <div className="flex items-center gap-2.5">
                    <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: g.color || '#6366f1' }} />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{g.name}</h3>
                    <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                      프로젝트 {projects.length}
                    </span>
                  </div>
                  {g.description
                    ? <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap">{g.description}</p>
                    : <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 italic">설명이 없습니다.</p>}
                </div>

                {/* 프로젝트 목록 */}
                <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
                  {projects.length === 0 ? (
                    <p className="px-6 py-5 text-sm text-slate-400 dark:text-slate-500">배정된 프로젝트가 없습니다.</p>
                  ) : (
                    projects.map((p) => {
                      const imgs = imagesByGid.get(p.asana_gid) || []
                      return (
                        <div key={p.asana_gid} className="px-6 py-4 flex items-start gap-3">
                          <div className="mt-0.5 w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 flex-shrink-0 flex items-center justify-center overflow-hidden">
                            {p.icon_url
                              ? <img src={p.icon_url} alt="" className="w-full h-full object-cover" />
                              : <FileText className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{displayName(p)}</p>
                            {p.description
                              ? <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed whitespace-pre-wrap">{p.description}</p>
                              : <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">설명이 없습니다.</p>}
                          </div>
                          {imgs.length > 0 && (
                            <button onClick={() => setGalleryGid(p.asana_gid)} title="참고 이미지 보기"
                              className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 mt-0.5 bg-slate-100 dark:bg-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-md text-xs font-semibold">
                              <Images className="w-3.5 h-3.5" /> {imgs.length}
                            </button>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {galleryGid && (
        <GalleryModal
          title={`${galleryProject?.display_name || galleryProject?.name || '프로젝트'} — 참고 이미지`}
          images={imagesByGid.get(galleryGid) || []}
          initialIndex={0}
          onClose={() => setGalleryGid(null)}
        />
      )}
    </main>
  )
}

function Stat({ Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
      <Icon className="w-4 h-4" />
      <span className="font-bold text-slate-800 dark:text-slate-100">{value}</span>
      <span className="text-xs">{label}</span>
    </div>
  )
}
