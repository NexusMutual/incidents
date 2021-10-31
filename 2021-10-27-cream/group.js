const fs = require('fs');
const balances = {};
const balancesPath = __dirname + '/balances';

const rates = require('./cream-pools-rates.json');
// const rates = Object.keys(rateData).reduce(
//   (rates, address) => {
//     return { ...rates, [address.toLowerCase()]: rateData[address].rate };
//   },
//   {},
// );

fs.readdir(balancesPath, function (err, files) {

  if (err) {
    console.log('Unable to scan directory:', err);
    return;
  }

  files = files.slice(0, 1)

  files.forEach(file => {

    const [, symbol, address] = file.match(/(cr.+)-(0x[a-f0-9]+).json/i);
    const { rate, underlyingDecimals } = rates[address.toLowerCase()];
    const users = require(`${balancesPath}/${file}`);

    const affectedAddresses = Object.keys(users).forEach(address => {
      balances[address.toLowerCase()] = balances[address.toLowerCase()] || {};
      const underlyingBalance = users[address] * parseInt(rate) / 10 ** parseInt(underlyingDecimals);
      balances[address.toLowerCase()][symbol] = underlyingBalance;
    });

  });

  console.log(balances);

});
