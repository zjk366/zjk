/**
 * Skills 管理室
 *
 * 展示所有已安装的技能，支持启用/禁用、搜索。
 * MCP 类型技能支持一键安装（终端窗口）。
 */
import SkillsService from '@renderer/services/SkillsService'
import store from '@renderer/store'
import type { LocalSkill } from '@renderer/types/localSkill'
import dayjs from 'dayjs'
import { ArrowLeft, Plug, PlugZap, Search, Terminal, Trash2, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const SkillsPage: FC = () => {
  const navigate = useNavigate()
  const [skills, setSkills] = useState<LocalSkill[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalSkill, setModalSkill] = useState<LocalSkill | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const service = SkillsService.getInstance()

  const isMcpSkill = (s: LocalSkill) =>
    s.tags?.includes('MCP') || s.source === 'MCP 安装' || s.source === 'MCP 自动安装'

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = searchQuery.trim() ? await service.search(searchQuery) : await service.getAll()
      // 数据清洗：过滤掉没有名称或名称以点开头的隐藏条目
      const cleaned = data.filter((s) => s.name && !s.name.startsWith('.'))
      setSkills(cleaned)
    } catch (err) {
      console.error('Failed to load skills:', err)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, service])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 监听 IPC 通知：技能安装完成 → 自动刷新列表
  useEffect(() => {
    const onUpdated = (window as any).api?.onSkillsUpdated
    if (typeof onUpdated === 'function') {
      const unsub = onUpdated(() => loadData())
      return () => {
        if (typeof unsub === 'function') unsub()
      }
    }
  }, [loadData])

  const handleCleanup = useCallback(async () => {
    const activeServers = store
      .getState()
      .mcp.servers.filter((s) => s.isActive)
      .map((s) => s.name)
    const count = await service.cleanupOrphaned(activeServers)
    if (count > 0) {
      window.toast?.success?.(`已清理 ${count} 个无效技能`)
      loadData()
    } else {
      window.toast?.info?.('没有需要清理的无效技能')
    }
  }, [service, loadData])

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => loadData(), 300)
    },
    [loadData]
  )

  const handleToggle = useCallback(
    async (id: string) => {
      await service.toggle(id)
      loadData()
    },
    [service, loadData]
  )

  const handleRemove = useCallback(
    async (id: string) => {
      await service.remove(id)
      loadData()
    },
    [service, loadData]
  )

  // 超级模式：单击 MCP 卡片 → 打开终端执行安装命令
  const handleSuperMode = useCallback((skill: LocalSkill) => {
    const openTerminal = (window as any).api?.openTerminal
    if (typeof openTerminal === 'function') {
      openTerminal(`npx -y ${skill.name}`, skill.name)
    } else {
      console.warn('openTerminal not available, try restarting the app')
    }
  }, [])

  // 双击 → 打开详情模态框
  const handleDoubleClick = useCallback((skill: LocalSkill) => {
    if (isMcpSkill(skill)) {
      setModalSkill(skill)
    }
  }, [])

  // 模态框确认安装
  const handleModalInstall = useCallback(() => {
    if (modalSkill) {
      handleSuperMode(modalSkill)
      setModalSkill(null)
    }
  }, [modalSkill, handleSuperMode])

  return (
    <Root>
      <Header>
        <BackBtn onClick={() => navigate('/')} title="返回">
          <ArrowLeft size={18} />
        </BackBtn>
        <Title>A</Title>
        <Title>Skills 管理室</Title>
        <SkillCount>{skills.length}</SkillCount>
        <SearchRow>
          <CleanupBtn onClick={handleCleanup} title="清理无效技能（删除已卸载 MCP 服务的残留注册）">
            <Trash2 size={14} />
          </CleanupBtn>
          <SearchInput
            placeholder="搜索技能名称或描述..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <IconBtn
            onClick={() => {
              if (searchQuery) {
                setSearchQuery('')
                loadData()
              }
            }}
            title={searchQuery ? '清除' : '搜索'}>
            {searchQuery ? <X size={15} /> : <Search size={15} />}
          </IconBtn>
        </SearchRow>
      </Header>

      <Body>
        {loading ? (
          <Empty>加载中...</Empty>
        ) : skills.length === 0 ? (
          <Empty>{searchQuery ? '未找到匹配的技能' : '暂无技能，AI 对话过程中会自动注册'}</Empty>
        ) : (
          <Grid>
            {skills.map((skill) => (
              <Card
                key={skill.id}
                $mcp={isMcpSkill(skill)}
                onClick={() => isMcpSkill(skill) && handleSuperMode(skill)}
                onDoubleClick={() => handleDoubleClick(skill)}>
                <CardLeft>
                  <CardIcon>{skill.isEnabled ? <PlugZap size={20} /> : <Plug size={20} />}</CardIcon>
                </CardLeft>
                <CardMain>
                  <CardNameRow>
                    <CardName>{skill.name}</CardName>
                    <CardStatus $active={skill.isEnabled}>{skill.isEnabled ? '启用' : '禁用'}</CardStatus>
                    {isMcpSkill(skill) && <McpBadge>MCP</McpBadge>}
                  </CardNameRow>
                  <CardDesc>{skill.plainDescription || skill.description}</CardDesc>
                  <CardMeta>
                    <span>📅 {dayjs(skill.createdAt).format('MM-DD HH:mm')}</span>
                    {skill.source && <span>来源: {skill.source}</span>}
                    {skill.tags.length > 0 && (
                      <TagList>
                        {skill.tags
                          .filter((t) => t !== 'MCP')
                          .map((t) => (
                            <Tag key={t}>{t}</Tag>
                          ))}
                      </TagList>
                    )}
                  </CardMeta>
                </CardMain>
                <CardRight>
                  <DelBtn
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(skill.id)
                    }}
                    title="删除">
                    ✕
                  </DelBtn>
                  {isMcpSkill(skill) && (
                    <SuperBtn
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSuperMode(skill)
                      }}
                      title="单击安装 · 双击详情">
                      <Terminal size={14} />
                    </SuperBtn>
                  )}
                  <SwitchBtn
                    $active={skill.isEnabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggle(skill.id)
                    }}>
                    <SwitchKnob $active={skill.isEnabled} />
                  </SwitchBtn>
                </CardRight>
              </Card>
            ))}
          </Grid>
        )}
      </Body>

      {/* 详情模态框 */}
      {modalSkill && (
        <ModalOverlay onClick={() => setModalSkill(null)}>
          <ModalPanel onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>{modalSkill.name}</ModalTitle>
              <ModalClose onClick={() => setModalSkill(null)}>✕</ModalClose>
            </ModalHeader>
            <ModalBody>
              <ModalSection>
                <ModalLabel>描述</ModalLabel>
                <ModalText>{modalSkill.description}</ModalText>
              </ModalSection>
              <ModalSection>
                <ModalLabel>通俗说明</ModalLabel>
                <ModalText>{modalSkill.plainDescription}</ModalText>
              </ModalSection>
              <ModalSection>
                <ModalLabel>来源</ModalLabel>
                <ModalText>{modalSkill.source || '未知'}</ModalText>
              </ModalSection>
              {modalSkill.tags.length > 0 && (
                <ModalSection>
                  <ModalLabel>标签</ModalLabel>
                  <TagList>
                    {modalSkill.tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </TagList>
                </ModalSection>
              )}
              <ModalSection>
                <ModalLabel>安装方式</ModalLabel>
                <ModalCode>npx -y {modalSkill.name}</ModalCode>
              </ModalSection>
            </ModalBody>
            <ModalFooter>
              <ModalBtnCancel onClick={() => setModalSkill(null)}>取消</ModalBtnCancel>
              <ModalBtnPrimary onClick={handleModalInstall}>
                <Terminal size={16} /> 确认安装
              </ModalBtnPrimary>
            </ModalFooter>
          </ModalPanel>
        </ModalOverlay>
      )}
    </Root>
  )
}

