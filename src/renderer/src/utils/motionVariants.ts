import type { Variants } from 'motion/react'

/** 黑洞吸积盘脉冲 — 模拟物质坠入事件视界时的明灭闪烁 */
export const lightbulbVariants: Variants = {
  active: {
    scale: [1, 1.15, 1],
    opacity: [1, 0.6, 1],
    filter: ['brightness(1)', 'brightness(1.6)', 'brightness(1)'],
    transition: {
      duration: 1.8,
      ease: 'easeInOut',
      times: [0, 0.5, 1],
      repeat: Infinity
    }
  },
  idle: {
    scale: 1,
    opacity: 1,
    filter: 'brightness(1)',
    transition: {
      duration: 0.3,
      ease: 'easeInOut'
    }
  }
}

/** 外层吸积盘旋转光晕 */
export const accretionVariants: Variants = {
  active: {
    rotate: [0, 360],
    transition: {
      duration: 4,
      ease: 'linear',
      repeat: Infinity
    }
  },
  idle: {
    rotate: 0,
    transition: { duration: 0.3 }
  }
}

export const lightbulbSoftVariants: Variants = {
  active: {
    opacity: [1, 0.5, 1],
    transition: {
      duration: 2,
      ease: 'easeInOut',
      times: [0, 0.5, 1],
      repeat: Infinity
    }
  },
  idle: {
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: 'easeInOut'
    }
  }
}
