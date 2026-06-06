import { SearchOutlined } from '@ant-design/icons'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { scrollIntoView } from '@renderer/utils/dom'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Input } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props {
  topic: Topic
}

/**
 * 用户问题搜索导航
 * 默认隐藏，鼠标靠近右侧边缘时显示。
 * 点击打开搜索面板，支持关键词筛选和滚动浏览。
 */
const MessageNavigator: React.FC<Props> = ({ topic }) => {
  const allMessages = useTopicMessages(topic.id)
  const { topicPosition, showTopics } = useSettings()
  const showRightTopics = topicPosition === 'right' && showTopics
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<any>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 提取用户消息
  const userMessages = useMemo(() => {
    return allMessages
      .filter((m: Message) => m.role === 'user' && m.type !== 'clear')
      .map((msg: Message) => ({
        id: msg.id,
        text: getMainTextContent(msg) || ''
      }))
  }, [allMessages])

  // 搜索过滤
  const filteredMessages = useMemo(() => {
    if (!search.trim()) return userMessages
    const q = search.trim().toLowerCase()
    return userMessages.filter((m) => m.text.toLowerCase().includes(q))
  }, [userMessages, search])

  // 点击跳转
  const handleItemClick = useCallback((messageId: string) => {
    const el = document.getElementById(`message-${messageId}`)
    if (el) {
      scrollIntoView(el, { behavior: 'smooth', block: 'start', container: 'nearest' })
    }
    setOpen(false)
    setSearch('')
  }, [])

  // 鼠标进入触发区
  const handleMouseEnter = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setVisible(true)
  }, [])

  // 鼠标离开触发区
  const handleMouseLeave = useCallback(() => {
    if (open) return
    hideTimerRef.current = setTimeout(() => setVisible(false), 500)
  }, [open])

  // 打开面板时取消隐藏定时
  useEffect(() => {
    if (open && hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [open])

  // 点击外部关闭面板
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
    }
  }, [open])

  // 自动聚焦搜索框
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (userMessages.length === 0) return null

  return (
    <Root>
      {/* 触发区：右侧 40px 窄条 */}
      <TriggerArea
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        $showRightTopics={showRightTopics}
      />
      {/* 按钮 + 面板 */}
      <ContentWrapper
        $visible={visible}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        ref={panelRef}>
        {/* 搜索按钮 */}
        <SearchBtn $open={open} onClick={() => setOpen(!open)} title="搜索用户问题">
          <SearchOutlined />
          <Badge>{userMessages.length}</Badge>
        </SearchBtn>

        {/* 搜索面板 */}
        {open && (
          <Panel>
            <PanelHeader>
              <SearchInput
                ref={inputRef}
                prefix={<SearchOutlined style={{ color: 'var(--color-text-3)', fontSize: 13 }} />}
                placeholder="搜索用户问题..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                allowClear
                size="small"
              />
            </PanelHeader>
            <PanelBody>
              {filteredMessages.length === 0 ? (
                <EmptyText>
                  {search ? '未找到匹配的问题' : '暂无用户问题'}
                </EmptyText>
              ) : (
                <MessageList>
                  {filteredMessages.map((msg, idx) => (
                    <MessageItem key={msg.id} onClick={() => handleItemClick(msg.id)}>
                      <MsgIndex>#{idx + 1}</MsgIndex>
                      <MsgText>{msg.text || '(空消息)'}</MsgText>
                    </MessageItem>
                  ))}
                </MessageList>
              )}
            </PanelBody>
          </Panel>
        )}
      </ContentWrapper>
    </Root>
  )
}

export default MessageNavigator

// ====== Styled Components ======

const Root = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  pointer-events: none;
`

const TriggerArea = styled.div<{ $showRightTopics: boolean }>`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 40px;
  pointer-events: auto;
  z-index: 1;
`

const ContentWrapper = styled.div<{ $visible: boolean }>`
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: auto;
  z-index: 2;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity 0.2s ease;
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
`

const SearchBtn = styled.div<{ $open: boolean }>`
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--color-background);
  border: 1px solid ${({ $open }) => ($open ? 'var(--color-primary)' : 'var(--color-border)')};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: ${({ $open }) => ($open ? 'var(--color-primary)' : 'var(--color-text-2)')};
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
  position: relative;
  font-size: 14px;
  flex-shrink: 0;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }
`

const Badge = styled.span`
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: var(--color-primary);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  padding: 0 4px;
  font-weight: 600;
  pointer-events: none;
`

const Panel = styled.div`
  margin-right: 8px;
  width: 300px;
  max-height: 60vh;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const PanelHeader = styled.div`
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
`

const SearchInput = styled(Input)`
  border-radius: 6px;
  font-size: 12px;

  .ant-input {
    font-size: 12px;
  }
`

const PanelBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
`

const EmptyText = styled.div`
  text-align: center;
  padding: 24px 0;
  font-size: 12px;
  color: var(--color-text-3);
`

const MessageList = styled.div`
  display: flex;
  flex-direction: column;
`

const MessageItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--color-hover);
  }
`

const MsgIndex = styled.span`
  font-size: 11px;
  color: var(--color-text-3);
  font-weight: 500;
  line-height: 18px;
  flex-shrink: 0;
  min-width: 22px;
`

const MsgText = styled.span`
  font-size: 12px;
  color: var(--color-text);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
`
