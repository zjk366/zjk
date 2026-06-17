import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { isLocalAi } from '@renderer/config/env'
import { isEmbeddingModel, isRerankModel, isWebSearchModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { getProviderName } from '@renderer/services/ProviderService'
import type { Assistant, Model, Provider } from '@renderer/types'
import type { MenuProps } from 'antd'
import { Button, Dropdown, Tag } from 'antd'
import { sortBy } from 'lodash'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  compact?: boolean
}

const modelFilter = (model: Model) => !isEmbeddingModel(model) && !isRerankModel(model)

const SelectModelButton: FC<Props> = ({ assistant, compact }) => {
  const { model, updateAssistant } = useAssistant(assistant.id)
  const { t } = useTranslation()
  const { providers } = useProviders()
  const allProviders = useAllProviders()
  const provider = useMemo(() => allProviders.find((p) => p.id === model?.provider), [allProviders, model?.provider])

  const providerName = getProviderName(model)

  const menuItems: MenuProps['items'] = useMemo(() => {
    const providerOrderMap = new Map(allProviders.map((p, i) => [p.id, i]))
    const filteredProviders = providers.reduce<Provider[]>((result, provider) => {
      const models = provider.models.filter(modelFilter)
      if (models.length === 0) return result
      result.push({ ...provider, models: sortBy(models, ['group', 'name']) })
      return result
    }, [])
    const sorted = sortBy(filteredProviders, (p) => providerOrderMap.get(p.id) ?? Infinity)

    const items: MenuProps['items'] = []
    sorted.forEach((provider, idx) => {
      if (idx > 0) {
        items.push({ type: 'divider' })
      }
      items.push({
        key: `__provider_${provider.id}`,
        label: provider.name,
        type: 'group'
      })
      provider.models.forEach((m) => {
        const isActive = model?.id === m.id && model?.provider === m.provider
        items.push({
          key: `${provider.id}::${m.id}`,
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ModelAvatar model={m} size={18} />
              <span style={{ flex: 1, minWidth: 0 }}>{m.name}</span>
              {isActive && <Check size={14} style={{ color: 'var(--color-primary)' }} />}
            </div>
          )
        })
      })
    })
    return items
  }, [providers, allProviders, model])

  const handleMenuClick: MenuProps['onClick'] = useCallback(
    ({ key }) => {
      if (key.startsWith('__provider_')) return
      const [providerId, ...modelIdParts] = key.split('::')
      const modelId = modelIdParts.join('::')
      if (model?.id === modelId && model?.provider === providerId) return
      for (const p of providers) {
        const found = p.models.find((m) => m.id === modelId && m.provider === providerId)
        if (found) {
          const enabledWebSearch = isWebSearchModel(found)
          updateAssistant({
            model: found,
            enableWebSearch: enabledWebSearch && assistant.enableWebSearch
          })
          break
        }
      }
    },
    [model, providers, updateAssistant, assistant.enableWebSearch]
  )

  if (isLocalAi) {
    return null
  }

  return (
    <Dropdown
      menu={{ items: menuItems, onClick: handleMenuClick, style: { maxHeight: 400, overflow: 'auto' } }}
      trigger={['click']}
      placement="topLeft">
      <DropdownButton size="small" type="text" $compact={compact}>
        <ButtonContent>
          <ModelAvatar model={model} size={compact ? 18 : 20} />
          <ModelName $compact={compact}>
            {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
          </ModelName>
        </ButtonContent>
        <ChevronsUpDown size={14} color="var(--color-icon)" />
        {!provider && <Tag color="error">{t('models.invalid_model')}</Tag>}
      </DropdownButton>
    </Dropdown>
  )
}

const DropdownButton = styled(Button)<{ $compact?: boolean }>`
  font-size: 10px;
  border-radius: 12px;
  padding: ${(props) => (props.$compact ? '1px 7px' : '13px 5px')};
  -webkit-app-region: none;
  box-shadow: none;
  background-color: transparent;
  border: 0.5px solid transparent;
  margin-top: 1px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  &:hover {
    border-color: color-mix(in srgb, var(--color-primary) 20%, transparent);
    background-color: color-mix(in srgb, var(--color-primary) 4%, transparent);
  }
`

const ButtonContent = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const ModelName = styled.span<{ $compact?: boolean }>`
  font-weight: 500;
  margin-right: -2px;
  font-size: ${(props) => (props.$compact ? '11px' : '12px')};
`

export default SelectModelButton
