/**
 * 文件库
 *
 * 按格式分类展示文件，支持日期筛选、缩略图预览。
 */
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, FileEdit, FileImage, FileText, FileType, Folder, FolderOpen, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

interface FileEntry {
  name: string
  path: string
  ext: string
  size: number
  createdAt: string
  isDir: boolean
}

const CATEGORIES: Record<string, { label: string; icon: any; exts: string[] }> = {
  image: { label: '图片', icon: FileImage, exts: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif', 'avif'] },
  doc: { label: '文档', icon: FileText, exts: ['txt', 'md', 'markdown', 'pdf', 'doc', 'docx', 'csv', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'log', 'rtf'] },
  code: { label: '代码', icon: FileType, exts: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'html', 'htm', 'css', 'scss', 'less', 'sass', 'sql', 'sh', 'bash', 'zsh', 'lua', 'rb', 'php', 'swift', 'kt', 'dart', 'vue', 'svelte', 'astro', 'pl', 'pm', 'r', 'm', 'ex', 'exs', 'erl', 'hs', 'clj', 'tf', 'gradle', 'makefile', 'cmake', 'dockerfile', 'env', 'gitignore', 'editorconfig'] },
  video: { label: '视频', icon: FileType, exts: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'f4v', 'wmv', 'm4v', '3gp', 'ogv'] },
  audio: { label: '音频', icon: FileType, exts: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus', 'mid', 'midi'] },
  other: { label: '其他', icon: FileType, exts: [] },
}

function getCat(ext: string): string {
  for (const [k, c] of Object.entries(CATEGORIES)) if (c.exts.includes(ext)) return k
  return 'other'
}

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i < 2 ? 0 : 1)} ${u[i]}`
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('zh-CN') } catch { return iso.slice(0, 10) }
}

/** file:// URL（用于视频/音频预览，cs-vfs 不支持流媒体 Range 请求） */
function fileUrl(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/^(\w:)/, '/$1')
  return `file://${normalized}`
}
/** cs-vfs://path/ URL（用于图片预览和聊天图片） */
function vfsUrl(p: string): string {
  return `cs-vfs://path/${encodeURIComponent(p.replace(/\\/g, '/'))}`
}

const STORAGE_KEY = 'filelib_path'
const getPath = async () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) return saved.replace(/\\/g, '/')
  // 首次使用：从 FileVault 获取默认路径
  try {
    const vaultRoot = await window.electron?.ipcRenderer?.invoke('vault:get-root')
    if (vaultRoot) return vaultRoot.replace(/\\/g, '/')
  } catch { /* ok */ }
  return ''
}

