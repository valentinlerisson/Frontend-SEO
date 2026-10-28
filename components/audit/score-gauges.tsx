'use client'

import React from 'react'
import { scoreTone } from '@/lib/score-tone'

type CircularGaugeProps = {
  score: number // 0 - 100
  size?: number
  strokeWidth?: number
  /** Couleur de l'arc ; par défaut rouge, jaune ou vert selon le score */
  accentColor?: string
  trackColor?: string
  displayFormat?: 'percent' | 'fraction' // '78%' or '84/100'
  className?: string
}

export function CircularGauge({
  score,
  size = 140,
  strokeWidth = 14,
  accentColor,
  trackColor = 'var(--shade-3a)',
  displayFormat = 'percent',
  className = '',
}: CircularGaugeProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          style={{ stroke: trackColor }}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          style={{ stroke: accentColor ?? scoreTone(score).color }}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {displayFormat === 'percent' ? (
          <span className="text-4xl font-extrabold tracking-tight text-foreground">
            {score}
            <span className="text-2xl font-bold text-foreground/90">%</span>
          </span>
        ) : (
          <span className="text-3xl font-extrabold tracking-tight text-foreground">
            {score}
            <span className="text-xl font-medium text-muted-foreground">/100</span>
          </span>
        )}
      </div>
    </div>
  )
}

type SemiCircleGaugeProps = {
  score: number
  size?: number
  strokeWidth?: number
  accentColor?: string
  trackColor?: string
  label?: string
  className?: string
}

export function SemiCircleGauge({
  score,
  size = 180,
  strokeWidth = 16,
  accentColor,
  trackColor = 'var(--shade-3e)',
  label,
  className = '',
}: SemiCircleGaugeProps) {
  // Semicircle arc from 180° to 0° (or slightly wider: 200 degrees)
  const radius = (size - strokeWidth) / 2
  const arcLength = Math.PI * radius // semicircle perimeter
  const percent = Math.min(100, Math.max(0, score)) / 100
  const strokeDashoffset = arcLength * (1 - percent)

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="relative" style={{ width: size, height: size * 0.58 }}>
        <svg width={size} height={size * 0.62} viewBox={`0 0 ${size} ${size * 0.62}`} className="overflow-visible">
          {/* Background Track Arc */}
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            style={{ stroke: trackColor }}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {/* Foreground Progress Arc */}
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            style={{ stroke: accentColor ?? scoreTone(score).color }}
            strokeWidth={strokeWidth}
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex items-baseline justify-center">
          <span className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
            {score}
            <span className="text-2xl font-bold sm:text-3xl">%</span>
          </span>
        </div>
      </div>
      {label && <span className="mt-1 text-sm font-medium text-foreground sm:text-base">{label}</span>}
    </div>
  )
}
