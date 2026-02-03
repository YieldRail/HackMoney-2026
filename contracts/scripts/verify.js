const hre = require("hardhat");

async function main() {
  // Support both environment variable and command line argument
  let contractAddress = process.env.CONTRACT_ADDRESS;
  
  // Check if address was passed as command line argument
  if (process.argv.length > 2) {
    const arg = process.argv[process.argv.length - 1];
    if (arg.startsWith('0x') && arg.length === 42) {
      contractAddress = arg;
    }
  }
  
  if (!contractAddress || !contractAddress.startsWith('0x')) {
    console.error("❌ Contract address required!");
    console.error("\nUsage:");
    console.error("  npx hardhat run scripts/verify.js --network base 0x...");
    console.error("  CONTRACT_ADDRESS=0x... npx hardhat run scripts/verify.js --network base");
    console.error("\nOr set it in your .env file:");
    console.error("  CONTRACT_ADDRESS=0x...");
    process.exit(1);
  }

  const FEE_COLLECTOR = process.env.FEE_COLLECTOR || "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427";
  
  const network = hre.network.name;
  const explorerName = network === 'mainnet' ? 'Etherscan' : network === 'base' ? 'Basescan' : 'Snowtrace';
  const explorerUrl = network === 'mainnet' 
    ? `https://etherscan.io/address/${contractAddress}#code`
    : network === 'base'
    ? `https://basescan.org/address/${contractAddress}#code`
    : `https://snowtrace.io/address/${contractAddress}#code`;

  console.log(`Verifying contract at ${contractAddress} on ${explorerName}...`);
  console.log(`Network: ${network}`);
  console.log(`Fee Collector: ${FEE_COLLECTOR}`);

  try {
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [FEE_COLLECTOR],
    });
    
    console.log(`✅ Contract verified successfully!`);
    console.log(`View on ${explorerName}: ${explorerUrl}`);
  } catch (error) {
    if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
      console.log("✅ Contract is already verified!");
      console.log(`View on ${explorerName}: ${explorerUrl}`);
    } else {
      console.error("❌ Verification failed:", error.message);
      console.error("\nMake sure:");
      console.error("  1. The contract address is correct");
      console.error(`  2. FEE_COLLECTOR matches the one used in deployment: ${FEE_COLLECTOR}`);
      console.error("  3. The network is correct");
      process.exit(1);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