// ---- Styled ----

const Root = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
  overflow: hidden;
  background: var(--color-background);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--color-border);
  flex-shrink: 0;
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

const SkillCount = styled.span`
  font-size: 12px; color: var(--color-text-3);
  background: var(--color-background-soft);
  padding: 1px 8px; border-radius: 10px;
`

const CleanupBtn = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: none; border-radius: 6px;
  background: transparent; color: var(--color-text-3); cursor: pointer; flex-shrink: 0;
  &:hover { background: var(--color-background-mute); color: var(--color-error); }
`

const SearchRow = styled.div`
  display: flex; gap: 4px; margin-left: auto;
`

const SearchInput = styled.input`
  width: 200px; padding: 5px 10px; border-radius: 6px;
  border: 0.5px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text); font-size: 12px; outline: none;
  &:focus { border-color: var(--color-primary); }
`

const IconBtn = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 26px; border: none; background: transparent;
  color: var(--color-text-3); cursor: pointer;
  &:hover { color: var(--color-text); }
`

const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 12px 16px;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }
`

const Empty = styled.div`
  display: flex; align-items: center; justify-content: center;
  height: 200px; color: var(--color-text-3); font-size: 14px;
`

const Grid = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`

const Card = styled.div<{ $mcp?: boolean }>`
  display: flex; gap: 12px; align-items: flex-start; padding: 14px;
  border-radius: 10px;
  border: 0.5px solid ${(p) => (p.$mcp ? 'var(--color-primary)' : 'var(--color-border)')};
  background: var(--color-background-soft);
  transition: all 0.2s;
  cursor: ${(p) => (p.$mcp ? 'pointer' : 'default')};
  &:hover {
    border-color: ${(p) => (p.$mcp ? 'var(--color-primary)' : 'var(--color-border-soft)')};
    background: ${(p) => (p.$mcp ? 'var(--color-primary-mute)' : 'var(--color-background-soft)')};
  }
`

