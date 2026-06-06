import { createSelector } from '@reduxjs/toolkit'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useAssistantsTabSortType } from '@renderer/hooks/useStore'
import { useTags } from '@renderer/hooks/useTags'
import type { RootState } from '@renderer/store'
import { useAppSelector } from '@renderer/store'
import type { Assistant, AssistantsSortType } from '@renderer/types'
import { useNavigate } from 'react-router-dom'
import type { FC } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import * as tinyPinyin from 'tiny-pinyin'

import EmojiIcon from '@renderer/components/EmojiIcon'
import { AssistantList } from './components/AssistantList'
import { AssistantTagGroups } from './components/AssistantTagGroups'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

const selectTagsOrder = createSelector(
  [(state: RootState) => state.assistants],
  (assistants) => assistants.tagsOrder ?? []
)

const AssistantsTab: FC<AssistantsTabProps> = (props) => {
  const { activeAssistant, setActiveAssistant, onCreateAssistant, onCreateDefaultAssistant } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { t } = useTranslation()

  // Assistant related hooks
  const { assistants, removeAssistant, copyAssistant, updateAssistants } = useAssistants()
  const { addAssistantPreset } = useAssistantPresets()
  const { collapsedTags, toggleTagCollapse } = useTags()
  const { assistantsTabSortType = 'list', setAssistantsTabSortType } = useAssistantsTabSortType()
  const [dragging, setDragging] = useState(false)
  const savedTagsOrder = useAppSelector(selectTagsOrder)

  // Sorting
  const sortByPinyin = useCallback(
    (isAscending: boolean) => {
      const sorted = [...assistants].sort((a, b) => {
        const pinyinA = tinyPinyin.convertToPinyin(a.name, '', true)
        const pinyinB = tinyPinyin.convertToPinyin(b.name, '', true)
        return isAscending ? pinyinA.localeCompare(pinyinB) : pinyinB.localeCompare(pinyinA)
      })
      updateAssistants(sorted)
    },
    [assistants, updateAssistants]
  )

  const sortByPinyinAsc = useCallback(() => sortByPinyin(true), [sortByPinyin])
  const sortByPinyinDesc = useCallback(() => sortByPinyin(false), [sortByPinyin])

  // Grouping
  const groupedAssistantItems = useMemo(() => {
    const groups = new Map<string, Assistant[]>()

    assistants.forEach((assistant) => {
      const tags = assistant.tags?.length ? assistant.tags : [t('assistants.tags.untagged')]
      tags.forEach((tag) => {
        if (!groups.has(tag)) {
          groups.set(tag, [])
        }
        groups.get(tag)!.push(assistant)
      })
    })

    const untaggedKey = t('assistants.tags.untagged')
    const sortedGroups = Array.from(groups.entries()).sort(([tagA], [tagB]) => {
      if (tagA === untaggedKey) return -1
      if (tagB === untaggedKey) return 1

      if (savedTagsOrder.length > 0) {
        const indexA = savedTagsOrder.indexOf(tagA)
        const indexB = savedTagsOrder.indexOf(tagB)
        if (indexA !== -1 && indexB !== -1) return indexA - indexB
        if (indexA !== -1) return -1
        if (indexB !== -1) return 1
      }

      return 0
    })

    return sortedGroups.map(([tag, items]) => ({ tag, items }))
  }, [assistants, t, savedTagsOrder])

  const handleAssistantGroupReorder = useCallback(
    (tag: string, newGroupList: Assistant[]) => {
      let insertIndex = 0
      const updatedAssistants = assistants.map((a) => {
        const tags = a.tags?.length ? a.tags : [t('assistants.tags.untagged')]
        if (tags.includes(tag)) {
          const replaced = newGroupList[insertIndex]
          insertIndex += 1
          return replaced || a
        }
        return a
      })
      updateAssistants(updatedAssistants)
    },
    [assistants, t, updateAssistants]
  )

  const onDeleteAssistant = useCallback(
    (assistant: Assistant) => {
      const remaining = assistants.filter((a) => a.id !== assistant.id)
      if (remaining.length === 0) {
        window.toast.error(t('assistants.delete.error.remain_one'))
        return
      }

      if (assistant.id === activeAssistant?.id) {
        const newActive = remaining[remaining.length - 1]
        setActiveAssistant(newActive)
      }
      removeAssistant(assistant.id)
    },
    [assistants, activeAssistant?.id, removeAssistant, t, setActiveAssistant]
  )

  const handleSortByChange = useCallback(
    (sortType: AssistantsSortType) => {
      setAssistantsTabSortType(sortType)
    },
    [setAssistantsTabSortType]
  )

  return (
    <Container className="assistants-tab" ref={containerRef}>
      {assistantsTabSortType === 'tags' ? (
        <AssistantTagGroups
          groupedItems={groupedAssistantItems}
          activeAssistantId={activeAssistant.id}
          sortBy={assistantsTabSortType}
          collapsedTags={collapsedTags}
          onGroupReorder={handleAssistantGroupReorder}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onToggleTagCollapse={toggleTagCollapse}
          onAssistantSwitch={setActiveAssistant}
          onAssistantDelete={onDeleteAssistant}
          addPreset={addAssistantPreset}
          copyAssistant={copyAssistant}
          onCreateDefaultAssistant={onCreateDefaultAssistant}
          handleSortByChange={handleSortByChange}
          sortByPinyinAsc={sortByPinyinAsc}
          sortByPinyinDesc={sortByPinyinDesc}
        />
      ) : (
        <AssistantList
          items={assistants}
          activeAssistantId={activeAssistant.id}
          sortBy={assistantsTabSortType}
          onReorder={updateAssistants}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onAssistantSwitch={setActiveAssistant}
          onAssistantDelete={onDeleteAssistant}
          addPreset={addAssistantPreset}
          copyAssistant={copyAssistant}
          onCreateDefaultAssistant={onCreateDefaultAssistant}
          handleSortByChange={handleSortByChange}
          sortByPinyinAsc={sortByPinyinAsc}
          sortByPinyinDesc={sortByPinyinDesc}
        />
      )}

      {!dragging && <SectionDivider />}

      <MonitorEntry onClick={() => navigate('/monitor')}>
        <MonitorEntryInner>
          <EmojiIcon emoji="📡" size={24} fontSize={14} />
          <MonitorName>监控室</MonitorName>
        </MonitorEntryInner>
      </MonitorEntry>
      <MonitorEntry onClick={() => navigate('/skills')}>
        <MonitorEntryInner>
          <EmojiIcon emoji="🛠️" size={24} fontSize={14} />
          <MonitorName>skills管理室</MonitorName>
        </MonitorEntryInner>
      </MonitorEntry>
      <MonitorEntry onClick={() => navigate('/memory')}>
        <MonitorEntryInner>
          <EmojiIcon emoji="🧠" size={24} fontSize={14} />
          <MonitorName>记忆库</MonitorName>
        </MonitorEntryInner>
      </MonitorEntry>
      <MonitorEntry onClick={() => navigate('/filelib')}>
        <MonitorEntryInner>
          <EmojiIcon emoji="📂" size={24} fontSize={14} />
          <MonitorName>文件库</MonitorName>
        </MonitorEntryInner>
      </MonitorEntry>
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
`

const SectionDivider = styled.div`
  height: 1px;
  background: var(--color-border);
  margin: 0 4px 8px 4px;
  opacity: 0.6;
`

const MonitorEntry = styled.div`
  position: relative;
  display: flex;
  height: 37px;
  width: calc(var(--assistants-width) - 20px);
  cursor: pointer;
  flex-direction: row;
  justify-content: space-between;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  padding: 0 8px;
  margin: 0 0 8px 0;
  background: var(--color-list-item);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;

  &:hover {
    background: var(--color-list-item-hover);
  }
`

const MonitorEntryInner = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
  font-size: 13px;
`

const MonitorName = styled.div`
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--color-text);
`

export default AssistantsTab
