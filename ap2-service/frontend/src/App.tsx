import { useState, useEffect, useRef } from 'react';
import { useAccount, useConnect, useDisconnect, useSignTypedData, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Wallet, MessageSquare, DollarSign, CheckCircle, AlertCircle, ExternalLink, Cpu, X } from 'lucide-react';
import { apiClient } from './api';
import type { IntentMandate, ChatMessage, InferenceResponse, SettlementAuthorization } from './types';
import { parseUnits } from 'viem';

const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS;
const MERCHANT_ADDRESS = import.meta.env.VITE_MERCHANT_ADDRESS;

if (!USDC_ADDRESS) {
  throw new Error('VITE_USDC_ADDRESS environment variable is not set');
}
if (!MERCHANT_ADDRESS) {
  throw new Error('VITE_MERCHANT_ADDRESS environment variable is not set');
}

const APPROVAL_AMOUNT = parseUnits('2', 6); // 2 USDC approval (covers ~100 messages including fees)

function App() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContract, data: hash, isPending: isApproving } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash });

  const [mandate, setMandate] = useState<IntentMandate | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingMandate, setIsCreatingMandate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceHealth, setServiceHealth] = useState<any>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [hasApproved, setHasApproved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const creationInProgressRef = useRef(false);
  const [settlementToast, setSettlementToast] = useState<{ txHash: string; explorerUrl: string } | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<SettlementAuthorization | null>(null);
  const [isSettling, setIsSettling] = useState(false);

  // Check service health on mount
  useEffect(() => {
    apiClient.checkHealth()
      .then(setServiceHealth)
      .catch(err => console.error('Health check failed:', err));
  }, []);

  // create mandate when wallet connects, reset when disconnects
  useEffect(() => {
    if (isConnected && address && !mandate && !isCreatingMandate && !creationInProgressRef.current) {
      console.log('Triggering mandate creation...');
      createMandate();
    } else if (!isConnected) {
      // reset state when wallet disconnects
      setMandate(null);
      setMessages([]);
      setError(null);
      creationInProgressRef.current = false;
    }
  }, [isConnected, address, mandate, isCreatingMandate]);

  const createMandate = async () => {
    if (!address || isCreatingMandate || mandate || creationInProgressRef.current) return;

    try {
      creationInProgressRef.current = true;
      setIsCreatingMandate(true);
      setIsSigning(true);
      setError(null);
      
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // create unsigned mandate
      const result = await apiClient.createMandate({
        userAddress: address,
        sessionId,
      });

      // request user signature
      console.log('Requesting mandate signature from user...');
      // convert string values back to BigInt for signing
      const messageForSigning = {
        ...result.signingData.message,
        dailyCapMicroUsdc: BigInt(result.signingData.message.dailyCapMicroUsdc),
        pricePerMessageMicroUsdc: BigInt(result.signingData.message.pricePerMessageMicroUsdc),
        batchThreshold: BigInt(result.signingData.message.batchThreshold),
        expiresAt: BigInt(result.signingData.message.expiresAt),
      };
      
      const signature = await signTypedDataAsync({
        domain: result.signingData.domain,
        types: result.signingData.types,
        primaryType: result.signingData.primaryType,
        message: messageForSigning,
      });

      setIsSigning(false);

      // submit signed mandate
      const signedResult = await apiClient.submitSignedMandate({
        unsignedMandate: result.unsignedMandate,
        signature,
      });

      setMandate(signedResult.mandate);
      
      // welcome message
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Welcome! Each message costs $${(signedResult.mandate.pricePerMessageMicroUsdc / 1000000).toFixed(4)} USDC, and settlement will occur every ${signedResult.mandate.batchThreshold} messages.`,
        timestamp: Date.now(),
      }]);
    } catch (err) {
      setIsSigning(false);
      if (err instanceof Error && err.message.includes('User rejected')) {
        setError('You must sign the Intent Mandate to use the service');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create mandate');
      }
    } finally {
      creationInProgressRef.current = false;
      setIsCreatingMandate(false);
    }
  };

  const approveUSDC = () => {
    writeContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: [{
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      }],
      functionName: 'approve',
      args: [MERCHANT_ADDRESS as `0x${string}`, APPROVAL_AMOUNT],
    });
  };

  // track approval success
  useEffect(() => {
    if (isApproved) {
      setHasApproved(true);
    }
  }, [isApproved]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || !mandate || !address || isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: inputMessage,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);
    setError(null);

    try {
      const response: InferenceResponse = await apiClient.sendInference({
        mandateId: mandate.mandateId,
        userAddress: address,
        prompt: inputMessage,
      });

      const assistantMessage: ChatMessage = {
        id: response.eventId,
        role: 'assistant',
        content: response.response,
        timestamp: Date.now(),
        eventId: response.eventId,
        priceMicroUsdc: response.priceMicroUsdc,
        settlementInfo: response.settlementTriggered && response.transactionHash ? {
          batchId: response.batchId!,
          transactionHash: response.transactionHash,
          explorerUrl: response.explorerUrl!,
        } : undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Handle settlement signing if needed
      if (response.needsSignature && response.settlementAuthorization) {
        console.log('Settlement signature required');
        setPendingSettlement(response.settlementAuthorization);
        await handleSettlementSigning(response.settlementAuthorization);
      }
      
      // show settlement toast notification if triggered
      else if (response.settlementTriggered && response.transactionHash && response.explorerUrl) {
        setSettlementToast({
          txHash: response.transactionHash,
          explorerUrl: response.explorerUrl,
        });
        
        // auto-dismiss after 10 seconds
        setTimeout(() => setSettlementToast(null), 10000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      
      const errorMessage: ChatMessage = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to send message'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleSettlementSigning = async (auth: SettlementAuthorization) => {
    if (!address) return;
    
    try {
      setIsSettling(true);
      console.log('Requesting settlement signature from user...');
      console.log('Authorization to sign:', {
        from: auth.from,
        to: auth.to,
        value: auth.value,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        nonce: auth.nonce,
      });
      console.log('Domain:', auth.domain);
      
      // Prompt user to sign EIP-3009 authorization
      const signature = await signTypedDataAsync({
        domain: {
          ...auth.domain,
          verifyingContract: auth.domain.verifyingContract as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: auth.from as `0x${string}`,
          to: auth.to as `0x${string}`,
          value: BigInt(auth.value),
          validAfter: BigInt(auth.validAfter),
          validBefore: BigInt(auth.validBefore),
          nonce: auth.nonce as `0x${string}`,
        },
      });
      
      console.log('Settlement signature obtained, completing settlement...');
      
      // Complete settlement with signature AND the authorization data that was signed
      // Only send the core fields (without domain) that the facilitator needs
      const result = await apiClient.completeSettlement({
        batchId: auth.batchId,
        signature,
        userAddress: address,
        authorization: {
          batchId: auth.batchId,
          from: auth.from,
          to: auth.to,
          value: auth.value,
          validAfter: auth.validAfter,
          validBefore: auth.validBefore,
          nonce: auth.nonce,
        },
      });
      
      if (result.success) {
        console.log('Settlement completed successfully:', result.transactionHash);
        
        // Update the last assistant message with settlement info
        setMessages(prev => {
          const updated = [...prev];
          // Find the last assistant message and add settlement info
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === 'assistant') {
              updated[i] = {
                ...updated[i],
                settlementInfo: {
                  batchId: auth.batchId,
                  transactionHash: result.transactionHash,
                  explorerUrl: result.explorerUrl,
                },
              };
              break;
            }
          }
          return updated;
        });
        
        // Show toast notification
        setSettlementToast({
          txHash: result.transactionHash,
          explorerUrl: result.explorerUrl,
        });
        setTimeout(() => setSettlementToast(null), 10000);
      }
      
      setPendingSettlement(null);
    } catch (err) {
      console.error('Settlement signing failed:', err);
      setError(err instanceof Error ? err.message : 'Settlement signing failed');
    } finally {
      setIsSettling(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // check if on correct network (Arbitrum One)
  const isCorrectNetwork = chain?.id === 42161;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-slate-950 shadow-2xl border-b-2 border-slate-700 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 animate-fade-in-up">
              <div className="p-2 bg-gradient-to-br from-[#28A0F0]/20 to-[#12AAFF]/20 rounded-xl border border-[#28A0F0]/30">
                <MessageSquare className="w-8 h-8 text-[#28A0F0] drop-shadow-[0_0_8px_rgba(40,160,240,0.8)]" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">Private AI with Intent-Based Payments</h1>
                <p className="text-sm text-slate-300 font-medium">AP2 x x402 Demo on Arbitrum One</p>
              </div>
            </div>

            {/* Wallet Connection */}
            <div className="flex items-center space-x-4">
              {serviceHealth && (
                <div className="flex items-center space-x-2 text-sm bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    serviceHealth.services.ollama === 'healthy' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)] animate-pulse' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'
                  }`} />
                  <span className="text-slate-200 font-medium">Ollama</span>
                </div>
              )}

              {isConnected ? (
                <div className="flex items-center space-x-3">
                  {!isCorrectNetwork && (
                    <div className="flex items-center space-x-2 px-3 py-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm">
                      <AlertCircle className="w-4 h-4" />
                      <span>Switch to Arbitrum One</span>
                    </div>
                  )}
                  <div className="flex items-center space-x-2 px-4 py-2 bg-[#28A0F0]/20 text-[#28A0F0] rounded-lg border-2 border-[#28A0F0]/40 shadow-lg shadow-[#28A0F0]/20 hover:shadow-xl hover:shadow-[#28A0F0]/30 hover:scale-105">
                    <Wallet className="w-4 h-4" />
                    <span className="font-mono text-sm font-bold">
                      {address?.substring(0, 6)}...{address?.substring(38)}
                    </span>
                  </div>
                  <button
                    onClick={() => disconnect()}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-semibold transition-all border-2 border-slate-600 hover:border-slate-500 hover:shadow-lg hover:scale-105"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => connect({ connector: connectors[0] })}
                  className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-[#28A0F0] to-[#12AAFF] hover:from-[#12AAFF] hover:to-[#28A0F0] text-white rounded-xl font-bold text-base transition-all shadow-xl shadow-[#28A0F0]/40 hover:shadow-2xl hover:shadow-[#28A0F0]/60 hover:scale-110 border-2 border-[#28A0F0]/30 animate-glow-pulse"
                >
                  <Wallet className="w-5 h-5" />
                  <span>Connect Wallet</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isConnected ? (
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in-up">
            <div className="p-6 bg-gradient-to-br from-[#28A0F0]/20 to-[#12AAFF]/20 rounded-3xl border-2 border-[#28A0F0]/30 mb-6 shadow-2xl shadow-[#28A0F0]/20 animate-float">
              <Wallet className="w-20 h-20 text-[#28A0F0] drop-shadow-[0_0_15px_rgba(40,160,240,0.9)]" />
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-3 tracking-tight">Connect Your Wallet</h2>
            <p className="text-slate-200 text-center max-w-md text-lg font-medium">
              Connect your Arbitrum One wallet to start chatting with AI. Each message is metered and settled onchain via the x402 protocol.
            </p>
          </div>
        ) : isSigning ? (
          <div className="flex flex-col items-center justify-center py-20 animate-scale-in">
            <div className="p-6 bg-gradient-to-br from-[#28A0F0]/20 to-[#12AAFF]/20 rounded-3xl border-2 border-[#28A0F0]/30 mb-6 shadow-2xl shadow-[#28A0F0]/40 animate-glow-pulse">
              <CheckCircle className="w-24 h-24 text-[#28A0F0] drop-shadow-[0_0_20px_rgba(40,160,240,1)] animate-pulse" />
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-3 tracking-tight">Sign Intent Mandate</h2>
            <p className="text-slate-200 text-center max-w-md text-lg font-medium">
              Please sign the Intent Mandate in your wallet to authorize AI inference payments. This is a one-time signature that enables gasless settlements via EIP-3009.
            </p>
          </div>
        ) : isCreatingMandate ? (
          <div className="flex flex-col items-center justify-center py-20 animate-scale-in">
            <div className="p-6 bg-gradient-to-br from-[#28A0F0]/20 to-[#12AAFF]/20 rounded-3xl border-2 border-[#28A0F0]/30 mb-6 shadow-2xl shadow-[#28A0F0]/40 animate-glow-pulse">
              <Cpu className="w-24 h-24 text-[#28A0F0] drop-shadow-[0_0_20px_rgba(40,160,240,1)] animate-spin" />
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-3 tracking-tight">Creating Mandate...</h2>
            <p className="text-slate-200 text-center max-w-md text-lg font-medium">
              Setting up your Intent Mandate for AI inference payments.
            </p>
          </div>
        ) : !mandate ? (
          <div className="py-12">
            {/* Section Header */}
            <div className="mb-10 animate-fade-in-up">
              <h2 className="text-5xl font-extrabold text-white mb-3 tracking-tight">How It Works</h2>
              <p className="text-slate-300 text-xl font-medium">Understanding the technology powering this demo</p>
            </div>

            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up">
                <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                  <MessageSquare className="w-7 h-7 mr-2" />
                  AP2 Metered AI
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  <strong className="text-white">Agent Payments Protocol (AP2)</strong> is an open protocol for secure agent commerce. 
                  It uses verifiable digital credentials (Intent Mandates) to enable AI agents to make payments on your behalf.
                  <br /><br />
                  <span className="text-slate-400 italic">In this demo:</span> Each message costs $0.0001 USDC, metered and batched for settlement.
                </p>
              </div>

              <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up" style={{"animationDelay": "0.1s"}}>
                <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                  <CheckCircle className="w-7 h-7 mr-2" />
                  x402 Settlement
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  <strong className="text-white">x402 protocol</strong> is an open standard for internet-native payments built around HTTP 402. 
                  It enables instant, blockchain-agnostic settlements with zero protocol fees.
                  <br /><br />
                  <span className="text-slate-400 italic">In this demo:</span> Every 5 messages, your payment is settled onchain in seconds via a facilitator.
                </p>
              </div>

              <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up" style={{"animationDelay": "0.2s"}}>
                <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                  <Wallet className="w-7 h-7 mr-2" />
                  Intent Mandates
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  <strong className="text-white">Intent Mandates</strong> are verifiable digital credentials that capture conditions under which an AI agent can make purchases on your behalf. 
                  They enable "human-not-present" transactions with pre-authorized spending limits.
                  <br /><br />
                  <span className="text-slate-400 italic">In this demo:</span> Your mandate is cryptographically signed and caps spending at 2 USDC daily.
                </p>
              </div>

              <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up" style={{"animationDelay": "0.3s"}}>
                <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                  <Cpu className="w-7 h-7 mr-2" />
                  Local AI Model
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  <strong className="text-white">Complete privacy.</strong> All AI processing happens locally via Ollama. 
                  No data leaves your machine - your conversations remain private.
                  <br /><br />
                  <span className="text-slate-400 italic">In this demo:</span> Running llama3.1:8b via Docker for fast, private responses.
                </p>
              </div>
            </div>

            <div className="mt-10 text-center animate-fade-in-up" style={{"animationDelay": "0.4s"}}>
              <p className="text-slate-200 mb-6 text-lg font-medium">Ready to start? Connect your wallet above to begin.</p>
              <div className="space-y-4">
                <div className="inline-flex items-center space-x-3 text-blue-400 bg-blue-400/20 px-6 py-3 rounded-xl border-2 border-blue-400/30 shadow-lg hover:scale-105 transition-all">
                  <CheckCircle className="w-6 h-6" />
                  <span className="font-bold text-base">Step 1: Sign Intent Mandate (AP2 compliant)</span>
                </div>
                <div className="inline-flex items-center space-x-3 text-purple-400 bg-purple-400/20 px-6 py-3 rounded-xl border-2 border-purple-400/30 shadow-lg hover:scale-105 transition-all">
                  <CheckCircle className="w-6 h-6" />
                  <span className="font-bold text-base">Step 2: Approve USDC (one-time)</span>
                </div>
                <div className="inline-flex items-center space-x-3 text-green-400 bg-green-400/20 px-6 py-3 rounded-xl border-2 border-green-400/30 shadow-lg hover:scale-105 transition-all">
                  <CheckCircle className="w-6 h-6" />
                  <span className="font-bold text-base">Step 3: Chat - automatic settlements!</span>
                </div>
              </div>
            </div>
          </div>
        ) : !isCorrectNetwork ? (
          <div className="flex flex-col items-center justify-center py-20 animate-scale-in">
            <div className="p-6 bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-3xl border-2 border-yellow-500/30 mb-6 shadow-2xl shadow-yellow-500/20 animate-glow-pulse">
              <AlertCircle className="w-24 h-24 text-yellow-500 drop-shadow-[0_0_20px_rgba(234,179,8,0.9)]" />
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-3 tracking-tight">Wrong Network</h2>
            <p className="text-slate-200 text-center max-w-md text-lg font-medium">
              Please switch to Arbitrum One (Chain ID: 42161) in your wallet.
            </p>
          </div>
        ) : !hasApproved && !isApproved ? (
          <div className="py-12">
            {/* Section Header */}
            <div className="mb-10 animate-fade-in-up">
              <h2 className="text-5xl font-extrabold text-white mb-3 tracking-tight">How It Works</h2>
              <p className="text-slate-300 text-xl font-medium">Understanding the technology powering this demo</p>
            </div>

            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10">
              {/* explanation cards */}
              <div className="lg:col-span-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up">
                    <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                      <MessageSquare className="w-7 h-7 mr-2" />
                      AP2 Metered AI
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      <strong className="text-white">Agent Payments Protocol (AP2)</strong> is an open protocol for secure agent commerce. 
                      It uses verifiable digital credentials to enable AI agents to make payments on your behalf.
                      <br /><br />
                      <span className="text-slate-400 italic">In this demo:</span> Each message costs $0.0001 USDC, metered and batched for settlement.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up" style={{"animationDelay": "0.1s"}}>
                    <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                      <CheckCircle className="w-7 h-7 mr-2" />
                      x402 Settlement
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      <strong className="text-white">x402 protocol</strong> is an open standard for internet-native payments built around HTTP 402. 
                      It enables instant, blockchain-agnostic settlements with zero protocol fees.
                      <br /><br />
                      <span className="text-slate-400 italic">In this demo:</span> Every 5 messages, your payment is settled onchain in seconds via a facilitator.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up" style={{"animationDelay": "0.2s"}}>
                    <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                      <Wallet className="w-7 h-7 mr-2" />
                      Intent Mandates
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      <strong className="text-white">Intent Mandates</strong> are verifiable digital credentials that capture conditions under which an AI agent can make purchases on your behalf. 
                      They enable "human-not-present" transactions with pre-authorized spending limits.
                      <br /><br />
                      <span className="text-slate-400 italic">In this demo:</span> Your mandate is cryptographically signed and caps spending at 2 USDC daily.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-6 shadow-xl hover:shadow-2xl hover:shadow-[#28A0F0]/10 transition-all hover:scale-105 hover:border-[#28A0F0]/40 animate-fade-in-up" style={{"animationDelay": "0.3s"}}>
                    <h3 className="text-xl font-bold text-[#28A0F0] mb-3 flex items-center drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">
                      <Cpu className="w-7 h-7 mr-2" />
                      Local AI Model
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      <strong className="text-white">Docker Model Runner</strong> enables local AI inference with complete privacy. 
                      No data leaves your machine - all processing happens locally, ensuring your conversations remain private.
                      <br /><br />
                      <span className="text-slate-400 italic">In this demo:</span> Running llama3.1:8b via Docker for fast, private responses.
                    </p>
                  </div>
                </div>
              </div>

              {/* approval section */}
              <div className="lg:col-span-2">
                <div className="sticky top-8">
                  <div className="bg-slate-900/80 backdrop-blur-sm border-2 border-slate-700 rounded-2xl p-8 shadow-2xl hover:shadow-3xl transition-all animate-scale-in">
                    <div className="text-center mb-8">
                      <div className="inline-flex items-center justify-center w-28 h-28 bg-gradient-to-br from-[#28A0F0] to-[#12AAFF] rounded-3xl mb-6 shadow-2xl shadow-[#28A0F0]/50 animate-glow-pulse">
                        <DollarSign className="w-16 h-16 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
                      </div>
                      <h2 className="text-4xl font-extrabold text-white mb-3 tracking-tight">Approve USDC</h2>
                      <p className="text-slate-300 text-lg font-medium">One-time approval to get started</p>
                    </div>
                  
                    <div className="space-y-6">
                      <div className="bg-slate-800/70 rounded-xl p-6 border-2 border-slate-700 shadow-lg">
                        <div className="flex items-start space-x-3 mb-4">
                          <div className="flex-shrink-0 w-10 h-10 bg-[#28A0F0]/30 rounded-xl flex items-center justify-center shadow-lg shadow-[#28A0F0]/20">
                            <CheckCircle className="w-6 h-6 text-[#28A0F0]" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold text-white mb-2">Payment Authorization</h3>
                            <p className="text-slate-200 text-base leading-relaxed">
                              Approve up to <span className="text-[#28A0F0] font-extrabold text-2xl drop-shadow-[0_0_8px_rgba(40,160,240,0.6)]">2 USDC</span> for automatic settlements. 
                              Payments are batched every 5 messages for gas efficiency.
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <button
                        onClick={approveUSDC}
                        disabled={isApproving || isConfirming}
                        className="w-full flex items-center justify-center space-x-3 px-8 py-6 bg-gradient-to-r from-[#28A0F0] to-[#12AAFF] hover:from-[#12AAFF] hover:to-[#28A0F0] text-white rounded-xl font-extrabold text-2xl transition-all hover:shadow-2xl hover:shadow-[#28A0F0]/60 hover:scale-105 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed border-2 border-[#28A0F0]/30 animate-glow-pulse"
                      >
                        <CheckCircle className="w-8 h-8" />
                        <span>{isApproving || isConfirming ? 'Approving...' : 'Approve 2 USDC'}</span>
                      </button>
                      
                      {hash && (
                        <div className="pt-2">
                          <a
                            href={`https://arbiscan.io/tx/${hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center space-x-2 text-[#28A0F0] hover:text-[#12AAFF] transition-all text-base font-bold hover:scale-105"
                          >
                            <ExternalLink className="w-5 h-5" />
                            <span>View on Arbiscan</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* chat area */}
            <div className="lg:col-span-3">
              <div className="bg-slate-900/90 backdrop-blur-md rounded-xl shadow-2xl overflow-hidden flex flex-col border-2 border-slate-700 animate-fade-in-up relative" style={{ height: 'calc(100vh - 250px)' }}>
                <div className="absolute inset-0 bg-gradient-to-br from-[#28A0F0]/5 via-transparent to-[#12AAFF]/5 pointer-events-none animate-gradient-rotate" />
                {/* messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-3xl rounded-xl px-5 py-3 shadow-lg transition-all hover:scale-[1.02] animate-slide-up relative ${
                          msg.role === 'user'
                            ? 'bg-gradient-to-r from-[#28A0F0] to-[#12AAFF] text-white font-medium shadow-[0_8px_32px_rgba(40,160,240,0.4)] hover:shadow-[0_12px_48px_rgba(40,160,240,0.6)]'
                            : 'bg-slate-800/90 backdrop-blur-sm text-slate-100 border-2 border-slate-700 hover:border-[#28A0F0]/50 hover:shadow-[0_0_20px_rgba(40,160,240,0.2)]'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        
                        {msg.priceMicroUsdc && (
                          <div className="mt-2 text-xs font-semibold opacity-80 bg-black/20 inline-block px-2 py-1 rounded">
                            💰 ${(msg.priceMicroUsdc / 1000000).toFixed(4)} USDC
                          </div>
                        )}
                        
                        {msg.settlementInfo && (
                          <a
                            href={msg.settlementInfo.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 flex items-center space-x-1 text-xs font-bold hover:underline bg-green-500/20 px-2 py-1 rounded border border-green-500/30"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>✅ Settlement TX</span>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {isLoading && (
                    <div className="flex justify-start animate-slide-up">
                      <div className="bg-slate-800/90 backdrop-blur-sm border-2 border-slate-700 rounded-xl px-6 py-4 shadow-xl shadow-[#28A0F0]/20 animate-border-dance relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#28A0F0]/10 to-transparent animate-shimmer" />
                        <div className="flex space-x-2 relative z-10">
                          <div className="w-3 h-3 bg-gradient-to-br from-[#28A0F0] to-[#12AAFF] rounded-full animate-bounce shadow-[0_0_12px_rgba(40,160,240,1)]" />
                          <div className="w-3 h-3 bg-gradient-to-br from-[#28A0F0] to-[#12AAFF] rounded-full animate-bounce shadow-[0_0_12px_rgba(40,160,240,1)]" style={{ animationDelay: '0.1s' }} />
                          <div className="w-3 h-3 bg-gradient-to-br from-[#28A0F0] to-[#12AAFF] rounded-full animate-bounce shadow-[0_0_12px_rgba(40,160,240,1)]" style={{ animationDelay: '0.2s' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* input area */}
                <div className="border-t-2 border-slate-700 p-4 bg-slate-950/80 backdrop-blur-sm">
                  {error && (
                    <div className="mb-3 p-4 bg-red-500/20 border-2 border-red-500/40 rounded-xl flex items-center space-x-2 text-red-200 text-sm font-semibold shadow-lg">
                      <AlertCircle className="w-5 h-5" />
                      <span>{error}</span>
                    </div>
                  )}
                  
                  <div className="flex space-x-3">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      disabled={isLoading || !mandate}
                      className="flex-1 px-5 py-4 bg-slate-800/90 backdrop-blur-sm border-2 border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#28A0F0] focus:border-[#28A0F0] focus:shadow-[0_0_20px_rgba(40,160,240,0.4)] disabled:bg-slate-900 text-white placeholder-slate-400 text-base font-medium shadow-lg transition-all hover:border-slate-600"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={isLoading || !inputMessage.trim() || !mandate}
                      className="px-8 py-4 bg-gradient-to-r from-[#28A0F0] to-[#12AAFF] hover:from-[#12AAFF] hover:to-[#28A0F0] text-white rounded-xl font-bold text-base transition-all disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed shadow-xl shadow-[#28A0F0]/40 hover:shadow-2xl hover:shadow-[#28A0F0]/60 hover:scale-110 border-2 border-[#28A0F0]/30 relative overflow-hidden group"
                    >
                      <span className="relative z-10">Send</span>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* stats sidebar */}
            <div className="lg:col-span-1">
              {mandate && (
                <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - 250px)' }}>
                  <div className="bg-[#28A0F0]/20 border-2 border-[#28A0F0]/40 rounded-xl p-5 text-sm shadow-lg shadow-[#28A0F0]/20 animate-fade-in-up flex-shrink-0 backdrop-blur-sm relative overflow-hidden hover:shadow-xl hover:shadow-[#28A0F0]/30 transition-all">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#28A0F0]/10 via-transparent to-transparent pointer-events-none" />
                    <p className="font-bold mb-3 text-[#28A0F0] text-base drop-shadow-[0_0_8px_rgba(40,160,240,0.6)] relative z-10">How it works:</p>
                    <ol className="list-decimal list-inside space-y-2 text-slate-200 font-medium relative z-10">
                      <li>Each message costs ${(mandate.pricePerMessageMicroUsdc / 1000000).toFixed(4)} USDC</li>
                      <li>After {mandate.batchThreshold} messages, settlement triggers</li>
                      <li>Payment settles on Arbitrum One via x402</li>
                      <li>You get a transaction receipt</li>
                    </ol>
                  </div>

                  <div className="bg-slate-900/90 backdrop-blur-md border-2 border-slate-700 rounded-xl shadow-2xl p-6 hover:shadow-[#28A0F0]/20 hover:border-slate-600 transition-all animate-fade-in-up flex-shrink-0 relative overflow-hidden group" style={{"animationDelay": "0.1s"}}>
                    <div className="absolute inset-0 bg-gradient-to-br from-[#28A0F0]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    <h3 className="text-xl font-bold text-white mb-4 tracking-tight relative z-10">Usage Stats</h3>
                    <div className="space-y-4 relative z-10">
                      <div className="bg-slate-800/70 p-3 rounded-lg border border-slate-700 hover:border-[#28A0F0]/30 hover:bg-slate-800/80 transition-all">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-300 font-medium">Price per message</span>
                          <span className="font-mono text-[#28A0F0] font-bold text-base drop-shadow-[0_0_4px_rgba(40,160,240,0.5)]">${(mandate.pricePerMessageMicroUsdc / 1000000).toFixed(4)}</span>
                        </div>
                      </div>
                      
                      <div className="bg-slate-800/70 p-3 rounded-lg border border-slate-700 hover:border-[#28A0F0]/30 hover:bg-slate-800/80 transition-all">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-300 font-medium">Daily cap</span>
                          <span className="font-mono text-[#28A0F0] font-bold text-base drop-shadow-[0_0_4px_rgba(40,160,240,0.5)]">${(mandate.dailyCapMicroUsdc / 1000000).toFixed(2)}</span>
                        </div>
                      </div>
                      
                      <div className="bg-slate-800/70 p-3 rounded-lg border border-slate-700 hover:border-[#28A0F0]/30 hover:bg-slate-800/80 transition-all">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-300 font-medium">Batch threshold</span>
                          <span className="font-mono text-[#28A0F0] font-bold text-base drop-shadow-[0_0_4px_rgba(40,160,240,0.5)]">{mandate.batchThreshold} msgs</span>
                        </div>
                      </div>
                      
                      <div className="bg-slate-800/70 p-3 rounded-lg border border-slate-700 hover:border-[#28A0F0]/30 hover:bg-slate-800/80 transition-all">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-300 font-medium">Total messages</span>
                          <span className="font-mono text-[#28A0F0] font-bold text-base drop-shadow-[0_0_4px_rgba(40,160,240,0.5)]">{messages.filter(m => m.role === 'user').length}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* footer */}
      <footer className="bg-slate-950 border-t-2 border-slate-700 py-5 mt-auto shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-slate-300 text-base font-medium">
            Made with <span className="text-red-500 text-xl animate-pulse">❤️</span> by the{' '}
            <a
              href="https://arbitrum.foundation"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#28A0F0] hover:text-[#12AAFF] transition-all font-bold hover:scale-105 inline-block"
            >
              Arbitrum DevRel Team
            </a>
          </p>
        </div>
      </footer>

      {/* Settlement signing notification */}
      {(isSettling || pendingSettlement) && (
        <div className="fixed top-6 right-6 z-50 animate-slide-in">
          <div className="bg-gradient-to-r from-[#28A0F0] to-[#12AAFF] text-white rounded-2xl shadow-2xl p-7 max-w-md border-4 border-[#28A0F0]/40 animate-glow-pulse">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 p-2 bg-white/20 rounded-xl animate-pulse">
                <DollarSign className="w-10 h-10 drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
              </div>
              <div className="flex-1">
                <h3 className="font-extrabold text-2xl mb-2 tracking-tight">Sign Payment</h3>
                <p className="text-base text-blue-50 mb-2 font-medium">
                  Batch threshold reached! Please sign the payment authorization in your wallet to settle {mandate && ((pendingSettlement ? parseInt(pendingSettlement.value) : 0) / 1_000_000).toFixed(4)} USDC.
                </p>
                <p className="text-sm text-blue-100">
                  This is a one-time signature for this batch of messages.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* settlement toast notification */}
      {settlementToast && (
        <div className="fixed top-6 right-6 z-50 animate-slide-in">
          <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-2xl shadow-2xl p-7 max-w-md border-4 border-green-300 animate-glow-pulse">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 p-2 bg-white/20 rounded-xl">
                <CheckCircle className="w-10 h-10 drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
              </div>
              <div className="flex-1">
                <h3 className="font-extrabold text-2xl mb-2 tracking-tight">Settlement Successful!</h3>
                <p className="text-base text-green-50 mb-4 font-medium">
                  Your payment has been settled onchain via the x402 protocol.
                </p>
                <a
                  href={settlementToast.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-2 bg-white text-green-600 px-5 py-3 rounded-xl font-extrabold text-base hover:bg-green-50 transition-all hover:scale-105 shadow-lg"
                >
                  <ExternalLink className="w-5 h-5" />
                  <span>View on Arbiscan</span>
                </a>
              </div>
              <button
                onClick={() => setSettlementToast(null)}
                className="flex-shrink-0 text-white hover:text-green-100 transition-all hover:scale-110 p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
