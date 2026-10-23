'use client'

import React from 'react'

type CircularGaugeProps = {
  score: number // 0 - 100
  size?: number
  strokeWidth?: number
  accentColor?: string // hex or tailwind class
  trackColor?: string
  displayFormat?: 'percent' | 'fraction' // '78%' or '84/100'
  className?: string
}

export function CircularGauge({
  score,
  size = 140,
  strokeWidth = 14,
  accentColor = '#f5e400',
  trackColor = '#3a3a3a',
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
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accentColor}
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
          <span className="text-4xl font-extrabold tracking-tight text-white">
            {score}
            <span className="text-2xl font-bold text-white/90">%</span>
          </span>
        ) : (
          <span className="text-3xl font-extrabold tracking-tight text-white">
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
  accentColor = '#f5e400',
  trackColor = '#3e3e3e',
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
            stroke={trackColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {/* Foreground Progress Arc */}
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            stroke={accentColor}
            strokeWidth={strokeWidth}
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex items-baseline justify-center">
          <span className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            {score}
            <span className="text-2xl font-bold sm:text-3xl">%</span>
          </span>
        </div>
      </div>
      {label && <span className="mt-1 text-sm font-medium text-foreground sm:text-base">{label}</span>}
    </div>
  )
}

export function TrendAreaChart({ className = '' }: { className?: string }) {
  return (
    <div className={`relative h-14 w-28 overflow-hidden rounded-md ${className}`}>
      <svg viewBox="0 0 100 50" className="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c5a830" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#7a671b" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <path
          d="M 0 35 Q 20 40 40 32 T 75 14 T 100 22 L 100 50 L 0 50 Z"
          fill="url(#areaGradient)"
        />
        <path
          d="M 0 35 Q 20 40 40 32 T 75 14 T 100 22"
          fill="none"
          stroke="#f5e400"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <line x1="75" y1="14" x2="75" y2="50" stroke="#f5e400" strokeWidth="1" strokeDasharray="2 2" />
        <circle cx="75" cy="14" r="3.5" fill="#f5e400" />
      </svg>
    </div>
  )
}