const FileLibPage: FC = () => {
  const navigate = useNavigate()
  const [basePath, setBasePath] = useState('')
  const [initDone, setInitDone] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => { getPath().then((p) => { setBasePath(p); setInitDone(true) }) }, [])
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [dateFilter, setDateFilter] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null)
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')

  // 监听文件变更事件自动刷新
  useEffect(() => {
    const cleanup = window.electron?.ipcRenderer?.on('file:file-added', (_event, count: number) => {
      setRefreshKey((k) => k + 1)
      window.toast?.success?.(`截图已保存 ${count || 1} 张`)
    })
    return () => cleanup?.()
  }, [])

  // 读取文件列表
  const load = useCallback(async () => {
    if (!basePath) { setFiles([]); return }
    setLoading(true)
    try {
      const listFn = (window as any).api?.file?.listDirectory
      if (typeof listFn !== 'function') { setFiles([]); setLoading(false); return }
      const names: string[] = await listFn(basePath, { maxEntries: 5000, recursive: false }) || []
      const result: FileEntry[] = []
      for (const fullPathRaw of names) {
        // listDirectory 返回完整路径，如 C:\Users\...\file.png
        const fullPath = fullPathRaw.replace(/\\/g, '/')
        const fileName = fullPath.split('/').pop() || fullPath
        if (fileName.startsWith('.')) continue
        const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
        let size = 0, createdAt = '', isDir = false
        try {
          const meta = await (window as any).api?.file?.get(fullPath)
          if (meta) { size = meta.size || 0; createdAt = meta.created_at || '' }
        } catch { /* ok */ }
        try {
          isDir = await (window as any).api?.file?.isDirectory(fullPath)
        } catch { /* ok */ }
        result.push({ name: fileName, path: fullPath, ext, size, createdAt, isDir })
      }
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setFiles(result)
    } catch { /* ok */ }
    setLoading(false)
  }, [basePath, refreshKey])

  useEffect(() => { load() }, [load])

  const handleSelectPath = useCallback(async () => {
    const sel = (window as any).api?.file?.selectFolder
    if (typeof sel === 'function') {
      const p = await sel({ title: '选择文件库目录' })
      if (p) {
        const normalized = p.replace(/\\/g, '/')
        setBasePath(normalized)
        setRefreshKey((k) => k + 1) // 强制刷新（选同一目录也重新加载）
        localStorage.setItem(STORAGE_KEY, normalized)
        try { window.electron?.ipcRenderer?.invoke('app:set-filelib-path', normalized) } catch { /* ok */ }
        // 同步更新 FileVault 根目录，使截图保存到同一文件夹
        try { window.electron?.ipcRenderer?.invoke('vault:set-root', normalized) } catch { /* ok */ }
      }
    }
  }, [])

  // 分类
  const grouped = useMemo(() => {
    let list = files
    if (dateFilter) {
      list = list.filter((f) => f.createdAt?.startsWith(dateFilter))
    }
    const groups: { key: string; label: string; icon: any; items: FileEntry[] }[] = []
    for (const [key, cat] of Object.entries(CATEGORIES)) {
      const items = list.filter((f) => !f.isDir && getCat(f.ext) === key)
      if (items.length > 0) groups.push({ key, ...cat, items })
    }
    const dirs = list.filter((f) => f.isDir)
    if (dirs.length > 0) groups.unshift({ key: '_dirs', label: '文件夹', icon: Folder, items: dirs })
    return groups
  }, [files, dateFilter])

  // 文件预览
  const handlePreview = useCallback(async (item: FileEntry) => {
    if (item.isDir) return
    setPreviewFile(item)
    setEditMode(false)
    setPreviewLoading(true)
    setPreviewContent('')
    try {
      const isText = (window as any).api?.file?.isTextFile
      const readFn = (window as any).api?.file?.readExternal
      if (typeof isText === 'function' && await isText(item.path) && typeof readFn === 'function') {
        const content = await readFn(item.path)
        setPreviewContent(content || '')
      }
    } catch { /* not a text file or read error */ }
    setPreviewLoading(false)
  }, [])

  const toggleExpand = (key: string) => {
    setExpanded((p) => p.includes(key) ? p.filter((k) => k !== key) : [...p, key])
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0)

  // 收集可用日期
  const availableDates = useMemo(() => {
    const s = new Set<string>()
    files.forEach((f) => {
      if (f.createdAt) s.add(f.createdAt.slice(0, 7))
    })
    return [...s].sort().reverse()
  }, [files])

  return (
    <Root>
      <Header>
        <BackBtn onClick={() => navigate('/')}><ArrowLeft size={18} /></BackBtn>
        <Title>📂 文件库</Title>
        <Badge>{files.length} 项</Badge>
        {totalSize > 0 && <Badge>{fmtSize(totalSize)}</Badge>}
        <PathBar>
          <PathInput value={basePath} readOnly placeholder="未设置路径" />
          <ActBtn onClick={handleSelectPath}>选择目录</ActBtn>
        </PathBar>
      </Header>
      {basePath && basePath !== getPath() && (
        <NavBar>
          <NavBtn onClick={() => setBasePath(getPath())}>⬆ 返回上级</NavBtn>
          <PathDisplay>{basePath.replace(/\\/g, '/')}</PathDisplay>
        </NavBar>
      )}

      <FilterBar>
        <DateSelect value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option value="">全部日期</option>
          {availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
        </DateSelect>
        {dateFilter && <ClrBtn onClick={() => setDateFilter('')}>✕ 清除</ClrBtn>}
      </FilterBar>

      <Body>
        {!basePath ? (
          <Empty>
            <p>请选择文件库目录</p>
            <ActBtn onClick={handleSelectPath}>选择目录</ActBtn>
          </Empty>
        ) : loading ? (
          <Empty>加载中...</Empty>
        ) : grouped.length === 0 ? (
          <Empty>该目录下没有文件</Empty>
        ) : (
          grouped.map((group) => {
            const isOpen = expanded.includes(group.key)
            const Icon = group.icon
            return (
              <Section key={group.key}>
                <SectionHeader onClick={() => toggleExpand(group.key)}>
                  <IconWrap><Icon size={16} /></IconWrap>
                  <SectionTitle>{group.label}</SectionTitle>
                  <SectionCount>{group.items.length} 项</SectionCount>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </SectionHeader>
                {isOpen && (
                  <SectionBody>
                    {group.key !== '_dirs' ? (
                      group.items.map((item) => (
                        <Row key={item.path} $clickable onClick={() => handlePreview(item)}>
                          <RowIcon>{group.key === 'image' ? <FileImage size={15} /> : <Icon size={15} />}</RowIcon>
                          <RowName>{item.name}</RowName>
                          <RowSize>{fmtSize(item.size)}</RowSize>
                          <RowDate>{fmtDate(item.createdAt)}</RowDate>
                          <RowDel onClick={(e) => { e.stopPropagation(); setDeleteTarget(item) }}>✕</RowDel>
                        </Row>
                      ))
                    ) : (
                      // 文件夹：点击可进入
                      group.items.map((item) => (
                        <Row key={item.path} $clickable onClick={() => setBasePath(item.path)}>
                          <RowIcon><Folder size={15} /></RowIcon>
                          <RowName>{item.name}</RowName>
                          <RowSize />
                          <RowDate />
                        </Row>
                      ))
                    )}
                  </SectionBody>
                )}
              </Section>
            )
          })
        )}
      </Body>

      {/* 文件预览面板 */}
      {previewFile && (
        <PreviewOverlay onClick={() => { setPreviewFile(null); setEditMode(false) }}>
          <PreviewPanel onClick={(e) => e.stopPropagation()}>
            <PreviewHeader>
              <PreviewTitleRow>
                <PreviewIcon>{['png','jpg','jpeg','gif','svg','webp'].includes(previewFile.ext) ? <FileImage size={18} /> : <FileText size={18} />}</PreviewIcon>
                <PreviewName>{previewFile.name}</PreviewName>
              </PreviewTitleRow>
              <PreviewClose onClick={() => { setPreviewFile(null); setEditMode(false) }}>✕</PreviewClose>
            </PreviewHeader>
            <PreviewPath>{previewFile.path.replace(/\\/g, '/')}</PreviewPath>
            <PreviewActions>
              <PActionBtn onClick={() => { (window as any).api?.file?.openPath(previewFile.path) }}>
                <ExternalLink size={14} /> 打开文件
              </PActionBtn>
              <PActionBtn onClick={() => { (window as any).api?.file?.showInFolder(previewFile.path) }}>
                <FolderOpen size={14} /> 在文件夹中显示
              </PActionBtn>
              {previewContent !== undefined && !editMode && (
                <PActionBtn onClick={() => { setEditContent(previewContent); setEditMode(true) }}>
                  <FileEdit size={14} /> 编辑
                </PActionBtn>
              )}
              {editMode && (
                <PActionBtn $primary onClick={async () => {
                  try {
                    await (window as any).api?.file?.write(previewFile!.path, editContent)
                    setPreviewContent(editContent)
                    setEditMode(false)
                    window.toast?.success?.('已保存')
                  } catch { window.toast?.error?.('保存失败') }
                }}>
                  <FileEdit size={14} /> 保存
                </PActionBtn>
              )}
            </PreviewActions>
            <PreviewBody>
              {previewLoading ? (
                <PreviewEmpty>加载中...</PreviewEmpty>
              ) : ['png','jpg','jpeg','gif','svg','webp','bmp','ico','tiff','tif','avif'].includes(previewFile.ext) ? (
                <img src={`${vfsUrl(previewFile.path)}`} alt={previewFile.name} style={{ maxWidth: '100%', borderRadius: 6, background: 'var(--color-background-mute)' }} />
              ) : ['mp4','avi','mov','mkv','webm','flv','f4v','wmv','m4v','3gp','ogv'].includes(previewFile.ext) ? (
                <video controls style={{ width: '100%', borderRadius: 6 }}>
                  <source src={`${fileUrl(previewFile.path)}`} />
                </video>
              ) : ['mp3','wav','ogg','flac','aac'].includes(previewFile.ext) ? (
                <audio controls style={{ width: '100%' }}>
                  <source src={`${fileUrl(previewFile.path)}`} />
                </audio>
              ) : ['pdf'].includes(previewFile.ext) ? (
                <embed src={`${vfsUrl(previewFile.path)}`} type="application/pdf" style={{ width: '100%', height: 400, borderRadius: 6 }} />
              ) : previewContent ? (
                editMode ? (
                  <PreviewTextarea value={editContent} onChange={(e) => setEditContent(e.target.value)} />
                ) : (
                  <PreviewText>{previewContent}</PreviewText>
                )
              ) : (
                <PreviewInfo>
                  <PreviewInfoRow>文件类型: {previewFile.ext.toUpperCase() || '未知'}</PreviewInfoRow>
                  <PreviewInfoRow>大小: {fmtSize(previewFile.size)}</PreviewInfoRow>
                  <PreviewInfoRow>路径: {previewFile.path}</PreviewInfoRow>
                  <PreviewInfoRow>日期: {fmtDate(previewFile.createdAt)}</PreviewInfoRow>
                  <PreviewInfoNote>该格式暂不支持内联预览，点击"打开文件"查看</PreviewInfoNote>
                </PreviewInfo>
              )}
            </PreviewBody>
          </PreviewPanel>
        </PreviewOverlay>
      )}

      {deleteTarget && (
        <Modal onClick={() => setDeleteTarget(null)}>
          <MPanel onClick={(e) => e.stopPropagation()}>
            <MT>确认删除</MT>
            <MB>确定要删除 <b>{deleteTarget.name}</b> 吗？此操作不可撤销。</MB>
            <MFooter>
              <MCancel onClick={() => setDeleteTarget(null)}>取消</MCancel>
              <MConfirm onClick={async () => {
                try {
                  const fn = deleteTarget.isDir
                    ? (window as any).api?.file?.deleteExternalDir
                    : (window as any).api?.file?.deleteExternalFile
                  if (fn) await fn(deleteTarget.path)
                } catch { /* ok */ }
                setDeleteTarget(null)
                load()
              }}>确认删除</MConfirm>
            </MFooter>
          </MPanel>
        </Modal>
      )}
    </Root>
  )
}

