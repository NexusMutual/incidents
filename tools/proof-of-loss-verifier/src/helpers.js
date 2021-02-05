const getTx = (provider, txHash) =>
  new Promise((resolve, reject) => {
    try {
      provider.once(txHash, tx => resolve(tx));
    } catch (e) {
      reject(e);
    }
  });

const hexToString = hex => {
  if (!hex) {
    return '';
  }
  const string = Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('utf8');
  return string.replace(/[^ -~]+/, ''); // strip non-printable chars
};

module.exports = { getTx, hexToString };
