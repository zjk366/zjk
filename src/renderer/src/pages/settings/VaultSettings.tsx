import { IpcChannel } from '@shared/IpcChannel'
import { Button, Descriptions, Table, Tag, Tooltip } from 'antd'
import { FileIcon, FolderOpenIcon, FolderSyncIcon } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface VaultFile {
  name: string
  size: number
  mtime: Date
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleString()
}

const VaultSettings: FC = () => {
  const { t } = useTranslation()
  const [rootDir, setRootDir] = useState('')
  const [files, setFiles] = useState<VaultFile[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const ipc = window.electron?.ipcRenderer
      if (!ipc) return
      const [dir, fileList] = await Promise.all([
        ipc.invoke(IpcChannel.Vault_GetRoot),
        ipc.invoke(IpcChannel.Vault_ListFiles)
      ])
      if (typeof dir === 'string') setRootDir(dir)
      if (Array.isArray(fileList)) setFiles(fileList)
    } catch (err) {
      console.error('Failed to refresh vault:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectDirectory = async () => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return
    const result = await ipc.invoke(IpcChannel.Vault_SelectDirectory)
    if (result) {
      setRootDir(result)
      void refresh()
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const columns = [
    {
      title: t('common.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <span>
          <FileIcon size={14} style={{ marginRight: 6, opacity: 0.6 }} />
          {name}
        </span>
      )
    },
    {
      title: t('common.size'),
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (size: number) => formatSize(size)
    },
    {
      title: t('common.updateTime'),
      dataIndex: 'mtime',
      key: 'mtime',
      width: 200,
      render: (mtime: Date) => formatDate(mtime)
    }
  ]

  return (
    <Container>
      <Section>
        <SectionTitle>
          <FolderSyncIcon size={18} />
          {t('settings.vault.title')}
        </SectionTitle>
        <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label={t('settings.vault.rootDir')}>
            <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{rootDir || '—'}</code>
          </Descriptions.Item>
        </Descriptions>
        <ButtonGroup>
          <Button type="primary" icon={<FolderOpenIcon size={14} />} onClick={handleSelectDirectory}>
            {t('settings.vault.changeDir')}
          </Button>
          <Button onClick={refresh} loading={loading}>
            {t('common.refresh')}
          </Button>
        </ButtonGroup>
      </Section>

      <Section>
        <SectionTitle>
          <FileIcon size={18} />
          {t('settings.vault.files')}
          <Tag style={{ marginLeft: 8 }}>{files.length}</Tag>
        </SectionTitle>
        <Table
          dataSource={files}
          columns={columns}
          rowKey="name"
          loading={loading}
          pagination={false}
          size="small"
          locale={{ emptyText: t('settings.vault.empty') }}
        />
      </Section>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
  width: 100%;
  overflow-y: auto;
`

const Section = styled.div`
  background: var(--color-background-soft);
  border-radius: 8px;
  padding: 16px;
`

const SectionTitle = styled.h3`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--color-text-1);
`

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
`

export default VaultSettings
