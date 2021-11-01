const fs = require('fs');
const balances = {};
const balancesPath = __dirname + '/balances';

const rawRates = require('./cream-pools-rates.json');

const rates = Object.keys(rawRates).reduce(
  (rates, address) => {
    return { ...rates, [address.toLowerCase()]: rawRates[address] };
  },
  {},
);

const ethRates = require('./chainlink-eth-rates--block-13499797.json')


fs.readdir(balancesPath, function (err, files) {

  if (err) {
    console.log('Unable to scan directory:', err);
    return;
  }

  // files = files.slice(0, 1)

  files.forEach(file => {

    const [, symbol, address] = file.match(/(cr.+)-(0x[a-f0-9]+).json/i);
    console.log(`${symbol} ${address}`)

    if (!rates[address.toLowerCase()]) {
      console.error(`Missing rates for ${symbol}. Skipping`);
      return;
    }
    const { rate, underlyingDecimals } = rates[address.toLowerCase()];
    const users = require(`${balancesPath}/${file}`);

    const affectedAddresses = Object.keys(users).forEach(address => {
      balances[address.toLowerCase()] = balances[address.toLowerCase()] || {};
      const underlyingBalance = users[address] * parseInt(rate) / 10 ** parseInt(underlyingDecimals);
      const underlyingSymbol = symbol.split('cr')[1];
      if (!ethRates[underlyingSymbol]) {
        console.error(`Could not find ETH rate for ${underlyingSymbol}. skipping`);
        return;
      }
      const ethRate = ethRates[underlyingSymbol].rate;
      const valueInEth = underlyingBalance * parseInt(ethRate) / 1e18;
      balances[address.toLowerCase()][symbol] = valueInEth;
    });

  });

  console.log(balances);

});
