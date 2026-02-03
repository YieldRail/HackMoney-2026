'use client'

import { useState, useRef, useEffect } from 'react'
import { getCachedLogo, setCachedLogo } from '@/lib/logo-cache'

interface Option {
  value: string
  label: string
  logoURI?: string
}

interface CustomSelectProps {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function CustomSelect({ options, value, onChange, placeholder = 'Select...', className = '' }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [loadedLogos, setLoadedLogos] = useState<Set<string>>(new Set())
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(opt => opt.value === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (optionValue: string) => {
    onChange(optionValue)
    setIsOpen(false)
  }

  const loadLogo = (logoURI: string | undefined, key: string) => {
    if (!logoURI || loadedLogos.has(key)) return
    const cached = getCachedLogo(key)
    if (cached) {
      setLoadedLogos(prev => new Set(prev).add(key))
      return
    }
    const img = new Image()
    img.onload = () => {
      setCachedLogo(key, logoURI)
      setLoadedLogos(prev => new Set(prev).add(key))
    }
    img.onerror = () => {
      setLoadedLogos(prev => new Set(prev).add(key))
    }
    img.src = logoURI
  }

  useEffect(() => {
    options.forEach(opt => {
      if (opt.logoURI) {
        loadLogo(opt.logoURI, opt.value)
      }
    })
  }, [options])

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 pl-12 pr-10 focus:border-black focus:outline-none bg-white cursor-pointer hover:border-gray-400 transition-colors font-medium text-left flex items-center"
      >
        {selectedOption && selectedOption.logoURI && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
            <img
              src={getCachedLogo(selectedOption.value) || selectedOption.logoURI}
              alt={selectedOption.label}
              className="w-6 h-6 rounded-full object-cover border border-gray-200"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}
        <span className="flex-1">{selectedOption ? selectedOption.label : placeholder}</span>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border-2 border-black rounded-lg shadow-lg max-h-60 overflow-auto">
          {options.map((option) => {
            const logoUrl = getCachedLogo(option.value) || option.logoURI
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`w-full px-4 py-3 text-left hover:bg-gray-100 flex items-center gap-3 transition-colors ${
                  value === option.value ? 'bg-blue-50 font-medium' : ''
                }`}
              >
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt={option.label}
                    className="w-6 h-6 rounded-full object-cover border border-gray-200 flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <span className="flex-1">{option.label}</span>
                {value === option.value && (
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