// ---- Styled ----

const Root = styled.div`
  display: flex; flex-direction: column; height: 100%; flex: 1; overflow: hidden;
  background: var(--color-background);
`

const Header = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  border-bottom: 0.5px solid var(--color-border); flex-wrap: wrap;
`

const BackBtn = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 8px; border: none;
  background: transparent; color: var(--color-text); cursor: pointer;
  &:hover { background: var(--color-background-soft); }
`

const Title = styled.h1`
  font-size: 17px; font-weight: 700; color: var(--color-text); margin: 0;
`

const Badge = styled.span`
  font-size: 12px; color: var(--color-text-3);
  background: var(--color-background-soft); padding: 1px 8px; border-radius: 10px;
`

const PathBar = styled.div`
  display: flex; gap: 4px; margin-left: auto; flex: 1; max-width: 380px;
`

const PathInput = styled.input`
  flex: 1; padding: 4px 8px; border-radius: 6px; border: 0.5px solid var(--color-border);
  background: var(--color-background-soft); color: var(--color-text-3);
  font-size: 11px; outline: none; cursor: default;
`

const ActBtn = styled.button`
  padding: 4px 10px; border-radius: 6px; border: none;
  background: var(--color-primary); color: #fff; cursor: pointer; font-size: 12px; white-space: nowrap;
  &:hover { opacity: 0.9; }
`

