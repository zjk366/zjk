/**
 * 全局拖拽上传 Hook
 *
 * 封装文件和文件夹的拖拽解析逻辑，提供状态管理和回调。
 * 通过 Context 向子组件暴露拖拽状态。
 */
import { loggerService } from '@logger'
import type { DragUploadContextValue, DragUploadResult, DragUploadStatus } from '@renderer/types/dragUpload'
import { parseDragData } from '@renderer/utils/dragUploadUtils'
import type { FC, PropsWithChildren } from 'react'
import React, { createContext, createElement, use, useCallback, useRef, useState } from 'react'

const logger = loggerService.withContext('useDragUpload')

// --- Context ---

const DragUploadCtx = createContext<DragUploadContextValue>({
  status: 'idle',
  result: null,
  isDragging: false,
  error: null,
  clear: () => {},
  confirm: () => {},
})

export const useDragUploadContext = () => use(DragUploadCtx)

// --- Provider Component ---

interface DragUploadProviderProps extends PropsWithChildren {
  onConfirm?: (result: DragUploadResult) => void
}

export const DragUploadProvider: FC<DragUploadProviderProps> = ({ children, onConfirm }) => {
  const [status, setStatus] = useState<DragUploadStatus>('idle')
  const [result, setResult] = useState<DragUploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dragCounter = useRef(0)

  const isDragging = status === 'dragging'

  const clear = useCallback(() => {
    setStatus('idle')
    setResult(null)
    setError(null)
    dragCounter.current = 0
  }, [])

  const confirm = useCallback(() => {
    if (result && onConfirm) {
      setStatus('uploading')
      onConfirm(result)
    }
  }, [result, onConfirm])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current++
    if (dragCounter.current === 1) {
      setStatus('dragging')
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setStatus('idle')
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0

    if (!e.dataTransfer.types.includes('Files')) {
      setStatus('idle')
      return
    }

    setStatus('parsing')
    setError(null)

    try {
      const parsed = await parseDragData(e.dataTransfer)
      if (parsed.totalFiles === 0) {
        setStatus('idle')
        setError('未找到可上传的文件')
        return
      }
      setResult(parsed)
      setStatus('ready')
      logger.info(`Parsed drag upload: ${parsed.totalFiles} files, ${parsed.totalFolders} folders`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '解析文件失败'
      logger.error('Drag upload parse error:', err)
      setError(message)
      setStatus('error')
    }
  }, [])

  const contextValue: DragUploadContextValue = {
    status,
    result,
    isDragging,
    error,
    clear,
    confirm,
  }

  return createElement(
    DragUploadCtx.Provider,
    { value: contextValue },
    createElement(DragUploadEvents, {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      children,
    })
  )
}

// --- Inner event wrapper ---

interface DragUploadEventsProps extends PropsWithChildren {
  onDragEnter: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

const DragUploadEvents: FC<DragUploadEventsProps> = (props) => {
  return createElement('div', {
    onDragEnter: props.onDragEnter,
    onDragOver: props.onDragOver,
    onDragLeave: props.onDragLeave,
    onDrop: props.onDrop,
    style: { display: 'contents' },
  }, props.children)
}

export default DragUploadProvider
