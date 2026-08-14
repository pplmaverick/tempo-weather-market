import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { decodeEventLog } from 'viem'
import { WEATHER_MARKET_ABI, CONTRACTS } from '../config/contracts'
import { activeChain } from '../config/wagmi'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'
const contractAddress = CONTRACTS[network]

export function useIsOwner() {
  const { address } = useAccount()
  const { data: owner, isLoading } = useReadContract({
    address: contractAddress,
    abi: WEATHER_MARKET_ABI,
    functionName: 'owner',
    chainId: activeChain.id,
  })

  const ownerAddress = owner as `0x${string}` | undefined
  const isOwner = !!address && !!ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase()

  return { isOwner, ownerAddress, isLoading }
}

type Step = 'idle' | 'pending' | 'confirming' | 'done' | 'error'

export function useCreateMarket() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [step, setStep] = useState<Step>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [marketId, setMarketId] = useState<bigint | undefined>()
  const [errorMsg, setErrorMsg] = useState('')

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  if (receipt && step !== 'done' && step !== 'error') {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: WEATHER_MARKET_ABI, data: log.data, topics: log.topics, eventName: 'MarketCreated' })
        setMarketId((decoded.args as { marketId: bigint }).marketId)
        break
      } catch { /* not the event we're looking for */ }
    }
    setStep('done')
  }

  async function createMarket(city: string, predictionType: string, targetDate: bigint, buckets: bigint[], lockTime: bigint) {
    setStep('pending'); setErrorMsg(''); setTxHash(undefined); setMarketId(undefined)
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id })
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: WEATHER_MARKET_ABI,
        functionName: 'createMarket',
        args: [city, predictionType, targetDate, buckets, lockTime],
        chainId: activeChain.id,
      })
      setTxHash(hash)
      setStep('confirming')
    } catch (e: unknown) {
      setStep('error')
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  return { createMarket, step: isConfirming ? 'confirming' : step, txHash, marketId, errorMsg, reset: () => { setStep('idle'); setTxHash(undefined); setMarketId(undefined); setErrorMsg('') } }
}

export function useLockMarket() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [step, setStep] = useState<Step>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [errorMsg, setErrorMsg] = useState('')
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  async function lockMarket(marketId: bigint) {
    setStep('pending'); setErrorMsg(''); setTxHash(undefined)
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id })
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: WEATHER_MARKET_ABI,
        functionName: 'lockMarket',
        args: [marketId],
        chainId: activeChain.id,
      })
      setTxHash(hash)
      setStep('done')
    } catch (e: unknown) {
      setStep('error')
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  return { lockMarket, step: isConfirming ? 'confirming' : step, txHash, errorMsg, reset: () => { setStep('idle'); setTxHash(undefined); setErrorMsg('') } }
}

export function useSubmitResult() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [step, setStep] = useState<Step>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [errorMsg, setErrorMsg] = useState('')
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  async function submitResult(marketId: bigint, finalTemp: bigint, memo: string) {
    setStep('pending'); setErrorMsg(''); setTxHash(undefined)
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id })
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: WEATHER_MARKET_ABI,
        functionName: 'submitResult',
        args: [marketId, finalTemp, memo],
        chainId: activeChain.id,
      })
      setTxHash(hash)
      setStep('done')
    } catch (e: unknown) {
      setStep('error')
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  return { submitResult, step: isConfirming ? 'confirming' : step, txHash, errorMsg, reset: () => { setStep('idle'); setTxHash(undefined); setErrorMsg('') } }
}
