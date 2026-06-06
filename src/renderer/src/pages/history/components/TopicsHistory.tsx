import { DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import { VStack } from '@renderer/components/Layout'
import { TopicManager } from '@renderer/hooks/useTopic'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { removeTopic, selectAllTopics } from '@renderer/store/assistants'
import { useAppDispatch } from '@renderer/store'
import type { Topic } from '@renderer/types'
import { Button, Divider, Empty, Segmented } from 'antd'
import dayjs from 'dayjs'
import { groupBy, isEmpty, orderBy } from 'lodash'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

type SortType = 'createdAt' | 'updatedAt'

type Props = {
  keywords: string
  onClick: (topic: Topic) => void
  onSearch: () => void
} & React.HTMLAttributes<HTMLDivElement>

const TopicsHistory: React.FC<Props> = ({ keywords, onClick, onSearch, ...props }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { handleScroll, containerRef } = useScrollPosition('TopicsHistory')
  const [sortType, setSortType] = useState<SortType>('createdAt')

  // FIXME: db 中没有 topic.name 等信息，只能从 store 获取
  const topics = useSelector(selectAllTopics)

  const filteredTopics = topics.filter((topic) => {
    return topic.name.toLowerCase().includes(keywords.toLowerCase())
  })

  const groupedTopics = groupBy(orderBy(filteredTopics, sortType, 'desc'), (topic) => {
    return dayjs(topic[sortType]).format('MM/DD')
  })

  const handleDeleteTopic = (e: React.MouseEvent, topic: Topic) => {
    e.stopPropagation()
    window.modal.confirm({
      title: '删除话题',
      content: '确定要删除该话题吗？此操作不可恢复。',
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await TopicManager.removeTopic(topic.id)
        dispatch(removeTopic({ assistantId: topic.assistantId, topic }))
      }
    })
  }

  if (isEmpty(filteredTopics)) {
    return (
      <ListContainer {...props}>
        <VStack alignItems="center">
          <Empty description={t('history.search.topics.empty')} />
          <Button style={{ width: 200, marginTop: 20 }} type="primary" onClick={onSearch} icon={<SearchOutlined />}>
            {t('history.search.messages')}
          </Button>
        </VStack>
      </ListContainer>
    )
  }

  return (
    <ListContainer {...props} ref={containerRef} onScroll={handleScroll}>
      <Segmented
        shape="round"
        size="small"
        value={sortType}
        onChange={setSortType}
        options={[
          { label: t('export.created'), value: 'createdAt' },
          { label: t('export.last_updated'), value: 'updatedAt' }
        ]}
      />
      <ContainerWrapper>
        {Object.entries(groupedTopics).map(([date, items]) => (
          <ListItem key={date}>
            <Date>{date}</Date>
            <Divider style={{ margin: '5px 0' }} />
            {items.map((topic) => (
              <TopicItem key={topic.id} onClick={() => onClick(topic)}>
                <TopicName>{topic.name.substring(0, 50)}</TopicName>
                <TopicRight>
                  <TopicDate>{dayjs(topic[sortType]).format('HH:mm')}</TopicDate>
                  <DeleteBtn onClick={(e) => handleDeleteTopic(e, topic)} />
                </TopicRight>
              </TopicItem>
            ))}
          </ListItem>
        ))}
        {keywords && (
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
            <Button style={{ width: 200, marginTop: 20 }} type="primary" onClick={onSearch} icon={<SearchOutlined />}>
              {t('history.search.messages')}
            </Button>
          </div>
        )}
        <div style={{ minHeight: 30 }}></div>
      </ContainerWrapper>
    </ListContainer>
  )
}

const ContainerWrapper = styled.div`
  width: 100%;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
`

const ListContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: scroll;
  width: 100%;
  align-items: center;
  padding-top: 10px;
  padding-bottom: 20px;
`

const ListItem = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 15px;
`

const Date = styled.div`
  font-size: 26px;
  font-weight: bold;
  color: var(--color-text-3);
`

const TopicItem = styled.div`
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  height: 30px;
`

const TopicName = styled.div`
  font-size: 14px;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TopicRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const TopicDate = styled.div`
  font-size: 14px;
  color: var(--color-text-3);
`

const DeleteBtn = styled(DeleteOutlined)`
  font-size: 13px;
  color: var(--color-text-3);
  opacity: 0;
  transition: all 0.2s ease;
  padding: 4px;
  border-radius: 4px;

  ${TopicItem}:hover & {
    opacity: 0.6;
  }

  &:hover {
    opacity: 1 !important;
    color: var(--color-error);
    background: rgba(var(--color-error-rgb), 0.08);
  }
`

export default TopicsHistory
