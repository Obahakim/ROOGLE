import { SPHERE_NETWORKS } from '@unicitylabs/sphere-sdk/connect';

export type NetworkName = 'testnet' | 'mainnet';

const STORAGE_KEY = 'roogle:network';
const listeners = new Set<(network: NetworkName) => void>();

function readStoredNetwork(): NetworkName {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mainnet' ? 'mainnet' : 'testnet';
  } catch {
    return 'testnet';
  }
}

let selectedNetwork: NetworkName = readStoredNetwork();

export function getNetwork(): NetworkName {
  return selectedNetwork;
}

export function getSphereNetwork(): string {
  return selectedNetwork === 'mainnet' ? 'mainnet' : 'testnet';
}

export function getConnectNetwork() {
  return selectedNetwork === 'mainnet' ? SPHERE_NETWORKS.mainnet : SPHERE_NETWORKS.testnet2;
}

export function setNetwork(network: NetworkName): void {
  if (network === selectedNetwork) return;
  selectedNetwork = network;
  try {
    localStorage.setItem(STORAGE_KEY, network);
  } catch {
    // Persistence is optional in private browsing.
  }
  listeners.forEach((listener) => listener(network));
}

export function onNetworkChange(listener: (network: NetworkName) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}