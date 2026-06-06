import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import type { FC } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchPanelController, WebSearchProviderIcon } from './WebSearchQuickPanelManager'

interface Props {
  quickPanelController: ToolQuickPanelController
  assistantId: string
}

/**
 * 智能搜索按钮
 *
 * 点击自动启用 Edge（local-bing）搜索，不再弹出提供商选择面板。
 * 如果搜索无结果，自动依次尝试 Google → Baidu 兜底。
 * 再次点击关闭搜索。
 */
const WebSearchButton: FC<Props> = ({ quickPanelController, assistantId }) => {
  const { t } = useTranslation()
  const { enableWebSearch, updateWebSearchProvider, selectedProviderId } =
    useWebSearchPanelController(assistantId, quickPanelController)

  const onClick = useCallback(() => {
    if (enableWebSearch) {
      // 已开启 → 关闭
      void updateWebSearchProvider(undefined)
      window.toast.info('网络搜索已关闭')
    } else {
      // 未开启 → 自动启用 Edge（Bing）搜索
      void updateWebSearchProvider('local-bing')
      window.toast.success('已启用 Edge 搜索')
    }
  }, [enableWebSearch, updateWebSearchProvider])

  const ariaLabel = enableWebSearch ? t('common.close') : t('chat.input.web_search.label')

  return (
    <Tooltip placement="top" title={ariaLabel} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={onClick}
        active={!!enableWebSearch}
        aria-label={ariaLabel}
        aria-pressed={!!enableWebSearch}>
        <WebSearchProviderIcon pid={selectedProviderId} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(WebSearchButton)
