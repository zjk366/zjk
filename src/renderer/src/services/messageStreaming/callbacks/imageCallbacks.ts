import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { GenerateImageResponse } from '@renderer/types'
import type { ImageMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createImageBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ImageCallbacks')

interface ImageCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

/** 对同一消息去重：记录已处理过的图片指纹，防止同一图片被处理多次 */
const imageFingerprints = new Set<string>()
function getImageFingerprint(imageData: GenerateImageResponse): string {
  if (imageData?.images?.[0]) {
    // 取 base64 前 100 字符作为指纹（足够区分不同图片）
    const raw = imageData.images[0]
    return raw.length > 100 ? raw.slice(0, 100) : raw
  }
  return ''
}

export const createImageCallbacks = (deps: ImageCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let imageBlockId: string | null = null

  return {
    onImageCreated: async () => {
      // 如果已经有 PENDING 的 imageBlockId，说明同一图片已开始处理，跳过
      if (imageBlockId) return
      if (blockManager.hasInitialPlaceholder) {
        const initialChanges = {
          type: MessageBlockType.IMAGE,
          status: MessageBlockStatus.PENDING
        }
        imageBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(imageBlockId, initialChanges, MessageBlockType.IMAGE)
      } else if (!imageBlockId) {
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MessageBlockStatus.PENDING
        })
        imageBlockId = imageBlock.id
        await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
      }
    },

    onImageDelta: (imageData: GenerateImageResponse) => {
      const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
      if (imageBlockId) {
        const changes: Partial<ImageMessageBlock> = {
          url: imageUrl,
          metadata: { generateImageResponse: imageData },
          status: MessageBlockStatus.STREAMING
        }
        blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
      }
    },

    onImageGenerated: async (imageData?: GenerateImageResponse) => {
      // 去重：同一图片数据只处理一次（工具截图等场景可能重复发射 IMAGE_COMPLETE）
      if (imageData) {
        const fp = getImageFingerprint(imageData)
        if (fp && imageFingerprints.has(fp)) {
          logger.debug('[onImageGenerated] Duplicate image skipped')
          return
        }
        if (fp) imageFingerprints.add(fp)
      }
      // For base64 images, persist to disk to avoid sending huge data URIs in future messages
      const buildImageBlockFields = async (imageData: GenerateImageResponse): Promise<Partial<ImageMessageBlock>> => {
        const imageUrl: string = imageData.images?.[0] || 'placeholder_image_url'
        if (imageData.type === 'base64' && imageUrl.startsWith('data:')) {
          const savedFile = await window.api.file.saveBase64Image(imageUrl)
          await FileManager.addFile(savedFile)
          return {
            file: savedFile,
            url: FileManager.getFileUrl(savedFile),
            metadata: { generateImageResponse: imageData },
            status: MessageBlockStatus.SUCCESS
          }
        }
        return {
          url: imageUrl,
          metadata: { generateImageResponse: imageData },
          status: MessageBlockStatus.SUCCESS
        }
      }

      if (!imageBlockId && blockManager.hasInitialPlaceholder) {
        imageBlockId = blockManager.initialPlaceholderBlockId
      }

      if (imageBlockId) {
        if (!imageData) {
          const changes: Partial<ImageMessageBlock> = {
            status: MessageBlockStatus.SUCCESS
          }
          blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
        } else {
          const changes = {
            type: MessageBlockType.IMAGE,
            ...(await buildImageBlockFields(imageData))
          }
          blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
        }
        imageBlockId = null
      } else {
        if (imageData) {
          const fields = await buildImageBlockFields(imageData)
          const imageBlock = createImageBlock(assistantMsgId, fields)
          await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
        } else {
          logger.error('[onImageGenerated] Last block was not an Image block or ID is missing.')
        }
      }
    },

    onImageSearched: async (content: string, metadata: Record<string, any>) => {
      if (!imageBlockId) {
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MessageBlockStatus.SUCCESS,
          metadata: {
            generateImageResponse: {
              type: 'base64',
              images: [`data:${metadata.mime};base64,${content}`]
            }
          }
        })
        await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
      }
    }
  }
}
