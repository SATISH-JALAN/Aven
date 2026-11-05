# contracts/deployments/

`<chainId>.json` is written by `script/CreatePools.s.sol`: addresses, pool keys/ids, `config` and `params` for that chain, in exactly the schema of ARCHITECTURE §8.3. It is the single source of addresses for `backend/` and `frontend/` (`@aven/core` `loadDeployments(chainId)`).

- `998.json`: HyperEVM testnet (committed after Sayan runs the testnet deploy, docs/DEPLOYMENTS.md).
- `31337.json`: local anvil chain from `pnpm local:up` (gitignored).
- `*.wip.json`: scratch state between the deploy scripts (gitignored).
