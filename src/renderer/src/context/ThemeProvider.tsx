import { isMac, isWin } from '@renderer/config/constant'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { ThemeMode } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { PropsWithChildren } from 'react'
import React, { createContext, use, useEffect, useState } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  settedTheme: ThemeMode
  toggleTheme: () => void
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.system,
  settedTheme: ThemeMode.dark,
  toggleTheme: () => {},
  setTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

const tailwindThemeChange = (theme: ThemeMode) => {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // 用户设置的主题
  const { theme: settedTheme, setTheme: setSettedTheme, language } = useSettings()
  const [actualTheme, setActualTheme] = useState<ThemeMode>(ThemeMode.dark)
  const { initUserTheme } = useUserTheme()
  const { navbarPosition } = useNavbarPosition()

  const toggleTheme = () => {
    const themeOrder = [ThemeMode.dark, ThemeMode.light, ThemeMode.blackhole, ThemeMode.system]
    const currentIndex = themeOrder.indexOf(settedTheme)
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length]
    setSettedTheme(nextTheme)
  }

  useEffect(() => {
    // Set initial theme and OS attributes on body
    document.body.setAttribute('os', isMac ? 'mac' : isWin ? 'windows' : 'linux')

    // Blackhole theme: use dark as base + add blackhole-theme class
    if (settedTheme === ThemeMode.blackhole) {
      document.body.setAttribute('theme-mode', ThemeMode.dark)
      document.body.classList.add('blackhole-theme')
      document.body.classList.remove('light', 'dark')
      setActualTheme(ThemeMode.dark)
    } else {
      document.body.classList.remove('blackhole-theme')
      document.body.setAttribute('theme-mode', actualTheme)
      if (actualTheme === ThemeMode.dark) {
        document.body.classList.remove('light')
        document.body.classList.add('dark')
      } else {
        document.body.classList.remove('dark')
        document.body.classList.add('light')
      }
    }
    document.body.setAttribute('navbar-position', navbarPosition)
    document.documentElement.lang = language

    // 强制默认深色：把所有非 dark/light/blackhole 值转为 dark
    if (settedTheme !== ThemeMode.dark && settedTheme !== ThemeMode.light && settedTheme !== ThemeMode.blackhole) {
      setSettedTheme(ThemeMode.dark)
    }

    initUserTheme()

    // listen for theme updates from main process
    return window.electron.ipcRenderer.on(IpcChannel.ThemeUpdated, (_, actualTheme: ThemeMode) => {
      document.body.setAttribute('theme-mode', actualTheme)
      setActualTheme(actualTheme)
    })
  }, [actualTheme, initUserTheme, language, navbarPosition, setSettedTheme, settedTheme])

  useEffect(() => {
    tailwindThemeChange(actualTheme)
  }, [actualTheme])

  useEffect(() => {
    void window.api.setTheme(settedTheme)
  }, [settedTheme])

  return (
    <ThemeContext value={{ theme: actualTheme, settedTheme, toggleTheme, setTheme: setSettedTheme }}>
      {children}
    </ThemeContext>
  )
}

export const useTheme = () => use(ThemeContext)
