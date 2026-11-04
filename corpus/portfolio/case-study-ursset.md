# Case study: ursset

Source: https://septian-pamungkas.vercel.app

**role**: Solo builder
**team**: Solo
**time**: Ethereum Jakarta Hackathon 2026 (participant), Oct 2026
**problem**:
- Renting out or co-owning a house is closed to small investors. On fractional platforms money is often locked up and investors have to trust the operator's rent reports. Crypto products add wallets, gas and seed phrases on top.
- URSSET tries to hide the blockchain from the user while keeping the facts that matter verifiable onchain.
**myRole**:
**did**:
- Everything: the Solidity contracts, the Foundry test suite, the Next.js app, the API routes, the bilingual ID/EN interface and the deployment.
- Sign-in uses Privy embedded wallets (email or Google), so there is no seed phrase and no gas for the user.
**others**: Third-party pieces are credited in the repo README: Scaffold-ETH 2, OpenZeppelin, Foundry, Privy.
**approach**:
- A Next.js app for investors and a server for the operator talk to contracts on Robinhood Chain Testnet. A factory lists a property in one transaction by deploying and wiring four contracts; three more are shared. That is the 7 contract types in the diagram.
- Every rent deposit and its pro-rata split is an onchain event, and each transaction in the UI links to the explorer as proof.
**decisions**:
- **title**: KYC allow-list inside the token contract
  **text**: Units can only move between wallets verified in the KYCRegistry. A transfer to an unverified wallet is rejected by the contract, not by the app. This is an allow-list, not a claim of regulatory compliance.
- **title**: Non-custodial resale and pro-rata rent
  **text**: Resale happens through a marketplace contract between verified investors at a price the seller sets, and the seller keeps earning rent while listed. Rent is split by units held.
- **title**: What I would change
  **text**: The test token skips the approve step so a purchase is one transaction; a production setup would use a licensed payment provider and normal approvals. A single operator key can verify wallets, mint test Rupiah and deposit rent; production needs real KYC and rent from the SPV's bank account. Rent is split with a snapshot at deposit time, which a buyer could game, and I have no contract-level fix for it yet.
**results**:
- 45 Foundry tests, covering the factory, KYC, sale, rent and marketplace, plus property-based invariants.
- 7 Solidity contract types, deployed to Robinhood Chain Testnet.
- Bilingual (Indonesian and English) live demo, with pitch and demo videos.
- Scope is honest: a hackathon entry on a test network, with test Rupiah. I took part; I claim no placement.
**learned**:
- Writing the limits down (the repo has a Limits section and a security review that is explicitly not a third-party audit) made the demo easier to defend.
- Next: a pilot with one real boarding house, a sandbox application, a licensed payment partner.
