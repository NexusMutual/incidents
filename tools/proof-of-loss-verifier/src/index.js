require('dotenv').config();

const fs = require('fs');
const csv = require('csvtojson');
const { parse } = require('json2csv');
const ethers = require('ethers');
const fetch = require('node-fetch');

const { BLOCK_START, IPFS_GATEWAY } = require('./config');
const { initContracts, instanceOf } = require('./initContracts');
const { getTx, hexToString } = require('./helpers');

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);

const getProofHash = async log => {
  const { provider, CP } = instanceOf;
  const tx = await getTx(provider, log.raw.transactionHash);
  const coverOwner = tx.from;

  const { args } = log.parsed;
  const proofAddedFilter = CP.filters.ProofAdded(args.coverId, coverOwner);
  proofAddedFilter.fromBlock = BLOCK_START;
  const proofAddedLogs = await provider.getLogs(proofAddedFilter);

  // Get the last proof before the blockNumber of claim submission
  const lastProofAddedLog = proofAddedLogs.reduce((prev, curr) => {
    if (!prev) {
      return curr;
    }
    if (
      curr.blockNumber > prev.blockNumber &&
      curr.blockNumber <= log.raw.blockNumber
    ) {
      return curr;
    }
    return prev;
  }, null);

  if (!lastProofAddedLog) {
    return;
  }

  const lastProofAddedLogParsed = CP.interface.parseLog(lastProofAddedLog);
  const { ipfsHash } = lastProofAddedLogParsed.args;
  return ipfsHash;
};

// [todo] These should be passed as parameters
const getClaims = async (
  projectAddress = '0x9D25057e62939D3408406975aD75Ffe834DA4cDd', // yearn
  // https://etherscan.io/tx/0x59faab5a1911618064f1ffa1e4649d85c99cfd9f0d64dcebbc1af7d7630da98b
  incidentBlock = 11792184,
) => {
  const { provider, CD, QD } = instanceOf;
  const filter = CD.filters.ClaimRaise();
  filter.fromBlock = incidentBlock;
  const claimLogs = await provider.getLogs(filter);
  const claimsLogsParsed = claimLogs.map(log => ({
    parsed: CD.interface.parseLog(log),
    raw: log,
  }));
  const coverDetails = await Promise.all(
    claimsLogsParsed.map(x =>
      QD.getCoverDetailsByCoverID1(x.parsed.args.coverId),
    ),
  );
  const claims = claimsLogsParsed
    .map((x, i) => {
      const [id, , scAddress, currencyCode, sumAssured] = coverDetails[i];
      return {
        event: x,
        coverDetails: {
          id,
          scAddress,
          currencyCode: hexToString(currencyCode),
          sumAssured,
        },
      };
    })
    .filter(x => x.coverDetails.scAddress === projectAddress);
  const claimsSorted = claims.sort(
    (a, b) => a.event.raw.blockNumber - b.event.raw.blockNumber,
  );
  return claimsSorted;
};

const isProofRequired = claim => {
  const PROOF_REQUIRED_FROM_COVER_ID = 2292;
  return claim.coverDetails.id >= PROOF_REQUIRED_FROM_COVER_ID;
};

const getFromIpfs = async ipfsHash => {
  // get the file
  const file = await fetch(IPFS_GATEWAY + '/' + ipfsHash);
  console.log('info', 'Retrieved file from IPFS', { ipfsHash });

  const jsonFile = await file.json().catch(() => null);

  if (!jsonFile) {
    // skip
    console.log('warning', 'IPFS json parse failed', { ipfsHash });
    return;
  }
  return jsonFile;
};

const readAffectedAddressesFile = async incidentFilePath => {
  const snapshot = await csv().fromFile(incidentFilePath);
  const elidgibleAddresses = snapshot
    .map(({ account, pre_dai, post_dai }) => {
      const loss = ethers.utils
        .parseUnits(pre_dai.replace(/,/g, ''))
        .sub(ethers.utils.parseUnits(post_dai.replace(/,/g, '')));
      return { account, loss };
    })
    .filter(x => {
      // Given a loss in DAI, and the minimum cover amount that you can
      // purachase on nexus mutual is 1 DAI,the minimum loss elidgible
      // for a claim is 0.2 DAI
      return x.loss.gte(ethers.utils.parseUnits('0.2'));
    });
  const dict = elidgibleAddresses.reduce((acc, { account, loss }) => {
    return { ...acc, [account]: loss };
  }, {});
  return dict;
};

const isValidProofCoverId = ({ coverDetilas, proof }) => {
  // Check if cover id matched with the one in the submitter proof
  const retrievedCoverId = proof.coverId;
  const coverId = coverDetilas.id.toString();
  const isValid = coverId === retrievedCoverId;
  if (!isValid) {
    console.log(
      `Retreived cover ids do not match! Expecting ${coverId} but got ${retrievedCoverId}.`,
    );
  }
  return isValid;
};

const verifyAffectedAddress = async ({ address, hash, coverId }) => {
  const SIGN_MESSAGE_PREFIX = 'Nexus Mutual proof of loss for cover ID ';
  if (!ethers.utils.isAddress(address) || !ethers.utils.isHexString(hash)) {
    return {};
  }
  if (hash.length === 132) {
    // SIGNATURE
    const recoveredAddress = ethers.utils.verifyMessage(
      SIGN_MESSAGE_PREFIX + coverId,
      hash,
    );
    if (address === recoveredAddress) {
      return { verified: address };
    }
    // Invalid signature
    return { unverified: address };
  }
  if (hash.length === 66) {
    // TX
    const tx = await getTx(provider, hash);
    const verificationAddress = await coverIdToVerificationAddress(coverId);
    if (tx.from === address && tx.to === verificationAddress) {
      return { verified: address };
    }
    // Invalid tx
    return { unverified: address };
  }
  // Valid address but invalid hash
  return { unverified: address };
};

