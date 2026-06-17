import { cn } from '@renderer/utils'
import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import React, { memo } from 'react'

interface ActionIconButtonProps extends ButtonProps {
  children: React.ReactNode
  active?: boolean
}

/**
 * A simple action button rendered as an icon
 * Blackhole-enhanced: photon ring on hover, event horizon ring on active, gravitational lensing glow
 *
 * Shape philosophy:
 * - Default: clean circle (black hole shadow)
 * - Hover:   1.5px photon ring forms + lensing glow
 * - Active:  2px event horizon ring + accretion disk glow
 */
const ActionIconButton: React.FC<ActionIconButtonProps> = ({ children, active, className, ...props }) => {
  return (
    <Button
      type="text"
      shape="circle"
      className={cn(
        '[&_.icon-a-addchat]:-mb-0.5 flex h-7 w-7 cursor-pointer flex-row items-center justify-center border-none p-0 text-base transition-all duration-300 ease-in-out [&_.anticon]:text-icon [&_.icon-a-addchat]:text-lg [&_.icon]:text-icon [&_.iconfont]:text-icon [&_.lucide]:text-icon',
        // Hover: photon ring (1.5px spread, no blur) + gravitational lensing
        'hover:[&_.anticon]:text-primary/70 hover:[&_.icon]:text-primary/70 hover:[&_.iconfont]:text-primary/70 hover:[&_.lucide]:text-primary/70 hover:bg-primary/5 hover:shadow-[0_0_0_1.5px_var(--color-primary),0_0_16px_-6px_var(--color-primary),inset_0_0_8px_-6px_var(--color-primary)]',
        // Active: event horizon ring (2px) + accretion disk glow
        active &&
          '[&_.anticon]:text-primary! [&_.icon]:text-primary! [&_.iconfont]:text-primary! [&_.lucide]:text-primary! bg-primary/8 shadow-[0_0_0_2px_var(--color-primary),0_0_24px_-6px_var(--color-primary),inset_0_0_14px_-6px_var(--color-primary)]',
        className
      )}
      {...props}>
      {children}
    </Button>
  )
}

export default memo(ActionIconButton)
