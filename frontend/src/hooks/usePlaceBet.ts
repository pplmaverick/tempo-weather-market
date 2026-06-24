import { useState } from 'react'
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { parseUnits } from 'viem'
import { WEATHER_MARKET_ABI, ERC20_ABI, CONTRACTS, STABLECOINS } from '../config/contracts'
import { activeChain } from '../config/wagmi'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'
const contractAddress = CONTRACTS[network]
const { decimals } = STABLECOINS[network]

export function usePlaceBet() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [step, setStep] = useState<'idle' | 'approving' | 'betting' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const { data: stablecoin } = useReadContract({
    address: contractAddress,
    abi: WEATHER_MARKET_ABI,
    functionName: 'stablecoin',
    chainId: activeChain.id,
  })

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: stablecoin as `0x${string}` | undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address ?? '0x0000000000000000000000000000000000000000', contractAddress],
    chainId: activeChain.id,
    query: { enabled: !!stablecoin && !!address },
  })

  const { data: balance } = useReadContract({
    address: stablecoin as `0x${string}` | undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: activeChain.id,
    query: { enabled: !!stablecoin && !!address },
  })

  const { writeContractAsync } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  async function ensureChain() {
    if (chainId !== activeChain.id) {
      await switchChainAsync({ chainId: activeChain.id })
    }
  }

  async function placeBet(marketId: bigint, bucket: number, amountStr: string) {
    if (!address || !stablecoin) return
    setStep('idle')
    setErrorMsg('')
    try {
      await ensureChain()
      const amount = parseUnits(amountStr, decimals)
      if ((allowance ?? 0n) < amount) {
        setStep('approving')
        const approveTx = await writeContractAsync({
          address: stablecoin as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [contractAddress, amount],
          chainId: activeChain.id,
        })
        setTxHash(approveTx)
        await refetchAllowance()
      }
      setStep('betting')
      const betTx = await writeContractAsync({
        address: contractAddress,
        abi: WEATHER_MARKET_ABI,
        functionName: 'placeBet',
        args: [marketId, bucket, amount],
        chainId: activeChain.id,
      })
      setTxHash(betTx)
      setStep('done')
    } catch (e: unknown) {
      setStep('error')
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  async function claimWinnings(marketId: bigint) {
    if (!address) return
    setStep('idle')
    setErrorMsg('')
    try {
      await ensureChain()
      setStep('betting')
      const tx = await writeContractAsync({
        address: contractAddress,
        abi: WEATHER_MARKET_ABI,
        functionName: 'claimWinnings',
        args: [marketId],
        chainId: activeChain.id,
      })
      setTxHash(tx)
      setStep('done')
    } catch (e: unknown) {
      setStep('error')
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  return {
    placeBet,
    claimWinnings,
    step,
    errorMsg,
    isConfirming,
    balance: balance as bigint | undefined,
    stablecoin: stablecoin as `0x${string}` | undefined,
    reset: () => { setStep('idle'); setErrorMsg('') },
  }
}
