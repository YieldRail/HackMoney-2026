'use client'

interface TransactionLoaderProps {
  step: 'idle' | 'approving' | 'swapping' | 'bridging' | 'depositing' | 'complete'
  status?: string | null
  txHashes?: {
    swap?: string
    bridge?: string
    deposit?: string
  }
}

export function TransactionLoader({ step, status, txHashes }: TransactionLoaderProps) {
  if (step === 'idle') return null

  const steps = [
    { key: 'approving', label: 'Approving', icon: '✓' },
    { key: 'swapping', label: 'Swapping', icon: '↻' },
    { key: 'bridging', label: 'Bridging', icon: '🌉' },
    { key: 'depositing', label: 'Depositing', icon: '💾' },
    { key: 'complete', label: 'Complete', icon: '✓' },
  ]

  const currentStepIndex = steps.findIndex(s => s.key === step)
  const isComplete = step === 'complete'

  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isComplete ? 'bg-green-500' : 'bg-blue-500 animate-pulse'}`}></div>
        <p className="font-medium text-blue-900">{status || 'Processing transaction...'}</p>
      </div>

      <div className="space-y-2">
        {steps.map((s, index) => {
          const isActive = index === currentStepIndex
          const isCompleted = index < currentStepIndex || isComplete
          const showStep = index <= currentStepIndex

          if (!showStep) return null

          return (
            <div key={s.key} className="flex items-center gap-3 text-sm">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                isCompleted ? 'bg-green-500 text-white' : isActive ? 'bg-blue-500 text-white animate-pulse' : 'bg-gray-200 text-gray-500'
              }`}>
                {isCompleted ? '✓' : s.icon}
              </div>
              <span className={isActive ? 'font-medium text-blue-900' : isCompleted ? 'text-green-700' : 'text-gray-500'}>
                {s.label}
              </span>
              {isActive && !isCompleted && (
                <div className="ml-auto">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {txHashes && (txHashes.swap || txHashes.bridge || txHashes.deposit) && (
        <div className="pt-2 border-t border-blue-200 space-y-1 text-xs">
          {txHashes.swap && (
            <div className="text-blue-700">
              Swap: <span className="font-mono">{txHashes.swap.slice(0, 10)}...{txHashes.swap.slice(-8)}</span>
            </div>
          )}
          {txHashes.bridge && (
            <div className="text-blue-700">
              Bridge: <span className="font-mono">{txHashes.bridge.slice(0, 10)}...{txHashes.bridge.slice(-8)}</span>
            </div>
          )}
          {txHashes.deposit && (
            <div className="text-blue-700">
              Deposit: <span className="font-mono">{txHashes.deposit.slice(0, 10)}...{txHashes.deposit.slice(-8)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

