import type { CompressedMessageBlock } from '@renderer/types/newMessage'
import { Collapse, Typography } from 'antd'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const { Text } = Typography

interface CompressedBlockProps {
  block: CompressedMessageBlock
}

const CompressedBlock: React.FC<CompressedBlockProps> = ({ block }) => {
  const { t } = useTranslation()

  const formatTokenCount = useCallback((count: number): string => {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'K'
    }
    return count.toString()
  }, [])

  const savedTokens = block.originalTokenCount - block.compressedTokenCount
  const savedPercent = block.originalTokenCount > 0 ? Math.round((savedTokens / block.originalTokenCount) * 100) : 0

  return (
    <div style={{ margin: '8px 0' }}>
      <Collapse
        ghost
        expandIconPosition="end"
        items={[
          {
            key: 'compressed',
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span role="img" aria-label="compress" style={{ fontSize: 14 }}>
                  📦
                </span>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {t('chat.compressed.title', '上下文已压缩')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ({block.originalMessageCount}
                  {t('chat.compressed.messages', '条消息')} · {formatTokenCount(savedTokens)}{' '}
                  {t('chat.compressed.saved', '已节约')} {savedPercent}%)
                </Text>
              </div>
            ),
            children: (
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--color-background-secondary, #f5f5f5)',
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--color-text-secondary, #666)',
                  whiteSpace: 'pre-wrap'
                }}>
                {block.summary}
              </div>
            )
          }
        ]}
      />
    </div>
  )
}

export default CompressedBlock
