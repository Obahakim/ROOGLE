/**
 * client/src/identicon.ts
 *
 * A deterministic visual fingerprint derived from a wallet's chain pubkey
 * (or any address string). Lets someone glance at it and recognize "yes,
 * that's the same address" the same way Metamask/ENS "blockies" work —
 * genuinely functional for catching a wrong-address mistake, not
 * decoration.
 */

function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function identiconSvg(seed: string, size = 40): string {
  const hash = hashString(seed || 'unknown');
  const hue = Math.abs(hash) % 360;
  const cellSize = size / 5;
  let cells = '';

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const bitIndex = row * 3 + col;
      const bit = (hash >> bitIndex) & 1;
      if (!bit) continue;
      const y = row * cellSize;
      cells += `<rect x="${col * cellSize}" y="${y}" width="${cellSize}" height="${cellSize}" />`;
      if (col !== 2) {
        // mirror for left/right symmetry
        cells += `<rect x="${(4 - col) * cellSize}" y="${y}" width="${cellSize}" height="${cellSize}" />`;
      }
    }
  }

  return (
    `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" ` +
    `style="background:hsl(${hue}, 30%, 14%); border-radius:8px">` +
    `<g fill="hsl(${hue}, 70%, 60%)">${cells}</g></svg>`
  );
}