const FilterBar = styled.div`
  display: flex; gap: 4px; padding: 8px 16px;
  border-bottom: 0.5px solid var(--color-border); align-items: center;
`

const NavBar = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 4px 16px;
  border-bottom: 0.5px solid var(--color-border);
  background: var(--color-background-soft);
`

const NavBtn = styled.button`
  padding: 2px 8px; border-radius: 4px; border: none;
  background: var(--color-background-mute); color: var(--color-primary);
  font-size: 11px; cursor: pointer; white-space: nowrap;
  &:hover { background: var(--color-background-soft); }
`

const PathDisplay = styled.span`
  font-size: 11px; color: var(--color-text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`

// ---- Preview Panel ----

const PreviewOverlay = styled.div`
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
`

const PreviewPanel = styled.div`
  background: var(--color-background);
  border: 0.5px solid var(--color-border);
  border-radius: 12px; width: 640px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  overflow: hidden;
`

const PreviewHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 8px;
`

const PreviewTitleRow = styled.div`
  display: flex; align-items: center; gap: 8px;
`

const PreviewIcon = styled.div`
  color: var(--color-primary);
`

const PreviewName = styled.div`
  font-size: 15px; font-weight: 600; color: var(--color-text);
`

const PreviewClose = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: transparent; color: var(--color-text-3); cursor: pointer;
  &:hover { background: var(--color-background-soft); color: var(--color-text); }
`

const PreviewPath = styled.div`
  padding: 0 20px 12px;
  font-size: 11px; color: var(--color-text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`

const PreviewActions = styled.div`
  display: flex; gap: 6px; padding: 0 20px 12px;
  border-bottom: 0.5px solid var(--color-border);
`

const PActionBtn = styled.button<{ $primary?: boolean }>`
  display: flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 6px; border: 0.5px solid var(--color-border);
  background: ${(p) => (p.$primary ? 'var(--color-primary)' : 'var(--color-background-soft)')};
  color: ${(p) => (p.$primary ? '#fff' : 'var(--color-text-2)')};
  font-size: 12px; cursor: pointer;
  &:hover { background: ${(p) => (p.$primary ? 'var(--color-primary)' : 'var(--color-background-mute)')}; }
`

const PreviewBody = styled.div`
  flex: 1; overflow-y: auto; padding: 16px 20px;
  min-height: 120px; max-height: 400px;
`

const PreviewText = styled.pre`
  font-size: 12px; line-height: 1.6;
  color: var(--color-text); white-space: pre-wrap; word-break: break-all;
  margin: 0; font-family: var(--font-family-code, monospace);
`

const PreviewTextarea = styled.textarea`
  width: 100%; height: 300px;
  padding: 10px; border-radius: 8px;
  border: 0.5px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text); font-size: 12px;
  font-family: var(--font-family-code, monospace);
  outline: none; resize: vertical;
  &:focus { border-color: var(--color-primary); }
`

const PreviewInfo = styled.div`
  display: flex; flex-direction: column; gap: 8px; padding: 12px 0;
`

const PreviewInfoRow = styled.div`
  font-size: 13px; color: var(--color-text-2); line-height: 1.5;
`

const PreviewInfoNote = styled.div`
  margin-top: 8px; font-size: 12px; color: var(--color-text-3);
  font-style: italic;
`

const PreviewEmpty = styled.div`
  display: flex; align-items: center; justify-content: center;
  height: 120px; color: var(--color-text-3); font-size: 13px;
`

const DateSelect = styled.select`
  padding: 3px 8px; border-radius: 6px; border: 0.5px solid var(--color-border);
  background: var(--color-background-soft); color: var(--color-text); font-size: 12px;
  outline: none; cursor: pointer;
`

const ClrBtn = styled.button`
  padding: 3px 8px; border-radius: 6px; border: none;
  background: transparent; color: var(--color-primary); font-size: 12px; cursor: pointer;
`

const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 8px 16px;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }
`

const Empty = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; height: 200px; color: var(--color-text-3); font-size: 14px;
`

// ---- Section ----

const Section = styled.div`
  margin-bottom: 8px;
`

const SectionHeader = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  background: var(--color-background-soft); cursor: pointer;
  border: 0.5px solid var(--color-border);
  &:hover { border-color: var(--color-border-soft); }
`

const IconWrap = styled.div`
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--color-background-mute); color: var(--color-primary); flex-shrink: 0;
`

const SectionTitle = styled.div`
  font-size: 13px; font-weight: 600; color: var(--color-text); flex: 1;
`

const SectionCount = styled.span`
  font-size: 11px; color: var(--color-text-3);
`

const SectionBody = styled.div`
  padding: 6px 0 6px 38px;
`

// ---- Image grid ----

const ImageGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
`

const ImageCard = styled.div`
  position: relative; border-radius: 8px; overflow: hidden;
  border: 0.5px solid var(--color-border); background: var(--color-background-mute);
  &:hover { border-color: var(--color-border-soft); }
`

const ImgPreview = styled.img`
  width: 100%; height: 100px; object-fit: cover; display: block;
  background: var(--color-background-mute);
`

const ImgInfo = styled.div`
  padding: 4px 6px; display: flex; flex-direction: column; gap: 1px;
`

const ImgName = styled.div`
  font-size: 11px; color: var(--color-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`

const ImgMeta = styled.div`
  font-size: 10px; color: var(--color-text-3);
`

const ImgDel = styled.button`
  position: absolute; top: 4px; right: 4px;
  width: 20px; height: 20px; border-radius: 4px; border: none;
  background: rgba(0,0,0,0.5); color: #fff; cursor: pointer; font-size: 11px;
  opacity: 0; transition: opacity 0.15s;
  ${ImageCard}:hover & { opacity: 1; }
  &:hover { background: rgba(255,77,79,0.8); }
`

// ---- File rows ----

const Row = styled.div<{ $clickable?: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: 6px;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  &:hover { background: var(--color-background-soft); }
`

const RowIcon = styled.div`
  color: var(--color-text-3); flex-shrink: 0; width: 16px; text-align: center;
`

const RowName = styled.div`
  flex: 1; font-size: 12px; color: var(--color-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`

const RowSize = styled.span`
  font-size: 11px; color: var(--color-text-3); width: 60px; text-align: right; flex-shrink: 0;
`

const RowDate = styled.span`
  font-size: 11px; color: var(--color-text-3); width: 80px; flex-shrink: 0;
`

const RowDel = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 4px; border: none;
  background: transparent; color: var(--color-text-3); cursor: pointer; font-size: 11px;
  &:hover { color: var(--color-error); background: rgba(255,77,79,0.1); }
`

// ---- Modal ----

const Modal = styled.div`
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
`

const MPanel = styled.div`
  background: var(--color-background);
  border: 0.5px solid var(--color-border); border-radius: 12px;
  width: 360px; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
`

const MT = styled.div`
  font-size: 16px; font-weight: 600; color: var(--color-text); margin-bottom: 12px;
`

const MB = styled.div`
  font-size: 14px; color: var(--color-text-2); line-height: 1.5; margin-bottom: 20px;
`

const MFooter = styled.div`
  display: flex; gap: 8px; justify-content: flex-end;
`

const MCancel = styled.button`
  padding: 6px 14px; border-radius: 6px; border: 0.5px solid var(--color-border);
  background: transparent; color: var(--color-text-2); cursor: pointer; font-size: 13px;
`

const MConfirm = styled.button`
  padding: 6px 14px; border-radius: 6px; border: none;
  background: var(--color-error); color: #fff; cursor: pointer; font-size: 13px;
  &:hover { opacity: 0.9; }
`

export default FileLibPage
