'use client'

interface TransactionLoaderProps {
  step: 'idle' | 'approving' | 'swapping' | 'bridging' | 'depositing' | 'complete'
  status?: string | null
  txHashes?: {
    approve?: string
    swap?: string
    bridge?: string
    deposit?: string
  }
  sourceChainId?: number
}

const getExplorerUrl = (hash: string, chainId?: number): string => {
  const explorers: Record<number, string> = {
    1: 'https://etherscan.io/tx/',
    43114: 'https://snowtrace.io/tx/',
    8453: 'https://basescan.org/tx/',
    10: 'https://optimistic.etherscan.io/tx/',
    42161: 'https://arbiscan.io/tx/',
    56: 'https://bscscan.com/tx/',
  }
  const base = explorers[chainId || 1] || 'https://etherscan.io/tx/'
  return `${base}${hash}`
}

export function TransactionLoader({ step, status, txHashes, sourceChainId }: TransactionLoaderProps) {
  if (step === 'idle') return null

  const steps = [
    { key: 'approving', label: 'Sign Deposit Intent & Approve', icon: '✍️' },
    { key: 'bridging', label: 'Bridge + Deposit (via LI.FI)', icon: '🌉' },
    { key: 'depositing', label: 'Confirming on Destination', icon: '💰' },
    { key: 'complete', label: 'Shares Received!', icon: '✅' },
  ]

  const currentStepIndex = steps.findIndex(s => s.key === step)
  const isComplete = step === 'complete'

  return (
    <div className={`border-2 rounded-lg p-4 space-y-3 ${isComplete ? 'bg-green-50 border-green-300' : 'bg-blue-50 border-blue-200'}`}>
      <div className="flex items-center gap-2">
        {!isComplete && (
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        )}
        {isComplete && (
          <div className="text-2xl">🎉</div>
        )}
        <p className={`font-semibold ${isComplete ? 'text-green-800' : 'text-blue-900'}`}>
          {status || 'Processing transaction...'}
        </p>
      </div>

      {/* Progress Bar */}
      <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
        <div 
          className={`absolute left-0 top-0 h-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
        />
      </div>

      <div className="space-y-2">
        {steps.map((s, index) => {
          const isActive = index === currentStepIndex
          const isCompleted = index < currentStepIndex || isComplete
          const showStep = s.key === 'approving' 
            ? (txHashes?.approve || step === 'approving' || index <= currentStepIndex) 
            : index <= currentStepIndex

          if (!showStep) return null

          return (
            <div key={s.key} className="flex items-center gap-3 text-sm">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm transition-colors ${
                isCompleted ? 'bg-green-500 text-white' : isActive ? 'bg-blue-500 text-white animate-pulse' : 'bg-gray-200 text-gray-500'
              }`}>
                {isCompleted ? '✓' : s.icon}
              </div>
              <span className={`flex-1 ${isActive ? 'font-semibold text-blue-900' : isCompleted ? 'text-green-700' : 'text-gray-500'}`}>
                {s.label}
              </span>
              {isActive && !isCompleted && (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              )}
              {isCompleted && <span className="text-green-600 text-xs font-medium">Done</span>}
            </div>
          )
        })}
      </div>

      {txHashes && (txHashes.approve || txHashes.swap || txHashes.bridge || txHashes.deposit) && (
        <div className="pt-3 border-t border-blue-200 space-y-1">
          <p className="text-xs text-gray-600 font-medium mb-2">Transaction Hashes:</p>
          {txHashes.approve && (
            <div className="text-xs flex items-center gap-2">
              <span className="text-gray-600 w-16">Approve:</span>
              <a href={getExplorerUrl(txHashes.approve, sourceChainId)} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline">
                {txHashes.approve.slice(0, 10)}...{txHashes.approve.slice(-6)}
              </a>
              <span className="text-green-600">✓</span>
            </div>
          )}
          {txHashes.bridge && (
            <div className="text-xs flex items-center gap-2">
              <span className="text-gray-600 w-16">Bridge:</span>
              <a href={getExplorerUrl(txHashes.bridge, sourceChainId)} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline">
                {txHashes.bridge.slice(0, 10)}...{txHashes.bridge.slice(-6)}
              </a>
              {step === 'complete' || step === 'depositing' ? <span className="text-green-600">✓</span> : <span className="text-blue-500">⏳</span>}
            </div>
          )}
          {txHashes.deposit && (
            <div className="text-xs flex items-center gap-2">
              <span className="text-gray-600 w-16">Deposit:</span>
              <a href={getExplorerUrl(txHashes.deposit, 43114)} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline">
                {txHashes.deposit.slice(0, 10)}...{txHashes.deposit.slice(-6)}
              </a>
              <span className="text-green-600">✓</span>
            </div>
          )}
        </div>
      )}

      {/* LI.FI Explorer Link */}
      {txHashes?.bridge && (
        <div className="pt-2 border-t border-blue-200">
          <a 
            href={`https://scan.li.fi/tx/${txHashes.bridge}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-purple-600 hover:underline flex items-center gap-1"
          >
            Track on LI.FI Explorer ↗
          </a>
        </div>
      )}
    </div>
  )
}

