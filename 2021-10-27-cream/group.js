const fs = require('fs');
const balances = {};
const balancesPath = __dirname + '/balances';

const rateData = require('./cream-pools-rates.json');
const rates = Object.keys(rateData).reduce(
  (rates, address) => {
    return { ...rates, [address.toLowerCase()]: rateData[address].rate };
  },
  {},
);

fs.readdir(balancesPath, function (err, files) {

  if (err) {
    console.log('Unable to scan directory:', err);
    return;
  }

  files.forEach(file => {

    const [, symbol, address] = file.match(/(cr.+)-(0x[a-f0-9]+).json/i);
    const rate = rates[address.toLowerCase()];
    const users = require(`${balancesPath}/${file}`);

    const affectedAddresses = Object.keys(users).forEach(address => {
      balances[address.toLowerCase()] = balances[address.toLowerCase()] || {};
      balances[address.toLowerCase()][symbol] = users[address];
    });

  });

  console.log(balances);

});
