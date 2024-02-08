import axios from "axios";
import { ethers,  BigNumberish, Numeric } from "ethers";
import { Call } from "ethcall";
import BigNumber from 'bignumber.js';
import {ICurveContract, IDict} from "./interfaces.js";
import { _getPoolsFromApi } from "./external-api";
import { lending } from "./lending.js";
import {JsonFragment} from "ethers/lib.esm";

//export const MAX_ALLOWANCE = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(256)).sub(ethers.BigNumber.from(1));
//export const MAX_ACTIVE_BAND = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(255)).sub(ethers.BigNumber.from(1));
export const MAX_ALLOWANCE = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935");  // 2**256 - 1
export const MAX_ACTIVE_BAND = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935");  // 2**256 - 1

// Common

export const createCall = (contract: ICurveContract, name: string, params: any[]): Call => {
    const _abi = contract.abi;
    const func = _abi.find((f: JsonFragment) => f.name === name)
    const inputs = func?.inputs || [];
    const outputs = func?.outputs || [];

    return {
        contract: {
            address: contract.address,
        },
        name,
        inputs,
        outputs,
        params,
    }
}

// Formatting numbers

export const _cutZeros = (strn: string): string => {
    return strn.replace(/0+$/gi, '').replace(/\.$/gi, '');
}

export const checkNumber = (n: number | string): number | string => {
    if (Number(n) !== Number(n)) throw Error(`${n} is not a number`); // NaN
    return n
}

export const formatNumber = (n: number | string, decimals = 18): string => {
    n = checkNumber(n);
    const [integer, fractional] = String(n).split(".");

    return !fractional ? integer : integer + "." + fractional.slice(0, decimals);
}

export const formatUnits = (value: BigNumberish, unit?: string | Numeric): string => {
    return ethers.formatUnits(value, unit);
}

export const parseUnits = (n: number | string, decimals = 18): bigint => {
    return ethers.parseUnits(formatNumber(n, decimals), decimals);
}

// bignumber.js

export const BN = (val: number | string): BigNumber => new BigNumber(checkNumber(val));

export const toBN = (n: bigint, decimals = 18): BigNumber => {
    return BN(formatUnits(n, decimals));
}

export const toStringFromBN = (bn: BigNumber, decimals = 18): string => {
    return bn.toFixed(decimals);
}

export const fromBN = (bn: BigNumber, decimals = 18): bigint => {
    return parseUnits(toStringFromBN(bn, decimals), decimals)
}

// -----------------------------------------------------------------------------------------------


export const ETH_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const isEth = (address: string): boolean => address.toLowerCase() === ETH_ADDRESS.toLowerCase();
export const getEthIndex = (addresses: string[]): number => addresses.map((address: string) => address.toLowerCase()).indexOf(ETH_ADDRESS.toLowerCase());
export const _mulBy1_3 = (n: bigint): bigint => n * parseUnits("130", 0) / parseUnits("100", 0);


export const smartNumber = (abstractNumber: bigint | bigint[]): number | number[] => {
    if(Array.isArray(abstractNumber)) {
        return [Number(abstractNumber[0]), Number(abstractNumber[1])];
    } else {
        return Number(abstractNumber);
    }
}

export const DIGas = (gas: bigint | Array<bigint>): bigint => {
    if(Array.isArray(gas)) {
        return gas[0];
    } else {
        return gas;
    }
}

export const getGasFromArray = (gas: number[]): number | number[] => {
    if(gas[1] === 0) {
        return gas[0];
    } else {
        return gas;
    }
}

export const gasSum = (gas: number[], currentGas: number | number[]): number[] => {
    if(Array.isArray(currentGas)) {
        gas[0] = gas[0] + currentGas[0];
        gas[1] = gas[1] + currentGas[1];
    } else {
        gas[0] = gas[0] + currentGas;
    }
    return gas;
}

export const _getAddress = (address: string): string => {
    address = address || lending.signerAddress;
    if (!address) throw Error("Need to connect wallet or pass address into args");

    return address
}

export const handleMultiCallResponse = (callsMap: string[], response: any[]) => {
    const result: Record<string, any> = {};
    const responseLength = callsMap.length;
    for(let i = 0; i < responseLength; i++) {
        result[callsMap[i]] = response.filter((a, j) => j % responseLength === i) as string[];
    }
    return result;
}

// coins can be either addresses or symbols
export const _getCoinAddressesNoCheck = (coins: string[]): string[] => {
    return coins.map((c) => c.toLowerCase()).map((c) => lending.constants.COINS[c].address || c);
}

export const _getCoinAddresses = (coins: string[]): string[] => {
    const coinAddresses = _getCoinAddressesNoCheck(coins);
    const availableAddresses = Object.keys(lending.constants.DECIMALS);
    for (const coinAddr of coinAddresses) {
        if (!availableAddresses.includes(coinAddr)) throw Error(`Coin with address '${coinAddr}' is not available`);
    }

    return coinAddresses
}

export const _getCoinDecimals = (coinAddresses: string[]): number[] => {
    return coinAddresses.map((coinAddr) => lending.constants.DECIMALS[coinAddr.toLowerCase()] ?? 18);
}


// --- BALANCES ---

export const _getBalances = async (coinAddresses: string[], address = ""): Promise<bigint[]> => {
    address = _getAddress(address);
    const _coinAddresses = [...coinAddresses];
    const ethIndex = getEthIndex(_coinAddresses);
    if (ethIndex !== -1) {
        _coinAddresses.splice(ethIndex, 1);
    }

    const contractCalls = [];
    for (const coinAddr of _coinAddresses) {
        contractCalls.push(lending.contracts[coinAddr].multicallContract.balanceOf(address));
    }
    const _balances: bigint[] = await lending.multicallProvider.all(contractCalls);

    if (ethIndex !== -1) {
        const ethBalance: bigint = await lending.provider.getBalance(address);
        _balances.splice(ethIndex, 0, ethBalance);
    }

    return _balances
}

