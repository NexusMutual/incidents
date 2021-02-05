# Proof of loss verifier

This tool can be used to easily check certain conditions that are required when assessing claims with a valid proof of loss given a list of known impacted addresses and the incurred losses due to an incident. At the moment, it verifies whether the addresses from a proof add up to a minimum 20% loss out of the cover amount and it also verifies if some of those addresses were reused and in which claims.

## How to use
The tool reads the addresses from input.csv and writes to output.csv. It will also output a more verbose result to stdout.
Copy .env.sample to .env and add your own node provider.
```
npm i
```
```
npm start
```

## Disclaimer
This tool is in early phase and.
### TODO
- Read parameters from cli
- Accept other currencies as input
