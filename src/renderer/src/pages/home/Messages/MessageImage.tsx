import {
  CopyOutlined,
  DownloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SwapOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import { loggerService } from '@logger'
import type { ImageMessageBlock } from '@renderer/types/newMessage'
import { Image as AntdImage, Space } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  block: ImageMessageBlock
}

const logger = loggerService.withContext('MessageImage')

/** 将自定义协议 URL 转为标准 blob URL */
function useResolvedSrc(src: string): string {
  const [resolved, setResolved] = useState(src)
  useEffect(() => {
    if (!src.startsWith('cs-vfs://') && !src.startsWith('file://') && !src.startsWith('cherry-studio://') && !src.startsWith('attachment://')) {
      setResolved(src)
      return
    }
    let cancelled = false
    fetch(src)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => { if (!cancelled) setResolved(URL.createObjectURL(blob)) })
      .catch(() => { if (!cancelled) setResolved(src) })
    return () => { cancelled = true }
  }, [src])
  return resolved
}

const MessageImage: FC<Props> = ({ block }) => {
  const { t } = useTranslation()

  const onDownload = (imageBase64: string, index: number) => {
    try {
      const link = document.createElement('a')
      link.href = imageBase64
      link.download = `image-${Date.now()}-${index}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.toast.success(t('message.download.success'))
    } catch (error) {
      logger.error('下载图片失败:', error as Error)
      window.toast.error(t('message.download.failed'))
    }
  }

  // 复制图片到剪贴板
  const onCopy = async (type: string, image: string) => {
    try {
      switch (type) {
        case 'base64': {
          // 处理 base64 格式的图片
          const parts = image.split(';base64,')
          if (parts.length === 2) {
            const mimeType = parts[0].replace('data:', '')
            const base64Data = parts[1]
            const byteCharacters = atob(base64Data)
            const byteArrays: Uint8Array[] = []

            for (let offset = 0; offset < byteCharacters.length; offset += 512) {
              const slice = byteCharacters.slice(offset, offset + 512)
              const byteNumbers = new Array(slice.length)
              for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i)
              }
              const byteArray = new Uint8Array(byteNumbers)
              byteArrays.push(byteArray)
            }

            const blob = new Blob(
              byteArrays.map((array) => array.slice()),
              { type: mimeType }
            )
            await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })])
          } else {
            throw new Error('无效的 base64 图片格式')
          }
          break
        }
        case 'url':
          {
            // 处理 URL 格式的图片
            const response = await fetch(image)
            const blob = await response.blob()

            await navigator.clipboard.write([
              new ClipboardItem({
                [blob.type]: blob
              })
            ])
          }
          break
      }

      window.toast.success(t('message.copy.success'))
    } catch (error) {
      logger.error('复制图片失败:', error as Error)
      window.toast.error(t('message.copy.failed'))
    }
  }

  const renderToolbar =
    (currentImage: string, currentIndex: number) =>
    (
      _: any,
      {
        transform: { scale },
        actions: { onFlipY, onFlipX, onRotateLeft, onRotateRight, onZoomOut, onZoomIn, onReset }
      }: any
    ) => (
      <ToobarWrapper size={12} className="toolbar-wrapper">
        <SwapOutlined rotate={90} onClick={onFlipY} />
        <SwapOutlined onClick={onFlipX} />
        <RotateLeftOutlined onClick={onRotateLeft} />
        <RotateRightOutlined onClick={onRotateRight} />
        <ZoomOutOutlined disabled={scale === 1} onClick={onZoomOut} />
        <ZoomInOutlined disabled={scale === 50} onClick={onZoomIn} />
        <UndoOutlined onClick={onReset} />
        <CopyOutlined onClick={() => onCopy(block.metadata?.generateImageResponse?.type!, currentImage)} />
        <DownloadOutlined onClick={() => onDownload(currentImage, currentIndex)} />
      </ToobarWrapper>
    )

  const images = block.metadata?.generateImageResponse?.images?.length
    ? block.metadata?.generateImageResponse?.images
    : block?.file?.path
      ? [`file://${block?.file?.path}`]
      : []

  return (
    <Container style={{ marginBottom: 8 }}>
      {images.map((image, index) => (
        <ResolvedImageItem
          key={`image-${index}`}
          src={image}
          index={index}
          renderToolbar={renderToolbar}
        />
      ))}
    </Container>
  )
}

/** 内部组件：解析图片 URL 后渲染 AntdImage */
const ResolvedImageItem: FC<{ src: string; index: number; renderToolbar: (image: string, index: number) => any }> = ({
  src,
  index,
  renderToolbar
}) => {
  const resolvedSrc = useResolvedSrc(src)
  return (
    <Image
      src={resolvedSrc}
      style={{ maxWidth: 500, maxHeight: 500 }}
      preview={{ toolbarRender: renderToolbar(src, index) }}
    />
  )
}
const Container = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 8px;
`
const Image = styled(AntdImage)`
  padding: 5px;
  border-radius: 8px;
`
const ToobarWrapper = styled(Space)`
  padding: 0px 24px;
  color: #fff;
  font-size: 20px;
  background-color: rgba(238, 233, 233, 0.1);
  border-radius: 100px;
  .anticon {
    padding: 12px;
    cursor: pointer;
  }
  .anticon:hover {
    opacity: 0.3;
  }
`

export default MessageImage