export const getBalances = async (coins: string[], address = ""): Promise<string[]> => {
    const coinAddresses = _getCoinAddresses(coins);
    const decimals = _getCoinDecimals(coinAddresses);
    const _balances = await _getBalances(coinAddresses, address);

    return _balances.map((_b, i: number ) => formatUnits(_b, decimals[i]));
}

export const _getAllowance = async (coins: string[], address: string, spender: string): Promise<bigint[]> => {
    const _coins = [...coins]
    const ethIndex = getEthIndex(_coins);
    if (ethIndex !== -1) {
        _coins.splice(ethIndex, 1);

    }

    let allowance: bigint[];
    if (_coins.length === 1) {
        allowance = [await lending.contracts[_coins[0]].contract.allowance(address, spender, lending.constantOptions)];
    } else {
        const contractCalls = _coins.map((coinAddr) => lending.contracts[coinAddr].multicallContract.allowance(address, spender));
        allowance = await lending.multicallProvider.all(contractCalls);
    }


    if (ethIndex !== -1) {
        allowance.splice(ethIndex, 0, MAX_ALLOWANCE);
    }

    return allowance;
}

// coins can be either addresses or symbols
export const getAllowance = async (coins: string[], address: string, spender: string): Promise<string[]> => {
    const coinAddresses = _getCoinAddresses(coins);
    const decimals = _getCoinDecimals(coinAddresses);
    const _allowance = await _getAllowance(coinAddresses, address, spender);

    return _allowance.map((a, i) => lending.formatUnits(a, decimals[i]))
}

// coins can be either addresses or symbols
export const hasAllowance = async (coins: string[], amounts: (number | string)[], address: string, spender: string): Promise<boolean> => {
    const coinAddresses = _getCoinAddresses(coins);
    const decimals = _getCoinDecimals(coinAddresses);
    const _allowance = await _getAllowance(coinAddresses, address, spender);
    const _amounts = amounts.map((a, i) => parseUnits(a, decimals[i]));

    return _allowance.map((a, i) => a >= _amounts[i]).reduce((a, b) => a && b);
}

export const _ensureAllowance = async (coins: string[], amounts: bigint[], spender: string, isMax = true): Promise<string[]> => {
    const address = lending.signerAddress;
    const allowance: bigint[] = await _getAllowance(coins, address, spender);

    const txHashes: string[] = []
    for (let i = 0; i < allowance.length; i++) {
        if (allowance[i] < amounts[i]) {
            const contract = lending.contracts[coins[i]].contract;
            const _approveAmount = isMax ? MAX_ALLOWANCE : amounts[i];
            await lending.updateFeeData();
            if (allowance[i] > lending.parseUnits("0")) {
                const gasLimit = _mulBy1_3(DIGas(await contract.approve.estimateGas(spender, lending.parseUnits("0"), lending.constantOptions)));
                txHashes.push((await contract.approve(spender, lending.parseUnits("0"), { ...lending.options, gasLimit })).hash);
            }
            const gasLimit = _mulBy1_3(DIGas(await contract.approve.estimateGas(spender, _approveAmount, lending.constantOptions)));
            txHashes.push((await contract.approve(spender, _approveAmount, { ...lending.options, gasLimit })).hash);
        }
    }

    return txHashes;
}

// coins can be either addresses or symbols
export const ensureAllowanceEstimateGas = async (coins: string[], amounts: (number | string)[], spender: string, isMax = true): Promise<number | number[]> => {
    const coinAddresses = _getCoinAddresses(coins);
    const decimals = _getCoinDecimals(coinAddresses);
    const _amounts = amounts.map((a, i) => parseUnits(a, decimals[i]));
    const address = lending.signerAddress;
    const _allowance: bigint[] = await _getAllowance(coinAddresses, address, spender);

    let gas = [0,0];
    for (let i = 0; i < _allowance.length; i++) {
        if (_allowance[i] < _amounts[i]) {
            const contract = lending.contracts[coinAddresses[i]].contract;
            const _approveAmount = isMax ? MAX_ALLOWANCE : _amounts[i];
            if (_allowance[i] > lending.parseUnits("0")) {
                let currentGas = smartNumber(await contract.approve.estimateGas(spender, lending.parseUnits("0"), lending.constantOptions));
                // For some coins (crv for example ) we can't estimate the second tx gas (approve: 0 --> amount), so we assume it will cost the same amount of gas
                if (typeof currentGas === "number") {
                    currentGas = currentGas * 2;
                } else {
                    currentGas = currentGas.map((g) => g * 2)
                }
                gas = gasSum(gas, currentGas);
            } else {
                const currentGas = smartNumber(await contract.approve.estimateGas(spender, _approveAmount, lending.constantOptions));
                gas = gasSum(gas, currentGas);
            }
        }
    }

    return getGasFromArray(gas);
}

// coins can be either addresses or symbols
export const ensureAllowance = async (coins: string[], amounts: (number | string)[], spender: string, isMax = true): Promise<string[]> => {
    const coinAddresses = _getCoinAddresses(coins);
    const decimals = _getCoinDecimals(coinAddresses);
    const _amounts = amounts.map((a, i) => parseUnits(a, decimals[i]));

    return await _ensureAllowance(coinAddresses, _amounts, spender, isMax)
}
