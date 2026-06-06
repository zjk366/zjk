/**
 * 记忆库页面
 *
 * 展示所有活跃记忆和垃圾桶中的记忆。
 * 支持搜索、删除（移入垃圾桶）、从垃圾桶恢复。
 */
import MemoryBankService from '@renderer/services/MemoryBankService'
import type { Memory } from '@renderer/types/memory'
import dayjs from 'dayjs'
import { ArchiveRestore, ArrowLeft, Delete, RotateCcw, Search, Trash2, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

type TabType = 'active' | 'trash'

const MemoryPage: FC = () => {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabType>('active')
  const [memories, setMemories] = useState<Memory[]>([])
  const [trashed, setTrashed] = useState<Memory[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const service = MemoryBankService.getInstance()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [active, trash] = await Promise.all([service.getAllActive(), service.getAllTrashed()])
      setMemories(active)
      setTrashed(trash)
    } catch (err) {
      console.error('Failed to load memories:', err)
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      loadData()
      return
    }
    const results = await service.search(searchQuery)
    setMemories(results)
  }, [searchQuery, service, loadData])

  const handleTrash = useCallback(async (id: string) => {
    await service.trash(id)
    loadData()
  }, [service, loadData])

  const handleRestore = useCallback(async (id: string) => {
    await service.restore(id)
    loadData()
  }, [service, loadData])

  const handleDeletePermanently = useCallback(async (id: string) => {
    await service.permanentlyDelete(id)
    loadData()
  }, [service, loadData])

  const formatTime = (iso: string) => dayjs(iso).format('MM-DD HH:mm')

  return (
    <PageContainer>
      <PageHeader>
        <TitleRow>
          <BackButton onClick={() => navigate('/')} title="返回">
            <ArrowLeft size={18} />
          </BackButton>
          <PageTitle>🧠 记忆库</PageTitle>
          <TabBar>
            <TabItem $active={tab === 'active'} onClick={() => setTab('active')}>
              活跃记忆 ({memories.length})
            </TabItem>
            <TabItem $active={tab === 'trash'} onClick={() => setTab('trash')}>
              <Trash2 size={14} /> 垃圾桶 ({trashed.length})
            </TabItem>
          </TabBar>
        </TitleRow>
        <SearchRow>
          <SearchInput
            placeholder="搜索记忆..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          {searchQuery ? (
            <IconButton onClick={() => { setSearchQuery(''); loadData() }} title="清除">
              <X size={16} />
            </IconButton>
          ) : (
            <IconButton onClick={handleSearch} title="搜索">
              <Search size={16} />
            </IconButton>
          )}
        </SearchRow>
      </PageHeader>

      <ContentArea>
        {loading ? (
          <EmptyState>加载中...</EmptyState>
        ) : tab === 'active' ? (
          memories.length === 0 ? (
            <EmptyState>{searchQuery ? '未找到匹配的记忆' : '暂无记忆，开始对话后会自动生成'}</EmptyState>
          ) : (
            memories.map((mem) => (
              <MemoryCard key={mem.id}>
                <CardBody>
                  <CardSummary>{mem.summary}</CardSummary>
                  <CardMeta>
                    <span>📅 {formatTime(mem.createdAt)}</span>
                    {mem.keywords.length > 0 && (
                      <KeywordList>
                        {mem.keywords.slice(0, 5).map((kw) => (
                          <KeywordTag key={kw}>{kw}</KeywordTag>
                        ))}
                      </KeywordList>
                    )}
                  </CardMeta>
                  <CardExpire>
                    {mem.expiresAt && `过期: ${formatTime(mem.expiresAt)}`}
                  </CardExpire>
                </CardBody>
                <CardActions>
                  <ActionBtn
                    $danger
                    onClick={() => handleTrash(mem.id)}
                    title="移入垃圾桶"
                  >
                    <Delete size={15} />
                  </ActionBtn>
                </CardActions>
              </MemoryCard>
            ))
          )
        ) : (
          trashed.length === 0 ? (
            <EmptyState>垃圾桶为空</EmptyState>
          ) : (
            trashed.map((mem) => (
              <MemoryCard key={mem.id}>
                <CardBody>
                  <CardSummary $deleted>{mem.summary}</CardSummary>
                  <CardMeta>
                    <span>📅 {formatTime(mem.createdAt)}</span>
                    <span style={{ color: 'var(--color-text-3)' }}>
                      删除于 {mem.deletedAt ? formatTime(mem.deletedAt) : ''}
                    </span>
                  </CardMeta>
                </CardBody>
                <CardActions>
                  <ActionBtn onClick={() => handleRestore(mem.id)} title="恢复">
                    <RotateCcw size={15} />
                  </ActionBtn>
                  <ActionBtn $danger onClick={() => handleDeletePermanently(mem.id)} title="永久删除">
                    <ArchiveRestore size={15} />
                  </ActionBtn>
                </CardActions>
              </MemoryCard>
            ))
          )
        )}
      </ContentArea>
    </PageContainer>
  )
}

// --- Styled Components ---

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
  background: var(--color-background);
  overflow: hidden;
`

const PageHeader = styled.div`
  padding: 20px 20px 12px;
  flex-shrink: 0;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
`

const BackButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  flex-shrink: 0;
  &:hover {
    background: var(--color-background-soft);
  }
`

const PageTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
`

const TabBar = styled.div`
  display: flex;
  gap: 4px;
`

const TabItem = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  cursor: pointer;
  background: ${(p) => (p.$active ? 'var(--color-primary)' : 'var(--color-background-soft)')};
  color: ${(p) => (p.$active ? '#fff' : 'var(--color-text-2)')};
  transition: all 0.2s;
`

const SearchRow = styled.div`
  display: flex;
  gap: 6px;
`

const SearchInput = styled.input`
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 0.5px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
  &:focus { border-color: var(--color-primary); }
`

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  background: var(--color-background-soft);
  border: 0.5px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-2);
  &:hover { color: var(--color-text); }
`

const ContentArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 20px 20px;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }
`

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-text-3);
  font-size: 14px;
`

const MemoryCard = styled.div`
  display: flex;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  border: 0.5px solid var(--color-border);
  margin-bottom: 8px;
  background: var(--color-background-soft);
  transition: all 0.2s;
  &:hover { border-color: var(--color-border-soft); }
`

const CardBody = styled.div`
  flex: 1;
  min-width: 0;
`

const CardSummary = styled.div<{ $deleted?: boolean }>`
  font-size: 13px;
  color: ${(p) => (p.$deleted ? 'var(--color-text-3)' : 'var(--color-text)')};
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-decoration: ${(p) => (p.$deleted ? 'line-through' : 'none')};
`

const CardMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-3);
  flex-wrap: wrap;
`

const KeywordList = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`

const KeywordTag = styled.span`
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-background-mute);
  color: var(--color-text-2);
  font-size: 10px;
`

const CardExpire = styled.div`
  font-size: 10px;
  color: var(--color-text-3);
  margin-top: 4px;
`

const CardActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  justify-content: center;
`

const ActionBtn = styled.button<{ $danger?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  color: ${(p) => (p.$danger ? 'var(--color-error)' : 'var(--color-text-2)')};
  background: transparent;
  &:hover {
    background: ${(p) => (p.$danger ? 'rgba(255, 77, 79, 0.1)' : 'var(--color-background-mute)')};
  }
`

export default MemoryPage