const getAffectedAddressesFromProof = async proof => {
  const verifiedAddresses = [];
  const unverifiedAddresses = [];

  const { affectedAddresses, coverId } = proof;
  if (
    affectedAddresses &&
    typeof affectedAddresses === 'object' &&
    Object.keys(affectedAddresses).length
  ) {
    for (const address in affectedAddresses) {
      const hash = affectedAddresses[address];
      const { verified, unverified } = await verifyAffectedAddress({
        address,
        hash,
        coverId,
      });
      if (unverified) {
        unverifiedAddresses.push(address);
      }
      if (verified) {
        verifiedAddresses.push(address);
      }
    }
  }
  return { verified: verifiedAddresses, unverified: unverifiedAddresses };
};

const getClaimsWithRequiredProof = async lossOf => {
  const claims = await getClaims();
  const claimsWithProofDetails = [];
  const incidentEthToDaiRate = ethers.BigNumber.from('609321184512206');
  for (claim of claims) {
    if (isProofRequired(claim)) {
      const proofHash = await getProofHash(claim.event);
      const proof = await getFromIpfs(proofHash);
      console.log(proof);
      if (!isValidProofCoverId({ proof, coverDetilas: claim.coverDetails })) {
        continue;
      }
      const retreivedAddresses = await getAffectedAddressesFromProof(proof);
      const loss = retreivedAddresses.verified.reduce(
        // For each claim, sum the losses from all verified addresses
        // [todo] Also treat other currencies, for the current incident
        // (yearn - 04/02/2021) only DAI is used
        (acc, address) => acc.add(lossOf[address] || ethers.constants.Zero),
        ethers.constants.Zero,
      );
      const coveredAmountDAI =
        claim.coverDetails.currencyCode === 'DAI'
          ? claim.coverDetails.sumAssured.mul(ethers.utils.parseUnits('1')) // DAI to wei DAI
          : claim.coverDetails.sumAssured
            .mul(ethers.utils.parseUnits('1')) // ETH to wei
            .mul(ethers.utils.parseUnits('1')) // for 1e18 precision
            .div(incidentEthToDaiRate); // to DAI
      const hasMinimumLoss = coveredAmountDAI.div(5).lt(loss); // minimum 20% out of cover amount
      claimsWithProofDetails.push({
        ...claim,
        proof,
        retreivedAddresses,
        loss,
        hasMinimumLoss,
        coveredAmountDAI,
      });
    }
  }
  return claimsWithProofDetails;
};

const trackUsedProofAddresses = claims => {
  const proofAddressesDict = {};
  for (claim of claims) {
    for (address of claim.retreivedAddresses.verified) {
      const claimId = claim.event.parsed.args.claimId.toString();
      proofAddressesDict[address] = proofAddressesDict[address]
        ? [...proofAddressesDict[address], claimId]
        : [claimId];
    }
  }
  return proofAddressesDict;
};

const toHumanReadableCSV = async claims => {
  const claimsFormatted = claims.map(x => {
    return {
      claim_id: x.event.parsed.args.claimId.toString(),
      cover_id: x.event.parsed.args.coverId.toString(),
      loss_dai: ethers.utils.formatUnits(x.loss),
      cover_amount_dai: ethers.utils.formatUnits(x.coveredAmountDAI),
      has_minimum_loss: x.hasMinimumLoss ? 'Yes' : 'No',
      has_repeated_addresses: x.repeatedAddressesFromOtherClaims
        ? Object.keys(x.repeatedAddressesFromOtherClaims).map(
          address =>
            `Address ${address} in claims: ${repeatedAddressesFromOtherClaims[
              address
            ].join(',')}\n`,
        )
        : 'No',
    };
  });
  COLUMNS = [
    'claim_id',
    'cover_id',
    'cover_amount_dai',
    'loss_dai',
    'has_minimum_loss',
    'has_repeated_addresses',
  ];

  const csv = parse(claimsFormatted, { fields: COLUMNS, quote: '' });

  fs.writeFileSync('output.csv', csv);
  console.log('info', 'Results written in output.csv');
};

const getCheckedClaims = ({ claims, usedProofAddresses }) => {
  const checkedClaims = [];
  for (claim of claims) {
    const repeatedAddresses = {};
    for (address of claim.retreivedAddresses.verified) {
      if (usedProofAddresses[address].length > 1) {
        repeatedAddresses[address] = usedProofAddresses[address];
        continue;
      }
    }
    if (Object.keys(repeatedAddresses).length) {
      checkedClaims.push({
        ...claim,
        repeatedAddressesFromOtherClaims: repeatedAddresses,
      });
    } else {
      checkedClaims.push(claims);
    }
  }
  return checkedClaims;
};

const init = async () => {
  // Get contracts instances
  await initContracts(['CD', 'QD', 'CP'], provider);

  const lossOf = await readAffectedAddressesFile('./input.csv');
  // Get claims that require a proof of loss with all necessary assessment details
  const claims = await getClaimsWithRequiredProof(lossOf);
  const usedProofAddresses = trackUsedProofAddresses(claims);
  // Checks if certain addresses in the provided proofs are repeated
  const claimsChecked = getCheckedClaims({ claims, usedProofAddresses });
  console.log(JSON.stringify(claimsChecked, null, 1));
  // Format all this in a human readable format and write to csv
  toHumanReadableCSV(claims);
};

init().catch(error => {
  console.error(error);
  process.exit(1);
});
