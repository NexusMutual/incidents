# yDAI v1

Date: 5th of February 2021
Total losses: \~$11M

## Data

The included [ydai-snapshot.csv](ydai-snapshot.csv) was provided by Yearn team and contains a snapshot of the yDAI balances (vault shares) at block `11792183`. The `pre-dai` column contains the price of the shares in DAI at the snapshot block (before the hack). The `post-dai` contains the price of the shares in DAI at block `11792352`.

The snapshot accounts for the yDAI that were sent to exchanges: the LP tokens were unwrapped and the accounts included in the list.

There were no transfers during the period except for a single deposit between the blocks from `0x577e56C834998f8Fa7eaCA666582691AD4Fd9de4`:
- pre deposit shares: 716.4068974658735
- post deposit shares: 80190.61994701486

All addresses have suffered a 31.6% loss.

## References

- [The yDAI Incident Analysis: Forced Investment by PeckShield](https://peckshield.medium.com/the-ydai-incident-analysis-forced-investment-2b8ac6058eb5)
