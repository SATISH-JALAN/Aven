"use client";
/**
 * Privy wallet connect/disconnect, the connected address, and the chain check. Wrapped in a tiny context so the rest of the app
 * doesn't care whether Privy is configured: without NEXT_PUBLIC_PRIVY_APP_ID the button says so and stays disabled.
 */
import { PrivyProvider, useConnectWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { config } from "@/config";
import { appChain } from "@/lib/chain";
import { shortHex } from "@/lib/format";
import { forgetActivitySeen, openWalletActivity } from "@/components/onchain/WalletActivity";

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

/**
 * Connect-only: `connectWallet()` links the browser wallet without Privy's sign-in (SIWE) step. The app never uses a
 * Privy session (no server-side calls), and that extra signature was the step failing with "Could not log in with
 * wallet". `authenticated` therefore means "a wallet is connected".
 */
function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated: hasSession, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  // MetaMask can't be disconnected programmatically, so Disconnect also hides the wallet until the next connect.
  const [hidden, setHidden] = useState(false);
  const { connectWallet } = useConnectWallet({ onSuccess: () => setHidden(false) });
  const w = hidden ? undefined : wallets.find((x) => x.walletClientType !== "privy");
  const chainId = w?.chainId ? Number(w.chainId.split(":")[1]) : null;
  const value = useMemo<WalletState>(
    () => ({
      enabled: true,
      ready: ready && walletsReady,
      authenticated: !!w,
      address: (w?.address as `0x${string}` | undefined) ?? null,
      chainId,
      wrongChain: !!w && chainId !== config.chainId,
      login: () => {
        setHidden(false);
        connectWallet();
      },
      logout: async () => {
        setHidden(true);
        for (const x of wallets) {
          try {
            const p = await x.getEthereumProvider();
            await p.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
          } catch {
            // Not every wallet supports revoking; hiding it above is enough for the app.
          }
          x.disconnect();
        }
        if (hasSession) await logout(); // clear a session left over from the old login flow
      },
      switchChain: async () => {
        if (w) await w.switchChain(config.chainId);
      },
      getProvider: w ? () => w.getEthereumProvider() : null,
    }),
    [ready, walletsReady, hasSession, logout, connectWallet, wallets, w, chainId],
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
      <button
        onClick={openWalletActivity}
        className="num rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 transition hover:border-line-strong hover:text-ink"
        title={w.address ? `${w.address}: your activity on Aven` : ""}
      >
        {w.address ? shortHex(w.address) : "no wallet"}
      </button>
      <button
        onClick={() => {
          forgetActivitySeen(w.address);
          void w.logout();
        }}
        className="text-xs text-muted transition hover:text-ink"
      >
        Disconnect
      </button>
    </div>
  );
}
