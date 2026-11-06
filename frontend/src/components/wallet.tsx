"use client";
/**
 * Privy login/logout, the connected address, and the chain check. Wrapped in a tiny context so the rest of the app
 * doesn't care whether Privy is configured: without NEXT_PUBLIC_PRIVY_APP_ID the button says so and stays disabled.
 */
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { config } from "@/config";
import { appChain } from "@/lib/chain";
import { shortHex } from "@/lib/format";

export interface WalletState {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  address: `0x${string}` | null;
  chainId: number | null;
  wrongChain: boolean;
  login: () => void;
  logout: () => Promise<void>;
  switchChain: () => Promise<void>;
  getProvider: (() => Promise<{ request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }>) | null;
}

const noop = async () => {};
const DISABLED: WalletState = {
  enabled: false,
  ready: true,
  authenticated: false,
  address: null,
  chainId: null,
  wrongChain: false,
  login: () => {},
  logout: noop,
  switchChain: noop,
  getProvider: null,
};

const WalletCtx = createContext<WalletState>(DISABLED);
export const useWallet = () => useContext(WalletCtx);

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const w = wallets[0];
  const chainId = w?.chainId ? Number(w.chainId.split(":")[1]) : null;
  const value = useMemo<WalletState>(
    () => ({
      enabled: true,
      ready,
      authenticated,
      address: (w?.address as `0x${string}` | undefined) ?? null,
      chainId,
      wrongChain: !!w && chainId !== config.chainId,
      login: () => login(),
      logout: () => logout(),
      switchChain: async () => {
        if (w) await w.switchChain(config.chainId);
      },
      getProvider: w ? () => w.getEthereumProvider() : null,
    }),
    [ready, authenticated, login, logout, w, chainId],
  );
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!config.privyAppId) return <WalletCtx.Provider value={DISABLED}>{children}</WalletCtx.Provider>;
  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        appearance: { theme: "#111113", accentColor: "#199e70", walletChainType: "ethereum-only", showWalletLoginFirst: true, landingHeader: "Connect a wallet" },
        loginMethods: ["wallet"],
        defaultChain: appChain,
        supportedChains: [appChain],
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

export function WalletButton() {
  const w = useWallet();
  if (!w.enabled)
    return (
      <button
        disabled
        title="Wallet connect is off: set NEXT_PUBLIC_PRIVY_APP_ID (dashboard.privy.io) to enable it."
        className="rounded-full border border-line px-3.5 py-1.5 text-xs text-faint"
      >
        Wallet off
      </button>
    );
  if (!w.ready) return <span className="h-7 w-20 animate-pulse rounded-full bg-raised" />;
  if (!w.authenticated)
    return (
      <button onClick={w.login} className="btn btn-ghost btn-sm">
        Connect wallet
      </button>
    );
  return (
    <div className="flex items-center gap-2">
      {w.wrongChain && (
        <button
          onClick={() => void w.switchChain()}
          className="rounded-full border border-warn/60 px-3 py-1.5 text-xs text-warn transition hover:bg-warn/10"
          title={`Your wallet is on chain ${w.chainId}; Aven runs on ${config.chainName} (${config.chainId}).`}
        >
          ⚠ Switch to {config.chainName}
        </button>
      )}
      <span className="num rounded-full border border-line px-3 py-1.5 text-xs text-ink-2" title={w.address ?? ""}>
        {w.address ? shortHex(w.address) : "no wallet"}
      </span>
      <button onClick={() => void w.logout()} className="text-xs text-muted transition hover:text-ink">
        Disconnect
      </button>
    </div>
  );
}