const CardLeft = styled.div`flex-shrink: 0; padding-top: 2px;`

const CardIcon = styled.div`
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 8px;
  background: var(--color-background-mute); color: var(--color-primary);
`

const CardMain = styled.div`flex: 1; min-width: 0;`

const CardNameRow = styled.div`
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
`

const CardName = styled.div`
  font-size: 14px; font-weight: 600; color: var(--color-text);
`

const CardStatus = styled.span<{ $active: boolean }>`
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: ${(p) => (p.$active ? 'rgba(0, 185, 107, 0.15)' : 'var(--color-background-mute)')};
  color: ${(p) => (p.$active ? 'var(--color-primary)' : 'var(--color-text-3)')};
`

const McpBadge = styled.span`
  font-size: 9px; padding: 1px 5px; border-radius: 3px;
  background: var(--color-primary-mute); color: var(--color-primary);
  font-weight: 600; letter-spacing: 0.5px;
`

const CardDesc = styled.div`
  font-size: 12px; color: var(--color-text-2); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; margin-bottom: 6px;
`

const CardMeta = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 11px; color: var(--color-text-3);
`

const TagList = styled.div`display: flex; gap: 3px; flex-wrap: wrap;`

const Tag = styled.span`
  padding: 1px 5px; border-radius: 3px;
  background: var(--color-background-mute);
  font-size: 10px; color: var(--color-text-2);
`

const CardRight = styled.div`
  flex-shrink: 0; display: flex; align-items: center; gap: 4px; padding-top: 6px;
`

const DelBtn = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 4px; border: none;
  background: transparent; color: var(--color-text-3); cursor: pointer; font-size: 12px;
  &:hover { color: var(--color-error); background: rgba(255,77,79,0.1); }
`

const SuperBtn = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 22px; border-radius: 4px; border: none;
  background: var(--color-primary-mute); color: var(--color-primary); cursor: pointer;
  &:hover { background: var(--color-primary-soft); }
`

const SwitchBtn = styled.button<{ $active: boolean }>`
  width: 36px; height: 20px; border-radius: 10px; border: none; cursor: pointer;
  position: relative;
  background: ${(p) => (p.$active ? 'var(--color-primary)' : 'var(--color-background-mute)')};
  transition: background 0.2s; padding: 0;
`

const SwitchKnob = styled.span<{ $active: boolean }>`
  position: absolute; top: 2px;
  left: ${(p) => (p.$active ? '18px' : '2px')};
  width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: left 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
`

// ---- Modal ----

const ModalOverlay = styled.div`
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
`

const ModalPanel = styled.div`
  background: var(--color-background);
  border: 0.5px solid var(--color-border);
  border-radius: 12px; width: 420px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  overflow: hidden;
`

const ModalHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 12px;
`

const ModalTitle = styled.div`
  font-size: 16px; font-weight: 600; color: var(--color-text);
`

const ModalClose = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: transparent; color: var(--color-text-3); cursor: pointer;
  &:hover { background: var(--color-background-soft); color: var(--color-text); }
`

const ModalBody = styled.div`
  padding: 0 20px 16px; display: flex; flex-direction: column; gap: 12px;
`

const ModalSection = styled.div``

const ModalLabel = styled.div`
  font-size: 11px; font-weight: 600; color: var(--color-text-3);
  margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;
`

const ModalText = styled.div`
  font-size: 13px; color: var(--color-text-2); line-height: 1.5;
`

const ModalCode = styled.code`
  display: block; padding: 8px 10px; border-radius: 6px;
  background: var(--color-background-mute); color: var(--color-text);
  font-size: 12px; font-family: monospace;
`

const ModalFooter = styled.div`
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 20px; border-top: 0.5px solid var(--color-border);
`

const ModalBtnCancel = styled.button`
  padding: 6px 14px; border-radius: 6px; border: 0.5px solid var(--color-border);
  background: transparent; color: var(--color-text-2); cursor: pointer; font-size: 13px;
  &:hover { background: var(--color-background-soft); }
`

const ModalBtnPrimary = styled.button`
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 6px; border: none;
  background: var(--color-primary); color: #fff; cursor: pointer; font-size: 13px;
  &:hover { opacity: 0.9; }
`

export default SkillsPage
